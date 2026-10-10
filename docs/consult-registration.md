# Consult-services registration

## Part A — DONE
The ER intake **Consult services** roster and PA/NP **midlevel pool** are now
driven by the live registered directory (`/api/physicians/directory`), not
hardcoded lists:
- On-call consultant per specialty comes from registered providers (prefers a
  working provider); falls back to demo data for any service with nobody
  registered.
- The "Add PA/NP" pool comes from registered midlevels (credential PA/NP/RN —
  added via People → "Consultant (PA/NP)").
- So a newly registered consultant or midlevel appears **automatically**; the ER
  can still attach them to a consult **manually**.

Source of truth: `store.directory` (hydrated for all roles by the bridge).

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
