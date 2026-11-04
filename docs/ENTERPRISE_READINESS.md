# DocTurn — Enterprise readiness

What a hospital IT security review asks for, split the only honest way:

- **In code and tested** — the server enforces it, a test proves it, and the
  compliance monitor (`server/compliance/controls.ts`) measures it from live
  state. Each item names its files, its tests and the number they produced.
- **Organizational** — a BAA, a pen test, a DR drill, a signed policy. Code
  cannot provide these; the compliance monitor carries them as *manual*
  controls that a named owner attests to. They are listed so nobody mistakes
  a green dashboard for a finished review.

Programme map (one section per feature; module ids in `shared/modules.ts`):

| Feature | Modules | Status |
|---|---|---|
| E1 Multi-instance safety | `enterprise.multiInstance` (cluster view only — the mechanisms are never per-org) | in code and tested (below) |
| E2 Identity: OIDC SSO, SCIM, session policy, audit export | `enterprise.sso`, `enterprise.scim`, `enterprise.sessionPolicy`, `enterprise.auditExport` | in code and tested as each section below says; every switch is OFF by default |
| Native shell | `mobile.nativeShell` | module id in place; section added with the shell |
| Themes | `platform.userThemes` | table and module id in place; section added with the presets |

---

## E1 — Multi-instance safety (in code and tested)

**Why it matters to a reviewer.** A production deployment runs N instances
behind a load balancer and restarts them on every deploy. Everything that
used to live in one process — realtime fan-out, rate-limit counters, the
background sweeps, the shutdown — is now either shared through Postgres or
handled explicitly. Every mechanism below is active automatically when
`DATABASE_URL` is set; without it (the PGlite dev/trial store, the Render
demo) the deployment is one process by design and stays exactly as before.

### What the server does

