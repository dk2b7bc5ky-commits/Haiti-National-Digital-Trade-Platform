import {
  ContainerSize,
  ContainerStatus,
  ManifestStatus,
  Prisma,
} from '@prisma/client';
import {
  toChargeSummary,
  groupByPayee,
  totalOwed,
  sumByCurrency,
  paymentStatus,
  totalOwedFrom,
  earliestLastFreeDay,
  PayeeMap,
} from '../charges/mappers';
import type {
  ContainerSize as ApiContainerSize,
  ContainerStatus as ApiContainerStatus,
  ManifestStatus as ApiManifestStatus,
  ContainerSummary,
  ContainerDetail,
  ManifestSummary,
  VoyageInfo,
  DirectoryOrg,
} from '@rezo/shared-types';

// --- enum <-> API string maps (spec §7/§15) ---

const SIZE_TO_API: Record<ContainerSize, ApiContainerSize> = {
  TWENTY: '20',
  FORTY: '40',
  REEFER: 'reefer',
};
const API_TO_SIZE: Record<ApiContainerSize, ContainerSize> = {
  '20': 'TWENTY',
  '40': 'FORTY',
  reefer: 'REEFER',
};
const STATUS_TO_API: Record<ContainerStatus, ApiContainerStatus> = {
  ARRIVED: 'arrived',
  CLEARED: 'cleared',
  RELEASED: 'released',
  GATED_OUT: 'gated_out',
};
const MANIFEST_STATUS_TO_API: Record<ManifestStatus, ApiManifestStatus> = {
  SUBMITTED: 'submitted',
  PROCESSED: 'processed',
};

export function sizeToApi(s: ContainerSize): ApiContainerSize {
  return SIZE_TO_API[s];
}
export function apiToSize(s: ApiContainerSize): ContainerSize {
  return API_TO_SIZE[s];
}
export function containerStatusToApi(s: ContainerStatus): ApiContainerStatus {
  return STATUS_TO_API[s];
}

// --- typed Prisma includes so mappers get fully-typed rows ---

export const voyageInclude = { vessel: true } as const;

export const containerInclude = {
  bl: { include: { manifest: { include: { voyage: { include: voyageInclude } } } } },
  charges: { select: { amount: true, currency: true, status: true, lastFreeDay: true } },
} as const;

export const containerDetailInclude = {
  bl: { include: { manifest: { include: { voyage: { include: voyageInclude } } } } },
  importer: true,
  terminal: true,
  charges: { include: { payeeOrg: { select: { id: true, legalName: true } } }, orderBy: { createdAt: 'asc' } },
} as const;

type ContainerWithRels = Prisma.ContainerGetPayload<{ include: typeof containerInclude }>;
type ContainerDetailRow = Prisma.ContainerGetPayload<{ include: typeof containerDetailInclude }>;
type ManifestWithRels = Prisma.ManifestGetPayload<{
  include: {
    voyage: { include: typeof voyageInclude };
    billsOfLading: { include: { containers: true } };
  };
}>;

function toVoyageInfo(v: ContainerWithRels['bl']['manifest']['voyage']): VoyageInfo {
  return {
    id: v.id,
    voyage_number: v.voyageNumber,
    eta: v.eta.toISOString(),
    port: v.port,
    vessel: { id: v.vessel.id, name: v.vessel.name, imo: v.vessel.imo },
  };
}

export function toContainerSummary(c: ContainerWithRels): ContainerSummary {
  const charges = c.charges;
  return {
    id: c.id,
    container_number: c.containerNumber,
    size_type: sizeToApi(c.sizeType),
    status: containerStatusToApi(c.status),
    importer_org_id: c.importerOrgId,
    terminal_org_id: c.terminalOrgId,
    arrival_date: c.arrivalDate?.toISOString() ?? null,
    bl_number: c.bl.blNumber,
    voyage: toVoyageInfo(c.bl.manifest.voyage),
    total_owed: totalOwedFrom(charges),
    payment_status: paymentStatus(charges),
    last_free_day: earliestLastFreeDay(charges),
  };
}

function toDirectoryOrg(o: { id: string; legalName: string; type: DirectoryOrg['type'] }): DirectoryOrg {
  return { id: o.id, legal_name: o.legalName, type: o.type };
}

export function toContainerDetail(c: ContainerDetailRow, payees?: PayeeMap): ContainerDetail {
  const summary = toContainerSummary(c);
  const charges = c.charges;
  return {
    container: {
      ...summary,
      importer: toDirectoryOrg(c.importer),
      terminal: c.terminal ? toDirectoryOrg(c.terminal) : null,
      shipper: c.bl.shipper,
      description: c.bl.description,
      manifest_id: c.bl.manifestId,
      cleared_at: c.clearedAt?.toISOString() ?? null,
      released_at: c.releasedAt?.toISOString() ?? null,
      gated_out_at: c.gatedOutAt?.toISOString() ?? null,
    },
    timeline: [],
    charges: charges.map(toChargeSummary),
    charge_groups: groupByPayee(charges, payees),
    total_owed: totalOwed(charges),
    totals_by_currency: sumByCurrency(charges),
    // Deadlines populated in build step 6.
    deadlines: [],
  };
}

export function toManifestSummary(m: ManifestWithRels): ManifestSummary {
  const containerCount = m.billsOfLading.reduce((n, bl) => n + bl.containers.length, 0);
  return {
    id: m.id,
    status: MANIFEST_STATUS_TO_API[m.status],
    submitted_by_org_id: m.submittedByOrgId,
    submitted_at: m.submittedAt.toISOString(),
    voyage: toVoyageInfo(m.voyage),
    bl_count: m.billsOfLading.length,
    container_count: containerCount,
  };
}
