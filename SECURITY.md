# DocTurn — security & HIPAA readiness (plain-language)

**Status: ready to pilot with FAKE patients. NOT yet cleared for real patient
data (PHI).** This document explains, in non-technical terms, what's already
safe, what's missing, and the order to fix it before real PHI.

---

## What "HIPAA-ready" actually requires (the short version)

To legally handle real patient data you need three layers:

1. **The code** protects data (logins, permissions, audit, no leaks). — *mostly
   in place; gaps listed below.*
2. **The infrastructure** protects data (encrypted database, https everywhere,
   private network, backups). — *needs an AWS setup; not done.*
3. **The contracts (BAAs)** — every outside company that can touch PHI (AWS, any
   AI vendor, any tunnel/CDN) must sign a Business Associate Agreement. — *none
   signed yet.*

You can pilot the *workflow* today with made-up patients while layers 2 and 3
get built.

---

## Recommended AWS setup (when you're ready for real PHI)

You're on AWS — good, AWS is HIPAA-eligible and will sign a BAA. Recommended,
lowest-friction stack:

| Need | Use on AWS | Why |
|------|-----------|-----|
| Database (durable, encrypted) | **RDS for PostgreSQL**, "encryption at rest" enabled | managed Postgres, encrypted disk + automated backups |
| https / TLS (the lock icon) | **Application Load Balancer** + **ACM** certificate | terminates TLS with a free managed cert; no plain http |
| Run the app | **ECS Fargate** (or a small EC2) in a **private subnet** | app not exposed directly to the internet |
| Secrets (DB password, keys) | **AWS Secrets Manager** | no passwords in files/env on disk |
| Front-door protection | **AWS WAF** on the load balancer | blocks common attacks |
| Sign the contract | **AWS Artifact → accept the AWS BAA** | this is the "BAA" — do it before real PHI |

Then point the app at RDS by setting `DATABASE_URL` (see `TRIAL.md`), and the app
automatically uses encrypted Postgres instead of the local file database.

> The current trial path (local Windows + a `cloudflared` quick tunnel) is fine
> for **fake-data testing** but is **not** acceptable for real PHI: a quick
> tunnel has no BAA and the app speaks plain http locally.

---

## What's already good (don't re-do these)

- Passwords are hashed with scrypt + a unique salt (never stored in plain text).
- Two-factor (TOTP authenticator) is built in.
- Role-based access + every database query is scoped to one organization.
- Input validation (zod), security headers (helmet), login rate-limiting,
  http-only/secure session cookies, 15-minute inactivity timeout.
- An audit log records who did what, when.
- In-app password change (so accounts can leave the demo password behind). A
  change or an administrator's reset ends every other session of that account
  (HTTP, live WebSocket, demo token, half-finished MFA sign-in), and that
  includes any impersonated / managed-org portal a developer entered: such a
  portal is bound to the developer's own password and ends with it, as it does
  when the developer is deactivated. Deactivation closes live sockets at once.
- **External AI is OFF by default** — intake notes are parsed locally and never
  leave the server unless an operator deliberately turns it on (see below).
- **Integrations are real and fail closed** (Settings → Integrations,
  `docs/INTEGRATIONS.md`): status comes from live configuration, each org's
  switch is enforced server-side, OpenAI cannot be switched on without the BAA
  attestation, and each hospital's own Amion/Epic credentials are write-only,
  AES-256-GCM encrypted with `INTEGRATION_KEY` (bound to the org; the full
  128-bit tag is required on read), never returned or logged, and can only
  reach public `https://` hosts: private, loopback, link-local, metadata,
  IPv4-mapped / NAT64 / any non-global IPv6 address is refused when saved,
  when resolved, on every redirect hop, and again by the connection's own DNS
  lookup (no DNS-rebinding window). Every outbound integration call has one
  ≤ 10 s deadline over headers **and** body, and bodies are capped at 5 MB, so
  a slow or hostile vendor cannot hold a request or another hospital's sync.
  Only a director (or the operator) can switch, test or set up integrations;
  an ER director sees them read-only.
- **End shift is one transaction with its own audit row** (module
  `shift.handoff`): going off shift, handing pending requests to the covering
  provider (a same-org, active user — another tenant's id answers like an
  unknown one), the covering / DND / away-message preferences and the
  `shift.end` audit row commit or roll back together (the row is inserted
  inside the transaction, attributed to the real operator when the session is
  impersonated). The audit row carries ids and flags only — never the
  away-message text. DND and an away message are refused while `messaging.dnd`
  is off rather than stored as a promise nothing keeps.
