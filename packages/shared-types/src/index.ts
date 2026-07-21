/**
 * Shared types for Rezo.
 *
 * The standard API response envelope (spec §15):
 *   success -> { data: <T>, error: null }
 *   failure -> { data: null, error: { code, message } }
 *
 * Every Rezo API endpoint returns one of these shapes.
 */

export interface ApiError {
  code: string;
  message: string;
}

export interface ApiSuccess<T> {
  data: T;
  error: null;
}

export interface ApiFailure {
  data: null;
  error: ApiError;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Payload of GET /api/v1/health */
export interface HealthStatus {
  status: 'ok';
}

// ---------------------------------------------------------------------------
// Identity, Tenancy & RBAC (Step 2)
// String-literal unions kept in sync with the Prisma enums in the API.
// ---------------------------------------------------------------------------

export type OrgType =
  | 'SHIPPING_LINE'
  | 'IMPORTER'
  | 'BROKER'
  | 'TRUCKER'
  | 'TERMINAL'
  | 'CUSTOMS'
  | 'BANK'
  | 'GOV'
  | 'REZO';

export type Role =
  | 'SHIPPING_LINE'
  | 'IMPORTER'
  | 'BROKER'
  | 'TRUCKER'
  | 'TERMINAL'
  | 'CUSTOMS'
  | 'BANK'
  | 'GOV_VIEWER'
  | 'REZO_OPS'
  | 'REZO_ADMIN';

export type KycStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type OrgStatus = 'ACTIVE' | 'SUSPENDED';
export type UserStatus = 'ACTIVE' | 'DISABLED';

/** Permission strings enforced by the RBAC guard. */
export type Permission =
  | 'org:read'
  | 'org:write'
  | 'tenant:read_all'
  | 'user:read'
  | 'user:write'
  | 'apikey:manage'
  | 'config:manage'
  | 'manifest:submit'
  | 'container:read'
  | 'charge:read'
  | 'charge:write'
  | 'payment:create'
  | 'payment:authorize'
  | 'verification:read'
  | 'verification:resolve'
  | 'dashboard:view'
  | 'dashboard:gov';

export interface OrgSummary {
  id: string;
  type: OrgType;
  legal_name: string;
  country: string;
  kyc_status: KycStatus;
  status: OrgStatus;
}

export interface UserSummary {
  id: string;
  org_id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
}

/** GET /api/v1/auth/me and the body of a successful login. */
export interface AuthContext {
  user: UserSummary;
  org: OrgSummary;
  permissions: Permission[];
}

export interface LoginResponse extends AuthContext {
  token: string;
}

export interface TokenResponse {
  token: string;
}

export interface ApiKeyCreated {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  /** Full plaintext key — returned ONCE at creation, never again. */
  api_key: string;
}
