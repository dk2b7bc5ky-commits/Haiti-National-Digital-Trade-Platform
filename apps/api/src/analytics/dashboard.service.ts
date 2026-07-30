import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { resolveContainerScope } from '../data-hub/scoping';
import { chargeTypeToApi } from '../charges/mappers';
import { containerStatusToApi } from '../data-hub/mappers';
import type {
  OperationalDashboard,
  GovernmentDashboard,
  FeeTypeRevenue,
  Money,
  ContainerStatus as ApiContainerStatus,
} from '@rezo/shared-types';

const DAY_MS = 86_400_000;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Operational read-model (spec §2.6). Platform-wide for Rezo/gov/customs;
   * scoped to the caller's containers otherwise (so an importer/broker sees
   * their own operational picture).
   */
  async operational(principal: AuthPrincipal): Promise<OperationalDashboard> {
    const crossTenant = principal.permissions.includes(Permission.TENANT_READ_ALL);
    const containerWhere = crossTenant ? {} : await resolveContainerScope(this.prisma, principal);
    const containers = await this.prisma.container.findMany({
      where: containerWhere,
      select: { id: true, status: true, arrivalDate: true, releasedAt: true },
    });
    const ids = containers.map((c) => c.id);
    const chargeScope: Prisma.ChargeWhereInput = crossTenant ? {} : { containerId: { in: ids } };

    const byStatus: Record<ApiContainerStatus, number> = { arrived: 0, cleared: 0, released: 0, gated_out: 0 };
    for (const c of containers) byStatus[containerStatusToApi(c.status)]++;

    // Average arrival→release time in days (real clearances only; demo data may
    // carry future-dated ETAs, which would otherwise skew this negative).
    const releasedTimes = containers
      .filter((c) => c.releasedAt && c.arrivalDate)
      .map((c) => (c.releasedAt!.getTime() - c.arrivalDate!.getTime()) / DAY_MS)
      .filter((d) => d >= 0);
    const avgClearance = releasedTimes.length
      ? Math.round((releasedTimes.reduce((s, d) => s + d, 0) / releasedTimes.length) * 10) / 10
      : null;

    // Revenue by fee type = PAID charges grouped by type + currency.
    const grouped = await this.prisma.charge.groupBy({
      by: ['type', 'currency'],
      where: { status: 'PAID', ...chargeScope },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const revenueByFeeType: FeeTypeRevenue[] = grouped.map((g) => ({
      type: chargeTypeToApi(g.type),
      currency: g.currency,
      amount: g._sum.amount ?? 0,
      count: g._count._all,
    }));

    // Payments processed + amount routed (settled routings).
    const requestScope: Prisma.PaymentRequestWhereInput = crossTenant ? {} : { containerId: { in: ids } };
    const paymentsProcessed = await this.prisma.paymentRequest.count({
      where: { status: { in: ['SETTLED', 'PARTIALLY_SETTLED'] }, ...requestScope },
    });
    const settledRoutings = await this.prisma.paymentRouting.findMany({
      where: { status: 'SETTLED', request: requestScope },
      select: { settlementAmount: true, isRezoFee: true, request: { select: { settlementCurrency: true } } },
    });
    const amountProcessed = this.sumMoney(settledRoutings.map((r) => ({ amount: r.settlementAmount, currency: r.request.settlementCurrency })));
    const rezoFeeRevenue = this.sumMoney(
      settledRoutings.filter((r) => r.isRezoFee).map((r) => ({ amount: r.settlementAmount, currency: r.request.settlementCurrency })),
    );

    // Deadlines at risk: within 7 days, on a container not yet gated out.
    const soon = new Date(Date.now() + 7 * DAY_MS);
    const deadlinesAtRisk = await this.prisma.deadline.count({
      where: {
        datetime: { lte: soon },
        container: { status: { not: 'GATED_OUT' }, ...(crossTenant ? {} : { id: { in: ids } }) },
      },
    });

    return {
      containers_total: containers.length,
      by_status: byStatus,
      released: byStatus.released + byStatus.gated_out,
      gated_out: byStatus.gated_out,
      avg_clearance_days: avgClearance,
      payments_processed: paymentsProcessed,
      amount_processed: amountProcessed,
      revenue_by_fee_type: revenueByFeeType,
      rezo_fee_revenue: rezoFeeRevenue,
      deadlines_at_risk: deadlinesAtRisk,
    };
  }

  /** Government read-only view (spec §2.6): daily counts, collections, congestion. */
  async government(): Promise<GovernmentDashboard> {
    const containers = await this.prisma.container.findMany({ select: { status: true, createdAt: true } });

    // Arrivals per day for the last 7 days.
    const buckets = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
      buckets.set(d, 0);
    }
    for (const c of containers) {
      const d = c.createdAt.toISOString().slice(0, 10);
      if (buckets.has(d)) buckets.set(d, (buckets.get(d) ?? 0) + 1);
    }
    const arrivalsByDay = [...buckets.entries()].map(([date, count]) => ({ date, count }));

    // Collections routed to payees (settled) + customs-specific collections.
    const settled = await this.prisma.paymentRouting.findMany({
      where: { status: 'SETTLED' },
      select: { settlementAmount: true, request: { select: { settlementCurrency: true } } },
    });
    const collections = this.sumMoney(settled.map((r) => ({ amount: r.settlementAmount, currency: r.request.settlementCurrency })));

    const customsPaid = await this.prisma.charge.groupBy({
      by: ['currency'],
      where: { status: 'PAID', type: { in: ['CUSTOMS_DUTY', 'CUSTOMS_FEE'] } },
      _sum: { amount: true },
    });
    const customsCollections = customsPaid.map((g) => ({ amount: g._sum.amount ?? 0, currency: g.currency }));

    const congestion = containers.filter((c) => c.status !== 'GATED_OUT').length;

    return {
      containers_total: containers.length,
      arrivals_by_day: arrivalsByDay,
      collections,
      customs_collections: customsCollections,
      congestion_in_port: congestion,
    };
  }

  private sumMoney(items: Money[]): Money[] {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.currency, (m.get(it.currency) ?? 0) + it.amount);
    return [...m.entries()].map(([currency, amount]) => ({ amount, currency }));
  }
}
