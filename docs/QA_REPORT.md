# QA Report — full-app endpoint × role matrix, workflows, security

Date: 2026-07-02 · Branch: `claude/sleepy-davinci-kmin7n` · Server: `npm run dev` (PGlite, `RATE_LIMIT=off`)
Method: curl with per-user cookie jars (ISPN: director/chen/er.doc/er.director · DOCTURN: dev · HOSP: director · ER: director/er.doc1), plus the headless UI smoke (`npm run test:ui`).

## 1. Endpoint × role matrix — summary

~60 route handlers across `server/routes/*.ts` + `server/auth.ts` exercised.

| Category | Result |
|---|---|
| Anonymous → 401 on every protected route (33 GET routes probed + all mutations) | PASS |
| Public routes (`/api/health`, `/api/config`, `/api/mobile/org/:code`, `/api/register`) reachable without session | PASS |
| Role gates (`requireRole`) on all director/er_director/developer-only routes → 403 for lower roles | PASS (see spot list below) |
| Cross-org (HOSP director probing real ISPN patient/assignment/conversation/hospitalist/broadcast IDs) → 404, never data | PASS |
| Org lists (`/api/patients`, `/api/assignments`, `/api/registrations`) never contain another org's rows | PASS |
| Developer-only console (`/api/dev/*`) → 403 for all four clinical roles | PASS |
| `/api/patient-board` denies developer (platform operators don't read tenant PHI) | PASS (by design) |

Forbidden-role spot checks (all returned the expected code): hospitalist POST patients/assignments/broadcast/sms/purge/dept-create/bulk-working/feature-flags → 403; er_doctor accept → 403; hospitalist cancel → 403; er roles PATCH org config → 403; hospitalist toggling another provider's working-status → 403 but self → 200; non-participant reading/sending in a conversation → 403; recipient deleting the sender's message → 403.

## 2. Workflow tests (all PASS)

- **ER → round-robin → accept**: er.doc created patient, `mode:round_robin` selected lowest-census provider (chen, census 0); chen saw it in `/api/assignments/pending`, accepted; census 0→1, patient `assigned`.
- **Reject → auto-reroute**: with `autoReassignOnDecline=true` (set via `PATCH /api/settings/org`, reflected in `GET /api/settings`), chen's reject produced exactly one new pending assignment for a different provider (h11), chen's census unchanged. Default (flag off) leaves the patient `waiting` — matches documented behavior + unit tests.
- **Director**: reassign pending → old marked `expired`, new pending for named provider; cancel of accepted → census 1→0, patient back to `waiting`; working-status toggle + bulk (`{all}`); capacity PATCH; census override (audited, clamped); rotation reset; `PATCH /api/org/config` (timeout) persists; purge (`olderThanHours:0`) removed all org patients.
- **Broadcast**: director create → chen ack (204) → `GET /api/broadcasts/:id` lists the ack. Verified WS `BROADCAST_CREATED` frame is delivered to a second signed-in user.
- **Messaging**: chen↔er.doc direct conversation; send creates delivery rows (recipient `unreadCount:1`); mark-read → 0; non-participant read/send → 403; sender soft-delete → 204 and the message disappears from the list; deleting someone else's message → 403.
- **Feature flags**: `PATCH {enabled:true}` → GET shows true; `PATCH {enabled:false}` → GET shows false (the earlier upsert fix landed — `feature_flags_org_flag_uniq` + `onConflictDoUpdate`); variant round-trips.
- **Registration**: `POST /api/register` (no session) → director sees pending → approve → new user logs in with the registered password; hospitalist registrations get a rotation profile; `requestedRole:"developer"` rejected 400 at the schema; HOSP director cannot see or approve an ISPN registration (empty list / 404).
- **Developer**: org list with user counts; org create/patch/delete (empty → 204; non-empty w/o force → 409 `org_not_empty`; own org → 409 `cannot_delete_own_org`); per-org settings GET/PATCH; compliance overview per org; org audit trail; `dev/users` create (dup → clean 409) / delete; ai-diagnostics (Mock extractor); impersonate → session swaps to target and `dev.impersonate` appears in that org's audit; manage-org → session swaps to the tenant's director. Note: impersonate/manage-org regenerate the session (passport), which is the intended "swap" semantics.
- **MFA**: enroll → TOTP verify → 10 backup codes; next login returns 202 `twoFactorRequired`; wrong code 401; correct TOTP completes login. Password change: wrong current → 403, short → 400 `weak_password`, good → works on next login.
- **Misc**: consults (fan-out, dedupe, accept, cross-org 404), care-team (add/toggle/delete, self-link 409, `of/:userId` director-only), resources (dept/bed/equipment CRUD + validation + metrics), mobile (public org lookup safe-fields, compact assignments, device tokens), `patients/extract`, CMS (read any role / write developer-only / bad key 404), `settings/me`, SMS send+history (stub carrier, audited).

`npm test`: **57/57 pass** (includes 1 new regression test). `npm run test:ui`: **99/99 pass**. `NODE_ENV=production npm run build`: **exit 0**.

## 3. Bugs found

### Fixed
1. **`GET /api/registrations` leaked scrypt `passwordHash` for every pending registration** to directors/ER directors (any org). Response now strips the hash. `server/auth.ts:131-137`. Regression test added: `tests/auth.test.ts` ("never exposes passwordHash in the registration approval queue").
2. **api-bridge listened for WS event names the server never emits** (`PATIENT_BOARD_UPDATED`, `BROADCAST_SENT`) and ignored real ones — consult and care-team changes (`CONSULT_UPDATED`, `CARE_TEAM_UPDATED`) did not live-refresh other clients, and incoming broadcasts were never surfaced. Fixed the handler and added a `BROADCAST_CREATED` handler (toast + prepend to the broadcasts list for recipients). `webapp/api-bridge.js:422-441`.
3. **Emergency broadcasts were local-only** — `Broadcasts.jsx → DT.actions.sendBroadcast` never called the backend, so `POST /api/broadcasts` was dead UI (a director's "emergency" reached nobody). Bridge now persists via `POST /api/broadcasts` (severity mapped: kit `warning→urgent`, `emergency→critical`) and keeps the kit's optimistic local copy; failures toast. `webapp/api-bridge.js` (sendBroadcast override, after `resetRotation`).

### Deferred (structural — documented, not fixed)
1. **No `GET /api/broadcasts` list endpoint** — clients can't hydrate broadcast history or live ack counts (`GET /api/broadcasts/:id` is per-id, sender-roles only). The kit's ack progress numbers therefore stay demo-shaped. Suggest `GET /api/broadcasts?limit=` (org-scoped) + wiring `ackBroadcast` into the recipient UI.
2. **Ack requirement/audience are UI-only** — `createBroadcastSchema` has no `ackRequired`/`audience`; the composer's "Require acknowledgement" and role-targeting checkboxes have no backend effect (fan-out is whole-org).
3. **`PATCH /api/consults/:id` has no participant/role guard** — any authenticated org member can accept/decline any consult in their org (org-scoped, but not consultant-scoped). Low risk, worth a guard (consultantUserId === me, or the patient's attending/director).
4. **`GET /api/assignments/pending`, `/my` allow `director` role but return `[]` unless the director has a hospitalist profile** — correct but slightly confusing; harmless.
5. **Shared on-disk PGlite store (`./.pglite`) is not multi-process safe.** Every server process launched from the repo root opens the same data dir; two concurrent servers (or `tsx watch` restarting into a still-running sibling) corrupt it — observed repeatedly during this pass as `invalid_credentials` for all seed accounts, EADDRINUSE loops, and the auto-recovery (`initDbWithRecovery`) wiping the dir while another process held it. Workaround verified: give each server its own `PGLITE_DIR` (all suites are green on an isolated dir). Consider a lock file / per-port default dir.
6. **Bridge self-heal auto-login** (`api()` retries 401s by logging in as the role's demo account with the shared demo password) is demo-only convenience but would be a credential-stuffing footgun if it ever shipped to production — gate it on the synthetic-data flag.

## 4. Security findings

- **passwordHash exposure**: only leak found was `GET /api/registrations` (fixed, see above). Grepped every captured response body; `/api/users`, `/api/dev/users`, login, impersonate, manage-org, approve all sanitize via `toSafeUser`/field-mapping.
- **Session cookie**: `HttpOnly; SameSite=Lax; Path=/`, 15-min rolling expiry, `Secure` set when `NODE_ENV=production` (`server/app.ts`). Helmet headers present (HSTS, nosniff, frame SAMEORIGIN). OK.
- **Privilege escalation guards hold**: director creating `role:"developer"` via `/api/director/hospitalists` → 403 (server-side, before validation); er_director may create only `er_doctor` (hospitalist/director attempts → 403); self-registration as developer impossible (schema); dev-user minting is developer-route-only.
- **Tenant isolation**: 404 (not 403) on cross-org IDs — existence not revealed. Verified on patients, assignments (get/accept/reject/reassign/cancel), conversations/messages, hospitalists (capacity/working/census/delete), broadcasts, consults, registrations.
- **Audit**: PHI reads log to `phi_access` (verified via `/api/audit` counts); high-risk ops (impersonate, manage-org, org delete, user delete) write audit rows before/with the action.
- Rate limiting on by default (tiered, `RATE_LIMIT=off` escape hatch); MFA TOTP + hashed backup codes; scrypt password hashing with per-user salt and timing-safe compare.

## 5. Prioritized recommendations

1. ~~Strip `passwordHash` from the registration queue~~ — **done** (this pass).
2. Add a `GET /api/broadcasts` list + recipient ack wiring so the broadcast surface is fully real (deferred #1/#2).
3. Guard `PATCH /api/consults/:id` to the named consultant / attending / director (deferred #3).
4. Gate the bridge's demo auto-relogin on `syntheticData` so it can never run against real PHI (deferred #6).
5. Make the dev PGlite store multi-process safe (per-port `PGLITE_DIR` default or a lock) — concurrent servers corrupted the shared `./.pglite` repeatedly during this pass, which surfaces as "all logins fail" (deferred #5).
6. Add supertest coverage for tenant isolation on messaging + broadcasts (currently covered for assignments only) — today's guarantees are right but untested.

## 6. Files changed in this pass

- `server/auth.ts` — strip `passwordHash` from `GET /api/registrations`.
- `webapp/api-bridge.js` — WS event-name fixes (+ live broadcast receive), `sendBroadcast` wired to `POST /api/broadcasts`.
- `tests/auth.test.ts` — regression test for the registration-queue hash leak.
- `docs/QA_REPORT.md` — this report.
