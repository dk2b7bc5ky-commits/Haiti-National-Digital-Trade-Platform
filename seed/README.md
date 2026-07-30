# Rezo seed data (CargoFax Atlas HT · 2026-05-12 → 2026-07-18)

Real Haitian trade data used to make Rezo's screens concrete. Loaded by the
Prisma seed (`apps/api/prisma/seed.ts`). **How each file is loaded is controlled
by flags so the live workspace stays clean** — see "Load flags" below.

| File | Rows | What it seeds |
|---|---|---|
| `cargofax_carriers_payees.csv` | 30 | Carrier → Haiti agency/office that collects. Real payees + routing rules. Load **first**. |
| `rezo_importers_master_v2.csv` | 788 | Importer directory (orgs, no logins). Defaults per importer from CargoFax. |
| `manifest_bulk.csv` | 15,500 | Shipments (8,820 BOLs) + containers. The full demo dataset. |
| `cargofax_importers_summary.csv` | 3,296 | Per-importer analytics rollups (reference only; optional). |

## Carrier → payee routing (the heart of "who you pay")

From `cargofax_carriers_payees.csv`. Key mappings:

- MSC → **MSC Haiti S.A.** (direct) · CMA CGM → **Ets J.B. Vital S.A.** ·
  Evergreen → **SAMAR S.A.** · Maersk → **AGEMAR S.A.** · ZIM → **NADAL S.A.** ·
  COSCO **and** King Ocean → **DEMSA** · Hapag-Lloyd **and** Crowley → **ENMARCOLDA S.A.** ·
  Seaboard → **Seaboard d'Haiti** · Antillean → **Antillean d'Haiti** ·
  ONE → **ADEKO Enterprises S.A.** · NYK **and** National Shipping of America → **Antoine Hogarth S.A.** ·
  RVAM → **RVAM (Reginald Villard Agences Maritimes)**.
- Rows whose `agency_code` starts `UNKNOWN_` or whose `pay_to_payee` contains
  "confirm" are **charter / private bulk carriers** (fuel, propane, rice) →
  loaded with `needs_payee_confirmation` and kept out of the main line flow.

## Load flags (env vars on the API service)

The seed is **safe by default**: it does not flood the live workspace.

- **Carrier→payee routing + real agency payees** load on **every deploy**
  (from `cargofax_carriers_payees.csv`). This is small and safe — it only
  writes payee-registry rows, never containers or charges — so the live "who
  you pay" is always real. Charter / private carriers whose payee is not yet
  confirmed are created **inactive** and kept out of the main flow. (No flag.)
- `SEED_IMPORTERS=true` — load the 788-importer directory (for admin "add on
  behalf" + consignee matching). No logins created. Off by default so the live
  importer picker stays short.
- `SEED_CARGOFAX=true` — load the CargoFax shipment/container dataset. Intended
  for the government / investor demo environment, **not** the live Alize
  workspace (it would bury the real containers). Batched + capped so the deploy
  never times out.
  - `SEED_CARGOFAX_LIMIT` — max bills of lading to load (default **2000**;
    set `0` to load everything). The cap is logged, never silent.
- `SEED_DEMO=true` — the older synthetic demo dataset (separate from CargoFax).

With no flags set, the seed ensures accounts, market config, the payee registry
**and the live carrier routing**, and removes any leftover synthetic demo data.

The **Rezo fee is never seeded** as a charge — seeded amounts are the real
third-party (terminal / port / line) charges only; fee handling stays hidden in
the app.
