/**
 * Rezo seed — one organization per role type, each with a login user
 * (spec build step 2). Idempotent: safe to run repeatedly (upsert by email).
 *
 * Dev credentials (NEVER use in production):
 *   password for every seeded user = "password123"
 */
import { PrismaClient, OrgType, Role, ChargeType, ChargeSource, AlertChannel } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEV_PASSWORD = 'password123';

/**
 * Haiti tariff schedule — integer minor units (USD cents). This is the SAME
 * data the Market.tariff row holds; fees are config, never hard-coded in app
 * logic (spec §14).
 */
const HT_TARIFF = {
  currency: 'USD',
  rezo_fee: { flat: 500 }, // $5.00 convenience fee (attached at payment time, step 9)
  customs_fee: { flat: 2500 }, // $25.00
  port_dues: { flat: 5000 }, // $50.00
  scanning: { flat: 3500 }, // $35.00
  inspection: { flat: 7500 }, // $75.00 (customs inspection)
  terminal_handling: { TWENTY: 15000, FORTY: 25000, REEFER: 40000 },
  storage_per_day: { TWENTY: 2000, FORTY: 3000, REEFER: 6000 },
  // Free-time allowances (days) shown on the container list. Config, not code.
  free_days: { demurrage: 5, electric: 3 },
  subscription_plans: {
    small_broker: { monthly: 5000, annual: 50000 },
    large_broker: { monthly: 25000, annual: 250000 },
    line: { monthly: 100000, annual: 1000000 },
    terminal: { monthly: 100000, annual: 1000000 },
    trucker: { monthly: 2000, annual: 20000 },
    importer: { monthly: 3000, annual: 30000 },
  },
};

/**
 * Haiti shipping-line agents & line-direct offices — who actually collects the
 * shipping/line charges. `lineDirect` = the line's own office collects (e.g.
 * MSC Haiti); otherwise a maritime agency collects on the line's behalf (e.g.
 * AGEMAR for Maersk). Each becomes an Organization + a LINE-type Payee.
 * Contacts are from public sources and should be re-verified before production.
 */
const SHIPPING_AGENTS: { code: string; name: string; lineDirect: boolean }[] = [
  { code: 'AGEMAR', name: 'AGEMAR S.A.', lineDirect: false },
  { code: 'MSC_HAITI', name: 'MSC Haiti S.A.', lineDirect: true },
  { code: 'JB_VITAL', name: 'Ets J.B. Vital S.A.', lineDirect: false },
  { code: 'CMA_CGM_HAITI', name: 'CMA CGM Haiti S.A.', lineDirect: true },
  { code: 'ENMARCOLDA', name: "ENMARCOLDA S.A. (d'Adesky)", lineDirect: false },
  { code: 'NADAL', name: 'NADAL S.A. (NADALSA)', lineDirect: false },
  { code: 'SAMAR', name: 'SAMAR S.A.', lineDirect: false },
  { code: 'DEMSA', name: 'DEMSA (Développement Maritime S.A.)', lineDirect: false },
  { code: 'ADEKO', name: 'ADEKO Enterprises S.A.', lineDirect: false },
  { code: 'MADSEN', name: 'Madsen Export-Import S.A.', lineDirect: false },
  { code: 'ANTOINE_HOGARTH', name: 'Antoine Hogarth S.A.', lineDirect: false },
  { code: 'ANTILLEAN_HAITI', name: "Antillean d'Haiti S.A.", lineDirect: true },
  { code: 'SEABOARD_HAITI', name: "Seaboard d'Haiti S.A.", lineDirect: true },
  { code: 'SONTRAM', name: 'SONTRAM S.A.', lineDirect: false },
  { code: 'RVAM', name: 'RVAM (Reginald Villard Agences Maritimes)', lineDirect: false },
  { code: 'JOEL_LAFORTUNE', name: 'Joel Lafortune (agency)', lineDirect: false },
];

/** Which agent/office collects for each shipping line (charge routing key). */
const LINE_TO_AGENT: Record<string, string> = {
  'Maersk Line': 'AGEMAR', 'Sealand (Maersk)': 'AGEMAR', MOL: 'AGEMAR', 'Alaska Transport': 'AGEMAR',
  MSC: 'MSC_HAITI',
  'CMA CGM': 'JB_VITAL', 'Hamburg Sud': 'JB_VITAL',
  'Hapag-Lloyd': 'ENMARCOLDA', Crowley: 'ENMARCOLDA', CSA: 'ENMARCOLDA', 'V-Chilean Line': 'ENMARCOLDA',
  ZIM: 'NADAL', 'Caribbean Feeder Service': 'NADAL',
  Evergreen: 'SAMAR',
  'King Ocean': 'DEMSA', COSCO: 'DEMSA',
  ONE: 'ADEKO', 'Hoegh Autoliners': 'ADEKO', Marfret: 'ADEKO',
  'K-Line': 'MADSEN',
  'NYK Line': 'ANTOINE_HOGARTH', 'Hyundai (autos)': 'ANTOINE_HOGARTH', NOS: 'ANTOINE_HOGARTH',
  "d'Amico": 'ANTOINE_HOGARTH', 'Lauro Line': 'ANTOINE_HOGARTH', 'Sea Group': 'ANTOINE_HOGARTH', Inchcape: 'ANTOINE_HOGARTH',
  'Antillean Marine': 'ANTILLEAN_HAITI',
  'Seaboard Marine': 'SEABOARD_HAITI',
  Maramerica: 'SONTRAM', 'Coral Trading': 'SONTRAM', 'SCM Lines': 'SONTRAM', Sunbulk: 'SONTRAM',
  'Shell (tanker)': 'RVAM', 'ExxonMobil (tanker)': 'RVAM', 'Total (tanker)': 'RVAM',
  'ChevronTexaco (tanker)': 'RVAM', 'Stena Bulk (tanker)': 'RVAM', 'Jo Tankers': 'RVAM', 'Stolt Nielsen (tanker)': 'RVAM',
  Cargill: 'JOEL_LAFORTUNE', Murmansk: 'JOEL_LAFORTUNE', 'Southern Shipping': 'JOEL_LAFORTUNE',
};

