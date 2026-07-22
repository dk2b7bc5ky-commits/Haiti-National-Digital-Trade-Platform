# Rezo — National Digital Trade Platform (Haiti)

Rezo is the national digital trade platform for Haiti: an API-first, multi-tenant
orchestration layer that connects shipping lines, customs, the port authority,
terminal operators, banks, brokers, and truckers so trade data is **entered once
and shared securely**, and all fees tied to a shipment can be **seen and paid in
one place**.

> **Architectural rules (non-negotiable, from the build spec):**
> 1. **No external APIs in the beta** — every external system sits behind an
>    adapter interface with a **mock** implementation. Nothing real is called.
> 2. **Rezo never holds funds** — no `balance`/`wallet`/`credit`/`float` field
>    exists on any entity. Money always moves payer → payee directly.
> 3. **Orchestrator, not owner** — Rezo integrates systems; it does not replace
>    them. API-first, multi-tenant, RBAC everywhere.

This repository is being built in the exact 14-step order from the spec, one step
at a time.

**Current status: Step 7 — Document ingestion + verification queue. ✅ PHASE 1
COMPLETE.** Documents are uploaded to object storage (MinIO), run through a mock
`ExtractionProvider` (OCR/LLM stub) that returns fields with **confidence
scores**; fields below the **0.85 threshold** become `pending_review` charges
(excluded from the payable total) with a `VerificationTask` for the **Ops
console** to correct. All five Phase 1 acceptance criteria (spec §8) are covered
by a passing **automated e2e test suite**. (Steps 1–6 delivered infra + health,
identity/tenancy/RBAC, the Data Hub with single manifest submission, the
Charge/Payee/Market model with config-driven fees + mock TerminalAdapter, the
consolidated container view, and the deadline & alert engine.)

---

## Repository layout

```
.
├── apps/
│   ├── api/                 # NestJS backend (REST/JSON, base path /api/v1)
│   │   ├── prisma/          # Prisma schema + migrations (empty schema for now)
│   │   └── src/
│   │       ├── common/      # response envelope: interceptor + exception filter
│   │       ├── health/      # GET /api/v1/health
│   │       ├── prisma/      # PrismaService + module
│   │       ├── app.module.ts
│   │       └── main.ts
│   └── web/                 # Next.js frontend (App Router, Tailwind)
│       └── app/page.tsx     # single status page → calls /api/v1/health
├── packages/
│   └── shared-types/        # shared TS types (API response envelope, health)
├── docker-compose.yml       # Postgres + Redis + MinIO for local dev
├── .env.example             # every env var, with placeholder values
└── package.json             # npm workspaces root
```

## Services & ports

| Service            | URL / port                       | Notes                                  |
|--------------------|----------------------------------|----------------------------------------|
| Web (Next.js)      | http://localhost:3000            | Status page                            |
| API (NestJS)       | http://localhost:4000/api/v1     | Health at `/api/v1/health`             |
| PostgreSQL         | localhost:5432                   | system of record                       |
| Redis              | localhost:6379                   | queue / async (used in later steps)    |
| MinIO (S3 API)     | http://localhost:9000            | object storage                         |
| MinIO console (UI) | http://localhost:9001            | login with S3 access/secret from `.env`|

## Prerequisites

- Node.js ≥ 20 and npm ≥ 10
- Docker + Docker Compose

## Setup & run

From the repository root:

```bash
# 1. Configure environment
cp .env.example .env

# 2. Start local infrastructure (Postgres, Redis, MinIO)
docker compose up -d

# 3. Install all workspace dependencies
npm install

# 4. Generate the Prisma client and apply migrations to Postgres
npm run prisma:generate
npm run prisma:migrate            # applies migrations

# 5. Seed one organization per role type + a login user for each
npm run prisma:seed --workspace @rezo/api

# 6. Start the API  (terminal 1)  ->  http://localhost:4000/api/v1
npm run dev:api

# 7. Start the web app  (terminal 2)  ->  http://localhost:3000
npm run dev:web
```

## Demo accounts (from the seed)

Every seeded user shares the dev password **`password123`**. Sign in at
http://localhost:3000/login (the login page also has one-click buttons for each).

| Email | Role | Sees |
|---|---|---|
| `admin@rezo.test` | REZO_ADMIN | all tenants; can create orgs/users/keys |
| `ops@rezo.test` | REZO_OPS | all tenants (verification focus) |
| `line@rezo.test` | SHIPPING_LINE | own org |
| `importer@rezo.test` | IMPORTER | own org |
| `broker@rezo.test` | BROKER | own org; can issue API keys |
| `trucker@rezo.test` | TRUCKER | own org |
| `terminal@rezo.test` | TERMINAL | own org |
| `customs@rezo.test` | CUSTOMS | all tenants (read) |
| `bank@rezo.test` | BANK | own org |
| `gov@rezo.test` | GOV_VIEWER | all tenants (read-only) |

## Auth & identity endpoints (Step 2)

