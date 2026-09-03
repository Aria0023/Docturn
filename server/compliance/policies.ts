/**
 * DocTurn compliance monitor — POLICY STARTER PACK.
 *
 * Every control in ./controls.ts with kind: "manual" is something code cannot
 * measure. Until now the only thing the product offered for those thirteen rows
 * was an Attest button next to a blank page. This module supplies the blank
 * page's replacement: a starter document per manual control that an
 * organization can read, edit, adopt and attach as evidence.
 *
 * Two rules govern the prose below, and they are the whole reason this file is
 * worth having:
 *
 *  1. HIPAA-FIRST. Each template cites the rule it exists to satisfy (45 CFR
 *     part 164), not a generic security framework. SOC 2 criteria stay in the
 *     control catalog where they belong.
 *
 *  2. HONEST ABOUT DOCTURN. A policy that claims safeguards the software does
 *     not have is worse than no policy — it is a false statement an
 *     organization would sign. Every template therefore separates what DocTurn
 *     VERIFIABLY does today (scrypt password hashing, a 15-minute rolling idle
 *     timeout, organizationId-scoped queries, audited PHI reads, content-free
 *     push payloads) from the GAPs it does not close (no application-layer
 *     encryption at rest, attachments stored base64 inside database rows, no
 *     BAA that code can see, no backup mechanism inside the app, no automated
 *     incident detection). GAP sections are written to be closed, not signed.
 *
 * Three of these controls — risk-analysis, backup-tested and access-review —
 * are PROCESSES, not documents. Signing their page satisfies nothing. Their
 * actionRequired says what must be performed and what output must be retained.
 *
 * Structural inspiration: the idea of a per-control template library exposed as
 * metadata + a render step comes from the MIT-licensed Transilience/Shasta
 * project (platform/lambda/policies/templates.py). The structure only — all
 * prose here is original, written against OUR control ids and HIPAA rather than
 * their SOC 2 framing.
 *
 * Nothing in this file is legal advice. Every template says so in its own text.
 */

import { CONTROL_BY_ID } from "./controls.js";

export interface PolicyTemplate {
  /** Matches a manual control in controls.ts. */
  controlId: string;
  title: string;
  /** Citations, reused verbatim from the control catalog. */
  hipaa: string[];
  /** Markdown body with {placeholders}. */
  body: string;
  /** What the org must actually DO — not just sign. */
  actionRequired: string;
}

/** Metadata only — the shape the list endpoint serves. */
export interface PolicyTemplateMeta {
  controlId: string;
  title: string;
  hipaa: string[];
  actionRequired: string;
}

/** Substitutions applied at request time. */
export interface PolicyVars {
  organizationName: string;
  effectiveDate: string;
  version?: string;
  owner?: string;
}

export interface RenderedPolicy extends PolicyTemplateMeta {
  markdown: string;
}

/* ── template construction ────────────────────────────────────────────────── */

/**
 * Citations come from the catalog, never re-typed here, so a template can never
 * cite a rule the control does not. Also enforces that a template only exists
 * for a MANUAL control — policies are not a way to paper over an automated
 * check.
 */
function cites(controlId: string): string[] {
  const def = CONTROL_BY_ID.get(controlId);
  if (!def) {
    throw new Error(`policy template references unknown control: ${controlId}`);
  }
  if (def.kind !== "manual") {
    throw new Error(
      `policy template references automated control: ${controlId}`,
    );
  }
  return def.hipaa;
}

/**
 * Closing text on EVERY template. An organization that adopts one of these
 * without editing it has done the wrong thing, and the document must say so.
 */
const DISCLAIMER = `
---

## This is a template, not legal advice

This document is a STARTING DRAFT produced by DocTurn. It is not legal advice,
not a compliance certification, and not evidence of anything until
{organizationName} has done the work it describes. HIPAA has no certification
scheme; no software can make an organization compliant.

Before this document carries any weight it must be:

1. Read line by line and corrected so it describes what {organizationName}
   ACTUALLY does. Delete anything that is not true here.
2. Closed out on every section marked **GAP** — those describe things DocTurn
   does NOT do today. They are the organization's work, and they must never be
   presented to an auditor, a customer or a patient as controls already in
   place.
3. Reviewed by the Privacy Officer and the Security Officer, and by legal
   counsel where the organization's risk warrants it.
4. Approved in writing, issued with an effective date and a version, and
   distributed to the workforce members it binds.
5. Retained for six years from the later of the date of its creation or the
   date it was last in effect — 45 CFR §164.316(b)(2)(i) — along with the
   record of its approval and every subsequent revision.

Attesting to the matching control in the DocTurn compliance monitor records
that a named person asserts this work was done. It does not perform it.
`;

function tpl(
  controlId: string,
  title: string,
  actionRequired: string,
  markdown: string,
): PolicyTemplate {
  const hipaa = cites(controlId);
  return {
    controlId,
    title,
    hipaa,
    actionRequired,
    body: [
      `# ${title}`,
      "",
      "**Organization:** {organizationName}  ",
      "**Effective date:** {effectiveDate}  ·  **Version:** {version}  ·  **Policy owner:** {owner}  ",
      `**HIPAA:** ${hipaa.join("  ·  ")}  `,
      "",
      `> **WHAT MUST ACTUALLY HAPPEN:** ${actionRequired}`,
      "",
      markdown.trim(),
      "",
      DISCLAIMER.trim(),
      "",
    ].join("\n"),
  };
}

/* ── the pack ─────────────────────────────────────────────────────────────── */

