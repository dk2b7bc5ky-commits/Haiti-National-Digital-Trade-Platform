import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Charge, PaymentRequest, PaymentRouting, PaymentRoutingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MarketConfigService } from '../config/market-config.service';
import { PayeesService } from '../payees/payees.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { resolveContainerScope } from '../data-hub/scoping';
import { PAYMENT_RAIL, PaymentRail, RailOutcome } from '../integration/payment-rail';
import { FxService } from './fx.service';
import { toRoutingSummary, reqStatusToApi } from './mappers';
import { CreatePaymentRequestDto } from './dto';
import type { PaymentRequestSummary } from '@rezo/shared-types';

// Charge statuses eligible to be put into a (new) payment request.
const REQUESTABLE = ['PENDING', 'OVERDUE'];

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: MarketConfigService,
    private readonly payees: PayeesService,
    private readonly fx: FxService,
    @Inject(PAYMENT_RAIL) private readonly rail: PaymentRail,
  ) {}

  /**
   * Create an aggregated payment request across a container's charges
   * (spec §2.1, Flow C). Idempotent on the client-supplied key: a repeat key
   * returns the EXISTING request unchanged — never a second request, never a
   * double route. FX is previewed here and frozen at authorization.
   */
  async create(
    principal: AuthPrincipal,
    idempotencyKey: string | undefined,
    dto: CreatePaymentRequestDto,
  ): Promise<PaymentRequestSummary> {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required.');

    const existing = await this.prisma.paymentRequest.findUnique({ where: { idempotencyKey } });
    if (existing) return this.summary(existing.id); // idempotent replay

    const container = await this.prisma.container.findFirst({
      where: { id: dto.container_id, ...(await resolveContainerScope(this.prisma, principal)) },
    });
    if (!container) throw new NotFoundException('Container not found.');

    const charges = await this.prisma.charge.findMany({
      where: { id: { in: dto.charge_ids }, containerId: container.id },
      include: { payeeOrg: { select: { id: true, type: true, legalName: true } } },
    });
    if (charges.length !== dto.charge_ids.length) {
      throw new BadRequestException('One or more charges do not belong to this container.');
    }
    for (const c of charges) {
      if (!REQUESTABLE.includes(c.status)) {
        throw new BadRequestException(`Charge ${c.id} is not payable (status ${c.status}).`);
      }
      if (c.reviewState === 'PENDING') {
        throw new BadRequestException(`Charge ${c.id} is pending review and cannot be paid yet.`);
      }
      if (c.payeeOrg.type === 'REZO') {
        throw new BadRequestException('A charge may not be payable to Rezo.');
      }
    }

    const settlementCurrency = dto.settlement_currency.toUpperCase();

    // Aggregate charges into one routing per (payee, charge currency).
    const groups = new Map<string, { payeeOrgId: string; currency: string; amount: number }>();
    for (const c of charges) {
      const key = `${c.payeeOrgId}:${c.currency}`;
      const g = groups.get(key) ?? { payeeOrgId: c.payeeOrgId, currency: c.currency, amount: 0 };
      g.amount += c.amount;
      groups.set(key, g);
    }

    const routingsData: Prisma.PaymentRoutingCreateManyRequestInput[] = [];
    for (const g of groups.values()) {
      const rate = await this.fx.rate(g.currency, settlementCurrency);
      routingsData.push({
        payeeOrgId: g.payeeOrgId,
        chargeCurrency: g.currency,
        chargeAmount: g.amount,
        fxRate: rate,
        settlementAmount: this.fx.convert(g.amount, rate),
        rail: 'bank',
        isRezoFee: false,
      });
    }

    // Rezo's own fee as an explicit line — the ONLY routing allowed to pay Rezo.
    const rezoFeeRouting = await this.buildRezoFeeRouting(settlementCurrency);
    routingsData.push(rezoFeeRouting);

    const gross = routingsData.reduce((s, r) => s + r.settlementAmount, 0);

    const request = await this.prisma.paymentRequest.create({
      data: {
        idempotencyKey,
        containerId: container.id,
        importerOrgId: container.importerOrgId,
        settlementCurrency,
        grossAmountSettlement: gross,
        rezoFee: rezoFeeRouting.settlementAmount,
        createdByUserId: principal.userId,
        routings: { createMany: { data: routingsData } },
        charges: { connect: charges.map((c) => ({ id: c.id })) },
      },
    });
    // Mark covered charges as requested (in-flight) so they can't double-request.
    await this.prisma.charge.updateMany({
      where: { id: { in: charges.map((c) => c.id) } },
      data: { status: 'REQUESTED' },
    });

    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'payment.create',
      entity: 'PaymentRequest',
      entityId: request.id,
      after: { gross_amount_settlement: gross, settlement_currency: settlementCurrency, charges: charges.length },
    });

    return this.summary(request.id);
  }

  /**
   * Importer authorizes once (spec Flow C). Freezes the FX rate onto each
   * routing, then routes each portion DIRECTLY to its payee via the rail.
   * Applies the partial-failure policy: settled routings' charges are paid,
   * failed routings' charges return to payable (retryable), successful routings
   * are NEVER reversed. Rezo holds nothing at any step.
   */
  async authorize(
    principal: AuthPrincipal,
    id: string,
    simulate?: Record<string, RailOutcome>,
  ): Promise<PaymentRequestSummary> {
    const request = await this.prisma.paymentRequest.findUnique({
      where: { id },
      include: { routings: true, charges: true },
    });
    if (!request) throw new NotFoundException('Payment request not found.');
    await this.assertVisible(principal, request.containerId);

    // Idempotent: only a freshly-created request routes; otherwise return as-is.
    if (request.status !== 'CREATED') return this.summary(id);

    // Freeze FX at authorization.
    let gross = 0;
    let rezoFee = 0;
    for (const r of request.routings) {
      const rate = await this.fx.rate(r.chargeCurrency, request.settlementCurrency);
      const settlementAmount = this.fx.convert(r.chargeAmount, rate);
      await this.prisma.paymentRouting.update({ where: { id: r.id }, data: { fxRate: rate, settlementAmount } });
      r.fxRate = rate;
      r.settlementAmount = settlementAmount;
      gross += settlementAmount;
      if (r.isRezoFee) rezoFee = settlementAmount;
    }
    await this.prisma.paymentRequest.update({
      where: { id },
      data: { status: 'ROUTING', authorizedAt: new Date(), grossAmountSettlement: gross, rezoFee },
    });

    // Route each portion directly to the payee.
    const payeeRefs = await this.payeeSettlementRefs(request.routings.map((r) => r.payeeOrgId));
    for (const r of request.routings) {
      const outcome: RailOutcome | undefined = simulate?.[r.payeeOrgId];
      const res = await this.rail.pay({
        idempotencyToken: r.id,
        rail: r.rail,
        payeeSettlementRef: payeeRefs.get(r.payeeOrgId) ?? `stlm_${r.payeeOrgId}`,
        amount: r.settlementAmount,
        currency: request.settlementCurrency,
        simulate: outcome,
      });
      await this.prisma.paymentRouting.update({
        where: { id: r.id },
        data: { status: res.status.toUpperCase() as PaymentRoutingStatus, railTxnRef: res.txnRef },
      });
      r.status = res.status.toUpperCase() as PaymentRoutingStatus;
    }

    await this.applyRoutingOutcomes(request, request.routings, request.charges);
    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'payment.authorize',
      entity: 'PaymentRequest',
      entityId: id,
      after: { routings: request.routings.map((r) => ({ payee: r.payeeOrgId, status: r.status })) },
    });

    return this.summary(id);
  }

  async get(principal: AuthPrincipal, id: string): Promise<PaymentRequestSummary> {
    const request = await this.prisma.paymentRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Payment request not found.');
    await this.assertVisible(principal, request.containerId);
    return this.summary(id);
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Partial-failure policy (spec §2.1). Per payee routing: settled → its charges
   * PAID; failed → its charges back to PENDING (retryable); pending → charges
   * stay REQUESTED and the request stays ROUTING for reconciliation. Never mark
   * a charge paid without a confirmed rail settlement, never reverse a success.
   */
  private async applyRoutingOutcomes(
    request: PaymentRequest,
    routings: PaymentRouting[],
    charges: Charge[],
  ): Promise<void> {
    for (const r of routings) {
      if (r.isRezoFee) continue; // fee line maps to no charge
      const payeeChargeIds = charges.filter((c) => c.payeeOrgId === r.payeeOrgId).map((c) => c.id);
      if (payeeChargeIds.length === 0) continue;
      if (r.status === 'SETTLED') {
        await this.prisma.charge.updateMany({ where: { id: { in: payeeChargeIds } }, data: { status: 'PAID' } });
      } else if (r.status === 'FAILED') {
        await this.prisma.charge.updateMany({ where: { id: { in: payeeChargeIds } }, data: { status: 'PENDING' } });
      } // PENDING routing → leave charges REQUESTED
    }

    // Overall request state considers every routing (incl. the fee line).
    const anyPending = routings.some((r) => r.status === 'PENDING');
    const anySettled = routings.some((r) => r.status === 'SETTLED');
    const anyFailed = routings.some((r) => r.status === 'FAILED');

    let status: PaymentRequest['status'];
    let settledAt: Date | null = null;
    if (anyPending) {
      status = 'ROUTING'; // reconcile the pending ones later
    } else if (anySettled && anyFailed) {
      status = 'PARTIALLY_SETTLED';
    } else if (anySettled && !anyFailed) {
      status = 'SETTLED';
      settledAt = new Date();
    } else {
      status = 'FAILED';
    }
    await this.prisma.paymentRequest.update({ where: { id: request.id }, data: { status, settledAt } });
  }

  private async buildRezoFeeRouting(settlementCurrency: string): Promise<Prisma.PaymentRoutingCreateManyRequestInput> {
    const tariff = await this.config.getTariff();
    const rezoPayee = await this.payees.resolveByType('REZO');
    if (!rezoPayee) throw new BadRequestException('No Rezo fee payee configured.');
    const rate = await this.fx.rate(tariff.currency, settlementCurrency);
    return {
      payeeOrgId: rezoPayee.orgId,
      chargeCurrency: tariff.currency,
      chargeAmount: tariff.rezo_fee.flat,
      fxRate: rate,
      settlementAmount: this.fx.convert(tariff.rezo_fee.flat, rate),
      rail: 'card',
      isRezoFee: true,
    };
  }

  private async assertVisible(principal: AuthPrincipal, containerId: string): Promise<void> {
    const container = await this.prisma.container.findFirst({
      where: { id: containerId, ...(await resolveContainerScope(this.prisma, principal)) },
    });
    if (!container) throw new ForbiddenException('Not permitted for this container.');
  }

  private async payeeSettlementRefs(orgIds: string[]): Promise<Map<string, string>> {
    const payees = await this.prisma.payee.findMany({ where: { orgId: { in: orgIds } } });
    return new Map(payees.map((p) => [p.orgId, p.settlementRef]));
  }

  private async summary(id: string): Promise<PaymentRequestSummary> {
    const request = await this.prisma.paymentRequest.findUniqueOrThrow({
      where: { id },
      include: { routings: true, charges: { select: { id: true, status: true } } },
    });
    const orgIds = request.routings.map((r) => r.payeeOrgId);
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, legalName: true },
    });
    const names = new Map(orgs.map((o) => [o.id, o.legalName]));

    const coveredChargeIds = request.charges.map((c) => c.id);
    const failedChargeIds = request.charges.filter((c) => c.status === 'PENDING' || c.status === 'OVERDUE').map((c) => c.id);

    // Release eligibility: every charge on the container is paid (spec §2.5).
    const outstanding = await this.prisma.charge.count({
      where: { containerId: request.containerId, status: { in: ['PENDING', 'OVERDUE', 'REQUESTED', 'PENDING_REVIEW'] } },
    });
    const total = await this.prisma.charge.count({ where: { containerId: request.containerId } });

    return {
      id: request.id,
      container_id: request.containerId,
      importer_org_id: request.importerOrgId,
      settlement_currency: request.settlementCurrency,
      gross_amount_settlement: request.grossAmountSettlement,
      rezo_fee: request.rezoFee,
      status: reqStatusToApi(request.status),
      created_at: request.createdAt.toISOString(),
      authorized_at: request.authorizedAt?.toISOString() ?? null,
      settled_at: request.settledAt?.toISOString() ?? null,
      routings: request.routings.map((r) => toRoutingSummary(r, names.get(r.payeeOrgId) ?? 'payee')),
      covered_charge_ids: coveredChargeIds,
      failed_charge_ids: failedChargeIds,
      release_eligible: total > 0 && outstanding === 0,
    };
  }
}
