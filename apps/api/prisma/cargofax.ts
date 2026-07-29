/**
 * CargoFax loaders — real Haitian trade data (CargoFax Atlas HT).
 *
 * Two entry points, both driven by env flags so the LIVE Alize workspace stays
 * clean (see seed/README.md):
 *
 *   seedCarrierRouting()  — runs on EVERY deploy (idempotent, non-throwing).
 *       Ensures the real carrier → Haiti-agency payees exist and returns a
 *       carrier → payee routing map. This is the "who you pay" backbone and is
 *       safe to have live: it creates payee registry rows only, never
 *       containers/charges.
 *
 *   seedCargofax()        — ONLY when SEED_CARGOFAX=true (gov/investor demo
 *       environment). Loads importers + a batched, capped set of shipments and
 *       containers from manifest_bulk.csv, auto-resolving each carrier to its
 *       agency payee. Never runs in the live workspace, where it would bury the
 *       real containers.
 *
 * The Rezo fee is NEVER represented here — charges seeded are the real
 * third-party amounts (terminal, port, line). Fee handling stays hidden in the
 * app, per product decision.
 */
import { PrismaClient, ContainerSize } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const SEED_DIR = path.join(__dirname, '../../../seed');

/** carrier_normalized → the agency/office org that collects for it. */
export type CarrierRouting = Map<string, { orgId: string; name: string; needsConfirmation: boolean }>;

// ---------------------------------------------------------------------------
// CSV parsing (RFC-4180-ish: quoted fields, embedded commas, "" escapes, CRLF).
// ---------------------------------------------------------------------------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else if (c === '\r') {
      // swallow; handled by the following \n
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

