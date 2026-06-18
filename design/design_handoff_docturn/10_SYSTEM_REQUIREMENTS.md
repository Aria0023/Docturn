# DocTurn — System-Level Requirements (DT-SR-001)

The **acceptance contract**. Each requirement is a single testable *shall* statement with a
priority (MoSCoW), a verification method, and a trace to the use case (`UC-NN`) and function
(`F#`) it satisfies.

- **Priority:** Must = required for production go-live · Should = high value, scheduled · Could = deferrable.
- **Verification:** Test (automated, Vitest/Supertest) · Demo (observed run) · Inspect (code/config review) · Analyze (reasoned argument).
- **Total: 67 requirements.** Every requirement traces to a function (no orphans). 12 system-wide
  constraint requirements legitimately have no use case (marked `—`).

---

## FR — Functional

| ID | The system shall… | Priority | Verify | Trace |
|---|---|---|---|---|
| FR-AUTH-01 | authenticate a user against credentials **scoped to their organization**, rejecting unknown org/username/password with a generic 401. | Must | Test | UC-01 · F1.2 |
| FR-AUTH-02 | require a second factor (TOTP, SMS OTP, or backup code) when `twoFactorEnabled`, gated server-side via `pendingMfa`. | Must | Test | UC-02 · F1.4 |
| FR-AUTH-03 | issue exactly 10 single-use backup codes and reject any reused code. | Should | Test | UC-02 · F1.5 |
| FR-AUTH-04 | support TOTP enrollment with QR provisioning and verify the enrolled secret before activation. | Must | Test | UC-02 · F1.3 |
| FR-REG-01 | place self-registrations into a pending state requiring director approval before the account is active. | Should | Test | UC-03 · F9.3 |
| FR-PROV-01 | allow a director (or er_director for er_doctor) to create provider accounts and profiles within their org only. | Must | Test | UC-16 · F3.1 |
| FR-PROV-02 | let a provider toggle their own working status and a director toggle any provider's, reflecting it in eligibility. | Must | Test | UC-04 · F3.3 |
| FR-PROV-03 | refuse provider deletion with a 409 when pending assignments reference that provider. | Must | Test | UC-16 · F3.5 |
| FR-INT-01 | return deterministic structured intake fields (initials, room, issue, specialty) from a free-text note. | Must | Test | UC-06 · F4.1 |
| FR-INT-02 | use OpenAI for extraction in production and fall back to the mock extractor when AI is unavailable or stubbed. | Should | Demo | UC-06 · F4.2 |
| FR-ASG-01 | select the lowest-census eligible provider, breaking ties by rotation order, strictly within the org. | Must | Test | UC-07 · F5.1 |
| FR-ASG-02 | apply cap relief (raise every working provider's cap) when no provider is eligible, then re-select. | Must | Test | UC-07 · F5.2 |
| FR-ASG-03 | support both round-robin and manual assignment modes, creating one pending row with a computed `expires_at`. | Must | Test | UC-07 · F5.4 |
| FR-ASG-04 | increase a provider's census only on accept and decrease it only on cancel of an accepted assignment. | Must | Test | UC-08 · F5.5 |
| FR-ASG-05 | on reject, resolve the assignment and immediately create exactly one new pending row when a provider is eligible. | Must | Test | UC-08 · F5.6 |
| FR-ASG-06 | expire pending assignments past `expires_at` on a periodic tick and reroute them to the next eligible provider. | Must | Test | UC-09 · F5.7 |
| FR-ASG-07 | keep a patient `waiting` and emit `assignment.unrouted` when no provider is eligible after cap relief. | Must | Test | UC-09 · F5.10 |
| FR-ASG-08 | allow a director to reassign or cancel, and an er_director to reassign, with audit. | Must | Test | UC-10 · F5.8 |
| FR-MSG-01 | deliver a message only to conversation participants and reject non-participant access with 403. | Must | Test | UC-11 · F6.6 |
| FR-MSG-02 | record per-recipient delivered/read state and update the sender's receipts on mark-read. | Should | Test | UC-13 · F6.3 |
| FR-MSG-03 | support direct, group, and emergency conversation types. | Should | Demo | UC-12 · F6.1 |
| FR-MSG-04 | allow only the sender to soft-delete a message and append an `audit_logs` row for the deletion. | Should | Test | UC-12 · F6.5 |
| FR-RT-01 | authenticate every WebSocket connection by session cookie and close unauthenticated sockets with code 1008. | Must | Test | UC-11 · F7.1 |
| FR-RT-02 | restrict all realtime fan-out to the originating organization. | Must | Test | UC-11 · F7.2 |
| FR-NOT-01 | attempt delivery in the order WebSocket → push → SMS, continuing the workflow if a downstream channel fails. | Must | Test | UC-15 · F8.1 |
| FR-NOT-02 | deliver push notifications via FCM to registered devices and record each in `push_notifications`, with PHI-free payloads. | Should | Demo | UC-15 · F8.3 |
| FR-BRD-01 | allow only a director to create an emergency broadcast and track acknowledgments per recipient. | Should | Test | UC-14 · F15.1 |
| FR-DEV-01 | restrict all `/api/dev/*` routes to the developer role and exclude that role from production seed. | Should | Inspect | UC-21 · F10.1 |
| FR-DEV-02 | write a full audit entry before performing any impersonation session swap. | Should | Test | UC-22 · F10.2 |
| FR-MOB-01 | let the mobile app authenticate, receive assignments in realtime, and act on them. | Should | Demo | UC-28 · F11.3 |
| FR-MOB-02 | onboard a mobile device by scanning an org QR / code, resolving the organization without an authenticated session. | Should | Test | UC-26 · F11.1 |
| FR-MOB-03 | register, deduplicate, and deregister FCM device tokens per user / device. | Should | Test | UC-27 · F11.2 |
| FR-CFG-01 | apply org- and user-level runtime settings at decision time so a saved change takes effect **without a redeploy**. | Must | Test | UC-29 · F17.3 |
| FR-CFG-02 | restrict org-policy settings to the director role while letting any user manage their own preferences. | Should | Test | UC-29 · F17.1 |
| FR-CFG-03 | validate every setting against a typed schema and bounded range, rejecting out-of-range values server-side. | Must | Test | UC-29 · F17.1 |
| FR-CFG-04 | evaluate per-org feature flags and fall back to a safe default when a flag is unset. | Should | Test | UC-30 · F17.4 |
| FR-CFG-05 | generate adaptive default suggestions from logged usage with supporting evidence, and **never** auto-apply them. | Could | Demo | UC-31 · F17.5 |
| FR-CFG-06 | audit every applied tweak (actor, old→new value) and support reverting it. | Should | Test | UC-31 · F17.6 |

## PR — Performance

| ID | The system shall… | Priority | Verify | Trace |
|---|---|---|---|---|
| PR-01 | deliver an in-app assignment notification to a connected target within 1 second of creation under nominal load. | Should | Demo | UC-07 · F8.1 |
| PR-02 | complete provider selection in O(working providers) per assignment without N+1 cross-tenant scans. | Should | Analyze | UC-07 · F5.1 |
| PR-03 | cap the expiry reroute batch at 50 assignments per tick to bound memory and DB load. | Must | Inspect | UC-09 · F5.7 |
| PR-04 | bound the database connection pool (default max 10) to prevent connection exhaustion. | Should | Inspect | — · F12.4 |

## SEC — Security & Compliance

| ID | The system shall… | Priority | Verify | Trace |
|---|---|---|---|---|
| SEC-01 | store passwords only as salted hashes (bcrypt cost ≥12 / scrypt) and never return a hash in any response. | Must | Test | UC-01 · F1.7 |
| SEC-02 | scope every data query by an `organizationId` derived from the session, never from client input. | Must | Test | UC-07 · F2.3 |
| SEC-03 | record every PHI read/write to `/patients` and `/assignments` in `phi_access_logs` (user, org, resource, method, IP, UA). | Must | Test | UC-05 · F12.2 |
| SEC-04 | never display a patient by more than initials and never place PHI in push/SMS payloads, URLs, or AI prompts. | Must | Test | UC-15 · F8.4 |
| SEC-05 | use `httpOnly`, `sameSite=strict` session cookies with a 15-minute rolling lifetime, and `secure` in production. | Must | Test | UC-01 · F1.6 |
| SEC-06 | log security-relevant events to `audit_logs` and suspicious events to `security_incidents`. | Should | Test | UC-24 · F12.3 |
| SEC-07 | enforce role on every privileged route and tenant ownership on every targeted row. | Must | Test | UC-08 · F2.1 |
| SEC-08 | apply rate limiting to authentication endpoints to resist credential stuffing. | Must | Test | UC-01 · F12.4 |
| SEC-09 | return a generic error body to clients, never a stack trace. | Must | Inspect | — · F12.4 |
| SEC-10 | terminate TLS at the reverse proxy and reject plaintext HTTP in production. | Must | Inspect | — · F12.5 |
| SEC-11 | keep all third-party credentials server-side; clients shall never receive integration secrets. | Must | Inspect | UC-15 · F13.1 |
| SEC-12 | restrict the public org-by-code lookup to non-sensitive fields (id, name, code, timezone) only. | Must | Test | UC-26 · F11.4 |
| SEC-13 | log every developer cross-tenant access to `phi_access_logs` / `audit_logs`, not only impersonation. | Must | Test | UC-22 · F2.4 |

## DR — Data

| ID | The system shall… | Priority | Verify | Trace |
|---|---|---|---|---|
| DR-01 | treat the Drizzle schema in `shared/schema.ts` as the single source of truth, with Zod insert schemas derived from it. | Must | Inspect | — · F2.3 |
| DR-02 | preserve assignment history by creating new rows on reroute rather than mutating resolved ones. | Must | Test | UC-09 · F5.7 |
| DR-03 | persist sessions in PostgreSQL via `connect-pg-simple` rather than memory. | Must | Inspect | UC-01 · F1.6 |
| DR-04 | retain SMS audit history (body truncated to 255 chars) in `sms_history`. | Could | Inspect | UC-15 · F8.2 |
| DR-05 | persist runtime configuration in `org_settings` / `user_preferences` / `feature_flags` and adaptive proposals in `suggestions`. | Should | Inspect | UC-29 · F17.3 |

## IR — Interface

| ID | The system shall… | Priority | Verify | Trace |
|---|---|---|---|---|
| IR-01 | expose every external service behind a TypeScript interface with a stub and a live implementation chosen by env at startup. | Must | Inspect | UC-15 · F13.1 |
| IR-02 | run and pass the full test suite with no external secrets configured (all stubs active). | Must | Test | — · F13.1 |
| IR-03 | share a single typed `ApiClient` contract between web and mobile clients. | Should | Inspect | UC-28 · F11.3 |
| IR-04 | return mobile assignment payloads containing only initials, room, and specialty. | Should | Test | UC-28 · F11.4 |
| IR-05 | provide env-gated live smoke tests for each external integration (OpenAI, Twilio, Firebase, Amion) that never run in default CI. | Should | Demo | UC-15 · F13.2 |

## UR — Usability

| ID | The system shall… | Priority | Verify | Trace |
|---|---|---|---|---|
| UR-01 | render light mode only and present one primary action per view. | Should | Inspect | UC-16 · F3.2 |
| UR-02 | pair every status color with an icon and/or label using the fixed status language (amber/emerald/blue/red/slate). | Should | Inspect | UC-08 · F6.2 |
| UR-03 | honor `prefers-reduced-motion` and provide loading/empty/skeleton states. | Could | Demo | — · F7.5 |
| UR-04 | reconcile missed realtime events on reconnect via query invalidation. | Should | Demo | UC-11 · F7.5 |

## RR — Reliability

| ID | The system shall… | Priority | Verify | Trace |
|---|---|---|---|---|
| RR-01 | maintain the assignment census invariant under concurrent accept/cancel without double-counting. | Must | Test | UC-08 · F5.5 |
| RR-02 | produce exactly one new pending assignment on reroute when a provider is eligible, and zero otherwise. | Must | Test | UC-09 · F5.7 |
| RR-03 | degrade gracefully when an integration is down, logging the failure without aborting the workflow. | Should | Test | UC-15 · F8.1 |
| RR-04 | maintain WebSocket presence accuracy via a 20-second heartbeat and disconnect detection. | Should | Demo | UC-13 · F7.3 |

## DEP — Deployment

| ID | The system shall… | Priority | Verify | Trace |
|---|---|---|---|---|
| DEP-01 | boot the full stack locally with only `SESSION_SECRET` and `DATABASE_URL` configured. | Must | Demo | — · F13.1 |
| DEP-02 | apply schema changes via `drizzle-kit push` with no hand-written SQL migrations. | Should | Inspect | — · F2.3 |
| DEP-03 | seed a deterministic dataset (one org, a user per role) for demo and test. | Must | Test | — · F9.1 |
| DEP-04 | store production secrets in a secrets manager, not in source or plain env files. | Must | Inspect | — · F13.1 |
| DEP-05 | pass the complete automated suite in CI before any deploy. | Must | Test | — · all |

---

## Open production gates (from the threat model)

These **Must** items are known-open in the current build and must close before go-live:
SEC-08 (login rate-limit), SEC-10 (TLS at proxy), and a `users.phone` column for SMS MFA.

## Highest-risk invariants (keep green throughout)

RR-01 (census), RR-02 (reroute exactly-once), FR-ASG-04 (accept-only census change),
SEC-02 (tenant isolation) — all Must / Test.
