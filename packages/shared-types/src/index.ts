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

// ---------------------------------------------------------------------------
// Data Hub (Step 3). API string forms per spec §7/§15.
// ---------------------------------------------------------------------------

export type ContainerSize = '20' | '40' | 'reefer';
export type ContainerStatus = 'arrived' | 'cleared' | 'released' | 'gated_out';
export type ManifestStatus = 'submitted' | 'processed';

/** Minimal counterparty directory entry (safe to expose across tenants). */
export interface DirectoryOrg {
  id: string;
  legal_name: string;
  type: OrgType;
}

export interface VoyageInfo {
  id: string;
  voyage_number: string;
  eta: string;
  port: string;
  vessel: { id: string; name: string; imo: string };
}

export interface ContainerSummary {
  id: string;
  container_number: string;
  size_type: ContainerSize;
  status: ContainerStatus;
  importer_org_id: string;
  terminal_org_id: string | null;
  arrival_date: string | null;
  bl_number: string;
  voyage: VoyageInfo;
}

/**
 * Full container view (spec §15 GET /containers/:id). `charges`, `total_owed`,
 * and `deadlines` are part of the shape now but stay empty/null until the
 * Charge and Deadline models arrive (build steps 4–6).
 */
export interface ContainerDetail {
  container: ContainerSummary & {
    importer: DirectoryOrg;
    terminal: DirectoryOrg | null;
    shipper: string;
    description: string | null;
    manifest_id: string;
  };
  charges: unknown[];
  total_owed: { amount: number; currency: string } | null;
  deadlines: unknown[];
}

export interface ManifestSummary {
  id: string;
  status: ManifestStatus;
  submitted_by_org_id: string;
  submitted_at: string;
  voyage: VoyageInfo;
  bl_count: number;
  container_count: number;
}

export interface ManifestSubmitResult {
  manifest_id: string;
  container_ids: string[];
}

/** Request body for POST /api/v1/manifests (spec §15). */
export interface ManifestSubmitRequest {
  voyage: { vessel_imo: string; vessel_name: string; voyage_number: string; eta: string; port: string };
  bills_of_lading: {
    bl_number: string;
    shipper: string;
    consignee_org_id: string;
    description?: string;
    containers: { container_number: string; size_type: ContainerSize }[];
  }[];
}
