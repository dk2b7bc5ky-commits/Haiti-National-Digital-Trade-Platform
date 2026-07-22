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
  | 'document:write'
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

/** Container-level payment rollup derived from its charges (spec §1.4). */
export type PaymentStatus = 'none' | 'pending' | 'paid' | 'overdue';

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
  // Consolidated rollup (spec §1.4): shown across the list and on the detail.
  total_owed: Money | null;
  payment_status: PaymentStatus;
  /** Earliest last-free-day across the container's charges (the binding one). */
  last_free_day: string | null;
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
  charges: ChargeSummary[];
  /** Charges grouped by payee (spec §1.4). Populated from build step 4. */
  charge_groups: PayeeChargeGroup[];
  /**
   * Payable total. Single Money when all payable charges share one currency,
   * else null — see totals_by_currency. (FX/settlement is build step 8.)
   */
  total_owed: Money | null;
  totals_by_currency: Money[];
  deadlines: DeadlineSummary[];
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

// ---------------------------------------------------------------------------
// Charges, payees & market config (Step 4).
// Money is always integer minor units + ISO-4217 currency (spec §15).
// ---------------------------------------------------------------------------

export type ChargeType =
  | 'customs_duty'
  | 'customs_fee'
  | 'port_dues'
  | 'terminal_handling'
  | 'storage'
  | 'demurrage'
  | 'detention'
  | 'inspection'
  | 'scanning'
  | 'rezo_fee';

export type ChargeStatus = 'pending' | 'pending_review' | 'requested' | 'paid' | 'overdue';
export type ChargeSource = 'manifest' | 'asycuda' | 'octopi' | 'document' | 'manual';
export type PayeeType = 'customs' | 'port' | 'terminal' | 'line' | 'rezo' | 'other';

export interface Money {
  amount: number; // integer minor units
  currency: string; // ISO-4217
}

export interface ChargeSummary {
  id: string;
  container_id: string;
  payee_org_id: string;
  payee_name: string;
  type: ChargeType;
  amount: number;
  currency: string;
  status: ChargeStatus;
  source: ChargeSource;
  due_date: string | null;
  last_free_day: string | null;
}

/** Charges grouped by payee for the consolidated view (spec §1.4). */
export interface PayeeChargeGroup {
  payee_org_id: string;
  payee_name: string;
  /** "Who you pay" — payee kind + masked settlement routing (opaque token). */
  payee_type: PayeeType | null;
  settlement_hint: string | null;
  charges: ChargeSummary[];
  subtotals: Money[];
}

export interface PayeeSummary {
  id: string;
  org_id: string;
  name: string;
  type: PayeeType;
  active: boolean;
}

