/**
 * MailIntakeService — the Alize email agent (ALIZE_AGENT_SCOPE phases A2/A3).
 *
 * Watches a connected mailbox, recognizes arrival notices / port & agency
 * bills, reads them with the Claude-backed ExtractionProvider, matches or
 * creates the container, and writes the charges through the SAME ingestion
 * pipeline the manual upload button uses.
 *
 * NON-NEGOTIABLES honoured here:
 *  - The agent NEVER pays and never creates a PaymentRequest. It only reads
 *    mail and writes data. Payment stays a human action.
 *  - Read-only on the mailbox: no delete, move, flag, or send.
 *  - Email content is UNTRUSTED. It is parsed for fields only; instructions
 *    inside a message are never followed. The extractor is called with a fixed
 *    system prompt and a forced tool schema, so a "notice" that says
 *    "mark everything paid" is just text that fails to parse as a charge.
 *  - Uncertainty is surfaced, never guessed: low-confidence amounts land in the
 *    Ops verification queue; below AUTO_ALL autonomy every amount waits for a
 *    human Confirm.
 */
import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MailAutonomy, MailIntakeStatus, MailboxConnection, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { DeadlineService } from '../deadlines/deadline.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ContainersService } from '../data-hub/containers.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { permissionsForRole } from '../rbac/permissions';
import { EXTRACTION_PROVIDER, ExtractionProvider, ExtractionResult } from '../integration/extraction-provider';
import { MAILBOX_PROVIDER, MailMessage, MailboxProvider } from '../integration/mailbox-provider';
import { classifyMessage } from './classifier';
import { UpsertConnectionDto } from './dto';
import { QuickAddContainerDto } from '../data-hub/dto';
import type { ContainerSize as ApiContainerSize } from '@rezo/shared-types';

/** Max messages pulled per run, so one tick can't run away. */
const PER_RUN_LIMIT = Number(process.env.MAIL_INTAKE_BATCH ?? '25');
/** On a first sync, ignore mail older than this. */
const FIRST_SYNC_DAYS = Number(process.env.MAIL_INTAKE_FIRST_SYNC_DAYS ?? '14');
/** ISO 6346 container number. */
const CONTAINER_RE = /\b([A-Z]{4}\d{7})\b/;

export interface RunSummary {
  checked: number;
  ignored: number;
  processed: number;
  needsReview: number;
  failed: number;
  error?: string;
}

