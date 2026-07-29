import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Container, ContainerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { cursorArgs, splitPage, Paginated } from '../common/pagination';
import { resolveContainerScope } from './scoping';
import {
  containerInclude,
  containerDetailInclude,
  toContainerSummary,
  toContainerDetail,
} from './mappers';
import { PayeeMap } from '../charges/mappers';
import { ManifestsService } from './manifests.service';
import { QuickAddContainerDto } from './dto';
import { DeadlineService } from '../deadlines/deadline.service';
import { ASYCUDA_ADAPTER, AsycudaAdapter } from '../integration/asycuda-adapter';
import { NotificationsService } from '../notifications/notifications.service';
import type { ContainerSummary, ContainerDetail, ContainerStatus as ApiStatus, TimelineStep } from '@rezo/shared-types';

const API_TO_STATUS: Record<ApiStatus, ContainerStatus> = {
  arrived: 'ARRIVED',
  cleared: 'CLEARED',
  released: 'RELEASED',
  gated_out: 'GATED_OUT',
};

export interface ContainerFilters {
  importerOrgId?: string;
  terminalOrgId?: string;
  status?: string;
}

@Injectable()
export class ContainersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deadlines: DeadlineService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly manifests: ManifestsService,
    @Inject(ASYCUDA_ADAPTER) private readonly asycuda: AsycudaAdapter,
  ) {}

  /**
   * Quick-add a single container the importer-friendly way. Importers add for
   * their own org; admins/brokers may add on behalf of an importer via
   * importer_org_id. Internally it reuses the manifest flow to create a minimal
   * voyage/manifest/bill so the container is a fully valid record — the rest of
   * the platform (charges, deadlines, uploads) works with no special-casing.
   */
  async quickAdd(principal: AuthPrincipal, dto: QuickAddContainerDto): Promise<ContainerDetail> {
    const myOrg = await this.prisma.organization.findUnique({ where: { id: principal.orgId } });
    if (!myOrg) throw new NotFoundException('Organization not found.');

    // An importer always files under their own org; anyone else must name one.
    let importerOrgId: string;
    if (myOrg.type === 'IMPORTER') {
      importerOrgId = principal.orgId;
    } else {
      if (!dto.importer_org_id) throw new BadRequestException('importer_org_id is required.');
      const importer = await this.prisma.organization.findUnique({ where: { id: dto.importer_org_id } });
      if (!importer || importer.type !== 'IMPORTER') throw new BadRequestException('importer_org_id must be an importer.');
      importerOrgId = importer.id;
    }

    const containerNumber = dto.container_number.trim().toUpperCase();
    const blNumber = dto.bl_number?.trim() || `BL-${containerNumber}`;
    const etaIso = (dto.arrival_date ? new Date(dto.arrival_date) : new Date()).toISOString();

    const result = await this.manifests.submit(principal, {
      voyage: {
        // Per-importer synthetic vessel/voyage for manually-entered containers.
        vessel_imo: `DIRECT-${importerOrgId}`.slice(0, 40),
        vessel_name: dto.vessel_name?.trim() || 'Direct entry',
        voyage_number: blNumber,
        eta: etaIso,
        port: 'Port-au-Prince',
      },
      bills_of_lading: [
        {
          bl_number: blNumber,
          shipper: dto.shipper?.trim() || 'Direct entry',
          consignee_org_id: importerOrgId,
          containers: [{ container_number: containerNumber, size_type: dto.size_type }],
        },
      ],
    });

    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'container.quick_add',
      entity: 'Container',
      entityId: result.container_ids[0],
      after: { container_number: containerNumber, bl_number: blNumber, importer_org_id: importerOrgId },
    });

    return this.getById(principal, result.container_ids[0]);
  }

  async list(
    principal: AuthPrincipal,
    filters: ContainerFilters,
    limit: number,
    cursor?: string,
  ): Promise<Paginated<ContainerSummary>> {
    // Start from the caller's role scope, then apply optional query filters
    // (intersection — a filter can never widen visibility).
    const where: Prisma.ContainerWhereInput = { ...(await resolveContainerScope(this.prisma, principal)) };
    if (filters.importerOrgId) where.importerOrgId = filters.importerOrgId;
    if (filters.terminalOrgId) where.terminalOrgId = filters.terminalOrgId;
    if (filters.status && filters.status in API_TO_STATUS) {
      where.status = API_TO_STATUS[filters.status as ApiStatus];
    }

    const rows = await this.prisma.container.findMany({
      where,
      include: containerInclude,
      orderBy: { createdAt: 'desc' },
      ...cursorArgs(limit, cursor),
    });
    const { items, nextCursor } = splitPage(rows, limit);
    return new Paginated(items.map(toContainerSummary), nextCursor);
  }

  async getById(principal: AuthPrincipal, id: string): Promise<ContainerDetail> {
    const container = await this.prisma.container.findFirst({
      where: { id, ...(await resolveContainerScope(this.prisma, principal)) },
      include: containerDetailInclude,
    });
    if (!container) throw new NotFoundException('Container not found.');
    const detail = toContainerDetail(container, await this.loadPayeeMap());
    detail.deadlines = await this.deadlines.listDeadlinesForContainer(id);
    detail.timeline = await this.buildTimeline(container);
    return detail;
  }

  /** End-to-end lifecycle milestones (spec §2.5). */
  private async buildTimeline(container: Container): Promise<TimelineStep[]> {
    const [total, outstanding, lastSettled, gate] = await Promise.all([
      this.prisma.charge.count({ where: { containerId: container.id } }),
      this.prisma.charge.count({
        where: { containerId: container.id, status: { in: ['PENDING', 'OVERDUE', 'REQUESTED', 'PENDING_REVIEW'] } },
      }),
      this.prisma.paymentRequest.findFirst({
        where: { containerId: container.id, status: 'SETTLED' },
        orderBy: { settledAt: 'desc' },
        select: { settledAt: true },
      }),
      this.prisma.gateAppointment.findFirst({
        where: { containerId: container.id, status: { in: ['CONFIRMED', 'COMPLETED'] } },
        orderBy: { slotTime: 'asc' },
        select: { slotTime: true },
      }),
    ]);
    const chargesSettled = total > 0 && outstanding === 0;
    const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
    return [
      { key: 'arrived', label: 'Arrived', reached: true, at: iso(container.arrivalDate ?? container.createdAt) },
      { key: 'charges_settled', label: 'Charges settled', reached: chargesSettled, at: chargesSettled ? iso(lastSettled?.settledAt ?? null) : null },
      { key: 'customs_cleared', label: 'Customs cleared', reached: !!container.clearedAt, at: iso(container.clearedAt) },
      { key: 'released', label: 'Release authorized', reached: !!container.releasedAt, at: iso(container.releasedAt) },
      { key: 'gate_booked', label: 'Gate appointment', reached: !!gate, at: iso(gate?.slotTime ?? null) },
      { key: 'gated_out', label: 'Gated out', reached: !!container.gatedOutAt, at: iso(container.gatedOutAt) },
    ];
  }

  /** Customs clearance via the (mock) AsycudaAdapter (spec §1.6/§2.5). */
  async customsClear(principal: AuthPrincipal, id: string): Promise<ContainerDetail> {
    const container = await this.prisma.container.findFirst({
      where: { id, ...(await resolveContainerScope(this.prisma, principal)) },
    });
    if (!container) throw new NotFoundException('Container not found.');
    const clearance = await this.asycuda.getClearance({ containerNumber: container.containerNumber });
    if (!clearance.cleared) throw new BadRequestException(`Customs status: ${clearance.status}.`);
    await this.prisma.container.update({
      where: { id },
      data: { clearedAt: new Date(), status: container.status === 'ARRIVED' ? 'CLEARED' : container.status },
    });
    await this.audit.record({
      actorUserId: principal.userId, actorOrgId: principal.orgId,
      action: 'container.customs_clear', entity: 'Container', entityId: id,
      after: { declaration_ref: clearance.declarationRef, status: clearance.status },
    });
    await this.notifications.notify({
      type: 'CONTAINER_RELEASED', severity: 'INFO', orgId: container.importerOrgId, containerId: id,
      title: 'Customs cleared',
      body: `Container ${container.containerNumber} has cleared customs and is ready to gate out once charges are settled.`,
      deepLink: `/dashboard/containers/${id}`,
    });
    return this.getById(principal, id);
  }

  /**
   * Authorize release (spec §2.5). Only when every charge is paid AND customs
   * has cleared — mirrors the payment orchestrator's release-eligibility rule.
   */
  async authorizeRelease(principal: AuthPrincipal, id: string): Promise<ContainerDetail> {
    const container = await this.prisma.container.findFirst({
      where: { id, ...(await resolveContainerScope(this.prisma, principal)) },
    });
    if (!container) throw new NotFoundException('Container not found.');
    if (!container.clearedAt) throw new BadRequestException('Container is not customs-cleared yet.');
    const total = await this.prisma.charge.count({ where: { containerId: id } });
    const outstanding = await this.prisma.charge.count({
      where: { containerId: id, status: { in: ['PENDING', 'OVERDUE', 'REQUESTED', 'PENDING_REVIEW'] } },
    });
    if (!(total > 0 && outstanding === 0)) {
      throw new BadRequestException('All charges must be paid before release.');
    }
    await this.prisma.container.update({
      where: { id },
      data: { releasedAt: new Date(), status: container.status === 'GATED_OUT' ? 'GATED_OUT' : 'RELEASED' },
    });
    await this.audit.record({
      actorUserId: principal.userId, actorOrgId: principal.orgId,
      action: 'container.release_authorize', entity: 'Container', entityId: id,
    });
    return this.getById(principal, id);
  }

  /** Payee registry keyed by org, for "who you pay" enrichment (spec §1.4). */
  private async loadPayeeMap(): Promise<PayeeMap> {
    const payees = await this.prisma.payee.findMany();
    const map: PayeeMap = new Map();
    for (const p of payees) {
      if (!map.has(p.orgId)) map.set(p.orgId, { type: p.type, settlementRef: p.settlementRef });
    }
    return map;
  }
}
