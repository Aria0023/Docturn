# DocTurn

DocTurn coordinates two things inside a hospital and keeps them fast, safe, and auditable:

1. **Patient assignment** — routing an ER physician's patient to the right inpatient provider
   (round-robin by live census, or manual), with acknowledgement tracking and expiry-driven
   automatic re-routing.
2. **Secure clinical messaging** — HIPAA-aware direct/group/emergency conversations with delivery
   and read receipts.

It is **multi-tenant** (many hospitals, each an `organization`), runs on web and mobile, and is
marketed publicly as **DoctorHeidi**. This repository implements the spec in
[`design/design_handoff_docturn/`](design/design_handoff_docturn/).

## Status

The **backend foundation (milestones M0–M5)** is implemented and tested:

| Milestone | Scope | State |
|---|---|---|
| M0 | Scaffold, schema, `db:push`, `GET /api/health` | ✅ |
| M1 | Passport auth, sessions, RBAC, deterministic seed | ✅ |
| M2 | Providers, directory, org config, rotation reset | ✅ |
| M3 | Patient intake + AI extraction (stub) | ✅ |
| M4 | Assignments, round-robin + cap relief, expiry, state machine ⭐ | ✅ |
| M5 | Secure messaging (conversations, send, read receipts, soft-delete) | ✅ |
| M6 | WebSocket realtime: presence, heartbeat, tenant-scoped fan-out | ✅ |
| M7 | React web client (login, role dashboards, messaging, directory, settings) | ✅ |
| C1 | Runtime settings (`org_settings` / `user_preferences`) | ✅ (routes) |

Remaining per `design/design_handoff_docturn/14_BUILD_PLAN.md`: **M8** hardening, **M9–M14** MFA /
live integrations / dev console / scheduling / mobile / compliance closeout, and **C2–C3** flags +
adaptive suggestions. The design system and high-fidelity UI kits live in [`design/`](design/).

`npm test` is green (21 tests across auth, the assignment state machine, messaging, and realtime
WebSocket delivery).

## Web client

A React 18 + Vite + Tailwind SPA in [`client/`](client/), wired to the API with TanStack Query
(query keys = endpoint paths) and a `WebSocketProvider` that invalidates queries on realtime events.
Routing is `wouter`; theme tokens map to `design/colors_and_type.css`. Screens: login, role-aware
dashboards (hospitalist accept/decline + on-shift toggle, ER intake with AI extraction + routing,
director provider/rotation controls), messaging with read receipts, directory, and settings.

```bash
npm run dev            # API on :3000
npm run dev:client     # Vite dev server on :5173, proxying /api + /ws to :3000
# or, single-origin: build the SPA and let Express serve it
npm run build:client && npm run dev   # open http://localhost:3000
```

## Architecture

A single TypeScript (ESM) monolith: Express hosts the REST API, talks to PostgreSQL through Drizzle,
and (M6 onward) will host the WebSocket server and serve the compiled React SPA. Key principles,
enforced in code:

- **Tenant isolation first.** Every storage method takes `organizationId` as its first argument and
  filters by it — a route handler cannot read another tenant's rows through it. The
  rotation/selection helper (`server/services/rotation.ts`) is the highest-risk surface and is
  strictly org-scoped.
- **Server-authoritative state.** Assignment routing, expiry, and roles are computed on the server,
  never trusted from the client.
- **Integrations behind interfaces** with local stubs (AI extractor, push, SMS, WS fan-out), so the
  app runs and tests with **zero secrets**.
- **One source of truth for types** — Drizzle tables + Zod schemas in `shared/schema.ts`, imported
  by both server and (future) client.

### No-secrets database

The default database is **in-process [PGlite](https://pglite.dev)** (a full Postgres in WASM), so
the app boots and tests run with no external services. Set `DATABASE_URL` to use a real Postgres
(via `pg.Pool`); the schema and queries are identical. The dev/seed PGlite database persists to
`./.pglite`; tests use an isolated in-memory instance per file.

## Running

```bash
npm install
npm run seed     # populate the dev database (org MERCY, one user per role)
npm run dev      # start the API (default :3000)
npm test         # run the Vitest + Supertest suite
npm run typecheck
```

No `.env` is required. To use a real Postgres, copy `.env.example` to `.env` and set `DATABASE_URL`
+ `SESSION_SECRET`, then `npm run db:push`.

### Seed accounts (dev password: `docturn`, org code `MERCY`)

| Username | Role | Notes |
|---|---|---|
| `director` | director | provider/org admin |
| `er.doc` | er_doctor | patient intake + assignment |
| `chen` | hospitalist | Cardiology, census 3/12, working |
| `patel` | hospitalist | General, census 5/12, working |
| `lopez` | hospitalist | Pulmonology, census 7/10, working |
| `liu` | hospitalist | Neurology, census 2/8, off shift |

## Project layout

```
shared/schema.ts      # Drizzle tables + enums + Zod schemas + inferred types
server/
  db.ts               # Drizzle client (PGlite default, pg when DATABASE_URL set)
  storage.ts          # IStorage interface + tenant-scoped DatabaseStorage
  auth.ts  rbac.ts    # Passport local + scrypt; requireAuth/requireRole/assertSameOrg
  audit.ts            # audit logs, PHI access logs, security incidents
  app.ts  index.ts    # Express app factory + bootstrap
  seed.ts             # deterministic seed (shared with tests)
  services/           # rotation, assignments (state machine), expiry, ai-intake, notifications
  routes/             # health, auth, providers, patients, assignments, messaging, org, settings
tests/                # Vitest + Supertest: auth, assignments, messaging
design/               # full design-system handoff + UI kits the client is built from
```

## Core invariants (enforced + tested)

- A provider's census increases **only** on accept and decreases on cancel-of-accepted — never on
  create/reject/expire.
- A rejected/expired assignment produces **exactly one** new pending assignment when an eligible
  provider exists (preferring a different provider than the one who just declined), and zero when
  none do.
- `rotation.selectNext` never returns a provider from another org, never one at/over cap unless cap
  relief raised every working provider's cap, and prefers the lowest census.
- Messaging never delivers a message to a non-participant.
