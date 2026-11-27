# HIPAA Compliance Audit — DocTurn repository

**Audit scope:** `server/` (Express / TypeScript API, auth, audit, billing, integrations), `shared/schema.ts`, `webapp/` (client, service worker), `mobile-app/` (Expo shell config), `package-lock.json`, git history, and the app's own compliance monitor (`GET /api/compliance/status`). Reviewed 2026-11-12.
**Inferred HIPAA role:** Business Associate — DocTurn carries clinical messages and admission routing for hospitals (covered entities).
**PHI/ePHI present:** Yes by design in production (patient initials, room, complaint, free-text messages, attachments). The only running deployment (Render) is in synthetic-data mode and holds none.
**Lifecycle stage:** Implementation, pre-production. Production target is AWS.
**Auditor note:** This is a review of artifacts, not of a running production system: no AWS account, signed BAA, backup, or network configuration could be examined. **Vanta was not used** — the plugin is enabled on the account but no Vanta connection is available in this session, and Vanta tests a company's connected cloud and identity systems, which do not exist yet for DocTurn.

---

## Summary

- 🔴 Critical: 1
- 🟠 High: 3 (2 fixed in this pass)
- 🟡 Medium: 5 (1 fixed in this pass)
- 🔵 Low: 3
- ⚪ Info / Cannot determine: 2

Fixed in this pass: HIGH-01, HIGH-02, MEDIUM-01. Everything else needs a decision, an account, or a document that code cannot supply.

---

## Findings

### 🔴 CRITICAL-01: Required administrative safeguards have no evidence — risk analysis, BAAs, contingency plan

**Where:** `GET /api/compliance/status` — controls `risk-analysis`, `baa-hosting`, `baa-database`, `baa-push-vendor`, `incident-response-plan`, `contingency-plan`, `backup-tested`, `workforce-training`, `policies-approved`, `sanction-policy` all report *"No attestation recorded."*
**HIPAA rule:** 45 CFR § 164.308(a)(1)(ii)(A) — Risk Analysis; § 164.308(b)(1) and § 164.502(e) — Business Associate Contracts; § 164.308(a)(7) — Contingency Plan; § 164.308(a)(6) — Security Incident Procedures.

**What's wrong:**
None of the organizational safeguards exists yet. There is no documented risk analysis, no signed BAA with a hosting provider (Render offers none on this plan), and no tested backup. The software records this honestly instead of claiming it, but an honest gap is still a gap.

**Why HIPAA cares:**
The risk analysis is the foundation of the Security Rule — every other safeguard is supposed to follow from it, and its absence is the most commonly cited failure in OCR enforcement. A BAA is what makes it lawful to hand ePHI to a vendor at all; without one, placing PHI on that vendor is itself the violation, however good the encryption.

**Recommended fix:**
Before any real patient data: (1) write the risk analysis (assets, threats, likelihood, impact, mitigations — a 10–15 page document is normal at this size); (2) accept the hosting provider's BAA and keep the copy; (3) enable automated encrypted database backups and perform one restore; (4) record each in the compliance monitor's attestation form with a named owner and the evidence. Until then keep `SYNTHETIC_DATA` unset.

---

### 🟠 HIGH-01: A real-PHI instance could start without its required safeguards — **FIXED**

**Where:** `server/index.ts` (boot), now `server/phi-preflight.ts`
**HIPAA rule:** 45 CFR § 164.312(a)(2)(iv) — Encryption; § 164.312(e)(1) — Transmission Security; § 164.312(d) — Authentication; § 164.308(a)(5)(ii)(D) — Password Management.

