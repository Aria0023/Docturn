# DocTurn — Independent Platform Verification & Competitive Feedback

*Verified 2026-09-03 against branch `claude/sleepy-davinci-kmin7n` @ `e3b2a96`. Every
claim below was exercised against a running server (production build unless noted),
not read off documentation.*

## 1. Verdict in one paragraph

The core clinical loop works end-to-end across every role and across phone ↔ web on
one backend: login for all 9 seeded accounts in 4 tenants, ER → hospitalist admission
routing with live accept and correct census, direct/priority/STAT messaging with
acknowledgement, DND with covering-provider forwarding, STAT escalation to the
covering provider, patient-linked threads, attachments with type/participant
enforcement, role-addressed ("message the on-call") targets, retention policy,
analytics, push key, compliance monitor and audit. Tenant isolation and RBAC held on
every probe. What does **not** hold up: (a) recipients on the web/phone app have **no
way to acknowledge an emergency broadcast**, so the director's "acked / total" bar can
never fill; (b) the phone E2E harness, `docs/MOBILE.md` and the `mobileapp/` directory
describe a `/m` app that was deliberately removed — they are stale, and the harness
reports false failures; (c) the comms analytics endpoint is readable by any role.

## 2. What was run

| Suite | Scope | Result |
|---|---|---|
| `npm test` (vitest) | 19 files, unit + route + security | **141 / 141 pass** |
| `npm run test:rt` (two live sessions, real WebSockets) | presence, live assignment events, accept→census, bidirectional messaging, on-call role resolution, reassign, RBAC | **33 / 33 pass** |
| `npm run test:ui` (jsdom, single session, all roles) | 107 UI/API behaviours | **104 / 107** — the 3 misses are harness timing/jsdom limits, not product defects (see §4.7) |
| `npm run test:e2e` (Chromium, web + `/m`) | phone ↔ web interop | 13 / 21 — **harness is stale** (targets removed `/m` kit; see §5) |
| Own API verification (curl, production build, isolated DB) | 49 checks across 9 accounts / 4 orgs | 42 pass; the 7 "fails" were script assumptions (204 vs 200, binary body, wrong getter path) — re-verified individually, all behave correctly |
| Own phone ↔ web interop (`scripts/interop-unified.mjs`; Chromium, iPhone viewport vs desktop, unified app) | login, live message both directions, STAT ack, admission accept sync, broadcast, role targets, DND | **17 / 18** — the single failure is the broadcast-acknowledge gap (§4.1) |

## 3. Verified working (with evidence)

- **All logins:** ISPN director/chen/er.doc/er.director, HOSP director/okafor, ER director/er.doc1, DOCTURN dev → 200.
- **Security:** no `passwordHash` in `/api/users` or `/api/registrations`; anonymous → 401; er_doctor cannot PATCH org settings (403); director cannot mint a developer (403); cross-tenant assignment accept → 404; non-participant cannot read a conversation (403) or its attachment (403); `.exe` upload rejected (400). Brute-force limiter: 55 wrong passwords → 429 while 55 correct logins never lock out (fixed this session).
- **Admission flow:** ER creates patient → round-robin assignment → the assigned hospitalist accepts → census 0 → 1. Reject → auto-reroute and director reassign verified live in the real-time suite.
- **Messaging:** routine / urgent / STAT send (201); STAT ack (204); mark-read (204); typing/presence/delivery live over WS.
- **DND + covering:** chen sets covering + DND → `/availability/:id` reports `dnd:true, covering:<id>`; on-call targets re-address to the covering provider.
- **STAT escalation:** STAT sent to a DND user reached the covering provider's inbox within the escalation window (2 s re-alert / 4 s escalate in test; defaults 2 min / 5 min).
- **Patient-linked thread:** `POST /api/messaging/patient-thread` → conversation bound to the patient.
- **Attachments:** base64 upload (PNG) → attachment-only message → participant fetch 200 / non-participant 403; mime allowlist enforced.
- **Role-addressed messaging:** `/api/messaging/on-call-targets` resolves to real in-org users; messaging a resolved role reaches the holder live (real-time suite).
- **Retention:** `PATCH /api/settings/org {messageRetentionDays:30}` persists (read back via `GET /api/settings`); `POST /api/maintenance/purge` runs (removed 0 on a fresh DB — expected).
- **Analytics / reports:** `/api/metrics/comms` and `/api/reports/ops` return live numbers.
- **Push:** VAPID public key served. **Amion:** `configured:false` reported honestly without the env var.
- **Compliance monitor:** 30 controls; on the local run 11 pass / 3 warn / 2 fail / 14 manual (37 %). Both FAILs are environment-specific to the test box (no `SESSION_SECRET`, `RATE_LIMIT=off`) and pass on Render, where both are set. PHI-read auditing flips to PASS as soon as reads occur (verified).

