# DocTurn — Competitive Gap Analysis & Compliance Readiness

*Benchmarked against TigerConnect (TigerText) and PerfectServe. Written 2026-07.*

## 1. Where DocTurn already matches the market

| Capability | DocTurn today | Market equivalent |
|---|---|---|
| Secure role-based messaging (direct/group) | ✅ live | TigerConnect core |
| Delivery + read receipts | ✅ live | TigerConnect |
| Typing indicators & presence | ✅ live | TigerConnect |
| Message recall (soft-delete + audit) | ✅ live | TigerConnect "message recall" |
| Emergency broadcasts w/ per-recipient ack | ✅ live | TigerConnect broadcast lists |
| Patient assignment routing (round-robin by census, cap relief, expiry re-route) | ✅ live | PerfectServe Dynamic Intelligent Routing (simplified) |
| On-call schedule ingestion (Amion) | ✅ live feed (env-configured) | PerfectServe/Lightning Bolt schedule integration |
| Multi-tenant isolation + RBAC + audit trail | ✅ live | Both (enterprise admin) |
| PHI-minimizing notifications (initials only; PHI-free push/SMS) | ✅ live | Both |

## 2. Gaps vs. TigerConnect / PerfectServe — prioritized roadmap

### Tier 1 — high value, buildable on current architecture
1. **Role-based messaging ("message the on-call, not the person").** Message *"Tarzana Night Triage"* and it resolves to whoever the Amion feed says is on right now. DocTurn already has the live schedule — this is the single biggest differentiator to close, and the pieces exist.
2. **Patient-centered threads.** Attach a conversation to a patient (conversation.patientId): care-team thread per patient, auto-membership from assignment. PerfectServe/TigerConnect both sell this as "clinical collaboration."
3. **Priority/urgent messages.** Urgent flag → distinct styling, re-alert until read, and escalation: unread after N minutes → PHI-free SMS nudge ("Urgent message waiting in DocTurn"). Cascade plumbing already exists for assignments.
4. **Quiet hours / DND with covering-provider forwarding.** DND without escalation is dangerous in clinical messaging; pair it with "forward to covering" resolved from the schedule.
5. **Message retention policy per org.** Auto-expire messages after a configurable window (e.g., 30 days) with an audited purge job. Both competitors sell this as a compliance feature; it also reduces breach surface.

### Tier 2 — valuable, more infrastructure
6. **Attachments (images/documents).** Wound photos etc. Requires encrypted object storage + AV scanning + strict access checks. Do not ship quickly; do ship correctly.
7. **Native push (APNs/FCM).** Finish the Expo app or add web-push; payloads stay contentless ("You have a new secure message") because Google/Apple won't sign BAAs for push content.
8. **Escalation chains for assignments.** No answer → next provider → charge nurse → phone call. PerfectServe's core sell.
9. **Analytics dashboard.** Response times, assignment acceptance latency, message volume by unit — directors love this and the audit tables already hold the data.

### Tier 3 — enterprise/later
10. EHR integration (HL7/FHIR ADT feeds driving the patient board), voice/video calls, answering-service workflows, patient/family texting links.

## 3. HIPAA readiness — honest assessment

### Technical controls already in place
- RBAC + tenant isolation enforced server-side; developer cross-tenant access audited
- Audit logs + PHI access logs; 15-min rolling sessions; bcrypt(12); MFA available (TOTP/SMS/backup codes)
- Patients referenced by initials only; push/SMS payloads carry no PHI
- TLS in transit (host-terminated)

### Required before ANY real PHI goes through this system
| # | Requirement | Status |
|---|---|---|
| 1 | **Hosting under a BAA** (AWS/GCP/Azure, Aptible, or a HIPAA-eligible Render plan). The current free-tier demo has **no BAA — not permitted for PHI.** | ❌ blocking |
| 2 | **Persistent, encrypted-at-rest database with backups.** Current demo DB is ephemeral (wipes on restart) — unacceptable for clinical messaging and for retention duties. | ❌ blocking |
| 3 | **BAA with Twilio** (HIPAA-eligible messaging) if SMS stays on | ❌ |
| 4 | **Enforce MFA** for all users (currently optional) | ⚠️ code exists, not enforced |
| 5 | **Remove demo credentials/seeding** in production; real user provisioning + password policy | ❌ |
| 6 | Audit-log retention ≥ 6 years; documented backup/DR | ❌ |
| 7 | Organizational program: risk analysis, policies & procedures, workforce training, incident-response & breach-notification process, vendor/BAA management | ❌ (not a code problem) |

**Bottom line: the demo is architected in a HIPAA-aligned way, but running real PHI on the current free-tier deployment would violate HIPAA (no BAA, no persistence, shared demo creds).** Items 1–5 are a hosting-plus-configuration project, not a rewrite.

## 4. SOC 2 — what it actually takes
SOC 2 is an **audit of the organization**, not a property of the code. Type I is point-in-time; Type II observes controls over 6–12 months. Code contributes evidence (RBAC, audit logs, encryption, change management via PRs), but certification requires: written security policies, access reviews, monitoring/alerting, vendor management, incident response, background checks, and an auditor engagement (typically via a compliance platform such as Vanta or Drata). Realistic timeline from a standing start: 6–12 months to a Type II report.
