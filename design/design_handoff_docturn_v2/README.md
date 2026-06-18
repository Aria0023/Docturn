# DocTurn — Engineering Spec **v2 Delta** (Build Package Addendum)

A focused **change package** layered on top of the v1 spec in `../design_handoff_docturn/`.
It documents four new capabilities added after v1, without restating the base system. Read v1 for
everything else; read this for what's new and what changed.

> **Kickoff prompt for Claude Code:**
> *"You've already implemented DocTurn from `design_handoff_docturn/`. Now apply the v2 delta in
> `design_handoff_docturn_v2/`: read `00_CHANGES.md`, then build milestones **M15–M18** from
> `07_BUILD_PLAN_DELTA.md`, running each acceptance check before moving on. The delta's data-model,
> API, RBAC, workflow, and requirement docs extend — never replace — the v1 ones. All v1 guardrails
> still hold: every storage query is org-scoped, the server is authoritative, and no PHI leaves the
> tenant. Treat `06_REQUIREMENTS_DELTA.md` as the added acceptance contract."*

---

## What v2 adds

| # | Capability | Why |
|---|---|---|
| 1 | **Care-team on-call units** — any clinician links their own midlevels (NP, PA) or partner doctors into an on-call unit. While paired and on call, every member receives the same assignment requests and is a participant on every assignment thread, so nothing waits on one person. | Real hospitalist/ER coverage is a doctor **+** midlevel(s), not a lone provider. |
| 2 | **Patient distribution board** — one hospital-wide view of every distributed patient: who's responsible (attending **+** their on-call unit), the consulting services, and the admitting ER physician. | Directors, hospitalists, and ER physicians need shared situational awareness of who owns whom. |
| 3 | **Director admin controls** — directors edit daily **census** and **patient cap** inline, bulk-toggle **all** providers on/off shift, and **drag-and-drop** the rotation order (persisted). | Charge/medical directors actively manage the board during a shift. |
| 4 | **Developer user provisioning** — the developer provisions users and specialists into **any** tenant, by account type, with role-conditional fields (specialty / cap / shift for clinical roles). | Platform operators onboard staff cross-tenant. |

## How this package is organized

| # | Document | What it adds |
|---|---|---|
| 00 | `00_CHANGES.md` | Narrative changelog + the kickoff prompt + what is explicitly unchanged |
| 01 | `01_DATA_MODEL_DELTA.md` | New tables (`care_team_members`, `patient_consults`), new columns, new enums |
| 02 | `02_API_DELTA.md` | New/changed REST endpoints and WebSocket events |
| 03 | `03_SCREENS_DELTA.md` | New screens (Care Team, Patient Board) + Director/Developer control specs |
| 04 | `04_WORKFLOWS_DELTA.md` | Unit fan-out & single-accept, board assembly, audited census override |
| 05 | `05_RBAC_DELTA.md` | Permission rules for every new action |
| 06 | `06_REQUIREMENTS_DELTA.md` | New "shall" requirements (FR-CT / FR-PB / FR-DIR / FR-DEV) |
| 07 | `07_BUILD_PLAN_DELTA.md` | Milestones **M15–M18** with per-milestone acceptance checks |

## Design / UI source of truth

The v2 screens are built in the **`ui_kits/web-app/`** prototype (the consolidated clinical kit):
`CareTeam.jsx`, `PatientBoard.jsx`, the enhanced `DirectorDashboard.jsx`, and the enhanced
`DeveloperDashboard.jsx` (`AddUserPanel`). Recreate them in the target stack (React + Vite +
Tailwind + shadcn/ui; Lucide; light mode only; **patients by initials only**) exactly as in v1.

## The four highest-risk new invariants (keep green throughout)

- **CT-ACCEPT-ONCE** — an assignment offered to a unit can be accepted **exactly once**; the first
  accept wins and closes the offer for every other unit member.
- **CT-CENSUS** — acceptance still increments the **attending's** census by 1, regardless of which
  unit member accepted (census is owned by the attending, not the midlevel).
- **PB-TENANT** — the patient board reads **only** the caller's organization, and every load writes
  a `phi_access_logs` row.
- **DIR-OVERRIDE-AUDIT** — a director's manual census edit is an explicit, **audited** correction
  (`hospitalist.census_override`, reason required) — it does not silently bypass the accept/cancel
  rule that governs automated census changes.
