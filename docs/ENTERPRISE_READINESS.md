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
existing tenant behaves until a developer turns it on for that tenant:
`enterprise.sso` (E2.1), `enterprise.scim` (E2.2),
`enterprise.sessionPolicy` (E2.3) and `enterprise.auditExport` (E2.4).

### What an operator must do (not optional)

- **`INTEGRATION_KEY`** must be set for E2.1: it encrypts the hospital's SSO
  client secret exactly as it encrypts its Amion / Epic credentials. Without
  it a director cannot save an SSO connection at all — the route refuses
  rather than storing a secret in plaintext, and says so.
- **`PUBLIC_BASE_URL`** should be set where DocTurn must hand an ABSOLUTE url
  to somebody else and cannot trust the `Host` header: the SSO redirect URI a
  hospital registers with its identity provider
  (`<base>/api/auth/sso/callback`) and the SCIM base URL a director is shown
  (`<base>/scim/v2`). Unset, both are derived from the request — right behind
  an ordinary reverse proxy, wrong behind one that rewrites the host.
- **`SSO_ALLOW_INSECURE_ISSUER` must stay unset** on anything handling real
  patient data. It exists so a local TEST identity provider on
  `http://127.0.0.1` can be used; it is ignored when `NODE_ENV=production`,
  warned about on the boot log and shown on the director's card.
- Nothing here needs a migration step: every table and column is created by
  the idempotent DDL in `server/db.ts` on boot (`sso_connections`,
  `scim_tokens`, `org_session_policy`, `user_sessions`,
  `users.sessions_revoked_at`), and all of them are cascaded in the
  tenant-delete transaction (and the user delete, where user-keyed).

### E2.1 OIDC single sign-on (module `enterprise.sso`)

**Why it matters to a reviewer.** A hospital's security team wants one place
where accounts are authenticated and one place where they are switched off.
Generic OIDC covers Okta, Entra ID and Google without a per-vendor
integration; SAML is a follow-up (noted under the gaps).

