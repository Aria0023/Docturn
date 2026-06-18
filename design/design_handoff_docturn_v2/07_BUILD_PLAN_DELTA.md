# 07 — Build Plan Delta (M15–M18)

Continue the v1 milestone sequence. Each milestone is independently testable; **run its acceptance
check before moving on.** Read the matching delta docs (`01`–`06`) as you go. All v1 guardrails
apply: every storage method takes `organizationId` and filters by it; the server is authoritative;
no PHI in notifications; patients by initials.

> **Kickoff:** *"Apply the DocTurn v2 delta. Do M15, run its acceptance check, then continue M16–M18.
> Additive DDL only (`db:push`). Keep every query org-scoped and the accept path concurrency-safe."*

## M15 — Care-team on-call units ⭐ core
**Build**
- Schema: `care_team_members` (+ UNIQUE owner/member, self-link guard), `users.credential`,
  `assignments.accepted_by_user_id`. `db:push`.
- `services/careTeam.ts`: `unitUserIds(attendingUserId, orgId)`, add/toggle/remove with ownership +
  same-tenant asserts.
- Routes: `GET /api/care-team`, `/candidates`, `POST/PATCH/DELETE /api/care-team/members*`,
  `GET /api/care-team/of/:userId` (director).
- **Fan-out:** update assignment create/reroute to `sendToUsers(unitUserIds, ASSIGNMENT_CREATED)` and
  to extend pending-queue visibility to on-call members.
- **Accept-lock:** make `PATCH /api/assignments/:id/accept` transactional with a row lock; set
  `accepted_by_user_id`; attribute census to the **attending**; emit `ASSIGNMENT_UPDATED`.
- Assignment-thread participants include the on-call unit.
- WS `CARE_TEAM_UPDATED`.

**Acceptance** — `careteam.test.ts`:
- Link/unlink + on-call toggle work; cross-tenant link → `403`; self-link → `409`.
- An assignment to attending A reaches A **and** A's on-call PA on their sockets.
- **CT-ACCEPT-ONCE:** two concurrent accepts → exactly one `accepted`, one `409`.
- **CT-CENSUS:** PA accepts → A's census +1, PA's unchanged.

## M16 — Patient board
**Build**
- Schema: `patient_consults`, `patients.department_code`. `db:push`. Seed consults + dept per patient.
- `services/patientBoard.ts`: single org-scoped assembly pass (see `04 §B`); `phi_access_logs` write.
- Routes: `GET /api/patient-board` (+ `?department=`), consults CRUD
  (`GET/POST /api/patients/:id/consults`, `PATCH /api/consults/:id`).
- WS `PATIENT_BOARD_UPDATED` / `CONSULT_UPDATED` (or rely on `ASSIGNMENT_UPDATED` + query invalidation).

**Acceptance** — `patientboard.test.ts`:
- Board returns the org's patients with responsible (attending+unit), consultants, admitted-by.
- **PB-TENANT:** org A never sees org B; each load writes a `phi_access_logs` row.
- `developer` → `403`; `pending` patient → unassigned row; department filter narrows correctly.

## M17 — Director admin controls
**Build**
- Route `PATCH /api/hospitalists/:id/census { currentPatientCount, reason }` — director, clamp
  `0…cap`, audit `hospitalist.census_override` (risk medium), emit `PROVIDER_UPDATED`.
- Extend `PATCH /api/hospitalists/working-status` with the bulk form (`{ working, ids? }`, no `ids` ⇒
  all permitted providers). Keep the v1 per-`:id` route.
- Confirm `PATCH /api/hospitalists/rotation-order { orderedIds }` persists into `rotation_order` and
  that `rotation.selectNext` honors it as the tiebreak.
- Web: census/cap steppers, All on/All off, drag-and-drop order (recreate `DirectorDashboard.jsx`).

**Acceptance** — `director-admin.test.ts`:
- **DIR-OVERRIDE-AUDIT:** census edit writes an audit row with `reason`; missing `reason` → `400`;
  value clamped to cap.
- Cap edit re-clamps census; bulk toggle flips all permitted providers in one call; a hospitalist
  gets `403` on all of the above.
- Reordering then routing selects the dragged order's next eligible provider.

## M18 — Developer provisioning
**Build**
- Route `POST /api/dev/users` — developer, cross-tenant; Zod discriminated union on `role`; create
  `users` (+ `hospitalists` profile for clinical roles, `rotation_order = max+1`); audit
  `dev.user_create`; issue credential via the invite path.
- Web: `AddUserPanel` — account-type selector, org select, role-conditional fields, created list
  (recreate the enhanced `DeveloperDashboard.jsx`).

**Acceptance** — `dev-provisioning.test.ts`:
- Creating a hospitalist persists user **and** profile in the chosen org; admin role creates user only.
- Response never includes `password_hash`; non-developer → `403`.
- **FR-DEV-04:** the provisioned user is org-scoped; provisioning grants the developer no PHI route
  (`GET /api/patient-board` still `403` for developer).

## Regression gate (run after M18)
Re-run the v1 suites plus the four v1 invariants (RR-01 census, RR-02 reroute-exactly-once,
FR-ASG-04 accept-only census, SEC-02 tenant isolation) **and** the four v2 invariants (CT-ACCEPT-ONCE,
CT-CENSUS, PB-TENANT, DIR-OVERRIDE-AUDIT). All green = v2 done.

## Seed additions (extend `13_TEST_PLAN.md`)
- 2–3 midlevels (`credential` NP/PA) and one unit (attending + 1 on-call PA).
- `department_code` on every seeded patient; 1–2 `patient_consults`.
- Keeps the demo board populated and the care-team flow exercisable from `npm run seed`.
