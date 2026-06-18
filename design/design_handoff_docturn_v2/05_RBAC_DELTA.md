# 05 — RBAC Delta

Extends `../design_handoff_docturn/04_RBAC.md`. Authorization is enforced **server-side** on every
route (role + tenant); the client mirrors it only for UX. `credential` (MD/DO/NP/PA/RN) is **display
+ routing metadata** and grants **no** permissions by itself — a midlevel's abilities come from their
`role`, exactly like any other user.

## Permission matrix (new actions)

| Action | hospitalist | er_doctor | er_director | director | developer |
|---|---|---|---|---|---|
| Manage **own** care-team unit (add / toggle on-call / remove) | ✅ owner | ✅ owner | ✅ owner | ✅ owner | — |
| View **any** provider's unit (`/care-team/of/:id`) | — | — | ▲ ER providers | ✅ | — |
| Receive a unit's assignment requests | ✅ if on-call member | ✅ if on-call member | — | — | — |
| Accept an assignment offered to the unit | ✅ on-call member | ✅ on-call member | — | — | — |
| View **Patient board** (`/api/patient-board`) | ✅ | ✅ | ✅ | ✅ | ❌ (no tenant PHI) |
| Add / change **consults** | ✅ | ✅ | ✅ | ✅ | — |
| **Census override** (`/hospitalists/:id/census`) | — | — | — | ✅ | — |
| **Bulk** working toggle (no `ids`) | — | — | ✅ (ER providers) | ✅ | — |
| **Capacity** edit (`/physicians/:id/capacity`) | ✅ self | — | ✅ | ✅ | — |
| **Rotation reorder** (`/hospitalists/rotation-order`) | — | — | ▲ | ✅ | — |
| **Provision users** cross-tenant (`/api/dev/users`) | — | — | — | — | ✅ |

✅ allowed · ▲ scoped to ER-side providers only · ❌ explicitly denied · — not applicable

## Rules

- **Care-team ownership.** Every `care-team/members*` mutation asserts `owner_user_id = caller.id`.
  A user can only edit their **own** unit. `member_user_id` must share the caller's `organization_id`.
  No cross-tenant linking, ever.
- **Unit accept eligibility.** `accept` is permitted when the caller is the attending **or** an
  **on-call** member of the attending's unit for that assignment. Off-call members cannot accept.
  Eligibility is recomputed server-side per request (never trust a client claim of membership).
- **Patient board is org-only and PHI-logged.** Allowed roles get only their own org's rows; the
  developer is rejected `403`. Every successful load writes a `phi_access_logs` row (PB-TENANT).
- **Census override is director-only and audited.** `reason` is required; the write emits a
  `hospitalist.census_override` audit row (risk `medium`). No other role may set census directly.
- **Bulk toggle scope.** `director` may bulk-toggle all org providers; `er_director` is limited to
  ER-side providers (assert the target set's role/department). Absent `ids` ⇒ the caller's full
  permitted set, not literally every row regardless of scope.
- **Developer provisioning is cross-tenant but bounded.** The developer may create users in any
  `organizationId`, but the created user is still fully org-scoped; the action is audited
  (`dev.user_create`). The developer cannot grant itself tenant PHI access via this route.

## Unchanged guarantees

- Server remains authoritative for routing, expiry, accept-lock, roles, and MFA.
- No endpoint returns `password_hash`, secrets, or PHI beyond initials.
- Cross-tenant reads/writes remain impossible for every role except the explicit, audited
  `developer` admin surface (which still never exposes tenant PHI such as the patient board).
