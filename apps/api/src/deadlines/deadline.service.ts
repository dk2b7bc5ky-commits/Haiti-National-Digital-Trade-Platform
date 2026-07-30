import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AlertChannel, Deadline } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MarketConfigService } from '../config/market-config.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { NOTIFICATION_ADAPTER, NotificationAdapter } from '../integration/notification-adapter';
import { toDeadlineSummary, toAlertSummary } from './mappers';
import type { DeadlineSummary, AlertSummary } from '@rezo/shared-types';

const CHANNEL_MAP: Record<string, AlertChannel> = { in_app: 'IN_APP', email: 'EMAIL', sms: 'SMS' };
const DISPATCH_BATCH = 200;

@Injectable()
export class DeadlineService {
  private readonly logger = new Logger('DeadlineEngine');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: MarketConfigService,
    private readonly audit: AuditService,
    @Inject(NOTIFICATION_ADAPTER) private readonly notifier: NotificationAdapter,
  ) {}

  /**
   * Recompute deadlines for a container from its charges (spec §1.5). For each
   * payee, the binding deadline is the earliest last-free-day among that payee's
   * charges. Idempotent: deadlines are upserted and pending alerts rescheduled;
   * already-sent alerts are never disturbed.
   */
  async recomputeForContainer(containerId: string): Promise<void> {
    const container = await this.prisma.container.findUnique({ where: { id: containerId } });
    if (!container) return;

    const charges = await this.prisma.charge.findMany({
      where: { containerId, lastFreeDay: { not: null } },
      select: { payeeOrgId: true, lastFreeDay: true },
    });

    // Earliest LFD per payee.
    const earliest = new Map<string, Date>();
    for (const c of charges) {
      const lfd = c.lastFreeDay as Date;
      const cur = earliest.get(c.payeeOrgId);
      if (!cur || lfd < cur) earliest.set(c.payeeOrgId, lfd);
    }

    const offsets = await this.config.alertOffsetsDays();
    const channels = (await this.config.alertChannels()).map((c) => CHANNEL_MAP[c]).filter(Boolean);
    const names = await this.orgNames([...earliest.keys()]);

    for (const [payeeOrgId, datetime] of earliest) {
      const deadline = await this.prisma.deadline.upsert({
        where: { containerId_payeeOrgId_type: { containerId, payeeOrgId, type: 'LAST_FREE_DAY' } },
        update: { datetime, alertSchedule: offsets },
        create: { containerId, payeeOrgId, type: 'LAST_FREE_DAY', datetime, alertSchedule: offsets },
      });
      await this.syncAlerts(deadline, container.importerOrgId, offsets, channels, names.get(payeeOrgId) ?? 'payee', container.containerNumber);
    }
  }

  /** Creates/reschedules the alert instances for a deadline (idempotent). */
  private async syncAlerts(
    deadline: Deadline,
    recipientOrgId: string,
    offsets: number[],
    channels: AlertChannel[],
    payeeName: string,
    containerNumber: string,
  ): Promise<void> {
    for (const offsetDays of offsets) {
      const scheduledFor = new Date(deadline.datetime.getTime() - offsetDays * 86_400_000);
      const message = this.alertMessage(containerNumber, payeeName, deadline.datetime, offsetDays);
      for (const channel of channels) {
        const existing = await this.prisma.deadlineAlert.findUnique({
          where: { deadlineId_channel_offsetDays: { deadlineId: deadline.id, channel, offsetDays } },
        });
        if (!existing) {
          await this.prisma.deadlineAlert.create({
            data: {
              deadlineId: deadline.id,
              containerId: deadline.containerId,
              recipientOrgId,
              channel,
              offsetDays,
              scheduledFor,
              message,
            },
          });
        } else if (existing.status === 'PENDING') {
          // Reschedule not-yet-sent alerts if the deadline moved.
          await this.prisma.deadlineAlert.update({
            where: { id: existing.id },
            data: { scheduledFor, message },
          });
        }
      }
    }
  }

  private alertMessage(containerNumber: string, payeeName: string, datetime: Date, offsetDays: number): string {
    const day = datetime.toISOString().slice(0, 10);
    const when = offsetDays === 0 ? 'is today' : `is in ${offsetDays} day(s)`;
    return `Last free day for container ${containerNumber} (${payeeName}) ${when} — ${day}. Settle charges to avoid storage/demurrage.`;
  }

  /**
   * Deliver all due alerts (spec §1.5). Idempotent and reliable: only advances
   * PENDING/FAILED whose scheduledFor has passed; a missed run just sends late.
   */
  async dispatchDue(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
    const due = await this.prisma.deadlineAlert.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] }, scheduledFor: { lte: now } },
      orderBy: { scheduledFor: 'asc' },
      take: DISPATCH_BATCH,
    });

    let sent = 0;
    let failed = 0;
    for (const alert of due) {
      if (alert.channel === 'IN_APP') {
        await this.prisma.deadlineAlert.update({
          where: { id: alert.id },
          data: { status: 'SENT', sentAt: now, attempts: { increment: 1 } },
        });
        sent++;
        continue;
      }
      const to = await this.resolveRecipient(alert.recipientOrgId, alert.channel);
      const res = await this.notifier.send({
        channel: alert.channel === 'EMAIL' ? 'EMAIL' : 'SMS',
        to,
        subject: 'Rezo — deadline reminder',
        body: alert.message,
      });
      await this.prisma.deadlineAlert.update({
        where: { id: alert.id },
        data: res.ok
          ? { status: 'SENT', sentAt: now, attempts: { increment: 1 } }
          : { status: 'FAILED', attempts: { increment: 1 } },
      });
      res.ok ? sent++ : failed++;
    }

    if (sent > 0 || failed > 0) {
      await this.audit.record({
        action: 'deadline.alerts_dispatched',
        entity: 'DeadlineAlert',
        after: { sent, failed },
      });
      this.logger.log(`Dispatched alerts: ${sent} sent, ${failed} failed.`);
    }
    return { sent, failed };
  }

  /** Automatic dispatch tick (spec §1.5: alerts fire at their scheduled time). */
  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchTick(): Promise<void> {
    try {
      await this.dispatchDue();
    } catch (e) {
      this.logger.error(`Alert dispatch tick failed: ${(e as Error).message}`);
    }
  }

  async listDeadlinesForContainer(containerId: string): Promise<DeadlineSummary[]> {
    const rows = await this.prisma.deadline.findMany({
      where: { containerId },
      orderBy: { datetime: 'asc' },
    });
    const names = await this.orgNames(rows.map((r) => r.payeeOrgId));
    return rows.map((d) => toDeadlineSummary(d, names.get(d.payeeOrgId) ?? 'payee'));
  }

  async listAlerts(principal: AuthPrincipal, status: string | undefined, limit: number): Promise<AlertSummary[]> {
    const crossTenant = principal.permissions.includes('tenant:read_all' as never);
    const rows = await this.prisma.deadlineAlert.findMany({
      where: {
        ...(crossTenant ? {} : { recipientOrgId: principal.orgId }),
        ...(status ? { status: status.toUpperCase() as never } : {}),
      },
      include: { deadline: true, container: { select: { containerNumber: true } } },
      orderBy: { scheduledFor: 'desc' },
      take: limit,
    });
    return rows.map(toAlertSummary);
  }

  async markRead(principal: AuthPrincipal, id: string): Promise<AlertSummary> {
    const alert = await this.prisma.deadlineAlert.findUnique({ where: { id } });
    const crossTenant = principal.permissions.includes('tenant:read_all' as never);
    if (!alert || (!crossTenant && alert.recipientOrgId !== principal.orgId)) {
      throw new NotFoundException('Alert not found.');
    }
    await this.prisma.deadlineAlert.update({ where: { id }, data: { readAt: new Date() } });
    const row = await this.prisma.deadlineAlert.findUniqueOrThrow({
      where: { id },
      include: { deadline: true, container: { select: { containerNumber: true } } },
    });
    return toAlertSummary(row);
  }

  private async resolveRecipient(orgId: string, channel: AlertChannel): Promise<string> {
    const user = await this.prisma.user.findFirst({ where: { orgId, status: 'ACTIVE' } });
    if (channel === 'EMAIL') return user?.email ?? `alerts+${orgId}@rezo.test`;
    return '+50900000000'; // no phone stored in the beta; mock ignores it
  }

  private async orgNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: ids } },
      select: { id: true, legalName: true },
    });
    return new Map(orgs.map((o) => [o.id, o.legalName]));
  }
}
