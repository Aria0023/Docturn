# Role logic and interoperability review — November 2026

A functional review of every user type and every hand-off between them, on
the web app and the phone app (the phone app is the same web app in the
installable PWA / native shell, so one review covers both).

## How it was done

1. **Every route as every role.** All 241 API routes were extracted with
   their guards; every `GET` was then called live as a hospitalist director,
   ER director, ER physician, hospitalist and the platform operator, and the
   answers tabulated. Every write route whose permission check lives *inside*
   the handler (not on the route) was read and then exercised.
2. **Every hand-off between roles**, live against a running server:
   registration → approval → first sign-in; add account → one-time password →
   forced change; ER routes an admission → hospitalist accepts / declines /
   times out; deactivation and role change while work is in flight; STAT →
   acknowledge; consult request → answer; billing seat limits across
   add / approve / reactivate; invoice generation.
3. **Each defect became a regression test** before it was fixed
   (`tests/role-interop-review.test.ts`, `tests/billing-invoices.test.ts`),
   and the browser checks were extended for every new control.

## Who can do what (as enforced by the server)

| | Hospitalist director | ER director | ER physician | Hospitalist |
|---|---|---|---|---|
| Message, STAT, forward, templates, on-call board | ✔ | ✔ | ✔ | ✔ |
| Route an admission | ✔ | ✔ | ✔ | — |
| Accept / decline an admission | ✔ (if in rotation) | — | — | ✔ |
| Reassign | ✔ | ✔ | ✔ | — |
| Cancel an admission | ✔ | — | — | — |
| Start / end shift, hand off | ✔ (if in rotation) | — | — | ✔ |
| Request a consult | ✔ | ✔ | ✔ | ✔ |
| Record a consult's answer (accept / decline) | only one addressed to them | ✔ | ✔ | ✔ |
| Remove a consult | ✔ | ✔ | — | — |
| Send a broadcast | ✔ | ✔ | — | — |
| Add / deactivate / reset accounts | every clinical account | ER physicians only | — | — |
| Approve a self-registration | any request | ER-physician requests only | — | — |
| **Change a person's role** | ✔ | — | — | — |
| Rotation, caps, shift assignment | ✔ | — | — | own on/off shift, own cap |
| Edit or remove a patient on the board | ✔ | ✔ | — | — |
| ER roster, diversion | ✔ | ✔ | read diversion | read diversion |
| Org audit trail, compliance | ✔ | ✔ | own activity | own activity |
| Consult-service catalogue | ✔ | add / edit (not remove) | read | read |
| Integrations | ✔ | read only | — | — |
| SSO, SCIM, session policy | ✔ | — | — | — |
| Billing (own hospital) | ✔ | — | — | — |

The **platform operator** (`developer`, organization `DOCTURN`) administers
tenants — organizations, modules, accounts in any tenant, contracts and
invoices — from the developer console. Their own organization holds no
patients, and the patient board, consults and patient threads refuse the role.

Cross-tenant access answers `404` everywhere (no existence oracle).

## Defects found and fixed

### Admission routing (clinical)

| # | What was wrong | Now |
|---|---|---|
| 1 | The same patient could be routed twice (a double tap on Assign, or two ER physicians on one board): two live requests, and accepting both counted the patient twice. | One live request per patient; a second Assign answers `409`. |
| 2 | Accept was "check, then write": the attending and an on-call team member tapping Accept together both succeeded and the census moved by two. The same race existed between Accept and the timeout sweep. | Every state change is one conditional statement in the database; exactly one caller wins. Census moves by SQL increment. |
| 3 | A request could be manually sent to a **deactivated** provider and then sat until it timed out. | Refused before anything is released; the patient stays where they were. |
| 4 | Deactivating a provider left their waiting requests in front of an account that could no longer sign in (up to the full timeout). | Released and re-offered to the next provider at the moment of deactivation (director or identity provider). |
| 5 | "All on shift" put deactivated accounts back on the round-robin. | The round-robin pool, the bulk switch and the single switch exclude accounts that cannot sign in or cannot accept. |
| 6 | Cancelling an already-finished request rewrote its history. | `409`; nothing changes. |
| 7 | An identity-provider role change (hospitalist → ER physician) left the person in the round-robin although the server refuses an ER physician's Accept; the reverse left a new hospitalist with no rotation profile. | The rotation follows the role in both directions. |

### Accounts, registration, billing