interface SeedOrg {
  type: OrgType;
  legalName: string;
  users: { name: string; email: string; role: Role }[];
}

const SEED: SeedOrg[] = [
  {
    type: 'SHIPPING_LINE',
    legalName: 'CMA CGM Haiti (Demo)',
    users: [{ name: 'Line Agent', email: 'line@rezo.test', role: 'SHIPPING_LINE' }],
  },
  {
    type: 'IMPORTER',
    legalName: 'Import Ayiti S.A. (Demo)',
    users: [{ name: 'Import Manager', email: 'importer@rezo.test', role: 'IMPORTER' }],
  },
  {
    type: 'BROKER',
    legalName: 'Cap Customs Brokers (Demo)',
    users: [{ name: 'Broker Lead', email: 'broker@rezo.test', role: 'BROKER' }],
  },
  {
    type: 'TRUCKER',
    legalName: 'Transpò Rapid (Demo)',
    users: [{ name: 'Fleet Dispatcher', email: 'trucker@rezo.test', role: 'TRUCKER' }],
  },
  {
    type: 'TERMINAL',
    legalName: 'CPS Terminal Port-au-Prince (Demo)',
    users: [{ name: 'Terminal Operator', email: 'terminal@rezo.test', role: 'TERMINAL' }],
  },
  {
    type: 'CUSTOMS',
    legalName: 'AGD — Administration Générale des Douanes (Demo)',
    users: [{ name: 'Customs Officer', email: 'customs@rezo.test', role: 'CUSTOMS' }],
  },
  {
    type: 'BANK',
    legalName: 'Unibank (Demo)',
    users: [{ name: 'Bank Liaison', email: 'bank@rezo.test', role: 'BANK' }],
  },
  {
    type: 'GOV',
    legalName: 'Ministère des Finances (Demo)',
    users: [{ name: 'Gov Viewer', email: 'gov@rezo.test', role: 'GOV_VIEWER' }],
  },
  {
    type: 'REZO',
    legalName: 'Rezo (MACCO LLC)',
    users: [
      { name: 'Rezo Admin', email: 'admin@rezo.test', role: 'REZO_ADMIN' },
      { name: 'Rezo Ops', email: 'ops@rezo.test', role: 'REZO_OPS' },
    ],
  },
];

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  for (const s of SEED) {
    // One org per type. Match on (type, legalName) so re-runs don't duplicate.
    const existing = await prisma.organization.findFirst({
      where: { type: s.type, legalName: s.legalName },
    });
    const org =
      existing ??
      (await prisma.organization.create({
        data: { type: s.type, legalName: s.legalName, country: 'HT', kycStatus: 'VERIFIED' },
      }));

    for (const u of s.users) {
      await prisma.user.upsert({
        where: { email: u.email },
        update: { name: u.name, role: u.role, orgId: org.id },
        create: {
          orgId: org.id,
          name: u.name,
          email: u.email,
          role: u.role,
          passwordHash,
        },
      });
    }
    console.log(`✓ ${s.type.padEnd(14)} ${s.legalName}  (${s.users.map((u) => u.email).join(', ')})`);
  }

  await seedMarketAndPayees();
  await seedShippingAgents();
  await seedFxRates();
  // Demo containers/charges/notifications only when SEED_DEMO=true (local demos).
  // Production deploys start clean; any pre-existing demo dataset is removed so
  // the Containers view shows only real, user-entered containers.
  if (process.env.SEED_DEMO === 'true') {
    await seedDemoDataset();
    await seedSubscriptions();
    await seedNotifications();
  } else {
    await removeDemoDataset();
  }

  const orgCount = await prisma.organization.count();
  const userCount = await prisma.user.count();
  console.log(`\nSeed complete: ${orgCount} organizations, ${userCount} users.`);
  console.log(`All seeded users share the dev password: "${DEV_PASSWORD}"`);
}

/**
 * Removes the demo dataset (the "MV Kreyòl Star" voyage and everything hanging
 * off it) if present, in FK-safe order. Real, user-entered containers use a
 * different vessel, so they are never touched — and once the demo vessel is
 * gone this is a no-op, so it's safe to run on every deploy.
 */
