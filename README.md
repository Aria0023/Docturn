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
| M8 | Hardening: Helmet, tiered rate limiting, error shape, audit, reduced-motion | ✅ |
| M9 | Full MFA: TOTP enroll/verify, single-use backup codes, SMS OTP, 202 gate | ✅ |
| M10 | Live integration factories (OpenAI/Twilio+carriers/FCM) — env-gated, stubbed | ✅ |
| M11 | Registration approval queue + developer console + CMS | ✅ |
| M12 | Departments/beds/equipment + metrics; emergency broadcasts + acks | ✅ |
| M13 | Mobile API + Expo app skeleton (`mobile-app/`) | ✅ |
| M14 | PHI logging on PHI routes, audit on sensitive actions, login rate-limit | ✅ |
| C1 | Runtime settings (`org_settings` / `user_preferences`) | ✅ |
| C2 | Per-org feature flags | ✅ |
| C3 | Adaptive suggestions (analyze → propose with evidence → human accept) | ✅ |
| v2 | Care-team on-call units + fan-out/accept-lock, patient board, consults, census override, dev provisioning | ✅ |

The design system and high-fidelity UI kits live in [`design/`](design/). What is safe and what
is still missing is tracked honestly in [`SECURITY.md`](SECURITY.md) and
[`docs/AWS_DEPLOYMENT_RUNBOOK.md`](docs/AWS_DEPLOYMENT_RUNBOOK.md) §15.

### Tests

The suite is not summarised by a count here (a hardcoded number drifted once and would again);
run it to see the current total.

- `npm test` — the Vitest + Supertest suite in [`tests/`](tests/): one file per surface (auth,
  sessions, registration, MFA, accounts, assignments + rotation, messaging, receipts, recall,
  attachments + voice, realtime WebSocket, notifications/escalation, push + device tokens, on-call,
  SMS, compliance + retention, metrics, modules, platform/developer audit, HTTP platform hardening,
  web-client static serving, production-dependency advisories), plus the real web client
  (`webapp/store.js` + `api-bridge.js`) driven in jsdom for realtime and offline sign-in behaviour.
  Each file gets its own in-process database. Must be green before a merge.
- Live-server checks (start a throwaway synthetic server first, e.g.
  `RATE_LIMIT=off SYNTHETIC_DATA=true npx tsx server/index.ts`); each exits non-zero on any failed
  check, so each can gate a release:
  - `npm run test:ui` — the real web client in jsdom: signs in as every role and clicks every
    button on every screen (never the sign-out / lock / role-switch controls, matched by text,
    `aria-label` or `title`; a sweep that finds itself signed out or locked fails), then drives the
    core flows end to end.
  - `npm run test:rt` — two concurrent users, two WebSockets, cross-user realtime handoffs.
  - `npm run test:e2e` — real Chromium: an iPhone-sized session against desktop sessions on one
    backend (messaging both ways, STAT acknowledge, admission accept, broadcast, role targets,
    DND, typed credentials). Needs a Chromium (`CHROME_PATH`, `/opt/pw-browsers/chromium`, or
    Playwright's own download); its final screenshot goes to `OUT_DIR` (default
    `<tmp>/docturn-interop`), and only `UPDATE_DOCS=1` rewrites `docs/mobile/interop-phone-final.png`.
  - `npm run test:login`, `npm run test:offline` (service-worker offline shell, dev and bundle
    modes, starts its own server), `scripts/realtime-e2e.mjs`, `scripts/csp-check.mjs` and the
    `scripts/phone-*-check.mjs` layout checks (real Chromium, iPhone profiles).
- CI (`.github/workflows/ci.yml`) runs typecheck + `npm test`, the `test:ui` / `test:rt` smokes, the
  build, and a production-dependency audit that fails on any high/critical advisory.

## Web client (one app for desktop and phone)

The UI the server serves at `/` is [`webapp/`](webapp/): React 18 screens (`.jsx`), a local store
(`store.js`) and `api-bridge.js`, which wires every store action to the live REST API and the
`/ws` WebSocket. It is responsive and installable — on a phone it *is* the mobile app (a PWA with a
manifest, service worker, home-screen icons and Web Push); see [`docs/MOBILE.md`](docs/MOBILE.md).

It runs in two modes ([`server/webapp-static.ts`](server/webapp-static.ts)):

- **dev** (default outside production): the `.jsx` files are compiled in the browser by the
  vendored Babel, with development React — edit a file, reload. About 5.7 MB of files (45), sent
  brotli/gzip-compressed (≈ 1.1 MB on the wire).
- **bundle** (`NODE_ENV=production`, or `WEBAPP_BUNDLE=on`, when a fresh build exists):
  `npm run build:webapp` (part of `npm run build`) precompiles every script into content-hashed,
  precompressed files with production React — about 1.5 MB raw / 270 KB brotli for the shell — and
  its CSP drops `'unsafe-inline'` from `script-src`. A stale or partial build is refused and the
  server falls back to dev mode with a warning.

Only the static client is compressed by Node; API responses are not. React, Babel and Lucide are
vendored, so nothing loads from a CDN.

```bash
npm run dev                                   # API + web client on :3000 (dev mode)
npm run build:webapp && WEBAPP_BUNDLE=on npm run dev   # try the precompiled bundle locally
npm run build && NODE_ENV=production npm start         # production (behind TLS — the session
                                              # cookie is Secure; see the AWS runbook)
```

[`client/`](client/) holds an older React + Vite + Tailwind SPA. The server serves it only if
`webapp/` is missing; `npm run build` still builds it.

## Mobile