| # | What was wrong | Now |
|---|---|---|
| 8 | An ER director could approve a **hospitalist's** self-registration, although everywhere else they add and manage ER physicians only. | ER directors see and decide ER-physician requests only. |
| 9 | Reactivating an account skipped the seat limit that adding one enforces ("deactivate one, add another, reactivate the first"). | Same check, same refusal sentence, audited; the operator is never refused. |
| 10 | Nothing stopped two invoices for the same period — a hospital could be billed twice. | An overlapping period is refused, naming the invoice in the way; voiding re-opens the period. |
| 11 | Username, name and password had no upper bound; usernames accepted any characters. | Bounded; new usernames are letters, digits and `. _ - @ +` (a work e-mail address is valid). |

### Messaging and consults

| # | What was wrong | Now |
|---|---|---|
| 12 | A new conversation could be opened with a deactivated account — a message nobody can ever read. | Refused, with a plain reason on screen. |
| 13 | If the server refused a new conversation, the app silently created a **local-only** thread; a failed role page did nothing at all. | No local thread in a signed-in session; both failures say why. |
| 14 | A sender "acknowledging" their own STAT announced an acknowledgement to the thread that the recipient never gave. | Only acknowledgements that were really recorded are announced. |
| 15 | Any signed-in account could rewrite any consult's status or consultant, including pointing it at another tenant's user id, with no audit row. | Clinical roles only, the consultant must be an active account of the same organization, and every change is audited. |
| 16 | A message body had no size limit. | 20,000 characters. |
| 17 | A do-not-disturb clinician's **covering provider** was still used after that provider's account was deactivated — a forwarded STAT would land in an inbox nobody can open. On-call roles likewise resolved to deactivated holders. | A deactivated account is never a covering provider, and a role held by one is not offered. |

## Enhancements made

* **Change role in place** (People → the person → Change role). A hospitalist
  who becomes a director keeps one account, one message history and one seat.
  The editor states the consequences before anything is sent; the person is
  signed out and signs in again in the new role.
* **Show / hide password** on every password field — on a phone a mistyped new
  password was invisible until the next sign-in failed.
* Deactivated providers no longer appear in rosters, pickers or counts.

## Compared with PerfectServe and TigerConnect

See `docs/COMPETITIVE_AND_COMPLIANCE.md` for the full matrix. The position
after this review:

**At parity for the hospitalist ⇄ ED loop:** role / on-call addressing,
priority and STAT with acknowledgement and escalation, DND with covering,
patient-linked threads, broadcasts with acknowledgement, forwarding,
templates and quick responses, favourites, Done, shift hand-off, on-call
board with Amion / Epic / manual sources, push, retention, audit, MFA, SSO,
SCIM, session policy, per-organization modules, seat billing.

**Where DocTurn is ahead for its niche:** admission round-robin with census,
caps and cap relief, the ER routing board, and consult tracking are built in.
Both incumbents treat patient assignment as an integration or a separate
product.

**Real gaps that remain, in order of how often a hospital will ask:**

1. **Nurses and unit staff are not users.** DocTurn has five roles, all
   physician-side. Both incumbents are nurse-first; a nurse paging the
   covering hospitalist is their core flow. This is the largest functional
   gap and the next role to add.
2. **Voice and video calling.** Both lead with it. A real build (WebRTC, TURN).
3. **Lab / radiology critical-result routing** from an HL7 or FHIR feed.
4. **Scheduling engine.** DocTurn consumes a schedule; it does not generate one.
5. **Operator console / answering service, alarm management, patient and
   family messaging** — separate product lines at both vendors.
6. **Self-serve account recovery.** There is no e-mail on an account, so a
   forgotten password is a director's reset. Correct for a pilot; an
   enterprise will expect SSO (built) to make this moot.

## Verification (final code)

* Server suite: 113 files, 1,159 tests passing (8 skipped by design).
* Real-browser checks, each on its own freshly seeded server: phone layout at
  375 / 390 / 430 px 1,344 · themes 1,723 · phone shell 227 · org-admin 162 ·
  final 116 · developer 111 · UI smoke 106 · clinical 98 · comms 96 ·
  quick responses 93 · PIN 85 · integrations 85 · phone messaging 82 ·
  shift hand-off 69 · billing 68 · Done 63 · unread reminder 59 · realtime 58 ·
  favourites 51 · CSP 45 · audit export 45 · next-up 43 · login 41 ·
  alert sounds 41 · retention 41 · session policy 40 · SCIM 37 ·
  role contacts 36 · SSO 32 · cross-device interop 21 — no failures.
* Production bundle: load check 27 / 27 and login 41 / 41 against the compiled
  client.

## Still not provable from here

* Real-device behaviour (push while locked, Face ID, the native shells) —
  the device checklist in `docs/MOBILE.md`.
* SSO against a real Okta / Entra tenant; multi-instance behaviour on a real
  Postgres.