**What's wrong:**
`SYNTHETIC_DATA=false` (the operator's declaration of real patient data) only stopped demo seeding. The server would still start on the unencrypted on-disk PGlite store, with a per-restart session secret, non-Secure cookies, or login rate limiting switched off.

**Why HIPAA cares:**
A safeguard that depends on someone remembering five environment variables is not a safeguard. The Security Rule expects the protections to be in place whenever ePHI is, not discoverable afterwards on a dashboard.

**Recommended fix (done):**
The server now refuses to start in real-PHI mode unless `DATABASE_URL`, `NODE_ENV=production`, a 32+ character `SESSION_SECRET`, and `INTEGRATION_KEY` are set and `RATE_LIMIT` is not `off`, printing each missing item with its rule. A lab-only override exists for the verification scripts; it is ignored in production and warns on every boot. Tests: `tests/phi-preflight.test.ts`.

---

### 🟠 HIGH-02: Privileged accounts could reach every record with a password alone — **FIXED**

**Where:** `shared/modules.ts` — `security.mfaRequired` defaulted to `false`
**HIPAA rule:** 45 CFR § 164.312(d) — Person or Entity Authentication; § 164.308(a)(4) — Information Access Management.

**What's wrong:**
A director or platform operator can read an organization's whole board and trail, and multi-factor authentication for those roles was an opt-in switch, off by default.

**Why HIPAA cares:**
The rule requires verifying that a person seeking access is who they claim to be. For accounts with tenant-wide reach, a single guessed or phished password is the whole breach.

**Recommended fix (done):**
In real-PHI mode the module now defaults **on**: privileged roles must enrol a second factor at first sign-in (or arrive through SSO with the identity provider asserting MFA). An organization can still switch it off explicitly, which is audited. Synthetic instances are unchanged.

---

### 🟠 HIGH-03: A live credential is still readable in git history

**Where:** commits before `92a86b2` ("Remove a hard-coded Amion login from the schedule screen")
**HIPAA rule:** 45 CFR § 164.308(a)(5)(ii)(D) — Password Management; § 164.312(a)(1) — Access Control.

**What's wrong:**
An Amion schedule login was once committed. It was removed from the working tree, but every clone of the repository still contains it.

**Why HIPAA cares:**
A credential in history is a credential anyone with repository access holds indefinitely. Schedule data names who is on call for which service.

**Recommended fix:**
Rotate that Amion password now — rotation, not history rewriting, is what closes this. No current secret was found in the working tree.

---

### 🟡 MEDIUM-01: Production dependencies with known advisories — **PARTLY FIXED**

**Where:** `package-lock.json`
**HIPAA rule:** 45 CFR § 164.308(a)(5)(ii)(B) — Protection from Malicious Software; § 164.308(a)(1)(ii)(B) — Risk Management.

**What's wrong:**
`npm audit` reported body-parser (high, denial of service), qs (moderate) and zod (high, memory exhaustion on oversized collections).

**Recommended fix:**
body-parser and qs are upgraded and pinned by test (`tests/dependency-advisories.test.ts`). **zod remains**: the fix is a major-version upgrade that touches every request schema. Exposure is limited because request bodies are capped at 1 MB before validation; schedule the upgrade as its own change.

---

### 🟡 MEDIUM-02: No account-level lockout; failed sign-ins are limited per network address only

**Where:** `server/app.ts` (auth rate limiter), `shared/schema.ts` (`users` has no failed-attempt or last-login column)
**HIPAA rule:** 45 CFR § 164.308(a)(5)(ii)(C) — Log-in Monitoring.

**What's wrong:**
Guessing is throttled per source address. An attacker spreading attempts across many addresses is not slowed for a given account, and there is no last-sign-in record to review.

**Why HIPAA cares:**
The rule asks for procedures to monitor log-in attempts and report discrepancies.

**Recommended fix:**
Record last successful sign-in and a rolling failed-attempt count per account, alert the organization's directors past a threshold, and add a short per-account delay. Deliberately **not** a hard lockout: locking a clinician out of the system that delivers their STAT pages is a patient-safety risk, and anyone who knows a username could trigger it. MFA (HIGH-02) is the stronger control.

---

### 🟡 MEDIUM-03: The audit trail is not tamper-evident

**Where:** `server/audit.ts`, table `audit_logs`
**HIPAA rule:** 45 CFR § 164.312(b) — Audit Controls; § 164.312(c)(1) — Integrity.

**What's wrong:**
Audit rows are append-only by convention: no route deletes them and a deleted organization's trail is archived first. But nothing would reveal a row altered or removed directly in the database.

**Recommended fix:**
Chain each row to the previous one with a hash, or ship the trail continuously to write-once storage outside the application's own database credentials. The second is simpler on AWS.

---

### 🟡 MEDIUM-04: No security-incident or breach workflow

**Where:** table `security_incidents` exists in `shared/schema.ts`; no route reads or writes it
**HIPAA rule:** 45 CFR § 164.308(a)(6)(ii) — Response and Reporting; § 164.410 — Notification by a Business Associate.

**What's wrong:**
There is nowhere to record a suspected incident, its assessment, or when the affected hospital was notified.

**Why HIPAA cares:**
A business associate must notify the covered entity of a breach without unreasonable delay and within 60 days. That clock is unprovable without a record.

**Recommended fix:**
A written incident-response procedure first (CRITICAL-01), then an incident log for operators: what, when discovered, which organizations, risk assessment, notification date.

---

### 🟡 MEDIUM-05: Free-text fields can carry more than the minimum necessary

**Where:** `createPatientSchema.issueSummary`, message content, attachments
**HIPAA rule:** 45 CFR § 164.502(b) — Minimum Necessary.

**What's wrong:**
The structured fields are deliberately minimal (initials, room). The complaint field, messages and photo attachments are free-form, so a full name, MRN or date of birth can be typed or photographed.

**Recommended fix:**
This is inherent to clinical messaging and is the reason the BAA and encryption matter. Add it to the risk analysis, state the expectation in workforce training, and consider a gentle warning when text matches an MRN or date-of-birth pattern.

---

### 🔵 LOW-01: Uploaded attachments are not scanned for malware

**Where:** `POST /api/messaging/attachments` (`server/routes/messaging.ts`)
**HIPAA rule:** 45 CFR § 164.308(a)(5)(ii)(B).

**What's wrong:** File type is restricted to an allow-list and size is capped, but content is not scanned.
**Recommended fix:** Scan on upload once files live in object storage.

### 🔵 LOW-02: The native shell does not hide the screen in the app switcher or block screenshots

**Where:** `mobile-app/App.tsx`, `mobile-app/app.config.ts` (cloud backup is correctly disabled)
**HIPAA rule:** 45 CFR § 164.310(c) — Workstation Security; § 164.312(a)(2)(iii) — Automatic Logoff.

**What's wrong:** A patient thread can remain visible in the phone's recent-apps view.
**Recommended fix:** Obscure the view when the app goes to the background; set the secure-window flag on Android.

### 🔵 LOW-03: Operator impersonation of a tenant user does not require a stated reason

**Where:** `POST /api/dev/impersonate` (`server/routes/dev.ts`) — audited at high risk, attributed to the operator
**HIPAA rule:** 45 CFR § 164.308(a)(4) — Information Access Management.

**What's wrong:** The access is recorded but not justified.
**Recommended fix:** Require a short reason, stored in the audit row and visible to the organization's directors.

---

### ⚪ INFO-01: Retention of documentation for six years cannot be demonstrated yet

**Where:** compliance monitor control `audit-retention`
**HIPAA rule:** 45 CFR § 164.316(b)(2)(i).
The system has not existed for six years. Confirm that production backups and any log archive are retained for that period.

### ⚪ INFO-02: Encryption at rest depends entirely on the production database

**Where:** compliance monitor control `encryption-at-rest`; attachments stored in the database by default
**HIPAA rule:** 45 CFR § 164.312(a)(2)(iv).
The application does not encrypt message rows itself; it relies on the database volume. Verify storage encryption is enabled on the production database and its backups, and record the evidence.

---

## Controls verified as present

Unique user identification and role-based access with tenant isolation (cross-tenant reads answer 404); 15-minute idle sign-out and app lock; scrypt password hashing; one-time credentials with forced change; immediate termination of access on deactivation; audit log and per-read PHI access log (including message reads); content-free push and SMS; the service worker never caches `/api`; no PHI persisted to browser storage; log scrubbing; external AI gated behind an operator attestation with a local fallback; billing payload restricted to non-PHI fields; HSTS and a content-security policy.

---

*This audit identifies technical and procedural gaps against HIPAA rules. It is not legal advice. Engage HIPAA counsel for formal compliance attestation.*