```http
POST /api/v1/auth/login    { email, password }        -> { token, user, org, permissions }
POST /api/v1/auth/token    { api_key }                 -> { token }   # API-connected orgs
GET  /api/v1/auth/me                                    -> { user, org, permissions }
GET  /api/v1/organizations?limit=&cursor=               -> tenant-scoped list
POST /api/v1/organizations (org:write)                  -> create tenant
GET  /api/v1/organizations/:id
GET  /api/v1/users?limit=&cursor= (user:read)
POST /api/v1/users (user:write)
GET  /api/v1/api-keys (apikey:manage)
POST /api/v1/api-keys (apikey:manage)                   -> plaintext key returned ONCE
DELETE /api/v1/api-keys/:id (apikey:manage)             -> revoke
```

Every non-public route requires `Authorization: Bearer <JWT>`; org context and
role are derived from the token. Permissions are enforced by a global RBAC guard;
non-Rezo/gov/customs callers are restricted to their own organization's data.

## Data Hub endpoints (Step 3)

```http
POST /api/v1/manifests (manifest:submit)     # single submission -> creates voyage, BLs, containers
  body: { voyage: { vessel_imo, vessel_name, voyage_number, eta, port },
          bills_of_lading: [ { bl_number, shipper, consignee_org_id, description?,
                               containers: [ { container_number, size_type } ] } ] }
  -> 201 { data: { manifest_id, container_ids: [...] } }
GET  /api/v1/manifests?limit=&cursor= (container:read)     # submitter-scoped
GET  /api/v1/manifests/:id
GET  /api/v1/containers?importer_org_id=&terminal_org_id=&status=&limit=&cursor= (container:read)
GET  /api/v1/containers/:id                                # container + (charges/deadlines follow in steps 4–6)
GET  /api/v1/organizations/directory?type=IMPORTER (org:read)   # minimal counterparty directory
```

**Container visibility (role-scoped):** importers see containers consigned to
them; terminals see containers assigned to them; shipping lines see containers
from manifests they submitted; Rezo/government/customs see all. Broker container
views arrive with the broker portal (step 10).

**Try Flow A:** sign in as `line@rezo.test`, open **Submit manifest**, pick
`Import Ayiti S.A.` as consignee, submit; then sign in as `importer@rezo.test`
and open **Containers** — the container is there, never retyped. The seed also
includes a demo voyage (MV Kreyòl Star) so the views aren't empty.

## Charges, payees & market config (Step 4)

```http
GET  /api/v1/markets                                   # list market configs
GET  /api/v1/markets/:code                             # e.g. HT — currencies, tariff, modules
PATCH /api/v1/markets/:code (config:manage)            # update tariff/currencies/modules
GET  /api/v1/payees (charge:read)                      # payee registry
POST /api/v1/payees (config:manage)
GET  /api/v1/containers/:containerId/charges (charge:read)
POST /api/v1/containers/:containerId/charges (charge:write)          # manual charge
POST /api/v1/containers/:containerId/charges/sync-terminal (charge:write)  # mock TerminalAdapter
```

- **Money** is always an integer of minor units + an ISO-4217 `currency` (spec §15) — never a float.
- **Fees come from config**, not code: `MarketConfigService` reads the `Market.tariff`
  row; the mock `TerminalAdapter` and any fee logic look prices up there so a
  government concession can index/approve rates (spec §14).
- **Adapters are swappable**: `TerminalAdapter` is bound to a DI token in
  `IntegrationModule`; replacing the mock with a real Octopi/CPS adapter is a
  one-line provider change — business logic never touches it.
- The container detail groups **charges by payee** with subtotals and a
  **total owed** (only `pending`/`requested`/`overdue` count; `pending_review`
  is excluded per spec §1.3). Try **Sync terminal charges** on a container as
  `admin@rezo.test` or `terminal@rezo.test`.

## Consolidated view (Step 5)

The container list and detail now carry the full "one screen" rollup (spec §1.4):

- **`GET /containers`** and **`GET /containers/:id`** include, per container:
  `total_owed`, `payment_status` (`none`/`pending`/`paid`/`overdue`, derived
  from charge statuses), and `last_free_day` (earliest across payable charges).
- **`GET /containers/:id`** charge groups add `payee_type` and a masked
  `settlement_hint` — **who you pay** and how money will route (the opaque
  settlement token is never shown in full).
- The web **Containers** list shows total owed / payment status / last-free-day
  with a live countdown per row; the **detail** shows a payment-status badge, a
  last-free-day countdown chip, and per-payee "pay to …" routing.
- Sign in as `importer@rezo.test` → **Containers** to see it.

## Deadline & alert engine (Step 6)

```http
GET  /api/v1/alerts?status=&limit= (container:read)   # in-app alert feed (org-scoped)
POST /api/v1/alerts/:id/read (container:read)          # mark an in-app alert read
POST /api/v1/alerts/dispatch (config:manage)           # run the dispatcher on demand
GET  /api/v1/containers/:id                            # now includes `deadlines`
```