- **Unread-message reminders are content-free** (module
  `messaging.unreadReminder`, opt-in per user): the push says only "You have
  unread messages in DocTurn" — no count, sender, patient or text — and is
  never sent while the user is DND, deactivated, or their org has push off.
  The sweep is a per-process timer (several instances can each send one per
  interval); its log lines carry a count only.
- **PIN unlock: a PIN re-opens an authenticated, locked session; it is not
  authentication** (module `security.pin`, off by default). It never signs
  anyone in: `POST /api/session/unlock-pin` needs a session that is signed in
  AND locked (signed out → 401, not locked → 409) and lifts that session's own
  server lock. The PIN (4–8 digits; one repeated digit or a straight run such
  as 1234 refused) is stored only as a scrypt hash from the password hasher,
  and is set / changed only with the account password re-entered. Wrong PINs
  are counted per session (`pin_unlock_failures`, keyed by a SHA-256 of the
  session id) and each attempt is spent before the hash is checked, so a burst
  of parallel guesses cannot exceed the limit: 5 wrong PINs disable it for
  that session and only the password re-opens it (`auth.pin_failed` low,
  `auth.pin_disabled` medium; never the digits). The same failure-counting
  auth rate limiter as sign-in also applies. The unlock route is lock-exempt,
  not a passthrough, so the idle auto-lock (back-dated a full idle window)
  is still an automatic logoff that no PIN re-opens — the PIN only re-opens a
  lock the user started, within 15 minutes. Nothing about the PIN (digits or
  whether one is set) is kept in browser storage. Honest limit: scrypt slows
  online guessing, but a 4–8 digit space is small enough to search offline if
  the database leaked — the per-session cap and the lock's own 15-minute end
  are the controls, not the hash.
- **Alert sounds fetch nothing** (module `messaging.alertSounds`): the tones
  are synthesised by WebAudio in the page — no audio files, no third-party
  host, no CSP change. The server stores only the tone names per priority.
  They are in-app sounds; Web Push notifications stay content-free and use
  the system sound.

---

## Fix order before real PHI

**P0 — blockers (must do):**
1. **Infrastructure:** stand up the AWS stack above (RDS encrypted, ALB+TLS,
   Secrets Manager) and **sign the AWS BAA**.
2. **Keep external AI off** (done — it now requires `AI_EXTERNAL_PHI_OK=true`
   *and* a key; leave it off, or only enable it with a BAA-covered endpoint like
   Azure OpenAI). You do **not** need AI for the pilot.
3. **Rate limiting ON** (don't set `RATE_LIMIT=off`); set secure cookies +
   `trust proxy` behind the load balancer.
4. **Enforce MFA** for clinical/admin roles and **force a password change** on
   first login; remove the shared demo password from any real account.

**P1 — strong hardening:**
5. **Patient-level access:** show clinicians only patients assigned to them or
   their team (today any clinician can see the whole org's board).
6. **Database row-level security** so one hospital truly cannot read another's
   rows, plus an automated test that proves it.
7. **Tamper-proof audit** that also logs AI calls and data exports.
8. **Mobile app hardening** (both Expo + web are in pilot scope): encrypted
   token storage, block screenshots, detect jailbroken/rooted devices, pin the
   server certificate. Until then, mobile = fake data only.
9. **CI security scanning** (dependency, code, and secret scanning on every push).

**P2 — operational maturity:**
10. Break-glass emergency access (with a required reason + high-risk audit).
11. Anomaly alerting (unusual PHI-access patterns / off-hours spikes).
12. Content-Security-Policy enabled.

---

## Do I need the AI feature? — No (for the pilot)

The only AI is parsing a free-text ER note into initials/room/complaint. The
**local** parser does this on-server with nothing sent out, and is the default.
The external (OpenAI) version is now disabled unless you set BOTH
`OPENAI_API_KEY` and `AI_EXTERNAL_PHI_OK=true` — and you should only ever do that
with a BAA-covered, HIPAA-eligible endpoint. (DocTurn's client calls
`api.openai.com`; a different endpoint such as Azure OpenAI would need a code
change.) Each organization can additionally switch it off for itself in
Settings → Integrations. For the pilot, leave it off.
