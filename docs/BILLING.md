# Organization billing

DocTurn — the **platform operator**, organization code `DOCTURN`, role
`developer` — bills each **hospital** (a tenant organization). A hospital's
directors see their own billing; the developer console is the operator's view.
Nobody else in a hospital sees billing at all.

Sales-led, enterprise. There is no self-serve checkout, no card on file by
default, and no price anywhere that a human did not type. Money is **integer
cents** everywhere; a contract's currency is fixed.

---

## 1. The safety invariant

DocTurn carries STAT messages and admission routing. **Billing must never be
able to interrupt patient care.**

Entitlement checks exist in **exactly two places**:

1. creating a **seat** (a new user account), and
2. creating a new **organization**.

Nothing else is ever gated by billing — not messaging, not STAT, not
escalation, not broadcasts, not assignments, not on-call, not the schedule, not
sign-in. A lapsed contract degrades to **warnings** and **"cannot add
accounts"**, never to a clinician unable to send or receive.

### How it is proved, not merely intended

`tests/billing-safety-invariant.test.ts` holds two halves, and both run in
every later gate:

* **Static.** `server/billing/entitlements.ts` is the one module that can
  refuse anything. The test walks every `.ts` file under `server/` and asserts
  that the set which imports it equals an exact allow-list
  (`server/routes/providers.ts`, `server/auth.ts`, `server/routes/dev.ts`, and
  the two billing read surfaces `server/routes/billing.ts` and
  `server/routes/dev-billing.ts`). Adding the import anywhere else fails the
  suite. It also asserts that no care-path file mentions billing at all, and
  that the single billing rule in `GATE_TABLE` cannot match `/api/messaging/send`,
  `/api/broadcasts`, `/api/assignments`, `/api/oncall/board`, `/api/admissions`,
  `/api/er/diversion`, `/api/login`, `/api/shift/end` or `/api/rotation/next`.
* **Behavioural.** With the organization's contract `past_due`, and again with
  it `expired`, and with `committedSeats` already exceeded: an ER doctor signs
  in, opens a conversation and sends a **STAT** message; a patient is created
  and **round-robin routed**; a hospitalist **accepts** the admission; a
  director raises a **critical broadcast** and a hospitalist **acknowledges**
  it; the **on-call board** and the escalation-facing on-call targets both
  answer 200. The only thing refused is adding a new account.

### Past due

A past-due contract behaves **exactly** like an active one for
`PAST_DUE_GRACE_DAYS` = **30 days** from `org_contracts.past_due_at`. The
hospital's directors and the operator are warned from the first day, on both
billing screens, with the number of days left. When the grace period runs out
the **only** change is that a new account is refused. The grace clock is not
reset by an unrelated edit to the contract.

---

## 2. What a billable seat is

> A **billable seat** is a user in a tenant organization who is **not
> deactivated** and whose role is **not `developer`**.

Written once, in one function — `isBillableSeat` in `server/billing/seats.ts`,
over `BILLABLE_SEAT_ROLES` in `shared/billing.ts`, which is derived from
`ROLES` so a new clinical role becomes billable the day it is added rather than
silently escaping the count. The SCIM path, the People screen, the entitlement
check and the invoice all call it, so they cannot disagree about who is being
charged for. Developers are the operator's own staff, and the platform
organization is never counted and never snapshotted.

Deactivating a leaver frees the seat immediately — the same
`users.disabled_at` the account routes and SCIM `active:false` already set.

### Seat snapshots

`seat_snapshots` holds one row per organization per **calendar day in that
organization's own timezone** (`organizations.timezone`), because that is the
day a hospital will argue about: an invoice line cites these dates, so
"you charged me for 47 accounts on 3 March" can be answered from the row.

Consequences, both deliberate:

* The sweep ticks **hourly**, not daily, through one job lease
  (`seat-snapshot`): every organization's local midnight falls inside some
  hour. With N instances exactly one writes each tick.
