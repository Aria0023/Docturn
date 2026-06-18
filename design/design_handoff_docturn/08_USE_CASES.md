# DocTurn — Use Cases (DT-UC-001)

SysML-style behavioral model. **5 human actors + 4 system actors → 31 use cases** in seven
packages. Each use case traces forward to requirements (`10_SYSTEM_REQUIREMENTS.md`) and decomposes
into functions (`09_FUNCTION_LIST.md`).

## Actors

**Human:** Director · ER Director · ER Doctor · Hospitalist · Developer (cross-tenant platform operator).
**System:** OpenAI (extraction/NL) · Twilio (SMS + MFA OTP) · Firebase FCM (push) · Amion (on-call schedule sync).

## Use-case index

| ID | Use case | Package | Primary actor(s) | Priority |
|---|---|---|---|---|
| UC-01 | Authenticate | Access & Identity | All roles | Must |
| UC-02 | Complete MFA | Access & Identity | All roles | Must |
| UC-03 | Register (request access) | Access & Identity | Prospective user | Should |
| UC-04 | Manage own profile / shift toggle | Access & Identity | Hospitalist, all | Must |
| UC-05 | Register patient (intake) | Intake & Assignment | ER Doctor, ER Director | Must |
| UC-06 | Extract note with AI | Intake & Assignment | ER Doctor · OpenAI | Must |
| UC-07 | Create assignment | Intake & Assignment | ER Doctor, ER Director | Must |
| UC-08 | Accept / decline assignment | Intake & Assignment | Hospitalist | Must |
| UC-09 | Auto-expire & reroute | Intake & Assignment | System | Must |
| UC-10 | Reassign / cancel | Intake & Assignment | Director, ER Director | Must |
| UC-11 | Send secure message | Communication | All roles | Must |
| UC-12 | Manage conversation (direct/group) | Communication | All roles | Must |
| UC-13 | View presence & receipts | Communication | All roles | Should |
| UC-14 | Broadcast emergency | Communication | Director | Should |
| UC-15 | Deliver push / SMS | Communication | System · Twilio · Firebase | Must |
| UC-16 | Manage providers | Administration | Director, ER Director | Must |
| UC-17 | Configure rotation | Administration | Director | Must |
| UC-18 | Approve registration | Administration | Director | Should |
| UC-19 | Manage resources / beds / equipment | Administration | Director | Could |
| UC-20 | Sync on-call schedule | Administration | System · Amion | Could |
| UC-21 | Administer organizations | Platform & Compliance | Developer | Should |
| UC-22 | Impersonate (audited) | Platform & Compliance | Developer | Should |
| UC-23 | Edit CMS pages | Platform & Compliance | Developer | Could |
| UC-24 | Review audit / incidents | Platform & Compliance | Director, Developer | Should |
| UC-25 | Run AI diagnostics | Platform & Compliance | Developer · OpenAI | Could |
| UC-26 | Onboard device (QR) | Mobile | All roles | Should |
| UC-27 | Register push token | Mobile | All roles · Firebase | Should |
| UC-28 | Act on assignment (mobile) | Mobile | Hospitalist | Should |
| UC-29 | Adjust settings (tweak) | Configuration | Director, all (own prefs) | Should |
| UC-30 | Manage feature flags | Configuration | Developer, Director | Could |
| UC-31 | Review & apply adaptive suggestion | Configuration | Director | Could |

---

## Detailed specifications (core flows)

### UC-01 — Authenticate (Must)
- **Actors:** any human actor; Twilio (SMS OTP path).
- **Precondition:** account exists and is approved within an organization.
- **Main flow:** (1) submit org code, username, password; (2) validate credentials (scrypt/bcrypt) scoped to org; (3) if `twoFactorEnabled` → `202 { twoFactorRequired }` + set `pendingMfa` (→ UC-02); (4) else establish session, return sanitized user, route to role dashboard.
- **Alt/exception:** bad credentials → 401 + `audit_logs(auth.login.fail)`; unknown org → generic 401 (no enumeration).
- **Postcondition:** authenticated 15-min rolling session, or MFA pending.
- **Traces:** FR-AUTH-01/02, SEC-01/05.

