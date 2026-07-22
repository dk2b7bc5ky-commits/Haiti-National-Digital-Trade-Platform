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
  terminal_handling: { TWENTY: 15000, FORTY: 25000, REEFER: 40000 },
  storage_per_day: { TWENTY: 2000, FORTY: 3000, REEFER: 6000 },
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
  await seedFxRates();
  await seedDemoManifest();
  await seedDemoCharges();
  await seedDeadlines();

  const orgCount = await prisma.organization.count();
  const userCount = await prisma.user.count();
  console.log(`\nSeed complete: ${orgCount} organizations, ${userCount} users.`);
  console.log(`All seeded users share the dev password: "${DEV_PASSWORD}"`);
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

/**
 * Config-driven charges on the demo containers so the consolidated view has
 * content. Amounts come from HT_TARIFF (never hard-coded in app logic).
 * Idempotent: skipped once any charge exists.
 */
async function seedDemoCharges(): Promise<void> {
  if ((await prisma.charge.count()) > 0) {
    console.log('• Demo charges already present — skipping.');
    return;
  }
  const customs = await prisma.payee.findFirstOrThrow({ where: { type: 'CUSTOMS' } });
  const port = await prisma.payee.findFirstOrThrow({ where: { type: 'PORT' } });
  const terminal = await prisma.payee.findFirstOrThrow({ where: { type: 'TERMINAL' } });

  const containers = await prisma.container.findMany({ take: 3, orderBy: { createdAt: 'asc' } });
  let created = 0;
  for (const [i, c] of containers.entries()) {
    const lfd = c.arrivalDate ? new Date(c.arrivalDate) : new Date();
    lfd.setUTCDate(lfd.getUTCDate() + 5);
    const th = HT_TARIFF.terminal_handling[c.sizeType as keyof typeof HT_TARIFF.terminal_handling];
    type Row = { payeeOrgId: string; type: ChargeType; amount: number; source: ChargeSource; dueDate: Date; lastFreeDay?: Date };
    const rows: Row[] = [
      { payeeOrgId: terminal.orgId, type: 'TERMINAL_HANDLING', amount: th, source: 'OCTOPI', lastFreeDay: lfd, dueDate: lfd },
      { payeeOrgId: port.orgId, type: 'PORT_DUES', amount: HT_TARIFF.port_dues.flat, source: 'OCTOPI', dueDate: lfd },
      { payeeOrgId: port.orgId, type: 'SCANNING', amount: HT_TARIFF.scanning.flat, source: 'OCTOPI', dueDate: lfd },
    ];
    // A customs duty on the first container (manual entry from a declaration).
    if (i === 0) {
      rows.push({ payeeOrgId: customs.orgId, type: 'CUSTOMS_DUTY', amount: 120000, source: 'MANUAL', dueDate: lfd });
      rows.push({ payeeOrgId: customs.orgId, type: 'CUSTOMS_FEE', amount: HT_TARIFF.customs_fee.flat, source: 'MANUAL', dueDate: lfd });
    }
    for (const r of rows) {
      await prisma.charge.create({
        data: {
          containerId: c.id,
          payeeOrgId: r.payeeOrgId,
          type: r.type,
          amount: r.amount,
          currency: HT_TARIFF.currency,
          status: 'PENDING',
          source: r.source,
          dueDate: r.dueDate,
          lastFreeDay: r.lastFreeDay ?? null,
        },
      });
      created++;
    }
  }
  console.log(`• Demo charges created: ${created} across ${containers.length} containers (from config tariff).`);
}

const ALERT_OFFSETS = [30, 14, 7, 3, 1, 0];
const ALERT_CHANNELS: AlertChannel[] = ['IN_APP', 'EMAIL'];

/**
 * Deadlines + scheduled alerts for the demo containers (build step 6), mirroring
 * DeadlineService.recomputeForContainer. Alerts whose scheduled time has already
 * passed are PENDING and get delivered on the next dispatcher tick — so at least
 * one alert fires before a deadline (Phase 1 acceptance #4). Idempotent.
 */
