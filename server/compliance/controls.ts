/**
 * DocTurn continuous-control monitor — the CONTROL CATALOG.
 *
 * Each entry names a HIPAA Security Rule safeguard and/or a SOC 2 Trust
 * Services criterion, and declares whether DocTurn can verify it from live
 * system state (`kind: "auto"`) or whether it is an ORGANIZATIONAL control that
 * only a human can attest to (`kind: "manual"`).
 *
 * The split is the whole point of this module:
 *   • An `auto` control's status is recomputed from real DB queries / runtime
 *     configuration on EVERY read (see ./checks.ts). Nothing is stored, nothing
 *     is defaulted to passing. If a check cannot reach a defensible conclusion
 *     it returns "unknown" with a note saying what a human must confirm.
 *   • A `manual` control's status comes only from an attestation a named owner
 *     recorded in `compliance_attestations`. Code never marks one satisfied.
 *
 * Nothing here — and nothing this module produces — is a certification. HIPAA
 * has no certification scheme; SOC 2 requires an audit by a licensed CPA firm.
 * This is evidence to hand an auditor, not a substitute for one.
 */

export const CONTROL_CATEGORIES = [
  "Access control",
  "Authentication",
  "Session & transport",
  "Audit & monitoring",
  "Data protection",
  "Vendor & contracts",
  "Administrative",
  "Physical",
] as const;
export type ControlCategory = (typeof CONTROL_CATEGORIES)[number];

/**
 * Outcome of evaluating one control.
 *  pass    — verified from live state, meets the stated threshold.
 *  warn    — verified, but below the threshold / needs attention.
 *  fail    — verified, and the safeguard is NOT in place.
 *  manual  — cannot be established by code; requires a human attestation.
 *  unknown — code tried and could not reach a defensible conclusion.
 */
export const CONTROL_STATUSES = [
  "pass",
  "warn",
  "fail",
  "manual",
  "unknown",
] as const;
export type ControlStatus = (typeof CONTROL_STATUSES)[number];

export type ControlSeverity = "critical" | "high" | "medium" | "low";

export interface ControlDef {
  id: string;
  title: string;
  description: string;
  category: ControlCategory;
  /** Citations, e.g. "45 CFR §164.312(a)(1)". */
  hipaa: string[];
  /** SOC 2 Trust Services criteria, e.g. "CC6.1". */
  soc2: string[];
  kind: "auto" | "manual";
  /** Baseline severity if the control is not satisfied. */
  severity: ControlSeverity;
  remediation: string;
}