export const POLICY_TEMPLATES: PolicyTemplate[] = [
  /* ───────────────────────────── Vendor & contracts ─────────────────────── */
  tpl(
    "baa-hosting",
    "Business Associate Agreement — Hosting Provider",
    "Obtain a countersigned BAA from the company that runs the compute for this deployment BEFORE any real patient data is entered, and attach the executed PDF (with its effective date) as evidence. A policy describing BAAs is not a BAA.",
    `
## 1. Purpose

45 CFR §164.308(b)(1) allows {organizationName} to disclose ePHI to a business
associate only after obtaining satisfactory assurances, documented in a written
contract meeting §164.314(a), that the business associate will safeguard it.
Whoever runs the servers DocTurn executes on can read the memory and the disk
those servers hold. They are a business associate. This policy governs how
{organizationName} identifies, contracts with and re-reviews them.

## 2. Scope

Every vendor that stores, processes, transmits or could incidentally access
ePHI on behalf of {organizationName}, including at minimum:

- the compute/hosting provider running the DocTurn server process;
- the managed database and backup provider (covered separately under the
  baa-database policy);
- log aggregation, error tracking or APM services, if any are attached — these
  routinely capture request paths and payload fragments;
- SMS and push transports (covered separately under the baa-push-vendor policy);
- any external AI or NLP service, if the AI_EXTERNAL_PHI_OK gate is ever
  enabled — it is OFF by default and must stay off until a BAA exists;
- contractors and staff augmentation with production access.

Conduit-only carriers (an ISP moving encrypted packets) are excluded under the
conduit exception. A vendor that stores data, even briefly, is not a conduit.

## 3. What DocTurn can and cannot tell you

DocTurn re-computes technical controls from live system state on every load. It
CANNOT see a contract. The baa-hosting control will read "Needs human" forever
until someone attests to it, and that is correct behavior, not a defect.

**GAP — verify before relying on this document.** DocTurn's default deployment
persists to an in-process PGlite store on the host filesystem, and the pilot
deployment this policy ships with has no BAA on file with its host. Until a
countersigned BAA exists, this instance must remain in synthetic-data mode
(SYNTHETIC_DATA unset or not equal to "false") and must not receive real
patient information.

## 4. Required terms

No BAA is accepted unless it contains all of the following:

1. Permitted uses and disclosures, limited to what the service requires
   (§164.504(e)(2)).
2. A commitment to implement the Security Rule administrative, physical and
   technical safeguards for ePHI (§164.314(a)(2)(i)(A)).
3. Flow-down: subcontractors that create, receive, maintain or transmit ePHI
   are bound to the same restrictions (§164.308(b)(2), §164.314(a)(2)(iii)).
4. Security incident and breach reporting to {organizationName}, with a stated
   maximum number of calendar days that fits inside the 60-day individual
   notification deadline of §164.404(b) — 10 days or fewer is the norm.
5. Return or destruction of ePHI at termination, or a written explanation of
   why return or destruction is infeasible (§164.504(e)(2)(ii)(J)).
6. Availability of books and records to the Secretary of HHS.
7. Named security contact and a support channel that is reachable during an
   incident.

## 5. Rules

- No production instance handling real ePHI runs on infrastructure without a
  countersigned BAA in effect. No exceptions, no verbal assurances, no "the
  enterprise plan includes HIPAA" claim without the signed document.
- A vendor's marketing page saying "HIPAA compliant" is not a BAA and is not
  evidence. Only the countersigned contract is.
- The Security Officer maintains a vendor register recording, for each vendor:
  service, what ePHI it can reach, BAA effective date, renewal or review date,
  and the file location of the executed contract.
- Adding a vendor that can reach ePHI requires Security Officer approval BEFORE
  the integration ships.
- Terminating a vendor triggers the return/destruction clause, and the
  certificate or written confirmation is filed with the BAA.

## 6. Responsibilities

| Role | Duty |
| --- | --- |
| {owner} | Owns this policy, the vendor register and the annual review. |
| Security Officer | Approves new vendors; verifies required terms are present. |
| Privacy Officer | Confirms the permitted-use language matches actual practice. |
| Engineering | Does not deploy to, or send data to, an unapproved vendor. |

## 7. Evidence to retain

- The countersigned BAA (PDF), attached to the baa-hosting control.
- The vendor register extract showing effective and review dates.
- Any subcontractor list the vendor provides.

## 8. Review

Reviewed at least annually, and immediately on any change of hosting provider,
plan tier, region, or on notice of a vendor breach.
`,
  ),

  tpl(
    "baa-database",
    "Business Associate Agreement — Database, Storage and Backups",
    "Execute a BAA with the managed-database and backup provider, and get in WRITING that encryption at rest is enabled, what the backup retention window is, and where backups are stored geographically. Attach the BAA plus that written confirmation.",
    `
## 1. Purpose

The database is where ePHI comes to rest, and backups are copies of it that
outlive every deletion {organizationName} performs. §164.308(b)(1) and
§164.314(a) require a written agreement with whoever holds those copies;
§164.312(a)(2)(iv) makes encryption of ePHI at rest an addressable
implementation specification, which means it is implemented or the decision not
to is documented and justified in the risk analysis.

## 2. Scope

The primary database, read replicas, snapshots, point-in-time recovery
archives, exported dumps, and any object storage that ever holds an attachment
or an export. Every copy is in scope. A backup nobody remembers is still a
disclosure risk.

## 3. What DocTurn does today — verified

- All persistence goes through one storage layer, and every query is scoped by
  the organizationId taken from the caller's session, never from client input.
  The tenant-isolation control probes this live against a second seeded tenant.
- Message retention is enforceable per organization: when
  messageRetentionDays is set, an hourly sweep hard-deletes messages older than
  the window and audits the count.
- Audit records are never deleted by application code, which is what makes the
  six-year retention requirement of §164.316(b)(2)(i) achievable at all.

## 4. GAP — what DocTurn does NOT do

- **No application-layer encryption at rest.** DocTurn does not encrypt column
  values or files before writing them. Whatever protection exists is provided
  by the storage tier, and code running inside the app cannot observe it. The
  encryption-at-rest control therefore never reports a pass on its own.
- **Attachments are stored base64-encoded inside the database row.** There is
  no object storage, no antivirus scanning on upload, and no signed-URL
  delivery. Attachment bytes are inside every database backup, which inflates
  backup size and widens the blast radius of a leaked dump.
- **The default development database is an in-process PGlite store** in a local
  directory. It has no encryption, no backups, no replication, and no BAA. It
  is fit for synthetic data only.

Each of these must be recorded in the risk analysis with either a remediation
plan and date, or a documented, justified acceptance.

## 5. Rules

- Real ePHI is stored only in a managed database covered by a countersigned
  BAA with encryption at rest enabled and confirmed in writing by the provider.
- Backups inherit the classification of their source. A backup of a database
  containing ePHI is ePHI, and it lives under the same BAA, the same encryption
  requirement and the same access restrictions.
- Production database credentials are held in the hosting environment's secret
  store and are never committed, pasted into a ticket, or shared over chat.
- Database exports for debugging are prohibited unless the data is synthetic or
  the export is de-identified under §164.514. If an export of real data is
  unavoidable, it is approved by the Security Officer in advance, encrypted,
  time-boxed and destroyed on a recorded date.
- Restore capability is proven, not assumed — see the backup-tested control,
  which requires an actual drill.

## 6. Written confirmations to obtain from the provider

1. Encryption at rest: enabled, and the algorithm or key-management model used.
2. Encryption in transit to the database, and whether TLS is enforced.
3. Backup frequency, retention window, and destruction schedule.
4. Geographic location(s) of primary and backup storage.
5. Whether provider staff can read customer data, and under what controls.
6. Incident notification commitment and contact.

## 7. Evidence to retain

The countersigned BAA, the provider's written answers to section 6, and the
current configuration screenshot or API output showing encryption at rest is
on. Attach all three to the baa-database control.

## 8. Review

Annually, and on any change of provider, plan, region or backup configuration.
`,
  ),

  tpl(
    "baa-push-vendor",
    "Push and SMS Notification Policy — Vendor Coverage or Content-Free Payloads",
    "Pick one and prove it: either sign a BAA with each push/SMS vendor in use, or verify and document that no payload can carry patient-identifying content — which today requires closing the free-text SMS gap described in section 4. Attach either the BAA or the written verification.",
    `
## 1. Purpose

Push notifications and SMS leave {organizationName}'s infrastructure and pass
through vendors that can read them. §164.308(b)(1) requires a BAA with any
vendor handling ePHI; §164.312(e)(1) requires protection of ePHI in transit.
The alternative to a BAA is proving the vendor never receives ePHI — which is a
technical claim that must be verified in the code, not assumed.

## 2. Scope

Web Push endpoints, the Expo push service used by the native client, and the
SMS carrier adapter configured per organization (a console stub when no
credentials are present, a live carrier otherwise).

## 3. What DocTurn does today — verified

- **Push payloads are content-free by construction.** The push service sends a
  generic title only — no message body, no patient name or initials, no room
  number, no sender identity. The device is told that something needs
  attention; the clinician must open the authenticated app to learn what.
- **Automated SMS bodies are fixed, generic strings.** The STAT escalation
  fallback and the assignment escalation send wording like "Urgent DocTurn
  message needs your acknowledgement — open the app". No clinical content, no
  patient identifier.
- The mobile PWA's service worker caches static app-shell assets only; API
  responses, which do carry PHI, are never written into the cache.

## 4. GAP — the free-text hole

- **POST /api/sms/send accepts operator-typed free text** (up to 255
  characters) from a director or developer and hands it to the carrier
  verbatim, then stores the body in SMS history. Nothing in the code prevents a
  human from typing a patient name into it. A content-free claim is therefore
  true of the AUTOMATED paths only, and cannot be made about the product as a
  whole until this endpoint is restricted, templated, or removed.
- **Phone numbers are themselves identifiers** under §164.514(b)(2). A vendor
  receiving a clinician's mobile number is not receiving PHI about a patient,
  but the association of a number with an urgent clinical alert is a
  disclosure worth reasoning about explicitly in the risk analysis.
- Push subscription endpoints and device tokens are stored in the database and
  are not treated as secrets by the application.

## 5. Rules

- Free-text SMS is used for operational coordination only. Patient names,
  initials, room numbers, diagnoses, dates of service and any other identifier
  are prohibited in an SMS body. Workforce training covers this explicitly and
  the sanction policy applies to violations.
- Notification payload changes are reviewed for content leakage before release.
  Adding a message preview to a push payload is a policy change, not a UX
  change, and requires Security Officer approval.
- If a vendor BAA is obtained, record it in the vendor register and this
  section may be relaxed to the terms of that BAA — but the content-free
  default is retained anyway, because a phone on a train table is read by
  whoever is sitting opposite.
- SMS history retention follows the message retention policy of the
  organization; bodies stored there are subject to the same access controls.

## 6. Verification procedure (repeat when notification code changes)

1. Inspect the push service and confirm the payload object carries a title
   only.
2. Inspect every automated SMS call site and confirm each body is a fixed
   string literal with no interpolation of patient data.
3. Confirm the SMS free-text endpoint is restricted to the intended roles and
   that its use is audited.
4. Record the date, the reviewer and the commit reviewed.

## 7. Evidence to retain

The countersigned vendor BAA if one exists, and the dated verification record
from section 6 naming the reviewer and the commit.

## 8. Review

Annually, on any change to notification payloads, and on any change of carrier.
`,
  ),

  /* ───────────────────────────── Administrative ─────────────────────────── */
  tpl(
    "risk-analysis",
    "Security Risk Analysis — Scope, Method and Schedule",
    "PERFORM the risk analysis; do not sign this page. Use the free HHS/ONC Security Risk Assessment (SRA) Tool from HealthIT.gov, or an equivalent documented method, covering every system that creates, receives, maintains or transmits ePHI. Attach the completed SRA Tool output (or equivalent report) and the resulting risk-management plan as evidence, with the date it was performed and who performed it.",
    `
## 1. This control is a process, not a document

45 CFR §164.308(a)(1)(ii)(A) is a REQUIRED implementation specification, not an
addressable one: {organizationName} must conduct "an accurate and thorough
assessment of the potential risks and vulnerabilities to the confidentiality,
integrity, and availability of electronic protected health information held by
the covered entity." Its absence is the single most common finding in OCR
enforcement actions, and it is the first document an investigator asks for.

Signing this template satisfies nothing. This page describes HOW the analysis
will be run; the deliverable is the completed analysis itself.

## 2. Method

Use the **HHS/ONC Security Risk Assessment (SRA) Tool**, published free by the
Office of the National Coordinator and the HHS Office for Civil Rights, and
available from HealthIT.gov. It is a downloadable Windows application (with an
Excel-based alternative) that walks the assessment section by section and
produces a report. NIST SP 800-30 is an acceptable alternative method. Whatever
is used, the method is recorded so the analysis can be repeated consistently.

## 3. Scope — the ePHI inventory

The analysis is invalid if it does not cover everything. Enumerate at minimum:

- the DocTurn application server and its database, including backups and
  snapshots;
- message attachments, which are stored base64-encoded inside database rows;
- the audit and PHI-access trails (they reference patient records);
- the mobile PWA served at /m and the native client, and the personal devices
  they run on;
- push and SMS transports and their vendors;
- the AI intake extractor, and whether the external-vendor gate is enabled;
- workstations and displays in clinical areas that render the patient board;
- any export produced from the system, including the compliance evidence pack;
- every person and vendor with credentials that can reach the above.

## 4. Known risks to seed the analysis (from DocTurn's own controls)

These are already established from live system state and must appear in the
analysis with a decision recorded against each:

- No application-layer encryption at rest; protection depends entirely on the
  storage tier — §164.312(a)(2)(iv).
- Attachments stored base64 in the database, with no antivirus scanning and no
  signed-URL delivery.
- Multi-factor authentication is available but not enforced; enrollment is
  currently below full coverage of privileged accounts — §164.312(d).
- Login rate limiting can be disabled by environment variable, and a deployment
  running with it off has no brute-force protection —
  §164.308(a)(5)(ii)(C).
- No last-login field exists; dormant-account detection is inferred from the
  audit trail only — §164.308(a)(3)(ii)(C).
- TLS termination, disk encryption, physical security and backup durability all
  sit outside the application and can only be confirmed with the hosting
  provider.

## 5. Steps

1. Complete the ePHI inventory (section 3) and record data flows.
2. Identify threats and vulnerabilities for each asset — including the known
   items in section 4.
3. Assess current security measures.
4. Determine likelihood and impact, and assign a risk level to each finding.
5. Document the results, with the date and the names of the people who
   performed the analysis.
6. Produce a **risk-management plan** under §164.308(a)(1)(ii)(B): for each
   finding, the remediation, the owner and the target date — or a documented,
   justified acceptance signed by the Security Officer.
7. Track the plan to completion and re-verify at the next cycle.

## 6. Frequency

At least annually, and additionally on any material change: new hosting
provider, new integration touching ePHI, a security incident, a significant
architectural change, or the transition from synthetic data to real PHI. That
transition specifically requires a fresh analysis BEFORE the first real patient
record is entered.

## 7. Evidence to retain

The completed SRA Tool output or equivalent report; the risk-management plan
with owners and dates; evidence of remediation for closed findings; and the
retained prior versions, which show the analysis is a recurring practice rather
than a one-off.
`,
  ),

  tpl(
    "workforce-training",
    "Workforce Security Awareness and Training Policy",
    "Deliver the training and keep the roster. Every workforce member with access completes training before their account is enabled and at least annually after that; retain the dated, signed (or system-recorded) attendance roster and attach it as evidence.",
    `
## 1. Purpose

§164.308(a)(5)(i) requires a security awareness and training program for all
workforce members, including management. §164.530(b) requires training on the
Privacy Rule policies relevant to each person's function. Training that
happened but was not recorded cannot be evidenced, so the roster matters as
much as the session.

## 2. Scope

Every workforce member with a DocTurn account or access to ePHI: employed
clinicians, contracted and locum clinicians, directors, administrative staff,
engineers with production access, and third parties whose contract places them
inside the workforce definition.

## 3. Timing

- **Before access.** Training is completed before the account is enabled, not
  in the first month after.
- **Annually.** A refresh every twelve months.
- **On change.** When a policy materially changes, when a new system handling
  ePHI is introduced, or following an incident whose root cause was behavioral.
- **Periodic reminders.** §164.308(a)(5)(ii)(A) — short, regular security
  updates, not a single annual event.

## 4. Required content

General HIPAA content, plus these DocTurn-specific items, which exist because
of how this system actually behaves:

1. **Minimum necessary.** The patient board shows initials and room number
   rather than full names by design. Do not defeat that by adding identifying
   detail to free-text fields.
2. **Sessions expire after 15 minutes of inactivity** and the session cookie is
   HTTP-only. Log out on shared workstations anyway; the timeout is a backstop,
   not a substitute.
3. **Push notifications are deliberately content-free** — a generic title only.
   That is a safeguard. Do not request or build message previews.
4. **Never type patient information into an SMS.** The free-text SMS send
   accepts anything a director types and hands it to a carrier that may have no
   BAA.
5. **Every patient record read is logged** with the user, the record and the
   time. Access is for treatment, payment or operations only. Curiosity about a
   colleague, a relative or a public figure is a sanctionable violation and is
   detectable after the fact.
6. **Attachments are permanent within retention.** Photographs of documents or
   screens carry more than intended — do not attach what is not clinically
   necessary.
7. **Personal devices.** The PWA runs on personal phones. Device passcode,
   automatic lock and device encryption are required; see the
   workstation-security policy.
8. **Report immediately.** Lost device, shared password, suspected phishing,
   or a message sent to the wrong recipient goes to the Security Officer the
   same day. Good-faith reporting is never penalized.
9. **Password practice.** Credentials are stored using scrypt with a per-user
   random salt and are never recoverable — a forgotten password is reset, never
   looked up. Passwords are never shared and never reused from another service.
10. **MFA.** Enrol a TOTP authenticator from Settings; privileged accounts are
    required to.

## 5. GAP

DocTurn has no training-delivery or training-tracking module. Content,
delivery and the roster live outside the application, and the compliance
monitor can only record that someone attests the training happened. Keep the
roster in the document repository named in the policies-approved policy.

## 6. Evidence to retain

Dated attendance roster naming each attendee and their role; the training
content or deck version used; the quiz or acknowledgement records if used; and
the list of workforce members whose training is overdue, with the remediation.
Retain six years — §164.316(b)(2)(i).

## 7. Responsibilities

{owner} maintains the curriculum and the schedule. Managers ensure their people
attend. HR withholds or disables access for anyone overdue. The Security
Officer reviews completion rates quarterly.

## 8. Review

Annually, and after any incident with a behavioral root cause.
`,
  ),

  tpl(
    "policies-approved",
    "HIPAA Policy Set — Approval, Versioning and Retention",
    "Approve the policy set in writing, record the approval date and approver for each document, store the approved versions in a named repository, and keep every superseded version for six years. Attach the approval record and the repository location.",
    `
## 1. Purpose

§164.316(a) requires reasonable and appropriate policies and procedures to be
implemented; §164.316(b)(1) requires them to be maintained in writing;
§164.316(b)(2)(i) requires six-year retention from the later of creation or
last effective date; §164.316(b)(2)(ii) requires them to be available to those
responsible for implementing them; and §164.316(b)(2)(iii) requires periodic
review and update in response to environmental or operational change.

This is the policy that governs the other policies.

## 2. The policy set

At minimum, {organizationName} maintains and approves:

| Policy | Rule |
| --- | --- |
| Security Risk Analysis (method and schedule) | §164.308(a)(1)(ii)(A) |
| Risk Management Plan | §164.308(a)(1)(ii)(B) |
| Workforce Sanction Policy | §164.308(a)(1)(ii)(C) |
| Information System Activity Review | §164.308(a)(1)(ii)(D) |
| Workforce Security / Authorization and Termination | §164.308(a)(3) |
| Information Access Management and Access Review | §164.308(a)(4) |
| Security Awareness and Training | §164.308(a)(5) |
| Security Incident Response and Breach Notification | §164.308(a)(6), §164.400-414 |
| Contingency Plan (backup, DR, emergency mode) | §164.308(a)(7) |
| Business Associate Agreements and vendor management | §164.308(b), §164.314(a) |
| Facility and Workstation Security | §164.310(a)-(c) |
| Device and Media Controls / Disposal | §164.310(d) |
| Access Control, Audit Controls, Integrity, Transmission Security | §164.312 |
| Notice of Privacy Practices and individual rights | §164.520, §164.524, §164.526 |

## 3. Approval

- Each policy names an owner and is approved by the Security Officer, the
  Privacy Officer, or both where the subject spans Privacy and Security.
- Approval is recorded in writing with the approver's name, role, the version
  approved and the date. An unsigned draft is not a policy.
- The effective date is stated on the document itself.

## 4. Versioning and change control

- Semantic versions: 1.0 for the first approved issue; the minor number
  increments for clarifications; the major number for a substantive change of
  obligation.
- Every change records what changed, why, who approved it and when.
- Superseded versions are archived, never overwritten — retention runs from the
  date a version stopped being in effect.

## 5. Distribution

Approved policies are available to every workforce member bound by them,
without asking permission to see them. New hires acknowledge the set during
onboarding; the acknowledgement is filed with the training roster.

## 6. Review triggers

Annually at minimum, plus on: a change of hosting or database provider; a new
integration that touches ePHI; a security incident or breach; the move from
synthetic data to real PHI; a regulatory change; or a finding from a risk
analysis or audit.

## 7. GAP

DocTurn is not a document management system. It does not store, version or
approve policy documents; the starter drafts it generates are drafts only, and
attesting the policies-approved control records a human assertion that approval
happened elsewhere. Name that repository here, and make sure it has version
history and six-year retention:

**Policy repository location:** _____________________________________

## 8. Evidence to retain

The approval record for each policy; the current approved version of each; the
archive of superseded versions; and the workforce acknowledgement records.
`,
  ),

  tpl(
    "incident-response-plan",
    "Security Incident Response and Breach Notification Plan",
    "Write this plan against your real staffing, name the on-call responder and their contact details, then run a tabletop exercise and record the date and participants. An untested plan and an unnamed responder are the two ways this fails in practice.",
    `
## 1. Purpose

§164.308(a)(6)(i) requires implementation of policies and procedures to address
security incidents. §164.308(a)(6)(ii) requires {organizationName} to identify
and respond to suspected or known incidents, mitigate their harmful effects to
the extent practicable, and document the incident and its outcome. Subpart D
(§164.400-414) governs breach notification.

## 2. Definitions

- **Security incident** — §164.304: the attempted or successful unauthorized
  access, use, disclosure, modification or destruction of information, or
  interference with system operations. Attempts count.
- **Breach** — §164.402: acquisition, access, use or disclosure of PHI not
  permitted by the Privacy Rule, which is PRESUMED to be a breach unless
  {organizationName} demonstrates a low probability of compromise through the
  four-factor risk assessment in §164.402(2).

## 3. Roles

| Role | Name / contact | Duty |
| --- | --- | --- |
| Security Officer | {owner} | Owns the response; declares an incident. |
| Privacy Officer | | Owns the breach determination and notifications. |
| On-call technical responder | | First response, containment, evidence capture. |
| Executive sponsor | | Authorizes downtime, external help, disclosure. |
| Legal counsel | | Reviews breach determination and notice wording. |

Fill in every blank in this table before adopting the plan. An unnamed role is
an unassigned role.

## 4. Detection sources available in DocTurn

- The audit trail: every meaningful action is recorded with an actor, an action
  and a risk level. The compliance screen surfaces recent entries.
- The PHI access log: reads and writes of patient records, with the user, the
  record identifier, the HTTP method, IP and user agent.
- The compliance monitor: control statuses computed live, where a control that
  was passing and is now failing is itself a signal.

**GAP — nothing watches these for you.** DocTurn has no automated alerting, no
anomaly detection and no incident intake screen. The codebase contains a
logSecurityIncident helper in server/audit.ts, but nothing calls it, and the
security_incidents table is never written to by application code. Detection
today is a human reading the audit trail on a schedule. Until that changes,
this plan MUST specify who reviews the audit trail and how often —
§164.308(a)(1)(ii)(D) requires that review regardless.

**Audit review cadence:** _______________  **Reviewer:** _______________

## 5. Response steps

1. **Report.** Anyone who suspects an incident notifies the Security Officer
   immediately — same day, no triage by the reporter, no penalty for a false
   alarm.
2. **Record.** Open a numbered incident record: who reported it, when, what was
   observed. Record facts and identifiers, not clinical narrative.
3. **Triage.** Classify severity and decide whether ePHI was or may have been
   involved.
4. **Contain.** Options available in this system:
   - deactivate or downgrade the affected account;
   - force a password reset for the affected user;
   - rotate SESSION_SECRET and restart, which invalidates every existing
     session across the deployment;
   - rotate database and vendor credentials;
   - remove the affected push subscriptions or device tokens;
   - block at the network or hosting layer with the provider.
5. **Preserve evidence.** Export the audit and PHI-access history for the
   window before any cleanup. Note that a tenant deletion retains the audit and
   PHI-access history by design — do not destroy it.
6. **Eradicate and recover.** Fix the root cause, verify with the compliance
   monitor, restore service.
7. **Assess for breach.** Apply the four factors of §164.402(2): the nature and
   extent of the PHI involved; the unauthorized person who used it or to whom
   it was disclosed; whether the PHI was actually acquired or viewed; and the
   extent to which the risk has been mitigated. Document the conclusion either
   way — a "not a breach" determination requires the same written analysis as a
   breach.
8. **Notify** per section 6.
9. **Close.** Root-cause write-up, corrective actions with owners and dates,
   and any policy or training change that follows.

## 6. Notification timelines

- **Individuals** — §164.404: without unreasonable delay and no later than 60
  calendar days after discovery.
- **HHS Secretary, 500 or more individuals** — §164.408(b): contemporaneously
  with individual notice, no later than 60 days after discovery.
- **HHS Secretary, fewer than 500** — §164.408(c): logged and submitted within
  60 days after the end of the calendar year in which the breach was
  discovered.
- **Prominent media** — §164.406: for more than 500 residents of a state or
  jurisdiction, without unreasonable delay and within 60 days.
- **Business associate to covered entity** — §164.410: without unreasonable
  delay and within 60 days of discovery. If {organizationName} acts as a
  business associate, this is the applicable clock, and the BAA's own — usually
  shorter — deadline governs.

Discovery is the first day the incident is known, or by exercising reasonable
diligence would have been known, to anyone in the workforce other than the
person who committed the breach.

## 7. Testing

Run a tabletop exercise at least annually. A realistic scenario for this
system: a director's credentials are phished and used from an unfamiliar IP to
open twenty patient threads over one night shift. Walk the whole path —
detection from the PHI access log, containment, the four-factor assessment,
notification decision. Record the date, the participants, what failed and what
was changed as a result.

## 8. Evidence to retain

The approved plan; the incident register; per-incident records including the
breach determination; notification copies and dates; and the dated tabletop
records. Six years — §164.316(b)(2)(i).
`,
  ),

  tpl(
    "contingency-plan",
    "Contingency Plan — Data Backup, Disaster Recovery and Emergency Mode",
    "Define and write down the actual RTO and RPO, confirm in writing what backups the hosting/database provider takes and how long they are kept, and document how clinicians route patients if DocTurn is unavailable. Then prove restore works under the backup-tested control.",
    `
## 1. Purpose

§164.308(a)(7)(i) requires a contingency plan for responding to an emergency or
other occurrence that damages systems containing ePHI. It has five parts:
data backup plan (ii)(A) — required; disaster recovery plan (ii)(B) —
required; emergency mode operation plan (ii)(C) — required; testing and
revision (ii)(D) — addressable; and applications and data criticality analysis
(ii)(E) — addressable.

DocTurn routes clinical assignments and STAT messages. Its unavailability is a
patient-safety event before it is an IT event, which is why the emergency-mode
section matters more here than the recovery-time target.

## 2. Criticality analysis — §164.308(a)(7)(ii)(E)

| Function | Criticality | Consequence of loss |
| --- | --- | --- |
| STAT messaging and escalation | Critical | Urgent clinical communication stops |
| Assignment routing / on-call lookup | Critical | Nobody knows who is covering |
| Patient board | High | Loss of shared situational awareness |
| Audit and PHI-access trail | High | Compliance evidence gap; incident blindness |
| Reports and metrics | Low | Deferred |

## 3. Data backup plan — §164.308(a)(7)(ii)(A)

**GAP — DocTurn has no backup mechanism of its own.** The application does not
schedule, take, encrypt, ship or verify backups. Backups exist only if the
hosting or managed-database tier provides them, and the default development
store is an in-process PGlite directory on local disk with no backup at all.

Record the truth for this deployment:

- Backup mechanism and provider: _______________
- Frequency: _______________
- Retention window: _______________
- Storage location and region: _______________
- Encrypted at rest: yes / no — _______________
- Covered by a BAA: yes / no — _______________
- Includes attachments: yes, because attachment bytes live base64-encoded
  inside message rows and therefore inside the database backup.

## 4. Recovery objectives

- **RPO** (maximum tolerable data loss): _______________
- **RTO** (maximum tolerable downtime): _______________

These are decisions, not defaults. Set them against the criticality table
above and against what the provider's backup frequency can actually deliver —
an RPO of one hour is fiction if backups run nightly.

## 5. Disaster recovery plan — §164.308(a)(7)(ii)(B)

1. Declare the disaster; notify the executive sponsor and clinical leadership.
2. Activate emergency mode (section 6) immediately, in parallel with recovery —
   do not wait to see whether recovery is quick.
3. Provision replacement infrastructure; confirm the BAA covers it.
4. Restore the most recent verified backup; record its timestamp so data loss
   is quantified rather than guessed.
5. Verify integrity before reopening: user and patient counts, recent
   assignments, message continuity, audit-trail continuity.
6. Restore service, notify the workforce, and reconcile anything handled on
   paper during the outage.
7. Write up the timeline, actual RTO/RPO achieved, and corrective actions.

## 6. Emergency mode operation plan — §164.308(a)(7)(ii)(C)

How care continues while DocTurn is down. This is the section most often left
blank and the one clinicians will actually need.

- **Current on-call roster is available offline.** Print or export the roster
  at the start of each shift block, or keep the paper call schedule current.
  Without DocTurn, nobody can look up who is covering.
- **Fallback communication channel:** _______________ (hospital paging,
  switchboard, direct phone). Named, tested, and known to every clinician.
- **Assignment handoff on paper:** who records new admissions and assignments
  during the outage, and on what form.
- **PHI on paper is still PHI.** Paper used in emergency mode is secured
  during the outage and destroyed under the disposal-media policy once
  reconciled.
- **Reconciliation:** who enters the paper record back into DocTurn, and by
  when.

Security controls are not suspended in emergency mode. §164.312(a)(2)(ii) also
requires an emergency ACCESS procedure — a documented way for an authorized
clinician to obtain necessary ePHI when normal access paths fail. Record it
here: _______________

## 7. Testing and revision — §164.308(a)(7)(ii)(D)

- Restore drill: at least annually, under the backup-tested control, with a
  dated record.
- Emergency-mode walkthrough: at least annually with clinical staff.
- Revise this plan after every test and every real outage.

## 8. Evidence to retain

The approved plan with sections 3, 4 and 6 fully filled in; the provider's
written backup confirmation; dated restore-drill and walkthrough records; and
post-incident reviews of any real outage.
`,
  ),

  tpl(
    "backup-tested",
    "Backup Restore Test — Procedure and Record",
    "PERFORM a restore drill; do not sign this page. Restore a real backup into an isolated scratch environment, verify the checks in section 4, and record the backup timestamp, the elapsed restore time, the verification results and the operator's name. Attach that completed record as evidence, then destroy the scratch environment.",
    `
## 1. This control is a process, not a document

§164.308(a)(7)(ii)(D) requires periodic testing and revision of contingency
procedures. An untested backup is a belief, not a control. Organizations
discover their backups were empty, encrypted with a lost key, or missing a
critical table only when they try to restore under pressure. This procedure
exists so that discovery happens on a scheduled Tuesday instead.

## 2. Frequency

At least annually. Additionally after: a change of database provider or plan; a
schema migration of consequence; a change to backup configuration or retention;
and before the transition from synthetic data to real PHI.

## 3. Procedure

1. **Record the source.** Note which backup is being restored and its
   timestamp. Prefer a backup that is a few days old — restoring the newest one
   proves less about the retention window.
2. **Provision an isolated scratch environment.** Separate database, separate
   credentials, no production secrets, no inbound access from clinical users,
   and no push or SMS credentials configured so no notification can escape.
3. **Start the clock.** The elapsed time from here to a verified system is the
   measured RTO. Compare it against the RTO written in the contingency plan and
   correct whichever is wrong.
4. **Restore** the backup into the scratch database.
5. **Point a non-production DocTurn instance at it** (DATABASE_URL to the
   scratch database) and start the process.
6. **Verify** per section 4.
7. **Stop the clock** and record the elapsed time.
8. **Destroy the scratch environment**, including the restored database and any
   local files, under the disposal-media policy. A forgotten scratch copy of
   production ePHI is a breach waiting to happen. Record the destruction date.

## 4. Verification checklist

Restoring without verifying proves nothing. All of the following, recorded with
actual numbers:

- [ ] Row counts for organizations, users, patients, assignments and messages
      are consistent with production at the backup timestamp.
- [ ] A login succeeds with a known test credential against the restored data.
- [ ] The patient board renders and shows expected records for one
      organization.
- [ ] A message thread opens and its attachment downloads and is intact —
      attachments are stored base64 inside the message row, so a truncated
      column shows up here and nowhere else.
- [ ] The audit trail is present and its oldest record is as old as expected;
      six-year retention under §164.316(b)(2)(i) depends on backups actually
      containing history.
- [ ] The PHI-access history is present.
- [ ] Tenant isolation still holds: a user of one organization sees no rows
      belonging to another. The compliance monitor's tenant-isolation control
      can be run against the restored instance to check this.

## 5. Record to complete and retain

| Field | Value |
| --- | --- |
| Drill date | |
| Operator | |
| Backup timestamp restored | |
| Backup source / provider | |
| Restore start / finish, elapsed | |
| Verification results (section 4) | |
| Issues found | |
| Corrective actions and owners | |
| Scratch environment destroyed on | |

A drill that fails is a successful drill — it found the problem before the
outage did. Record the failure, fix it, and repeat the drill.

## 6. Evidence to retain

The completed record above for each drill, retained six years, attached to the
backup-tested control.
`,
  ),

  tpl(
    "access-review",
    "Periodic Access Review — Procedure and Record",
    "PERFORM the review; do not sign this page. Each quarter, walk the full user roster with the responsible manager, decide keep / downgrade / disable for every account, ACT on the decisions the same day, and record the reviewer, the date and each decision. Attach the completed roster with decisions as evidence.",
    `
## 1. This control is a process, not a document

§164.308(a)(4)(ii)(C) requires review and modification of a user's right of
access; §164.308(a)(3)(ii)(B) requires that access be appropriate to the role;
§164.308(a)(3)(ii)(C) requires termination procedures when employment or the
role ends; and §164.308(a)(1)(ii)(D) requires regular review of information
system activity. Access accumulates silently — people change roles, cover a
service for a month, leave — and only a periodic review reverses the drift.

Signing this page changes nobody's access. Running the review does.

## 2. Frequency

- Full roster review: quarterly.
- Privileged accounts (developer, director, ER director): quarterly at minimum,
  monthly where the count is small enough to make it cheap.
- Event-driven, within one business day: termination, role change, department
  transfer, end of a locum or contract engagement, or any suspected credential
  compromise.

## 3. Inputs available in DocTurn

- The user roster for the organization, with roles.
- The **privileged-accounts** control: the live count of developer, director
  and ER-director accounts against the total roster.
- The **stale-accounts** control: accounts with no audited activity in 90 days.
- The audit trail and PHI-access history for the period under review.

## 4. GAP — what DocTurn does not give you

- **There is no last-login field.** Dormancy is inferred from the audit trail,
  which is the only genuine signal available, and it under-reports for users
  who read but never act. Treat "no audited activity" as a prompt to ask the
  manager, not as proof of dormancy.
- **There is no automated deprovisioning** and no HR-system integration. A
  termination removes access only when a human disables the account.
- **There is no access-request workflow.** Grants happen by direct role
  assignment, so the review is the only compensating control.

## 5. Procedure

1. Export or open the roster for {organizationName}.
2. For each account record: name, role, department, manager, date of last
   audited activity, and whether MFA is enrolled.
3. With the responsible manager, decide for each account: **keep**,
   **downgrade** (role exceeds the job), or **disable** (left, or no longer
   needs access).
4. Justify every privileged account individually. Least privilege means an
   administrative role is the exception and can be explained in one sentence.
5. **Act on the decisions the same day.** A review that produces a list nobody
   executes is worse than no review, because it documents known excess access
   that was left in place.
6. Confirm the actions took effect by re-reading the roster.
7. Spot-check the PHI-access history for the period: a sample of reads,
   confirming each has a plausible treatment, payment or operations basis.
   Anything unexplained goes to the incident-response process.
8. Record the review per section 6.

## 6. Record to complete and retain

| Field | Value |
| --- | --- |
| Review period | |
| Reviewer(s) and role | |
| Date performed | |
| Accounts reviewed (count) | |
| Kept / downgraded / disabled | |
| Privileged accounts and justification | |
| Accounts with no activity in 90 days, and disposition | |
| MFA enrollment gaps and remediation date | |
| PHI-access spot check: sample size and findings | |
| Actions completed on | |

## 7. Evidence to retain

The completed record and the roster with per-account decisions, for each
quarter, retained six years — §164.316(b)(2)(i).
`,
  ),

  tpl(
    "sanction-policy",
    "Workforce Sanction Policy",
    "Adopt the policy jointly with HR, make sure it is actually applied and documented when a violation occurs, and confirm that every workforce member has acknowledged it during training. An unenforced sanction policy is a finding, not a control.",
    `
## 1. Purpose

§164.308(a)(1)(ii)(C) requires {organizationName} to "apply appropriate
sanctions against workforce members who fail to comply with the security
policies and procedures." §164.530(e) imposes the parallel Privacy Rule
requirement. The word is APPLY: the existence of a sanction schedule is not
the control; applying it and documenting the application is.

## 2. Scope

Every workforce member — employed, contracted, locum, volunteer, and
engineering staff with production access — bound by {organizationName}'s HIPAA
policies.

## 3. What counts as a violation

Examples, not an exhaustive list:

- Accessing a patient record without a treatment, payment or operations
  purpose. Looking up a colleague, a relative, a neighbor or a public figure is
  the classic case. Every patient-record read in DocTurn is logged with the
  user, the record and the timestamp, so this is detectable after the fact.
- Sharing a password or letting another person act under your account. This
  also destroys the attribution the audit trail depends on.
- Sending PHI outside approved channels: personal email, consumer messaging
  apps, or free-text SMS.
- Photographing or screenshotting a screen showing PHI.
- Leaving a session open on an unattended shared workstation. The 15-minute
  inactivity timeout is a backstop, not permission.
- Removing PHI from approved systems: unauthorized exports, database dumps,
  copies onto personal storage.
- Disabling or circumventing a security control, including running production
  with rate limiting off or MFA unenrolled after being asked to enrol.
- Failing to report a known or suspected incident promptly.
- Retaliating against someone who reported an incident in good faith.

## 4. Tiers

| Tier | Character | Typical response |
| --- | --- | --- |
| 1 — Inadvertent | No harm, no pattern, self-reported | Coaching, retraining, documented in the file |
| 2 — Negligent | Careless disregard, or repeat of a tier 1 | Written warning, mandatory retraining, access review |
| 3 — Deliberate | Intentional unauthorized access or disclosure | Suspension of access pending investigation, formal discipline |
| 4 — Malicious or for gain | Snooping, sale, or use for personal gain | Termination, referral to regulators and law enforcement |

Aggravating factors: sensitivity of the information, number of records, whether
the person was previously trained on the exact point, whether they concealed
it, and whether it was self-reported.

Mitigating factors: prompt self-report, cooperation, genuine ambiguity in
policy, and absence of harm.

## 5. Process

1. Report to the Security Officer and, if PHI was involved, the Privacy
   Officer.
2. Investigate: gather audit and PHI-access evidence for the period, and
   interview. Handle the evidence as PHI itself.
3. Contain first where necessary — suspend access before concluding the
   investigation if risk requires it.
4. Determine the tier with HR, applying the factors above consistently across
   people and roles.
5. Apply the sanction through the normal HR or medical-staff process.
6. Assess whether the event is a reportable breach under the
   incident-response-plan.
7. Document: what happened, the evidence considered, the determination, the
   sanction applied, and the date. Retain six years.

## 6. Non-retaliation

No sanction may be applied for reporting a suspected violation in good faith,
for filing a complaint with HHS, for cooperating in an investigation, or for
opposing an unlawful practice — §164.530(g). Self-reporting is a mitigating
factor and is treated as such in every case.

## 7. GAP

DocTurn detects nothing on its own. It records what happened in the audit and
PHI-access trails; whether anyone looks is a human process defined in the
access-review and incident-response policies. This policy is only as real as
that review cadence.

## 8. Evidence to retain

The approved policy; workforce acknowledgements collected during training; and
the sanction register recording each application with its date and
determination.
`,
  ),

  /* ───────────────────────────── Physical ───────────────────────────────── */
  tpl(
    "workstation-security",
    "Workstation, Mobile Device and Physical Safeguards Policy",
    "Decide and document how device encryption, screen lock and remote wipe are actually enforced — MDM, mobile application management, or a signed personal-device agreement — and record the coverage. DocTurn cannot enforce or verify any of it, so an unwritten expectation is no control at all.",
    `
## 1. Purpose

§164.310(b) requires policies specifying the proper functions to be performed
and the manner in which they are performed at workstations that access ePHI.
§164.310(c) requires physical safeguards for those workstations. §164.310(d)(1)
covers devices and media that move. §164.312(a)(2)(iii) requires automatic
logoff. In practice this is the safeguard most often defeated: the screen
everyone can see from the corridor, and the personal phone on the train.

## 2. Scope

Hospital workstations displaying the patient board or DocTurn threads; laptops
used by directors and engineers; personally-owned phones and tablets running
the DocTurn PWA at /m or the native client; and any display in a shared or
public-facing area.

## 3. What DocTurn does today — verified

- **Automatic logoff.** Sessions expire after 15 minutes of inactivity. The
  cookie is rolling, so the window is genuine inactivity rather than an
  absolute lifetime, and the session-timeout control verifies this against the
  running configuration.
- **Session cookies are HTTP-only** and same-site, and are marked Secure when
  the process runs in production, so browser script cannot read them.
- **Push payloads are content-free** — a locked screen shows that something
  needs attention, never who or what.
- **The PWA service worker caches static app-shell assets only.** API
  responses, which carry PHI, are never written into the browser cache.
- **Minimum necessary by default** in the board display: initials and room
  rather than full names.

## 4. GAP — what DocTurn cannot do

DocTurn is a web application. It cannot verify or enforce device-level
security, and it must not be described as if it can:

- It cannot confirm full-disk or device encryption.
- It cannot enforce a passcode or an OS-level screen-lock timeout.
- It cannot detect a jailbroken or rooted device.
- It cannot remote-wipe a device or the data cached on it by the browser.
- It cannot prevent a screenshot, a photograph of the screen, or a shoulder
  surfer.

Everything in section 5 is therefore an organizational control enforced by
MDM, mobile application management, or a signed agreement — not by the
software.

## 5. Requirements

**All devices accessing ePHI:**

- Full-disk / device encryption enabled (FileVault, BitLocker, or the platform
  default on modern iOS and Android).
- Screen lock after no more than 5 minutes, requiring a passcode, biometric or
  password.
- Operating system and browser kept on a supported, patched version.
- No shared local accounts; each person uses their own device login.

**Clinical and shared workstations:**

- Positioned or screened so displays are not readable from public areas.
- Locked whenever unattended — habit first, the 15-minute timeout second.
- No storing of DocTurn credentials in a shared browser profile.

**Personally-owned devices (BYOD):**

- A signed personal-device agreement is required before access is granted,
  covering: the requirements above; a duty to report loss or theft
  immediately; consent to have access revoked; and what happens on
  termination.
- Access is revoked centrally by disabling the account and removing push
  subscriptions.
- Report a lost or stolen device the same day. Response: disable the account,
  force a password reset, rotate SESSION_SECRET if a session may still be live,
  and remove the device's push registration.

**Enforcement mechanism for this organization:** ______________________
**Coverage (devices enrolled / devices in use):** ______________________

## 6. Prohibited

Accessing ePHI over untrusted shared computers (hotel business centers, public
kiosks); leaving a device unlocked and unattended in a clinical area;
photographing screens; and installing DocTurn credentials in a shared password
manager vault accessible to people who lack their own access rights.

## 7. Evidence to retain

The approved policy; signed personal-device agreements; the MDM or MAM
enrollment report showing encryption and screen-lock coverage; and the record
of any lost-device response.

## 8. Review

Annually, and on introduction of a new device class or client application.
`,
  ),

  tpl(
    "disposal-media",
    "Device and Media Disposal and Re-use Policy",
    "Document the disposal path for every place ePHI comes to rest — including database backups, which outlive in-app deletion — and obtain certificates of destruction or the provider's written media-sanitization commitment. Confirm what your backup retention window actually is, because that is how long deleted records really live.",
    `
## 1. Purpose

§164.310(d)(1) requires policies governing the receipt and removal of hardware
and electronic media containing ePHI, and their movement within the facility.
§164.310(d)(2)(i) requires procedures for final disposition of ePHI and the
hardware or media on which it is stored. §164.310(d)(2)(ii) requires removal of
ePHI from media before re-use. §164.530(c) requires safeguards against
incidental disclosure, which is what a resold laptop becomes.

## 2. Scope

Server and database storage at the hosting provider; database backups,
snapshots and exports; workstations, laptops, phones and tablets that have
accessed DocTurn; removable media and printed material produced from the
system, including anything printed under the contingency plan's emergency
mode.

## 3. What DocTurn does today — verified

- **Message retention purge.** When an organization sets
  messageRetentionDays, an hourly sweep hard-deletes messages older than the
  window along with their delivery rows, and audits the count. This is a real
  delete, not a soft flag.
- **Patient purge.** The maintenance purge removes patient records and their
  dependent assignments and consults.
- **Tenant deletion** removes an organization's operational data while
  deliberately retaining the audit and PHI-access history, which is required
  compliance documentation under §164.316(b)(2)(i) and must not be destroyed
  with the tenant.
- **Attachments are deleted with their message**, because the bytes are stored
  base64-encoded inside the message row rather than in separate storage.

## 4. GAP — deletion is not destruction

- **Backups outlive deletes.** A record deleted from the live database persists
  in every backup taken before the deletion, until that backup's retention
  window expires. The true disposal date is therefore the deletion date PLUS
  the backup retention period. Write both down, and tell patients the truth if
  asked how long data is kept.
  **Backup retention window for this deployment:** _______________
- **No cryptographic erasure.** DocTurn does not encrypt records with per-record
  or per-tenant keys, so there is no key to destroy as a shortcut to
  irrecoverability.
- **Physical media is entirely the provider's.** In a managed hosting
  environment {organizationName} never touches a disk. Sanitization on
  decommission is the provider's process, and the only evidence available is
  their written commitment or certificate — obtain it and file it with the BAA.
- **Local development stores.** The default in-process PGlite database writes
  to a local directory. Any developer machine or CI runner that has ever held
  non-synthetic data must be treated as media in scope and sanitized.

## 5. Requirements

- **Managed infrastructure.** Obtain the provider's media-sanitization
  statement (NIST SP 800-88 alignment is the standard to ask for) and retain it
  with the BAA.
- **Owned hardware.** Cryptographic erase or a NIST SP 800-88 purge before
  re-use; physical destruction on retirement. Obtain a certificate of
  destruction from the vendor listing serial numbers.
- **Mobile devices.** Factory reset with encryption enabled before re-use or
  disposal; remove the device's push registration and disable the account
  first.
- **Removable media.** Not used for ePHI. If unavoidable, encrypt, log the
  movement, and destroy after use.
- **Paper.** Cross-cut shred. Anything printed during emergency-mode operation
  is destroyed once reconciled into the system, and the destruction is
  recorded.
- **Chain of custody.** Log every device or medium leaving {organizationName}'s
  control: what it was, who released it, to whom, when, and how it was
  sanitized or destroyed.

## 6. Re-use

Media may be re-used only after sanitization appropriate to its type, verified
and recorded by someone other than the person who performed it where
practicable.

## 7. Evidence to retain

Certificates of destruction; the provider's sanitization commitment; the
media/chain-of-custody log; and the recorded backup retention window that
defines when deleted records are genuinely gone.

## 8. Review

Annually, and on any change of hosting provider, backup configuration or device
fleet.
`,
  ),
];

