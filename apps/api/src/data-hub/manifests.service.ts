import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { cursorArgs, splitPage, Paginated } from '../common/pagination';
import { SubmitManifestDto } from './dto';
import { apiToSize, toManifestSummary } from './mappers';
import { manifestScopeWhere } from './scoping';
import type { ManifestSubmitResult, ManifestSummary } from '@rezo/shared-types';

const manifestListInclude = {
  voyage: { include: { vessel: true } },
  billsOfLading: { include: { containers: true } },
} as const;

@Injectable()
export class ManifestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Single manifest submission (spec §1.2 / Flow A). One call creates (or
   * reuses) the vessel and voyage, then creates the bills of lading and their
   * containers in a single transaction. Downstream parties read from here — no
   * retyping anywhere.
   */
  async submit(principal: AuthPrincipal, dto: SubmitManifestDto): Promise<ManifestSubmitResult> {
    // Validate all consignees up front: they must be existing IMPORTER orgs.
    const consigneeIds = [...new Set(dto.bills_of_lading.map((b) => b.consignee_org_id))];
    const consignees = await this.prisma.organization.findMany({
      where: { id: { in: consigneeIds } },
    });
    const byId = new Map(consignees.map((o) => [o.id, o]));
    for (const id of consigneeIds) {
      const org = byId.get(id);
      if (!org) throw new BadRequestException(`Consignee org ${id} does not exist.`);
      if (org.type !== 'IMPORTER') {
        throw new BadRequestException(`Consignee org ${id} is not an importer.`);
      }
    }

    const eta = new Date(dto.voyage.eta);

    const result = await this.prisma.$transaction(async (tx) => {
      // Vessel keyed by IMO (create once, reuse thereafter).
      const vessel = await tx.vessel.upsert({
        where: { imo: dto.voyage.vessel_imo },
        update: { name: dto.voyage.vessel_name },
        create: {
          name: dto.voyage.vessel_name,
          imo: dto.voyage.vessel_imo,
          lineOrgId: principal.orgId,
        },
      });

      // Voyage keyed by (vessel, voyage number).
      const voyage = await tx.voyage.upsert({
        where: { vesselId_voyageNumber: { vesselId: vessel.id, voyageNumber: dto.voyage.voyage_number } },
        update: { eta, port: dto.voyage.port },
        create: { vesselId: vessel.id, voyageNumber: dto.voyage.voyage_number, eta, port: dto.voyage.port },
      });

      const manifest = await tx.manifest.create({
        data: { voyageId: voyage.id, submittedByOrgId: principal.orgId },
      });

      const containerIds: string[] = [];
      for (const bl of dto.bills_of_lading) {
        const created = await tx.billOfLading.create({
          data: {
            manifestId: manifest.id,
            blNumber: bl.bl_number,
            shipper: bl.shipper,
            importerOrgId: bl.consignee_org_id,
            description: bl.description ?? null,
          },
        });
        for (const c of bl.containers) {
          const container = await tx.container.create({
            data: {
              blId: created.id,
              containerNumber: c.container_number,
              sizeType: apiToSize(c.size_type),
              importerOrgId: bl.consignee_org_id,
              arrivalDate: eta,
            },
          });
          containerIds.push(container.id);
        }
      }

      return { manifestId: manifest.id, containerIds };
    }).catch((e) => {
      // Unique-constraint violations (duplicate BL / container numbers).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const target = (e.meta?.target as string[] | undefined)?.join(', ') ?? 'value';
        throw new BadRequestException(`Duplicate ${target} — already submitted.`);
      }
      throw e;
    });

    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'manifest.submit',
      entity: 'Manifest',
      entityId: result.manifestId,
      after: { container_count: result.containerIds.length, bl_count: dto.bills_of_lading.length },
    });

    return { manifest_id: result.manifestId, container_ids: result.containerIds };
  }

  async list(
    principal: AuthPrincipal,
    limit: number,
    cursor?: string,
  ): Promise<Paginated<ManifestSummary>> {
    const rows = await this.prisma.manifest.findMany({
      where: manifestScopeWhere(principal),
      include: manifestListInclude,
      orderBy: { submittedAt: 'desc' },
      ...cursorArgs(limit, cursor),
    });
    const { items, nextCursor } = splitPage(rows, limit);
    return new Paginated(items.map(toManifestSummary), nextCursor);
  }

  async getById(principal: AuthPrincipal, id: string): Promise<ManifestSummary> {
    const m = await this.prisma.manifest.findFirst({
      where: { id, ...manifestScopeWhere(principal) },
      include: manifestListInclude,
    });
    if (!m) throw new NotFoundException('Manifest not found.');
    return toManifestSummary(m);
  }
}
