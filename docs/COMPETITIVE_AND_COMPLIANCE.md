# DocTurn — Competitive Gap Analysis & Compliance Readiness

## 0. Deliberately frozen / cut (focus decisions, 2026-07)

To concentrate effort on the go-to-market table stakes (push, escalation,
patient threads, schedule roles, retention, analytics), the following are
**frozen** (kept working, zero further investment) or **cut**:

- **Frozen:** beds/equipment/departments resource tracking; per-org theming
  (Appearance); customizable dashboard widgets; CMS/landing/contact page
  settings. None of these win clinical-comms deals; revisit only if a routing
  use-case demands the resource data.
- **Cut:** fake voice-call buttons (no fake affordances — voice/video is Tier 3);
  external-AI intake beyond the local parser (PHI risk ≫ typing-time saved).
- **Honesty pass applied:** thread banner now says "Encrypted in transit ·
  access audited" (was falsely claiming end-to-end encryption + 30-day
  auto-delete); login badge says "HIPAA-aligned design · MFA available";
  demo affordances (role switcher, demo hints, /api/demo/login) only exist in
  synthetic-data mode.

*Benchmarked against TigerConnect (TigerText) and PerfectServe. Written 2026-07; §1–2 refreshed 2026-07 after a full re-review of tigerconnect.com and perfectserve.com.*

## 1. Where DocTurn already matches the market

Most of the original Tier-1/Tier-2 roadmap is now **built and verified** — this
section reflects that.

| Capability | DocTurn today | Market equivalent |
|---|---|---|
| Secure messaging (direct / group / emergency broadcast) | ✅ live | TigerConnect core |
| **Message the on-call ROLE / consult service**, resolved from the live schedule | ✅ live | TigerConnect Dynamic Roles · PerfectServe DIR (core differentiator) |
| Priority levels (routine / urgent / **STAT**) + acknowledgement (ack ≠ read) | ✅ live | TigerConnect Priority Messaging |
| **STAT escalation engine** — unacknowledged → re-alert → escalate | ✅ live | PerfectServe two-tier escalation (simplified) |
| **DND with covering-provider forwarding** (schedule-resolved) | ✅ live | PerfectServe availability routing |
| **Patient-linked care-team threads** (conversation.patientId) | ✅ live | Both "clinical collaboration" |
| Delivery + read receipts, typing indicators, presence/on-shift | ✅ live | TigerConnect |
| Message recall (soft-delete + audit) | ✅ live (before read) | TigerConnect message recall |
| Emergency broadcasts w/ per-recipient acknowledgement | ✅ live | TigerConnect broadcast lists |
| Assignment routing (round-robin by census, cap relief, expiry re-route) | ✅ live | PerfectServe DIR (simplified) |
| On-call schedule ingestion (Amion) | ✅ live feed | PerfectServe/Lightning Bolt integration |
| **Native push (Web Push + Expo), content-free payloads; installable PWA** | ✅ live | Both (mobile apps) |
| **Per-org message retention + audited purge** | ✅ live | Both (compliance) |
| **Director/ops analytics** (response/accept latency, volume) | ✅ live | TigerConnect TigerInsights (basic) |
| Multi-tenant isolation + RBAC (domain-scoped roles) + audit + PHI log | ✅ live | Both (enterprise admin) |
| PHI-minimizing everywhere (initials only; PHI-free push/SMS) | ✅ live | Both |

## 2. Gaps vs. TigerConnect / PerfectServe — what they have that we don't

Re-derived 2026-07 from a fresh review of both vendors' product surfaces.
Ordered by value-for-effort for a hospitalist/ED pilot. Lift is honest: some of
these are separate **products** the competitors license individually (alarm
management, scheduling engines, operator consoles), not quick features.

### Tier 1 — closes obvious demo gaps, buildable on current architecture
1. **Message forwarding + message templates.** Forward a thread/message to another person/role/group; canned templates ("Please call back re: bed X"). Cheap, expected in every demo.
2. **Auto-response / availability status message.** When DND/off-shift, senders see "Back at 07:00 — for urgent, contact the on-call." We have DND+covering; surfacing the status string is small.
3. **Read/status lifecycle polish.** We have ack + read; add explicit per-recipient status in group threads (sent/received/read/acknowledged) like both vendors show.
4. **Quick "who's on call right now" directory view.** A read-only board of every role/service and the current holder, straight from the schedule. We have the data; it's a view.
5. **SMS fallback for unacknowledged STAT.** Escalation exists in-app + push; add a PHI-free SMS nudge ("Urgent DocTurn message waiting") as the last hop (needs a Twilio BAA).

### Tier 2 — valuable, real infrastructure
6. **Voice / video calling + async↔sync switching.** In-app 1:1 and group voice/video, and "flip this text thread into a call." Both vendors lead with this. Large lift (WebRTC/SFU, TURN, mobile). *(Note: fake call buttons were deliberately cut — build it real or not at all.)*
7. **Attachments (images/documents).** Wound photos etc. Requires encrypted object storage + AV scanning + strict access checks + DLP. Ship correctly, not quickly.
8. **SSO / SAML + SCIM auto-provisioning** (Okta/Azure AD/Imprivata) and **remote wipe / remote lockout** of a lost device. Table-stakes for enterprise IT security review; we have MFA but not federated identity.
9. **Critical-results / alert routing from lab & radiology.** Ingest an HL7/FHIR result → route to the covering role with guaranteed escalation. Natural extension of our escalation engine once an interface feed exists.
10. **EHR-embedded messaging + deep links** (Epic Haiku/Canto/Rover, Cerner) driven by ADT feeds. Our board is FHIR-ready; embedded messaging + deep links is the deeper integration both vendors sell.

### Tier 3 — separate products / enterprise, later
11. **Physician scheduling ENGINE** (Lightning Bolt / TigerConnect Scheduling): auto-*generate* balanced schedules from rules, self-service swaps ("Swapportunity"), time-off, fairness reports. We *consume* a schedule (Amion) but don't *build* one.
12. **Healthcare Operator Console / answering service:** switchboard replacement — call queues, park / park-and-page, warm/blind transfer, AI-IVR patient self-service, one-touch callback, 800+ message templates. A whole product line.
13. **Alarm & alarm-fatigue management:** nurse-call / patient-monitor / infusion-pump / smart-bed integration (HL7/TAP/SIP). TigerConnect's is an **FDA Class II device** — do not attempt casually.
14. **Patient & family engagement:** no-app SMS-link secure text/video to patients, virtual waiting room + patient queue, automated appointment reminders, family updates during procedures, EHR-synced bulk outreach.
15. **Pager-network integration / pager replacement** (Spok, American Messaging; TigerPage-style number), **desktop apps** (Win/Mac/Linux), **multi-device + QR login**, and **benchmark analytics** (scorecards vs peer orgs).

### Honest positioning
DocTurn now **matches the core clinical-messaging loop** (role addressing, STAT +
escalation, DND/covering, patient threads, push, retention, analytics) that is
the heart of both products' *messaging* tier. The remaining gaps are mostly the
**adjacent product lines** the incumbents bundle — voice/video, scheduling
generation, operator console, alarm management, patient engagement — plus
enterprise-IT items (SSO/SCIM, remote wipe) and deeper EHR embedding. For a
hospitalist ⇄ ED pilot on synthetic data, Tier 1 (forwarding, templates,
status/availability, who's-on-call view) is the highest-leverage next batch;
Tier 2/3 are deal-size and staffing decisions, not quick wins.

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