| Mechanism | Where | Behaviour |
|---|---|---|
| **Realtime bus** | `server/services/bus.ts`, `server/ws/index.ts` | The WebSocket hub delivers every frame to its own sockets, then publishes it. `PostgresBus` (DATABASE_URL set) uses `LISTEN`/`NOTIFY` on a dedicated listener connection, publishes with `pg_notify()` through the app pool, filters its own frames by instance id and reconnects with backoff if the listener drops. `InProcessBus` otherwise (no peers, zero cost). |
| **Large frames by reference** | `bus.ts` `encodeFrame`/`decodePayload`; resolvers in `server/routes/messaging.ts` and `server/routes/broadcasts.ts` | A NOTIFY payload is capped at 8000 bytes. A frame over 7000 bytes (`MESSAGE_RECEIVED`, `BROADCAST_CREATED` — the only frames carrying free text) is published as `{type, organizationId, id}` and the receiving instance re-reads the row and rebuilds the frame with the same decoration as the thread view. Any other oversized frame is dropped and counted, never truncated. |
| **Session control across instances** | `server/ws/index.ts` (`revoke` / `lock` frames) | A password change, reset, deactivation, "sign out all" or app lock announced on one instance closes the person's sockets on every instance (1008 `session_revoked` / 4423 `session_locked`), sparing the session that made the change. |
| **Job leases** | `server/services/job-leases.ts`, `job_leases` table, `storage.claimJobLease` | Every timer in `server/index.ts` (expiry, auto-clean, Amion sync, Epic sync, STAT escalation, unread reminder, retention) fires on every instance but a tick RUNS only after one atomic `UPDATE job_leases … WHERE lease_until <= NOW()` claims the job's row. A lease lasts 90 % of the job's interval; the clock is the database's; a dead holder's lease is reclaimed when it lapses; a graceful shutdown gives leases back at once. Portable to PGlite (the tests run there). |
| **Shared rate limits** | `server/rate-limit-store.ts`, `rate_limit_hits` table, `server/app.ts`, `server/auth.ts` | The login (per IP, failures), account (per org+username, failures) and registration (per IP, every request) limiters count in Postgres with one upsert per hit when `DATABASE_URL` is set — one budget across all instances — and in memory otherwise. The general `/api` limiter (300/min) stays in memory on purpose (a database write per request would cost more than it protects). The compliance control `auth-rate-limit` says which store is active. |
| **Boot under concurrency** | `server/db.ts` `withBootLock`, `server/index.ts` | `CREATE TABLE IF NOT EXISTS` is not atomic across sessions (two instances booting together on an empty database failed with a `pg_type` unique violation — found by the probe below), and two first boots would both seed. Schema and seed now run under a Postgres session advisory lock. |
| **Graceful SIGTERM** | `server/shutdown.ts`, `server/index.ts`, `server/routes/health.ts` | SIGTERM/SIGINT: stop timers → stop accepting and close idle keep-alive sockets (`/api/health` answers 503 so the load balancer drains) → close every WebSocket with **1012 `server_restart`** (the web client's reconnect-with-backoff path; only 1008 and 4423 mean "sign in again") → wait for in-flight requests up to `SHUTDOWN_TIMEOUT_MS` (default 10 s) → release leases, close the bus and the pool → exit 0 (1 if the deadline forced it). |
| **Request id** | `server/request-id.ts`, `server/app.ts` | Every request gets an `X-Request-Id` (the proxy's when it is a plain token, else a UUID), echoed on every response, carried as `requestId` in every error body the central error middleware answers and on its log line — never PHI, never the database's error text. |
| **Instance identity** | `server/instance.ts` | `INSTANCE_ID` / `RENDER_INSTANCE_ID`, else host-pid-random. Boot log line: `instance <id>: realtime bus …; job leases in job_leases; rate limits …`. |
| **Cluster view** | `GET /api/dev/cluster` (developer, module `enterprise.multiInstance`, off by default) | Instance id, bus status and counters, every job lease and its holder, limiter / session store, and one honest `multiInstanceSafe` boolean — all read from live state. |
| **Compliance control** | `multi-instance-safety` (auto) | Pass with Postgres + connected bus + Postgres sessions + database limiter store; warn on the single-process PGlite run; fail when Postgres is configured but any part is per-instance. |

### How it is tested

| Test | What it proves | Result |
|---|---|---|
| `tests/realtime-bus.test.ts` | Wire format (inline / by-reference / dropped / own-origin filtered); two hubs on two HTTP servers joined by the in-process fake transport (always runs) and by **real Postgres LISTEN/NOTIFY** (`PG_TEST_URL`): message, typing relay, 10 KB message by reference, oversized broadcast by reference with its recipient flag, password change → 1008 on the other instance, deactivation and lock → 1008 / 4423, no duplicate delivery. | 15/15 on PGlite + fake transport; 15/15 with the Postgres describe against PostgreSQL 16.13 |
| `tests/job-leases.test.ts` | Two holders racing for one tick → exactly one runs; 90 % lease; stale lease reclaimed; failed tick never poisons; release returns only the holder's leases; the timer registry lists all seven loops (so none bypasses the lease). | 7/7 (failed first: the registry was empty before the loops were moved) |
| `tests/rate-limit-store.test.ts` | Window / lapse / decrement / prune semantics; two Express apps on one database share the per-account budget (10 failures split 5/5 → 429 on both) and the registration budget; successes decrement; the memory store is recorded without `DATABASE_URL`. | 5/5 (failed first) |
| `tests/request-id.test.ts` | UUID when absent, echo when valid, replacement when not; error bodies and the log line carry the id; success bodies untouched. | 4/4 (failed first) |
| `tests/shutdown.test.ts` | Order of the drain (timers → sockets → in-flight → leases → bus → db), refusal of new connections, exit 0 / 1 on deadline, 1012 on sockets, 503 on `/api/health` while draining. | 3/3 (failed first) |
| `tests/pg-boot.test.ts` (`PG_TEST_URL`) | Two handles applying the schema at once; two first boots seeding at once → one demo org, one platform org, no duplicate users. | 2/2 (failed first with the `pg_type` race) |
| `tests/client-realtime.test.ts` "E1: close 1012" | The real web client (jsdom) reconnects with backoff on 1012, keeps its session and PHI slices, probes nothing. | passes |
| `scripts/multi-instance-check.mjs` | **Two real server processes** on one PostgreSQL 16.13 (`PROBE_CREATE_DB=1` makes a throwaway database): cookie from A opens a socket on B; message, 10 KB message, typing and a password change cross; `job_leases` holders; `rate_limit_hits` rows; SIGTERM on A → 1012, new connections refused, the half-sent request in flight is answered 201, exit 0, leases released, B untouched, B exits 0. Without `DATABASE_URL`: one PGlite instance, the request-id and SIGTERM legs. | 24/24 (two instances on Postgres); 10/10 (one instance on PGlite) |

Real Postgres for these tests: `/usr/lib/postgresql/16/bin` in this
environment; `initdb` refuses root, so a `pgtest` user owns a cluster under
`/home/pgtest/pg` on port 9020 (`PG_TEST_URL=postgresql://pgtest@127.0.0.1:9020/docturn_test`).
The vitest Postgres describes are skipped — and say so — when `PG_TEST_URL`
is unset; the in-process fake transport describe always runs.

### What an operator must do (not optional)

- Run with `DATABASE_URL` (Postgres). Every instance of one deployment needs
  the **same** `SESSION_SECRET` (a cookie signed by one instance is verified
  by another — the probe found this the first time it ran), the same
  `INTEGRATION_KEY` and `ATTACHMENT_KEY`.
- Give the process **≥ `SHUTDOWN_TIMEOUT_MS` + 2 s** before SIGKILL
  (`deploy/aws/docturn.service` sets `TimeoutStopSec=20`; Render allows its
  default grace). Point the load-balancer health check at `/api/health`.
- `ATTACHMENT_STORE=fs-encrypted` writes to the instance's own disk: with N
  instances `ATTACHMENT_DIR` must be shared storage, or use the object-store
  step in `docs/AWS_DEPLOYMENT_RUNBOOK.md` §15. (The Render demo uses the
  in-database store, which is already shared.)

### Honest gaps

- **Presence is per instance.** `USER_PRESENCE_CHANGED` frames cross the bus,
  but the snapshot `GET /api/presence` (and the hub's `onlineUserIds`) lists
  sockets on the answering instance only. A shared presence table is the fix;
  not built.
- **A tick must finish within its interval.** The lease is 90 % of the
  interval and is not extended while a tick runs; a sweep that ran longer
  (none does today — all are sub-second, the schedule pulls are bounded HTTP
  calls) could overlap with a sibling's next tick.
- **The general `/api` limiter is per instance** (deliberately, see above);
  the brute-force controls are the shared ones.
- **Frames with no resolver that exceed 7000 bytes are dropped** (counted in
  the bus status and logged by type). Today no such frame exists.
- Node's `server.closeIdleConnections()` ends idle keep-alive sockets; a
  client that reuses one mid-drain gets a connection error and retries like
  any network blip — the web client already does.

---

## E2 — Identity (in code and tested)

Four separate switches, all OFF by default, so nothing below changes how an
existing tenant behaves until a developer turns it on for that tenant.

### E2.3 Session policy + "sign out everywhere" (module `enterprise.sessionPolicy`)

**Why it matters to a reviewer.** "Automatic logoff" (§164.312(a)(2)(iii))
was one number for every tenant: a 15-minute idle timeout. A hospital asks to
set its own window, to cap how many devices one login may be on, to put a
hard ceiling on a session's life, and to be able to end one person's sessions
everywhere after a lost phone — without changing their password.

| Setting | Where | Behaviour |
|---|---|---|
| **Idle timeout** (minutes, 5–480, default = today's 15) | `server/session-policy.ts`, `org_session_policy.idle_minutes` | Enforced by the SESSION STORE, not by a timer of ours: express-session is `rolling`, so the gate sets this request's `cookie.maxAge` to the org's window and the store's expiry moves with it. The web client's own idle auto-lock arms with the same number (`idleMinutes` on `GET /api/user` / `GET /api/session`, read by `webapp/index.html`), so the screen locks when the server's session ends rather than 15 minutes earlier or later. |
| **Absolute maximum** (hours, 1–720) | same | Counted from `user_sessions.issued_at` — when the session was FIRST seen — so rolling the cookie cannot extend it. Past it: 401 `{ error: "session_ended", reason: "absolute_timeout" }` and the socket closes 1008 `session_expired`. |
| **Maximum concurrent sessions** (1–20) | same | A new session's first authenticated request (or its socket upgrade) evicts the OLDEST live session of that person; the evicted one is told WHY — 401 `{ error: "session_ended", reason: "max_concurrent" }` and 1008 `session_evicted` — and the web client says "you signed in on another device and your organization limits…" instead of "your session expired". Audited (`auth.session_evicted`). It applies to directors too (the probe proves it on its own session). |
| **Sign out everywhere** | `POST /api/account/sessions/revoke-all` (self, Settings → Security), `POST /api/accounts/:id/sessions/revoke-all` (director / ER director / developer, People screen) | Two mechanisms: `users.sessions_revoked_at` is the durable one — every session issued before that moment stops resolving in `resolveSessionUser`, so it holds on every instance, for HTTP and for the socket upgrade, **and keeps holding if the module is switched off afterwards** — and the live sockets are closed at once (1008 `signed_out_everywhere`). The acting session is re-stamped and continues. A developer's own "sign out everywhere" also ends the impersonated / managed-org portals they opened. Audited (`auth.sign_out_everywhere`, medium). |
| **The registry** | `user_sessions` (new table) | ONE row per express-session id, holding a **SHA-256 of the id** (never the id), when it was first seen, when it was last seen (touched at most once a minute) and whether/why it was revoked. Written on the session's first authenticated request, so every sign-in path — password, second factor, a future SSO — is covered without each one remembering. A row is counted as live only while `last_seen_at` is inside the idle window, because after that the cookie has expired in the store too. Borrowed (impersonated) sessions get no row: an operator's portal must never evict the person whose account it is signed in as. Cascaded in the tenant delete and the user delete. |
| **Cost when off** | `applySessionPolicy` | One cached module lookup and no query. Nothing changes for an org that has not turned it on. |
| **Re-authentication is never blocked** | `SIGN_IN_PATHS` in the gate | `/api/login`, `/api/register` and `/api/2fa/*` are never refused by the gate: a person whose session was just ended must be able to sign in again in the same browser, carrying the dead cookie. (A regression test pins this — it was a real bug in the first draft.) |
| **Compliance control** | `session-timeout` (auto) | Now reads the ORG's effective window as well as the platform default. A director who widened it past 15 minutes is a **warn with the number** (and the absolute maximum if set), never a green row describing a 15 minutes nobody enforces. |

### How it is tested

| Test | What it proves | Result |
|---|---|---|
| `tests/session-policy.test.ts` | 404 while the module is off; defaults + bounds; every bound refused (8 bodies); persistence, clearing and the audit rows; a director-only setting; the re-issued cookie carries the org's window (parsed off `Set-Cookie`); the absolute maximum ends a session that has had traffic throughout; max-concurrent evicts the oldest and tells it why on HTTP **and on a real socket** (1008 `session_evicted`); nothing is enforced with the module off; sign out everywhere (self and by a director) with its socket close reason, its survival of the module being switched off, the 403 for a clinician, the 404 across tenants, and a re-login in the same browser. | 11/11 (failed first: the module, the table and the routes did not exist) |
| `tests/client-session-policy.test.ts` | The real `webapp/store.js` + `api-bridge.js` in jsdom: the idle window comes off the identity body (absent = platform default); a 401 `session_ended` and each socket close reason produce the right sentence and no reconnect/probe; the card sends ONE PUT of the changed field and shows the server's answer; refusals say why and leave the server's values; clearing is one DELETE; both sign-out actions and their counts. | 12/12 (all 12 fail against HEAD's client via `CLIENT_SRC_ROOT`) |
| `scripts/session-policy-check.mjs` | Real Chromium, iPhone 375 / 390 / 430: module off → no card, no sign-out row, no People action, both routes 404; module on → the card is the server's, one choice is one PUT with the server's sentence, the page's own idle window becomes the org's 30 minutes after a reload, "Back to the default" clears it; **two real browsers**: sessions-per-person 1 evicts the first, which lands on the sign-in screen with the reason; "Sign out everywhere else" ends the other browser and keeps this one; People → sign a person out of every device returns their open app to sign-in and their account still signs in; ≥44px targets, ≥16px selects, no overflow, zero CSP violations. With `REAL_BASE_URL` (`SYNTHETIC_DATA=false`): a fresh tenant has it off, switched on it reports the platform defaults, and a value outside the bounds is refused. | 44/44 (including the non-synthetic leg) |

### Honest gaps

- A closed browser's session still counts towards `maxConcurrent` until its
  idle window lapses: nothing tells the server a tab was closed. Someone who
  closes and re-opens the app more than `maxConcurrent` times inside one idle
  window evicts their own older sessions (which is what the rule says, but it
  can surprise).
- An eviction is enforced while the module is ON. Switching the module off
  stops enforcing the cap, so a session evicted under it could be used again
  within its idle window — consistent with "no cap configured", but worth
  knowing. "Sign out everywhere" is deliberately NOT like this.
- `last_seen_at` is touched at most once a minute, so the eviction order can
  be up to a minute stale. The idle window is at least five minutes, so this
  cannot make a live session look dead.
- The policy is per org, not per role or per device class.

### E2.4 Audit export (module `enterprise.auditExport`)

**Why it matters to a reviewer.** An auditor asks for "the trail for last
quarter, as a file". Before this, the Compliance screen could download the
WHOLE trail as CSV and nothing else: no date range, no machine-readable
format, no way for the operator to pull one tenant's trail, and the `details`
JSON went out verbatim.

| What | Where | Behaviour |
|---|---|---|
| **Two forms of one endpoint** | `GET /api/audit/export`, `server/routes/compliance.ts`, `server/compliance/audit-export.ts` | The **legacy** form (`?trail=audit\|phi&scope=org\|mine`) is the Compliance screen's "Export CSV" and is **unchanged and ungated** — every org keeps it, including a clinician's own trail. The **enterprise** form is recognised by any of `from`, `to`, `format`, `orgId` (`isEnterpriseExportRequest`) and is the one the module gates. |
| **Date range** | `from`, `to` | A UTC day (`2026-02-10`) or a full ISO instant; a day used as `to` covers the whole day, so `from=to=` one day is that day. Backwards or unparseable → 400. |
| **Format** | `format=csv\|json` | The JSON form carries `generatedAt`, the organization, the range, the declared `columns`, `rows` and its own `rowCount`. Both formats carry the SAME columns, so `details` is one rendered `k=v; k=v` cell in JSON too. |
| **Streaming** | `pageAuditLogs` / `pagePhiAccess` (keyset on `id` ASC, 500 rows a page) | Rows are written as they are read: a six-year trail never has to fit in memory, and there is no `Content-Length` to precompute (the response says `X-Export-Streamed: 1`). The client therefore counts the rows of the file it just saved rather than trusting a header that cannot exist. |
| **Who** | `requireAuth` + the compliance roles | Director / ER director / developer. A developer may name any tenant with `orgId`; a director naming another tenant is **403**. A clinician is 403 on the enterprise form and keeps the legacy own-trail CSV. |
| **Cross-tenant is audited where it happened** | `appendAudit` on the TARGET org | `audit.export` with `riskLevel: "high"` and `details { crossTenant: true, operatorOrganizationId }` — the tenant can see that the operator read their trail. A director's own-org export is `medium`. A developer's cross-tenant read also needs the module ON **for the target tenant**, not only for the operator tenant (the central gate can only see the caller's org). |
| **Rate limit** | `EXPORT_RATE_LIMIT` (20 / hour / address), `server/app.ts` | Counts every request, successes included: one call reads a whole trail. |
| **PHI-free columns** | `EXPORT_AUDIT_COLUMNS`, `EXPORT_PHI_COLUMNS` | Times, actions, risk, workforce identity (id / username / role / display name), resource type + id, and for the PHI trail the method, resource, `patient_id` and IP. `patient_id` is DocTurn's own row id — not an MRN, a name or a date of birth — and it is what makes the trail usable for a §164.528 accounting. **`user_agent` is deliberately absent**: it is the only column that is a free-form string the client chose, and an accounting never needs it (the in-app PHI trail and the legacy CSV still show it). |

**The `details` decision (what is "safe").** `audit_logs.details` is JSONB
that every route fills as it likes, and a few routes do put a name in it (a
consult service's name, an org's name, a background job's error string). None
is patient data today; an export that leaves DocTurn must not depend on that
staying true. So the projection (`safeDetails`) is a positive allow-list:

- a **number, boolean or null** value is exported whatever its key — ids,
  counts and flags cannot carry free text;
- an **array of numbers** is exported joined with `|` (id lists);
- a **string** value is exported only under `SAFE_DETAIL_STRING_KEYS`:
  `action, code, controlId, format, integration, key, level, method, mimeType,
  module, priority, reason, requestedRole, result, riskLevel, role, scope,
  severity, shift, source, status, targetKind, trail, trigger, username,
  vendor`;
- an **array of strings** only under `SAFE_DETAIL_KEY_LIST_KEYS`
  (`changedKeys, fields, keys, themeKeys`) — those list COLUMN or SETTING
  NAMES, never their values;
- everything else is dropped and its **key** is named in the row's
  `details_omitted` column, so the export never hides that something was
  recorded — it only refuses to copy the value out. (`name`, `description`,
  `value`, `changed`, `error` and `label` are therefore always omitted.)

### How it is tested

| Test | What it proves | Result |
|---|---|---|
| `tests/audit-export.test.ts` | The projection (kept / omitted, no free-text key in the allow-list); 404 while the module is off **and** the legacy form still 200; streamed JSON shape, columns and projection; an inclusive day range; 400 on a bad format / date / backwards range; a hospitalist 403 on the enterprise form but 200 on the legacy own-trail one; a developer's cross-tenant export audited on the target org at high risk; a director refused another tenant; the PHI trail without `user_agent`; 429 from `EXPORT_RATE_LIMIT` on an app with limiters on. | 11/11 (failed first: the module did not exist) |
| `tests/client-audit-export.test.ts` | The real `webapp/api-bridge.js` in jsdom: the range and format are SENT (the client never filters rows), the row count comes from the file (CSV lines / JSON `rowCount`), the legacy call is byte-identical, `module_disabled` and 400 say why and download nothing. | 5/5 (4 of the 5 fail against HEAD's client via `CLIENT_SRC_ROOT`; the legacy one passes — that is the no-regression check) |
| `scripts/audit-export-check.mjs` | Real Chromium, iPhone 375 / 390 / 430: module off → no range, no JSON, the plain CSV still downloads and the endpoint 404s on the enterprise form; module on → From/To + JSON appear, the range reaches the server, the saved file is the server's, the toast's count is the file's own, the screen stops claiming "every row"; JSON rowCount / declared columns / no user agent; the PHI trail; a backwards range refused with nothing downloaded; cross-tenant audited on the target; ≥44px targets, ≥16px date inputs, no overflow, zero CSP violations. With `REAL_BASE_URL` (a `SYNTHETIC_DATA=false` server): a fresh tenant has it off, its director still gets the plain CSV, and switched on it exports that tenant's rows only. | 45/45 (synthetic only); 49/49 with the non-synthetic leg |

---

## Organizational (never satisfied by code)

These stay *manual* controls in the compliance monitor; a named owner
attests, with an evidence link and a review date.

- Business Associate Agreements: hosting, database, push vendor.
- Risk analysis, workforce training, sanction policy, approved policies.
- Incident response plan, contingency plan, backup restore **tested**, DR
  drill actually performed.
- Independent penetration test and its remediation record.
- Access reviews on a schedule; workstation and media disposal controls.
