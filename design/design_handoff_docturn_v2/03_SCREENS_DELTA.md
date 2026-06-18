# 03 — Screens Delta

Extends `../design_handoff_docturn/07_SCREENS.md`. Build these in React + Vite + Tailwind +
shadcn/ui with TanStack Query, recreating the prototypes in **`ui_kits/web-app/`**. Tokens in
`colors_and_type.css`. Status-color language and "patients by initials only / light mode / one
primary action" rules are unchanged from v1.

> Prototype files to mirror: `CareTeam.jsx`, `PatientBoard.jsx`, `DirectorDashboard.jsx`
> (enhanced), `DeveloperDashboard.jsx` → `AddUserPanel` (enhanced). Nav per role is in
> `index.html` (`NAV`).

## Navigation changes

| Role | Nav (v2) |
|---|---|
| hospitalist | Dashboard · **Patient board** · **My care team** · Messages · Directory |
| er_doctor | Intake · **Patient board** · **My care team** · Messages · Directory |
| director | Overview · **Patient board** · Resources · Broadcasts · Messages · Directory · Compliance · Settings |
| developer | Organizations · Compliance · Tenant settings *(no Patient board — no tenant PHI)* |

## My Care Team  *(new — hospitalist, er_doctor)*
- **Purpose:** link NPs / PAs / partner doctors into a shared on-call unit.
- **Sections:** explainer banner · **on-call unit** visual (you ⎯🔗⎯ on-call members, "Connected · N
  on call") · **members** list with per-member **On call** toggle + remove · **Add member** picker
  (search candidates → Link).
- **Calls:** `GET /api/care-team`, `GET /api/care-team/candidates`, `POST /api/care-team/members`,
  `PATCH /api/care-team/members/:id` (onCall), `DELETE /api/care-team/members/:id`.
- **Realtime:** `CARE_TEAM_UPDATED` → invalidate `['/api/care-team']`.
- **States:** empty unit ("taking requests solo"), member off-call (greyed), add-picker no-matches.

## Patient Board  *(new — hospitalist, er_doctor, director)*
- **Purpose:** hospital-wide awareness of who's responsible for every distributed patient.
- **Columns:** Patient (initials · room · dept) · Issue · **Responsible** (attending + stacked
  on-call-unit avatars, "+ PA on unit") · **Consultants** (service chips) · **Admitted by** (ER
  physician) · Status. Stat tiles: on-board, awaiting acceptance, with consultants, ER admits today.
- **Controls:** search (patient / attending / issue) · department filter (All / ER / ICU / MED /
  TELE) · director-only **Export census**.
- **Calls:** `GET /api/patient-board?department=…`. Wide table → horizontal scroll on narrow
  viewports (don't crush columns).
- **Realtime:** `ASSIGNMENT_UPDATED` / `PATIENT_BOARD_UPDATED` / `CONSULT_UPDATED` → invalidate
  `['/api/patient-board']`.
- **States:** `pending` row → "Routing…" in the Responsible cell; PHI note in the footer.

## Director dashboard  *(enhanced)*
Adds full inline control over hospitalist users:
- **Census stepper** (`−`/`+`) → `PATCH /api/hospitalists/:id/census` with a `reason` (prompt or a
  default "manual correction"); clamp `0…cap`; the "Open census" stat recomputes.
- **Cap stepper** (`−`/`+`) → `PATCH /api/physicians/:id/capacity`; cap min 1; re-clamp census.
- **Bulk on/off** — *All on* / *All off* → `PATCH /api/hospitalists/working-status` (no `ids`).
- **Per-row toggle** → `PATCH /api/hospitalists/:id/working-status` *(v1)*.
- **Drag-and-drop rotation order** (`@dnd-kit`, or native HTML5 DnD as in the prototype) →
  `PATCH /api/hospitalists/rotation-order { orderedIds }`; "Next up" badge follows position 1.
- **Realtime:** `PROVIDER_UPDATED` reconciles census/cap/working/order across directors.

## Developer console  *(enhanced — AddUserPanel)*
Adds cross-tenant user/specialist provisioning beside the existing org admin / logs / AI monitor:
- **Account type** segmented control (hospitalist / er_doctor / er_director / director / developer).
- **Organization** select (any tenant). Name + email. **Role-conditional** fields: hospitalist
  shows **Specialty + Patient cap + Shift type**; admin roles hide them.
- **Create account** → `POST /api/dev/users`; on success prepend to the provisioned-users list +
  toast. Cross-tenant banner reads "full cross-tenant access · every action is audited."
- **Calls:** `POST /api/dev/users` (plus existing `/api/dev/*`).

## Design fidelity notes (unchanged from v1, restated for the new screens)
- **Credential pills:** MD/DO = blue, PA = emerald, NP = amber, RN = slate — a consistent learnable
  mapping, always paired with the label text.
- Status colors fixed (amber pending · emerald accepted/online · blue active/sent · red rejected ·
  slate offline). Avatars/initials only; no full patient names anywhere on the board.
- One primary action per view; steppers/toggles are secondary controls, not primary buttons.
