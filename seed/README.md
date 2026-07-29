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

- `SEED_ROUTING=true` — load the carrier→payee routing + real agency payees
  (small, safe, recommended; powers real "who you pay").
- `SEED_IMPORTERS=true` — load the 788-importer directory (for admin "add on
  behalf" + consignee matching). No logins created.
- `SEED_CARGOFAX=true` — load the full 15,500-container demo dataset. Intended
  for the government / investor demo environment, **not** the live Alize
  workspace (it would bury real containers).
- `SEED_DEMO=true` — the older synthetic demo dataset (separate from CargoFax).

With no flags set, the seed only ensures accounts, market config, and the payee
registry, and removes any leftover synthetic demo data.