| What | Where | Behaviour |
|---|---|---|
| **The connection** | `sso_connections` (one row per org), `server/sso/connection.ts` | Issuer, client id, scopes, the group claim and its role mapping, a default role, an optional `acr` value, "SSO required" and an enabled flag. The **client secret** is one AES-256-GCM ciphertext under `INTEGRATION_KEY` sealed by the SAME code as every other hospital credential (AAD bound to the org, so a row copied into another tenant cannot be decrypted); no route ever returns it, nothing logs it, and with no key configured saving is REFUSED rather than stored in plaintext. |
| **SSRF** | `publicHttpsUrlProblem` at save, `guardedFetch` at call | The issuer is a director-controlled URL DocTurn fetches, so it faces the same control as Amion / Epic: https only, no credentials in the URL, no query or fragment, no private / loopback / link-local / metadata / non-global address — refused when saved, and the transport re-checks the resolved address on every redirect hop and at connect time under one 10 s deadline. |
| **The flow** | `server/sso/oidc.ts`, `server/routes/sso.ts` | Discovery at `<issuer>/.well-known/openid-configuration` (cached 10 min, and the document's own `issuer` must equal the configured one, so a URL that merely HOSTS a configuration cannot redirect the flow); authorization code with **PKCE S256**, `state` and `nonce`; `client_secret_post` + `code_verifier` at the token endpoint; **RS256 id_token verification against the JWKS** — `alg` must be RS256 (`none` and HS256 refused), the `kid` must be in the live key set (one refetch on a miss, so a rotation needs no restart), and `iss`, `aud`, `exp`, `iat` and `nonce` are all checked. No implicit flow and no unsigned userinfo: every claim DocTurn acts on comes from the verified id_token. |
| **JIT accounts** | `server/services/provisioning.ts` (shared with SCIM) | A first sign-in creates the account through the same path SCIM uses: no password (a random 32-byte scrypt hash nobody holds), a rotation profile for a hospitalist, audited. A later sign-in updates the display name and the ROLE from the current claims (a demotion as well as a promotion), and a `developer` is never re-roled by an identity provider. A deactivated account is refused (audited high) — SSO can never resurrect a leaver. |
| **Role mapping** | `roleFromClaims` | claim value → role, matched case-insensitively, the mapping's declared order deciding for someone in several groups, with a default role (or null = refuse, which is how a hospital keeps DocTurn to a named group). `developer` can never be granted: the save is refused with the group named, not silently dropped. |
| **Session creation** | `req.login` | The existing login path: the session id is REGENERATED (so a fixation attempt before the flow is worthless), the flow's state / nonce / verifier are read from the session BEFORE that and cleared, and a replay of the same `state` is refused. `/api/auth/sso/*` is in the app-lock passthrough and the session-policy sign-in paths, so a locked or ended session can re-authenticate through the IdP. |
| **"SSO required"** | `passwordSignInRefused`, `POST /api/login` | A password then signs NOBODY in for that org — checked AFTER the credential verifies, so a wrong password reveals nothing about which orgs require SSO, and audited (`auth.login_denied_sso_required`). The operator's way in is the impersonation / managed-org PORTAL, not a password: their own account lives in the platform org, which is never SSO-required. Entering an SSO-required tenant through either portal files `auth.sso_break_glass` in THAT tenant's trail at HIGH risk (`server/routes/dev.ts`), on top of the usual `dev.impersonate` row. A developer account that lives inside the tenant itself is held to the same password refusal, and that case is audited as the break-glass too. |
| **Not an org-code oracle** | `POST /api/auth/sso/available` | An unknown org code, a known org with no connection, a disabled connection and a module that is off all get the byte-identical `{ sso: false }` — and the same work is done in every case (the connection is looked up against an impossible org id when the code is unknown), so the timings match. A malformed body gets the same answer rather than a 400. `no-store`. The sign-in screen therefore shows "Sign in with <hospital>" only for a code that really has SSO, without becoming a way to enumerate hospitals. |
| **The card** | Settings → Security → Single sign-on (director) | The redirect URI to register, the issuer / client id / secret (write-only), scopes, the claim and its mappings, the default role, "SSO required", enabled — and a **real** "Test connection" that fetches the issuer's discovery document and key set and reports what came back (it never sends the secret: the token endpoint is not called). |
| **Rate limit** | `app.use("/api/auth/sso", authLimiter)` | The same per-address failure budget as a password sign-in. |

**The MFA decision (asked for explicitly, so it is stated plainly).**

1. An SSO sign-in does **not** also ask for DocTurn's own TOTP. The identity
   provider is the authenticator; a second factor DocTurn holds adds nothing
   to a federated login it cannot verify, and would strand a hospital that
   requires SSO.
2. When the org has `security.mfaRequired` on, a **privileged** SSO sign-in
   (director / ER director / developer) is **REFUSED** unless the id_token
   proves the provider performed multi-factor authentication — `amr` contains
   one of `mfa, otp, hwk, swk, sc, pop, fido, wia, mca`, or `acr` equals the
   value the director configured. The refusal is audited
   (`sso.login_denied_mfa_required`, high) and the sign-in screen says what to
   ask the administrator for. An unprivileged clinician is unaffected.
   *Why refuse rather than fall back on the TOTP-enrolment gate: that gate
   only asks "is this person enrolled?", so an ALREADY-ENROLLED director would
   have walked in on one federated factor while their password sign-in was
   still held to TOTP — the module would have protected the unenrolled and
   nobody else.*
3. That same proof stands the enrolment gate down for the session
   (`session.mfaSatisfiedByIdp`, honoured by the gate and by `GET /api/user`),
   so a hospital whose provider does MFA is not also forced to enrol everyone
   in DocTurn's TOTP. It is recorded in the `sso.login` audit row
   (`idpMfa: true`). DocTurn never writes `twoFactorEnabled` on a user from a
   claim, and it takes the hospital's word for nothing beyond what the token
   asserts.

### How it is tested

| Test | What it proves | Result |
|---|---|---|
| `tests/sso.test.ts` with `tests/fixtures/oidc-issuer.ts` | A **local OIDC issuer** whose RS256 key is generated at runtime (no key material is committed) serves discovery, a JWKS and a token endpoint, and can break the signature, change the `kid`, rotate the key, lie about its issuer, or fail the exchange. Proven: the authorize URL's `response_type`/PKCE S256/state/nonce/scope/redirect_uri; the exchange carrying the code, the verifier and the secret; a real session afterwards; JIT creation with no password and a rotation profile; role mapping, promotion AND demotion; refusal with no default role; a deactivated account refused; nine id_token refusals (wrong nonce, broken signature, a key outside the JWKS, an unknown kid, `alg: none`, HS256, wrong audience, expired, wrong issuer); a key rotation followed without a restart; an issuer-mismatched discovery document; a token-endpoint error; a replayed state; the IdP's own `error=`; "SSO required" refusing staff passwords but not the developer's (audited); the `amr` MFA rule standing the enrolment gate down; the module switch closing every route; the card's refusals (http / private / localhost / query / not-a-url issuers and a `developer` mapping) and that no response, row or audit row ever carries the secret; the real "Test connection" and its failure; director-only access; and the lab hatch (`SSO_ALLOW_INSECURE_ISSUER`) being refused under `NODE_ENV=production` and relaxing nothing but an `http://127.0.0.1` issuer. | 28/28 (failed first: `/api/auth/sso` and the card did not exist) |
| `tests/client-sso.test.ts` | The real client in jsdom: the sign-in screen asks the server once per typed org code and shows the button only when the SERVER says there is SSO; `start` sends the person to the IdP's URL and nothing else; `sso_required` on a password sign-in says to use the hospital's sign-in instead of "wrong password"; the director's card sends one request per change and never keeps the secret. | 12/12 (all 12 fail against HEAD's client) |
| `scripts/sso-check.mjs` | Real Chromium, iPhone 375 / 390 / 430, against a local issuer fixture: the button appears only for a code with SSO (and NOT for an unknown code or a code whose module is off); the whole redirect round trip signs a brand-new person in; "SSO required" makes the password form refuse with the hospital's own sentence; the lock screen offers the IdP; the card's Test connection; ≥44px targets, no overflow, zero CSP violations. | 32/32 |

