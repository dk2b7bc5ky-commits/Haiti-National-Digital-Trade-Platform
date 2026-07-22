import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID, createHash } from 'crypto';
import { ChargeStatus, DocType, ReviewState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { MarketConfigService } from '../config/market-config.service';
import { PayeesService, payeeTypeForCharge } from '../payees/payees.service';
import { DeadlineService } from '../deadlines/deadline.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { resolveContainerScope } from '../data-hub/scoping';
import { apiToChargeType } from '../charges/mappers';
import { EXTRACTION_PROVIDER, ExtractionProvider } from '../integration/extraction-provider';
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

    const threshold = await this.config.confidenceThreshold();
    let created = 0;
    let pendingReview = 0;
    let tasks = 0;

    if (container) {
      for (const line of extraction.charges) {
        const type = apiToChargeType(line.type);
        if (!type) continue;
        const payeeOrgId = await this.resolvePayeeOrgId(type, container.terminalOrgId);
        const belowThreshold = line.confidence < threshold;
        const status: ChargeStatus = belowThreshold ? 'PENDING_REVIEW' : 'PENDING';
        const reviewState: ReviewState = belowThreshold ? 'PENDING' : 'NONE';

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
        if (belowThreshold) {
          pendingReview++;
          await this.prisma.verificationTask.create({
            data: {
              documentId: doc.id,
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
    }

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