async function seedDeadlines(): Promise<void> {
  if ((await prisma.deadline.count()) > 0) {
    console.log('• Deadlines already present — skipping.');
    return;
  }
  const containers = await prisma.container.findMany({
    where: { charges: { some: { lastFreeDay: { not: null } } } },
    include: { charges: true },
  });
  let deadlines = 0;
  let alerts = 0;
  for (const c of containers) {
    const earliest = new Map<string, Date>();
    for (const ch of c.charges) {
      if (!ch.lastFreeDay) continue;
      const cur = earliest.get(ch.payeeOrgId);
      if (!cur || ch.lastFreeDay < cur) earliest.set(ch.payeeOrgId, ch.lastFreeDay);
    }
    for (const [payeeOrgId, datetime] of earliest) {
      const payee = await prisma.organization.findUnique({ where: { id: payeeOrgId } });
      const deadline = await prisma.deadline.create({
        data: { containerId: c.id, payeeOrgId, type: 'LAST_FREE_DAY', datetime, alertSchedule: ALERT_OFFSETS },
      });
      deadlines++;
      for (const offsetDays of ALERT_OFFSETS) {
        const scheduledFor = new Date(datetime.getTime() - offsetDays * 86_400_000);
        const day = datetime.toISOString().slice(0, 10);
        const message = `Last free day for container ${c.containerNumber} (${payee?.legalName ?? 'payee'}) is in ${offsetDays} day(s) — ${day}. Settle charges to avoid storage/demurrage.`;
        for (const channel of ALERT_CHANNELS) {
          await prisma.deadlineAlert.create({
            data: {
              deadlineId: deadline.id,
              containerId: c.id,
              recipientOrgId: c.importerOrgId,
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
  }
  console.log(`• Deadlines: ${deadlines} created, ${alerts} alerts scheduled (from config offsets).`);
}

/**
 * A small demo manifest so container views are non-empty out of the box
 * (build step 3). Idempotent: skipped once any manifest exists. The full
 * realistic dataset is build step 14.
 */
async function seedDemoManifest(): Promise<void> {
  if ((await prisma.manifest.count()) > 0) {
    console.log('• Demo manifest already present — skipping.');
    return;
  }

  const line = await prisma.organization.findFirstOrThrow({ where: { type: 'SHIPPING_LINE' } });
  const importer = await prisma.organization.findFirstOrThrow({ where: { type: 'IMPORTER' } });
  const terminal = await prisma.organization.findFirstOrThrow({ where: { type: 'TERMINAL' } });

  const eta = new Date('2026-08-05T09:00:00.000Z');
  const vessel = await prisma.vessel.create({
    data: { name: 'MV Kreyòl Star', imo: 'IMO9310001', lineOrgId: line.id },
  });
  const voyage = await prisma.voyage.create({
    data: { vesselId: vessel.id, voyageNumber: 'VY-2026-014', eta, port: 'Port-au-Prince' },
  });
  const manifest = await prisma.manifest.create({
    data: { voyageId: voyage.id, submittedByOrgId: line.id },
  });

  const bl = await prisma.billOfLading.create({
    data: {
      manifestId: manifest.id,
      blNumber: 'BL-CMA-88231',
      shipper: 'Shenzhen Trading Co.',
      importerOrgId: importer.id,
      description: 'Assorted consumer electronics',
    },
  });

  await prisma.container.createMany({
    data: [
      { blId: bl.id, containerNumber: 'CMAU1234567', sizeType: 'FORTY', importerOrgId: importer.id, terminalOrgId: terminal.id, arrivalDate: eta },
      { blId: bl.id, containerNumber: 'CMAU7654321', sizeType: 'TWENTY', importerOrgId: importer.id, terminalOrgId: terminal.id, arrivalDate: eta },
      { blId: bl.id, containerNumber: 'CMAU9998887', sizeType: 'REEFER', importerOrgId: importer.id, arrivalDate: eta },
    ],
  });

  console.log('• Demo manifest created: MV Kreyòl Star / VY-2026-014 (1 BL, 3 containers).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
