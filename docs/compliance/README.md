# DocTurn — security & compliance review (HIPAA Security Rule / SOC 2)

Reviewed: server (`server/`, `shared/`), the three clients (`webapp/`, `client/`,
`mobile-app/`), deployment config and dependencies.

This is a **technical** review of the code in this repository. It is not a HIPAA
or SOC 2 attestation: most of what an auditor (or Vanta) checks is organisational
— policies, risk analysis, BAAs, training, access reviews, backups, vendor
management — and none of that lives in a repo. Section 4 lists those so they are
not mistaken for done.

## 1. How to run the check

```bash
npm run compliance   # control tests + hardening tests + dependency audit
npm test             # everything
```

`tests/compliance.test.ts` asserts each technical control against the running
app and tags it with its HIPAA citation and SOC 2 criterion. Known open gaps are
`it.todo(...)` entries, so they print on every run. `tests/hardening.test.ts`
holds the regression tests for the defects fixed in this review.

`npm run compliance` currently **fails at the dependency-audit step** because of
one open high-severity advisory (zod, see 3.3). That is intentional — the check
should stay red until it is resolved or formally accepted.

## 2. Control matrix

Status: **Pass** = enforced in code and covered by a test · **Gap** = not met ·
**Partial** = met with a stated limit.

| Control | HIPAA | SOC 2 | Status | Evidence / note |
|---|---|---|---|---|
| Every API route requires a session (except a fixed public list) | §164.312(a)(1), (d) | CC6.1 | Pass | compliance: "every non-public API route rejects…" (enumerates all ~95 routes) |
| Tenant isolation on every read/write | §164.308(a)(4) | CC6.1, C1.1 | Pass | compliance: "Tenant isolation" suite; storage methods all take `organizationId` |
| Role-based least privilege; platform operators cannot read the PHI board | §164.308(a)(3), §164.502(b) | CC6.3 | Pass | compliance: "Least privilege" suite |
| Unique user identification | §164.312(a)(2)(i) | CC6.1 | Pass | per-org unique usernames; no shared sessions server-side |
| Passwords hashed (scrypt, per-hash salt), never returned | §164.312(d) | CC6.1 | Pass | compliance: "stores passwords only as salted scrypt hashes…" |
| Password strength | §164.308(a)(5)(ii)(D) | CC6.1 | **Gap** | minimum is 6 characters; no complexity / breach check |
| Password change / reset | §164.308(a)(5)(ii)(D) | CC6.1 | **Gap** | no route exists |
| Account lockout | §164.308(a)(5)(ii)(C) | CC6.1 | Pass | 5 failures → 15 min lock, audited (new) |
| Login rate limiting | — | CC6.6 | Partial | 50 / 15 min per IP; **disabled in `render.yaml`** |
| MFA available (TOTP, backup codes, SMS OTP) | §164.312(d) | CC6.1 | Partial | optional for all roles, incl. director / developer |
| MFA brute-force protection | §164.312(d) | CC6.1 | Pass | 5 wrong codes discards the pending login (new) |
| Automatic logoff (HTTP) | §164.312(a)(2)(iii) | CC6.1 | Pass | 15-minute rolling idle expiry |
| Automatic logoff (WebSocket) | §164.312(a)(2)(iii) | CC6.1 | Pass | sockets close on logout / session expiry (new) |
| Automatic logoff (web client) | §164.312(a)(2)(iii) | CC6.1 | **Gap** | client silently re-logs in on 401; lock screen is cosmetic (5.1) |
| Session cookie HttpOnly / SameSite / Secure-in-prod | §164.312(e)(1) | CC6.7 | Pass | compliance: "Session management" suite |
| Durable, shared session store | — | A1.2 | **Gap** | `MemoryStore`; `connect-pg-simple` is installed but unused |
| PHI access logging | §164.312(b) | CC7.2 | Pass | patients, assignments, board, consults, messages, intake extraction (last three new) |
| Security-event audit trail | §164.308(a)(1)(ii)(D) | CC7.2 | Pass | login, failed login, logout, lockout, MFA, privileged changes |
| Audit attribution under impersonation | §164.312(b) | CC7.2 | Pass | rows carry `impersonatedBy` / "(impersonated by user #n)" (new) |
| Audit log retention (6 years) | §164.316(b)(2) | CC7.2 | **Gap** | deleting an organization deletes its audit and PHI-access logs |
| Audit log integrity | §164.312(c)(1) | CC7.2 | **Gap** | plain rows; no append-only store or hash chain; no API mutates them |
| Encryption in transit | §164.312(e)(1) | CC6.7 | Partial | HSTS + Secure cookie; TLS itself is the host's job; mobile app defaults to `http://` |
| Encryption at rest | §164.312(a)(2)(iv) | CC6.1 | **Gap** (app layer) | TOTP secrets and message bodies stored in clear; relies on database-level encryption |
| No PHI in push / SMS | §164.312(e)(1) | C1.1 | Pass | notifications tests |
| Security headers | — | CC6.6 | Partial | Helmet defaults on; **CSP disabled** |
| Generic error responses | — | CC7.2 | Pass | compliance: "returns a generic error body…" |
| Input validation | — | CC6.6 | Partial | zod on most bodies; id params validated (new); a few dev/resource routes still hand-validated |
| Default credentials not shipped to production | §164.308(a)(5) | CC6.1 | Partial | real Postgres is no longer auto-seeded (new); the public demo still uses a published password by design |
| Secrets management | §164.308(a)(4) | CC6.1 | Pass | env only, none in repo; production refuses to boot without `SESSION_SECRET` on a real DB (new) |
| Dependency vulnerabilities | §164.308(a)(1)(ii)(B) | CC7.1 | **Gap** | 1 high (zod), 2 moderate (qs) remain — see 3.3 |
| Minimum-necessary data to AI vendor | §164.502(b), §164.308(b) | CC9.2 | **Gap** | with `OPENAI_API_KEY` set, the free-text intake note (PHI) is sent to OpenAI — requires a BAA + zero-retention, or de-identification |
| Data retention / disposal | §164.310(d)(2)(i) | C1.2 | Partial | patients auto-purge after 24 h (per-org setting); confirm this matches your retention policy |

