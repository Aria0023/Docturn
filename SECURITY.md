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
- In-app password change (so accounts can leave the demo password behind).
- **External AI is OFF by default** — intake notes are parsed locally and never
  leave the server unless an operator deliberately turns it on (see below).

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
with a BAA-covered, HIPAA-eligible endpoint (e.g. Azure OpenAI). For the pilot,
leave it off.
