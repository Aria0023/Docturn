# 01 — Data Model Delta

Extends `../design_handoff_docturn/02_DATA_MODEL.md`. All additions follow the same conventions:
integer `id` PK, `organization_id` FK on every tenant-scoped table (and **every query filters by
it**), `text({ enum })` enums, Zod insert schemas (`insertXSchema = createInsertSchema(x).omit({ id, createdAt })`).

## New enums

```ts
// Clinical credential — display + routing metadata, NOT an RBAC grant.
export const CREDENTIAL = ['MD','DO','NP','PA','RN'] as const;

// Consulting-service lifecycle on a patient.
export const CONSULT_STATUS = ['requested','active','closed'] as const;
```

> `ROLES` is unchanged: `['director','er_director','er_doctor','hospitalist','developer']`.
> Midlevels are `users` with `role='hospitalist'` (or a custom role) and `credential` of `NP`/`PA`.

## New tables

### care_team_members — on-call unit membership (directional: owner → member)
| column | type | notes |
|---|---|---|
| id | int pk | |
| organization_id | int fk → organizations | |
| owner_user_id | int fk → users | the attending who owns the unit |
| member_user_id | int fk → users | the linked midlevel / partner |
| on_call | int (bool) | default true — owner toggles per shift |
| created_at | timestamp | |

- **UNIQUE(owner_user_id, member_user_id)** — a member is linked to an owner at most once.
- Both users must share `organization_id` with the row (assert on insert).
- The **unit of attending A** = `{A} ∪ { member_user_id where owner_user_id=A and on_call=true }`.
- Self-link forbidden (`owner_user_id != member_user_id`).
- `insertCareTeamMemberSchema = createInsertSchema(careTeamMembers).omit({ id, createdAt })`.

### patient_consults — consulting services on a patient (the board's "Consultants" column)
| column | type | notes |
|---|---|---|
| id | int pk | |
| organization_id | int fk → organizations | |
| patient_id | int fk → patients | |
| specialty | text | e.g. "Cardiology", "Nephrology" |
| consultant_user_id | int fk → users | nullable until a provider is named |
| status | text enum CONSULT_STATUS | default `requested` |
| created_at | timestamp | |

- The board lists `specialty` for each `status in ('requested','active')` consult on the patient.

## New columns on existing tables

### users
| column | type | notes |
|---|---|---|
| credential | text enum CREDENTIAL | nullable; set for clinical users (MD/DO/NP/PA/RN) |

### patients
| column | type | notes |
|---|---|---|
| department_code | text | nullable; e.g. `ER` / `ICU` / `MED` / `TELE` — board grouping + filter |

> If the v1 `departments` table (resources subsystem, M12) is present, `department_code` may instead
> be a nullable `department_id` FK. `department_code` is the low-coupling default for the board.

### hospitalists
- No new columns. **`rotation_order` becomes user-editable** via drag-and-drop (it already exists as
  the rotation tiebreak); v2 persists the dragged order into it (see `02`/`04`).

### assignments
| column | type | notes |
|---|---|---|
| accepted_by_user_id | int fk → users | nullable; **which unit member accepted** (attending or a midlevel). Distinct from `hospitalist_id` (the responsible attending profile). Powers the accept-lock + audit. |

## Relations (additions)

- `users` 1—∞ `care_team_members` as **owner** (their unit) and 1—∞ as **member** (units they're in).
- `patients` 1—∞ `patient_consults`.
- `assignments.accepted_by_user_id` → `users` (the actual accepter); census still attributed to
  `hospitalist_id`'s profile (the attending).

## Invariants touched

- **CT-CENSUS** — on accept, increment `hospitalists.current_patient_count` for the **attending's**
  profile (`assignments.hospitalist_id`), never the midlevel — even when `accepted_by_user_id` is a
  midlevel.
- **Census still changes only on accept (++) / cancel-of-accepted (−−)** in the automated path. The
  director's manual `current_patient_count` edit is a separate **audited** correction (see `04`).