## 3. What this review changed

### 3.1 Bugs fixed

| # | Defect | Effect before the fix |
|---|---|---|
| 1 | Async route errors were never sent to the error handler | Any DB error or bad id left the request hanging until the client timed out |
| 2 | Non-numeric path ids reached SQL as `NaN` | `/api/beds/abc` etc. hung (now 404) |
| 3 | "First accept wins" was read-then-write | Attending and on-call member accepting together both succeeded; census counted wrong |
| 4 | Expiry sweep could overwrite an assignment accepted a moment earlier | Accepted patient shown as expired and re-routed to a second provider |
| 5 | A patient could have several live assignments | Two attendings paged and both able to accept |
| 6 | Reassign to an unknown provider released the current one first | Patient left with a cancelled assignment and nobody responsible |
| 7 | Cancel worked on already-resolved assignments | History rewritten (rejected → cancelled) |
| 8 | Accepting never stopped the escalation clock | SMS "new assignment" sent to providers who had already accepted (push+SMS mode) |
| 9 | Re-running MFA enrolment replaced an active secret | Account left 2FA-on with no working authenticator |
| 10 | `{"olderThanHours": null}` on purge meant "delete everything" | Malformed request wiped all patients |
| 11 | Twilio / OpenAI HTTP errors were treated as success | Failed SMS reported as sent; failed extraction returned "XX" instead of the local fallback |
| 12 | Re-registered device token kept the previous organization | Push token attached to the wrong tenant |
| 13 | Deleting a provider with history, duplicate org codes, duplicate usernames on approval | Hung / 500 (now 409) |
| 14 | Malformed JSON body returned 500 | Now 400 |
| 15 | Org-setting edits were cached for 5 s | Now invalidated immediately |

### 3.2 Security hardening

