import { Prisma, PrismaClient } from '@prisma/client';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';

/** Matches nothing — used for roles with no container visibility yet. */
const MATCH_NONE: Prisma.ContainerWhereInput = { id: { in: [] } };

/**
 * Role-aware visibility for containers (spec Flow A: data entered once is read
 * by the right parties without retyping).
 *
 * - Rezo staff / government / customs (tenant:read_all): all containers.
 * - Importer: containers consigned to them.
 * - Terminal: containers assigned to their terminal.
 * - Shipping line: containers from manifests they submitted.
 * - Broker: none yet — the broker↔importer link and broker container view
 *   arrive with the Broker portal (build step 10).
 */
export function containerScopeWhere(principal: AuthPrincipal): Prisma.ContainerWhereInput {
  if (principal.permissions.includes(Permission.TENANT_READ_ALL)) return {};
  switch (principal.orgType) {
    case 'IMPORTER':
      return { importerOrgId: principal.orgId };
    case 'TERMINAL':
      return { terminalOrgId: principal.orgId };
    case 'SHIPPING_LINE':
      return { bl: { manifest: { submittedByOrgId: principal.orgId } } };
    default:
      return MATCH_NONE;
  }
}

/**
 * Async scope resolver. Same as containerScopeWhere but also resolves BROKER
 * visibility from the broker↔importer links (spec §2.3): a broker sees the
 * containers of every importer it clears for.
 */
export async function resolveContainerScope(
  prisma: Pick<PrismaClient, 'brokerClient'>,
  principal: AuthPrincipal,
): Promise<Prisma.ContainerWhereInput> {
  if (principal.orgType === 'BROKER' && !principal.permissions.includes(Permission.TENANT_READ_ALL)) {
    const links = await prisma.brokerClient.findMany({
      where: { brokerOrgId: principal.orgId },
      select: { importerOrgId: true },
    });
    const importerIds = links.map((l) => l.importerOrgId);
    return importerIds.length ? { importerOrgId: { in: importerIds } } : MATCH_NONE;
  }
  return containerScopeWhere(principal);
}

/** Manifest visibility: submitter-scoped unless the caller has cross-tenant read. */
export function manifestScopeWhere(principal: AuthPrincipal): Prisma.ManifestWhereInput {
  if (principal.permissions.includes(Permission.TENANT_READ_ALL)) return {};
  if (principal.orgType === 'SHIPPING_LINE') {
    return { submittedByOrgId: principal.orgId };
  }
  return { id: { in: [] } };
}
