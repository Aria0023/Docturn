# 04 — Workflows Delta

Extends `../design_handoff_docturn/05_WORKFLOWS.md`. The assignment state machine itself is
unchanged; v2 changes **who is notified** and adds an **accept-lock**, the **board assembly**, and
the **audited census override**. Keep all logic in `services/` (unit-testable without HTTP).

## A. Care-team on-call unit fan-out

**Resolve a unit (pure function):**
```
unitUserIds(attendingUserId, orgId):
  members = careTeamMembers.where(owner_user_id = attendingUserId,
                                  on_call = true, organization_id = orgId)
  return [attendingUserId, ...members.map(m => m.member_user_id)]
```

**On assignment create / reroute** (after `rotation.selectNext` picks the attending):
1. Create the `pending` assignment as in v1 (target = attending's `hospitalist_id`).
2. `ids = unitUserIds(attendingUser, org)`.
3. Notify the **whole unit**: `sendToUsers(ids, ASSIGNMENT_CREATED)`; the SMS/push fallback also
   targets each `id` that has a phone/device token. Payloads carry **no PHI** (initials only).
4. The pending request appears in `GET /api/assignments/pending` for **every** unit member (the
   query returns assignments whose attending's on-call unit includes the caller).

### Accept-lock (CT-ACCEPT-ONCE) — the critical invariant
`PATCH /api/assignments/:id/accept` (allowed for any on-call unit member of the attending):
```
tx:
  a = select assignments where id=:id and organization_id=org FOR UPDATE   -- row lock
  if a.status != 'pending':  return 409 { error: 'already_resolved' }      -- lost the race
  a.status = 'accepted'
  a.accepted_by_user_id = caller.id          -- which member accepted (may be a midlevel)
  a.resolved_at = now()
  patients[a.patient_id].assigned_hospitalist_id = a.hospitalist_id        -- the ATTENDING profile
  patients[a.patient_id].status = 'assigned'
  hospitalists[a.hospitalist_id].current_patient_count += 1                -- CT-CENSUS: attending++
commit
emit ASSIGNMENT_UPDATED(org)   -- closes the offer in every other member's UI
```
- **Exactly one** accept succeeds (row lock / optimistic version). Concurrent accepts get `409` and
  the UI reconciles via `ASSIGNMENT_UPDATED`.
- **Reject / expire** behave as v1 (reroute → next eligible → new `pending`), then re-run fan-out
  for the new attending's unit.
- **Census is attributed to the attending**, never the accepting midlevel.

### Assignment threads include the unit
When an assignment-scoped conversation is created, its `participant_ids` = `unitUserIds(attending)` ∪
`{er_doctor_id}`. If unit membership changes mid-assignment, recompute participants on next message.

### Toggling on-call
`PATCH /api/care-team/members/:id { onCall }` only affects **future** fan-out and thread membership;
it never retroactively removes someone from an already-accepted assignment.

## B. Patient board assembly

`GET /api/patient-board` (org-scoped; hospitalist / er_doctor / director):
```
patients = patients.where(organization_id=org, status in ('waiting','assigned','admitted'))
for p in patients:
  latest = latest assignment for p
  if latest.status == 'pending':  responsible = null ; status = 'pending'
  else:
     attending = users[ hospitalists[p.assigned_hospitalist_id].user_id ]
     unit      = members of attending where on_call=true   -> [{userId,credential,displayName}]
     responsible = { attending, unit }
     status = p.status
  consultants = patient_consults.where(patient_id=p.id, status in ('requested','active')).specialty[]
  admittedBy  = users[p.er_doctor_id]
  emit row
writePhiAccessLog(user, org, resource='patient_board', method='view', purpose='board')   -- PB-TENANT
```
- **Org filter is mandatory** on every table touched. Optional `?department=` filters on
  `patients.department_code`.
- The developer role is rejected (`403`) — platform operators don't read tenant PHI.

## C. Director census override (DIR-OVERRIDE-AUDIT)

`PATCH /api/hospitalists/:id/census { currentPatientCount, reason }` (director):
```
require role=director and same org as hospitalist
clamp v = max(0, min(currentPatientCount, hospitalist.patient_cap))
hospitalist.current_patient_count = v
auditLog(actor=director, action='hospitalist.census_override', resource='hospitalist:id',
         details={ from, to:v, reason }, risk='medium')          -- reason REQUIRED
emit PROVIDER_UPDATED(org)
```
- This is the **only** manual census path. The automated rule (census moves on accept ++ /
  cancel-of-accepted −−) is untouched; the override is an explicit, audited correction so the trail
  always explains any census number that didn't come from an accept/cancel.

## D. Bulk working toggle

`PATCH /api/hospitalists/working-status { working, ids? }` (director / er_director):
```
targets = ids ? hospitalists.where(id in ids, org) : hospitalists.where(org)   -- no ids ⇒ ALL
set working = working on targets
emit PROVIDER_UPDATED(org)   -- (one event; clients refetch the provider list)
```
- Bulk off does **not** cancel in-flight assignments; it only removes providers from future rotation
  eligibility (a provider off-shift is skipped by `rotation.selectNext`).

## E. Developer provisioning

`POST /api/dev/users` (developer, cross-tenant): validate the discriminated-union body; create the
`users` row in `organizationId`; for `role='hospitalist'` also create the `hospitalists` profile
(`specialty`, `patient_cap`, `shift_type`, `rotation_order = max+1`, `credential`); audit
`dev.user_create`. Issue the login credential via the v1 invite path (never return a hash).

## Test hooks (see `07` for the full milestone checks)
- **CT-ACCEPT-ONCE:** fire two concurrent accepts from two unit members → exactly one `accepted`,
  one `409`; attending census +1 (not +2).
- **CT-CENSUS:** midlevel accepts → attending's `current_patient_count` increments, midlevel's does not.
- **PB-TENANT:** board for org A never returns org B rows; each load writes a `phi_access_logs` row.
- **DIR-OVERRIDE-AUDIT:** census edit writes an audit row with `reason`; missing `reason` → `400`.
