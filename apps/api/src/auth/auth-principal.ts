import { OrgType, Role } from '@prisma/client';
import { Permission } from '../rbac/permissions';

/**
 * The authenticated caller, attached to the request by JwtAuthGuard and read
 * via the @CurrentUser() decorator. Derived entirely from the verified JWT.
 */
export interface AuthPrincipal {
  /** null when the principal authenticated via API key (no human user). */
  userId: string | null;
  orgId: string;
  orgType: OrgType;
  role: Role;
  permissions: Permission[];
  viaApiKey: boolean;
}

/** Claims embedded in the signed JWT. */
export interface JwtClaims {
  sub: string; // userId, or "apikey:<keyId>" for API-key principals
  org_id: string;
  org_type: OrgType;
  role: Role;
  via_api_key: boolean;
}

export function hasPermission(principal: AuthPrincipal, permission: Permission): boolean {
  return principal.permissions.includes(permission);
}

/**
 * Tenant scoping helper. Callers with cross-tenant read (Rezo staff, gov,
 * customs) see everything; everyone else is restricted to their own org.
 * Returns a Prisma-style where fragment for `orgId`.
 */
export function tenantScope(principal: AuthPrincipal): { orgId?: string } {
  if (principal.permissions.includes(Permission.TENANT_READ_ALL)) return {};
  return { orgId: principal.orgId };
}