There is no separate phone product: install the web app from the browser (see
[`docs/MOBILE.md`](docs/MOBILE.md)). [`mobile-app/`](mobile-app/) is an Expo / React Native
**skeleton**, not a shipped client (typed API client, reconnecting WebSocket, login / text-only
messages with live recall and read receipts / assignments / profile screens) kept for a possible
native wrapper; the backend's `/api/mobile/*` routes and device-token storage already exist for it.

## Architecture

A single TypeScript (ESM) monolith: Express hosts the REST API and the `/ws` WebSocket server,
serves the web client, and talks to PostgreSQL (or in-process PGlite) through Drizzle. The
load-bearing decisions are written up in [`ARCHITECTURE.md`](ARCHITECTURE.md). Key principles,
enforced in code:

- **Tenant isolation first.** Every storage method takes `organizationId` as its first argument and
  filters by it — a route handler cannot read another tenant's rows through it. The
  rotation/selection helper (`server/services/rotation.ts`) is the highest-risk surface and is
  strictly org-scoped.
- **Server-authoritative state.** Assignment routing, expiry, and roles are computed on the server,
  never trusted from the client.
- **Integrations behind interfaces** with local stubs (AI extractor, push, SMS, WS fan-out), so the
  app runs and tests with **zero secrets**.
- **One source of truth for types** — Drizzle tables + Zod schemas in `shared/schema.ts`; the
  idempotent DDL in `server/db.ts` (`SCHEMA_SQL`) mirrors it and is applied on every boot.

### No-secrets database

The default database is **in-process [PGlite](https://pglite.dev)** (a full Postgres in WASM), so
the app boots and tests run with no external services. It persists on disk in `./.pglite` (or
`PGLITE_DIR`) — data survives restarts, the files are **not** encrypted, and it is a
single-process dev/trial store, not for production or real PHI. Set `DATABASE_URL` to use a real
Postgres (via `pg.Pool`); the schema and queries are identical, the app applies its schema on
first boot, and sessions then live in Postgres too (`connect-pg-simple`, table `session`) instead
of in memory. `GET /api/health` reports which store is in use
(`{"persistent", "storage", "durable", "secure"}`). Tests use an isolated in-memory instance per
file.

## Running

```bash
npm install
npm run dev      # start the API + web client (default :3000); an empty database self-seeds
npm test         # run the Vitest + Supertest suite
npm run typecheck
npm run seed     # optional: (re)seed the dev database explicitly
```

No `.env` is required. To use a real Postgres, set `DATABASE_URL` + `SESSION_SECRET` (see
`.env.example`); the schema is applied on boot. Production deployment: see
[`docs/AWS_DEPLOYMENT_RUNBOOK.md`](docs/AWS_DEPLOYMENT_RUNBOOK.md) (Caddy on the same host; the
server binds `127.0.0.1` in production unless `HOST` is set) or `render.yaml`.

### Seed accounts (synthetic-data mode only; password `docturn`, or `DEMO_PASSWORD`)

Seeded only while `SYNTHETIC_DATA` is not `false`. Organization code **`ISPN`**:

| Username | Role |
|---|---|
| `director` | director (hospitalist director) |
| `er.director` | er_director |
| `er.doc` | er_doctor |
| `chen`, `patel`, `lopez`, `liu`, `wu` | hospitalist |

The cross-tenant operator `dev` lives on organization code **`DOCTURN`**. Locally it uses the demo
password; in production or real-PHI mode it exists only when `PLATFORM_ADMIN_PASSWORD` (12+
characters) is set. Two further isolated demo tenants (`HOSP`, `ER`) each have a `director`.

## Project layout

```
shared/schema.ts      # Drizzle tables + enums + Zod schemas + inferred types
server/
  db.ts               # Drizzle client (PGlite default, pg when DATABASE_URL set) + SCHEMA_SQL
  storage.ts          # IStorage interface + tenant-scoped DatabaseStorage
  auth.ts  rbac.ts    # Passport local + scrypt; requireAuth/requireRole/assertSameOrg
  audit.ts            # audit logs, PHI access logs, security incidents
  app.ts  index.ts    # Express app factory + bootstrap (HOST / TRUST_PROXY / PORT)
  config.ts           # session, CSP/helmet, proxy trust, rate limits (read by compliance checks)
  webapp-static.ts    # serves webapp/ (dev or precompiled bundle), compression, sw.js
  seed.ts             # deterministic seed (shared with tests)
  services/           # rotation, assignments, expiry, escalation, retention, push, sms, attachments
  routes/             # one module per API surface
  ws/                 # WebSocket server (tenant-scoped fan-out, presence)
  compliance/         # continuous control checks + evidence
webapp/               # the web client / PWA (see docs/MOBILE.md)
tests/                # Vitest + Supertest (+ jsdom client tests)
scripts/              # build-webapp, live-server smokes, Chromium checks
deploy/aws/           # bootstrap, systemd unit, Caddyfile, SSM env, update script
design/               # full design-system handoff + UI kits the client is built from
```

## Core invariants (enforced + tested)

- A provider's census increases **only** on accept and decreases on cancel-of-accepted — never on
  create/reject/expire.
- A rejected/expired assignment produces **exactly one** new pending assignment when an eligible
  provider exists (preferring a different provider than the one who just declined), and zero when
  none do.
- `rotation.selectNext` never returns a provider from another org, never one at/over cap unless cap
  relief raised the cap of every working provider in the round-robin shift set (relief never touches
  off-shift providers, and a lone provider is re-offered a rerouted patient without any relief), and
  prefers the lowest census. `previewNext` ("Next up") applies the same eligibility, and the web
  client's "Next up" surfaces (Director card, ER Quick hint, hospitalist position chip) read it from
  `GET /api/rotation/next` instead of guessing locally; the ER Quick tab sends `round_robin` without a
  `hospitalistId` and its confirmation names the provider the server actually assigned.
- Messaging never delivers a message to a non-participant.
