# Rezo — Architecture & Handoff

Rezo is a **national digital trade platform for Haiti**: an orchestration layer
that sits between the parties of a shipment (shipping lines, importers, brokers,
truckers, terminals, customs, banks, government) and gives them one shared,
API-first system for tracking containers, consolidating charges, orchestrating
payments, and meeting deadlines.

This document is the engineering handoff for the Phase 1 & 2 beta. It explains
how the system is put together, the rules it is built to respect, and where to
plug in real integrations.

---

## The four non-negotiables

Everything in the codebase is built to honor these. They are not aspirations —
each is enforced structurally and/or by an automated test.

1. **No external APIs in the beta.** Every third-party touchpoint (terminal
   operating systems, customs/ASYCUDA, document extraction, notifications,
   payment rails) sits behind a typed adapter interface with a **mock
   implementation only**. See [`src/integration`](../apps/api/src/integration).
   Swapping in a real vendor is a one-file change with no impact on business
   logic.

2. **Rezo never holds funds.** There is deliberately **no `balance`, `wallet`,
   `credit`, or `float` field on any entity.** Money moves **payer → payee
   directly**; Rezo only records and confirms the movement. This is enforced by
   a test that introspects the Prisma data model and fails if any such field is
   ever added (`test/payments.e2e-spec.ts` → *"no schema entity has a
   balance/wallet/credit/float field"*).

3. **Orchestrator, not owner.** The platform is **API-first, multi-tenant, and
   RBAC-guarded everywhere.** Every request is authenticated and authorized by
   default (global guards, deny-by-default); tenants only ever see their own
   data unless a role explicitly grants cross-tenant read.

4. **The Data Hub is the single source of truth.** A manifest is submitted
   **once** by a shipping line; everyone else reads the resulting voyage / bill
   of lading / container records. Data is entered once and read by all.

---

## Tech stack

| Layer            | Choice                                                        |
| ---------------- | ------------------------------------------------------------- |
| Frontend         | Next.js 14 (App Router) · React 18 · TypeScript · Tailwind    |
| Backend          | NestJS 10 · TypeScript                                        |
| Database         | PostgreSQL 16 · Prisma ORM                                    |
| Object storage   | S3-compatible (MinIO in dev) via `@aws-sdk/client-s3`         |
| Auth             | JWT (bearer) + role→permission RBAC                           |
| Infra (dev)      | Docker Compose (postgres, redis, minio)                       |
| Tests            | Jest + supertest (API e2e), Jest (web unit)                   |

Money is always **integer minor units + an ISO-4217 currency** on the wire
(e.g. `{ amount: 156000, currency: "USD" }` = $1,560.00) — never a float.

---

## Repository layout

```
.
├── apps/
│   ├── api/            # NestJS backend — REST/JSON under /api/v1
│   │   ├── prisma/     # schema.prisma, migrations, seed.ts (demo dataset)
│   │   └── src/        # one module per domain (see below)
│   └── web/            # Next.js frontend (role-aware dashboard)
│       └── lib/        # api client, money/format helpers (+ unit tests)
├── packages/
│   └── shared-types/   # TS types shared by api + web (envelope, DTOs, unions)
├── docs/               # this document
├── .github/workflows/  # CI (build · lint · web unit · API e2e)
└── docker-compose.yml  # local infra
```

### API modules (`apps/api/src`)

`auth` · `users` · `organizations` · `api-keys` (identity & tenancy) ·
`data-hub` (vessel/voyage/manifest/BL/container) · `charges` · `payees` ·
`markets` · `config` · `deadlines` · `documents` (+ verification queue) ·
`payments` (orchestrator) · `billing` (subscriptions) · `broker` · `transport`
(trucking + gate) · `analytics` (dashboards) · `audit` · `integration`
(adapters) · `storage` · `common` (envelope, shared app config) · `rbac`.

---

## Request lifecycle

Every request flows through the same shared middleware stack, defined once in
[`common/configure-app.ts`](../apps/api/src/common/configure-app.ts) and used by
**both** `main.ts` and the e2e suite (so tests exercise the real stack):

1. **`helmet`** — baseline security headers.
2. **`JwtAuthGuard`** (global) — validates the bearer token, attaches an
   `AuthPrincipal`. Routes opt out with `@Public()` (login, health).
3. **`PermissionsGuard`** (global) — enforces `@RequirePermissions(...)`;
   **deny-by-default**.
4. **`ValidationPipe`** — `whitelist` + `forbidNonWhitelisted` + `transform`
   (unknown fields are rejected, not silently dropped).
5. Controller → service (business logic, tenant scoping).
6. **`ResponseInterceptor`** wraps the return value in the success envelope.
7. **`AllExceptionsFilter`** turns any error into the failure envelope, maps
   known Prisma errors to sensible HTTP codes, and never leaks internals.

### Response envelope (spec §15)

```jsonc
// success
{ "data": { /* ... */ }, "error": null }
// failure
{ "data": null, "error": { "code": "forbidden", "message": "..." } }
```

Lists add a top-level `next_cursor` for pagination.

---

## RBAC & multi-tenancy

- **Roles → permissions** live in a single matrix:
  [`rbac/permissions.ts`](../apps/api/src/rbac/permissions.ts). Permissions are
  fine-grained verbs (`manifest:submit`, `payment:authorize`,
  `release:authorize`, `dashboard:gov`, …).
- Controllers declare what they need with `@RequirePermissions(...)`; the guard
  denies anything not granted.
- **Tenant scoping** is centralized in
  [`data-hub/scoping.ts`](../apps/api/src/data-hub/scoping.ts):
  `resolveContainerScope()` (broker-aware — a broker sees the containers of the
  importers it clears for), `containerScopeWhere()`, `tenantScope()`. Roles with
  `tenant:read_all` (Rezo / gov / customs) bypass scoping for read models.
- The **web nav** mirrors the same permission strings, so each role only sees
  the pages it can use.

---

## Payment orchestration (Rezo never holds funds)

Defined in [`payments/payments.service.ts`](../apps/api/src/payments/payments.service.ts):

1. **Create** — aggregate a container's payable charges into one
   `PaymentRequest`. Charges are grouped **per payee** into `PaymentRouting`
   rows, plus one explicit **Rezo fee** routing. Idempotent on the client's
   `Idempotency-Key`.
2. **Authorize (once)** — freeze the FX rate onto every routing, then push each
   routing through the `PaymentRail` adapter. The rail returns a settlement
   reference; **no money passes through Rezo.**
3. **Partial failure** — routings settle independently. A failed routing frees
   its charges to be re-requested; the request reports `covered_charge_ids` /
   `failed_charge_ids` / `release_eligible`.

A container becomes **release-eligible** only when all non-review charges are
settled. FX is frozen at authorization; later rate changes never alter a past
request.

---

## Integration adapters (swap mock → real here)

All in [`src/integration`](../apps/api/src/integration), wired through a global
`IntegrationModule` with DI symbol tokens:

| Token                  | Interface              | Mock                              | Real replacement           |
| ---------------------- | ---------------------- | --------------------------------- | -------------------------- |
| `TERMINAL_ADAPTER`     | `terminal-adapter`     | `mock-terminal.adapter`           | Terminal OS (e.g. Octopi)  |
| `ASYCUDA_ADAPTER`      | `asycuda-adapter`      | `mock-asycuda.adapter`            | Customs / ASYCUDA          |
| `EXTRACTION_PROVIDER`  | `extraction-provider`  | `mock-extraction.provider`        | OCR / document AI          |
| `NOTIFICATION_ADAPTER` | `notification-adapter` | `mock-notification.adapter`       | Email / SMS gateway        |
| `PAYMENT_RAIL`         | `payment-rail`         | `mock-payment-rail.adapter`       | Bank / mobile-money rail   |

To go live with a vendor: implement the interface in a new class, bind the token
to it in `IntegrationModule`. **No business-logic code changes.** (Object
storage / MinIO is our *own* infrastructure, so `StorageService` uses it for
real — it is not a third-party adapter.)

---

## Configuration is data, not code

Fees, currencies, languages, and enabled modules are **per-market config**, not
hard-coded. Haiti is row one of the `Market` table (`code = "HT"`), whose
`tariff` JSON holds the full fee schedule in minor units. Subscription prices,
charge amounts, and alert schedules all derive from config. Adding a country is
a new `Market` row, not a code change.

---

## Testing & CI

- **API e2e** (`apps/api/test`, 7 suites, 25 tests) — run against an isolated
  `rezo_test` database that is migrated + seeded per run. Covers the Phase 1 and
  Phase 2 acceptance criteria (spec §9) plus the danger areas: idempotency, FX
  freeze, partial-failure, the no-funds-held invariant, and RBAC.
- **Web unit** (`apps/web/lib/*.test.ts`, 15 tests) — money formatting, deadline
  countdowns, and API-envelope/error handling.
- **CI** (`.github/workflows/ci.yml`) — on every push/PR: `npm ci` → Prisma
  generate → build (typechecks all workspaces) → lint → web unit tests → API
  e2e, with Postgres and MinIO provisioned as services. `global-setup.ts`
  provisions the test DB portably (no dependency on a specific container name).

```bash
npm run build          # build/typecheck all workspaces
npm run lint           # eslint (api) + next lint (web) + tsc (shared-types)
npm run test --workspace @rezo/web       # web unit tests
npm run test:e2e --workspace @rezo/api   # API e2e (needs infra up)
```

---

## Running locally

```bash
docker compose up -d                       # postgres + redis + minio
cp .env.example .env                        # dev values (no real secrets)
npm install
npm run prisma:migrate --workspace @rezo/api
npm run prisma:seed   --workspace @rezo/api # demo dataset (see below)
npm run dev:api        # http://localhost:4000/api/v1
npm run dev:web        # http://localhost:3000
```

Every seeded user shares the dev password `password123`
(`admin@rezo.test`, `importer@rezo.test`, `broker@rezo.test`,
`trucker@rezo.test`, `terminal@rezo.test`, `customs@rezo.test`,
`gov@rezo.test`, `importer2@rezo.test`, …). The seed stands up one voyage with
10 containers across every lifecycle stage so all screens are populated on first
login — see the README's *Demo dataset* section.

---

## Security posture (beta)

- Global JWT auth + deny-by-default RBAC; tenant isolation on every read path.
- `helmet` security headers; CORS restricted to `CORS_ORIGINS` when set.
- Strict input validation (`forbidNonWhitelisted`) guards against mass-assignment.
- `JWT_SECRET` is **required in production** — the app refuses to boot with the
  dev fallback when `NODE_ENV=production`.
- Errors never leak stack traces or internal messages to clients; Prisma errors
  map to proper HTTP codes.
- API keys are stored **hashed**; the plaintext is shown once.
- Append-only `AuditLog` records money movements and status changes.

---

## Known limitations & suggested next steps

The beta is intentionally scoped. Natural follow-ups, in rough priority order:

1. **Real adapters** — replace one mock at a time (payment rail and terminal OS
   are the highest-leverage), behind the existing interfaces.
2. **Real notification delivery** — wire the notification adapter to an
   email/SMS provider; the alert dispatcher and scheduling already exist.
3. **Rate limiting / throttling** on auth and write endpoints
   (`@nestjs/throttler`).
4. **Refresh tokens / session revocation** — today JWTs are short-lived bearers
   with no server-side revocation list.
5. **Second market** — prove the config-driven design by adding another country
   `Market` row end-to-end.
6. **Web component/E2E tests** — add React Testing Library + Playwright coverage
   on top of the current pure-logic unit tests.
7. **Observability** — structured request logging, metrics, and tracing.

---

*This beta implements the full 14-step build order of the Phase 1 & 2
specification. See the root [`README.md`](../README.md) for status, endpoint
inventory, and the step-by-step roadmap.*