* The write is an **upsert on `(organization_id, snapshot_date)`**, so the row
  for the organization's current local day is corrected as people are added or
  deactivated, and stops changing once the sweep moves to the next local day.

An unknown `organizations.timezone` falls back to UTC rather than throwing away
the whole sweep; the row records the timezone it used.

Every tenant is snapshotted whether or not the `billing` module is on, so the
day the operator puts a hospital on a contract there is already history to
invoice from. A seat count and a role breakdown are not PHI.

---

## 3. Plans and contracts

`billing_plans` — the operator's catalogue: a code, a name, the module ids the
plan **grants**, a per-seat price in integer cents, a currency. **Nothing is
seeded**: a price nobody typed would be demo data shown as real. Plans are
created in the developer console.

`org_contracts` — **one per hospital**, the operator's own record of what was
agreed: plan, term (`monthly` | `annual`), start date, optional end date,
committed seats, optional price override, PO number, billing contact name and
email, status (`trial` | `active` | `past_due` | `cancelled` | `expired`),
`past_due_at`, net terms (`days_until_due`), and the Stripe fields.

* A **trial is a plan with an end date**, not a special mode.
* `expired` is computed **on read** from the end date, so a contract can never
  look live because a timer was down.
* Every operator write is audited **in the tenant's own trail** at medium risk
  (`billing.contract_set`, `billing.contract_clear`,
  `billing.contract_read`), with ids, a plan code, a term, a status and counts
  — never the billing contact's name or email.

### Plans only GRANT

The per-org module switches (`shared/modules.ts`) stay authoritative. A plan
**never** switches a module off, never changes the effective module map, and
never hides a screen. Its single effect is that a **director's** attempt to
switch **on** a module the plan does not include is refused with
`not_in_plan`; the operator can still switch it on from the developer console,
which is already how every module works.

---

## 4. Judgment calls

### A tenant with no contract is unlimited and unbilled

Not "implicitly on a default plan". An implicit plan would have to name its
module set and its seat count, and both would immediately change what existing
hospitals see — a plan-excluded module would start telling directors "not in
your plan", and a default seat count would start refusing accounts. The brief
requires that an existing tenant's behaviour not change **at all** until the
operator puts it on a contract, so: **no contract means no billing
relationship** — no plan restriction, no seat limit, no invoice. Every tenant
today is in this state.

A **storage failure** reading the contract or counting seats is treated the
same way: allow, and log the error type only. A hiccup in a billing table must
never stop a director adding a clinician.

### What the director sees with billing on and no contract yet

The real seat count (live, and the latest snapshot **with its date**), and one
plain sentence: *"No billing contract is on file for this organization. Nothing
is billed. DocTurn will tell you before that changes."* No invoice list, no
plan name, no editable billing contact (it is a contract field), no price.
Nothing is invented.

### An identity provider is never refused a seat

SCIM and SSO just-in-time accounts (`server/services/provisioning.ts`) and
schedule-sync accounts (`server/services/amion.ts`) do **not** consult the
entitlement module at all. A refused IdP push strands a clinician outside
DocTurn's own UI, with nothing on any screen to explain it — exactly the silent
failure the invariant exists to prevent. Those seats simply appear, show up in
the next snapshot, and are charged as an **overage line**. Over-committed usage
is an invoice line item, never a blocker.

### The operator is never refused

A developer adding an account from the console is never blocked by billing —
they are the party doing the billing. An add that takes a hospital past its
committed seats is recorded as `billing.seat_override` in **that hospital's**
trail, so the overage line on the next invoice is not a surprise.
## 5. Invoices — the manual path

An invoice is generated from the contract and the seat snapshots, and it
**cites the snapshot dates it counted**, so every number is auditable against
`seat_snapshots`.

* The billable count for a period is the period's **daily maximum** — the most
  accounts the hospital had on the system — and the line names the date(s) it
  occurred on.
* There are at most two lines: the **committed accounts**, and any accounts
  **above the commitment** at the same per-seat price. Over-committed usage is a
  line item, never a refusal.
