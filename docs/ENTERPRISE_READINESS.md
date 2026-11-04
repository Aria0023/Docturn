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
| E2 Identity: OIDC SSO, SCIM, session policy, audit export | `enterprise.sso`, `enterprise.scim`, `enterprise.sessionPolicy`, `enterprise.auditExport` | tables and module ids in place (skeleton); feature sections are added with their code |
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

## Personal display presets (in code and tested)

Module `platform.userThemes` (default **on**). The ORGANIZATION keeps its
branding — workspace name, accent, corner radius, sidebar style, content width
and its colour scheme (`classic | calm | warm`), all written by its directors
through `PATCH /api/org/preferences` and gated by `platform.appearance`. On top
of that each PERSON picks their own:

| Preset | What it changes |
| --- | --- |
| `org` (default) | Nothing — follows whatever the organization chose. |
| `classic` / `calm` / `warm` | One of the three light canvases, for this person only, whatever the organization picked. |
| `night` | A true dark canvas: page darkest, cards floating above it, chips recessed below, and all five status families restated as dark tints with light ink. |
| `contrast` | High contrast — black canvas, white ink, visible lines, every text pair at 7:1 or better. |

Plus **text size** (`default | large`) and **follow this device**
(`prefers-color-scheme`, offered only on `org` and `night` — the two presets
that have both a light and a dark reading).

### What the server does

- `GET` / `PUT /api/me/theme` — the caller's own `user_theme_prefs` row.
  Organization and user come from the session, never the body; there is one row
  per user, so there is no id to address and nothing cross-tenant to reach. The
  body is strict and every value comes from a fixed catalogue in
  `shared/schema.ts`; an unknown stored value reads back as the default.
- Audited `theme.prefs_update`, `riskLevel: low`, details = the three chosen
  values. No PHI; the row is removed with the user and with the tenant.
- `GATE_TABLE` gates `/api/me/theme` on `platform.userThemes`: off = 404
  `module_disabled` on both verbs, the stored choice kept for when it returns,
  and the client shows the organization's branding only.
- `GET /manifest.webmanifest?theme=<preset>` answers with that preset's splash
  colours. The preset is named in the URL, not read from the session, because a
  browser fetches the manifest without the page's cookies — so nothing about
  who is signed in is needed, or revealed, to colour a splash screen.

### What the client does

- `webapp/AppShell.jsx` resolves the person's preset against the organization's
  palette and the device, overrides the `-ch` channels in `webapp/tokens.css`
  (which recolours the whole app), and sets `color-scheme`, the `theme-color`
  meta (a hex — the native shell parses it for its status-bar icons, see
  `docs/MOBILE.md`) and the manifest href.
- Accent-derived shades are **computed, not assumed**: the operator's accent is
  lightened until it reads AA on a dark card and canvas, the ink on the fill is
  whichever of near-white/near-black reads better on it, and the accent tints
  are fitted in the opposite direction. `--primary` is a FILL only;
  `--primary-ink` is the accent as TEXT, fitted against the card, the canvas,
  the tint and the tile.
- `large` text zooms `:root` by 1.125 (the kit sizes its type in pixels inline,
  so raising the root font alone changes nothing visible) and publishes
  `--dt-zoom` so viewport-unit heights divide by it.
- The slice is **never** written to browser storage and is cleared on sign-out:
  a shared ward workstation must not come back up wearing the previous
  clinician's theme. The cost is a brief flash of the organization's palette
  while `/api/me/theme` answers, which is the right trade.

### How it is tested

- `tests/user-themes.test.ts` — defaults, store/read-back, audit row, another
  user in the same org unaffected, seven rejected bodies, module off on both
  verbs, 401 signed out, a second tenant with its own switch and rows.
- `tests/live-no-demo-seeds.test.ts` — the slice is cleared on sign-out and
  never reaches browser storage.
- `scripts/contrast-check.mjs` — the whole token pair matrix for 5 presets x
  the 8 accents an organization can pick (2065 pairs), reading `PALETTES` and
  the pure `accentTokens()` out of `AppShell.jsx` so the static check and the
  browser share one implementation of the contrast maths.
- `scripts/theme-check.mjs` — the rendered counterpart: 6 presets x 2 text
  sizes x 375/390/430 on four screens (983 checks), asserting AA for every
  rendered text run against the colour it actually sits on, nothing painted its
  own backdrop, >= 44px targets, >= 16px inputs, no horizontal overflow, zero
  CSP violations and zero page errors — plus that the preset round-trips
  through the server (a reload keeps it, a second browser as the same person
  sees it), that following the device never rewrites the stored choice, and
  that with the module off the section is gone and the server refuses the PUT.

### Honest gaps

- The manifest's `theme_color` for a light preset stays the brand blue: the
  manifest is fetched without a session, so it cannot know the organization's
  accent. The live top inset and status bar DO follow the accent, through the
  `theme-color` meta.
- `large` text is a 1.125 root zoom, not a type-scale rebuild. It is uniform
  and keeps every phone rule, but a person who wants only bigger *text* (not
  bigger everything) is served by the browser's own text zoom.
- Two colour languages stay literal on purpose and are checked as
  self-contained pairs: the ESI triage chips and the consult specialty chips
  (`webapp/components.jsx`). So do the colour pickers themselves, the
  synthetic-data hazard stripe and the impersonation banner.

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
