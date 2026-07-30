import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Organization, Subscription, SubscriptionPlan, SubscriptionTerm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MarketConfigService } from '../config/market-config.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { CreateSubscriptionDto } from './subscriptions.dto';
import type { SubscriptionSummary, PlanPrice, BillingSummary, Money, SubscriptionPlan as ApiPlan } from '@rezo/shared-types';

function addTerm(from: Date, term: SubscriptionTerm): Date {
  const d = new Date(from);
  if (term === 'MONTHLY') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: MarketConfigService,
  ) {}

  private toSummary(s: Subscription & { org?: Pick<Organization, 'legalName'> }): SubscriptionSummary {
    return {
      id: s.id,
      org_id: s.orgId,
      org_name: s.org?.legalName ?? '',
      plan: s.plan.toLowerCase() as ApiPlan,
      term: s.term.toLowerCase() as SubscriptionSummary['term'],
      price: s.price,
      currency: s.currency,
      status: s.status.toLowerCase() as SubscriptionSummary['status'],
      started_at: s.startedAt.toISOString(),
      renewal_date: s.renewalDate.toISOString(),
      cancelled_at: s.cancelledAt?.toISOString() ?? null,
    };
  }

  /** Plan catalogue with prices (spec §2.2) — straight from config. */
  async plans(): Promise<PlanPrice[]> {
    const plans = await this.config.subscriptionPlans();
    const tariff = await this.config.getTariff();
    return Object.entries(plans).map(([plan, p]) => ({
      plan: plan as ApiPlan,
      currency: tariff.currency,
      monthly: p.monthly,
      annual: p.annual,
    }));
  }

  async list(principal: AuthPrincipal): Promise<SubscriptionSummary[]> {
    const crossTenant = principal.permissions.includes(Permission.TENANT_READ_ALL);
    const rows = await this.prisma.subscription.findMany({
      where: crossTenant ? {} : { orgId: principal.orgId },
      include: { org: { select: { legalName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((s) => this.toSummary(s));
  }

  async create(principal: AuthPrincipal, dto: CreateSubscriptionDto): Promise<SubscriptionSummary> {
    const org = await this.prisma.organization.findUnique({ where: { id: dto.org_id } });
    if (!org) throw new NotFoundException('Organization not found.');

    const planEnum = dto.plan.toUpperCase() as SubscriptionPlan;
    const termEnum = dto.term.toUpperCase() as SubscriptionTerm;
    const price = await this.config.subscriptionPrice(dto.plan, dto.term); // from config
    const now = new Date();

    const sub = await this.prisma.subscription.create({
      data: {
        orgId: dto.org_id,
        plan: planEnum,
        term: termEnum,
        price: price.amount,
        currency: price.currency,
        startedAt: now,
        renewalDate: addTerm(now, termEnum),
      },
      include: { org: { select: { legalName: true } } },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'subscription.create',
      entity: 'Subscription',
      entityId: sub.id,
      after: { org_id: sub.orgId, plan: sub.plan, term: sub.term, price: sub.price },
    });
    return this.toSummary(sub);
  }

  async renew(principal: AuthPrincipal, id: string): Promise<SubscriptionSummary> {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription not found.');
    if (sub.status === 'CANCELLED') throw new BadRequestException('Cannot renew a cancelled subscription.');

    // Re-read the price from config (rates may have changed) and extend the term.
    const price = await this.config.subscriptionPrice(sub.plan.toLowerCase(), sub.term.toLowerCase() as 'monthly' | 'annual');
    const base = sub.renewalDate > new Date() ? sub.renewalDate : new Date();
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: { status: 'ACTIVE', price: price.amount, currency: price.currency, renewalDate: addTerm(base, sub.term) },
      include: { org: { select: { legalName: true } } },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'subscription.renew',
      entity: 'Subscription',
      entityId: id,
      after: { renewal_date: updated.renewalDate.toISOString() },
    });
    return this.toSummary(updated);
  }

  async cancel(principal: AuthPrincipal, id: string): Promise<SubscriptionSummary> {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription not found.');
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      include: { org: { select: { legalName: true } } },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'subscription.cancel',
      entity: 'Subscription',
      entityId: id,
    });
    return this.toSummary(updated);
  }

  /** Billing rollup: Rezo fee collected + subscription MRR (spec §2.2/§2.6 seed). */
  async summary(): Promise<BillingSummary> {
    const settledFees = await this.prisma.paymentRouting.findMany({
      where: { isRezoFee: true, status: 'SETTLED' },
      include: { request: { select: { settlementCurrency: true } } },
    });
    const feeByCurrency = new Map<string, number>();
    for (const r of settledFees) {
      const cur = r.request.settlementCurrency;
      feeByCurrency.set(cur, (feeByCurrency.get(cur) ?? 0) + r.settlementAmount);
    }
    const rezoFeeCollected: Money[] = [...feeByCurrency.entries()].map(([currency, amount]) => ({ amount, currency }));

    const active = await this.prisma.subscription.findMany({ where: { status: 'ACTIVE' } });
    let mrr = 0;
    let currency = (await this.config.getTariff()).currency;
    for (const s of active) {
      mrr += s.term === 'ANNUAL' ? Math.round(s.price / 12) : s.price;
      currency = s.currency;
    }
    return {
      rezo_fee_collected: rezoFeeCollected,
      active_subscriptions: active.length,
      subscription_mrr: { amount: mrr, currency },
    };
  }
}
