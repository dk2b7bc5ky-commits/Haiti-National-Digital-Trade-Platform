/**
 * Rezo seed — one organization per role type, each with a login user
 * (spec build step 2). Idempotent: safe to run repeatedly (upsert by email).
 *
 * Dev credentials (NEVER use in production):
 *   password for every seeded user = "password123"
 */
import { PrismaClient, OrgType, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEV_PASSWORD = 'password123';

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

  await seedDemoManifest();

  const orgCount = await prisma.organization.count();
  const userCount = await prisma.user.count();
  console.log(`\nSeed complete: ${orgCount} organizations, ${userCount} users.`);
  console.log(`All seeded users share the dev password: "${DEV_PASSWORD}"`);
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