### Honest gaps

- **SAML is not implemented.** Okta, Entra ID and Google all speak OIDC, and
  a hospital that can only do SAML needs a bridge today. It is the obvious
  next step; the connection table and the card would hold it.
- **No single logout.** Signing out of DocTurn does not sign the person out of
  the identity provider (the discovery document's `end_session_endpoint` is
  read but not used), and an IdP-side logout does not end a DocTurn session —
  the session policy's idle / absolute windows and "sign out everywhere" are
  the controls that bound it.
- **No `externalId`.** As with SCIM, `userName` (from `preferred_username`,
  else the local part of `email`, else `sub`) is the correlation key, so a
  rename at the IdP creates a second account.
- **Group membership is read at sign-in only.** Someone removed from a group
  keeps their DocTurn role until their next SSO sign-in (SCIM, or a
  director's own action, is the immediate path).
- The authorization request is not signed (no PAR, no JAR) and the token
  endpoint is called with `client_secret_post` rather than `private_key_jwt`.
- **"SSO required" can lock a hospital out of its own settings.** If the
  identity provider breaks while `ssoRequired` is on, the org's own director
  cannot sign in with a password to turn it off — only DocTurn's operator can
  (the developer break-glass, or switching the module off for that org). That
  is the point of the break-glass, and it is audited at HIGH risk every time;
  it is written here so nobody is surprised by it. The probe hit it for real.
- **The lab hatch.** `SSO_ALLOW_INSECURE_ISSUER=1` lets an issuer be
  `http://127.0.0.1…` so a local test identity provider (the browser probe,
  or a hospital's own pilot) can be used. It is off by default, **refused
  outright when `NODE_ENV=production`**, warned about on the boot log, shown
  in `GET /api/org/sso` and on the card, and it relaxes nothing else: any
  other URL still faces the full https / public-address control.

**No new compliance control for SSO or SCIM, deliberately.** Neither is
something the monitor can measure honestly from org state: a hospital that
provisions accounts by hand and signs in with DocTurn passwords and MFA is
not non-compliant, so a control that warned about it would be a false
finding. The controls that DID change are the ones that measure a real
posture: `session-timeout` now reads the org's own window (E2.3), and the
existing `mfa-privileged-roles` control is unaffected because an SSO session's
`amr` evidence is per sign-in, not per org.

### E2.2 SCIM 2.0 Users (module `enterprise.scim`)

**Why it matters to a reviewer.** Workforce joiners/movers/leavers
(§164.308(a)(3)(ii)(B)/(C)) are an access-review finding waiting to happen if
each system is maintained by hand. SCIM lets the hospital's identity provider
own DocTurn accounts: it creates them, renames them, and — the part that
matters — deactivates them the moment HR does, without anyone remembering.

| What | Where | Behaviour |
|---|---|---|
| **Endpoints** | `server/scim/users.ts`, mounted at `/scim/v2` | `GET /Users` (list, `filter=userName eq "x"`, 1-based `startIndex` + `count`), `GET /Users/:id`, `POST /Users`, `PUT /Users/:id`, `PATCH /Users/:id`, `DELETE /Users/:id`, plus `ServiceProviderConfig`, `Schemas`, `Schemas/:urn`, `ResourceTypes`, `ResourceTypes/:id`. Anything else under `/scim` is a SCIM 404 — the SPA fallback in `server/webapp-static.ts` now skips `/scim`, and a catch-all closes the gap, so a connector never gets the web app's HTML. |
| **Auth** | `server/scim/auth.ts`, `scim_tokens` | A per-organization bearer token, `dts_` + 32 random bytes. Only its **SHA-256 is stored**; it is shown once, at creation; a revoked token keeps its row (`revoked_at`) for the trail; `last_used_at` is touched at most once a minute so a director can see whether the connector is alive. The token names the ORG — nothing in a request can change which tenant it acts in. Unknown and revoked get the same generic 401 with a `WWW-Authenticate` challenge. Five live tokens per org. |
| **The module is enforced here** | same | `/scim` is outside `/api`, where the central gate never runs, so the bearer middleware checks `enterprise.scim` itself and answers **404** (the module's own promise) rather than 401 — a misconfigured connector is not reported to the IdP as a credential problem. The GATE_TABLE row covers the token-management API (`/api/org/scim-tokens`). |
| **Content type** | `server/app.ts` `scimJson` | Okta and Entra send `application/scim+json`, which the global `express.json()` does **not** parse; the SCIM writes mount their own parser accepting both types, and every SCIM response is `application/scim+json`. |
| **Writes go through the app's own paths** | `server/services/provisioning.ts` | `provisionUser` creates the account with a **random 32-byte scrypt hash nobody holds** (no password: sign-in is the IdP's job; `must_change_password` is deliberately NOT set, which would lock an SSO user out of every route) and gives a hospitalist a rotation profile, exactly as approving a registration does. `active:false` and `DELETE` call `deactivateAccount` — the same function `POST /api/accounts/:id/deactivate` uses: `disabled_at`, off the rotation at once, and every live session, socket and demo token ended now. `active:true` is the same reactivate path. |
| **No hard delete** | `DELETE` → deactivate (204) | §164.316(b)(2)(i) wants the account's trail attributable, and the audit rows are FK-bound to the user. RFC 7644 §3.6 permits "MAY ... disable"; `ServiceProviderConfig` and these docs say so. |
| **What a connector may touch** | `SCIM_ASSIGNABLE_ROLES` | `hospitalist` and `er_doctor` only. A director / ER director / developer is **invisible** to SCIM (404 on read, refused on write), so a compromised connector token cannot create or promote itself to a privileged account. |
| **Attributes** | `server/scim/schemas.ts` | `userName`, `name.*`, `displayName`, `active`, `roles[0].value`. `emails`, `title`, `department` and the rest are accepted and dropped, and the `Schemas` endpoint advertises **only** what is stored, so nothing is promised that is discarded. PATCH reads both providers' dialects: Okta's `{op:"replace", value:{active:false}}` with no `path`, and Entra's `{op:"Replace", path:"active", value:"False"}` (capitalised op, string boolean). An unsupported filter is `400 invalidFilter` rather than a silent "everything", so an IdP that de-duplicates on a filter cannot create duplicates. |
| **Rate limit** | `SCIM_RATE_LIMIT` (120/min/address) | `/scim` is outside `/api`, so the general limiter never sees it. |
| **The card** | Settings → Security → SCIM provisioning (director) | The base URL to point the IdP at, the tokens (label, created, last used, revoked), create and revoke. A new token is rendered from the create response only: the client never puts it in the store or in `localStorage` (a test and the probe both assert that). |

**Honest gap: `externalId`.** DocTurn has nowhere to store it, so it is
accepted, echoed inside the request that sent it, and never persisted;
`userName` is the correlation key. An IdP that renames a user's `userName`
therefore creates a second account unless it correlates on `userName` — which
Okta and Entra do by default. A column for `externalId` is the fix; not built.

### How it is tested

| Test | What it proves | Result |
|---|---|---|
| `tests/scim.test.ts` | The filter parser; a token created once, hashed, listed without the secret, touched on use and revocable (with its audit rows); director-only token management; the label and the five-token cap; the module owning both halves (404 for the endpoints and for the card); one generic 401 with a challenge; the discovery endpoints advertising only what is stored; an unknown SCIM path never serving HTML; create (no password, a rotation profile, audited, the token named but not its label); privileged-role / missing-userName / duplicate refusals; list + filter + 1-based paging never showing another tenant or a privileged account; Okta's and Entra's PATCH dialects; name and role PATCHes; PUT with a 409 on someone else's name; DELETE as an idempotent deactivation; a SCIM deactivation ending a live session; and 429 from `SCIM_RATE_LIMIT`. | 19/19 (failed first: `/scim` did not exist) |
| `tests/client-scim.test.ts` | The real client in jsdom: nothing sent while the module is off; the created token is handed back to the caller and is in **no** store, **no** `localStorage` and **no** toast; revoke re-reads the list; every refusal says why and changes nothing. | 4/4 (all 4 fail against HEAD's client via `CLIENT_SRC_ROOT`) |
| `scripts/scim-check.mjs` | Real Chromium, iPhone 375 / 390 / 430, with the SCIM API driven as an identity provider would: the card mints a token shown once that is in no store or storage; the full connector flow (ServiceProviderConfig, list, create, filter, PATCH, duplicate 409, no guessable password) against that token; the People screen listing the provisioned person; a SCIM `active:false` signing their OPEN app out; DELETE as a deactivation; revoking from the screen refusing the token; with the module off a SCIM 404 (never HTML) and no card. With `REAL_BASE_URL` (`SYNTHETIC_DATA=false`): a fresh tenant has it off, a token provisions into that tenant only, and a director is invisible to the connector. | 43/43 (including the non-synthetic leg) |

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
