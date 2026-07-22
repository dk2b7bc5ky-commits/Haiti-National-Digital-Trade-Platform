import { OrgType, Role } from '@prisma/client';

/**
 * RBAC — the permission matrix (spec §1.1, §11).
 *
 * Permissions are plain strings. Endpoints declare the permission(s) they
 * require via @RequirePermissions(); the PermissionsGuard checks them against
 * the caller's role. Roles map to permission sets here in one place so access
 * rules are auditable and adding a capability is configuration, not a rewrite.
 */

export const Permission = {
  ORG_READ: 'org:read',
  ORG_WRITE: 'org:write',
  /** Cross-tenant read visibility (Rezo staff, government, customs). */
  TENANT_READ_ALL: 'tenant:read_all',
  USER_READ: 'user:read',
  USER_WRITE: 'user:write',
  APIKEY_MANAGE: 'apikey:manage',
  CONFIG_MANAGE: 'config:manage',
  MANIFEST_SUBMIT: 'manifest:submit',
  CONTAINER_READ: 'container:read',
  CHARGE_READ: 'charge:read',
  CHARGE_WRITE: 'charge:write',
  PAYMENT_CREATE: 'payment:create',
  PAYMENT_AUTHORIZE: 'payment:authorize',
  VERIFICATION_READ: 'verification:read',
  VERIFICATION_RESOLVE: 'verification:resolve',
  DOCUMENT_WRITE: 'document:write',
  BROKER_MANAGE: 'broker:manage',
  INSPECTION_REQUEST: 'inspection:request',
  TRANSPORT_MANAGE: 'transport:manage',
  TRANSPORT_DRIVE: 'transport:drive',
  GATE_MANAGE: 'gate:manage',
  CUSTOMS_CLEAR: 'customs:clear',
  RELEASE_AUTHORIZE: 'release:authorize',
  DASHBOARD_VIEW: 'dashboard:view',
  DASHBOARD_GOV: 'dashboard:gov',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

const P = Permission;

/**
 * Role → permissions. Forward-looking: later build steps simply reference the
 * permissions declared here; only the identity ones are exercised in Step 2.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  REZO_ADMIN: [
    P.ORG_READ, P.ORG_WRITE, P.TENANT_READ_ALL,
    P.USER_READ, P.USER_WRITE, P.APIKEY_MANAGE, P.CONFIG_MANAGE,
    P.MANIFEST_SUBMIT, P.CONTAINER_READ, P.CHARGE_READ, P.CHARGE_WRITE,
    P.PAYMENT_CREATE, P.PAYMENT_AUTHORIZE,
    P.VERIFICATION_READ, P.VERIFICATION_RESOLVE, P.DOCUMENT_WRITE,
    P.BROKER_MANAGE, P.INSPECTION_REQUEST,
    P.TRANSPORT_MANAGE, P.TRANSPORT_DRIVE, P.GATE_MANAGE,
    P.CUSTOMS_CLEAR, P.RELEASE_AUTHORIZE,
    P.DASHBOARD_VIEW, P.DASHBOARD_GOV,
  ],
  REZO_OPS: [
    P.ORG_READ, P.TENANT_READ_ALL, P.USER_READ,
    P.CONTAINER_READ, P.CHARGE_READ, P.CHARGE_WRITE,
    P.VERIFICATION_READ, P.VERIFICATION_RESOLVE, P.DOCUMENT_WRITE,
    P.INSPECTION_REQUEST, P.TRANSPORT_MANAGE,
    P.CUSTOMS_CLEAR, P.RELEASE_AUTHORIZE, P.DASHBOARD_VIEW,
  ],
  SHIPPING_LINE: [P.ORG_READ, P.USER_READ, P.MANIFEST_SUBMIT, P.CONTAINER_READ],
  IMPORTER: [
    P.ORG_READ, P.USER_READ, P.CONTAINER_READ, P.CHARGE_READ,
    P.PAYMENT_CREATE, P.PAYMENT_AUTHORIZE, P.DOCUMENT_WRITE,
    P.INSPECTION_REQUEST, P.TRANSPORT_MANAGE, P.DASHBOARD_VIEW,
  ],
  BROKER: [
    P.ORG_READ, P.USER_READ, P.APIKEY_MANAGE, P.CONTAINER_READ, P.CHARGE_READ,
    P.PAYMENT_CREATE, P.PAYMENT_AUTHORIZE, P.VERIFICATION_READ, P.DOCUMENT_WRITE,
    P.BROKER_MANAGE, P.INSPECTION_REQUEST, P.TRANSPORT_MANAGE, P.DASHBOARD_VIEW,
  ],
  TRUCKER: [
    P.ORG_READ, P.USER_READ, P.CONTAINER_READ,
    P.TRANSPORT_DRIVE, P.DASHBOARD_VIEW,
  ],
  TERMINAL: [
    P.ORG_READ, P.USER_READ, P.CONTAINER_READ, P.CHARGE_WRITE, P.DOCUMENT_WRITE,
    P.GATE_MANAGE, P.RELEASE_AUTHORIZE,
  ],
  CUSTOMS: [P.ORG_READ, P.TENANT_READ_ALL, P.CONTAINER_READ, P.CHARGE_READ, P.CUSTOMS_CLEAR],
  BANK: [P.ORG_READ, P.USER_READ],
  GOV_VIEWER: [
    P.ORG_READ, P.TENANT_READ_ALL, P.CONTAINER_READ, P.CHARGE_READ,
    P.DASHBOARD_VIEW, P.DASHBOARD_GOV,
  ],
};

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/** Default role assigned to the principal when an org authenticates via API key. */
export function defaultRoleForOrgType(type: OrgType): Role {
  switch (type) {
    case 'SHIPPING_LINE':
      return 'SHIPPING_LINE';
    case 'IMPORTER':
      return 'IMPORTER';
    case 'BROKER':
      return 'BROKER';
    case 'TRUCKER':
      return 'TRUCKER';
    case 'TERMINAL':
      return 'TERMINAL';
    case 'CUSTOMS':
      return 'CUSTOMS';
    case 'BANK':
      return 'BANK';
    case 'GOV':
      return 'GOV_VIEWER';
    case 'REZO':
      return 'REZO_OPS';
    default:
      return 'IMPORTER';
  }
}
