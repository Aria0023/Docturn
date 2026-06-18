# 14 — Build Plan

Build in this order. **Run the acceptance check at the end of each milestone before moving on.**
Each milestone is independently testable. Read `01_ARCHITECTURE.md`, `02_DATA_MODEL.md`,
`03_API_CONTRACT.md`, `04_RBAC.md`, `05_WORKFLOWS.md`, and `06_INTEGRATIONS.md` as you go; recreate
the UI from `design/ui_kits/` per `07_SCREENS.md`. `10_SYSTEM_REQUIREMENTS.md` is the acceptance
contract throughout.

> **Kickoff:** *"Implement DocTurn from this spec. Do M0, run its acceptance check, then continue
> milestone by milestone. Use PostgreSQL, stub all integrations by default, and keep every query
> org-scoped."*

## Foundation

### M0 — Scaffold & database
- Init the repo structure from `01_ARCHITECTURE.md`. Node 20, TS (ESM), Express, Drizzle + `pg`, Zod, Vitest.
- Implement `shared/schema.ts` (core tables + enums + Zod insert schemas) and `server/db.ts`. Wire `npm run db:push`.
- **Acceptance:** `db:push` creates the schema; `GET /api/health` → `{ ok:true, db:'up' }`.

### M1 — Auth, sessions & RBAC
- Passport local, `express-session` + `connect-pg-simple`, scrypt/bcrypt hashing,
  `requireAuth` / `requireRole` / `assertSameOrg`, sanitized `GET /api/user`. `register` + `login` + `logout`.
- `server/seed.ts` per `13_TEST_PLAN.md`; `npm run seed`.
- **Acceptance:** `auth.test.ts` passes (login, bad creds, role gate, cross-tenant, no `password_hash`).

### M2 — Providers, directory & org config
- Tenant-scoped `storage` methods for hospitalists; routes for list/working/directory, create, toggle
  working, capacity, delete (409 guard), org config get/patch, round-robin reset.
- **Acceptance:** director can manage providers & config; those routes return `403` for a hospitalist.

### M3 — Patient intake (+ AI)
- `ai-intake` interface + `MockAIExtractor`. `POST /api/patients/extract` and `POST /api/patients`.
- **Acceptance:** a note returns stable structured fields; creating a patient persists it org-scoped.

### M4 — Assignments, round-robin & expiry ⭐ core
- `rotation.selectNext` (lowest-census + cap relief, org-scoped), the assignment state machine
  (create/accept/reject/reassign/cancel), the `expiry` interval, and `notifications.notifyAssignment`.
- **Acceptance:** `assignments.test.ts` passes — every invariant in `05_WORKFLOWS.md`.

### M5 — Secure messaging
- Conversations (direct/group), send, history, mark-read, delete (+ audit), delivery-status rows.
- **Acceptance:** `messaging.test.ts` passes — participant-only access, read receipts.

### M6 — WebSocket realtime
- `/ws` server: cookie→session auth (close 1008), `clients` map, `broadcast` / `sendToUsers`,
  presence + 20s heartbeat, the event types in `03_API_CONTRACT.md`. Emit from the services.
- **Acceptance:** two clients — an assignment created for B arrives on B's socket; a message reaches
  only its participants; presence flips on connect/disconnect.

### M7 — Web client
- React + Vite + Tailwind + shadcn. Map theme tokens to `design/colors_and_type.css`. Recreate the
  screens in `07_SCREENS.md` with TanStack Query + a `WebSocketProvider`. `wouter` + `ProtectedRoute`.
- **Acceptance:** log in as each role; the screens work end-to-end; two-tab live update works.

### M8 — Hardening & polish
- Helmet, tiered rate limiting (auth vs general), consistent error shape, audit rows on sensitive
  actions, `prefers-reduced-motion`, empty/loading/skeleton states.
- **Acceptance:** `npm test` green; boots with no secrets; smoke-walk all flows.

## Full platform

### M9 — Full MFA
- `mfa_credentials`, `mfa_backup_codes`, `sms_verification_codes`. TOTP enroll/verify (speakeasy),
  SMS OTP, 10 backup codes; 15-min rolling session.
- **Acceptance:** real MFA in non-dev; backup codes single-use; rate-limited OTP attempts.

### M10 — Live integrations
- Replace stubs with live OpenAI / Twilio / Firebase / Amion behind the env-gated factories; keep
  stubs for CI. Add `sms_history`, `device_tokens`, `push_notifications`.
- **Acceptance:** CI runs on stubs; env-gated live smoke tests pass with real credentials.

### M11 — Registration & developer tooling
- `pending_registrations` + director-approval queue. `/api/dev/*` (org admin, audited impersonation,
  AI diagnostics). CMS (`landing_page_settings` / `contact_page_settings`) + developer editor.
- **Acceptance:** self-registration needs sign-off; developer admin works without breaking org-scoping.

### M12 — Scheduling, resources & broadcasts
- `departments`, `beds`, `equipment`, `resource_alerts`, `resource_metrics`; `provider_directory`,
  `on_call_schedules`; `emergency_broadcasts` + `broadcast_acknowledgments` with org-scoped fan-out.
- **Acceptance:** resource dashboards show live metrics; broadcasts deliver and track acks per-org.

### M13 — Mobile app
- Expo / React Native: bottom-tab nav, shared typed `ApiClient`, native WS, FCM registration,
  `/api/mobile/*` (compact payloads, QR onboarding).
- **Acceptance:** mobile authenticates, receives assignments in realtime, push lands on device.

### M14 — Security & compliance closeout
- `phi_access_logs` on every PHI route; `security_incidents` wired in; finalize the threat model;
  HIPAA review across MFA, audit, session policy, rate limiting. Add login rate-limit + TLS at proxy
  + `users.phone` for SMS MFA (the known production gates).
- **Acceptance:** all PHI routes logged; production gates closed.

## Configurability (additive — C1 can land any time after M2)

### C1 — Runtime settings
- `org_settings` + `user_preferences` + a cached `config` service read in hot paths; Settings UI.
- **Acceptance:** change a tweak in-app, the next action reflects it, no redeploy (`config.test.ts`).

### C2 — Behavior flags
- `feature_flags` per org; gate a behavior behind a flag.
- **Acceptance:** flip on one org without a release; safe default when unset; instant rollback.

### C3 — Adaptive suggestions
- `suggestions` + the `analyze()` loop + a review card.
- **Acceptance:** the system proposes a change with evidence; a human accepts → written + audited.

## Guardrails (apply throughout)
- **Every** storage method takes `organizationId` and filters by it. No exceptions.
- Server is authoritative for routing/expiry/roles/MFA — never trust the client.
- Never return secrets/hashes; push/SMS payloads carry no PHI; patients shown by initials.
- Keep routes thin; put logic in `services/` so it's unit-testable without HTTP.
