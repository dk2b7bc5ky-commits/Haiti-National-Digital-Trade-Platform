import { Injectable, NotFoundException } from '@nestjs/common';
import { OrgType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal, tenantScope } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { toOrgSummary } from '../common/mappers';
import { cursorArgs, splitPage, Paginated } from '../common/pagination';
import { CreateOrganizationDto } from './dto';
import type { OrgSummary, DirectoryOrg } from '@rezo/shared-types';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    principal: AuthPrincipal,
    limit: number,
    cursor?: string,
  ): Promise<Paginated<OrgSummary>> {
    const scope = tenantScope(principal); // {} for cross-tenant, else own org
    const rows = await this.prisma.organization.findMany({
      where: scope.orgId ? { id: scope.orgId } : {},
      orderBy: { createdAt: 'asc' },
      ...cursorArgs(limit, cursor),
    });
    const { items, nextCursor } = splitPage(rows, limit);
    return new Paginated(items.map(toOrgSummary), nextCursor);
  }

  /**
   * Counterparty directory: minimal, non-sensitive org info (id, legal name,
   * type) available to any authenticated user for selecting counterparties
   * (e.g. a shipping line choosing a consignee when submitting a manifest).
   * Deliberately NOT tenant-scoped — it is a directory, and exposes no
   * KYC/status/user data.
   */
  async directory(type?: OrgType): Promise<DirectoryOrg[]> {
    const rows = await this.prisma.organization.findMany({
      where: { status: 'ACTIVE', ...(type ? { type } : {}) },
      orderBy: { legalName: 'asc' },
      select: { id: true, legalName: true, type: true },
    });
    return rows.map((o) => ({ id: o.id, legal_name: o.legalName, type: o.type }));
  }

  async getById(principal: AuthPrincipal, id: string): Promise<OrgSummary> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found.');
    const crossTenant = principal.permissions.includes(Permission.TENANT_READ_ALL);
    if (!crossTenant && org.id !== principal.orgId) {
      // Do not leak existence of other tenants' orgs.
      throw new NotFoundException('Organization not found.');
    }
    return toOrgSummary(org);
  }

  async create(principal: AuthPrincipal, dto: CreateOrganizationDto): Promise<OrgSummary> {
    const org = await this.prisma.organization.create({
      data: {
        type: dto.type,
        legalName: dto.legal_name,
        country: dto.country ?? 'HT',
        kycStatus: dto.kyc_status ?? 'PENDING',
        status: dto.status ?? 'ACTIVE',
      },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'org.create',
      entity: 'Organization',
      entityId: org.id,
      after: { type: org.type, legal_name: org.legalName, status: org.status },
    });
    return toOrgSummary(org);
  }
}