@Injectable()
export class MailIntakeService {
  private readonly logger = new Logger(MailIntakeService.name);
  /** Guards against overlapping runs (cron tick + a manual "Check now"). */
  private running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly deadlines: DeadlineService,
    private readonly notifications: NotificationsService,
    private readonly containers: ContainersService,
    @Inject(EXTRACTION_PROVIDER) private readonly extractor: ExtractionProvider,
    @Inject(MAILBOX_PROVIDER) private readonly mailbox: MailboxProvider,
  ) {}

  // -------------------------------------------------------------------------
  // Connection management
  // -------------------------------------------------------------------------

  async getConnection(principal: AuthPrincipal): Promise<MailboxConnection | null> {
    return this.prisma.mailboxConnection.findFirst({ where: { orgId: principal.orgId } });
  }

  /**
   * Create or update the watched mailbox. The password is NEVER accepted here —
   * only the NAME of the env var that holds it, so no credential can arrive over
   * the API or come to rest in the database.
   */
  async upsertConnection(principal: AuthPrincipal, dto: UpsertConnectionDto): Promise<MailboxConnection> {
    const address = dto.address.trim().toLowerCase();
    const existing = await this.prisma.mailboxConnection.findFirst({ where: { orgId: principal.orgId } });
    const data = {
      address,
      username: (dto.username ?? address).trim(),
      host: dto.host?.trim() || 'imap.gmail.com',
      port: dto.port ?? 993,
      useTls: dto.use_tls ?? true,
      folder: dto.folder?.trim() || 'INBOX',
      secretEnvVar: dto.secret_env_var?.trim() || 'MAIL_INTAKE_PASSWORD',
      autonomy: (dto.autonomy ?? 'AUTO_CONTAINER') as MailAutonomy,
      active: dto.active ?? false,
    };
    // Pointing at a different mailbox/folder invalidates the "already seen"
    // watermark — UIDs are per-folder, so keeping it would silently skip mail.
    const retargeted =
      existing !== null &&
      (existing.address !== data.address || existing.host !== data.host || existing.folder !== data.folder);

    const conn = existing
      ? await this.prisma.mailboxConnection.update({
          where: { id: existing.id },
          data: retargeted ? { ...data, lastUid: null, lastError: null } : data,
        })
      : await this.prisma.mailboxConnection.create({ data: { ...data, orgId: principal.orgId } });

    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: existing ? 'mailbox.update' : 'mailbox.connect',
      entity: 'MailboxConnection',
      entityId: conn.id,
      // Note what was configured — never the credential itself.
      after: { address: conn.address, host: conn.host, folder: conn.folder, autonomy: conn.autonomy, active: conn.active, secret_env_var: conn.secretEnvVar },
    });
    return conn;
  }

  /** Confirms the credentials work without ingesting anything. */
  async testConnection(principal: AuthPrincipal): Promise<{ ok: boolean; error?: string; mailbox_count?: number }> {
    const conn = await this.requireConnection(principal);
    const password = this.secretFor(conn);
    if (!password && this.mailbox.requiresCredential) {
      return { ok: false, error: `No password found. Set the ${conn.secretEnvVar} environment variable on the API service, then redeploy.` };
    }
    const res = await this.mailbox.verify(this.credsFor(conn, password ?? ''));
    await this.prisma.mailboxConnection.update({
      where: { id: conn.id },
      data: { lastError: res.ok ? null : res.error ?? 'Unknown error' },
    });
    return { ok: res.ok, error: res.error, mailbox_count: res.mailboxCount };
  }

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------

  /**
   * Poll every active mailbox. Disabled unless MAIL_INTAKE_ENABLED=true so a
   * deploy never starts reading mail by surprise.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduledRun(): Promise<void> {
    if (process.env.MAIL_INTAKE_ENABLED !== 'true') return;
    const conns = await this.prisma.mailboxConnection.findMany({ where: { active: true } });
    for (const conn of conns) {
      try {
        await this.runForConnection(conn);
      } catch (e) {
        this.logger.warn(`Mail intake failed for ${conn.address}: ${(e as Error).message}`);
      }
    }
  }

  /** "Check now" from the UI. */
  async runNow(principal: AuthPrincipal): Promise<RunSummary> {
    const conn = await this.requireConnection(principal);
    return this.runForConnection(conn);
  }

  // -------------------------------------------------------------------------
  // The run loop
  // -------------------------------------------------------------------------

  async runForConnection(conn: MailboxConnection): Promise<RunSummary> {
    const summary: RunSummary = { checked: 0, ignored: 0, processed: 0, needsReview: 0, failed: 0 };
    if (this.running.has(conn.id)) return { ...summary, error: 'A check is already running.' };
    this.running.add(conn.id);
    try {
      const password = this.secretFor(conn);
      if (!password && this.mailbox.requiresCredential) {
        const error = `No password configured. Set ${conn.secretEnvVar} on the API service.`;
        await this.prisma.mailboxConnection.update({ where: { id: conn.id }, data: { lastError: error, lastCheckedAt: new Date() } });
        return { ...summary, error };
      }

      let messages: MailMessage[];
      try {
        messages = await this.mailbox.fetchSince(this.credsFor(conn, password ?? ''), {
          sinceUid: conn.lastUid,
          limit: PER_RUN_LIMIT,
          maxAgeDays: FIRST_SYNC_DAYS,
        });
      } catch (e) {
        const error = (e as Error).message;
        await this.prisma.mailboxConnection.update({ where: { id: conn.id }, data: { lastError: error, lastCheckedAt: new Date() } });
        return { ...summary, error };
      }

      let highestUid = conn.lastUid ?? 0;
      for (const msg of messages) {
        summary.checked++;
        highestUid = Math.max(highestUid, msg.uid);
        try {
          const outcome = await this.handleMessage(conn, msg);
          if (outcome === 'IGNORED') summary.ignored++;
          else if (outcome === 'NEEDS_REVIEW') summary.needsReview++;
          else if (outcome === 'PROCESSED') summary.processed++;
        } catch (e) {
          summary.failed++;
          this.logger.warn(`Message ${msg.messageId} failed: ${(e as Error).message}`);
          await this.recordFailure(conn, msg, (e as Error).message);
        }
      }

      await this.prisma.mailboxConnection.update({
        where: { id: conn.id },
        data: { lastUid: highestUid > 0 ? highestUid : null, lastCheckedAt: new Date(), lastError: null },
      });
      return summary;
    } finally {
      this.running.delete(conn.id);
    }
  }

  /**
   * Process one email. Returns the terminal status so the caller can tally.
   * Dedupe is by (connection, Message-ID) — a re-read of the same message is a
   * no-op, so re-running a check can never double-bill a container.
   */
  private async handleMessage(conn: MailboxConnection, msg: MailMessage): Promise<MailIntakeStatus> {
    const already = await this.prisma.mailIntakeMessage.findUnique({
      where: { connectionId_messageId: { connectionId: conn.id, messageId: msg.messageId } },
      select: { id: true, status: true },
    });
    // Only retry things that previously errored; never re-ingest a settled one.
    if (already && already.status !== 'FAILED') return already.status;

    const verdict = classifyMessage({
      fromAddress: msg.fromAddress,
      subject: msg.subject,
      bodyText: msg.bodyText,
      attachmentNames: msg.attachments.map((a) => a.fileName),
    });

    const base = {
      connectionId: conn.id,
      orgId: conn.orgId,
      messageId: msg.messageId,
      uid: msg.uid,
      fromAddress: msg.fromAddress,
      subject: msg.subject.slice(0, 500),
      receivedAt: msg.receivedAt,
      attachmentCount: msg.attachments.length,
      classification: verdict.reason,
    };

    // Not an arrival notice → recorded (so the operator sees it was seen and
    // skipped, and why) but nothing is written to any container.
    if (!verdict.accept) {
      await this.upsertIntake(already?.id, { ...base, status: 'IGNORED', processedAt: new Date() });
      return 'IGNORED';
    }

    // ---- Read it. Attachments first (a PDF notice is richer than the covering
    // note); fall back to the email body, which is how MSC sends theirs. ----
    const readables: { fileName: string; contentType: string; bytes: Buffer }[] = msg.attachments.map((a) => ({
      fileName: a.fileName,
      contentType: a.contentType,
      bytes: a.bytes,
    }));
    if (readables.length === 0) {
      readables.push({
        fileName: `${sanitize(msg.subject) || 'email'}.txt`,
        contentType: 'text/plain',
        bytes: Buffer.from(msg.bodyText, 'utf8'),
      });
    }

    const autonomy = conn.autonomy;
    let containerId: string | null = null;
    let containerNumber: string | null = null;
    const documentIds: string[] = [];
    const chargeIds: string[] = [];
    let totalTasks = 0;
    let totalCharges = 0;
    let bestConfidence = 0;
    let bestExtraction: ExtractionResult | null = null;
    let createdContainer = false;

    for (const item of readables) {
      const doc = await this.documents.createEmailDocument({
        orgId: conn.orgId,
        containerId: null,
        fileName: item.fileName,
        contentType: item.contentType,
        bytes: item.bytes,
        docTypeHint: 'other',
      });
      documentIds.push(doc.id);

      const extraction = await this.extractor.extract({
        fileName: item.fileName,
        contentType: item.contentType,
        bytes: item.bytes,
      });
      if (extraction.overallConfidence >= bestConfidence) {
        bestConfidence = extraction.overallConfidence;
        bestExtraction = extraction;
      }

      // ---- Match the container: extracted number, then the subject/body, then
      // by B/L. If nothing matches we may create it (see autonomy below). ----
      const resolved = await this.resolveContainer(conn, extraction, msg, autonomy);
      if (resolved.container) {
        containerId = resolved.container.id;
        containerNumber = resolved.container.containerNumber;
        createdContainer = createdContainer || resolved.created;

        // Below AUTO_ALL, hold every amount for human confirmation.
        const holdAllForReview = autonomy !== 'AUTO_ALL';
        const ingest = await this.documents.ingestExtraction(doc.id, resolved.container, extraction, { holdAllForReview });
        totalCharges += ingest.created;
        totalTasks += ingest.tasks;
        chargeIds.push(...ingest.chargeIds);
        await this.documents.finalizeEmailDocument(doc.id, resolved.container.id, extraction, ingest.tasks);
      } else {
        await this.documents.finalizeEmailDocument(doc.id, null, extraction, 0);
      }
    }

    // REVIEW_ALL keeps even the container itself pending, so status reflects
    // "a human still has to look at this".
    const needsReview =
      autonomy === 'REVIEW_ALL' || autonomy === 'AUTO_CONTAINER' || totalTasks > 0 || !containerId;
    const status: MailIntakeStatus = needsReview ? 'NEEDS_REVIEW' : 'PROCESSED';

    await this.upsertIntake(already?.id, {
      ...base,
      status,
      containerId,
      documentIds,
      chargeIds,
      confidence: bestConfidence,
      extracted: this.summarizeExtraction(bestExtraction, containerNumber, totalCharges, createdContainer) as Prisma.InputJsonValue,
      processedAt: new Date(),
      error: null,
    });

    await this.audit.record({
      actorOrgId: conn.orgId,
      action: 'mail_intake.process',
      entity: 'MailIntakeMessage',
      entityId: msg.messageId,
      after: {
        from: msg.fromAddress, subject: msg.subject, container_id: containerId,
        container_created: createdContainer, charges_created: totalCharges,
        charges_held_for_review: totalTasks, autonomy, status,
      },
    });

    if (containerId) {
      await this.notifications.notify({
        type: 'CHARGE_ADDED',
        severity: needsReview ? 'SOON' : 'INFO',
        orgId: conn.orgId,
        containerId,
        title: createdContainer ? `New container ${containerNumber} from email` : `Arrival notice read for ${containerNumber}`,
        body: needsReview
          ? `The agent read an arrival notice from ${msg.fromAddress} and prepared ${totalCharges} charge(s). Confirm them to make them payable.`
          : `The agent read an arrival notice from ${msg.fromAddress} and added ${totalCharges} charge(s).`,
        deepLink: '/dashboard/agent',
      });
    }
    return status;
  }

  /**
   * Find the container this notice is about, or create it.
   *
   * Order: the extractor's container number → a number in the subject/body →
   * the B/L number. Creation only happens when autonomy allows it; otherwise the
   * message waits for a human, since inventing a container from a misread
   * notice is worse than asking.
   */
  private async resolveContainer(
    conn: MailboxConnection,
    extraction: ExtractionResult,
    msg: MailMessage,
    autonomy: MailAutonomy,
  ): Promise<{ container: { id: string; containerNumber: string; terminalOrgId: string | null } | null; created: boolean }> {
    const fromText = `${msg.subject}\n${msg.bodyText}`.toUpperCase().match(CONTAINER_RE)?.[1] ?? null;
    const number = (extraction.containerNumber ?? fromText)?.trim().toUpperCase() ?? null;

    if (number) {
      const hit = await this.prisma.container.findFirst({
        where: { containerNumber: number, importerOrgId: conn.orgId },
        select: { id: true, containerNumber: true, terminalOrgId: true },
      });
      if (hit) return { container: hit, created: false };
    }

    // Fall back to the B/L — real notices sometimes omit the container number
    // (the Maersk form shows QTY + SIZE only).
    if (extraction.blNumber) {
      const bl = await this.prisma.billOfLading.findFirst({
        where: { blNumber: extraction.blNumber.trim(), importerOrgId: conn.orgId },
        select: { containers: { select: { id: true, containerNumber: true, terminalOrgId: true }, take: 1 } },
      });
      if (bl?.containers?.[0]) return { container: bl.containers[0], created: false };
    }

    // Nothing matched. Create it only when the operator has allowed that.
    if (!number || autonomy === 'REVIEW_ALL') return { container: null, created: false };

    const org = await this.prisma.organization.findUnique({ where: { id: conn.orgId } });
    if (!org || org.type !== 'IMPORTER') return { container: null, created: false };
    const actor = await this.prisma.user.findFirst({
      where: { orgId: conn.orgId, role: 'IMPORTER' },
      select: { id: true, orgId: true, role: true },
    });
    if (!actor) return { container: null, created: false };

    // Reuse the exact quick-add path a human uses (vessel → voyage → manifest →
    // B/L → container), so email-created containers are indistinguishable from
    // hand-entered ones. The principal is built in full — including the role's
    // real permission set — so the agent is subject to the same RBAC checks as
    // that user, never more.
    const principal: AuthPrincipal = {
      userId: actor.id,
      orgId: actor.orgId,
      orgType: org.type,
      role: actor.role,
      permissions: permissionsForRole(actor.role),
      viaApiKey: false,
    };
    const dto: QuickAddContainerDto = {
      container_number: number,
      size_type: guessSize(extraction.rawText, msg.bodyText),
      bl_number: extraction.blNumber?.trim() || undefined,
      arrival_date: firstDateIso(extraction) ?? undefined,
      vessel_name: guessVessel(extraction.rawText, msg.bodyText) ?? undefined,
    };
    const detail = await this.containers.quickAdd(principal, dto);

    const created = await this.prisma.container.findUnique({
      where: { id: detail.container.id },
      select: { id: true, containerNumber: true, terminalOrgId: true },
    });
    return created ? { container: created, created: true } : { container: null, created: false };
  }

  // -------------------------------------------------------------------------
  // Review surface (phase A3)
  // -------------------------------------------------------------------------

  async listMessages(principal: AuthPrincipal, status?: string, limit = 50) {
    const where: Prisma.MailIntakeMessageWhereInput = { orgId: principal.orgId };
    if (status) {
      const up = status.toUpperCase();
      if ((Object.values(MailIntakeStatus) as string[]).includes(up)) where.status = up as MailIntakeStatus;
    }
    return this.prisma.mailIntakeMessage.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }

  /**
   * Human confirms what the agent read: every held charge on this message goes
   * live (PENDING) and its verification tasks are closed. Still no payment —
   * confirming only makes the charge payable.
   */
  async confirm(principal: AuthPrincipal, id: string): Promise<{ confirmed: number }> {
    const msg = await this.ownedMessage(principal, id);
    if (msg.chargeIds.length === 0 && !msg.containerId) {
      throw new BadRequestException('Nothing to confirm on this message.');
    }
    const result = await this.prisma.charge.updateMany({
      where: { id: { in: msg.chargeIds }, status: 'PENDING_REVIEW' },
      data: { status: 'PENDING', reviewState: 'RESOLVED' },
    });
    await this.prisma.verificationTask.updateMany({
      where: { chargeId: { in: msg.chargeIds }, status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedByUserId: principal.userId, resolvedAt: new Date() },
    });
    await this.prisma.mailIntakeMessage.update({
      where: { id: msg.id },
      data: { status: 'CONFIRMED', reviewedByUserId: principal.userId, reviewedAt: new Date() },
    });
    if (msg.containerId) await this.deadlines.recomputeForContainer(msg.containerId);

    await this.audit.record({
      actorUserId: principal.userId, actorOrgId: principal.orgId,
      action: 'mail_intake.confirm', entity: 'MailIntakeMessage', entityId: msg.id,
      after: { charges_confirmed: result.count, container_id: msg.containerId },
    });
    return { confirmed: result.count };
  }

  /**
   * Human rejects it: remove exactly the charges and documents this message
   * created (never anything paid or already under a payment request), so a
   * misread notice leaves no trace. The container itself is kept — deleting a
   * real box because one notice was wrong would be worse.
   */
  async reject(principal: AuthPrincipal, id: string): Promise<{ charges_removed: number; documents_removed: number }> {
    const msg = await this.ownedMessage(principal, id);
    let chargesRemoved = 0;
    let docsRemoved = 0;

    await this.prisma.$transaction(async (tx) => {
      if (msg.chargeIds.length > 0) {
        const removable = await tx.charge.findMany({
          where: {
            id: { in: msg.chargeIds },
            status: { in: ['PENDING', 'PENDING_REVIEW', 'OVERDUE', 'REQUESTED'] },
            paymentRequestId: null,
          },
          select: { id: true },
        });
        const ids = removable.map((c) => c.id);
        if (ids.length > 0) {
          await tx.verificationTask.deleteMany({ where: { chargeId: { in: ids } } });
          await tx.charge.deleteMany({ where: { id: { in: ids } } });
          chargesRemoved = ids.length;
        }
      }
      if (msg.documentIds.length > 0) {
        await tx.verificationTask.deleteMany({ where: { documentId: { in: msg.documentIds } } });
        const del = await tx.document.deleteMany({ where: { id: { in: msg.documentIds } } });
        docsRemoved = del.count;
      }
      await tx.mailIntakeMessage.update({
        where: { id: msg.id },
        data: { status: 'REJECTED', reviewedByUserId: principal.userId, reviewedAt: new Date(), chargeIds: [], documentIds: [] },
      });
    });

    if (msg.containerId) await this.deadlines.recomputeForContainer(msg.containerId);
    await this.audit.record({
      actorUserId: principal.userId, actorOrgId: principal.orgId,
      action: 'mail_intake.reject', entity: 'MailIntakeMessage', entityId: msg.id,
      after: { charges_removed: chargesRemoved, documents_removed: docsRemoved },
    });
    return { charges_removed: chargesRemoved, documents_removed: docsRemoved };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async requireConnection(principal: AuthPrincipal): Promise<MailboxConnection> {
    const conn = await this.prisma.mailboxConnection.findFirst({ where: { orgId: principal.orgId } });
    if (!conn) throw new NotFoundException('No mailbox connected.');
    return conn;
  }

  private async ownedMessage(principal: AuthPrincipal, id: string) {
    const msg = await this.prisma.mailIntakeMessage.findFirst({ where: { id, orgId: principal.orgId } });
    if (!msg) throw new NotFoundException('Message not found.');
    return msg;
  }

  /** The password lives only in the host's secret store, read at call time. */
  private secretFor(conn: MailboxConnection): string | null {
    const v = process.env[conn.secretEnvVar];
    return v && v.trim().length > 0 ? v.trim() : null;
  }

  private credsFor(conn: MailboxConnection, password: string) {
    return {
      host: conn.host, port: conn.port, useTls: conn.useTls,
      username: conn.username, password, folder: conn.folder,
    };
  }

  private async upsertIntake(existingId: string | undefined, data: Prisma.MailIntakeMessageUncheckedCreateInput) {
    if (existingId) {
      const { connectionId: _c, messageId: _m, ...rest } = data;
      return this.prisma.mailIntakeMessage.update({ where: { id: existingId }, data: rest });
    }
    return this.prisma.mailIntakeMessage.create({ data });
  }

  private async recordFailure(conn: MailboxConnection, msg: MailMessage, error: string): Promise<void> {
    const existing = await this.prisma.mailIntakeMessage.findUnique({
      where: { connectionId_messageId: { connectionId: conn.id, messageId: msg.messageId } },
      select: { id: true },
    });
    const data = {
      connectionId: conn.id, orgId: conn.orgId, messageId: msg.messageId, uid: msg.uid,
      fromAddress: msg.fromAddress, subject: msg.subject.slice(0, 500), receivedAt: msg.receivedAt,
      attachmentCount: msg.attachments.length, status: 'FAILED' as MailIntakeStatus,
      error: error.slice(0, 1000), processedAt: new Date(),
    };
    await this.upsertIntake(existing?.id, data);
  }

  /** What the UI shows as "here's what I read". Data only — never instructions. */
  private summarizeExtraction(
    extraction: ExtractionResult | null,
    containerNumber: string | null,
    chargesCreated: number,
    containerCreated: boolean,
  ): Record<string, unknown> {
    return {
      container_number: containerNumber ?? extraction?.containerNumber ?? null,
      bl_number: extraction?.blNumber ?? null,
      doc_type: extraction?.docType ?? null,
      language: extraction?.language ?? null,
      container_created: containerCreated,
      charges_created: chargesCreated,
      charges: (extraction?.charges ?? []).map((c) => ({
        type: c.type, amount: c.amount, currency: c.currency,
        confidence: c.confidence, last_free_day: c.lastFreeDayIso ?? null,
      })),
    };
  }
}