### UC-07 — Create assignment (Must)
- **Actors:** ER Doctor / ER Director.
- **Precondition:** patient exists (`waiting`); caller authenticated, same org.
- **Main flow:** (1) choose mode round_robin|manual; (2) round-robin → `rotation.selectNext()` (lowest-census eligible, cap relief if none); manual → supplied `hospitalistId`; (3) insert assignment (`pending`, `expires_at = now + org.timeout`); (4) notification cascade WS→push→SMS (→ UC-15).
- **Alt/exception:** none eligible after cap relief → patient stays `waiting`, emit `assignment.unrouted`; manual over-cap allowed (override, audited).
- **Postcondition:** exactly one `pending` assignment; rotation cursor advanced.
- **Traces:** FR-ASG-01/02/03, PR-02, SEC-07.

### UC-08 — Accept / decline assignment (Must)
- **Actors:** Hospitalist (own assignment only).
- **Main flow:** **Accept** → `accepted`, set patient `assigned_hospitalist_id` + status `assigned`, `census++`, stamp `resolved_at`. **Decline** → `rejected`, stamp `resolved_at`, immediate reroute (→ UC-09 logic). Emit `ASSIGNMENT_UPDATED` org-scoped.
- **Alt/exception:** already resolved → 409; not the target → 403.
- **Postcondition:** census changes only on accept; a decline yields exactly one new pending row when eligible.
- **Traces:** FR-ASG-04/05, RR-01.

### UC-09 — Auto-expire & reroute (Must, system-triggered)
- **Precondition:** ≥1 `pending` assignment with `expires_at ≤ now`.
- **Main flow:** (1) interval (~15s) lists expired pending, capped 50/tick; (2) mark `expired` (stamp `resolved_at`); (3) `rotation.selectNext()` creates a new `pending` row for next eligible; notify.
- **Alt/exception:** none eligible → patient stays `waiting`, `assignment.unrouted`; UI shows "awaiting capacity".
- **Postcondition:** no expired-pending row left unresolved; history preserved.
- **Traces:** FR-ASG-06, RR-02, PR-03, DR-02.

### UC-11 — Send secure message (Must)
- **Actors:** any authenticated participant.
- **Main flow:** (1) post content to a conversation; (2) insert `messages` row + a `message_delivery_status` row per participant (delivered=now for connected); (3) emit `MESSAGE_RECEIVED` to participants only; mark-read turns ticks blue.
- **Alt/exception:** non-participant read/send → 403 (never delivered); delete → soft-delete + audit.
- **Postcondition:** message persisted with per-recipient delivery/read; no leak to non-participants.
- **Traces:** FR-MSG-01, SEC-04, FR-RT-01/02.

### UC-22 — Impersonate (audited) (Should)
- **Actors:** Developer (cross-tenant).
- **Main flow:** (1) select org + target user; (2) write full audit entry (`phi_access_logs` + `audit_logs`) **before** swapping session; (3) session scoped to target; impersonation banner shown.
- **Alt/exception:** non-developer → 403; suspicious attempt → `logSecurityIncident()`.
- **Postcondition:** impersonation session active and fully attributable.
- **Traces:** FR-DEV-02, SEC-03/06/13.

### UC-29 — Adjust settings (tweak) (Should)
- **Actors:** Director (org policy); any user (own preferences).
- **Precondition:** authenticated; the setting key exists in the typed config schema.
- **Main flow:** (1) change a tweak (e.g. timeout, default routing mode); (2) validate value vs type + bounded range (Zod); (3) persist to `org_settings` (policy) or `user_preferences` (preference), append `audit_logs` (old→new); (4) config cache invalidated; next decision reads the new value — no redeploy.
- **Alt/exception:** non-director edits org policy → 403; out-of-range → 400, current value retained.
- **Postcondition:** behavior reflects the tweak on next action; attributable and reversible.
- **Traces:** FR-CFG-01/02/03.
