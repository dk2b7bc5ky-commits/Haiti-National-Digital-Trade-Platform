import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChargeType, Container } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MarketConfigService } from '../config/market-config.service';
import { PayeesService, payeeTypeForCharge } from '../payees/payees.service';
import { DeadlineService } from '../deadlines/deadline.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { resolveContainerScope } from '../data-hub/scoping';
import { TERMINAL_ADAPTER, TerminalAdapter } from '../integration/terminal-adapter';
import { NotificationsService } from '../notifications/notifications.service';
import { toChargeSummary, apiToChargeType } from './mappers';
import { CreateChargeDto } from './dto';
import type { ChargeSummary } from '@rezo/shared-types';

const chargeWithPayee = { payeeOrg: { select: { id: true, legalName: true } } } as const;

@Injectable()
export class ChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: MarketConfigService,
    private readonly payees: PayeesService,
    private readonly deadlines: DeadlineService,
    private readonly notifications: NotificationsService,
    @Inject(TERMINAL_ADAPTER) private readonly terminal: TerminalAdapter,
  ) {}

  /** Loads a container the caller is allowed to see, or throws 404. */
  private async requireVisibleContainer(principal: AuthPrincipal, containerId: string): Promise<Container> {
    const container = await this.prisma.container.findFirst({
      where: { id: containerId, ...(await resolveContainerScope(this.prisma, principal)) },
    });
    if (!container) throw new NotFoundException('Container not found.');
    return container;
  }

  async listForContainer(principal: AuthPrincipal, containerId: string): Promise<ChargeSummary[]> {
    await this.requireVisibleContainer(principal, containerId);
    const rows = await this.prisma.charge.findMany({
      where: { containerId },
      include: chargeWithPayee,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toChargeSummary);
  }

  /** Manually record a charge (spec §1.2: admin/terminal can create records). */
  async createManual(principal: AuthPrincipal, containerId: string, dto: CreateChargeDto): Promise<ChargeSummary> {
    const container = await this.requireVisibleContainer(principal, containerId);

    const type = apiToChargeType(dto.type);
    if (!type) throw new BadRequestException('Unknown charge type.');

    const payeeOrgId = await this.resolvePayeeOrgId(type, dto.payee_org_id);
    const currency = dto.currency ?? (await this.config.getMarket()).baseCurrency;

    const charge = await this.prisma.charge.create({
      data: {
        containerId,
        payeeOrgId,
        type,
        amount: dto.amount,
        currency,
        dueDate: dto.due_date ? new Date(dto.due_date) : null,
        lastFreeDay: dto.last_free_day ? new Date(dto.last_free_day) : null,
        status: 'PENDING',
        source: 'MANUAL',
      },
      include: chargeWithPayee,
    });
    await this.auditCharge(principal, charge.id, 'charge.create_manual', charge.type, charge.amount, charge.currency);
    await this.deadlines.recomputeForContainer(containerId); // spec §1.5: recompute on new data
    await this.notifications.notify({
      type: 'CHARGE_ADDED', severity: 'INFO', orgId: container.importerOrgId, containerId,
      title: 'New charge added',
      body: `A ${dto.type.replace(/_/g, ' ')} charge was added to ${container.containerNumber}.`,
      amountAtRisk: { amount: charge.amount, currency: charge.currency },
      deepLink: `/dashboard/containers/${containerId}`,
    });
    return toChargeSummary(charge);
  }

  /**
   * Pull terminal-side charges via the (mock) TerminalAdapter and record them
   * (spec §1.6, build step 4). Idempotent: if the container already has
   * terminal-sourced charges, returns them without duplicating.
   */
  async syncTerminal(principal: AuthPrincipal, containerId: string): Promise<ChargeSummary[]> {
    // No real terminal system is connected in the beta, and the stand-in invents
    // amounts from the tariff. Writing those onto a real container produces
    // charges nobody is owed, on top of the real ones read from documents — so
    // refuse outright unless someone deliberately enables it for a demo.
    if (this.terminal.isMock && process.env.TERMINAL_SYNC_ENABLED !== 'true') {
      throw new BadRequestException(
        'No terminal system is connected, so terminal charges cannot be pulled. Charges come from the documents the agent reads.',
      );
    }
    const container = await this.requireVisibleContainer(principal, containerId);

    const existing = await this.prisma.charge.findMany({
      where: { containerId, source: 'OCTOPI' },
      include: chargeWithPayee,
    });
    if (existing.length > 0) return existing.map(toChargeSummary);

    const terminalOrgId = await this.resolveTerminalOrgId(principal, container);
    const info = await this.terminal.getContainerInfo({
      containerNumber: container.containerNumber,
      sizeType: container.sizeType,
      arrivalDate: container.arrivalDate,
      terminalOrgId,
    });

    const created = await this.prisma.$transaction(async (tx) => {
      if (!container.terminalOrgId) {
        await tx.container.update({ where: { id: container.id }, data: { terminalOrgId } });
      }
      const rows = [];
      for (const line of info.charges) {
        const type = apiToChargeType(line.type.toLowerCase());
        if (!type) continue;
        // Terminal charges go to the terminal; others to their registry payee.
        const payeeOrgId =
          payeeTypeForCharge(type) === 'TERMINAL'
            ? terminalOrgId
            : await this.resolvePayeeOrgId(type);
        rows.push(
          await tx.charge.create({
            data: {
              containerId,
              payeeOrgId,
              type,
              amount: line.amount,
              currency: line.currency,
              dueDate: line.dueDate ? new Date(line.dueDate) : null,
              lastFreeDay: line.lastFreeDay ? new Date(line.lastFreeDay) : null,
              status: 'PENDING',
              source: 'OCTOPI',
            },
            include: chargeWithPayee,
          }),
        );
      }
      return rows;
    });

    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'charge.terminal_sync',
      entity: 'Container',
      entityId: containerId,
      after: { created: created.length, terminal_org_id: terminalOrgId },
    });
    await this.deadlines.recomputeForContainer(containerId); // spec §1.5: recompute on new data
    return created.map(toChargeSummary);
  }

  /**
   * Broker/importer requests a customs inspection (spec §2.3). Records an
   * INSPECTION charge (fee from config, payable to customs) and recomputes
   * deadlines. In production this would also notify customs via AsycudaAdapter.
   */
  async requestInspection(principal: AuthPrincipal, containerId: string): Promise<ChargeSummary> {
    await this.requireVisibleContainer(principal, containerId);
    const fee = await this.config.flatFee('inspection');
    const payeeOrgId = await this.resolvePayeeOrgId('INSPECTION');
    const charge = await this.prisma.charge.create({
      data: {
        containerId,
        payeeOrgId,
        type: 'INSPECTION',
        amount: fee.amount,
        currency: fee.currency,
        status: 'PENDING',
        source: 'ASYCUDA',
      },
      include: chargeWithPayee,
    });
    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'inspection.request',
      entity: 'Container',
      entityId: containerId,
      after: { charge_id: charge.id, amount: fee.amount, currency: fee.currency },
    });
    await this.deadlines.recomputeForContainer(containerId);
    return toChargeSummary(charge);
  }

  private async resolvePayeeOrgId(type: ChargeType, explicit?: string): Promise<string> {
    if (explicit) {
      const org = await this.prisma.organization.findUnique({ where: { id: explicit } });
      if (!org) throw new BadRequestException('payee_org_id does not exist.');
      return explicit;
    }
    const payeeType = payeeTypeForCharge(type);
    const payee = await this.payees.resolveByType(payeeType);
    if (!payee) {
      throw new BadRequestException(
        `No ${payeeType} payee configured; provide payee_org_id or configure a payee.`,
      );
    }
    return payee.orgId;
  }

  private async resolveTerminalOrgId(principal: AuthPrincipal, container: Container): Promise<string> {
    if (container.terminalOrgId) return container.terminalOrgId;
    if (principal.orgType === 'TERMINAL') return principal.orgId;
    const payee = await this.payees.resolveByType('TERMINAL');
    if (!payee) throw new BadRequestException('No terminal payee configured.');
    return payee.orgId;
  }

  private async auditCharge(
    principal: AuthPrincipal,
    chargeId: string,
    action: string,
    type: ChargeType,
    amount: number,
    currency: string,
  ): Promise<void> {
    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action,
      entity: 'Charge',
      entityId: chargeId,
      after: { type, amount, currency },
    });
  }
}
