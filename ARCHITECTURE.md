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
                    │  webapp/  React PWA            │
                    │  dev: in-browser Babel         │
                    │  prod: precompiled bundle      │
                    │  store.js  ← local state       │
                    │  api-bridge.js → live API + ws │
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

**Consequences.** (a) Tests and dev need no external database. (b) The handle
records which store is running — `postgres`, `pglite-disk` (`./.pglite` or
`PGLITE_DIR`: survives restarts, single process, **not** encrypted at rest) or
`pglite-memory` (tests) — and `/api/health` exposes it as
`{persistent, storage, durable, secure}`; `persistent:true` still means "real
Postgres", which is what `deploy/aws/update.sh` checks. (c) With
`DATABASE_URL`, sessions live in Postgres too (`connect-pg-simple` on the app's
own pool, table `session`), so a restart or deploy no longer signs everyone
out; PGlite keeps the in-memory session store. (d) **Gotcha, fixed:**
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
because it is boring and mechanical. Since then one more answers without a
session: `GET /api/session`, the client's launch-time "anything to restore?"
probe, which tells a signed-out caller only `{ "authenticated": false }` (200,
`no-store`, so a cold start logs no 401 in the browser console) and a
signed-in one the same body as `GET /api/user`, which keeps its 401.

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

### ADR-010: Attachment bytes: base64 in the database by default, AES-256-GCM files for real PHI

**Decision.** `server/services/attachment-store.ts` has two stores, chosen by
`ATTACHMENT_STORE`. The default `db` keeps the bytes as base64 in
`message_attachments` — a synthetic-pilot shortcut. `fs-encrypted` (with
`ATTACHMENT_DIR` and a 32-byte `ATTACHMENT_KEY`) writes each upload as an
AES-256-GCM file (random IV, auth tag) and stores only an opaque ref in the
row; if the key is missing or invalid, uploads are refused rather than stored
in plaintext. Either way, access is checked per participant and audited on view.

**Consequences.** (a) Zero infrastructure for a synthetic pilot. (b) The `db`
store is **unfit for real PHI** (no application-layer encryption, blobs in every
backup) and the compliance monitor warns while it is active; the AWS runbook
sets `fs-encrypted`. Still missing for scale: object storage behind a BAA,
antivirus scanning, signed-URL delivery. (c) Attachment rows carry a
`message_id` FK, which made them a hidden participant in two cascade bugs — see
ADR-016; the retention purge deletes the encrypted file with its message.

### ADR-011: No build step in development; a precompiled bundle in production

**Context.** The UI began as a designer's kit of `.jsx` files served verbatim,
compiled in the browser. On a phone that meant ~5.7 MB of development React,
Babel and JSX and seconds of main-thread compilation on every launch.

**Decision.** React and Babel are vendored locally; `api-bridge.js` overrides
store actions to call the live API. Development serves the kit as-is (JSX
compiled in the browser). `npm run build:webapp` (part of `npm run build`)
compiles every script with the same Babel options, bundles them with
production React, content-hashes and precompresses the output, and records the
sha256 of every source; `server/webapp-static.ts` serves that bundle when
`NODE_ENV=production` (or `WEBAPP_BUNDLE=on`) and the recorded hashes match the
files on disk — a stale or partial build is refused and the dev kit is served
with a warning.

**Consequences.** (a) Edit a file, reload, done — in development. (b) Production
ships ~1.5 MB raw / ~270 KB brotli instead of ~5.7 MB raw; hashed files are
cached immutably, the shell is always revalidated. Only static files are
compressed by Node; API responses are not. (c) A Content-Security-Policy is
enforced in both modes (`default-src 'self'`, no plugins, no framing by other
origins, `connect-src` limited to this origin and its WebSocket). Dev mode
needs `script-src 'unsafe-inline'` for the in-browser compiler; the bundle's
shell has no inline script, so its policy drops it. `'unsafe-inline'` in dev
does not stop an injected script from running, which is one reason ADR-013
matters.

### ADR-012: The service worker precaches one complete, versioned shell

**Context.** The first strategy was stale-while-revalidate over unhashed
files: an installed PWA served **old code on first load** and deploys appeared
not to take. The network-first replacement fixed that, but its install-time
precache held only `index.html`, the stylesheet and the manifest, the scripts
were cached piecemeal by later loads, and `/api-bridge.js` was excluded by the
`/api` prefix — so the offline shell was blank after a fresh install or a
deploy, and an offline sign-in ran the kit without its API bridge.

**Decision.** The server serves `/sw.js` with the shell's version and its
COMPLETE precache list (every script, the stylesheet, manifest, icons;
derived from `index.html` or the build manifest; never `/api` or `/ws`, matched
by exact path segment). Install precaches all of it or fails, leaving the
previous worker and cache in charge; activate deletes old caches only once the
new one is complete; only install writes the cache. Hashed files are served
cache-first, everything else network-first with the precached copy as the
offline fallback; offline navigations get the precached shell.

**Consequences.** (a) A deploy changes the shell version, hence the worker's
bytes, hence a new install that precaches the new shell before taking over.
(b) The app opens offline from the first launch after the worker has
installed (one online visit), and shows the sign-in screen — clinical data
always needs the network (ADR-008, ADR-013). (c) `npm run test:offline`
proves this in real Chromium for both serving modes. (d) **For anyone
verifying a UI change in a headless browser: pass `serviceWorkers: "block"`
unless the service worker is what you are testing, or a stale worker can show
you the previous build.**