export interface MarketConfig {
  code: string;
  name: string;
  base_currency: string;
  currencies: string[];
  languages: string[];
  enabled_modules: string[];
  tariff: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Deadlines & alerts (Step 6).
// ---------------------------------------------------------------------------

export type DeadlineType = 'last_free_day' | 'accrual_start';
export type AlertChannel = 'in_app' | 'email' | 'sms';
export type AlertStatus = 'pending' | 'sent' | 'failed';

export interface DeadlineSummary {
  id: string;
  container_id: string;
  payee_org_id: string;
  payee_name: string;
  type: DeadlineType;
  datetime: string;
  alert_schedule: number[];
}

export interface AlertSummary {
  id: string;
  container_id: string;
  container_number: string;
  deadline_type: DeadlineType;
  channel: AlertChannel;
  status: AlertStatus;
  offset_days: number;
  scheduled_for: string;
  sent_at: string | null;
  read_at: string | null;
  message: string;
}

// ---------------------------------------------------------------------------
// Document ingestion & verification (Step 7).
// ---------------------------------------------------------------------------

export type DocumentSource = 'upload' | 'email';
export type DocType = 'terminal_invoice' | 'customs_declaration' | 'bill_of_lading' | 'other';
export type DocVerificationStatus = 'processing' | 'extracted' | 'needs_review' | 'verified';
export type VerificationTaskStatus = 'open' | 'resolved';

export interface DocumentSummary {
  id: string;
  container_id: string | null;
  doc_type: DocType;
  source: DocumentSource;
  language: string;
  file_name: string;
  file_ref: string;
  extraction_confidence: number | null;
  verification_status: DocVerificationStatus;
  created_at: string;
}

/** Result of POST /documents: the document plus what extraction produced. */
export interface DocumentIngestResult {
  document: DocumentSummary;
  charges_created: number;
  charges_pending_review: number;
  verification_tasks: number;
  matched_container_id: string | null;
}

export interface VerificationTaskSummary {
  id: string;
  document_id: string | null;
  charge_id: string | null;
  container_id: string | null;
  container_number: string | null;
  field: string;
  confidence: number;
  status: VerificationTaskStatus;
  before_value: unknown;
  after_value: unknown;
  created_at: string;
  resolved_at: string | null;
}

// ---------------------------------------------------------------------------
// Payments (Step 8). Rezo orchestrates; it never holds funds.
// ---------------------------------------------------------------------------

export type PaymentRequestStatus =
  | 'created'
  | 'authorized'
  | 'routing'
  | 'partially_settled'
  | 'settled'
  | 'failed'
  | 'reversing';

export type PaymentRoutingStatus = 'pending' | 'settled' | 'failed' | 'reversed';

export interface RoutingSummary {
  id: string;
  payee_org_id: string;
  payee_name: string;
  charge_currency: string;
  charge_amount: number;
  fx_rate: number;
  settlement_amount: number;
  rail: string;
  rail_txn_ref: string | null;
  status: PaymentRoutingStatus;
  is_rezo_fee: boolean;
}

export interface PaymentRequestSummary {
  id: string;
  container_id: string;
  importer_org_id: string;
  settlement_currency: string;
  gross_amount_settlement: number;
  rezo_fee: number;
  status: PaymentRequestStatus;
  created_at: string;
  authorized_at: string | null;
  settled_at: string | null;
  routings: RoutingSummary[];
  covered_charge_ids: string[];
  /** Charges whose routing failed — surfaced for a "retry these" new request. */
  failed_charge_ids: string[];
  /** True when every charge required for release is paid (spec §2.1/§2.5). */
  release_eligible: boolean;
}

export interface CreatePaymentRequestBody {
  container_id: string;
  charge_ids: string[];
  settlement_currency: string;
}

/** Beta/mock only: force per-payee rail outcomes to exercise partial failure. */
export interface AuthorizePaymentBody {
  simulate?: Record<string, PaymentRoutingStatus>;
}

// ---------------------------------------------------------------------------
// Fee & billing engine (Step 9).
// ---------------------------------------------------------------------------

export type SubscriptionPlan =
  | 'small_broker'
  | 'large_broker'
  | 'line'
  | 'terminal'
  | 'trucker'
  | 'importer';
export type SubscriptionTerm = 'monthly' | 'annual';
export type SubscriptionStatus = 'active' | 'cancelled' | 'expired';

export interface PlanPrice {
  plan: SubscriptionPlan;
  currency: string;
  monthly: number;
  annual: number;
}

export interface SubscriptionSummary {
  id: string;
  org_id: string;
  org_name: string;
  plan: SubscriptionPlan;
  term: SubscriptionTerm;
  price: number;
  currency: string;
  status: SubscriptionStatus;
  started_at: string;
  renewal_date: string;
  cancelled_at: string | null;
}

export interface BillingSummary {
  /** Rezo per-transaction fee collected (settled rezo-fee routings). */
  rezo_fee_collected: Money[];
  active_subscriptions: number;
  /** Monthly-recurring revenue from active subscriptions (annual ÷ 12). */
  subscription_mrr: Money;
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