const sanitize = (s: string): string => s.replace(/[^\w\-. ]+/g, '').trim().slice(0, 80);

/**
 * 40HC/40RF/20GP cues → the platform's three size buckets, in the API's
 * lowercase form ('20' | '40' | 'reefer') that QuickAddContainerDto validates.
 * Defaults to 40', the most common box, when the notice doesn't say.
 */
function guessSize(...texts: (string | undefined)[]): ApiContainerSize {
  const t = texts.filter(Boolean).join('\n').toUpperCase();
  if (/REEFER|REEF\b|\b\d{2}RF\b|40HCR|FRIGO|ELECTRICIT/.test(t)) return 'reefer';
  if (/\b20(GP|DV|ST|TK|OT)?\b|\b20['′]/.test(t)) return '20';
  return '40';
}

function guessVessel(...texts: (string | undefined)[]): string | null {
  const t = texts.filter(Boolean).join('\n');
  const m = t.match(/(?:vessel|navire|m\/?v|bato)\s*[:-]?\s*([A-Z0-9][A-Z0-9 .\-']{2,40})/i);
  return m ? m[1].trim().replace(/\s{2,}/g, ' ').slice(0, 60) : null;
}

/** Earliest last-free-day in the extraction, used as a proxy arrival date. */
function firstDateIso(extraction: ExtractionResult): string | null {
  const days = extraction.charges.map((c) => c.lastFreeDayIso).filter((d): d is string => !!d).sort();
  return days[0] ?? null;
}