function readCsvObjects(file: string): Record<string, string>[] {
  const text = fs.readFileSync(path.join(SEED_DIR, file), 'utf8');
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

// ---------------------------------------------------------------------------
// Carrier normalization: raw manifest "Carrier" → the carrier_normalized key
// used in cargofax_carriers_payees.csv (and thus the routing map).
// ---------------------------------------------------------------------------
const CARRIER_RULES: { test: (u: string) => boolean; key: string }[] = [
  { test: (u) => u.includes('MEDITERRANEAN') || u === 'MSC' || u.startsWith('MSC '), key: 'MSC' },
  { test: (u) => u.includes('CMA'), key: 'CMA CGM' },
  { test: (u) => u.includes('EVERGREEN'), key: 'Evergreen' },
  { test: (u) => u.includes('MAERSK') || u.includes('SEALAND'), key: 'Maersk Line' },
  { test: (u) => u.includes('ZIM'), key: 'ZIM' },
  { test: (u) => u.includes('COSCO'), key: 'COSCO' },
  { test: (u) => u.includes('SEABOARD'), key: 'Seaboard Marine' },
  { test: (u) => u.includes('HAPAG'), key: 'Hapag-Lloyd' },
  { test: (u) => u.includes('ACCORDIA'), key: 'Accordia Shipping' },
  { test: (u) => u.includes('ANTILLEAN'), key: 'Antillean Marine' },
  { test: (u) => u.includes('KING OCEAN'), key: 'King Ocean' },
  { test: (u) => u.includes('OCEAN NETWORK') || u === 'ONE' || u.startsWith('ONE '), key: 'ONE' },
  { test: (u) => u.includes('CROWLEY'), key: 'Crowley' },
  { test: (u) => u.includes('NATIONAL SHIPPING'), key: 'National Shipping of America' },
  { test: (u) => u.includes('NYK'), key: 'NYK Line' },
];

function titleCode(code: string): string {
  const c = code.trim();
  return c.length === 0 ? c : c[0].toUpperCase() + c.slice(1).toLowerCase();
}

/** Returns the carrier_normalized key, or null when the carrier is unresolved. */
function normalizeCarrier(raw: string): string | null {
  const u = raw.trim().toUpperCase();
  if (u === '') return null;
  if (u.startsWith('PRIVATE CARRIER')) {
    const code = u.split('-')[1]?.trim() ?? '';
    if (code === '') return null;
    if (code === 'RVAM') return 'Private Carrier - Rvam';
    return `Private Carrier - ${titleCode(code)}`;
  }
  for (const r of CARRIER_RULES) if (r.test(u)) return r.key;
  return null;
}

// ---------------------------------------------------------------------------
// seedCarrierRouting — safe on every deploy.
// ---------------------------------------------------------------------------
export async function seedCarrierRouting(prisma: PrismaClient): Promise<CarrierRouting> {
  const routing: CarrierRouting = new Map();
  let rows: Record<string, string>[];
  try {
    rows = readCsvObjects('cargofax_carriers_payees.csv');
  } catch (e) {
    console.log('• Carrier routing CSV not found — skipping routing seed.');
    return routing;
  }

  let charters = 0;
  for (const r of rows) {
    const carrier = r['carrier_normalized'];
    const code = r['agency_code'];
    const payeeName = r['pay_to_payee'];
    if (!carrier || !code) continue;
    const needsConfirmation = code.startsWith('UNKNOWN_') || /confirm/i.test(payeeName);
    const settlementRef = `stlm_${code.toLowerCase()}`;

    let orgId: string;
    // Mapped agencies were already created by seedShippingAgents() with
    // settlementRef stlm_<code>; reuse that org so we never duplicate it.
    const existingPayee = await prisma.payee.findFirst({ where: { settlementRef } });
    if (existingPayee) {
      orgId = existingPayee.orgId;
    } else {
      // Not a pre-seeded agent (charter/private carrier, or a new agency).
      const cleanName = payeeName.replace(/\s*\(.*\)\s*$/, '').trim() || carrier;
      const org =
        (await prisma.organization.findFirst({ where: { legalName: cleanName } })) ??
        (await prisma.organization.create({
          data: { type: 'SHIPPING_LINE', legalName: cleanName, country: 'HT', kycStatus: needsConfirmation ? 'PENDING' : 'VERIFIED' },
        }));
      await prisma.payee.upsert({
        where: { orgId_type: { orgId: org.id, type: 'LINE' } },
        update: { name: cleanName, active: !needsConfirmation },
        create: { orgId: org.id, name: cleanName, type: 'LINE', settlementRef, active: !needsConfirmation },
      });
      orgId = org.id;
      if (needsConfirmation) charters++;
    }
    routing.set(carrier, { orgId, name: payeeName, needsConfirmation });
  }
  console.log(`• Carrier routing ready: ${routing.size} carriers mapped (${charters} charter/private payee(s) flagged needs-confirmation, kept inactive).`);
  return routing;
}

// ---------------------------------------------------------------------------
// seedImporterDirectory — SEED_IMPORTERS=true. Loads the importer master as
// login-less directory orgs (for admin "add on behalf" + consignee matching).
// ---------------------------------------------------------------------------
export async function seedImporterDirectory(prisma: PrismaClient): Promise<void> {
  let rows: Record<string, string>[];
  try {
    rows = readCsvObjects('rezo_importers_master_v2.csv');
  } catch {
    console.log('• Importer master CSV not found — skipping importer directory.');
    return;
  }
  const names = Array.from(new Set(rows.map((r) => r['legal_name']?.trim()).filter((n): n is string => !!n)));
  const created = await ensureImporterOrgs(prisma, names);
  console.log(`• Importer directory: ${names.length} names, ${created} new org(s) created (no logins).`);
}

/** Ensure IMPORTER orgs exist for the given legal names; returns count created. */
async function ensureImporterOrgs(prisma: PrismaClient, names: string[]): Promise<number> {
  const byName = new Map<string, string>();
  const CHUNK = 300;
  for (let i = 0; i < names.length; i += CHUNK) {
    const slice = names.slice(i, i + CHUNK);
    const existing = await prisma.organization.findMany({ where: { legalName: { in: slice } }, select: { id: true, legalName: true } });
    for (const o of existing) byName.set(o.legalName, o.id);
  }
  const missing = names.filter((n) => !byName.has(n));
  for (let i = 0; i < missing.length; i += CHUNK) {
    const slice = missing.slice(i, i + CHUNK);
    await prisma.organization.createMany({
      data: slice.map((legalName) => ({ type: 'IMPORTER' as const, legalName, country: 'HT', kycStatus: 'PENDING' as const })),
      skipDuplicates: true,
    });
  }
  return missing.length;
}

// ---------------------------------------------------------------------------
// seedCargofax — SEED_CARGOFAX=true only (demo environment).
// ---------------------------------------------------------------------------
interface Tariff {
  currency: string;
  port_dues: { flat: number };
  terminal_handling: { TWENTY: number; FORTY: number; REEFER: number };
  storage_per_day: { TWENTY: number; FORTY: number; REEFER: number };
}

const HEADER = {
  fax: 'FaxID', date: 'Date', shipper: 'Shipper', consignee: 'Consignee', bol: 'Bol',
  ctr: 'CTR', ctrType: 'CTR Type', ctrSize: 'CTR Size', commodity: 'Commodity',
  carrier: 'Carrier', vessel: 'Vessel', portUnlading: 'Port of Unlading',
} as const;

function sizeOf(ctrType: string, ctrSize: string): ContainerSize {
  const t = ctrType.toUpperCase();
  const s = ctrSize.toUpperCase();
  if (t.includes('REEF') || s.endsWith('RF') || s.includes('HCR')) return 'REEFER';
  if (s.startsWith('20') || s.startsWith('15')) return 'TWENTY';
  return 'FORTY';
}

const DAY_MS = 86_400_000;

export async function seedCargofax(prisma: PrismaClient, routing: CarrierRouting, tariff: Tariff): Promise<void> {
  // Idempotent guard: our CargoFax manifests are tagged rawRef=cargofax:*.
  if ((await prisma.manifest.count({ where: { rawRef: { startsWith: 'cargofax:' } } })) > 0) {
    console.log('• CargoFax dataset already present — skipping.');
    return;
  }

  let rows: Record<string, string>[];
  try {
    rows = readCsvObjects('manifest_bulk.csv');
  } catch {
    console.log('• manifest_bulk.csv not found — skipping CargoFax dataset.');
    return;
  }

  // Cap the number of bills of lading loaded so the deploy never times out.
  // SEED_CARGOFAX_LIMIT=0 loads everything; default is a demo-sized slice.
  const rawLimit = Number(process.env.SEED_CARGOFAX_LIMIT ?? '2000');
  const blLimit = Number.isFinite(rawLimit) && rawLimit >= 0 ? rawLimit : 2000;

  // Resolve the fixed payees (terminal + port) once; created by seedMarketAndPayees.
  const terminalPayee = await prisma.payee.findFirst({ where: { type: 'TERMINAL' } });
  const portPayee = await prisma.payee.findFirst({ where: { type: 'PORT' } });
  if (!terminalPayee || !portPayee) {
    console.log('• CargoFax: terminal/port payee missing — run market seed first. Skipping.');
    return;
  }

  // A fallback org for vessels whose carrier we could not resolve (so the
  // vessel row stays valid); its payee is inactive and gets no line charges.
  const fallbackName = 'Carrier — payee to confirm (CargoFax)';
  const fallbackOrg =
    (await prisma.organization.findFirst({ where: { legalName: fallbackName } })) ??
    (await prisma.organization.create({ data: { type: 'SHIPPING_LINE', legalName: fallbackName, country: 'HT', kycStatus: 'PENDING' } }));
  await prisma.payee.upsert({
    where: { orgId_type: { orgId: fallbackOrg.id, type: 'LINE' } },
    update: {},
    create: { orgId: fallbackOrg.id, name: fallbackName, type: 'LINE', settlementRef: 'stlm_cfx_unresolved', active: false },
  });

  // ---- First pass: pick the BOLs to load (respecting the cap) and gather
  // the consignee names + a representative row per BOL. ----
  const blOrder: string[] = [];
  const blSeen = new Set<string>();
  const consigneeNames = new Set<string>();
  const rowsToLoad: Record<string, string>[] = [];
  for (const r of rows) {
    const bol = r[HEADER.bol];
    const ctr = r[HEADER.ctr];
    if (!bol || !ctr) continue; // skip bulk/VRAC rows with no container number
    if (!blSeen.has(bol)) {
      if (blLimit !== 0 && blOrder.length >= blLimit) continue;
      blSeen.add(bol);
      blOrder.push(bol);
    }
    if (!blSeen.has(bol)) continue;
    const consignee = r[HEADER.consignee]?.trim();
    if (consignee) consigneeNames.add(consignee);
    rowsToLoad.push(r);
  }
  const capped = blLimit !== 0 && blOrder.length >= blLimit;
  if (capped) {
    console.log(`• CargoFax: capped at ${blLimit} bills of lading (SEED_CARGOFAX_LIMIT to change; 0 = all).`);
  }

  // Ensure importer orgs for every consignee in the loaded slice.
  await ensureImporterOrgs(prisma, Array.from(consigneeNames));
  const importerByName = new Map<string, string>();
  {
    const names = Array.from(consigneeNames);
    const CHUNK = 300;
    for (let i = 0; i < names.length; i += CHUNK) {
      const slice = names.slice(i, i + CHUNK);
      const orgs = await prisma.organization.findMany({ where: { legalName: { in: slice } }, select: { id: true, legalName: true } });
      for (const o of orgs) importerByName.set(o.legalName, o.id);
    }
  }

  // ---- Build the object graph in memory (pre-generated UUIDs) ----
  const vessels = new Map<string, { id: string; name: string; lineOrgId: string }>();
  const voyages = new Map<string, { id: string; vesselId: string; voyageNumber: string; eta: Date; port: string }>(); // key faxId
  const manifests = new Map<string, { id: string; voyageId: string; faxId: string }>(); // key faxId
  const bols = new Map<string, { id: string; manifestId: string; blNumber: string; shipper: string; importerOrgId: string; description: string }>();
  const containers: { id: string; blId: string; containerNumber: string; sizeType: ContainerSize; importerOrgId: string; terminalOrgId: string; arrivalDate: Date; carrierKey: string | null }[] = [];
  const containerSeen = new Set<string>();

  const parseDate = (s: string): Date => {
    const d = new Date(s);
    return isNaN(d.getTime()) ? new Date('2026-06-01T00:00:00.000Z') : d;
  };

  for (const r of rowsToLoad) {
    const faxId = r[HEADER.fax] || r[HEADER.bol];
    const vesselName = (r[HEADER.vessel] || 'UNKNOWN VESSEL').slice(0, 120);
    const carrierKey = normalizeCarrier(r[HEADER.carrier] ?? '');
    const route = carrierKey ? routing.get(carrierKey) : undefined;
    const lineOrgId = route?.orgId ?? fallbackOrg.id;
    const consignee = r[HEADER.consignee]?.trim() ?? '';
    const importerOrgId = importerByName.get(consignee);
    if (!importerOrgId) continue; // consignee org missing (shouldn't happen)

    // Vessel (unique by name).
    let vessel = vessels.get(vesselName);
    if (!vessel) { vessel = { id: randomUUID(), name: vesselName, lineOrgId }; vessels.set(vesselName, vessel); }

    // Voyage + manifest (one per FaxID).
    if (!manifests.has(faxId)) {
      const voyageId = randomUUID();
      voyages.set(faxId, { id: voyageId, vesselId: vessel.id, voyageNumber: faxId.slice(0, 60), eta: parseDate(r[HEADER.date]), port: 'Port-au-Prince' });
      manifests.set(faxId, { id: randomUUID(), voyageId, faxId });
    }
    const manifest = manifests.get(faxId)!;

    // Bill of lading (unique by Bol number).
    const bolNumber = r[HEADER.bol];
    if (!bols.has(bolNumber)) {
      bols.set(bolNumber, {
        id: randomUUID(), manifestId: manifest.id, blNumber: bolNumber,
        shipper: (r[HEADER.shipper] || 'Unknown shipper').slice(0, 200),
        importerOrgId, description: (r[HEADER.commodity] || '').slice(0, 200),
      });
    }
    const bl = bols.get(bolNumber)!;

    // Container (unique by number).
    const ctr = r[HEADER.ctr];
    if (containerSeen.has(ctr)) continue;
    containerSeen.add(ctr);
    containers.push({
      id: randomUUID(), blId: bl.id, containerNumber: ctr,
      sizeType: sizeOf(r[HEADER.ctrType] ?? '', r[HEADER.ctrSize] ?? ''),
      importerOrgId, terminalOrgId: terminalPayee.orgId,
      arrivalDate: parseDate(r[HEADER.date]), carrierKey,
    });
  }

  // ---- Bulk insert in FK-safe order (createMany, skipDuplicates) ----
  const CHUNK = 1000;
  const chunk = <T>(arr: T[]): T[][] => { const out: T[][] = []; for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK)); return out; };
  const imoFor = (id: string): string => `CFX-${id.replace(/-/g, '').slice(0, 16)}`;

  for (const c of chunk(Array.from(vessels.values())))
    await prisma.vessel.createMany({ data: c.map((v) => ({ id: v.id, name: v.name, imo: imoFor(v.id), lineOrgId: v.lineOrgId })), skipDuplicates: true });
  for (const c of chunk(Array.from(voyages.values())))
    await prisma.voyage.createMany({ data: c.map((v) => ({ id: v.id, vesselId: v.vesselId, voyageNumber: v.voyageNumber, eta: v.eta, port: v.port })), skipDuplicates: true });
  for (const c of chunk(Array.from(manifests.values())))
    await prisma.manifest.createMany({ data: c.map((m) => ({ id: m.id, voyageId: m.voyageId, submittedByOrgId: bolsLineOrgFallback(m, bols, fallbackOrg.id), status: 'PROCESSED' as const, rawRef: `cargofax:${m.faxId}` })), skipDuplicates: true });
  for (const c of chunk(Array.from(bols.values())))
    await prisma.billOfLading.createMany({ data: c.map((b) => ({ id: b.id, manifestId: b.manifestId, blNumber: b.blNumber, shipper: b.shipper, importerOrgId: b.importerOrgId, description: b.description })), skipDuplicates: true });
  for (const c of chunk(containers))
    await prisma.container.createMany({ data: c.map((ct) => ({ id: ct.id, blId: ct.blId, containerNumber: ct.containerNumber, sizeType: ct.sizeType, importerOrgId: ct.importerOrgId, terminalOrgId: ct.terminalOrgId, arrivalDate: ct.arrivalDate, status: 'ARRIVED' as const })), skipDuplicates: true });

  // ---- Charges: terminal handling + port dues for every container, plus a
  // line charge routed to the carrier's agency (the real "who you pay"). No
  // Rezo fee line — fee stays hidden. ----
  const charges: { containerId: string; payeeOrgId: string; type: 'TERMINAL_HANDLING' | 'PORT_DUES' | 'DEMURRAGE' | 'STORAGE'; amount: number; currency: string; source: 'MANIFEST'; dueDate: Date; lastFreeDay: Date }[] = [];
  for (const ct of containers) {
    const lfd = new Date(ct.arrivalDate.getTime() + 5 * DAY_MS);
    charges.push({ containerId: ct.id, payeeOrgId: terminalPayee.orgId, type: 'TERMINAL_HANDLING', amount: tariff.terminal_handling[ct.sizeType], currency: tariff.currency, source: 'MANIFEST', dueDate: lfd, lastFreeDay: lfd });
    charges.push({ containerId: ct.id, payeeOrgId: portPayee.orgId, type: 'PORT_DUES', amount: tariff.port_dues.flat, currency: tariff.currency, source: 'MANIFEST', dueDate: lfd, lastFreeDay: lfd });
    const route = ct.carrierKey ? routing.get(ct.carrierKey) : undefined;
    if (route && !route.needsConfirmation) {
      charges.push({ containerId: ct.id, payeeOrgId: route.orgId, type: 'DEMURRAGE', amount: 45000, currency: tariff.currency, source: 'MANIFEST', dueDate: lfd, lastFreeDay: lfd });
    }
    if (ct.sizeType === 'REEFER') {
      charges.push({ containerId: ct.id, payeeOrgId: terminalPayee.orgId, type: 'STORAGE', amount: tariff.storage_per_day.REEFER * 3, currency: tariff.currency, source: 'MANIFEST', dueDate: lfd, lastFreeDay: lfd });
    }
  }
  for (const c of chunk(charges)) await prisma.charge.createMany({ data: c, skipDuplicates: true });

  console.log(
    `• CargoFax dataset loaded: ${vessels.size} vessels, ${voyages.size} voyages, ${bols.size} BLs, ` +
    `${containers.length} containers, ${charges.length} charges, ${importerByName.size} importers.` +
    (capped ? ` (capped at ${blLimit} BLs)` : ''),
  );
}

/** Pick a submitter org for a manifest: the line org of its first BOL's carrier, else fallback. */
function bolsLineOrgFallback(
  _m: { id: string; voyageId: string; faxId: string },
  _bols: Map<string, unknown>,
  fallbackOrgId: string,
): string {
  // Manifests are submitted by a shipping line in the real system; for the
  // CargoFax import we don't track the submitter per manifest, so attribute it
  // to the fallback carrier org. (Display only; routing uses per-charge payees.)
  return fallbackOrgId;
}