### ADR-013: PHI is not persisted to browser storage

**Context.** The store persisted its entire state — including conversations,
messages, and the patient board — to `localStorage`, and logout cleared only
the session. On a shared workstation the next user could recover clinical data.

**Decision.** Only non-PHI preferences (theme, layout, dashboard
customization) are persisted. Clinical slices stay in memory and are re-fetched
after login. Logout and lock clear the store key.

**Consequences.** (a) A cold load re-fetches rather than showing instant stale
clinical data — correct trade. (b) Layout customization still restores
instantly, and still syncs across devices server-side. (c) Identity (`me`,
`session`) is persisted only while signed in; sign-out leaves no name or user
id in storage. (d) Because sign-out purges the snapshot, nothing in browser
storage can be trusted to say *which kind of deployment* this is: the kit's
offline demo (fabricated patients) is entered only when the server answered
`/api/config` with `syntheticData:true` in the same page load, and a real
session that loses its connection never keeps an optimistic admission or
broadcast — it says nothing was sent (`tests/offline-signin.test.ts`).

### ADR-014: The lock screen re-authenticates against the server

**Context.** The original lock screen accepted **any** four digits, and its
"Face ID" button unlocked unconditionally — while the copy said "HIPAA".

**Decision.** Unlock requires the account password, verified by the server. The
client makes no local judgement about correctness.

**Consequences.** (a) The control is real, and inherits the auth rate limiter.
(b) The lock is the **session's**, not the browser's (A.CON-SHO-7): `POST
/api/session/lock` marks the session (or demo token) locked; every `/api` route
except `/user`, `/session`, `/config` and the sign-in routes then answers
`423 session_locked` (`/modules` included), `GET /api/user` reports
`locked: true`, the session's sockets are closed (4423) and it cannot open a new
one. Only a real sign-in unlocks — `POST /api/login` regenerates the session — so
deleting the browser's lock flag and reloading still lands on the lock screen.
(c) A locked session cannot be kept alive by traffic: express-session rolls its
15-minute expiry on every request (a 423 included), so the lock gate signs the
session out one idle window after the lock however often it is poked; the
client's 15-minute idle lock back-dates the lock by that idle time, which ends
the server session at once (automatic logoff). (d) Client side, the browser flag
is shared by every tab; while it is set the tab sends nothing but sign-in /
identity calls — no hydrate, no WebSocket-driven re-hydrate, no poll.
(`tests/app-lock.test.ts`, `scripts/phone-shell-check.mjs`.)

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

### ADR-019: Bind to loopback in production and trust proxies by address, never by hop count

**Context.** `trust proxy` was the hop count `1`: "whatever connected to me is
a proxy". Anyone able to reach the Node port directly could set
`X-Forwarded-For` and choose their own `req.ip` — their rate-limit bucket and
the address written to audit rows.

**Decision.** `TRUST_PROXY` resolves to an address list (`server/config.ts`
`resolveTrustProxy`): unset/`1`/`true` → `loopback` (Caddy on the same host,
the documented AWS topology); `0`/`false` → nothing; otherwise a comma list of
IPs, CIDRs and the keywords `loopback`, `linklocal`, `uniquelocal` (e.g. a
PaaS load balancer on a private network — `render.yaml` uses `uniquelocal`). A
legacy hop count ≥ 2 still works but is logged as spoofable. In production the
server binds `127.0.0.1` unless `HOST` is set, so only the local proxy can
reach it; a platform that connects over the network sets `HOST=0.0.0.0`.
Forwarded headers are believed only from a trusted peer and only one hop.

**Consequences.** (a) Behind Caddy nothing needs configuring. (b) A deployment
whose proxy is not on the host must set both `HOST` and `TRUST_PROXY`, or it
does not answer (loopback bind) or refuses sign-in with `insecure_transport`
(the Secure cookie needs the proxy's `X-Forwarded-Proto` to be believed).
`/api/health` reports `secure` so an operator can check through the proxy.
(c) The address matching itself lives in `proxy-addr`; 2.0.7 let an IPv4 peer
match an IPv6 trust range (GHSA-jqcg-44mw-7w3h), so the lockfile pins 2.0.8+
and `tests/dependency-advisories.test.ts` checks both the version and the
behaviour.

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
- **The seed gate is real.** `/api/health` reports `persistent` / `storage` /
  `durable` / `secure`, and the boot log states which database, session store,
  proxy trust and seeding mode are active — so a deployment can be checked
  rather than assumed.
- **A healthy server is not proof the seed worked.** The server only starts
  listening after its seed/ensure step, but a failure in that step is logged
  (`[db] seed/ensure failed`) and the server listens anyway; a 200 from
  `/api/health` therefore does not prove the demo accounts exist. Poll a real
  login instead.
- **Live-server harnesses are release gates.** `npm run test:ui`, `test:rt`,
  `test:e2e` and the Chromium checks under `scripts/` exit non-zero on any
  failed check, and the UI sweep fails if it ever finds itself signed out or
  locked instead of on the screen it is named after.

---

*Updates land with the change they describe. A decision that bit us in
production belongs here the day it bites.*
