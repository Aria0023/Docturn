# DocTurn — Engineering Specification & Build Package

A **complete, self-contained specification** for building DocTurn from scratch. Everything a
developer (or Claude Code) needs is in this folder — product context, architecture, the full data
model and API contract, RBAC, workflows, integrations, screens, the systems-engineering model
(use cases → functions → requirements), the configurability layer, traceability, the test plan,
and a milestone build order. The UI source (kits, tokens, design spec, test suite) lives at the
project root — download the whole project to get it alongside these docs.

> **Kickoff prompt for Claude Code:**
> *"Implement DocTurn from this specification. Read `00_OVERVIEW.md` then `14_BUILD_PLAN.md`, and
> build milestone by milestone, running each milestone's acceptance checks before moving on.
> Treat `10_SYSTEM_REQUIREMENTS.md` as the acceptance contract. Recreate the UI in `../ui_kits/`
> (React + Vite + Tailwind + shadcn/ui; Lucide; light mode; patients by initials only). Notifications
> are **push-first with timeout-gated SMS escalation** and a per-org, developer-configurable delivery
> profile (`05_WORKFLOWS.md §4`, `06_INTEGRATIONS.md`); push/SMS payloads carry **no PHI**. Keep every
> storage query org-scoped and the server authoritative. The app must boot and pass tests with no
> external secrets (all integrations have local stubs). Satisfy the messaging acceptance matrix in
> `13_TEST_PLAN.md`."*

---

## What DocTurn is

A multi-tenant, HIPAA-oriented platform that coordinates **patient assignment** (ER → hospitalist)
and **secure clinical messaging** inside hospitals, on web and mobile. Marketed publicly as
**DoctorHeidi**. The defining constraints: every record is isolated to one organization, and the
server is authoritative for routing, expiry, roles, and MFA.

## How to read this package

Read in order. Each document is focused and cross-references the others by number.

| # | Document | What it defines |
|---|---|---|
| 00 | `00_OVERVIEW.md` | Product, roles, capabilities, scope, glossary |
| 01 | `01_ARCHITECTURE.md` | System shape, stack, principles, request lifecycle, repo structure |
| 02 | `02_DATA_MODEL.md` | Full schema (all tables), enums, relations, the assignment state machine |
| 03 | `03_API_CONTRACT.md` | Every REST endpoint + the WebSocket protocol |
| 04 | `04_RBAC.md` | Roles, the permission matrix, and how authorization is enforced |
| 05 | `05_WORKFLOWS.md` | Assignment flow, round-robin algorithm, expiry, notifications, messaging, MFA |
| 06 | `06_INTEGRATIONS.md` | OpenAI / Twilio / Firebase / Amion as live ⇄ stub interfaces |
| 07 | `07_SCREENS.md` | Each UI screen → the endpoints + state it needs |
| 08 | `08_USE_CASES.md` | 31 use cases (actors, flows, pre/postconditions) |
| 09 | `09_FUNCTION_LIST.md` | Functional decomposition F1–F17 with subsystem allocation |
| 10 | `10_SYSTEM_REQUIREMENTS.md` | **67 "shall" requirements — the acceptance contract** |
| 11 | `11_CONFIGURABILITY.md` | Runtime tweaks & adaptive defaults (config milestones) |
| 12 | `12_TRACEABILITY.md` | Bidirectional UC ⇄ Function ⇄ Requirement coverage |
| 13 | `13_TEST_PLAN.md` | What to test, seed data, critical paths, definition of done |
| 14 | `14_BUILD_PLAN.md` | Milestone build order with per-milestone acceptance checks |
| — | `html/` | The systems-engineering model as styled HTML (for human review/sign-off) |
| — | (project root) | **UI kits, design tokens, the full design spec, and the runnable test suite** (see below) |

## Design / UI source of truth (at the project root)

The clinical UI's visual source lives at the **project root** (one level up from this folder) and is
included when you download the whole project:

| Path (from project root) | Contents |
|---|---|
| `ui_kits/web-app/` | Clinical web app kit — all role dashboards, login, messaging, settings. `index.html` is a runnable click-through (state in `store.js`). |
| `ui_kits/mobile/` | Expo-style mobile kit — `all-roles.html` runs every role. |
| `ui_kits/marketing/` | DoctorHeidi marketing landing kit. |
| `colors_and_type.css` | Design tokens (color incl. status/healthcare, type, spacing, radius, elevation). |
| `DocTurn Final Design Spec.html` | The full production design spec (incl. §9b notification architecture & messaging acceptance). |
| `tests/DocTurn Test Suite.html` | Runnable prototype verification suite (80 checks: store logic, web + mobile UI, cross-surface messaging for every role, duplication/perf audit). |

The frontend should **recreate these designs** in the target stack (React + Vite + Tailwind +
shadcn/ui; Lucide icons; light mode only; patients shown by initials only) — the HTML kits are
high-fidelity references, not production code to ship. The `html/` folder is engineering
documentation, not the UI.

## Stack (summary)

Node 20 · Express · TypeScript (ESM) · Drizzle ORM + PostgreSQL · Zod · Passport (local) +
express-session (connect-pg-simple) · `ws` · Vitest + Supertest. Web: React 18 + Vite + Tailwind +
shadcn/ui + wouter + TanStack Query. Mobile: Expo / React Native. Integrations: OpenAI, Twilio,
Firebase FCM, Amion — each behind an interface with a local stub so the app runs with zero secrets.

## Definition of "done"

A complete implementation satisfies **`10_SYSTEM_REQUIREMENTS.md`**: all **Must** requirements pass
their stated verification (mostly automated **Test**); **Should** implemented or explicitly
deferred; **Could** built at their milestone. The four highest-risk invariants — census (RR-01),
reroute exactly-once (RR-02), accept-only census change (FR-ASG-04), tenant isolation (SEC-02) —
must stay green throughout.

## Guardrails (apply throughout)

- **Every** storage method takes `organizationId` and filters by it. No exceptions.
- The server is authoritative for routing / expiry / roles / MFA — never trust the client.
- Never return secrets or password hashes; push/SMS payloads carry **no PHI**; patients shown by initials.
- Keep routes thin; put logic in `services/` so it is unit-testable without HTTP.
- No secret is required to run or test — integration stubs activate automatically when env vars are absent.