export const CONTROLS: ControlDef[] = [
  /* ── AUTOMATED: computed from live system state ─────────────────────────── */
  {
    id: "pwd-hashing",
    title: "Passwords stored as salted hashes",
    description:
      "Every user row is inspected for a credential in the exact format the app's hasher produces (scrypt, 64-byte key + 16-byte random salt). Any row that does not match — a plaintext or legacy credential — fails the control.",
    category: "Authentication",
    hipaa: ["45 CFR §164.312(a)(2)(i)", "45 CFR §164.312(d)"],
    soc2: ["CC6.1"],
    kind: "auto",
    severity: "critical",
    remediation:
      "Reset any credential not in the expected format via the password-change flow (server/auth.ts hashPassword), then re-run this check.",
  },
  {
    id: "mfa-enrollment",
    title: "Multi-factor authentication enrolled",
    description:
      "Counts users with twoFactorEnabled against the roster. The policy threshold is: every PRIVILEGED account (director, ER director, developer) has MFA. Anything less is reported with the real numbers, together with whether the org ENFORCES enrolment (module security.mfaRequired: un-enrolled privileged users are held at the enrolment screen until they finish).",
    category: "Authentication",
    hipaa: ["45 CFR §164.312(d)"],
    soc2: ["CC6.1"],
    kind: "auto",
    severity: "high",
    remediation:
      "Switch on the 'Require MFA for privileged roles' module for the org (developer console) so every director / ER director / developer is routed into TOTP enrolment (POST /api/mfa/enroll, then /api/mfa/verify) at next sign-in.",
  },
  {
    id: "session-timeout",
    title: "Automatic session inactivity timeout",
    description:
      "Reads the running session middleware's configured cookie maxAge and rolling flag (server/config.ts SESSION_POLICY — the same object server/app.ts builds the session from). Passes at 15 minutes of inactivity or less.",
    category: "Session & transport",
    hipaa: ["45 CFR §164.312(a)(2)(iii)"],
    soc2: ["CC6.1"],
    kind: "auto",
    severity: "medium",
    remediation:
      "Lower SESSION_POLICY.maxAgeMs in server/config.ts to 15 minutes or less and keep rolling: true so the window is an INACTIVITY timeout.",
  },
  {
    id: "session-cookie-flags",
    title: "Session cookie hardening",
    description:
      "Reads the same live session configuration and checks httpOnly, sameSite, and that the cookie is marked Secure whenever NODE_ENV=production.",
    category: "Session & transport",
    hipaa: ["45 CFR §164.312(e)(1)"],
    soc2: ["CC6.6"],
    kind: "auto",
    severity: "high",
    remediation:
      "Keep httpOnly true and sameSite lax/strict in SESSION_POLICY, and run production with NODE_ENV=production behind TLS so Secure is set.",
  },
  {
    id: "session-secret",
    title: "Session signing secret is externally managed",
    description:
      "Checks that SESSION_SECRET is supplied by the environment and is at least 32 characters. Without it the app falls back to a per-process random secret: every restart silently invalidates all sessions and multiple instances cannot share them. The secret's value is never read, logged or exported — only its presence and length.",
    category: "Session & transport",
    hipaa: ["45 CFR §164.312(a)(2)(i)"],
    soc2: ["CC6.1"],
    kind: "auto",
    severity: "high",
    remediation:
      "Set SESSION_SECRET to a random value of 32+ characters in the hosting environment's secret store and restart.",
  },
  {
    id: "auth-rate-limit",
    title: "Login brute-force protection active",
    description:
      "Reports whether the running process actually mounted the auth rate limiters. This is recorded by createApp() at boot, so RATE_LIMIT=off (or a test harness disabling limits) is reported as a real failure rather than assumed away.",
    category: "Access control",
    hipaa: ["45 CFR §164.308(a)(5)(ii)(C)"],
    soc2: ["CC6.1"],
    kind: "auto",
    severity: "high",
    remediation:
      "Remove RATE_LIMIT=off from the deployment environment and restart so the 50-per-15-min login limiter is mounted.",
  },
  {
    id: "encryption-at-rest",
    title: "Encryption of ePHI at rest",
    description:
      "Reports whether the database is a persistent Postgres or the ephemeral in-process store. Disk-level encryption and a signed BAA are properties of the hosting tier — code running inside the app CANNOT observe them, so this control is never automatically passed.",
    category: "Data protection",
    hipaa: ["45 CFR §164.312(a)(2)(iv)"],
    soc2: ["CC6.1"],
    kind: "auto",
    severity: "critical",
    remediation:
      "Run on a managed Postgres with encryption at rest enabled under a signed BAA, then record the provider's attestation under baa-database.",
  },
  {
    id: "transmission-security",
    title: "Encryption of ePHI in transit",
    description:
      "Probes the security-header middleware the app actually mounted to see which headers it emits (HSTS included), and combines that with NODE_ENV and the Secure-cookie setting. TLS termination itself happens in front of this process and must be confirmed at the hosting layer.",
    category: "Session & transport",
    hipaa: ["45 CFR §164.312(e)(1)"],
    soc2: ["CC6.6"],
    kind: "auto",
    severity: "critical",
    remediation:
      "Deploy with NODE_ENV=production behind TLS-terminating infrastructure that redirects HTTP→HTTPS, and confirm HSTS reaches the browser.",
  },
  {
    id: "audit-logging-active",
    title: "Audit logging is actually recording",
    description:
      "Real counts from this organization's audit table: events in the last 24 hours and 30 days, the age of the oldest retained event, and whether any high-risk events exist. Zero events in 30 days means logging is silently broken.",
    category: "Audit & monitoring",
    hipaa: ["45 CFR §164.312(b)"],
    soc2: ["CC7.2"],
    kind: "auto",
    severity: "critical",
    remediation:
      "Verify appendAudit() is reachable (check server logs for '[audit] failed to append') and that the audit_logs table is writable.",
  },
  {
    id: "audit-retention",
    title: "Audit records retained for six years",
    description:
      "HIPAA §164.316(b)(2)(i) requires compliance documentation to be retained six years. Compares the age of the oldest audit record against that window and reports whether anything in the codebase deletes audit rows. A young system is reported as young — not as a failure.",
    category: "Audit & monitoring",
    hipaa: ["45 CFR §164.316(b)(2)(i)", "45 CFR §164.312(b)"],
    soc2: ["CC7.2"],
    kind: "auto",
    severity: "medium",
    remediation:
      "Keep audit_logs out of any purge job and ensure database backups covering a six-year window are retained and restorable.",
  },
  {
    id: "phi-access-logging",
    title: "PHI reads are audited, not just writes",
    description:
      "Splits this organization's PHI access log by HTTP method. §164.312(b) requires recording activity on systems containing ePHI — reads included, since a read is how PHI leaks.",
    category: "Audit & monitoring",
    hipaa: ["45 CFR §164.312(b)"],
    soc2: ["CC7.2"],
    kind: "auto",
    severity: "high",
    remediation:
      "Call logPhiAccess() on every patient/assignment/board READ route, not only on mutations.",
  },
  {
    id: "msg-retention-policy",
    title: "Message retention policy configured",
    description:
      "Reads this organization's messageRetentionDays setting. Unset means clinical messages are retained indefinitely — permitted, but it must be a deliberate, documented decision rather than an oversight.",
    category: "Data protection",
    hipaa: ["45 CFR §164.316"],
    soc2: ["CC6.5"],
    kind: "auto",
    severity: "low",
    remediation:
      "Set a retention window in Settings → Organization (messageRetentionDays); the hourly sweep in server/services/retention.ts enforces it and audits each purge.",
  },
  {
    id: "tenant-isolation",
    title: "Tenant isolation holds at runtime",
    description:
      "A live probe, not a claim: org-scoped storage queries are executed for the caller's organization and every returned row's organizationId is verified. Cross-tenant row COUNTS (integers only) confirm other tenants' data exists in the same database, so the probe is meaningful rather than vacuous. If no second tenant exists the result is 'unknown', never a pass.",
    category: "Access control",
    hipaa: ["45 CFR §164.312(a)(1)", "45 CFR §164.308(a)(4)"],
    soc2: ["CC6.1", "CC6.3"],
    kind: "auto",
    severity: "critical",
    remediation:
      "Every storage method must filter on organizationId taken from the session — never from client input. Investigate any leaked row immediately as a potential breach.",
  },
  {
    id: "phi-mode",
    title: "Synthetic-data mode",
    description:
      "Reports whether the instance is in synthetic-data mode (SYNTHETIC_DATA is anything other than the string \"false\") or has been deliberately switched to real-PHI mode. In real-PHI mode every failing control carries real patient risk and its severity is escalated, and the hosting/database BAAs must already be attested.",
    category: "Data protection",
    hipaa: ["45 CFR §164.308(a)(1)(ii)(B)"],
    soc2: ["CC1.2"],
    kind: "auto",
    severity: "critical",
    remediation:
      "Keep SYNTHETIC_DATA unset (synthetic) until every BAA is signed, a risk analysis is complete, and encrypted object storage replaces inline attachments.",
  },
  {
    id: "privileged-accounts",
    title: "Privileged accounts kept to a minimum",
    description:
      "Counts developer (root) and director/ER-director accounts in this organization against the total roster. Least privilege means administrative accounts are the exception.",
    category: "Access control",
    hipaa: ["45 CFR §164.308(a)(4)"],
    soc2: ["CC6.3"],
    kind: "auto",
    severity: "medium",
    remediation:
      "Downgrade accounts that do not need administrative rights in Role management, and review the list quarterly under access-review.",
  },
  {
    id: "stale-accounts",
    title: "Dormant accounts identified",
    description:
      "DocTurn has no last_login column, so activity is derived from the audit trail (the only genuine signal available). Accounts with no audited activity in 90 days are listed by count. If the audit trail itself is younger than the window, the result says so instead of implying dormancy.",
    category: "Access control",
    hipaa: ["45 CFR §164.308(a)(3)(ii)(C)"],
    soc2: ["CC6.2"],
    kind: "auto",
    severity: "medium",
    remediation:
      "Add explicit last-login tracking to the users table for a first-class signal, and deactivate accounts on termination as part of access-review.",
  },
  {
    id: "attachment-storage",
    title: "Attachment storage suitable for ePHI",
    description:
      "Reads the attachment store this process is running with. Passes when ATTACHMENT_STORE=fs-encrypted with a valid 32-byte ATTACHMENT_KEY (AES-256-GCM per file, random IV, auth tag; plaintext never written). The default base64-in-database store — a synthetic-data pilot shortcut — warns. Reports the real count and total bytes currently stored.",
    category: "Data protection",
    hipaa: ["45 CFR §164.312(a)(2)(iv)", "45 CFR §164.312(c)(1)"],
    soc2: ["CC6.1"],
    kind: "auto",
    severity: "high",
    remediation:
      "Set ATTACHMENT_STORE=fs-encrypted, ATTACHMENT_DIR and a 32-byte ATTACHMENT_KEY (64 hex chars) from a secrets manager; then move bytes to S3/GCS under a signed BAA with SSE, add AV scanning on upload, and serve via short-lived signed URLs before enabling real-PHI mode.",
  },

  /* ── MANUAL: organizational controls only a human can attest to ─────────── */
  {
    id: "baa-hosting",
    title: "BAA signed with the hosting provider",
    description:
      "A Business Associate Agreement with whoever runs the compute (Render, AWS, Azure…). Code cannot see a contract.",
    category: "Vendor & contracts",
    hipaa: ["45 CFR §164.308(b)(1)", "45 CFR §164.314(a)"],
    soc2: ["CC9.2"],
    kind: "manual",
    severity: "critical",
    remediation:
      "Execute a BAA with the hosting provider and attach the countersigned PDF as evidence.",
  },
  {
    id: "baa-database",
    title: "BAA signed with the database/storage provider",
    description:
      "A BAA covering wherever ePHI is persisted, including backups and any managed storage.",
    category: "Vendor & contracts",
    hipaa: ["45 CFR §164.308(b)(1)", "45 CFR §164.314(a)"],
    soc2: ["CC9.2"],
    kind: "manual",
    severity: "critical",
    remediation:
      "Execute a BAA with the managed-database provider and confirm encryption at rest and backup retention in writing.",
  },
  {
    id: "baa-push-vendor",
    title: "Push / SMS vendor covered or PHI-free",
    description:
      "Push and SMS transports leave your infrastructure. Either the vendor has signed a BAA, or notification payloads must be provably content-free.",
    category: "Vendor & contracts",
    hipaa: ["45 CFR §164.308(b)(1)", "45 CFR §164.312(e)(1)"],
    soc2: ["CC9.2"],
    kind: "manual",
    severity: "high",
    remediation:
      "Sign a BAA with the SMS/push vendor, or confirm and document that payloads never contain patient-identifying content.",
  },
  {
    id: "risk-analysis",
    title: "Security risk analysis completed",
    description:
      "The §164.308(a)(1)(ii)(A) risk analysis is REQUIRED — not addressable — and is the first document an OCR investigator asks for. Its absence is the single most common HIPAA enforcement finding.",
    category: "Administrative",
    hipaa: ["45 CFR §164.308(a)(1)(ii)(A)"],
    soc2: ["CC3.2"],
    kind: "manual",
    severity: "critical",
    remediation:
      "Complete a documented risk analysis covering every system that creates, receives, maintains or transmits ePHI; record the date and attach the report.",
  },
  {
    id: "workforce-training",
    title: "Workforce security-awareness training",
    description:
      "Documented HIPAA training for every workforce member with access, with dates and a roster.",
    category: "Administrative",
    hipaa: ["45 CFR §164.308(a)(5)"],
    soc2: ["CC1.4"],
    kind: "manual",
    severity: "high",
    remediation:
      "Run annual training, keep the signed roster, and attach it as evidence with the completion date.",
  },
  {
    id: "policies-approved",
    title: "Written policies and procedures approved",
    description:
      "HIPAA policies documented, approved by management, and retained six years (§164.316).",
    category: "Administrative",
    hipaa: ["45 CFR §164.316"],
    soc2: ["CC5.3"],
    kind: "manual",
    severity: "high",
    remediation:
      "Approve and version the policy set, record the approval date, and link the document repository.",
  },
  {
    id: "incident-response-plan",
    title: "Security incident response plan",
    description:
      "A documented procedure for identifying, responding to and reporting security incidents, including breach notification timelines.",
    category: "Administrative",
    hipaa: ["45 CFR §164.308(a)(6)", "45 CFR §164.400-414"],
    soc2: ["CC7.3", "CC7.4"],
    kind: "manual",
    severity: "high",
    remediation:
      "Write the plan, name the responder on call, and record the date of the last tabletop exercise.",
  },
  {
    id: "contingency-plan",
    title: "Contingency / disaster recovery plan",
    description:
      "Data backup, disaster recovery and emergency-mode operation plans (§164.308(a)(7)).",
    category: "Administrative",
    hipaa: ["45 CFR §164.308(a)(7)"],
    soc2: ["A1.2"],
    kind: "manual",
    severity: "high",
    remediation:
      "Document RTO/RPO, the backup schedule, and how clinicians operate if DocTurn is unavailable.",
  },
  {
    id: "backup-tested",
    title: "Backup restore tested",
    description:
      "An untested backup is not a backup. Requires a dated record of a successful restore drill.",
    category: "Administrative",
    hipaa: ["45 CFR §164.308(a)(7)(ii)(D)"],
    soc2: ["A1.2"],
    kind: "manual",
    severity: "high",
    remediation:
      "Restore a backup into a scratch environment, verify row counts and a sample login, and record the date.",
  },
  {
    id: "access-review",
    title: "Periodic access review performed",
    description:
      "A recurring review of who has an account, at what role, and whether it is still warranted.",
    category: "Access control",
    hipaa: ["45 CFR §164.308(a)(4)", "45 CFR §164.308(a)(3)(ii)(B)"],
    soc2: ["CC6.2", "CC6.3"],
    kind: "manual",
    severity: "medium",
    remediation:
      "Review the roster and the privileged-accounts and stale-accounts figures on this page each quarter; record the reviewer and date.",
  },
  {
    id: "sanction-policy",
    title: "Workforce sanction policy",
    description:
      "A documented policy applying sanctions to workforce members who violate security policies.",
    category: "Administrative",
    hipaa: ["45 CFR §164.308(a)(1)(ii)(C)"],
    soc2: ["CC1.5"],
    kind: "manual",
    severity: "medium",
    remediation:
      "Publish the sanction policy alongside the HIPAA policy set and confirm HR applies it.",
  },
  {
    id: "workstation-security",
    title: "Workstation and device security",
    description:
      "Physical safeguards for workstations and mobile devices that display ePHI — screen locks, full-disk encryption, MDM.",
    category: "Physical",
    hipaa: ["45 CFR §164.310(b)", "45 CFR §164.310(c)"],
    soc2: ["CC6.4"],
    kind: "manual",
    severity: "medium",
    remediation:
      "Enforce device encryption and screen-lock policy via MDM; document coverage for personally-owned phones running the PWA.",
  },
  {
    id: "disposal-media",
    title: "Media disposal and re-use",
    description:
      "Procedures for disposing of ePHI and the hardware it lived on, and for sanitizing media before re-use.",
    category: "Physical",
    hipaa: ["45 CFR §164.310(d)(2)(i)", "45 CFR §164.310(d)(2)(ii)"],
    soc2: ["CC6.5"],
    kind: "manual",
    severity: "medium",
    remediation:
      "Document the disposal procedure and obtain certificates of destruction from the hosting provider or disposal vendor.",
  },
];

