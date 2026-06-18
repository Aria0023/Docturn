# 06 — Requirements Delta

Extends `../design_handoff_docturn/10_SYSTEM_REQUIREMENTS.md` (the acceptance contract). These are
the **added** "shall" requirements for v2. Priority: **Must** / **Should** / **Could**. Verification:
**Test** (automated), **Demo**, or **Inspect**. The four starred items are the new high-risk
invariants and must stay green throughout.

## Care teams (FR-CT)

| ID | Requirement | Pri | Verify |
|---|---|---|---|
| FR-CT-01 | A clinician **shall** link other org users (NP/PA/MD/DO) into an on-call unit they own, and unlink them. | Must | Test |
| FR-CT-02 | Each membership **shall** carry an `on_call` flag the owner toggles; only on-call members participate in fan-out. | Must | Test |
| FR-CT-03 | A new/rerouted assignment **shall** notify the attending **and** every on-call unit member (WS + push/SMS fallback), with **no PHI** in payloads. | Must | Test |
| FR-CT-04 ★ | An assignment offered to a unit **shall** be acceptable **exactly once**; the first accept wins, others receive `409` and reconcile. *(CT-ACCEPT-ONCE)* | Must | Test |
| FR-CT-05 ★ | Acceptance **shall** increment the **attending's** census by 1 regardless of which unit member accepted; the midlevel's census is unaffected. *(CT-CENSUS)* | Must | Test |
| FR-CT-06 | The assignment-scoped conversation **shall** include the on-call unit as participants. | Should | Test |
| FR-CT-07 | Care-team mutations **shall** assert ownership and same-tenant membership; cross-tenant linking is rejected. | Must | Test |
| FR-CT-08 | `credential` **shall** be display/routing metadata only and grant no RBAC. | Must | Inspect |

## Patient board (FR-PB)

| ID | Requirement | Pri | Verify |
|---|---|---|---|
| FR-PB-01 | The system **shall** provide an org-wide board listing every distributed patient with patient (initials/room/dept), responsible attending **+ on-call unit**, consultants, and admitting ER physician. | Must | Test |
| FR-PB-02 ★ | The board **shall** return only the caller's organization's rows, and **shall** write a `phi_access_logs` row per load. *(PB-TENANT)* | Must | Test |
| FR-PB-03 | The board **shall** be available to hospitalist, er_doctor, and director, and **denied** (`403`) to developer. | Must | Test |
| FR-PB-04 | A patient whose latest assignment is `pending` **shall** render as unassigned/"Routing…". | Should | Demo |
| FR-PB-05 | The board **shall** support department filter and patient/attending/issue search. | Should | Demo |
| FR-PB-06 | Patients **shall** be shown by initials only; no full names anywhere on the board. | Must | Inspect |

## Director admin controls (FR-DIR)

| ID | Requirement | Pri | Verify |
|---|---|---|---|
| FR-DIR-01 ★ | A director's manual census edit **shall** be an audited override (`hospitalist.census_override`, `reason` required); missing reason → `400`. *(DIR-OVERRIDE-AUDIT)* | Must | Test |
| FR-DIR-02 | The automated census rule (++ on accept, −− on cancel-of-accepted) **shall** remain the only non-override census path. | Must | Test |
| FR-DIR-03 | A director **shall** edit `patient_cap`, with census re-clamped to the new cap. | Must | Test |
| FR-DIR-04 | A director (er_director for ER providers) **shall** bulk-toggle `working` for all permitted providers in one call. | Should | Test |
| FR-DIR-05 | A director **shall** reorder the rotation queue and the new order **shall** persist to `rotation_order` and be honored by `rotation.selectNext`. | Must | Test |

## Developer provisioning (FR-DEV)

| ID | Requirement | Pri | Verify |
|---|---|---|---|
| FR-DEV-01 | The developer **shall** create users in any organization by role, audited (`dev.user_create`). | Must | Test |
| FR-DEV-02 | Clinical roles **shall** capture specialty + cap + shift + credential and create the paired `hospitalists` profile; admin roles omit them (Zod discriminated union). | Must | Test |
| FR-DEV-03 | Provisioning **shall** never return a password hash; the login credential is issued via the invite path. | Must | Inspect |
| FR-DEV-04 | A provisioned user **shall** remain fully org-scoped; provisioning **shall not** grant the developer tenant-PHI access. | Must | Test |

## Non-functional (NFR additions)

| ID | Requirement | Pri | Verify |
|---|---|---|---|
| NFR-CT-01 | Unit fan-out and accept-lock **shall** be concurrency-safe under simultaneous accepts (row lock / optimistic version). | Must | Test |
| NFR-PB-01 | `GET /api/patient-board` **shall** assemble in a single org-scoped pass without N+1 cross-tenant reads. | Should | Inspect |
| NFR-V2-01 | All v2 DDL **shall** be additive (`db:push`, no destructive migration). | Must | Inspect |
