# Service Level Agreement (Exhibit B to the Master Subscription Agreement)

[DRAFT FOR ATTORNEY REVIEW — NOT IN FORCE. Do NOT commit to an uptime figure
until production runs on redundant infrastructure (a managed Postgres with
failover and at least two application instances). Today's demonstration site
runs as a single instance and could not honour any of the figures below.]

## 1. Availability commitment

DocTurn will use commercially reasonable efforts to make the Service available
**[99.5]%** of the time in each calendar month ("Monthly Availability"),
measured by DocTurn's external monitoring of the sign-in and messaging
endpoints from more than one location.

**Excluded from the calculation:** (a) scheduled maintenance announced at least
**[48 hours]** in advance and performed **[between 00:00 and 05:00 Customer
local time]**, not exceeding **[4]** hours a month; (b) emergency security
maintenance; (c) failures of the internet, mobile networks, device operating
systems, push-notification services, or Customer's own systems, networks or
identity provider; (d) suspension under the Agreement; and (e) force majeure.

## 2. Service credits — the sole remedy for missed availability

| Monthly Availability | Credit (% of that month's fees) |
|---|---|
| Below [99.5]% | [5]% |
| Below [99.0]% | [10]% |
| Below [95.0]% | [25]% |

Customer must request a credit within **[30] days** after the month ends.
Credits apply to future invoices, are not refundable in cash, and in total
will not exceed **[25]%** of that month's fees. **Service credits are
Customer's sole and exclusive remedy for unavailability**, except that if
availability is below [95.0]% in any **[two (2)] consecutive months**, Customer
may terminate the Agreement on written notice and receive a pro-rata refund of
prepaid fees.

## 3. Support

| Priority | Definition | Initial response target |
|---|---|---|
| P1 — Critical | Users cannot sign in, or messages / alerts are not being delivered, for the whole organization | [1 hour], 24×7 |
| P2 — High | A core function is impaired for many users with no workaround | [4 business hours] |
| P3 — Normal | A function is impaired with a workaround, or affects few users | [1 business day] |
| P4 — Low | Questions, requests, cosmetic issues | [3 business days] |

Contact: [SUPPORT EMAIL] · [SUPPORT PHONE FOR P1]. Response targets are
targets, not guarantees of resolution time.

## 4. Status and incident communication

DocTurn will post the status of the Service at [STATUS PAGE URL] and notify
Customer's designated contacts of any P1 incident and, within **[five (5)]
business days** of its resolution, provide a written summary of cause and
corrective action.

## 5. Customer's continuity duty

Because availability cannot be guaranteed, Customer will maintain backup
communication procedures for urgent and emergency situations (see the Clinical
Safety Notice) and will not rely on the Service as the sole means of reaching
a clinician about a patient in immediate danger.
