# Consult-services registration

## Part A — DONE
The ER intake **Consult services** roster and PA/NP **midlevel pool** are
driven by the server, never hardcoded lists (A.CON clinical #19-#23):
- On-call consultant per specialty: the org catalog's pinned on-call
  (Directory → Consult services), else the registered provider of that
  specialty whose shift is active now. With nobody registered the panel says
  "No on-call assigned" — there is no demo fallback.
- The "Add PA / NP" pool is the org's **real, active** PA/NP/RN accounts (any
  role — a PA without a rotation profile is included), each with its account
  id. An org with none offers no picker.
- Each ticked consult is sent with the admission: after `POST /api/patients` +
  `POST /api/assignments`, one `POST /api/patients/:id/consults` per service
  naming the team (on-call + PA/NPs, `{ name, userId? }`). The server refuses
  a `userId` that is not an active account of the org (`400
  unknown_consultant`).
- Who is alerted is the server's decision: every named consultant **with an
  account** gets a `CONSULT_REQUESTED` socket frame (ids only) and a
  content-free push ("New consult request"); names without an account are
  recorded, not paged. There is no per-consult "App push / Text" channel. The
  confirmation names who was alerted, or says nobody was.

Source of truth: `store.orgPeople` / `store.directory` (hydrated by the bridge).

## Part B — DEFERRED (do once the app is fully launched)
Self-registration via an organization code:
- Per-org **join/registration code** (admin-visible in director settings).
- Public "register with code" screen → pick role + credential (PA/NP/MD/…) +
  specialty → creates the org user (pending admin approval).
- On approval the person flows into the directory and therefore into Consult
  services automatically (Part A already handles the downstream).

This is an onboarding/auth feature (DocTurn is currently admin-provisioned), so
it's parked until launch.

### What the server already enforces (server/auth.ts, launch remediation)
`POST /api/register` (public) and the director queue follow this contract —
the login screen should map these codes rather than show a generic failure:

| Case | Answer | Why |
| --- | --- | --- |
| Unknown org code, **or the platform org `DOCTURN`** (any casing) | `201 { pending: true }` — exactly what a real org answers, after the same work (one password hash); a re-send of the same code + username → `409 request_pending`, also exactly like a real org | Not an org-code oracle (A.CON-SHO-11). The request is **dropped**: nothing reaches any director's or the operator's queue (the operator tenant never takes public requests — A.CON-SHO-15) and no credential is kept; only an opaque SHA-256 key of (org code, username) is stored in `unrouted_registrations` so the re-send answers 409. The drop is audit-logged on the platform org (`auth.register_unrouted`, low risk, `reason: unknown_org \| platform_org`). The form therefore only promises a review "if the organization code is right". |
| `requestedRole` is `director` / `er_director` / `developer` | `400 role_not_self_registrable` | Privileged roles are provisioned by an existing director (People → add) or the operator, never self-requested (A.CON-SHO-15). Only `hospitalist` and `er_doctor` can be requested. |
| Password shorter than 8, the demo password, or "password" | `400 weak_password` | Same floor as PATCH /api/account/password (A.CON-SHO-16). |
| Username already has an account | `201 { pending: true }` — same as a fresh request | Never a username oracle (A.CON-SHO-11). The row reaches the queue with `usernameTaken: true`; approving it answers `409 username_taken`, denying clears it. |
| A request for that username is already pending | `409 request_pending` | One pending row per (org, username), enforced by a partial unique index (A.CON-SHO-8). A denied request frees the name. Answered the same for an unknown org (see above). |
| More than 10 requests per client per hour (when rate limiting is on) | `429 rate_limited` | Counts successes too; the auth limiter counts only failures (A.CON-SHO-15). Same body and same client key as every other limiter (`clientIpKey`: trusted-proxy address, IPv6 per /64). |

Queue actions are idempotent: approving an approved request → `200 { userId,
alreadyApproved: true }`; denying a denied one → `200 { ok, alreadyDenied }`;
approve after deny → `409 already_denied`; deny after approve → `409
already_approved`. No path can hang on the users unique index any more.

---

# Parked: Amion scoping (remember for later)
The **Amion** schedule-sync source should be available/enabled **only** for the
Cedars organizations — **Providence Cedars-Sinai** and **Cedars-Sinai Medical
Center** — and NOT defaulted (or offered as the default) for other tenants.
Other orgs use their own sources (QGenda, Word, PDF, online, none).

Current state: each org's source is the server's (org setting
`scheduleSource`, `PATCH /api/oncall/source`; amion / epic / manual only), and
Amion is offered per org through the `schedule.amion` module switch. The old
browser-side `scheduleSources` map (and its demo presets) is gone. When the real
Cedars tenants exist, select Amion for those two and keep `schedule.amion` off
for the others.