export const CONTROL_BY_ID = new Map(CONTROLS.map((c) => [c.id, c]));
export const AUTO_CONTROL_IDS = CONTROLS.filter((c) => c.kind === "auto").map(
  (c) => c.id,
);
export const MANUAL_CONTROL_IDS = CONTROLS.filter(
  (c) => c.kind === "manual",
).map((c) => c.id);

/**
 * What this module explicitly does NOT and CANNOT establish. Rendered at the
 * top of the UI and embedded verbatim in the auditor evidence pack.
 */
export const SCOPE_AND_LIMITATIONS = {
  summary:
    "Automated results below cover TECHNICAL safeguards observable from inside the running application only. They are evidence for an audit, not an audit.",
  limitations: [
    "HIPAA has no certification. No product, including this one, can make an organization 'HIPAA certified'.",
    "SOC 2 is an attestation performed by a licensed CPA firm. This module produces evidence for that engagement; it does not replace it.",
    "Code running inside the application cannot observe the hosting environment: disk encryption, physical security, network segmentation, backup durability and TLS termination must be confirmed with the hosting provider.",
    "Signed Business Associate Agreements are legal documents. Their existence can only be attested by a human and evidenced by the countersigned contract.",
    "Risk analysis, workforce training, sanction policy, incident response and contingency planning are organizational processes. Nothing in the codebase can confirm they happened.",
    "Automated checks reflect the state of THIS running process and THIS database at the generatedAt timestamp. They say nothing about other instances, prior deployments, or the period between exports.",
    "Where a check could not reach a defensible conclusion it is reported as 'unknown' with the reason, and is never counted toward readiness.",
  ],
  readinessFormula:
    "readinessPct = round(100 × (automated controls passing + manual controls attested 'met' or 'na') ÷ total controls). Warn, fail, unknown, not_met and in_progress all count as zero. Readiness is a progress indicator, not an audit opinion.",
};