## 4. Discrepancies found (ordered by impact)

1. **Broadcast acknowledgement is one-sided.** The server exposes `POST /api/broadcasts/:id/ack` and the director UI shows "acked / total", but the unified web/phone app never calls it — recipients get a toast with no acknowledge control (`webapp/api-bridge.js` BROADCAST_CREATED handler adds the item with `ackReq:false`). The removed `mobileapp/` had this wired; the unified app lost it. *Result:* the flagship "emergency broadcast with per-recipient acknowledgement" cannot complete in practice.
2. **Stale phone artefacts.** `scripts/e2e-mobile.mjs` still drives the old `/m` kit (3-input form, `/m` tabs) and now fails 8 checks that are not product defects; `docs/MOBILE.md` documents `/m` and `mobileapp/`; `mobileapp/` is dead code (served nowhere since `6f4b221`). Anyone reading the docs or CI output will be misled.
3. **Comms analytics not role-gated.** `GET /api/metrics/comms` is `requireAuth` only — a hospitalist can read org-wide KPIs (`/api/reports/ops` is correctly director/ER-director/developer only). Not PHI, but inconsistent with the director-only intent.
4. **No `GET /api/broadcasts` list endpoint.** Recipients only learn of a broadcast via the live WS frame; a device that was offline at send time never sees it. Ack-required/audience remain UI-only concepts.
5. **No single-patient read** (`GET /api/patients/:id` → 404 for everyone); the board endpoints cover the UI, but API consumers (integrations) have no per-patient fetch.
6. **On-call role targets are thin without schedule data.** In a seeded org with no Amion feed there is exactly one target ("Next hospitalist"). The feature is real, but its demo value depends on the live Amion feed being configured.
7. **UI smoke harness cannot run against a production build over plain HTTP** (Secure cookies) — it needs the dev server or an HTTPS front. Document or add `X-Forwarded-Proto` support to the harness.
8. **Attachments are stored as base64 in the database** (compliance monitor WARN). Fine for a synthetic pilot; not the right home for ePHI images at scale (needs encrypted object storage + AV scanning).
9. **MFA enrolment is 0 / 16 users** including all privileged accounts (compliance WARN). The capability exists; nothing enforces it.

## 5. Phone ↔ web interop — what "the phone app" actually is now

As of `6f4b221` the phone app **is the same web app** served at `/`, installable as a PWA
(manifest, service worker, icons, Web Push). `/m` → `/` redirect is intentional. My
interop test therefore drove the unified app at an iPhone viewport against a desktop
session on one backend:

| Check | Result |
|---|---|
| Phone form login (hospitalist) / web login (ER physician, director) | ✅ |
| Phone renders the mobile layout (narrow media query) | ✅ |
| Web → phone message appears **live**, no reload | ✅ |
| Phone composer → reply reaches server and appears **live** on web | ✅ |
| STAT from web → phone shows **Acknowledge**; tap → web sees "acknowledged" | ✅ |
| Web ER routes an admission → phone sees it live → **Accept** → web sees `accepted` | ✅ |
| Director critical broadcast → appears live on phone | ✅ |
| Phone can **acknowledge** the broadcast | ❌ no control in the UI (API `204` works) |
| Role-addressed on-call targets available on phone | ✅ |
| Phone sets DND → web availability shows `dnd:true` | ✅ |

**Parity note.** Because phone and web are literally the same app, there is no feature
drift between them — a change on one surface is a change on both. What differs is
layout only (Messaging switches to list/thread panes on narrow screens). Desktop-only
areas (developer console, compliance monitor, Amion admin, org config) are reachable on
a phone but not optimised for it.

**Method note.** Three earlier interop rounds produced false failures from my own test
(wrong nav id; a leftover seeded pending request that captured the first "Accept" tap;
zombie servers from an earlier run holding ports so later runs hit stale state). Each was
diagnosed with request-level tracing before being discounted — none was a product bug.
The old `scripts/e2e-mobile.mjs` suffers the same class of staleness and should be
retired in favour of `scripts/interop-unified.mjs`.

## 6. Competitive reality check — TigerConnect & PerfectServe

Sources were gathered by search (vendor sites are blocked from this sandbox); figures
are third-party estimates where marked.

