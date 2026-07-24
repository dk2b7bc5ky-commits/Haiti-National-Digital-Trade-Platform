import { Inject, Injectable, Logger } from '@nestjs/common';
import { AlertChannel, NotificationSeverity, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { NOTIFICATION_ADAPTER, NotificationAdapter } from '../integration/notification-adapter';
import type { NotificationPreferences, NotificationSummary } from '@rezo/shared-types';

/** Input to fire a notification for every (eligible) user of an org. */
export interface NotifyInput {
  type: NotificationType;
  severity: NotificationSeverity;
  orgId: string;
  containerId?: string | null;
  title: string;
  body: string;
  amountAtRisk?: { amount: number; currency: string } | null;
  deepLink?: string | null;
}

export const ALL_NOTIFICATION_TYPES: NotificationType[] = [
  'DEADLINE_REMINDER', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'CONTAINER_RELEASED',
  'GATE_APPOINTMENT_CONFIRMED', 'GATE_REMINDER', 'VERIFICATION_NEEDED', 'CHARGE_ADDED',
  'DOCUMENT_REQUIRED', 'TRUCKING_JOB_OFFERED', 'TRUCKING_JOB_ACCEPTED', 'TRUCKING_JOB_DELIVERED',
];

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION_ADAPTER) private readonly notifier: NotificationAdapter,
  ) {}

  /**
   * Fire a notification to every user of `orgId`, honoring each user's per-type
   * channel preferences and quiet hours (spec §6b/§6e). One row per user; the
   * row's channel records whether it was also emailed. Never throws — a
   * notification failure must not break the action that triggered it.
   */
  async notify(input: NotifyInput): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({ where: { orgId: input.orgId, status: 'ACTIVE' } });
      for (const user of users) {
        const pref = await this.prisma.notificationPreference.findUnique({
          where: { userId_type: { userId: user.id, type: input.type } },
        });
        const inApp = pref?.inApp ?? true;
        const emailPref = pref?.email ?? false;
        if (!inApp && !emailPref) continue; // user turned this type off entirely

        const emailed = emailPref && !this.inQuietHours(user);
        const channel: AlertChannel = emailed ? 'EMAIL' : 'IN_APP';

        await this.prisma.notification.create({
          data: {
            type: input.type,
            severity: input.severity,
            recipientOrgId: input.orgId,
            recipientUserId: user.id,
            containerId: input.containerId ?? null,
            title: input.title,
            body: input.body,
            amountAtRisk: input.amountAtRisk?.amount ?? null,
            amountCurrency: input.amountAtRisk?.currency ?? null,
            channel,
            deepLink: input.deepLink ?? null,
          },
        });

        if (emailed) {
          await this.notifier.send({ channel: 'EMAIL', to: user.email, subject: input.title, body: input.body });
        }
      }
    } catch (e) {
      this.logger.warn(`notify(${input.type}) failed: ${(e as Error).message}`);
    }
  }

  /** The caller's own feed (spec §6c/§6d). Optional container/type filters. */
  async list(
    principal: AuthPrincipal,
    opts: { containerId?: string; type?: string; unreadOnly?: boolean; limit: number },
  ): Promise<NotificationSummary[]> {
    if (!principal.userId) return [];
    const where: Prisma.NotificationWhereInput = { recipientUserId: principal.userId };
    if (opts.containerId) where.containerId = opts.containerId;
    if (opts.type) where.type = opts.type.toUpperCase() as NotificationType;
    if (opts.unreadOnly) where.readAt = null;

    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: opts.limit,
    });
    const numbers = await this.containerNumbers(rows.map((r) => r.containerId));
    return rows.map((r) => this.toSummary(r, r.containerId ? numbers.get(r.containerId) ?? null : null));
  }

  async unreadCount(principal: AuthPrincipal): Promise<number> {
    if (!principal.userId) return 0;
    return this.prisma.notification.count({ where: { recipientUserId: principal.userId, readAt: null } });
  }

  async markRead(principal: AuthPrincipal, id: string): Promise<void> {
    if (!principal.userId) return;
    await this.prisma.notification.updateMany({
      where: { id, recipientUserId: principal.userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(principal: AuthPrincipal): Promise<{ marked: number }> {
    if (!principal.userId) return { marked: 0 };
    const res = await this.prisma.notification.updateMany({
      where: { recipientUserId: principal.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: res.count };
  }

  async getPreferences(principal: AuthPrincipal): Promise<NotificationPreferences> {
    const empty: NotificationPreferences = {
      preferences: ALL_NOTIFICATION_TYPES.map((t) => ({ type: t.toLowerCase() as never, in_app: true, email: false })),
      quiet_hours: { start: null, end: null },
    };
    if (!principal.userId) return empty;

    const [user, prefs] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: principal.userId } }),
      this.prisma.notificationPreference.findMany({ where: { userId: principal.userId } }),
    ]);
    const byType = new Map(prefs.map((p) => [p.type, p]));
    return {
      preferences: ALL_NOTIFICATION_TYPES.map((t) => {
        const p = byType.get(t);
        return { type: t.toLowerCase() as never, in_app: p?.inApp ?? true, email: p?.email ?? false };
      }),
      quiet_hours: { start: user?.notifyQuietStart ?? null, end: user?.notifyQuietEnd ?? null },
    };
  }

  async setPreferences(
    principal: AuthPrincipal,
    dto: { preferences?: { type: string; in_app: boolean; email: boolean }[]; quiet_start?: number | null; quiet_end?: number | null },
  ): Promise<NotificationPreferences> {
    if (!principal.userId) return this.getPreferences(principal);
    for (const p of dto.preferences ?? []) {
      const type = p.type.toUpperCase() as NotificationType;
      await this.prisma.notificationPreference.upsert({
        where: { userId_type: { userId: principal.userId, type } },
        update: { inApp: p.in_app, email: p.email },
        create: { userId: principal.userId, type, inApp: p.in_app, email: p.email },
      });
    }
    if (dto.quiet_start !== undefined || dto.quiet_end !== undefined) {
      await this.prisma.user.update({
        where: { id: principal.userId },
        data: { notifyQuietStart: dto.quiet_start ?? null, notifyQuietEnd: dto.quiet_end ?? null },
      });
    }
    return this.getPreferences(principal);
  }

  private inQuietHours(u: { notifyQuietStart: number | null; notifyQuietEnd: number | null }): boolean {
    const s = u.notifyQuietStart;
    const e = u.notifyQuietEnd;
    if (s == null || e == null) return false;
    const h = new Date().getUTCHours();
    return s <= e ? h >= s && h < e : h >= s || h < e;
  }

  private toSummary(r: Prisma.NotificationGetPayload<object>, containerNumber: string | null): NotificationSummary {
    return {
      id: r.id,
      type: r.type.toLowerCase() as never,
      severity: r.severity.toLowerCase() as never,
      container_id: r.containerId,
      container_number: containerNumber,
      title: r.title,
      body: r.body,
      amount_at_risk: r.amountAtRisk != null && r.amountCurrency ? { amount: r.amountAtRisk, currency: r.amountCurrency } : null,
      channel: r.channel.toLowerCase() as never,
      deep_link: r.deepLink,
      read_at: r.readAt ? r.readAt.toISOString() : null,
      created_at: r.createdAt.toISOString(),
    };
  }

  private async containerNumbers(ids: (string | null)[]): Promise<Map<string, string>> {
    const clean = [...new Set(ids.filter((x): x is string => !!x))];
    if (clean.length === 0) return new Map();
    const rows = await this.prisma.container.findMany({ where: { id: { in: clean } }, select: { id: true, containerNumber: true } });
    return new Map(rows.map((r) => [r.id, r.containerNumber]));
  }
}
