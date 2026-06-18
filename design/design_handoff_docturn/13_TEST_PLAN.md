# 13 — Test Plan

Goal: every critical path is covered by a **deterministic API integration test** that runs with
**no secrets** against a test database. Use **Vitest + Supertest**.

## Harness (`tests/helpers.ts`)

- `createTestApp()` — builds the Express app against a fresh test database, runs `db:push` (or
  migrate) and a minimal seed, returns `{ app, db }`.
- `login(app, { orgCode, username, password })` — posts to `/api/login`, returns a Supertest agent
  carrying the session cookie.
- Seed a known org `MERCY` with one user per role and a few providers/patients.

## Seed data (`server/seed.ts`, also used by tests)

- **1 org:** Mercy General (`MERCY`).
- **Users:** `director`, `er.doc` (er_doctor), hospitalists `chen`, `patel`, `lopez` (working),
  `liu` (off). Dev password for all: `docturn`.
- **Providers:** varied census/cap (Chen 3/12, Patel 5/12, Lopez 7/10, Liu 2/8 off).
- **Patients/assignments:** a couple of pending assignments so the hospitalist dashboard isn't empty.
- Deterministic (fixed ids/ordering) so tests can assert exact selections.

## Critical-path tests

### `auth.test.ts`
- login good creds → `200` + sanitized user (**no `password_hash`**).
- login bad creds → `401`. Protected route without session → `401`.
- `hospitalist` hitting a `director`-only route → `403`.
- cross-tenant: a user from org A cannot read org B's resources → `404/403`.
- MFA path: a 2FA-enabled user → `202`, then `2fa/complete-login` with a valid code → `200`; a
  reused backup code → rejected.

### `assignments.test.ts` (the most important file)
- **round-robin picks lowest census:** `round_robin` → targets Chen (3), not Patel (5).
- **accept increments census, reject does not.**
- **reject reroutes:** exactly one new `pending` for the next eligible provider.
- **expiry reroutes:** force `expires_at` into the past, run the tick → `expired` + one new pending.
- **cap relief:** every working provider at cap → selection still returns someone; never a provider
  from another org.
- **manual assignment:** `mode:'manual'` targets exactly that provider.
- **cancel:** director cancels an accepted assignment → `cancelled` + census decremented.

### `messaging.test.ts`
- create a direct conversation, send a message → recipient fetches it; a **non-participant gets
  `403`**. `mark-read` sets `read_at`; unread count drops. Sender soft-delete writes an audit row.

### `notifications.test.ts` — delivery & escalation
- **push-first:** a new assignment WS-pushes + sends one **content-free** push; `push`-mode org
  sends **no SMS**.
- **escalation gated on ack:** with `mode:'push_sms'`, leave the assignment unacknowledged past
  `escalationTimeoutSec` (use fake timers) → exactly one `smsFor(carrier).send` call; acknowledge
  before the timeout → **zero** SMS.
- **no PHI in payloads:** assert push/SMS bodies contain no patient initials, room, or diagnosis.
- **carrier selection:** switching `notification_profile.smsCarrier` routes to the matching adapter.

## Messaging acceptance matrix (must pass before ship)

Verify **both directions** × **both surfaces** × **all five roles**. Items 1–2 are unit/integration;
3–7 are live integration on staging with two real sessions/devices (mirrors `Final Design Spec §9b.8`).

| # | Test | Pass condition | Where |
|---|---|---|---|
| 1 | Each role sends a 1:1 message | Stored & rendered (`me:true`); read receipt updates | `messaging.test.ts` + kit suite |
| 2 | Each role receives a message | Rendered (`me:false`); unread clears on open | `messaging.test.ts` + kit suite |
| 3 | Web ↔ web, both directions, all roles | Message in session A appears live in session B (same org) | integration (staging) |
| 4 | Mobile ↔ web, both directions, all roles | Message on mobile arrives on web (and vice-versa) over `/ws` | integration (staging) |
| 5 | Group / care-team thread | All members receive; per-member read state tracked | integration (staging) |
| 6 | Out-of-app delivery | Backgrounded recipient gets content-free push; SMS only after ack timeout | integration (staging) |
| 7 | Tenant isolation | A message never crosses `organization_id`; cross-tenant send rejected | integration (staging) |

> The bundled front-end kits include a runnable suite (`tests/DocTurn Test Suite.html`, 80 checks)
> that already proves items 1–2 for every role on both the web and mobile composers, plus store
> logic and a duplication/perf audit. It is a **prototype** harness — items 3–7 need the real
> WebSocket + push backend you are building.

### `config.test.ts`
- a director PATCH to `org_settings` (e.g. timeout) takes effect on the **next** assignment with no
  restart; a non-director PATCH to org policy → `403`; an out-of-range value → `400`.

## Manual / smoke checks

- `npm run dev`, log in as each role, walk the flows in `07_SCREENS.md`.
- Two tabs (hospitalist + ER) to see an assignment appear live via WebSocket and messages arrive in
  real time.

## Definition of done

`npm test` green; `npm run seed && npm run dev` boots with **no secrets**; the screens in
`07_SCREENS.md` work end-to-end against the real API; the invariants in `05_WORKFLOWS.md` hold; and
the **Must** requirements in `10_SYSTEM_REQUIREMENTS.md` pass their verification.