- Account lockout, failed-login / logout auditing, constant-work login for unknown users.
- MFA attempt cap; `mfa.failed` rows now land in the user's org trail (were org-less).
- Developer impersonation is now attributed on every audit and PHI-access row.
- WebSocket: typing relay can no longer address users in another tenant; sockets
  close on logout, session expiry and impersonation swap.
- ER directors can no longer approve director / ER-director registrations.
- Consultants named on a consult must belong to the caller's organization.
- `/api/settings/org` accepts only the keys the server reads.
- Demo bearer-token auth is not mounted in production (HTTP or WebSocket).
- Real Postgres is never auto-seeded with the demo accounts (`SEED_DEMO=true` opts in).
- Developer-created accounts get a CSPRNG temporary secret (was `Math.random`).
- `drizzle-orm` upgraded 0.36 → 0.45 (high-severity advisory); `npm audit fix` applied.

### 3.3 Dependencies still open

| Package | Severity | Why it is still open |
|---|---|---|
| zod 3.x | high (memory exhaustion on oversized collections) | fix is zod 4, a breaking change that also needs `drizzle-zod` replaced. Request bodies are capped at 1 MB, which limits exposure. |
| qs (via express 4) | moderate | pinned by express 4; cleared by moving to express 5. |

## 4. Not code — needed for an actual HIPAA / SOC 2 audit

Risk analysis (§164.308(a)(1)(ii)(A)) · written policies and sanctions · workforce
training · named security officer · BAAs with every vendor that touches PHI
(host, database, Twilio, Firebase, OpenAI, logging) · backup and tested restore ·
disaster-recovery and incident-response plans · breach-notification procedure ·
periodic access reviews · change management and code-review evidence · CI running
these checks on every change (there is no CI config in the repo) · centralised log
retention and alerting · penetration test · vendor inventory.

## 5. Open findings (not fixed here)

### 5.1 The served web client is demo-grade — blocker for real PHI

These change how the demo behaves, so they need a product decision rather than a
silent fix. The first four were confirmed by reading the code.

1. **PHI in `localStorage`, kept after logout** — `webapp/store.js` persists the
   whole store (board, messages, audit trail); logout only clears `session`.
2. **The login form ignores the typed password** — `webapp/LoginScreen.jsx` /
   `api-bridge.js` always sign in as the seed account for the chosen role tile
   with the shared password. Anyone who can load the page can pick "developer".
3. **401 self-heal defeats auto-logoff** — `api-bridge.js` silently re-logs in
   with the demo password whenever the server returns 401.
4. **Idle lock screen is cosmetic** — any four digits (or the Face ID button)
   unlocks; a reload removes it; the server session is untouched.
5. **Accounts are provisioned with the shared password** — add-provider and
   schedule import send `"docturn"` for every new account.
6. Reported by the client review, not individually re-verified: emergency
   broadcasts and the on-shift toggle never reach the server from `webapp/`;
   consults ticked at ER intake are dropped; accept / decline show success when
   the server refuses; after a page reload the WebSocket is not reconnected;
   WebSocket event names differ from what the server emits (`BROADCAST_SENT` vs
   `BROADCAST_CREATED`); the mobile app treats a 202 "MFA required" as signed in
   and defaults to plain `http://`.

### 5.2 Server

- Sessions in memory; audit logs deleted with their organization; no audit
  integrity protection; CSP off; passwords ≥ 6 only; no password change; MFA
  optional; TOTP secrets and messages unencrypted at the app layer (all listed
  in the matrix).
- `PATCH /api/consults/:id` lets any signed-in user in the org accept or decline
  on a consultant's behalf.
- Manual assignment can target a provider who is off shift.
- Multi-step writes (accept, reassign, organization delete) are not wrapped in a
  database transaction; a crash mid-way can leave census and status out of step.
- `render.yaml` deploys with `RATE_LIMIT=off`, the published demo password, and
  tracks a different branch (`claude/sleepy-davinci-kmin7n`).
- All seeded demo accounts share one password hash and salt (seed data only).
- Directors can send free-text SMS to any number; nothing stops PHI in the body.