* With **no snapshot in the period** the generator refuses (409 `no_snapshots`)
  rather than invent a count. There is nothing a line could cite.

### Invoice numbers are gap-free and never reused

The number is allocated from a `billing_counters` row **inside the same
transaction** as the invoice row (`UPDATE … SET value = value + 1 RETURNING
value`, which takes a row lock, so concurrent generations serialise). A
transaction that rolls back gives the number back; a committed one can never
be issued twice. A **void keeps its number forever** — the sequence stays
gap-free and the hospital's records still line up.

### Lifecycle

`draft` → `issued` → `paid`, with `void` reachable from `draft` and `issued`.

* A **draft** is the operator's working copy. The hospital cannot download it,
  because it has not been issued to anybody.
* **Issuing** stamps the time and computes the due date from the contract's net
  terms (`days_until_due`). An issued invoice is immutable except for its
  status.
* **Void** requires a reason. It is the only correction path.
* **Paid** has exactly two possible sources, both recorded on the row: the
  operator's own action (`paid_source = 'operator'`, their user id, the time,
  their payment reference) or a Stripe webhook event (`paid_source =
  'stripe'`, the **event id** in `paid_reference`). There is no third source
  and there are no mock invoices.

Every operator action — generate, issue, void, mark paid, change a plan or a
contract — is audited **in the tenant's own trail** at medium risk.

### Proration

**A mid-term plan change is prorated on the NEXT invoice, never
retroactively.** This is not a calculation DocTurn performs behind the scenes;
it is what the mechanism does. Generation reads the contract **as it is now**,
and an issued invoice is never recomputed. Change a price today and the
already-issued invoice is untouched; the next one carries the new price. The
only way to correct an issued invoice is to void it and reissue. Both billing
screens say so.

### The hospital's download

`GET /api/billing/invoices/:id/download` streams CSV in the audit-export shape:
rows written as they are produced, every cell through `csvCell` so nothing a
spreadsheet would run as a formula escapes, and its own rate-limit budget. The
columns are an invoice number, a status, the hospital's own name, dates, counts
and cents — no PHI by construction. The download is audited.

### Tenant delete — decided and documented

* `seat_snapshots` and `org_contracts` **leave with the tenant**: a seat count
  and a commitment mean nothing without the organization they describe.
* `billing_invoices` **do not**. An invoice is a financial record of the
  operator's own business, so inside the delete transaction each one is copied
  into `retained_invoices` — no foreign keys, denormalized, carrying the
  organization's code and name — and only then deleted, exactly the way
  `retained_compliance_records` keeps the compliance trail and `dev.org_delete`
  retains its record. `tests/billing-invoices.test.ts` and the `dev-audit`
  atomicity test both assert it.

---

## 6. Stripe — the collection rail

Module `billing.stripe`, default **off**, requires `billing`. A platform-scope
entry in the existing integration registry, so it inherits the real "Test
connection", the statuses (`active` / `off` / `not_configured` / `error`) and
the Integrations panel.

**Stripe is not the source of truth.** The contract is ours, the invoice is
ours, the seat counts are ours. Stripe collects money and tells us when it
arrived.

**Stripe Subscription objects are deliberately not used.** A hospital's terms
live in a signed contract with net terms and a PO number; a Subscription would
become a second, divergent source of truth for the price, the seat count and
the renewal date. Instead, per invoice: ensure a **Customer** for the hospital
(remembered on the contract), create one **Invoice Item** per line of our
invoice, create a Stripe **Invoice** with `collection_method: "send_invoice"`
and `days_until_due` from the contract — the ACH / PO / net-30 path hospitals
actually use — and finalize it.

### What is sent, and why it is not PHI

Only billing facts leave DocTurn:

* the hospital's **name**, and its **billing contact's** name and email — the
  people who pay the bill, named on the bill, exactly as on a paper invoice;
* the **PO number**, the **currency**, the **net terms**;
* **seat counts**, and the invoice line descriptions and cents;
* reconciliation ids (`docturn_org_id`, `docturn_invoice_number`, the cited
  snapshot dates).

