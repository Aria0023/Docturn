# Architecture

> The load-bearing engineering decisions behind DocTurn.
> Written for whoever picks this codebase up next — human or agent — so the
> same lessons don't have to be paid for twice.
>
> For *what is safe and what is missing*, see [SECURITY.md](SECURITY.md).
> This document is for *why it is built this way*.

## Contents

1. [System overview](#system-overview)
2. [Design decisions (ADRs)](#design-decisions-adrs)
3. [Verification discipline](#verification-discipline)

---

## System overview

```
                    ┌────────────────────────────────┐
                    │  webapp/  (no-build React)     │
                    │  UMD React + in-browser Babel  │
                    │  store.js  ← local state       │
                    │  api-bridge.js → live API      │
                    └───────────────┬────────────────┘
                                    │ same-origin, session cookie
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  server/  Express + TypeScript                                  │
│    routes/     one module per surface, all requireAuth          │
│    rbac.ts     server-side role + org enforcement               │
│    audit.ts    audit_logs (actions) + phi_access_logs (reads)   │
│    services/   rotation, escalation, retention, push, sms       │
│    compliance/ continuous control checks + evidence pack        │
│    storage.ts  IStorage → DatabaseStorage (every method orgId)  │
└───────────────┬─────────────────────────────────────────────────┘
                │ Drizzle
                ▼
┌─────────────────────────────────────────────────────────────────┐
│  PGlite (in-process, default)   OR   Postgres (DATABASE_URL)    │
│  schema: shared/schema.ts  ⇄  server/db.ts SCHEMA_SQL           │
└─────────────────────────────────────────────────────────────────┘
```

Every read is scoped by `organizationId`. The store is the only authority;
the client caches for responsiveness but never for truth.

---

## Design decisions (ADRs)

### ADR-001: PGlite by default, real Postgres when `DATABASE_URL` is set

**Context.** We wanted `git clone && npm run dev` to work with zero secrets,
while still running real Postgres in production.

**Decision.** `createDb()` returns a real `pg.Pool` when `DATABASE_URL` is
present, otherwise in-process PGlite (Postgres compiled to WASM). Same schema,
same Drizzle queries, same code paths.

**Consequences.** (a) Tests and dev need no external database. (b) A single
`ephemeral` boolean distinguishes the two, which `/api/health` now exposes as
`persistent` so a deployment can be checked at a glance. (c) **Gotcha, fixed:**
`ensureSchema` was originally a no-op on the real-Postgres branch, on the
assumption that `drizzle-kit push` would provision it. A fresh cloud database
therefore booted with **zero tables**. It now applies the same idempotent
`SCHEMA_SQL`, so a new Postgres self-provisions on first boot.

### ADR-002: Hand-written `SCHEMA_SQL` mirroring the Drizzle schema

**Context.** Dev and test need a schema without a migration toolchain.

**Decision.** `server/db.ts` holds hand-maintained DDL — `CREATE TABLE IF NOT
EXISTS` plus additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — mirroring
`shared/schema.ts`.

**Consequences.** (a) Idempotent: safe to run on every boot. (b) Additive-only
discipline means an older store upgrades in place. (c) **Cost:** every schema
change must be made in *both* files. A Drizzle-only change compiles fine and
then fails at runtime with "column does not exist". `initDbWithRecovery`
probes the core tables at boot specifically to catch that drift.

### ADR-003: Tenant isolation is an explicit argument, never an ambient default

**Context.** Multi-tenant clinical data. A missed filter is a reportable
breach, not a bug.

**Decision.** Nearly every `IStorage` method takes `orgId` as its first
argument and filters on it. There is no "current tenant" global. `assertSameOrg`
returns **404, not 403**, so cross-tenant probing cannot confirm that a record
exists.

**Consequences.** (a) Verified holding under adversarial testing — a director
in one org could not reach another org's patients, threads, or messages.
(b) Verbose call sites, deliberately. (c) The few unscoped methods
(`markRead`, `acknowledgeMessages`) are constrained by `userId` instead, so
they can only touch the caller's own rows.

### ADR-004: Authorization is server-side; the client only decides what to draw

**Context.** Role-gated UI is easy to fake from the console.

**Decision.** `requireAuth` + `requireRole` on the route. The webapp hides
controls for tidiness, never for security.

**Consequences.** Every one of the ~22 route modules was later enumerated in
an audit and found to require authentication, with only three deliberate
public endpoints (`/api/health`, `/api/config`, org lookup). The pattern held
because it is boring and mechanical.

### ADR-005: Care-team membership gates patient threads; oversight is break-glass

**Context.** `POST /api/messaging/patient-thread` originally checked only that
the patient existed in the caller's org, then added the caller to the thread.
Any authenticated user could self-join any patient's conversation and read its
full history — verified by extracting a diagnosis and MRN as an unrelated user.

**Decision.** Compute the legitimate care team first (attending, ER of record,
accepted consultants). Non-members get 403. Director / ER-director / developer
may still reach in, but that is recorded as `message.patient_thread_breakglass`
at `riskLevel: "high"` with their identity attached.

**Consequences.** (a) Access is need-to-know by default with an audited
override, rather than open with a log. (b) "Message care team" can now 403 for
an unrelated user — the UI must handle that rather than assume success.

### ADR-006: Demo credentials are gated by environment, not by hope

**Context.** Seeding ran unconditionally at boot, creating a cross-tenant root
account `dev` with a password committed to a public repository. It shipped to a
publicly reachable deployment.

**Decision.** Demo clinical accounts seed only in synthetic-data mode. The
cross-tenant root account is created in production **only** when
`PLATFORM_ADMIN_PASSWORD` is set and is at least 12 characters; otherwise it is
not created at all, and the refusal is logged loudly. Real-PHI mode
(`SYNTHETIC_DATA=false`) refuses to seed demo data entirely.

**Consequences.** (a) A pilot instance still works out of the box. (b) An
operator who wants the developer console must deliberately set a secret.
(c) Code cannot rotate a credential already sitting in a live database — that
remains an operator action, and the boot log says so.

### ADR-007: Synthetic-data mode defaults to ON

**Decision.** An instance is treated as test-only unless deliberately switched
with `SYNTHETIC_DATA=false`.

**Consequences.** The failure mode is a real deployment wearing a "synthetic"
banner — embarrassing but harmless — rather than a test deployment silently
accepting real PHI. Demo affordances (role chips, demo tokens) are compiled
behind the same flag.

### ADR-008: Push and SMS payloads are content-free

**Context.** Push and SMS transit vendors we have no BAA with.

**Decision.** Notifications carry a generic title only ("New secure message").
The device fetches real content over TLS after the user opens the app.

**Consequences.** (a) No PHI ever reaches Apple, Google, or a carrier.
(b) Notifications are less informative than a consumer messenger's, on purpose.
(c) The service worker never caches `/api` or `/ws`.

### ADR-009: Two separate logs — `audit_logs` and `phi_access_logs`

**Decision.** `audit_logs` records *actions* (who changed what, with a risk
level). `phi_access_logs` records *clinical record access*.

**Consequences.** (a) "Who read this chart?" — the §164.528 question — is
answerable from one table without filtering the noise of every UI action.
(b) They must be kept separately complete; auditing a write is not auditing a
read. (c) Neither log may contain clinical content — identifiers only.

### ADR-010: Attachments are base64 in the database — pilot only

**Decision.** Uploaded files are stored as base64 in `message_attachments`,
access-checked per participant and audited on view.

**Consequences.** (a) Zero infrastructure to stand up for a synthetic pilot.
(b) **Explicitly unfit for real PHI:** no application-layer encryption, no AV
scanning, and the blobs land in every backup. Real PHI requires object storage
behind a BAA with signed URLs. The code says so where the bytes are written.
(c) Attachment rows carry a `message_id` FK, which made them a hidden
participant in two cascade bugs — see ADR-016.

### ADR-011: The webapp has no build step

**Context.** The UI began as a designer's kit of `.jsx` files served verbatim.

**Decision.** React and Babel are vendored locally and JSX is compiled in the
browser. `api-bridge.js` overrides store actions to call the live API.

**Consequences.** (a) Edit a file, reload, done — no bundler. (b) Assets are
unhashed, which interacts badly with caching (ADR-012). (c) **CSP is disabled**
because in-browser Babel needs `unsafe-eval` — so any XSS would have full
access to whatever the client keeps in memory or storage. That is a real cost
of this decision and is why ADR-013 matters.

### ADR-012: The service worker is network-first for app code

**Context.** The static-asset strategy was stale-while-revalidate. Because the
app's files are unhashed, an installed PWA served **old code on first load**
and only revalidated in the background. Deploys appeared not to take. This cost
hours of debugging where fixes "didn't work" — they had shipped fine and were
being served from cache.

**Decision.** App code is fetched network-first, with cache as an offline
fallback only. The cache version was bumped so old caches are purged on
activate.

**Consequences.** (a) A deploy is visible on the next load. (b) Slightly more
network on a warm start. (c) **For anyone verifying this app in a headless
browser: pass `serviceWorkers: "block"`, or you will screenshot the previous
build and believe it.**

### ADR-013: PHI is not persisted to browser storage

**Context.** The store persisted its entire state — including conversations,
messages, and the patient board — to `localStorage`, and logout cleared only
the session. On a shared workstation the next user could recover clinical data.

**Decision.** Only non-PHI preferences (theme, layout, dashboard
customization) are persisted. Clinical slices stay in memory and are re-fetched
after login. Logout and lock clear the store key.

**Consequences.** (a) A cold load re-fetches rather than showing instant stale
clinical data — correct trade. (b) Layout customization still restores
instantly, and still syncs across devices server-side.

### ADR-014: The lock screen re-authenticates against the server

**Context.** The original lock screen accepted **any** four digits, and its
"Face ID" button unlocked unconditionally — while the copy said "HIPAA".

**Decision.** Unlock requires the account password, verified by the server. The
client makes no local judgement about correctness.

**Consequences.** (a) The control is real, and inherits the auth rate limiter.
(b) The genuine automatic-logoff control remains the **server's** 15-minute
rolling idle expiry; this screen is its companion, not a substitute.

### ADR-015: Rate limiting is on by default and must stay on

**Context.** `RATE_LIMIT=off` was set in the deployed environment so demo
role-switching wouldn't trip the limiter. That disabled brute-force protection
on login for a publicly reachable instance.

**Decision.** Limiters stay mounted (50 auth attempts / 15 min / IP). If a
shared-NAT site legitimately trips it, raise `AUTH_RATE_LIMIT` in
`server/config.ts` — do not disable the limiter.

**Consequences.** The app records the rate-limit posture it *actually mounted*
at boot, so the compliance check reports reality rather than what an env var
implies.

### ADR-016: Deletion paths must enumerate every FK, and must not destroy audit history

**Context.** `message_attachments` was omitted from both the retention purge
and the tenant-delete cascade. The purge threw a FK violation and — because the
whole org loop shared one try/catch — silently aborted for *every* org, while
the UI advertised working auto-deletion. The tenant cascade, when it did
succeed, hard-deleted the audit and PHI-access logs.

**Decision.** Cascades enumerate every dependent table, children before
parents. Per-org failures are isolated and recorded rather than swallowed.
Compliance history survives tenant deletion.

**Consequences.** (a) Adding a table with an FK to `messages` or
`organizations` means updating these paths — treat it as part of the schema
change, not a follow-up. (b) An advertised control that silently fails is worse
than an absent one; see ADR-018.

### ADR-017: Compliance checks read the same objects the app mounts

**Context.** A compliance dashboard that reports intent rather than reality is
worse than none.

**Decision.** Session policy, cookie options, the helmet instance, and rate
limits live in `server/config.ts`. `createApp()` builds the running middleware
from them and the checks read *the same objects*. HSTS is probed by invoking
the real middleware and reading the emitted header. No check may hardcode a
passing status; a check that cannot prove something returns `unknown`, never
green. Attesting an automated control is rejected outright.

**Consequences.** (a) A duplicated literal cannot drift from reality, because
there is no duplicate. (b) The dashboard reports genuine failures against our
own deployment — which is the point.

### ADR-018: Never advertise a control that does not exist

**Context.** The UI claimed AES-256 encryption at rest (no encryption code
existed), "access audited" on threads (reads were not logged), and a HIPAA lock
screen (cosmetic).

**Decision.** A claim ships only when the control is real. If a control is
removed or found broken, the claim comes down in the same change.

**Consequences.** (a) The visible security story is smaller and true.
(b) In the one case where the truth was stronger than the marketing —
credentials are env-only, never in the database, never logged — saying so
plainly was the better claim anyway.

---

## Verification discipline

Nothing here is called "working" because it compiles.

- **Tests gate the merge**, but a green suite is not evidence that a *user-facing*
  change works. UI and layout changes are verified in a real browser.
- **Browser verification blocks the service worker** (ADR-012). Skipping that
  produced three separate "the fix didn't work" investigations where the fix was
  fine and the cache was stale.
- **Security fixes are verified by re-running the exploit**, not by reading the
  patch: confirm it fails against the old code and passes against the new.
- **The seed gate is real.** `/api/health` reports `persistent`, and the boot log
  states which database and which seeding mode is active — so a deployment can be
  checked rather than assumed.
- **Wait for the server to be seeded, not merely listening.** `/api/health`
  returns 200 before seeding finishes; poll a real login instead.

---

*Updates land with the change they describe. A decision that bit us in
production belongs here the day it bites.*