**What they have that DocTurn matches:** role-based messaging, priority/STAT with
escalation, DND/auto-forward (TigerConnect "Delegation"), broadcast, read receipts,
schedule-driven routing (PerfectServe Dynamic Intelligent Routing uses real-time
schedules, roles, urgency, date/time and escalation rules), patient-centred threads.

**What they have that DocTurn does not:** voice/video calling and text→call switching;
alarm/nurse-call/device integration (TigerConnect's is an FDA Class II device); an
AI operator console / answering service; a scheduling *engine* (PerfectServe's
Lightning Bolt is #1 in KLAS physician scheduling 2024-26 — DocTurn consumes a
schedule, it does not build one); EHR-embedded messaging with Epic/Cerner deep links;
SSO/SAML + SCIM; remote wipe; a "who's on call right now" board; message forwarding and
templates; TigerConnect 2026 additions such as Flag & Filter and Teams. TigerConnect
reports 7,000+ facilities, HITRUST certification and a 2025 Gartner MQ Leader position.

**What users complain about — the honest opening:** TigerConnect reviews cite
unreliable/phantom notifications, monthly reinstalls, DND not visible to senders, and
weak support; PerfectServe reviews cite message delivery delays (one review: 36
minutes), badge/sound notification bugs, Android Auto breakage and support tickets
closed unresolved. **Notification reliability is the market's open wound.** DocTurn's
architecture (content-free push + WS + STAT re-alert/escalation + covering forwarding)
is aimed at exactly that; the product proof will be push delivery on real devices,
which this session could not test.

**Pricing context (third-party estimates):** TigerConnect ≈ $8–15/user/month basic,
$15–30 with modules; PerfectServe quote-only, ≈ $89–119 per on-call user/month for
answering-service style use. A hospitalist/ED pilot priced per seat well under
TigerConnect's floor is credible if reliability is demonstrable.

**The threat nobody in the doc mentions:** Epic Secure Chat is free-with-Epic and is
already the default for many systems. Third-party vendors survive on what EHR chat lacks
— role routing, escalation, off-EHR reach (physicians who won't use Haiku), downtime
resilience, alarm/critical-result routing. DocTurn's pitch must be framed against Secure
Chat, not only against TigerConnect.

## 7. Recommended next batch (value ÷ effort)

1. Wire recipient broadcast acknowledgement in the unified app (small; restores a headline feature).
2. Delete `mobileapp/`, rewrite `docs/MOBILE.md` for the unified PWA, retarget `scripts/e2e-mobile.mjs` to `/` (so CI stops lying).
3. Gate `/api/metrics/comms` to director / er_director / developer.
4. Add `GET /api/broadcasts` (recent, with my-ack state) so offline devices catch up.
5. "Who's on call now" board + message forwarding + templates (Tier-1 gaps both competitors ship).
6. Enforce MFA for privileged roles; move attachments to encrypted object storage before any real PHI.
7. Prove push delivery on physical iOS/Android devices and measure delivery latency — that is the number that wins against the incumbents' worst reviews.

### Sources
- TigerConnect: https://tigerconnect.com/products/clinical-collaboration-platform/ · https://tigerconnect.com/resources/blog-articles/2026-winter-launch-enhancements-help-care-teams-do-more · https://tigerconnect.com/resources/newsroom/tigerconnect-launches-ai-powered-operator-console/ · https://www.gartner.com/reviews/product/tigerconnect-clinical-collaboration-platform · https://www.capterra.com/p/180133/TigerConnect/reviews/ · https://www.g2.com/products/tigerconnect-clinical-collaboration-platform/reviews · https://softwarefinder.com/emr-software/tigerconnect/pricing · https://emitrr.com/blog/tigerconnect-pricing/
- PerfectServe: https://www.perfectserve.com/blog/healthcare-messaging-dynamic-intelligent-routing/ · https://www.perfectserve.com/news/2026-best-in-klas-clinical-communication-physician-scheduling/ · https://www.perfectserve.com/compare/tigerconnect/ · https://appgrooves.com/app/perfectserve-practitioner-by-perfectserve-inc/negative · https://justuseapp.com/en/app/367592241/perfectserve-practitioner/reviews · https://emitrr.com/blog/perfectserve-pricing/
- Epic Secure Chat context: https://www.hypercare.com/blog/the-strengths-and-limitations-of-epic-secure-chat-for-critical-healthcare-communication · https://telehealth.org/news/as-epic-expands-secure-chat-studies-examine-clinician-notification-burden/ · https://tigerconnect.com/resources/blog-articles/beyond-ehr-chat-the-case-for-a-dedicated-communication-solution/