**None of this is PHI and no BAA is required.** There is no patient, no
patient–clinician relationship, no clinical content, no message text, no room,
no initials and no identifier of a person receiving care in any of it.

That is enforced, not intended. Every payload is built by projecting a
candidate object through a **positive allow-list** (the same pattern as the
audit export's `safeDetails`), and `buildStripePayload` **throws** on any key
outside the list. A test feeds it patient-shaped fields and asserts the refusal.
The local stub records every request body, so the end-to-end test asserts what
actually went over the wire.

### Outbound email is off by default

`send_invoice` makes **Stripe email the hospital**, so emailing is **one
explicit call**, not a flag:

* the Stripe Invoice is created and finalized with `auto_advance: false` at
  both ends, so Stripe never chases or emails it on its own;
* **only** when the contract carries `stripe_send_invoice_email` (false by
  default) does DocTurn then call `POST /v1/invoices/:id/send`.

With no opt-in that call is never made, so there is no setting anywhere that
could quietly send one — and the route reports `emailed: true`, and the console
says "Stripe will email the hospital's billing contact", only when that call
actually succeeded. The audit row records both the opt-in and what happened.

(An earlier shape passed the opt-in as `auto_advance` on the create and then
finalized with `auto_advance: false`, silently overwriting it: the screen would
have claimed an email the server never sent. `tests/billing-stripe.test.ts` now
asserts the **finalize** form as well as the create form, and that the `send`
call is absent without the opt-in and present with it.)

### Webhooks

`POST /webhooks/stripe`, mounted **outside** `/api`: it is unauthenticated (the
signature is the authentication), it must not share the `/api` rate-limit
budget with a hospital's clinicians, and it must read the **raw** body — so
`server/app.ts` excludes that one path from the global JSON parser and the route
mounts `express.raw` itself.

* **Signature verification first**, on the raw bytes: `t=…,v1=…`, signed
  payload `${t}.${rawBody}`, HMAC-SHA256 under `STRIPE_WEBHOOK_SECRET`,
  timing-safe, every `v1` in the header (Stripe sends two during a rotation),
  300-second tolerance. An unsigned, mis-signed or stale delivery changes
  nothing and is answered with one shape, so the endpoint is not an oracle.
* **Idempotency keyed on the Stripe event id**: the row goes into
  `billing_events` **first**, under a unique index, so a redelivery is
  recognised before anything is applied and answered 200 — Stripe must not keep
  retrying a delivery we already honoured. `billing_events` also records every
  status transition, whoever caused it.
* The tenant is resolved from **our** records — the Stripe Customer we created
  or the invoice id we put in the metadata ourselves — never from anything the
  payload claims about an organization. An event whose customer and invoice
  disagree changes nothing.
* `invoice.paid` → our invoice becomes paid with `paid_source = 'stripe'` and
  the event id. `invoice.voided` → our invoice becomes void.
  `invoice.payment_failed` → **the contract goes past due**, which starts 30
  days of warnings; the invoice stays issued, because it has not been paid.

### No key in this repository

There is no Stripe key in the development environment and none is committed.
Everything above is built and tested against a **local Stripe-shaped stub**
(`tests/fixtures/stripe-stub.ts`), the way `tests/fixtures/oidc-issuer.ts` is
used for OIDC. The stub's secrets are assembled from fragments at runtime so no
string in the repository looks like a credential to a secret scanner.

---

## 7. Who sees billing

| | Hospital's Settings → Billing | Developer console → Billing |
|---|---|---|
| director | yes (module `billing` on) | no |
| developer (operator) | n/a | yes |
| er_director, er_doctor, hospitalist | **no** (403) | no |

The operator's console routes (`/api/dev/billing/*`) are developer-only and are
deliberately **not** gated by the `billing` module: the console has to work in
order to switch billing on for a hospital.

---

## 8. Operator runbook

**Put a hospital on a plan**

1. Developer console → Billing → **Plans**. Create the plan if it does not
   exist: a lower-case code, a name, the price **in integer cents** per
   account, the currency, and the modules the plan grants. Nothing is seeded,
   so the first plan is always created by hand.
2. Find the hospital under **Hospitals** and press **Set up**. Choose the plan
   and the term, set the start date, the committed accounts, the net terms, the
   PO number and the billing contact. For a **trial**, set status `trial` and
   give it an **end date** — that is all a trial is.
3. Developer console → the hospital's modules → switch **Organization
   billing** on. Until you do, the hospital's directors see no billing screen
   at all and nothing changes for them.

**Issue the first invoice**

4. Check the hospital has at least one **seat snapshot** in the period you are
   invoicing (it is written hourly for every tenant, in the hospital's own
   timezone). Without one the generator refuses rather than invent a count.
5. Under the hospital, enter the period and press **Generate draft**. Read the
   lines: the committed accounts, and any accounts above the commitment with
   the snapshot date(s) they peaked on.
6. Press **Issue**. The number is already fixed; issuing sets the due date from
   the net terms and makes the invoice downloadable by the hospital.

**Mark it paid**

7. When the money arrives, press **Mark paid** and enter the payment reference
   (cheque / ACH / wire). The row records your user id and the time, and the
   action is audited in the hospital's own trail. This is the only way an
   invoice becomes paid by hand — there is no "mark everything paid".

**Handle past due**

8. Set the contract's status to `past_due`. The clock starts that moment: the
   hospital's directors and you see a warning from day one, with the number of
   days left, and **nothing else changes for 30 days**.
9. After 30 days the only change is that the hospital cannot add a new account.
   Messaging, STAT alerts, escalation, broadcasts, admission routing, the
   on-call board, the schedule and sign-in are never affected — not during the
   grace period and not after it.
10. When it is settled, set the status back to `active`. The grace clock is
    cleared.

**A wrong invoice**

11. **Void** it with a reason and generate a new one. Never edit an issued
    invoice: the number is kept forever, and the new invoice gets the next
    number in the sequence.

---

## 9. What the founder has to do

Nothing in this pass needs a Stripe account to work: the whole manual path —
plans, contracts, seat snapshots, invoices, issuing, marking paid, the
hospital's download — is complete on its own, and that is how the first
hospitals should be billed.

To switch the Stripe rail on, the founder must:

1. Create a Stripe account for the operating company and complete **business
   verification** (legal entity, tax id, representative).
2. Add the company's **bank details** for payouts, and enable **ACH / bank
   debit** and bank transfer as payment methods — those are what hospitals use;
   cards are rarely accepted for this.
3. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as server settings on
   the deployment (Render dashboard / AWS SSM). Never in the repository. A
   **restricted** key is enough, and these are the only permissions DocTurn
   uses: **Customers** read + write, **Invoice Items** write, **Invoices**
   read + write. "Test connection" deliberately reads `GET /v1/customers?limit=1`
   — inside that same scope — rather than the account balance, so a key scoped
   as above does not fail the test.
4. Add the webhook endpoint `https://<host>/webhooks/stripe` in the Stripe
   dashboard, subscribed to `invoice.paid`, `invoice.payment_failed` and
   `invoice.voided`, and copy its signing secret into
   `STRIPE_WEBHOOK_SECRET`.
5. Switch `billing.stripe` on for the hospitals to be collected through
   Stripe, and press **Test connection** on the Stripe integration card.
6. Check that the API version DocTurn pins (`Stripe-Version: 2024-06-20`, in
   `server/billing/stripe.ts`) is accepted by the account. It could not be
   verified from the development environment, which has no Stripe account; if
   Stripe has retired it, bump the constant and re-run
   `tests/billing-stripe.test.ts`.
7. **Decide the outbound-email question.** `send_invoice` means Stripe emails
   the hospital's billing contact. It is off until the founder says otherwise,
   per contract. Turning it on sends real email to a real customer from
   Stripe's domain, with Stripe's branding and a hosted payment page — that is
   a commercial decision, not a technical one.
