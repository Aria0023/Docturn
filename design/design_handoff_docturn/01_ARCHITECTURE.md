# 01 — Architecture

DocTurn is a **single TypeScript monolith**: one Express process hosts the REST API *and* a
WebSocket server, serves the compiled React SPA, and talks to PostgreSQL through Drizzle. The Expo
mobile app shares the same backend through a typed `ApiClient`.

```
      Web SPA (React + Vite + TanStack, PWA)          Expo Mobile (React Native + native WS)
                  \                                       /
                   \___ HTTPS (cookie session) + WS /ws _/
                                      |
        ┌────────────────────────────▼─────────────────────────────┐
        │  Express (TypeScript, ESM) — single port                  │
        │   REST routes · WebSocket /ws · Passport sessions (15m)   │
        │   RBAC + tenant-scope middleware · PHI access logging     │
        │   Helmet · rate limiting · audit + security incidents     │
        └─────────┬───────────────────────────────┬────────────────┘
          Drizzle │                               │  service factories (env-gated)
                  ▼                               ▼
      ┌────────────────────────┐   ┌──────────────────────────────────────────┐
      │  PostgreSQL (Drizzle)  │   │  OpenAI · Twilio · Firebase FCM · Amion   │
      │  all tables scoped by  │   │  each: Live impl  ⇄  Stub fallback        │
      │  organization_id       │   │  (MockAI · ConsoleSms · NoopPush · Local) │
      │  connect-pg-simple ses │   └──────────────────────────────────────────┘
      └────────────────────────┘
```

## Design principles (keep these)

1. **Tenant isolation first.** Every read/write is scoped by `organizationId`. The storage layer
   exposes org-aware methods so route handlers cannot accidentally cross tenants. The
   rotation/selection helpers are the highest-risk surface — they must never cross tenants.
2. **Thin routes, central storage.** Data access lives behind one `storage` module (`IStorage`
   interface). Routes do validation (Zod) + authorization, then call storage.
3. **Server-authoritative state.** Assignment routing, expiry, roles, and MFA gating are computed
   on the server, never trusted from the client.
4. **Integrations behind interfaces.** Everything external is an interface with a local fallback,
   so the app runs with zero secrets and tests are deterministic. A factory picks live-vs-stub by env.
5. **One source of truth for types.** Drizzle schema + Zod insert schemas live in `shared/` and are
   imported by both server and client.

## Request lifecycle

1. **Session resolution** — `connect-pg-simple` deserializes the `docturn.sid` cookie into
   `req.user` (Passport).
2. **Authorization** — `requireAuth` + `requireRole(...)` assert the caller's role; handlers assert
   the target row's `organizationId` matches the caller's (`assertSameOrg`).
3. **PHI gate** — requests to `/api/patients` and `/api/assignments` append a `phi_access_logs` row
   (user, org, resource, method, IP, user-agent).
4. **Validation** — request bodies parsed with the shared Zod schema.
5. **Data access** — handler calls `storage.*` (tenant-scoped Drizzle queries).
6. **Audit** — security-relevant actions append `audit_logs`; suspicious events call
   `logSecurityIncident()`.
7. **Realtime fan-out** — state changes broadcast over WebSocket to the relevant tenant/users
   (org-scoped); push/SMS cascade handles out-of-app delivery.

## Technology stack

- **Backend:** Node 20, Express, TypeScript (ESM); Drizzle ORM + `pg`/postgres.js; Zod; Passport
  local + scrypt/bcrypt(12); express-session + connect-pg-simple; `ws`; speakeasy (TOTP).
- **Web:** React 18 + Vite; Tailwind + shadcn/ui; wouter; TanStack Query (query keys = endpoint
  path); `@dnd-kit`; lucide-react; light mode only; PWA / service worker.
- **Mobile:** Expo / React Native; bottom-tab navigation; native WebSocket; shared typed
  `ApiClient`; FCM push; QR org onboarding.
- **Data & infra:** PostgreSQL (`drizzle-kit push`); `pg.Pool` max 10; Helmet + tiered rate
  limiting; Nginx/Caddy TLS termination; Vitest + Supertest.

## Project structure

```
docturn/
├─ package.json                # scripts: dev, build, start, seed, test, db:push
├─ drizzle.config.ts
├─ .env.example                # SESSION_SECRET + DATABASE_URL (+ optional integration keys)
├─ shared/
│  └─ schema.ts                # Drizzle tables + enums + Zod insert schemas + inferred types
├─ server/
│  ├─ index.ts                 # Express bootstrap: middleware, session, routes, ws, static
│  ├─ db.ts                    # Drizzle client (pg)
│  ├─ seed.ts                  # deterministic seed (1 org, users per role, providers, patients)
│  ├─ storage.ts               # IStorage interface + tenant-scoped DatabaseStorage
│  ├─ auth.ts                  # Passport local, login/register, password hashing, MFA
│  ├─ rbac.ts                  # requireAuth, requireRole, assertSameOrg
│  ├─ audit.ts                 # appendAudit / logPhiAccess / logSecurityIncident
│  ├─ config.ts                # cached runtime settings + feature-flag resolution
│  ├─ routes/                  # auth, providers, patients, assignments, messaging, org,
│  │                           #   dev, cms, sms, mobile, broadcasts, config
│  ├─ services/               # rotation, expiry, notifications, ai-intake, sms, push,
│  │                           #   scheduler, mfa, suggestions
│  └─ ws/index.ts              # ws server, cookie→session auth, clients map, broadcast/sendToUsers
├─ client/                     # React + Vite + Tailwind + shadcn (recreate design/ui_kits/web-app)
├─ mobile-app/                 # Expo / React Native (recreate design/ui_kits/mobile)
└─ tests/                      # Vitest + Supertest integration tests
```

## Environments & scripts

- `npm run dev` — tsx watch server; Vite dev server proxied through it.
- `npm run seed` — wipe + reseed the database deterministically.
- `npm test` — Vitest (API integration tests against an in-memory/test database, all stubs).
- `npm run db:push` — Drizzle Kit pushes the schema (no hand-written SQL migrations).
- `.env`: `SESSION_SECRET`, `DATABASE_URL`. Every integration falls back to a local stub when its
  env vars are absent, so **no other secret is required** to run or test.
