# DocTurn — Clinical Web App UI Kit

An interactive, high-fidelity recreation of the DocTurn clinical web SPA, covering the clinical
**and** the admin / platform surfaces specified in the reference documents
(`DocTurn-Style-Guide.pdf`, `DocTurn-Requirements-and-Data-Model.pdf`, `DocTurn-Engineering-Spec.pdf`).
Open **`index.html`** for the click-through prototype.

## Screen coverage
Core clinical screens — Login, Hospitalist, ER physician, Director, Messaging, Directory — plus the
spec-driven admin & platform surfaces below.
This version adds the spec-driven gaps:

| New screen | File | Spec source |
|---|---|---|
| **Developer portal** — cross-tenant orgs, system health, AI monitor, live logs | `DeveloperDashboard.jsx` | Eng §10.2 · Req FR-10.1/10.2 · FR-9.2 |
| **Audit & Compliance** — audit log / PHI access / security incidents (tabbed) | `Compliance.jsx` | Req FR-11 · NFR-2 (HIPAA) |
| **Emergency Broadcasts** — severity composer, targeting, ack tracking | `Broadcasts.jsx` | Req FR-6.5 |
| **Hospital Resources** — department capacity, beds, equipment, alerts | `Resources.jsx` | Req FR-8 |
| **Organization Settings** — timeout, round-robin rules, shift types, feature flags, integrations | `OrgSettings.jsx` | Req FR-2.2–2.4 · Eng §9 |
| **My Care Team** — link NPs/PAs/partner doctors into a shared on-call unit | `CareTeam.jsx` | New capability |
| **Patient Board** — hospital-wide distribution: responsible attending + unit, consultants, admitting ER physician | `PatientBoard.jsx` | New capability |
| **Developer role** added to login + role switcher | `LoginScreen.jsx`, `index.html` | Eng §1.1 |

## Try it
1. **Login** — pick a demo role. **Developer** is new (4th tile).
2. **Developer** → Organizations (cross-tenant table), Compliance, Tenant settings.
3. **Director** → Overview, **Resources**, **Broadcasts**, Messages, Directory, **Compliance**, **Settings**.
4. Use the **role switcher** (top bar) to jump roles; nav updates per role.
5. **Broadcasts** — set severity, target audience, toggle "require acknowledgement", Send (toast).
6. **Compliance** — switch the Audit / PHI / Incidents tabs.
7. **My care team** (Hospitalist / ER) — *Add member* links an NP, PA or partner; toggle *On call*. While both are on call they form a connected unit, and the Hospitalist dashboard shows requests are shared with the unit.
8. **Patient board** (Hospitalist / ER / Director) — every distributed patient, the responsible attending **+ their on-call unit**, a consultants column, and the admitting ER physician. Filter by unit; search; directors can export census.

## Conventions honored
- One primary action per view; status color always paired with an icon/label.
- Red = destructive/critical, amber = pending, emerald = accepted/online, blue = active/sent,
  slate = offline/neutral. Light mode only; rounded-md controls, rounded-lg cards, soft shadows.
- Patients referenced by **initials only** — no PHI anywhere.
- The Developer surface is the *only* cross-tenant view, and it says so (audited banner).
- Cosmetic recreation — no real auth, network, or persistence.