async function removeDemoDataset(): Promise<void> {
  const vessel = await prisma.vessel.findUnique({ where: { imo: 'IMO9310001' } });
  if (!vessel) {
    console.log('• No demo dataset present.');
    return;
  }
  const voyages = await prisma.voyage.findMany({ where: { vesselId: vessel.id }, select: { id: true } });
  const voyageIds = voyages.map((v) => v.id);
  const manifests = await prisma.manifest.findMany({ where: { voyageId: { in: voyageIds } }, select: { id: true } });
  const manifestIds = manifests.map((m) => m.id);
  const bls = await prisma.billOfLading.findMany({ where: { manifestId: { in: manifestIds } }, select: { id: true } });
  const blIds = bls.map((b) => b.id);
  const containers = await prisma.container.findMany({ where: { blId: { in: blIds } }, select: { id: true } });
  const ids = containers.map((c) => c.id);

  if (ids.length > 0) {
    await prisma.deadlineAlert.deleteMany({ where: { containerId: { in: ids } } });
    await prisma.deadline.deleteMany({ where: { containerId: { in: ids } } });
    await prisma.verificationTask.deleteMany({ where: { containerId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { containerId: { in: ids } } });
    await prisma.paymentRouting.deleteMany({ where: { request: { containerId: { in: ids } } } });
    await prisma.charge.deleteMany({ where: { containerId: { in: ids } } });
    await prisma.paymentRequest.deleteMany({ where: { containerId: { in: ids } } });
    await prisma.document.deleteMany({ where: { containerId: { in: ids } } });
    await prisma.gateAppointment.deleteMany({ where: { containerId: { in: ids } } });
    await prisma.transportJob.deleteMany({ where: { containerId: { in: ids } } });
    await prisma.container.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.billOfLading.deleteMany({ where: { id: { in: blIds } } });
  await prisma.manifest.deleteMany({ where: { id: { in: manifestIds } } });
  await prisma.voyage.deleteMany({ where: { id: { in: voyageIds } } });
  await prisma.vessel.delete({ where: { id: vessel.id } });
  console.log(`• Removed demo dataset (${ids.length} demo container(s)).`);
}

/**
 * Seed every shipping-line agent / line-direct office as an Organization plus a
 * LINE-type Payee, so the billing view can show what is owed to each. Idempotent
 * (matches on legal name).
 */
async function seedShippingAgents(): Promise<void> {
  let created = 0;
  for (const a of SHIPPING_AGENTS) {
    const org =
      (await prisma.organization.findFirst({ where: { legalName: a.name } })) ??
      (await prisma.organization.create({
        data: { type: 'SHIPPING_LINE', legalName: a.name, country: 'HT', kycStatus: 'VERIFIED' },
      }));
    await prisma.payee.upsert({
      where: { orgId_type: { orgId: org.id, type: 'LINE' } },
      update: { name: a.name },
      create: { orgId: org.id, name: a.name, type: 'LINE', settlementRef: `stlm_${a.code.toLowerCase()}` },
    });
    created++;
  }
  console.log(`• Shipping agents/line offices seeded: ${created} payees (type LINE).`);
}

/**
 * Demo notifications (spec §6) so the redesigned Alerts page + bell are
 * populated on first login. Spans event types and severities across a few
 * users. Idempotent: skipped once any notification exists.
 */
async function seedNotifications(): Promise<void> {
  if ((await prisma.notification.count()) > 0) {
    console.log('• Notifications already present — skipping.');
    return;
  }
  const now = Date.now();
  const ago = (mins: number) => new Date(now - mins * 60_000);
  const userByEmail = async (email: string) => prisma.user.findUnique({ where: { email } });
  const cId = async (num: string) => (await prisma.container.findUnique({ where: { containerNumber: num }, select: { id: true } }))?.id ?? null;

  const importer1 = await userByEmail('importer@rezo.test');
  const importer2 = await userByEmail('importer2@rezo.test');
  const ops = await userByEmail('ops@rezo.test');
  if (!importer1) return;

  type N = {
    user: { id: string; orgId: string } | null;
    type: string; severity: string; container: string | null; title: string; body: string;
    amount?: number; channel?: string; read?: boolean; when: Date; link?: string;
  };
  const rows: N[] = [
    { user: importer1, type: 'DEADLINE_REMINDER', severity: 'CRITICAL', container: 'CMAU2223334', title: 'Last free day tomorrow', body: 'Container CMAU2223334 — 1 day left. Settle charges to avoid demurrage.', amount: 6000, when: ago(30) },
    { user: importer1, type: 'PAYMENT_FAILED', severity: 'CRITICAL', container: 'CMAU2223334', title: 'Payment failed', body: 'A payee routing did not settle. Review and retry the failed portion.', when: ago(90) },
    { user: importer1, type: 'DEADLINE_REMINDER', severity: 'SOON', container: 'MSCU4455662', title: 'Last free day in 3 days', body: 'Container MSCU4455662 — 3 days left before storage begins.', amount: 3000, when: ago(240) },
    { user: importer1, type: 'CHARGE_ADDED', severity: 'INFO', container: 'CMAU9998887', title: 'New charge added', body: 'A demurrage charge was added to CMAU9998887.', amount: 45000, when: ago(300) },
    { user: importer1, type: 'PAYMENT_CONFIRMED', severity: 'INFO', container: 'CMAU7654321', title: 'Payment confirmed', body: 'Your payment was authorized and routed directly to every payee.', read: true, when: ago(1440) },
    { user: importer1, type: 'GATE_APPOINTMENT_CONFIRMED', severity: 'INFO', container: 'CMAU7654321', title: 'Gate appointment confirmed', body: 'The terminal confirmed the gate slot for CMAU7654321.', read: true, when: ago(1500) },
    { user: importer2, type: 'CONTAINER_RELEASED', severity: 'INFO', container: 'MAEU5566771', title: 'Customs cleared', body: 'MAEU5566771 cleared customs and is ready to gate out.', when: ago(120) },
    { user: importer2, type: 'TRUCKING_JOB_OFFERED', severity: 'INFO', container: 'MAEU5566771', title: 'Trucking job posted', body: 'CPS Terminal → Distribution Nord depot, Cap-Haïtien.', when: ago(150) },
    { user: ops, type: 'VERIFICATION_NEEDED', severity: 'SOON', container: 'MSCU4455663', title: 'Verification needed', body: '1 low-confidence charge on MSCU4455663 needs review before it can be paid.', when: ago(60) },
  ];

  let created = 0;
  for (const r of rows) {
    if (!r.user) continue;
    const containerId = r.container ? await cId(r.container) : null;
    await prisma.notification.create({
      data: {
        type: r.type as never,
        severity: r.severity as never,
        recipientOrgId: r.user.orgId,
        recipientUserId: r.user.id,
        containerId,
        title: r.title,
        body: r.body,
        amountAtRisk: r.amount ?? null,
        amountCurrency: r.amount ? 'USD' : null,
        channel: (r.channel as never) ?? 'IN_APP',
        deepLink: containerId ? `/dashboard/containers/${containerId}` : (r.link ?? '/dashboard/alerts'),
        readAt: r.read ? r.when : null,
        createdAt: r.when,
      },
    });
    created++;
  }
  console.log(`• Notifications seeded: ${created} across event types + severities.`);
}

/** Demo subscriptions (spec §2.2), priced from the tariff. Idempotent. */
async function seedSubscriptions(): Promise<void> {
  if ((await prisma.subscription.count()) > 0) {
    console.log('• Subscriptions already present — skipping.');
    return;
  }
  const broker = await prisma.organization.findFirstOrThrow({ where: { type: 'BROKER' } });
  const line = await prisma.organization.findFirstOrThrow({ where: { type: 'SHIPPING_LINE' } });
  const plans = HT_TARIFF.subscription_plans;
  const renewal = new Date('2026-08-22T00:00:00.000Z');
  await prisma.subscription.createMany({
    data: [
      { orgId: broker.id, plan: 'LARGE_BROKER', term: 'MONTHLY', price: plans.large_broker.monthly, currency: HT_TARIFF.currency, renewalDate: renewal },
      { orgId: line.id, plan: 'LINE', term: 'ANNUAL', price: plans.line.annual, currency: HT_TARIFF.currency, renewalDate: new Date('2027-07-22T00:00:00.000Z') },
    ],
  });
  console.log('• Subscriptions seeded (broker + line).');
}

/** Mock FX rates (spec §7). USD is the base charge currency; HTG is the gourde. */
async function seedFxRates(): Promise<void> {
  if ((await prisma.fxRate.count()) > 0) {
    console.log('• FX rates already present — skipping.');
    return;
  }
  await prisma.fxRate.createMany({
    data: [
      { baseCurrency: 'USD', quoteCurrency: 'HTG', rate: 132.0, source: 'mock' },
      { baseCurrency: 'HTG', quoteCurrency: 'USD', rate: 1 / 132.0, source: 'mock' },
    ],
  });
  console.log('• FX rates seeded (USD↔HTG).');
}

/** Market config (HT) + the payee registry. Idempotent. */
async function seedMarketAndPayees(): Promise<void> {
  await prisma.market.upsert({
    where: { code: 'HT' },
    update: { tariff: HT_TARIFF },
    create: {
      code: 'HT',
      name: 'Haiti',
      baseCurrency: 'USD',
      currencies: ['USD', 'HTG'],
      languages: ['fr', 'ht', 'es', 'en'],
      enabledModules: ['data_hub', 'charges', 'deadlines'],
      tariff: HT_TARIFF,
    },
  });

  const customs = await prisma.organization.findFirstOrThrow({ where: { type: 'CUSTOMS' } });
  const terminal = await prisma.organization.findFirstOrThrow({ where: { type: 'TERMINAL' } });
  const rezo = await prisma.organization.findFirstOrThrow({ where: { type: 'REZO' } });

  // Broker clears for the demo importer (spec §2.3) so it can see the containers.
  const broker = await prisma.organization.findFirstOrThrow({ where: { type: 'BROKER' } });
  const importerForBroker = await prisma.organization.findFirstOrThrow({ where: { type: 'IMPORTER' } });
  await prisma.brokerClient.upsert({
    where: { brokerOrgId_importerOrgId: { brokerOrgId: broker.id, importerOrgId: importerForBroker.id } },
    update: {},
    create: { brokerOrgId: broker.id, importerOrgId: importerForBroker.id },
  });

  // Port authority (APN) as a GOV org, used as the port-dues payee.
  const apnName = 'Autorité Portuaire Nationale (APN) (Demo)';
  const apn =
    (await prisma.organization.findFirst({ where: { legalName: apnName } })) ??
    (await prisma.organization.create({
      data: { type: 'GOV', legalName: apnName, country: 'HT', kycStatus: 'VERIFIED' },
    }));

  const payees: { orgId: string; name: string; type: 'CUSTOMS' | 'PORT' | 'TERMINAL' | 'REZO'; ref: string }[] = [
    { orgId: customs.id, name: 'AGD — Customs duties & fees', type: 'CUSTOMS', ref: 'stlm_agd_ht' },
    { orgId: apn.id, name: 'APN — Port dues & scanning', type: 'PORT', ref: 'stlm_apn_ht' },
    { orgId: terminal.id, name: 'CPS — Terminal charges', type: 'TERMINAL', ref: 'stlm_cps_ht' },
    { orgId: rezo.id, name: 'Rezo — platform fee', type: 'REZO', ref: 'stlm_rezo_ht' },
  ];
  for (const p of payees) {
    await prisma.payee.upsert({
      where: { orgId_type: { orgId: p.orgId, type: p.type } },
      update: { name: p.name, settlementRef: p.ref },
      create: { orgId: p.orgId, name: p.name, type: p.type, settlementRef: p.ref },
    });
  }
  console.log('• Market HT + payees (customs/port/terminal/rezo) ready.');
}

const DAY_MS = 86_400_000;
const ALERT_OFFSETS = [30, 14, 7, 3, 1, 0];
const ALERT_CHANNELS: AlertChannel[] = ['IN_APP', 'EMAIL'];

type Container = Awaited<ReturnType<typeof prisma.container.create>>;
type Charge = Awaited<ReturnType<typeof prisma.charge.create>>;
type PayeeOrgIds = { customs: string; port: string; terminal: string; rezo: string };

/**
 * Build step 14 — a realistic, self-contained demo dataset so the whole
 * platform is demoable without any live integration. One voyage (MV Kreyòl
 * Star) carries ~10 containers across 3 bills of lading for two importers; a
 * broker clears for both. Containers are spread across the lifecycle (arrived →
 * cleared → released → gated-out) with config-driven charges, tracked
 * deadlines + scheduled alerts, a low-confidence document in the verification
 * queue, trucking jobs and gate appointments, and settled payment records that
 * route money payer → payee directly (Rezo holds none). All amounts come from
 * HT_TARIFF (config, never hard-coded). Idempotent: skipped once a manifest
 * exists.
 */
async function seedDemoDataset(): Promise<void> {
  if ((await prisma.manifest.count()) > 0) {
    console.log('• Demo dataset already present — skipping.');
    return;
  }

  const now = new Date();
  const daysAgo = (n: number): Date => new Date(now.getTime() - n * DAY_MS);
  const daysFromNow = (n: number): Date => new Date(now.getTime() + n * DAY_MS);
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  const line = await prisma.organization.findFirstOrThrow({ where: { type: 'SHIPPING_LINE' } });
  const terminalOrg = await prisma.organization.findFirstOrThrow({ where: { type: 'TERMINAL' } });
  const broker = await prisma.organization.findFirstOrThrow({ where: { type: 'BROKER' } });
  const trucker = await prisma.organization.findFirstOrThrow({ where: { type: 'TRUCKER' } });
  // importer[0] alphabetically must stay "Import Ayiti" (the e2e suites act as
  // importer@rezo.test against directory[0]); name the second importer so it
  // sorts after it.
  const importer1 = await prisma.organization.findFirstOrThrow({ where: { legalName: 'Import Ayiti S.A. (Demo)' } });
  const importer2 =
    (await prisma.organization.findFirst({ where: { legalName: 'Import Nord Distribution S.A. (Demo)' } })) ??
    (await prisma.organization.create({
      data: { type: 'IMPORTER', legalName: 'Import Nord Distribution S.A. (Demo)', country: 'HT', kycStatus: 'VERIFIED' },
    }));
  await prisma.user.upsert({
    where: { email: 'importer2@rezo.test' },
    update: { name: 'Nord Import Manager', role: 'IMPORTER', orgId: importer2.id },
    create: { orgId: importer2.id, name: 'Nord Import Manager', email: 'importer2@rezo.test', role: 'IMPORTER', passwordHash },
  });
  // The broker clears for BOTH importers (spec §2.3: one login, many importers).
  for (const imp of [importer1, importer2]) {
    await prisma.brokerClient.upsert({
      where: { brokerOrgId_importerOrgId: { brokerOrgId: broker.id, importerOrgId: imp.id } },
      update: {},
      create: { brokerOrgId: broker.id, importerOrgId: imp.id },
    });
  }

  const payees: PayeeOrgIds = {
    customs: (await prisma.payee.findFirstOrThrow({ where: { type: 'CUSTOMS' } })).orgId,
    port: (await prisma.payee.findFirstOrThrow({ where: { type: 'PORT' } })).orgId,
    terminal: (await prisma.payee.findFirstOrThrow({ where: { type: 'TERMINAL' } })).orgId,
    rezo: (await prisma.payee.findFirstOrThrow({ where: { type: 'REZO' } })).orgId,
  };

  // The accounts / payees / market / broker setup above is idempotent (upsert /
  // find-first), so it is safe to re-run on every deploy. The demo dataset below
  // uses plain create() with unique keys, so guard it: if the demo voyage's
  // vessel already exists, this DB has been seeded — stop here and preserve
  // whatever data (demo or real) is already there.
  if (await prisma.vessel.findUnique({ where: { imo: 'IMO9310001' } })) {
    console.log('Rezo seed: accounts ensured; demo dataset already present — skipping.');
    return;
  }

  // One voyage; a manifest with three bills of lading.
  const eta = daysAgo(10);
  const vessel = await prisma.vessel.create({ data: { name: 'MV Kreyòl Star', imo: 'IMO9310001', lineOrgId: line.id } });
  const voyage = await prisma.voyage.create({ data: { vesselId: vessel.id, voyageNumber: 'VY-2026-014', eta, port: 'Port-au-Prince' } });
  const manifest = await prisma.manifest.create({ data: { voyageId: voyage.id, submittedByOrgId: line.id, status: 'PROCESSED' } });

  const blElectronics = await prisma.billOfLading.create({
    data: { manifestId: manifest.id, blNumber: 'BL-CMA-88231', shipper: 'Shenzhen Trading Co.', importerOrgId: importer1.id, description: 'Assorted consumer electronics' },
  });
  const blConstruction = await prisma.billOfLading.create({
    data: { manifestId: manifest.id, blNumber: 'BL-CMA-88232', shipper: 'Zhejiang BuildCo Ltd.', importerOrgId: importer1.id, description: 'Construction materials & fixtures' },
  });
  const blFood = await prisma.billOfLading.create({
    data: { manifestId: manifest.id, blNumber: 'BL-MAEU-70110', shipper: 'Santo Domingo Foods SRL', importerOrgId: importer2.id, description: 'Food & beverage (refrigerated)' },
  });

  // Container plan: each entry describes the BL, importer, size, arrival, the
  // lifecycle stage to advance to, and whether a customs duty applies.
  type Stage = 'ARRIVED' | 'CLEARED' | 'RELEASED' | 'GATED_OUT';
  interface Plan {
    number: string;
    bl: { id: string };
    importerOrgId: string;
    size: 'TWENTY' | 'FORTY' | 'REEFER';
    arrival: Date;
    stage: Stage;
    customs: boolean;
    pendingReview?: boolean;
  }
  const plans: Plan[] = [
    { number: 'CMAU1234567', bl: blElectronics, importerOrgId: importer1.id, size: 'FORTY', arrival: daysAgo(10), stage: 'GATED_OUT', customs: true },
    { number: 'CMAU7654321', bl: blElectronics, importerOrgId: importer1.id, size: 'TWENTY', arrival: daysAgo(8), stage: 'CLEARED', customs: false },
    { number: 'CMAU9998887', bl: blElectronics, importerOrgId: importer1.id, size: 'REEFER', arrival: daysAgo(3), stage: 'ARRIVED', customs: false },
    { number: 'CMAU2223334', bl: blElectronics, importerOrgId: importer1.id, size: 'FORTY', arrival: daysAgo(3), stage: 'ARRIVED', customs: true },
    { number: 'MSCU4455661', bl: blConstruction, importerOrgId: importer1.id, size: 'FORTY', arrival: daysAgo(9), stage: 'GATED_OUT', customs: true },
    { number: 'MSCU4455662', bl: blConstruction, importerOrgId: importer1.id, size: 'TWENTY', arrival: daysAgo(2), stage: 'ARRIVED', customs: false },
    { number: 'MSCU4455663', bl: blConstruction, importerOrgId: importer1.id, size: 'FORTY', arrival: daysAgo(2), stage: 'ARRIVED', customs: false, pendingReview: true },
    { number: 'MAEU5566771', bl: blFood, importerOrgId: importer2.id, size: 'REEFER', arrival: daysAgo(7), stage: 'RELEASED', customs: true },
    { number: 'MAEU5566772', bl: blFood, importerOrgId: importer2.id, size: 'FORTY', arrival: daysAgo(3), stage: 'ARRIVED', customs: false },
    { number: 'MAEU5566773', bl: blFood, importerOrgId: importer2.id, size: 'TWENTY', arrival: daysAgo(4), stage: 'ARRIVED', customs: true },
  ];

  // Demo shipping lines assigned (in order) to the ARRIVED containers, so their
  // line charge routes to a spread of real Haiti agents (AGEMAR, MSC Haiti, …).
  const DEMO_LINES = ['Maersk Line', 'MSC', 'CMA CGM', 'Hapag-Lloyd', 'ZIM', 'Evergreen'];
  const agentOrgByCode = new Map<string, string>();
  for (const a of SHIPPING_AGENTS) {
    const org = await prisma.organization.findFirst({ where: { legalName: a.name } });
    if (org) agentOrgByCode.set(a.code, org.id);
  }

  const byNumber = new Map<string, { container: Container; charges: Charge[]; stage: Stage }>();
  let chargeCount = 0;
  let deadlineCount = 0;
  let alertCount = 0;
  let lineChargeIdx = 0;

  for (const p of plans) {
    const milestones = stageMilestones(p.stage, p.arrival, daysAgo);
    const container = await prisma.container.create({
      data: {
        blId: p.bl.id,
        containerNumber: p.number,
        sizeType: p.size,
        importerOrgId: p.importerOrgId,
        terminalOrgId: terminalOrg.id,
        arrivalDate: p.arrival,
        status: p.stage,
        clearedAt: milestones.clearedAt,
        releasedAt: milestones.releasedAt,
        gatedOutAt: milestones.gatedOutAt,
      },
    });

    const charges = await addStandardCharges(container, payees, { customs: p.customs });
    chargeCount += charges.length;

    // A low-confidence terminal invoice sitting in the Ops verification queue.
    if (p.pendingReview) {
      const doc = await prisma.document.create({
        data: {
          containerId: container.id,
          uploadedByOrgId: terminalOrg.id,
          source: 'EMAIL',
          docType: 'TERMINAL_INVOICE',
          language: 'fr',
          fileRef: `seed/demo/${p.number}-terminal-invoice.pdf`,
          fileName: `${p.number}-terminal-invoice.pdf`,
          rawText: 'FACTURE TERMINAL — manutention, frais de stockage. Montant partiellement lisible.',
          extractionConfidence: 0.62,
          verificationStatus: 'NEEDS_REVIEW',
        },
      });
      const reviewCharge = await prisma.charge.create({
        data: {
          containerId: container.id,
          payeeOrgId: payees.terminal,
          type: 'STORAGE',
          amount: 4500,
          currency: HT_TARIFF.currency,
          status: 'PENDING_REVIEW',
          reviewState: 'PENDING',
          source: 'DOCUMENT',
          dueDate: new Date(p.arrival.getTime() + 5 * DAY_MS),
        },
      });
      chargeCount++;
      await prisma.verificationTask.create({
        data: {
          documentId: doc.id,
          chargeId: reviewCharge.id,
          containerId: container.id,
          field: 'storage_amount',
          confidence: 0.62,
          status: 'OPEN',
          beforeValue: { field: 'storage_amount', amount: 4500 },
        },
      });
    }

    // Shipping/line charge on containers still in port, routed to the agent that
    // collects for the container's (demo) shipping line — so the billing view
    // shows amounts owed to the real Haiti agents (AGEMAR, MSC Haiti, …).
    if (p.stage === 'ARRIVED') {
      const demoLine = DEMO_LINES[lineChargeIdx % DEMO_LINES.length];
      const agentOrgId = agentOrgByCode.get(LINE_TO_AGENT[demoLine]);
      if (agentOrgId) {
        const lineCharge = await prisma.charge.create({
          data: {
            containerId: container.id,
            payeeOrgId: agentOrgId,
            type: 'DEMURRAGE',
            amount: 45000 + (lineChargeIdx % 4) * 15000,
            currency: HT_TARIFF.currency,
            status: 'PENDING',
            source: 'MANUAL',
            dueDate: new Date(p.arrival.getTime() + 5 * DAY_MS),
          },
        });
        charges.push(lineCharge);
        chargeCount++;
      }
      lineChargeIdx++;
    }

    // Deadlines + alerts only matter while the box is still in port.
    if (p.stage === 'ARRIVED' || p.stage === 'CLEARED') {
      const d = await createDeadlinesAndAlerts(container, charges);
      deadlineCount += d.deadlines;
      alertCount += d.alerts;
    }

    // Advance-and-settle: paid containers get a settled payment request that
    // routes each payee's total directly, plus the explicit Rezo fee line.
    if (p.stage !== 'ARRIVED') {
      await settleContainer(container, p.importerOrgId, charges, payees.rezo, milestones.settledAt);
    }

    byNumber.set(p.number, { container, charges, stage: p.stage });
  }

  await seedLogistics(byNumber, trucker.id, terminalOrg.id, daysAgo, daysFromNow);

  const importerCount = 2;
  console.log(
    `• Demo dataset: 1 voyage, 3 BLs, ${plans.length} containers (${importerCount} importers, broker on both), ` +
      `${chargeCount} charges, ${deadlineCount} deadlines / ${alertCount} alerts, ` +
      `${plans.filter((p) => p.stage !== 'ARRIVED').length} settled + advanced.`,
  );
}

/** Milestone timestamps for a container's target lifecycle stage. */
function stageMilestones(
  stage: 'ARRIVED' | 'CLEARED' | 'RELEASED' | 'GATED_OUT',
  arrival: Date,
  daysAgo: (n: number) => Date,
): { clearedAt: Date | null; releasedAt: Date | null; gatedOutAt: Date | null; settledAt: Date } {
  switch (stage) {
    case 'GATED_OUT':
      return { clearedAt: daysAgo(6), releasedAt: daysAgo(5), gatedOutAt: daysAgo(4), settledAt: daysAgo(6) };
    case 'RELEASED':
      return { clearedAt: daysAgo(3), releasedAt: daysAgo(2), gatedOutAt: null, settledAt: daysAgo(3) };
    case 'CLEARED':
      return { clearedAt: daysAgo(2), releasedAt: null, gatedOutAt: null, settledAt: daysAgo(2) };
    default:
      return { clearedAt: null, releasedAt: null, gatedOutAt: null, settledAt: arrival };
  }
}

/** Config-driven standard charges for a container (spec §7). Amounts from tariff. */
async function addStandardCharges(container: Container, payees: PayeeOrgIds, opts: { customs: boolean }): Promise<Charge[]> {
  const lfd = container.arrivalDate ? new Date(container.arrivalDate.getTime() + 5 * DAY_MS) : new Date();
  const th = HT_TARIFF.terminal_handling[container.sizeType as keyof typeof HT_TARIFF.terminal_handling];
  type Row = { payeeOrgId: string; type: ChargeType; amount: number; source: ChargeSource; lastFreeDay?: Date };
  const rows: Row[] = [
    { payeeOrgId: payees.terminal, type: 'TERMINAL_HANDLING', amount: th, source: 'OCTOPI', lastFreeDay: lfd },
    { payeeOrgId: payees.port, type: 'PORT_DUES', amount: HT_TARIFF.port_dues.flat, source: 'OCTOPI' },
    { payeeOrgId: payees.port, type: 'SCANNING', amount: HT_TARIFF.scanning.flat, source: 'OCTOPI' },
  ];
  if (opts.customs) {
    rows.push({ payeeOrgId: payees.customs, type: 'CUSTOMS_DUTY', amount: 120000, source: 'ASYCUDA' });
    rows.push({ payeeOrgId: payees.customs, type: 'CUSTOMS_FEE', amount: HT_TARIFF.customs_fee.flat, source: 'ASYCUDA' });
  }
  const created: Charge[] = [];
  for (const r of rows) {
    created.push(
      await prisma.charge.create({
        data: {
          containerId: container.id,
          payeeOrgId: r.payeeOrgId,
          type: r.type,
          amount: r.amount,
          currency: HT_TARIFF.currency,
          status: 'PENDING',
          source: r.source,
          dueDate: lfd,
          lastFreeDay: r.lastFreeDay ?? null,
        },
      }),
    );
  }
  return created;
}

/**
 * Deadlines + scheduled alerts for a container, mirroring
 * DeadlineService.recomputeForContainer. Alerts whose scheduled time has passed
 * are PENDING and get delivered on the next dispatcher tick — so at least one
 * alert fires before a deadline (Phase 1 acceptance #4).
 */
async function createDeadlinesAndAlerts(container: Container, charges: Charge[]): Promise<{ deadlines: number; alerts: number }> {
  const earliest = new Map<string, Date>();
  for (const ch of charges) {
    if (!ch.lastFreeDay) continue;
    const cur = earliest.get(ch.payeeOrgId);
    if (!cur || ch.lastFreeDay < cur) earliest.set(ch.payeeOrgId, ch.lastFreeDay);
  }
  let deadlines = 0;
  let alerts = 0;
  for (const [payeeOrgId, datetime] of earliest) {
    const payee = await prisma.organization.findUnique({ where: { id: payeeOrgId } });
    const deadline = await prisma.deadline.create({
      data: { containerId: container.id, payeeOrgId, type: 'LAST_FREE_DAY', datetime, alertSchedule: ALERT_OFFSETS },
    });
    deadlines++;
    for (const offsetDays of ALERT_OFFSETS) {
      const scheduledFor = new Date(datetime.getTime() - offsetDays * DAY_MS);
      const day = datetime.toISOString().slice(0, 10);
      const message = `Last free day for container ${container.containerNumber} (${payee?.legalName ?? 'payee'}) is in ${offsetDays} day(s) — ${day}. Settle charges to avoid storage/demurrage.`;
      for (const channel of ALERT_CHANNELS) {
        await prisma.deadlineAlert.create({
          data: {
            deadlineId: deadline.id,
            containerId: container.id,
            recipientOrgId: container.importerOrgId,
            channel,
            offsetDays,
            scheduledFor,
            message,
          },
        });
        alerts++;
      }
    }
  }
  return { deadlines, alerts };
}

/**
 * Record a settled payment for a container: one direct routing per payee (the
 * sum of that payee's charges) plus the explicit Rezo fee line. Money moves
 * payer → payee directly; Rezo holds none. Marks the covered charges PAID.
 * FX is trivial here (USD → USD) but the frozen rate is still recorded.
 */
async function settleContainer(
  container: Container,
  importerOrgId: string,
  charges: Charge[],
  rezoPayeeOrgId: string,
  settledAt: Date,
): Promise<void> {
  const payable = charges.filter((c) => c.status === 'PENDING');
  if (payable.length === 0) return;

  const byPayee = new Map<string, number>();
  for (const c of payable) byPayee.set(c.payeeOrgId, (byPayee.get(c.payeeOrgId) ?? 0) + c.amount);

  const rezoFee = HT_TARIFF.rezo_fee.flat;
  let gross = rezoFee;
  const routings: {
    payeeOrgId: string;
    chargeCurrency: string;
    chargeAmount: number;
    fxRate: number;
    settlementAmount: number;
    rail: string;
    railTxnRef: string;
    status: 'SETTLED';
    isRezoFee: boolean;
  }[] = [];
  let idx = 0;
  for (const [payeeOrgId, amount] of byPayee) {
    gross += amount;
    routings.push({
      payeeOrgId,
      chargeCurrency: HT_TARIFF.currency,
      chargeAmount: amount,
      fxRate: 1.0,
      settlementAmount: amount,
      rail: 'mock_rail',
      railTxnRef: `mocktxn_${container.containerNumber}_${idx++}`,
      status: 'SETTLED',
      isRezoFee: false,
    });
  }
  routings.push({
    payeeOrgId: rezoPayeeOrgId,
    chargeCurrency: HT_TARIFF.currency,
    chargeAmount: rezoFee,
    fxRate: 1.0,
    settlementAmount: rezoFee,
    rail: 'mock_rail',
    railTxnRef: `mocktxn_${container.containerNumber}_fee`,
    status: 'SETTLED',
    isRezoFee: true,
  });

  const pr = await prisma.paymentRequest.create({
    data: {
      idempotencyKey: `seed-pr-${container.containerNumber}`,
      containerId: container.id,
      importerOrgId,
      settlementCurrency: HT_TARIFF.currency,
      grossAmountSettlement: gross,
      rezoFee,
      status: 'SETTLED',
      railRef: `mock_rail_ref_${container.containerNumber}`,
      authorizedAt: settledAt,
      settledAt,
      routings: { create: routings },
    },
  });
  await prisma.charge.updateMany({
    where: { id: { in: payable.map((c) => c.id) } },
    data: { status: 'PAID', paymentRequestId: pr.id },
  });
}

/**
 * Trucking jobs + gate appointments across the lifecycle (spec §2.4): one open
 * offer a trucker can accept, one active job in transit, and one completed
 * pickup with a proof-of-delivery and a completed gate move.
 */
async function seedLogistics(
  byNumber: Map<string, { container: Container; stage: string }>,
  truckerOrgId: string,
  terminalOrgId: string,
  daysAgo: (n: number) => Date,
  daysFromNow: (n: number) => Date,
): Promise<void> {
  const gatedOut = byNumber.get('CMAU1234567');
  const released = byNumber.get('MAEU5566771');
  const cleared = byNumber.get('CMAU7654321');

  // Completed haul on the gated-out box: accepted, delivered with POD + GPS.
  if (gatedOut) {
    await prisma.transportJob.create({
      data: {
        containerId: gatedOut.container.id,
        createdByOrgId: gatedOut.container.importerOrgId,
        truckerOrgId,
        pickup: 'CPS Terminal, Port-au-Prince',
        dropoff: 'Import Ayiti warehouse, Delmas',
        price: 4500,
        currency: HT_TARIFF.currency,
        status: 'DELIVERED',
        insuranceRef: 'mock_ins_CMAU1234567',
        podRef: 'seed/demo/CMAU1234567-pod.jpg',
        gpsLat: 18.5711,
        gpsLng: -72.2895,
        gpsAt: daysAgo(4),
      },
    });
    await prisma.gateAppointment.create({
      data: {
        containerId: gatedOut.container.id,
        truckerOrgId,
        terminalOrgId,
        slotTime: daysAgo(4),
        status: 'COMPLETED',
      },
    });
  }

  // Open offer on the released box: no trucker yet, waiting to be accepted.
  if (released) {
    await prisma.transportJob.create({
      data: {
        containerId: released.container.id,
        createdByOrgId: released.container.importerOrgId,
        truckerOrgId: null,
        pickup: 'CPS Terminal, Port-au-Prince',
        dropoff: 'Distribution Nord depot, Cap-Haïtien',
        price: 9000,
        currency: HT_TARIFF.currency,
        status: 'OFFERED',
      },
    });
  }

  // Active haul on the cleared box: accepted, upcoming confirmed gate slot.
  if (cleared) {
    await prisma.transportJob.create({
      data: {
        containerId: cleared.container.id,
        createdByOrgId: cleared.container.importerOrgId,
        truckerOrgId,
        pickup: 'CPS Terminal, Port-au-Prince',
        dropoff: 'Import Ayiti warehouse, Delmas',
        price: 3800,
        currency: HT_TARIFF.currency,
        status: 'ACCEPTED',
        insuranceRef: 'mock_ins_CMAU7654321',
      },
    });
    await prisma.gateAppointment.create({
      data: {
        containerId: cleared.container.id,
        truckerOrgId,
        terminalOrgId,
        slotTime: daysFromNow(2),
        status: 'CONFIRMED',
      },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