- A **`Deadline`** is tracked per container per payee (earliest last-free-day
  among that payee's charges) and **recomputed** on every charge create /
  terminal-sync (spec §1.5). Alert offsets and channels come from market config.
- Each deadline schedules **`DeadlineAlert`** rows (one per offset × channel).
  In-app alerts are served from the feed; email/SMS go through the mock
  `NotificationAdapter` (swappable for SendGrid/Twilio via its DI token).
- A **cron dispatcher** (`@Cron`, every minute) delivers alerts whose scheduled
  time has passed. It only advances `PENDING`/`FAILED` → `SENT`, so it's
  idempotent and reliable — **a missed run sends late, never double-sends or
  drops** (spec §1.5: a missed alert is a real financial loss).
- Web: the **Alerts** page shows delivered vs scheduled reminders (in-app +
  email), and the container detail lists deadlines with countdowns. Sign in as
  `importer@rezo.test` → **Alerts**.

## Document ingestion & verification (Step 7 — closes Phase 1)

```http
POST /api/v1/documents (document:write)                # multipart upload -> store + extract
GET  /api/v1/containers/:containerId/documents (container:read)
GET  /api/v1/verification-tasks?status=open (verification:read)   # Ops queue
POST /api/v1/verification-tasks/:id/resolve (verification:resolve) # { field, corrected_value }
```

- Uploads are stored in **MinIO** (object storage); the file key is the
  Document `file_ref`. The mock **`ExtractionProvider`** returns charge lines
  with per-field **confidence**; a field below the **0.85** threshold (config-
  driven) creates a `PENDING_REVIEW` charge — **excluded from `total_owed`** —
  and an Ops **`VerificationTask`**. Resolving it moves the charge into the
  payable total and records before/after in the audit log.
- Adapters remain swappable: `ExtractionProvider` and `NotificationAdapter` are
  bound by DI token in `IntegrationModule` — mocks today, real OCR/LLM/email
  vendors later, with no change to business logic.
- Web: upload control on the container detail, and the **Verification** console
  (`ops@rezo.test`) to review/correct low-confidence fields.

## Broker ↔ importer links (minimal, for Phase 1)

A `BrokerClient` row links a broker to the importers it clears for, so a broker
reads its importers' containers (spec §2.3). The full broker portal is step 10;
the demo seeds a link so `broker@rezo.test` sees the demo importer's containers.

## Testing (Phase 1 acceptance — spec §8/§16)

One automated integration test per Phase 1 acceptance criterion:

```bash
docker compose up -d                       # Postgres/Redis/MinIO must be running
npm run test:e2e --workspace @rezo/api     # runs against an isolated rezo_test DB
```

The suite (`apps/api/test/phase1.e2e-spec.ts`) creates + migrates + seeds a
separate `rezo_test` database, then asserts: (1) single submission is shared with
importer **and** broker with no re-entry; (2) an uploaded invoice extracts
charges, a low-confidence field lands in the queue and Ops corrects it; (3) the
consolidated view groups charges by payee with a correct total + last-free-day;
(4) an alert fires before a deadline; (5) tenant isolation + RBAC hold and
changes are audit-logged. **All 5 pass.**

## What you should see

- **`curl http://localhost:4000/api/v1/health`** returns:

  ```json
  { "data": { "status": "ok" }, "error": null }
  ```

  The endpoint runs a `SELECT 1` against Postgres first, so a green `ok`
  proves the **API ↔ database** connection. If the DB is unreachable you get the
  failure envelope instead: `{ "data": null, "error": { "code": "service_unavailable", ... } }`.

- **http://localhost:3000** shows the Rezo status page. It calls the health
  endpoint on load and displays a green **`ok`** badge — proving the full
  **frontend ↔ backend ↔ database** round-trip. Use **Re-check** to call again.

## Response envelope (spec §15)

Every endpoint returns:

- success: `{ "data": <payload>, "error": null }`
- failure: `{ "data": null, "error": { "code": "...", "message": "..." } }`

This is applied globally (a response interceptor + an exception filter), so
individual controllers just return their plain payload.

## Handy commands

```bash
docker compose up -d      # start infra
docker compose down       # stop infra (add -v to wipe volumes)
npm run build             # build all workspaces
```

## Roadmap (build order from the spec)

1. ~~Scaffold~~ ✅
2. ~~Identity & tenancy (orgs, users, RBAC, login)~~ ✅
3. ~~Data Hub core (vessel/voyage/manifest/BL/container + single submission)~~ ✅
4. ~~Payee & Charge model + Market/Config~~ ✅
5. ~~Consolidated container view~~ ✅
6. ~~Deadline & alert engine~~ ✅
7. **Document ingestion + verification queue → Phase 1 complete** ✅ ← *you are here*
8. Payment Orchestrator (mock rail, FX freeze, idempotency, partial failure, no held funds)
9. Fee & billing engine
10. Broker portal
11. Trucker portal + gate appointments
12. Container tracking & release
13. Dashboards → **Phase 2 complete**
14. Seeded demo dataset
