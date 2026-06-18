# 02 — API Delta

Extends `../design_handoff_docturn/03_API_CONTRACT.md`. Same conventions: REST under `/api`, JSON
in/out, session cookie auth, Zod-validated bodies, `{ error }` on non-2xx, every privileged route
asserts role **and** tenant. **Auth legend** as in v1 (`public` · `auth` · role · `self` ·
`participant`); `owner` = caller owns the care-team unit.

## Care teams (new)

| Method & path | Auth | Body / params → Response |
|---|---|---|
| `GET /api/care-team` | auth | caller's unit → `{ owner, members:[{ userId, displayName, credential, specialty, onCall }] }` |
| `GET /api/care-team/candidates` | auth | org clinicians not already in the caller's unit (for the Add picker) |
| `POST /api/care-team/members` | auth (owner) | `{ memberUserId }` → adds member (`on_call:true`); 409 if already linked or self |
| `PATCH /api/care-team/members/:memberUserId` | auth (owner) | `{ onCall:boolean }` → toggle on-call |
| `DELETE /api/care-team/members/:memberUserId` | auth (owner) | unlink member → `204` |
| `GET /api/care-team/of/:userId` | director | view any provider's unit (read-only, org-scoped) |

- Mutations emit `CARE_TEAM_UPDATED` to the affected member(s) + owner.
- All writes assert the member shares the caller's `organization_id`.

## Patient board (new)

| Method & path | Auth | Notes |
|---|---|---|
| `GET /api/patient-board` | hospitalist, er_doctor, director | org-scoped board rows (below). Optional `?department=ER\|ICU\|MED\|TELE`. **Writes a `phi_access_logs` row per load** (`method:'view'`, `purpose:'board'`). |

**Row shape:**
```jsonc
{
  "patient":     { "id": 1, "initials": "RM", "room": "318", "department": "MED",
                   "issue": "Acute abdominal pain", "status": "assigned" },
  "responsible": { "attending": { "userId": 12, "displayName": "Dr. Sarah Chen" },
                   "unit": [ { "userId": 40, "credential": "PA", "displayName": "Jordan Wu, PA-C" } ] },
  "consultants": [ "GI" ],
  "admittedBy":  { "userId": 7, "displayName": "Dr. Reyes" },
  "status":      "assigned"
}
```
- A patient whose latest assignment is still `pending` shows `responsible:null` / `status:"pending"`
  (the UI renders a "Routing…" state). **Not** available to `developer` (no tenant PHI).

## Patient consults (new — feeds the board's Consultants column)

| Method & path | Auth | Notes |
|---|---|---|
| `GET /api/patients/:id/consults` | auth | consults for a patient |
| `POST /api/patients/:id/consults` | er_doctor, hospitalist, director | `{ specialty, consultantUserId? }` → `requested` |
| `PATCH /api/consults/:id` | auth | `{ status, consultantUserId? }` (`requested`→`active`→`closed`) |

## Director admin controls (new / changed)

| Method & path | Auth | Notes |
|---|---|---|
| `PATCH /api/hospitalists/:id/census` | **director** | `{ currentPatientCount:int, reason:string }` → **audited override** (`hospitalist.census_override`, risk `medium`). `reason` required. Clamped `0…patient_cap`. |
| `PATCH /api/physicians/:id/capacity` | self or director | *(v1)* `{ patientCap:int }` — `current_patient_count` re-clamped to new cap |
| `PATCH /api/hospitalists/working-status` | director, er_director | **changed (back-compat):** `{ working:boolean, ids?:int[] }`. With `ids` → those providers; **without `ids` → ALL org providers** (bulk on/off). |
| `PATCH /api/hospitalists/:id/working-status` | self or director | *(v1, unchanged)* single-provider toggle |
| `PATCH /api/hospitalists/rotation-order` | director | *(v1)* `{ orderedIds:int[] }` → persists drag order into `rotation_order` (0..n by array index). Emits `PROVIDER_UPDATED`. |

> The bulk form is distinguished by the **absence** of `:id` in the path and the presence of a body
> `working` with optional `ids`. Keep the v1 per-`:id` route intact for the single toggle.

## Developer user provisioning (new)

| Method & path | Auth | Notes |
|---|---|---|
| `POST /api/dev/users` | **developer** | cross-tenant create; audited (`dev.user_create`). Body below. Creates the `users` row **and**, for clinical roles, the paired `hospitalists` profile. |

**Body (role-conditional, Zod discriminated union on `role`):**
```jsonc
{ "organizationId": 3, "role": "hospitalist",
  "displayName": "Dr. Lena Ortiz", "email": "lena@h.org", "phone": "+1…",
  // clinical-only (role = hospitalist):
  "credential": "MD", "specialty": "Nephrology", "patientCap": 15, "shiftType": "day" }
```
- Admin roles (`director` / `er_director` / `er_doctor` / `developer`) omit the clinical block.
- Returns the sanitized created user (no `password_hash`); a temporary credential/invite is issued
  out-of-band (reuse the v1 registration/invite path).

## WebSocket events (additions)

| Type | Direction | Meaning |
|---|---|---|
| `CARE_TEAM_UPDATED` | server→owner + member(s) | unit membership or on-call state changed |
| `ASSIGNMENT_CREATED` | server→**unit** | *(changed fan-out)* now delivered to the attending **and** every on-call unit member via `sendToUsers(unitUserIds, …)` |
| `ASSIGNMENT_UPDATED` | server→org | unchanged; on accept it also closes the offer for other unit members (accept-lock) |
| `PATIENT_BOARD_UPDATED` | server→org | optional hint to invalidate the board query (else rely on `ASSIGNMENT_UPDATED`) |
| `CONSULT_UPDATED` | server→org | a consult was added/changed (board refresh) |

## New standard responses

- `409` on `POST /api/care-team/members` when already linked or self-link.
- `409` on `PATCH /api/assignments/:id/accept` when the offer was **already accepted** by another
  unit member (accept-lock; see `04`).
- `403` on `GET /api/patient-board` for `developer`.
