import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import type { BrokerClientSummary } from '@rezo/shared-types';

/**
 * Broker portal — one login clears for many importers (spec §2.3). A broker
 * manages the set of importers it acts for; container visibility for those
 * importers is granted through resolveContainerScope (data-hub/scoping).
 */
@Injectable()
export class BrokerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The broker org whose clients we operate on (own org, or admin override). */
  private resolveBrokerOrg(principal: AuthPrincipal, brokerOrgId?: string): string {
    if (principal.orgType === 'BROKER') return principal.orgId;
    if (principal.permissions.includes(Permission.TENANT_READ_ALL) && brokerOrgId) return brokerOrgId;
    throw new ForbiddenException('Only a broker can manage its own clients.');
  }

  async listClients(principal: AuthPrincipal, brokerOrgId?: string): Promise<BrokerClientSummary[]> {
    const crossTenant = principal.permissions.includes(Permission.TENANT_READ_ALL);
    const where = crossTenant && !brokerOrgId ? {} : { brokerOrgId: this.resolveBrokerOrg(principal, brokerOrgId) };
    const links = await this.prisma.brokerClient.findMany({ where, orderBy: { createdAt: 'asc' } });
    const importerIds = links.map((l) => l.importerOrgId);
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: importerIds } },
      select: { id: true, legalName: true },
    });
    const names = new Map(orgs.map((o) => [o.id, o.legalName]));
    const counts = await this.prisma.container.groupBy({
      by: ['importerOrgId'],
      where: { importerOrgId: { in: importerIds } },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.importerOrgId, c._count._all]));
    return links.map((l) => ({
      id: l.id,
      broker_org_id: l.brokerOrgId,
      importer_org_id: l.importerOrgId,
      importer_name: names.get(l.importerOrgId) ?? '',
      container_count: countMap.get(l.importerOrgId) ?? 0,
      created_at: l.createdAt.toISOString(),
    }));
  }

  async addClient(principal: AuthPrincipal, importerOrgId: string): Promise<BrokerClientSummary> {
    const brokerOrgId = this.resolveBrokerOrg(principal);
    const importer = await this.prisma.organization.findUnique({ where: { id: importerOrgId } });
    if (!importer) throw new NotFoundException('Importer not found.');
    if (importer.type !== 'IMPORTER') throw new BadRequestException('Target org is not an importer.');

    const existing = await this.prisma.brokerClient.findUnique({
      where: { brokerOrgId_importerOrgId: { brokerOrgId, importerOrgId } },
    });
    if (existing) throw new ConflictException('Already a client of this broker.');

    const link = await this.prisma.brokerClient.create({ data: { brokerOrgId, importerOrgId } });
    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'broker.add_client',
      entity: 'BrokerClient',
      entityId: link.id,
      after: { broker_org_id: brokerOrgId, importer_org_id: importerOrgId },
    });
    return (await this.listClients(principal)).find((c) => c.id === link.id)!;
  }

  async removeClient(principal: AuthPrincipal, id: string): Promise<{ id: string }> {
    const link = await this.prisma.brokerClient.findUnique({ where: { id } });
    const crossTenant = principal.permissions.includes(Permission.TENANT_READ_ALL);
    if (!link || (!crossTenant && link.brokerOrgId !== principal.orgId)) {
      throw new NotFoundException('Client link not found.');
    }
    await this.prisma.brokerClient.delete({ where: { id } });
    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'broker.remove_client',
      entity: 'BrokerClient',
      entityId: id,
    });
    return { id };
  }
}
