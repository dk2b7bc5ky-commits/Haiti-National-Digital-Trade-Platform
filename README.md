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

**Current status: Step 2 — Identity, Tenancy & RBAC.** Organizations (tenants),
Users, API keys, JWT login + API-key token exchange, a role→permission matrix
enforced by global guards, tenant isolation, an append-only audit log, a seed of
one org per role type, and a Next.js login + role-based dashboard shells. (Step 1
delivered the monorepo, local infra, health round-trip, and Prisma wiring.)

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
2. **Identity & tenancy (orgs, users, RBAC, login)** ← *you are here*
3. Data Hub core (vessel/voyage/manifest/BL/container + single submission)
4. Payee & Charge model + Market/Config
5. Consolidated container view
6. Deadline & alert engine
7. Document ingestion + verification queue → **Phase 1 complete**
8. Payment Orchestrator (mock rail, FX freeze, idempotency, partial failure, no held funds)
9. Fee & billing engine
10. Broker portal
11. Trucker portal + gate appointments
12. Container tracking & release
13. Dashboards → **Phase 2 complete**
14. Seeded demo dataset
