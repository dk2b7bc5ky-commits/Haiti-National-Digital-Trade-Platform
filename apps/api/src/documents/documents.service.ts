import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID, createHash } from 'crypto';
import { ChargeStatus, DocType, ReviewState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { MarketConfigService } from '../config/market-config.service';
import { PayeesService, payeeTypeForCharge } from '../payees/payees.service';
import { DeadlineService } from '../deadlines/deadline.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { resolveContainerScope } from '../data-hub/scoping';
import { apiToChargeType } from '../charges/mappers';
import { EXTRACTION_PROVIDER, ExtractionProvider, ExtractionResult } from '../integration/extraction-provider';
import { toDocumentSummary } from './mappers';
import { UploadDocumentDto } from './dto';
import type { DocumentIngestResult, DocumentSummary } from '@rezo/shared-types';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

const DOC_TYPE_MAP: Record<string, DocType> = {
  terminal_invoice: 'TERMINAL_INVOICE',
  customs_declaration: 'CUSTOMS_DECLARATION',
  bill_of_lading: 'BILL_OF_LADING',
  other: 'OTHER',
};

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly config: MarketConfigService,
    private readonly payees: PayeesService,
    private readonly deadlines: DeadlineService,
    private readonly notifications: NotificationsService,
    @Inject(EXTRACTION_PROVIDER) private readonly extractor: ExtractionProvider,
  ) {}

  /**
   * Ingest a document (spec §1.3): store the file, extract fields via the (mock)
   * ExtractionProvider, match to a container, and turn extracted charges into
   * Charge rows. Fields below the confidence threshold become PENDING_REVIEW
   * charges (excluded from the payable total) with a VerificationTask for Ops.
   */
  async upload(principal: AuthPrincipal, file: UploadedFile, dto: UploadDocumentDto): Promise<DocumentIngestResult> {
    if (!file?.buffer?.length) throw new BadRequestException('No file uploaded.');

    const key = `documents/${principal.orgId}/${randomUUID()}-${file.originalname}`;
    await this.storage.put(key, file.buffer, file.mimetype);

    // Resolve the target container (explicit id, else match by extracted number).
    const scope = await resolveContainerScope(this.prisma, principal);
    let container = dto.container_id
      ? await this.prisma.container.findFirst({ where: { id: dto.container_id, ...scope } })
      : null;
    if (dto.container_id && !container) throw new NotFoundException('Container not found.');

    const docType = DOC_TYPE_MAP[(dto.doc_type ?? 'terminal_invoice').toLowerCase()] ?? 'OTHER';

    const doc = await this.prisma.document.create({
      data: {
        containerId: container?.id ?? null,
        uploadedByOrgId: principal.orgId,
        source: 'UPLOAD',
        docType,
        fileRef: key,
        fileName: file.originalname,
      },
    });

    const extraction = await this.extractor.extract({
      fileName: file.originalname,
      contentType: file.mimetype,
      bytes: file.buffer,
      docTypeHint: dto.doc_type,
      containerNumberHint: container?.containerNumber ?? null,
    });

    // Match by extracted container number if not explicitly provided.
    if (!container && extraction.containerNumber) {
      container = await this.prisma.container.findFirst({
        where: { containerNumber: extraction.containerNumber, ...scope },
      });
    }

    const ingest = container
      ? await this.ingestExtraction(doc.id, container, extraction)
      : { created: 0, pendingReview: 0, tasks: 0, chargeIds: [] as string[] };
    const { created, pendingReview, tasks } = ingest;

    const updated = await this.prisma.document.update({
      where: { id: doc.id },
      data: {
        containerId: container?.id ?? null,
        language: extraction.language,
        rawText: extraction.rawText,
        extractionConfidence: extraction.overallConfidence,
        verificationStatus: tasks > 0 ? 'NEEDS_REVIEW' : container ? 'EXTRACTED' : 'PROCESSING',
      },
    });

    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'document.ingest',
      entity: 'Document',
      entityId: doc.id,
      after: { container_id: container?.id ?? null, charges_created: created, pending_review: pendingReview, file_sha256: createHash('sha256').update(file.buffer).digest('hex') },
    });

    return {
      document: toDocumentSummary(updated),
      charges_created: created,
      charges_pending_review: pendingReview,
      verification_tasks: tasks,
      matched_container_id: container?.id ?? null,
    };
  }

  /**
   * The shared ingestion core (spec §1.3): turn an ExtractionResult into Charge
   * rows on a container, sending anything below the confidence threshold to the
   * Ops verification queue instead of live billing, then recompute deadlines.
   *
   * Used by BOTH the manual "Upload document" button and the email-intake agent,
   * so a notice that arrives by mail is handled exactly like one a human
   * uploads — same thresholds, same review queue, same deadlines.
   *
   * `holdAllForReview` forces every charge into PENDING_REVIEW regardless of
   * confidence. The agent uses it for its lower autonomy levels, so money
   * amounts never go live until a person confirms them.
   */
  async ingestExtraction(
    documentId: string,
    container: { id: string; containerNumber: string; terminalOrgId: string | null },
    extraction: ExtractionResult,
    opts: { holdAllForReview?: boolean } = {},
  ): Promise<{ created: number; pendingReview: number; tasks: number; chargeIds: string[] }> {
    const threshold = await this.config.confidenceThreshold();
    let created = 0;
    let pendingReview = 0;
    let tasks = 0;
    const chargeIds: string[] = [];

    for (const line of extraction.charges) {
      const type = apiToChargeType(line.type);
      if (!type) continue;
      const payeeOrgId = await this.resolvePayeeOrgId(type, container.terminalOrgId);
      const belowThreshold = line.confidence < threshold;
      const hold = belowThreshold || opts.holdAllForReview === true;
      const status: ChargeStatus = hold ? 'PENDING_REVIEW' : 'PENDING';
      const reviewState: ReviewState = hold ? 'PENDING' : 'NONE';

      const charge = await this.prisma.charge.create({
        data: {
          containerId: container.id,
          payeeOrgId,
          type,
          amount: line.amount,
          currency: line.currency,
          lastFreeDay: line.lastFreeDayIso ? new Date(line.lastFreeDayIso) : null,
          dueDate: line.lastFreeDayIso ? new Date(line.lastFreeDayIso) : null,
          status,
          reviewState,
          source: 'DOCUMENT',
        },
      });
      created++;
      chargeIds.push(charge.id);
      if (hold) {
        pendingReview++;
        await this.prisma.verificationTask.create({
          data: {
            documentId,
            chargeId: charge.id,
            containerId: container.id,
            field: 'amount',
            confidence: line.confidence,
            beforeValue: { type: line.type, amount: line.amount, currency: line.currency },
          },
        });
        tasks++;
      }
    }

    await this.deadlines.recomputeForContainer(container.id);
    if (tasks > 0) {
      // Verification is an Ops task — notify the Rezo (orchestrator) org.
      const rezo = await this.prisma.organization.findFirst({ where: { type: 'REZO' } });
      if (rezo) {
        await this.notifications.notify({
          type: 'VERIFICATION_NEEDED', severity: 'SOON', orgId: rezo.id, containerId: container.id,
          title: 'Verification needed',
          body: `${tasks} low-confidence charge(s) on ${container.containerNumber} need review before they can be paid.`,
          deepLink: '/dashboard/ops/verification',
        });
      }
    }
    return { created, pendingReview, tasks, chargeIds };
  }

  /**
   * Persist a document that arrived by email (source EMAIL) rather than via the
   * upload button. Storage failures are non-fatal — extraction runs off the
   * in-memory bytes, so intake still works before a bucket is configured.
   */
  async createEmailDocument(params: {
    orgId: string;
    containerId: string | null;
    fileName: string;
    contentType: string;
    bytes: Buffer;
    docTypeHint?: string;
  }): Promise<{ id: string; fileRef: string }> {
    const key = `documents/${params.orgId}/email/${randomUUID()}-${params.fileName}`;
    await this.storage.put(key, params.bytes, params.contentType);
    const doc = await this.prisma.document.create({
      data: {
        containerId: params.containerId,
        uploadedByOrgId: params.orgId,
        source: 'EMAIL',
        docType: DOC_TYPE_MAP[(params.docTypeHint ?? 'other').toLowerCase()] ?? 'OTHER',
        fileRef: key,
        fileName: params.fileName,
      },
    });
    return { id: doc.id, fileRef: key };
  }

  /** Finalize an email-sourced document once extraction + matching are done. */
  async finalizeEmailDocument(
    documentId: string,
    containerId: string | null,
    extraction: ExtractionResult,
    tasks: number,
  ): Promise<void> {
    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        containerId,
        language: extraction.language,
        rawText: extraction.rawText,
        extractionConfidence: extraction.overallConfidence,
        verificationStatus: tasks > 0 ? 'NEEDS_REVIEW' : containerId ? 'EXTRACTED' : 'PROCESSING',
      },
    });
  }

  /**
   * Delete an uploaded document and the charges it produced, so a bad upload
   * (wrong amounts) can be redone. Charges from uploaded documents aren't linked
   * to a specific document row, so we clear the container's still-unpaid
   * document-sourced charges (never paid ones, never charges already under a
   * payment) and recompute deadlines. Returns how many charges were removed.
   */
  async deleteDocument(principal: AuthPrincipal, id: string): Promise<{ deleted: boolean; charges_removed: number }> {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found.');

    // Scope: the document's container must be visible to the caller (or, for an
    // unmatched document, it must be one this org uploaded).
    if (doc.containerId) {
      const scope = await resolveContainerScope(this.prisma, principal);
      const container = await this.prisma.container.findFirst({ where: { id: doc.containerId, ...scope } });
      if (!container) throw new NotFoundException('Document not found.');
    } else if (doc.uploadedByOrgId !== principal.orgId) {
      throw new NotFoundException('Document not found.');
    }

    let chargesRemoved = 0;
    await this.prisma.$transaction(async (tx) => {
      if (doc.containerId) {
        const charges = await tx.charge.findMany({
          where: {
            containerId: doc.containerId,
            source: 'DOCUMENT',
            status: { in: ['PENDING', 'PENDING_REVIEW', 'OVERDUE', 'REQUESTED'] },
            paymentRequestId: null,
          },
          select: { id: true },
        });
        const chargeIds = charges.map((c) => c.id);
        if (chargeIds.length > 0) {
          await tx.verificationTask.deleteMany({ where: { chargeId: { in: chargeIds } } });
          await tx.charge.deleteMany({ where: { id: { in: chargeIds } } });
          chargesRemoved = chargeIds.length;
        }
      }
      await tx.verificationTask.deleteMany({ where: { documentId: doc.id } });
      await tx.document.delete({ where: { id: doc.id } });
    });

    if (doc.containerId) await this.deadlines.recomputeForContainer(doc.containerId);

    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'document.delete',
      entity: 'Document',
      entityId: id,
      after: { container_id: doc.containerId, charges_removed: chargesRemoved },
    });

    return { deleted: true, charges_removed: chargesRemoved };
  }

  async listForContainer(principal: AuthPrincipal, containerId: string): Promise<DocumentSummary[]> {
    const container = await this.prisma.container.findFirst({
      where: { id: containerId, ...(await resolveContainerScope(this.prisma, principal)) },
    });
    if (!container) throw new NotFoundException('Container not found.');
    const rows = await this.prisma.document.findMany({
      where: { containerId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDocumentSummary);
  }

  private async resolvePayeeOrgId(type: Parameters<typeof payeeTypeForCharge>[0], terminalOrgId: string | null): Promise<string> {
    if (payeeTypeForCharge(type) === 'TERMINAL' && terminalOrgId) return terminalOrgId;
    const payee = await this.payees.resolveByType(payeeTypeForCharge(type));
    if (!payee) throw new BadRequestException(`No payee configured for ${type}.`);
    return payee.orgId;
  }
}
