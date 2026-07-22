import type { Role } from '@rezo/shared-types';

/** Highest build step delivered so far — modules at/below this are live. */
export const CURRENT_STEP = 4;

export interface ModuleCard {
  title: string;
  description: string;
  /** Build step where this module becomes functional (shells until then). */
  step: number;
  /** Route for the module when it is live. */
  href?: string;
}

export interface RoleConfig {
  label: string;
  tagline: string;
  accent: string; // tailwind color token, e.g. "sky"
  modules: ModuleCard[];
}

const M = {
  containers: { title: 'Containers', description: 'Container records shared from the manifest; charges & deadlines follow.', step: 3, href: '/dashboard/containers' },
  manifests: { title: 'Manifest submission', description: 'Submit a manifest once; downstream parties read it.', step: 3, href: '/dashboard/manifests/new' },
  charges: { title: 'Charges', description: 'Fees grouped by payee with running totals.', step: 4 },
  payments: { title: 'Payments', description: 'Authorize one payment; routed directly to each payee.', step: 8 },
  verification: { title: 'Verification queue', description: 'Resolve low-confidence document extractions.', step: 7 },
  documents: { title: 'Documents', description: 'Upload invoices; OCR/LLM extraction (mock).', step: 7 },
  jobs: { title: 'Transport jobs', description: 'Accept jobs, gate slots, POD, GPS.', step: 11 },
  dashboards: { title: 'Dashboards', description: 'Operational KPIs from platform events.', step: 13 },
  govDash: { title: 'Government view', description: 'Daily counts, collections, congestion proxy.', step: 13 },
  orgs: { title: 'Organizations', description: 'Manage tenants, payees, market config.', step: 2 },
  users: { title: 'Users', description: 'Manage users and roles.', step: 2 },
  apiKeys: { title: 'API keys', description: 'Issue keys for API-connected integration.', step: 2 },
} as const;

export const ROLE_CONFIG: Record<Role, RoleConfig> = {
  REZO_ADMIN: {
    label: 'Rezo Admin',
    tagline: 'Configure markets, orgs, payees, users, and tariffs.',
    accent: 'violet',
    modules: [M.orgs, M.users, M.apiKeys, M.containers, M.charges, M.payments, M.dashboards],
  },
  REZO_OPS: {
    label: 'Rezo Ops',
    tagline: 'Verify low-confidence data and resolve disputes.',
    accent: 'amber',
    modules: [M.verification, M.containers, M.charges, M.documents, M.dashboards],
  },
  SHIPPING_LINE: {
    label: 'Shipping Line',
    tagline: 'Submit manifests once; track resulting containers.',
    accent: 'sky',
    modules: [M.manifests, M.containers],
  },
  IMPORTER: {
    label: 'Importer',
    tagline: 'See every charge in one place and authorize payment.',
    accent: 'emerald',
    modules: [M.containers, M.charges, M.payments, M.dashboards],
  },
  BROKER: {
    label: 'Customs Broker',
    tagline: 'Manage many importers under one login.',
    accent: 'indigo',
    modules: [M.containers, M.charges, M.payments, M.verification, M.apiKeys, M.dashboards],
  },
  TRUCKER: {
    label: 'Trucker',
    tagline: 'Accept jobs, book gate slots, capture POD.',
    accent: 'orange',
    modules: [M.jobs, M.containers],
  },
  TERMINAL: {
    label: 'Terminal Operator',
    tagline: 'Read container data; confirm terminal charges.',
    accent: 'cyan',
    modules: [M.containers, M.charges],
  },
  CUSTOMS: {
    label: 'Customs (AGD)',
    tagline: 'Read declaration data; push clearance status.',
    accent: 'rose',
    modules: [M.containers, M.charges],
  },
  BANK: {
    label: 'Bank / PSP',
    tagline: 'Receive payment routing requests; confirm settlement.',
    accent: 'teal',
    modules: [M.payments],
  },
  GOV_VIEWER: {
    label: 'Government Viewer',
    tagline: 'Read-only trade intelligence and collections.',
    accent: 'slate',
    modules: [M.govDash, M.dashboards, M.containers],
  },
};

export function roleConfig(role: Role): RoleConfig {
  return ROLE_CONFIG[role];
}