export const POLICY_TEMPLATE_BY_ID = new Map(
  POLICY_TEMPLATES.map((t) => [t.controlId, t]),
);

/* ── rendering ────────────────────────────────────────────────────────────── */

/** Defaults for the optional variables — never a blank, never a stale value. */
const DEFAULTS: Record<string, string> = {
  version: "0.1 — DRAFT, not yet approved",
  owner: "[assign a named owner]",
};

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

/**
 * Substitute {placeholders}. A placeholder with no value falls back to an
 * explicit bracketed marker rather than being left as {name}: rendered output
 * must never contain an unresolved template variable that could be mistaken
 * for approved text.
 */
function fill(body: string, vars: PolicyVars): string {
  const values: Record<string, string | undefined> = {
    organizationName: vars.organizationName,
    effectiveDate: vars.effectiveDate,
    version: vars.version || DEFAULTS.version,
    owner: vars.owner || DEFAULTS.owner,
  };
  return body.replace(PLACEHOLDER, (_match, key: string) => {
    const v = values[key];
    if (v) return v;
    return `[TO BE COMPLETED: ${key}]`;
  });
}

/** Metadata for every template — no bodies, safe to list cheaply. */
export function listPolicyTemplates(): PolicyTemplateMeta[] {
  return POLICY_TEMPLATES.map((t) => ({
    controlId: t.controlId,
    title: t.title,
    hipaa: t.hipaa,
    actionRequired: t.actionRequired,
  }));
}

/**
 * Render one policy for a specific organization. Returns null when no template
 * exists for the id — including for every automated control, which by
 * construction has none.
 */
export function renderPolicy(
  controlId: string,
  vars: PolicyVars,
): RenderedPolicy | null {
  const t = POLICY_TEMPLATE_BY_ID.get(controlId);
  if (!t) return null;
  return {
    controlId: t.controlId,
    title: t.title,
    hipaa: t.hipaa,
    actionRequired: t.actionRequired,
    markdown: fill(t.body, vars),
  };
}
