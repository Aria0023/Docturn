# 00 — Changes (v1 → v2)

This is the narrative of what changed. The numbered delta docs give the precise schema, API, RBAC,
workflow, requirements, and build steps.

## Summary

v1 shipped the core platform: multi-tenant auth + RBAC, provider/rotation management, AI patient
intake, the assignment state machine with round-robin + expiry, secure messaging, realtime over
WebSocket, resources/broadcasts/CMS, MFA, and the developer console. v2 adds the **human structure
of coverage** (care teams), **shared awareness** (the patient board), and **direct operational
control** for directors and the developer.

## 1. Care-team on-call units

Coverage in a real hospital is a provider **plus** their midlevels (NP, PA) — and sometimes a
partner doctor. v2 models this directly:

- A clinician owns a **unit** and links members to it (`care_team_members`). Each membership has an
  **on-call** flag the owner toggles per shift.
- **Fan-out:** when an assignment is routed to an attending, the notification and the pending
  request go to the attending **and** every on-call unit member (`sendToUsers(unitUserIds, …)`).
- **Single accept:** any unit member may accept; the **first accept wins** and the offer closes for
  the rest. Census increments on the **attending** (see CT-CENSUS).
- **Threads:** the assignment-scoped conversation includes the on-call unit as participants, so the
  whole unit sees and can reply on the thread.
- New people types: midlevels are ordinary `users` with a `credential` of `NP`/`PA` (doctors are
  `MD`/`DO`). Credential is display + routing metadata; it does **not** grant new RBAC by itself.

## 2. Patient distribution board

A single hospital-wide board (`GET /api/patient-board`) listing every distributed patient with:

- **Patient** — initials, room, department, issue, status.
- **Responsible** — the attending **and** their on-call unit (rendered as a stacked avatar group).
- **Consultants** — the active consulting services for that patient (`patient_consults`).
- **Admitted by** — the ER physician who created the patient.

It is **org-scoped** and **PHI-logged** on every load, and available to hospitalist / ER physician /
director. The **developer does not** get the board — platform operators don't read tenant PHI.

## 3. Director admin controls

The director dashboard gains full inline control over hospitalist users:

- **Editable census** (`current_patient_count`) and **cap** (`patient_cap`) via steppers.
  Census edits are an **audited override** with a reason (see DIR-OVERRIDE-AUDIT).
- **Bulk on/off** — toggle every provider's `working` flag at once (plus the existing per-row toggle).
- **Drag-and-drop rotation order** — reorder the on-shift queue; the new order **persists** to
  `hospitalists.rotation_order` and is honored by the rotation selector's tiebreak.

## 4. Developer user provisioning

The developer console gains **cross-tenant user/specialist creation** (`POST /api/dev/users`):

- Choose **account type** (hospitalist / er_doctor / er_director / director / developer) and the
  **organization**.
- Clinical types (hospitalist) capture **specialty + patient cap + shift type** and create the
  paired `hospitalists` profile; admin types capture only identity.
- Cross-tenant and **audited** (`dev.user_create`).

## What is explicitly unchanged

- The **assignment state machine** (pending → accepted/rejected/expired/cancelled) is unchanged; v2
  only changes **who is notified** (the unit) and adds an **accept-lock** so a unit accepts once.
- **Census still moves automatically only on accept (++) and cancel-of-accepted (−−).** The
  director override is a separate, audited manual correction — not a new automatic path.
- **Tenant isolation, server authority, no-PHI-in-notifications, initials-only** all still hold.
- Existing endpoints keep their contracts; v2 is additive. The one **changed** endpoint is
  `PATCH /api/hospitalists/working-status` gaining a bulk form (back-compatible — see `02`).

## Migration

All v2 changes are additive DDL (new tables + nullable columns), applied with `npm run db:push`.
No destructive migration. Seed updates: add a couple of NP/PA users and a sample unit, a few
`patient_consults`, and a `department` per seeded patient (see `13_TEST_PLAN.md` extension in `07`).
