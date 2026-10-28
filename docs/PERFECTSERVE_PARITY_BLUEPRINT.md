# DocTurn — Master Architecture Blueprint
### Rough, patent-safe parity with a PerfectServe-class platform

> **Provenance & method.** This blueprint was produced by a 23-agent design
> workflow: one grounding pass over DocTurn's real code, one deep architecture
> design per capability, an **adversarial verification pass** on each design
> (feasibility, patent/trademark risk, hidden dependencies), then synthesis +
> a completeness critique. Every `buildClass` below is the **corrected** value —
> the skeptic's verdict over the optimist's. Two of the eleven design agents
> (Scheduling #2, Presence #10) hit a JSON-serialization error and returned no
> structured output; **those two sections (§3.#2 and §3.#10) were authored
> directly afterward** and are marked as such. Everything else is the verified
> workflow output.
>
> **This is engineering guidance, not legal advice.** The "parity with
> PerfectServe" framing is strictly internal. An IP freedom-to-operate (FTO)
> and trademark review by counsel is required before any commercial launch or
> external "parity" positioning — see §5.

---

## 1. Executive answer: can we do all this, robustly?

**Yes — with conditions, and with one architectural insistence.** Every
capability is feasible on DocTurn's existing zero-secret stack, and each has a
*genuinely robust* now-slice that ships without a single new vendor, contract,
or BAA. But after adversarial review, **every capability classifies as
`partial`** (analytics was downgraded from `now`): the operational brains build
immediately on synthetic data, while real telephony, real EHR/HL7 feeds,
PHI-eligible AI transcription/triage, and 911 dispatch are hard-gated behind
vendor programs, signed BAAs, and an IP freedom-to-operate legal review. The
single highest-leverage decision is to **build the shared foundation once** —
routing/policy engine, in-process event bus, durable escalation, telephony
abstraction, analytics stream, and presence — because most capabilities are
blocked on it and it closes a real durability gap (the in-memory, non-durable
ack `Set`). The **load-bearing correctness fix**, without which the whole thing
is unsafe: the dry-run simulator every design leans on must resolve recipients
through a *pure, side-effect-free* rotation preview, **not** the current
`selectNext`, which mutates `rotationIndex` and raises provider caps on every
call.

---

## 2. Shared foundation — design once, consumed by everything

Collapse the recurring routing/telephony/event/analytics seams into **seven
in-process modules under `server/`**, all additive (nothing deleted; legacy
calls migrate onto the spine in a second pass). Corrected buildClass for the
foundation as a whole: **`partial`** (the substrate is `now`; the real
voice/inbound legs are gated).

### 2.1 Canonical event + in-process EventBus — `server/events/`
`DtEvent = { id, organizationId, type (dotted), source, subjectType, subjectId,
actorUserId?, urgency (1–5, ESI semantics), payload (STRICTLY PHI-free: ids +
coded fields only), correlationId, occurredAt }`. `EventBus.emit()` **durably
appends to `analytics_events` before fan-out**, then synchronously dispatches to
subscribers, each wrapped in try/catch+log so a bad subscriber never throws into
the request path. Singleton like `storage()`; tests inject their own.
**Consumed by:** every capability.

### 2.2 Care Routing Policy Engine (CRPE) — `server/services/policy.ts`, `evaluator.ts`, `engine.ts`
Per-org, versioned, declarative rules (draft → published → archived),
first-match-wins, zod-validated at write time. A **pure `evaluate(ctx,
publishedPolicy, storage, clock)`** resolves the first matching rule's target by
delegating to existing primitives. **Mandatory corrections the verdicts require
before this is safe:**
- **Pure rotation preview.** Build a read-only `peekNext()` that does *not*
  advance `rotationIndex` and does *not* apply DB-writing cap relief. `selectNext`
  mutates; a dry-run that reuses it corrupts live routing state. The whole
  "see-before-save" safety story depends on this.
- **Split pure-core `resolve()` from the side-effecting wrapper** (`resolve` =
  recipients + plan; wrapper = audit row + `policy.decision` emit + rotation
  advance). `/simulate` calls `resolve()` only.
- **Wire rotation-target → `recipients[]` fan-out** (rotation returns one
  hospitalist; unit fan-out lives in `unitUserIds()` — make the mapping explicit).
- **Guaranteed non-empty fallback** to current `selectNext` behavior so a patient
  is never silently dropped.
- **No "compliance monitor" primitive exists** for routing — build a standalone
  real reachability/config probe, never a hardcoded pass, or drop the reference.
**Consumed by:** routing (#1/#2), operator overrides (#3), answering (#4), alarms
(#9); analytics reads its decision audit.

### 2.3 Durable escalation state machine — `server/services/escalation.ts` (new) + sweep loop
Replaces the in-memory `acked` `Set` and raw `setTimeout` in `notifications.ts`
with a durable `escalation_state` table advanced by an unref'd `setInterval`
claim-loop (modeled on `startExpiryLoop`, started in `server/index.ts main()`).
Ack becomes a persisted column that survives restart. **Additional required fix:**
the accept path must be an **atomic conditional UPDATE (`WHERE status='pending'`)**
— the inherited `acceptAssignment` is a read-then-write TOCTOU race that breaks
first-accept-wins under real `pg.Pool` and multi-recipient fan-out.
**Consumed by:** routing escalation ladder, alarms lifecycle; the voice leg is
gated behind telephony.

### 2.4 Telephony abstraction — `server/services/telephony.ts`
`interface TelephonyProvider { placeCall, sendSms, transfer, hangup,
buildAnswerInstruction }` + `telephonyFor(provider)` registry, mirroring
`smsFor`. **`SimulatedTelephony` (default, zero secrets)** records to
`telephony_calls`, deterministically transitions `ringing → answered/no_answer`,
and emits `call.*` events. Env-gated `TwilioVoiceProvider`; future
`SipTelephony`. **Honesty rule (mandatory):** SimVoice must be visibly labeled
*"simulated — not connected to the phone network"* everywhere. **Caveat the
verdicts flag:** a real inbound call-control webhook is materially harder than
outbound `smsFor` — session-less, needs urlencoded/raw-body capture + provider
signature verification (with forwarded-host reconstruction behind the Render
proxy), its own rate-limit bucket, and a sub-second synchronous response. Do not
let "exactly like smsFor" hide this.

### 2.5 Analytics event stream — `server/analytics/`
Append-only `analytics_events` fact table (PHI-free, enums + ids + numeric
latency, enforced by a zod allowlist on the `dims` column) + a
`startAnalyticsRollupLoop()` that idempotently upserts `analytics_rollups`
(count/sum/sumSq/min/max + a mergeable latency histogram). Distinct from
`audit_logs`. **Critical instrumentation the analytics verdict caught:** add a
`recordMetric()` seam **inside `rotation.ts`** and **stamp `rotationMode`-in-effect
and transfer-kind per assignment** — otherwise cap-relief count, specialty-fallback
count, and rotation-mode analytics have no durable source and would fabricate
numbers.

### 2.6 Presence model — wrap `WsHub`
`WsHub` already tracks presence; the foundation wraps `USER_PRESENCE_CHANGED` to
also emit `presence.changed` onto the bus so the engine can skip/deprioritize
offline recipients. **Consumed by:** routing (#1/#2), operator (#3), presence
(#10).

### 2.7 Integration ingress seam
One `AlertSource`/`InboundAdapter` contract (`detect`/`parse`/`normalize` →
canonical `DtEvent`) with a deterministic secret-free simulated/manual injector
as default; real HL7v2/FHIR/nurse-call/monitor adapters plug in behind it
(gated). **Consumed by:** integrations (#7), alarms real feeds (#9), answering
inbound (#4).

**Named Foundation Phase-1 primitive (added per critique):** a **system/service
actor + synthetic-patient path**. `createAssignment` requires a non-null
`erDoctorId` and an existing `patientId`; inbound calls (#4), ADT admits (#7),
and bus-driven alarm routes (#9) have neither, and `logPhiAccess` derives its
actor from `req.user` which a session-less webhook lacks. Build this **once** in
the foundation or three Wave-2 tracks each stall on it.

**Foundation effort (corrected):** Phase 1 substrate **~5–7 weeks** (1 eng);
Phase 2 (migrate `notifications.ts` onto the bus, policy versioning,
presence-aware routing) **~6–8 weeks** — the in-place `notifications.ts`
migration is the risky part. **~3 months to the gated line, 1 engineer.**

---

## 3. Per-capability sections

> Every buildClass is the **corrected** value. Where a capability *is* the
> foundation, its cost is largely absorbed by §2.

### #1 / #2-routing — Smart care-routing rules engine → **`partial`**
**What:** per-org, versioned, declarative rules routing any
assignment/message/alert to the right recipient(s) from role + live on-call +
ESI urgency + time-of-day, with a declarative escalation ladder, a PHI-free
decision audit, and a rules-editor UI with a live simulator.
**Architecture:** *this is the CRPE (§2.2)* + the durable ladder (§2.3), wired
into `createAssignment` behind a `routing_engine` feature flag (legacy path
preserved for incremental cutover).
**Key tables:** `routing_policies`, `routing_policy_versions`, `routing_decisions`
(PHI-free audit), `routing_escalation_state`. **Endpoints:** policy CRUD +
versions + `publish` + deterministic `/simulate` + `decisions` read + durable
`/ack`. **UI:** `RoutingPolicies.jsx` (ordered-rule editor, condition builder,
simulate/trace pane, version history, decisions audit tab).
**External deps:** none for the now-slice. **Effort:** ~7–10 weeks standalone,
but ~70% overlaps the foundation — build it *as* the foundation; marginal cost
is the editor UI + decisions tab. **Mandatory fixes:** pure `peekNext()`;
`resolve()` split; rotation→`recipients[]` fan-out; atomic accept; DST-aware
timezone helper; ack-model unification.

### #2-scheduling — Coverage Planner / assisted schedule optimizer → **`partial`**
> *Section authored directly (design agent failed schema validation). Consistent
> with the foundation above.*

**What:** generate and optimize provider schedules from coverage requirements,
provider preferences, requested time-off, and fairness/anti-burnout limits
(max consecutive shifts, minimum rest after nights, equitable call
distribution, holiday balancing), across one or more sites — well beyond
DocTurn's current round-robin. Includes shift-swap requests and a coverage grid.
The published schedule becomes the **authoritative on-call source the routing
engine (§2.2) reads**, so scheduling and routing share one data spine.

**Architecture:** a constraint model + a solver, staged by ambition:
- **MVP (now):** a deterministic, seed-reproducible **heuristic/greedy assigner
  with a weighted scoring function** — hard constraints (coverage must be met,
  no double-booking, time-off honored) filter candidates; soft constraints
  (fairness, preferences, rest) score them; the highest-scoring feasible
  assignment wins per slot. Pure JS, no native deps, runs in-process.
- **Robust (now):** upgrade the assigner to **local search / simulated
  annealing** over the same constraint model to escape greedy local optima —
  still pure JS, dependency-light, seedable for reproducibility, and it surfaces
  a **violations report** when a period is infeasible rather than silently
  dropping coverage.
- **Enterprise (optional, gated only by ambition):** swap the solver for a
  CP-SAT/ILP engine (e.g. an OSS solver compiled to WASM) behind the same
  interface. Not required for robust functionality.

**Key tables (Drizzle + SCHEMA_SQL):** extend existing `shifts`/`hospitalists`;
add `schedule_periods`, `schedule_assignments` (provider × date × shift, with a
`source` = generated|manual|swap), `provider_availability` / `time_off`,
`scheduling_constraints` (per-org hard/soft rule set + fairness weights),
`schedule_swaps`. **Endpoints:** constraints CRUD, time-off CRUD, **`POST
/schedule/generate` (returns a *proposed* schedule + score + violations, does
NOT commit)**, `publish`, swap request/approve. **UI:** `CoveragePlanner.jsx` —
a coverage grid, a constraint editor, a generate→preview→publish flow, and a
swap board.
**buildClass rationale — `partial`:** the model, solver, generate/preview/publish,
and swaps are all buildable now on synthetic data with zero secrets. The
**gated** remainder is a *live authoritative schedule source* (Amion/QGenda API
contract) to import existing schedules and be the production source of truth for
routing — which replaces the current client-only `ScheduleSync` mock.
**External deps (gated):** Amion/QGenda (or equivalent) API contract for
real-schedule import/export.
**Patent/Trademark:** do **not** use "Lightning Bolt." Physician/nurse rostering
via combinatorial optimization is decades-old operations-research prior art;
describe the algorithm from first principles. Scheduling-optimization patents do
exist — an **FTO review by counsel is required before commercial launch**; this
is not legal advice.
**Effort:** MVP heuristic ~4–6 weeks; robust local-search + swaps + fairness +
violations report ~4–6 weeks.
**Risks:** solver quality/perf on large multi-site periods; infeasible periods
must surface violations (never silently under-cover); reconciling a generated
schedule with a real external source of truth; fairness disputes need an audit
trail of why each slot was assigned.

### #3 — Operator / transfer console + telephony → **`partial`**
**What:** a call-center workstation — live queue, on-call directory lookup,
blind/warm transfer, convert-a-call-to-a-routed-secure-message, durable call
state machine, full audit.
**Architecture:** `call_sessions` state machine mirroring `assignments`, on the
§2.4 telephony abstraction; convert-to-message reuses the messaging subsystem;
live updates via `WsHub`. The now-slice is a **labeled telephony *simulation***
driven by `SimVoice` + a `/api/console/sim/inbound` injector.
**Key tables:** `phone_numbers` (DID→org boundary), `call_sessions`,
`call_events`, `call_transfers`, `call_queues`. **UI:** `OperatorConsole.jsx`
with a visible "simulated" banner.
**External deps (gated):** CPaaS voice vendor + provisioned DIDs + **signed BAA**
+ public TLS webhook + (enterprise) SIP/SBC/PBX. **Effort:** MVP simulator
**3–4 weeks** (the new `operator` role touches the ROLES tuple, every
`requireRole`, seed, and fixtures; five dual-schema tables); adapter-complete
**5–7 weeks** of code that stays *unverifiable* without a paid vendor + BAA.
**Honest framing:** the now-deliverable is a workflow/console demo, not a phone
system.

### #4 — After-hours answering service + AI voice triage → **`partial`**
**What:** capture an after-hours caller's intent, classify urgency, route to
on-call via the engine, turn voicemail into a secure message; a gated AI
voice-agent tier with 911 escalation.
**Architecture:** durable `calls` pipeline mirroring the assignment state
machine; **two honestly-separated triage tiers** — Tier A rules/DTMF (`now`,
never labeled "AI"), Tier B LLM voice agent (gated). `POST /api/calls/simulate`
drives the full pipeline with zero secrets.
**External deps (gated):** CPaaS DID + BAA; PHI-eligible STT under BAA;
healthcare-eligible LLM under BAA; E911/PSAP carrier + regulatory registration.
**Effort:** MVP synthetic pipeline ~3–4 weeks; live CPaaS ~5–8 weeks + vendor/BAA
lead; AI + E911 = multiple quarters + a net-new real-time media subsystem.
**Mandatory fixes:** the system-actor/synthetic-patient path (foundation);
session-less `logPhiAccess` actor; raw-body + signature-verified inbound webhook.
**Rule:** 911 never fires from synthetic data or a prototype.

### #6 — EHR integration & patient-centric messaging → **`partial`** *(top priority)*
**What:** SMART-on-FHIR patient context (Epic/Oracle-Cerner), every patient and
thread bound to a real FHIR Patient id + MRN, optional chart write-back,
embedded (EHR-launch) mode.
**Architecture:** env-gated `FhirContextService` (a near-exact clone of the
existing `AIExtractor`/`SmsService` stub pattern) with a `StubFhirClient` default
and a `SmartFhirClient` that hits the **public SMART Health IT sandbox live with
zero registration/secret/BAA**; server-side OAuth broker (tokens encrypted at
rest via `node:crypto` AES-GCM, never sent to the browser); identity mapping;
minimum-necessary PHI-logged context cache; feature-flagged, honestly-gated
write-back and embedded launch.
**Key tables:** `fhir_connections`, `fhir_tokens`, `patient_ehr_links`,
`fhir_context_cache`, `chart_writebacks`, `ehr_consent` +
`conversations.patient_id/patient_ehr_link_id`. **Endpoints:** OAuth
`launch`/`authorize`/`callback`, patient `search`, `ehr-link`, `ehr-context`,
gated `chart-note`, consent CRUD.
**External deps (gated, Phase 3, effectively indefinite):** Epic App Orchard /
Vendor Services; Oracle-Cerner code program; third-party security assessment;
**signed BAA per health system**; embedded-launch CSP/SameSite rework.
**Effort:** Phase 1 (synthetic + public sandbox, real identity mapping) ~3–4
weeks; Phase 2 (sandbox OAuth + consent + multi-vendor, free self-service
accounts) ~6–9 weeks; Phase 3 **6–18+ months per health system** —
procurement/legal, not an engineering estimate. **Mandatory fixes:** wire all 6
tables into `deleteOrganization`, user-keyed `fhir_tokens` into `deleteUser`,
order `purgeOldPatients` (delete `fhir_context_cache` → `patient_ehr_links` →
`patients`); real KMS/env key for token-at-rest in prod; drop the fictional
"compliance monitor" reference; embedded launch flips CSP and threatens the
session + `/ws` replay auth — real rework, gated.

### #7 — Integration platform: HL7/FHIR bus + adapters → **`partial`**
**What:** HL7v2 (MLLP) + FHIR ingestion bus, adapter/normalizer contract,
canonical event with idempotent dedupe, replay/audit, signed outbound webhooks;
built-in ADT/results/nurse-call/scheduling adapters feeding routing (#1) and
alarms (#9).
**Architecture:** three co-equal edges (real Node `net` MLLP listener,
authenticated HTTP HL7/FHIR endpoints, in-process simulator) → verbatim capture
+ dedupe → adapter registry → canonical event → dispatcher applying effects
**only** through existing org-scoped storage/services. Uses §2.7 + §2.1.
**Key tables:** `integration_sources`, `integration_messages`,
`integration_events`, `webhook_subscriptions`, `webhook_deliveries`.
**External deps (gated):** HL7 interface engine (Mirth/Cloverleaf/Rhapsody) or
direct EHR; LIS/RIS; nurse-call platform; site VPN/private link + MLLPS/TLS;
**signed BAA**. **Effort:** synthetic slice ~6–9 weeks. **Mandatory fixes:** ADT
admits have no `erDoctorId` → system actor; **stable patient identity** across
A01→A08→A03 requires a deterministic, per-org-salted, *stored* hashed-MRN
correlation key; raw-body parser for the HL7 endpoint; **drop the "exactly-once"
claim** — it is at-most-once with a crash-loss window. **Patent/TM risk: LOW**
(HL7v2/MLLP/FHIR are open specs; a canonical-event+adapter bus is generic).

### #8 — Async voice messages in chat → **`partial`** *(closest to fully-now)*
**What:** record, send, and inline-play an audio memo in a secure thread, with
duration and an optional gated text transcript. **Independent of the foundation.**
**Architecture:** native `MediaRecorder` capture → a **new** access-checked,
audited audio-attachment pipeline (audio only) → inline player with
Range-scrubbing. **Correction:** the "existing attachment pipeline / base64-in-DB
convention" the brief assumed **does not exist** — this is net-new binary
handling (base64 in a text column, dedicated `express.raw` route to bypass the
global 1 MB `express.json` cap, HTTP Range slicing, orphan-sweep loop).
**Key table:** `message_attachments` (+ gated `stt_jobs`). **UI:**
`VoiceRecorder.jsx` + `VoicePlayer.jsx`.
**Transcript is genuinely gated:** PHI-eligible STT (self-hosted Whisper or
BAA-covered cloud) + object storage + KMS; the browser Web Speech API is
**forbidden** (exfiltrates audio to Google). **Effort:** Phase 1 MVP ~1–1.5
weeks; Phase 2 ~1–1.5 weeks; Phase 3 transcript ~3–4 weeks + BAA/STT/storage.
**Patent/TM risk: LOW. Mobile caveat (from critique):** the React Native app
(`mobile-app/`) cannot use `MediaRecorder` — it needs `expo-av`; budget mobile
separately or scope it out explicitly.

### #9 — Nurse mobility & clinical alarm / critical-results routing → **`partial`**
**What:** type- and urgency-aware routing of clinical alarms, critical lab/rad
results, and routine requests to the right role (clinical → nurse, routine →
ancillary/tech), with accept/reject, durable timed escalation, and closed-loop
audit.
**Architecture:** reuses §2.2 for the rotating-clinician target and §2.3 for the
durable ladder; a data-driven `alert_routing_rules` table maps `(alertType,
urgency) → desk|rotating_clinician`; **desks decouple routing from the RBAC ROLES
enum**. Synthetic feed via `SimulatedAlertSource` + `/api/dev/alerts/simulate`;
real feeds plug into §2.7.
**Key tables:** `alerts`, `alert_events`, `alert_routing_rules`, `alert_desks`,
`alert_desk_members`, `alert_escalations`. **UI:** mobile-first `AlertInbox.jsx`
+ `AlertRoutingConfig.jsx`.
**External deps (gated):** HL7 ORU interface engine (or FHIR subscription);
nurse-call vendor (Rauland/Hillrom/Ascom); patient-monitor middleware
(Connexall/Extension); **BAA**; **FDA device-classification review** (secondary
alarm notification may be a regulated device). **Effort:** MVP 3–4 weeks (the
`nurse`+`ancillary` ROLES expansion touches ~67 `requireRole` sites); robust 3–4
weeks. **Mandatory fixes:** atomic first-accept-wins (shared §2.3 fix — critical
here as alarms fan out to multiple desk members); alarm dedupe/suppression is a
patient-safety prerequisite before *any* real feed; **do not claim NPSG.02.03.01
compliance** for the synthetic phase. Depends on **both** #7 and this subsystem
before real alarms are clinically complete. **Mobile-first caveat (from
critique):** nurses carry phones; `AlertInbox` must land in `mobile-app/` (with
new WS event types + `/api/mobile/*` surfaces), not just `webapp/`.

### #10 — Presence / availability & auto-coverage → **`partial`** *(near fully-now)*
> *Section authored directly (design agent failed schema validation). The
> presence primitive itself is designed in §2.6.*

**What:** one-tap provider status (available / in_surgery / in_clinic /
off_shift / do_not_disturb) that **automatically reroutes new messages and
assignments to a designated backup via the routing engine (§2.2)**, plus
team-presence visibility across the directory/threads/on-call board and a
status-change history/audit. This is the honest, non-cosmetic version of the
one-tap status PerfectServe advertises.
**Architecture:** extends DocTurn's existing DND + covering-provider forwarding
(`server/routes/settings.ts` user prefs `dnd`/`coveringUserId`). Add a `status`
enum + `backupUserId` + optional `statusExpiresAt` auto-revert; on change, emit
`presence.changed` (§2.6). The CRPE consults status at resolution time to skip a
`do_not_disturb`/`off_shift`/`in_surgery` provider and route to their backup —
so the reroute is *real routing behavior*, not a UI badge. `WsHub` already tracks
live connection presence; surface it as team presence.
**Key tables/columns:** extend the per-user prefs with `status`,
`status_updated_at`, `status_expires_at`, `backup_user_id`; add `status_history`
(who set what, when — audit).
**Endpoints:** `PATCH /api/settings/me/status`, `GET /api/presence/team` (org
roster + live status), `GET /api/settings/me/status-history`. **UI:** a status
switcher in the app shell/sidebar, presence dots in the directory + thread
headers + on-call board, and a status-history view.
**buildClass rationale — `partial`:** the status model, presence display, and
history/audit are buildable **now** with zero secrets; the *auto-reroute* is
fully real only once the CRPE (foundation) lands — before that, a simpler version
that reuses the existing covering-forward path works now. So it degrades
gracefully rather than faking.
**External deps:** none. **Patent/TM risk: LOW** (status/presence is generic).
**Effort:** ~1.5–2.5 weeks on top of the §2.6 presence primitive.
**Risks:** status staleness → the `statusExpiresAt` auto-revert is required, not
optional; **shared-workstation attribution** — on a shared ED browser session,
status and the acks that follow must bind to the authenticated user (see the
critique's multi-tab/shared-cookie gap); and status must genuinely gate routing
(tie to CRPE) or it becomes the exact "cosmetic control" this project forbids.

### #11 — Operational analytics & dashboards → **`partial`** *(downgraded from `now`)*
**What:** ops metrics — time-to-accept, STAT-ack latency, decline/expire/reroute
rates, routing-decision analytics, transfer metrics, message volume + read
latency, per-role/unit/shift rollups, trends, CSV/evidence-pack export.
**Architecture:** Tier A live-aggregates the existing durable tables with **zero
schema change**; Tier B adds the §2.5 event stream + rollups. Evidence-pack via
Node `zlib`/`crypto`. **UI:** `OperationalAnalytics.jsx` (hand-rolled inline-SVG
charts — no chart lib in the no-build kit).
**Why downgraded to `partial`:** the routing-analytics tab (cap-relief count,
specialty-fallback, rotation-mode outcomes) has **no durable source** until the
`rotation.ts` capture seam lands; STAT-ack/escalation tiles are not real until
ack state is durable (Foundation Phase 2). Both are unblocked by the foundation.
**External deps:** none, except the one gated item — **scheduled EMAIL delivery
needs an SMTP transport** that does not exist. **Effort:** core Tier A ~6–9
dev-days; + rotation seam ~2–3 dev-days; Tier B rollups + evidence pack ~2–3
weeks; ~5–7 dev-weeks total. **Rule:** do not ship the routing tab or any
ack-latency tile before its instrumentation lands, or it fabricates numbers.

---

## 4. Sequenced roadmap (waves, ordered by dependency and value)

### Wave 1 — buildable now, robust, zero new vendor/contract/legal
Runs entirely on default PGlite + console/noop transports, synthetic data,
secret-free.

| Order | Item | Effort | Why here |
|---|---|---|---|
| 1 | **Foundation Phase 1 substrate** (§2): event bus, CRPE with **pure `peekNext()`** + deterministic `/simulate`, durable `escalation_state` + loop (atomic accept), analytics stream + **rotation.ts capture seam**, `SimulatedTelephony`, `presence.changed`, **and the named system-actor/synthetic-patient primitive** | ~5–7 wk | Unblocks most capabilities; closes the in-memory-ack durability gap |
| 2 | **EHR Phase 1** (#6) — synthetic + live public SMART sandbox, identity mapping, consent gating, context panel | ~3–4 wk | **Top priority**; independent; real FHIR identity with zero contracts |
| 3 | **Analytics Tier A (reduced slice)** (#11) — volume/latency/time-to-accept from existing durable tables; routing tab + ack tiles ride the foundation | ~2 wk | Cheapest robust win; **re-labeled per critique** (ack/escalation analytics are Wave 2) |
| 4 | **Voice messages Phase 1** (#8) — new audio-attachment pipeline, record/upload/audited-streaming-playback/duration | ~1–1.5 wk | Fully independent track; high user-visible value |
| 5 | **Presence + auto-coverage** (#10) — status model, team presence, history; auto-reroute via the CRPE from step 1 | ~1.5–2.5 wk | Near-fully-now; makes the foundation's presence primitive user-visible |

### Wave 2 — foundation-dependent partial slices (built on Wave 1, still synthetic)
Foundation **Phase 2** (migrate `notifications.ts` onto the bus, durable-ack,
presence-aware routing, ~6–8 wk) is the true unblocker for durable ack — and
**operator, answering, and alarms depend on Phase 2, not just Phase 1.**
- **Routing rules-editor UI + decisions tab** (#1) · **Coverage Planner** (#2,
  MVP→robust heuristic/local-search) · **Operator console** (simulator slice)
  (#3) · **Answering pipeline** (synthetic, rules/DTMF only) (#4) · **Alarms
  subsystem** (synthetic feed) (#9) · **Integration bus** (synthetic
  ADT/ORU) (#7) · **EHR Phase 2** (sandbox OAuth broker, consent) (#6) ·
  **Analytics ack/escalation + routing-internals tabs** (#11).
- **Intra-wave ordering:** #7's stable-identity correlation must land before
  #9 can route a real result to the right patient's team.

### Wave 3 — gated on telephony / EHR / BAA / infra / legal
Not schedulable as pure engineering effort. Real telephony (operator/answering/
alarms voice); AI voice + 911 (net-new real-time media subsystem); EHR
production + write-back + embedded launch (per health system); real HL7/FHIR +
nurse-call/monitor ingress; voice-message transcripts; durability/HA infra (real
Postgres + LISTEN/NOTIFY, multi-instance escalation locking); analytics
scheduled email (SMTP).

**Aggregate honesty:** Waves 1–2 are ~**6–8 months with 2 engineers** on parallel
tracks, or ~9–12 months serialized by one. Wave 3 is **external process**, not an
engineering estimate.

---

## 5. Reality gates — what must exist before each gated capability is REAL

**Binding project rule:** nothing is advertised or shipped as "real" until its
gate is satisfied and it works end-to-end. Simulated telephony is labeled
"simulated." The rules/DTMF triage tier is never called "AI." 911 never fires
from synthetic data. Gated endpoints return honest gated responses, never fake
200s.

- **Telephony / CPaaS vendor + DIDs + public TLS webhook + signature verification:**
  operator transfer/PSTN (#3), answering inbound (#4), alarms voice leg (#9),
  foundation escalation voice leg.
- **Epic / Oracle-Cerner vendor program (+ third-party security assessment):**
  EHR production (#6); direct-EHR ADT/ORU as an interface-engine alternative (#7).
- **HL7 interface engine / clinical middleware / device vendors:** integrations
  real feeds (#7); alarms real feeds (#9) + **FDA device-classification review**.
- **PHI-eligible AI:** answering AI tier (#4); voice-message transcript (#8).
- **E911/PSAP:** answering 911 (#4).
- **Live schedule source:** routing real on-call accuracy + Coverage Planner
  import (#2); EHR authoritative census (#6).
- **Signed BAA (before ANY identifiable data):** every real telephony path,
  PHI-eligible STT/LLM, real PHI-bearing push/SMS, EHR production, real HL7/FHIR,
  audio object storage.
- **Infra beyond in-process PGlite:** real Postgres + LISTEN/NOTIFY or a broker;
  multi-instance escalation locking (`FOR UPDATE SKIP LOCKED`) for #2/#9; object
  storage + KMS for #8; SMTP for #11.
- **IP freedom-to-operate (FTO) / trademark legal review — before ANY commercial
  launch:** all capabilities. Patent exposure is heaviest on the **core
  routing/escalation/scheduling engine** (contact-sequencing/target-resolution
  claims can read regardless of clean-room design). Trademark avoidance must name
  and exclude **all four** PerfectServe marks — **Dynamic Intelligent Routing,
  Lightning Bolt, ConnectiveIQ, Sloane**. Keep "parity with PerfectServe" strictly
  internal.

---

## 6. Adversarial completeness critique (must-read before trusting the plan)

The synthesis passed through a completeness critic. Its highest-signal findings —
these are gaps in the plan itself, not features:

1. **The mobile app is absent from every UI plan.** Three clients exist —
   `webapp/` (primary), `client/` (Vite), and `mobile-app/` (React Native/Expo,
   real, with device-token registration and `/api/mobile/*`). Every capability's
   UI is planned as `webapp` `.jsx` only. This is **fatal for #9** (nurse mobility
   is intrinsically mobile) and hurts **#4** (on-call clinicians are on phones)
   and **#8** (`MediaRecorder` ≠ React Native; needs `expo-av`). **Decide mobile
   scope explicitly** — fund `mobile-app` screens + WS event wiring for #9/#4/#8,
   or cut them and explain how "nurse mobility" works without a phone.
2. **Push delivery is vaporware presented as an existing seam.**
   `server/services/push.ts` `console.log`s even when configured ("Real FCM HTTP
   v1 send would go here"). Every capability leans on "content-free push wake-up"
   as a working leg. It isn't implemented. With push and SMS both stubbed, the
   escalation story degrades to **WS-only (in-app, tab-open)**. Implement FCM
   HTTP v1 (gated on BAA) before claiming any out-of-app delivery.
3. **No offline / service-worker / background delivery.** Zero SW, IndexedDB, or
   offline queue anywhere. For a clinical-alarm product (#9) and operator console
   (#3), a transient network drop = a missed STAT alarm with no local queue or
   retry. Core functionality for "nurse mobility," completely missing.
4. **The delete/purge cascades are hand-maintained, FK-order-sensitive, have no
   DB-level `ON DELETE CASCADE`, and no completeness test — and the plan adds ~35
   tables.** Miss one in `deleteOrganization`/`purgeOldPatients`/`deleteUser`
   (especially user-keyed `fhir_tokens`) and you leak tenant PHI/OAuth tokens on
   delete or FK-abort the retention sweep. **Adopt schema-enforced cascades + a
   test that fails when any org/patient/user-scoped table lacks a delete path.**
5. **Retention-purge vs "durable audit" is an unreconciled conflict.**
   `purgeOldPatients` deletes patient rows on a short timer, but new
   "append-only/durable" records (`routing_decisions`, `alerts`, `calls`,
   `fhir_context_cache`, `message_attachments`) bind to `patient_id`. Define
   exactly which records outlive patient purge and how they're de-identified to
   survive — or the "durable closed-loop audit" claim is contradicted by existing
   behavior.
6. **Real-Postgres migration + analytics backfill is undefined.** The project
   uses `drizzle-kit push` (schema diffing), not versioned migrations —
   destructive/interactive on a live DB. Adopt versioned migrations for the
   ALTERs + 35 tables, and either **backfill** the per-assignment
   `rotationMode`/transfer-kind (#11 analytics are correct only going forward) or
   disclose "no history before instrumentation date."
7. **Session-less webhook ingress is thin, and prod ships `RATE_LIMIT=off`.** The
   new unauthenticated surfaces (#3/#4/#7 + the raw MLLP listener) would run with
   **no rate limiting** in the deployed config; even on, one IP-keyed 300/60s
   bucket is both too tight for a hospital-NAT/CPaaS source and useless against a
   distributed probe. Require per-ingress buckets + raw-body signature
   verification + loopback binding for MLLP, and fix the prod default.
8. **WS fan-out is org-wide broadcast, not recipient-targeted.** Every new
   high-frequency event (`ALERT_*`, `CALL_*`, `INTEGRATION_MESSAGE`,
   `EHR_*`) as an org broadcast triggers an org-wide refetch storm. Acceptable
   only because payloads are content-free triggers; the "robust at scale" claim
   needs `sendToUsers` targeting + debounce.
9. **`createAssignment` system-actor/synthetic-patient fix is a shared foundation
   dependency rediscovered three times** (#4, #7, #9) — now elevated to a named
   Foundation Phase-1 deliverable (§2).
10. **Shared-device ack attribution is unresolved** for the safety-critical
    surfaces (#3 claims, #9 alarm acks, #1 escalation acks) — the exact ED
    shared-workstation scenario. Acks must legally bind to the authenticated user.

---

## 7. Recommended immediate Wave-1 build set

Build these, in priority order, and nothing gated:

1. **Foundation Phase 1 substrate** — highest leverage; most capabilities and the
   analytics routing/ack tabs are blocked on it, and it closes a real durability
   defect. **Do not ship without the load-bearing fixes:** pure `peekNext()`, the
   `resolve()`/wrapper split (side-effect-free `/simulate`), atomic
   first-accept-wins, rotation→`recipients[]` fan-out, the `rotation.ts` analytics
   seam, **and the named system-actor/synthetic-patient primitive**.
2. **EHR Phase 1** — the stated top priority; independent, starts day one; a
   *real* FHIR identity backbone verified against the public SMART sandbox with
   zero contracts. Fix the six-table cascade wiring and `purgeOldPatients`
   ordering up front.
3. **Analytics Tier A (reduced, honest slice)** — cheapest robust win; consumes
   the foundation stream. Ship only what has a durable source; the routing/ack
   tabs light up as the foundation lands (do not fabricate historical splits).
4. **Voice messages Phase 1** — independent quick win; budget it as net-new
   binary handling and enforce the guardrails (never raise the 1 MB cap, never
   persist audio to `localStorage`, content-free push, hard-exclude Web Speech
   API). Decide the `mobile-app` (`expo-av`) scope explicitly.
5. **Presence + auto-coverage** — near-fully-now; makes the foundation's presence
   primitive user-visible and must gate real routing (no cosmetic status).

**Before Wave 2, resolve the four systemic critique items:** mobile scope +
real push, schema-enforced cascades + retention reconciliation, a versioned
migration/backfill strategy, and per-ingress webhook hardening + the prod
`RATE_LIMIT` default. These are prerequisites, not polish.

---

## 8. Built — PerfectServe-parity feature set

Every feature below is a per-org module (shared/modules.ts) the developer can
switch per organization (`PATCH /api/dev/modules/:orgId`), gated server-side
(server/modules.ts `GATE_TABLE` / `requireModule`) with a client refusal path.
Every per-user table is cascaded by the tenant delete (one transaction), the
user delete and — for Done rows — the patient purge; tests/dev-audit.test.ts
proves a tenant with rows in every one of them still deletes cleanly.

Tables (shared/schema.ts + server/db.ts): `directory_favorites`,
`conversation_done`, `user_reminder_prefs`, `user_sound_prefs`, `user_pins`.

Out of scope (not built, stated here only): VoIP calling and a call log, an
Apple Watch app, and the Expo native app (`mobile-app/`) — the iPhone surface
is the web app / PWA.

### #1 Role contacts — module `routing.roleMessaging` (now requires `oncall.board`)
- `GET /api/messaging/role-contacts`: `resolveOnCallTargets` (the ONE role
  resolution path — the role picker and forward use it too) grouped by role.
  It now also resolves the org's schedule-source slots (Amion / Epic / manual,
  the same slots the on-call board shows), joined to real in-org users by
  `providerUserId` only. Each contact: role label, everyone reachable on it
  (DND holders shown with their covering provider; DND with no covering is
  unreachable and left out; never yourself), and one Message target that the
  existing `startRoleConversation` flow opens — the DND-aware current holder.
- Only roles that resolve are listed; an org with no schedule data, consult
  catalog or rotation shows no section at all. The admissions round-robin
  appears as "Next hospitalist (round-robin)": messaging it opens a thread
  with the next-up hospitalist and routes nothing (no cursor move, no
  assignment). The caller's personal care-team on-call flags are people, not
  org roles, and stay out of the list.
- Directory → Role contacts shows live presence from `/api/presence`
  (unknown, not "offline", when the process has no realtime hub).
- Schedule slots are resolved only while `oncall.board` is on — checked in
  `resolveOnCallTargets` itself, so forward-by-`roleTarget` cannot reach a slot
  either. The compose picker lists a multi-person role once per person, each
  row naming who it reaches. Reading an Epic-sourced schedule may start the
  same background refresh the board's read does (never awaited).
- Tests: tests/role-contacts.test.ts, tests/client-directory.test.ts;
  check: scripts/role-contacts-check.mjs.

### #2 Favorites + recently contacted — module `directory.favorites`
- `directory_favorites` keyed (organization, user, target kind `user`|`role`,
  target id). `GET/POST /api/directory/favorites`,
  `DELETE /api/directory/favorites/:kind/:targetId` (server/routes/directory.ts,
  gated in `GATE_TABLE`). A person must be an active user of the caller's
  org (another tenant's id answers 404 like an unknown one; never yourself);
  a role must be one the org resolves now (and starring a role needs
  `routing.roleMessaging`). The list comes back resolved: a starred role
  nobody reachable holds right now resolves to `null` — the star is kept, the
  client draws no empty "on call" card. Add / remove are audited (`low`,
  target kind + user id only, never a name or role label).
- `GET /api/directory/recents`: derived on every read from the caller's own
  direct conversations by newest message (one row per person, at most 10) —
  names and times only, no message content, nothing stored.
- Directory opens with Favorites, Recently contacted, Role contacts, then the
  searchable provider list; a star toggle on person and role rows is a server
  write followed by a re-read (the star shows the stored state), and a
  refusal says why. Message on a favorite / recent person opens the direct
  thread by user id.
- Tests: tests/favorites.test.ts, tests/client-directory.test.ts;
  check: scripts/favorites-check.mjs.

### #3 Done — module `messaging.done`
- `PUT` / `DELETE /api/messaging/conversations/:id/done` (participants only —
  anyone else, another tenant included, gets the same 404 as a missing
  thread; gated in `GATE_TABLE`). A `conversation_done` row records the
  newest live message the thread was marked done THROUGH: the thread is done
  for that user while nothing newer exists, so any new message (from either
  side) re-opens it with no write and no clock comparison.
- `GET /api/messaging/conversations` and the reconnect `GET /api/messaging/sync`
  summary carry `done`, `doneAt`, `doneThroughMessageId`; a done thread is
  served with `unreadCount: 0` for that user. Read receipts are never faked —
  the sender still sees the messages unread. With the module off nothing is
  reported done (stored rows are kept and come back when it is switched on).
- A done thread is served with `unreadCount: 0`, so when a new message
  re-opens it the client re-reads the conversation list once (debounced) and
  unread messages older than the loaded window count again.
- `CONVERSATION_DONE_CHANGED` goes to the user's own sockets, so their other
  devices follow without a reload. Audited `conversation.done` /
  `conversation.undone` (low, conversation id only).
- Messages: Inbox / Done filter, a header toggle ("Mark done" / "Move back to
  inbox", 44px on phones), no unread badge and no contribution to the unread
  total (nav badge, app badge) for a done thread.
- Tests: tests/done.test.ts, tests/client-done.test.ts;
  check: scripts/done-check.mjs.

### #4 End shift / Start shift — module `shift.handoff`
- `GET /api/shift` (the caller's truth: rotation profile, on shift, pending /
  accepted counts, covering, DND, away message), `POST /api/shift/end`
  `{ coveringUserId?, dnd?, awayMessage? }`, `POST /api/shift/start`
  (server/routes/shift.ts, gated in `GATE_TABLE`; roles hospitalist and
  director — the roles that can hold a rotation profile; no profile → 409
  `no_rotation_profile`, and the UI shows the truthful "Not in the rotation"
  row instead of a button). No new table: `hospitalists.working` plus the
  existing `coveringUserId` / `dnd` / `awayMessage` user preferences.
- End shift is ONE transaction (`storage.endShift`): the profile goes off
  shift, every pending incoming request is handed to the covering provider's
  rotation profile (released `expired`, re-offered `pending` / `manual` with a
  fresh timeout — the shape a director's re-route of a pending request
  takes), the preferences are written and one `shift.end` audit row is
  inserted (ids / counts / flags only; `medium` when requests were handed
  over, else `low`). A failure at any step — the audit insert included —
  rolls all of it back (tested).
- The covering provider is required while requests are pending
  (409 `covering_required` with the count); it must be an active user of the
  caller's org (another tenant's id → 404 like an unknown one; yourself → 400;
  deactivated → 409) and, to take pending requests, on shift in the rotation
  (409 `covering_not_in_rotation` / `covering_off_shift`). With nothing
  pending it is optional and the stored covering preference is kept.
- **Accepted patients are never re-routed** — they stay on the caller's
  census; the confirm dialog states this rule with the server's accepted and
  pending counts before the one write. After commit the covering provider's
  unit gets the normal assignment alert, the handed-off requests' re-push
  timers stop, and every session re-reads rotation and assignments.
- DND / away message belong to `messaging.dnd`: refused (404
  `module_disabled`, nothing changed) while it is off, and the dialog does
  not offer them then.
- Start shift is the inverse in one transaction: on shift, DND off, one
  `shift.start` audit row; the covering preference and away message are kept
  (they are standing preferences).
- Settings → Rotation: with the module on, End shift / Start shift replaces
  the bare On shift switch for anyone with a rotation profile (a director who
  takes patients included). With it off, the old switch is back.
- Not covered by this rule (judgment call, stated): the director's
  `PATCH /api/hospitalists/:id/working-status` (and the self switch while
  `shift.handoff` is off) still take a provider off shift without a hand-off;
  requests left pending expire and re-route on the normal timeout path. If
  that should close too, the shape is: module on + self + `working:false` +
  pending → 409 `covering_required`.
- Tests: tests/shift-handoff.test.ts, tests/client-shift.test.ts,
  tests/client-comms-account.test.ts (switch = module-off variant);
  check: scripts/shift-handoff-check.mjs.

### #5 Unread-message reminder — module `messaging.unreadReminder`
- `GET` / `PUT /api/messaging/unread-reminder` `{ enabled, intervalMin }`
  (server/routes/reminders.ts, gated in `GATE_TABLE`): the caller's own
  `user_reminder_prefs` row (organization + user from the session, never the
  body; `.strict()` — no extra fields). Off until the user opts in; the
  interval is one of 5 / 10 / 15 / 30 minutes (default 10). A change is
  audited `reminder.prefs_update` (low; the flag and interval only).
- The sweep (server/services/unread-reminder.ts), modelled on the STAT
  re-alert loop: every 60 s, for every org in its own try/catch (one
  tenant's failure is logged by org id and never stops another's), each
  opted-in user whose OLDEST unread live message is at least their interval
  old — and who was not reminded within the last interval — gets ONE push:
  "You have unread messages in DocTurn". No count, no names, no message
  text: push vendors sign no BAA. Then `last_reminded_at` is stamped.
- Skipped, before any side effect: the module off for the org, push off for
  the org (`integration.push`, so nothing is marked either), DND, a
  deactivated account, and a Done thread while `messaging.done` is on (the
  conversation list's own rule: a newer message re-opens it and its unread
  messages count again). The user's own messages never count.
- **Per-process timer**: the loop runs inside each server process. With N
  instances an opted-in user can receive up to N reminders per interval —
  `last_reminded_at` narrows that race but does not close it. A
  multi-instance deployment should run the sweep on one instance (or move it
  to a shared scheduler). The loop logs only a count when it sends.
- Settings → Notifications: "Unread-message reminder" switch and, while on,
  5 / 10 / 15 / 30 min chips (44px); each change is one PUT and the screen
  shows the server's stored answer. The row says when no reminder can reach
  this device (push off for the org, or not enabled on this device).
- Tests: tests/unread-reminder.test.ts (the sweep is driven directly with an
  injected clock), tests/client-reminder.test.ts; check:
  scripts/unread-reminder-check.mjs (with `TIMER=1` it also waits for the
  real server's own timer to fire).

### #6 Quick responses — the existing module `messaging.templates`
- No second store and no new route: quick responses ARE the user's message
  templates (`GET` / `POST` / `PATCH` / `DELETE /api/messaging/templates`,
  `message_templates`, already gated by `requireModule("messaging.templates")`).
  A personal template is its owner's alone — another user of the same org
  gets 403 on edit / delete and never sees it listed; another tenant's id
  answers 404 exactly like an unknown one. The audit rows
  (`message.template_create` / `_update` / `_delete`, low) carry the id and
  scope only, never the title or text.
- Phone composer: a sideways-scrolling strip of 44px chips above the message
  box — mine first, then the organization's; one tap inserts the text through
  the Templates picker's own path (an urgent / STAT template presets that
  priority while `messaging.priority` is on). No request is made by a tap.
  The last chip opens Settings → Quick responses ("Add quick response" when
  there are none — a fresh tenant has none and no demo rows).
- Settings → Notifications → Quick responses: my personal templates (add /
  edit / delete, each one server call followed by a re-read, so the list is
  the server's), the organization's shown read-only. Directors still manage
  the org's templates from the composer's Templates picker. The page warns to
  keep patient details out of them.
- Module off: no chips, no Settings row, the page says it is switched off;
  a refused call names the feature and re-reads the module map. `templates`
  is emptied on sign-out / identity switch.
- Tests: tests/quick-responses.test.ts (regression pins of the existing
  server rules — the server did not change, so these passed on the old
  server too), tests/client-quick-responses.test.ts (failed on the HEAD
  client); check: scripts/quick-responses-check.mjs.

### #7 PIN unlock — module `security.pin` (default off)
- A PIN re-opens an authenticated, LOCKED session; it is not
  authentication. Routes (server/routes/pin.ts, gated in `GATE_TABLE`):
  `GET` / `PUT` `{ currentPassword, pin }` / `DELETE /api/security/pin` (the
  caller's own row; set / change only with the account password re-entered —
  a wrong one is 403 `wrong_password`, nothing stored) and
  `POST /api/session/unlock-pin` `{ pin }`. Tables: `user_pins` (scrypt hash
  from the password hasher) and `pin_unlock_failures` (one row per user +
  session hash). Both cascade in the tenant delete and the user delete.
- Unlock goes through the existing 423 lock gate: the route is in
  `APP_LOCK_EXEMPT` (not the passthrough list), so an expired lock has
  already ended the session (401). It needs a signed-in, locked session
  (else 401 / 409 `not_locked`), a PIN (409 `pin_not_set`), and lifts the
  lock on that same session (cookie: the session's `appLock`; demo bearer
  token: its own lock) — no new session, no `/api/login`.
- Failures: the attempt is spent atomically BEFORE the hash is checked
  (`reservePinAttempt`, an upsert of the per-session counter), so parallel
  guesses cannot exceed the limit; 403 `wrong_pin` + `attemptsLeft`; the 5th
  wrong PIN → 403 `pin_disabled` `passwordRequired: true` for that session
  (even the right PIN is then refused). A password sign-in replaces the
  session, so the new one may use the PIN again. One session's failures never
  touch another's. The auth limiter (failures only) also covers both routes.
- Audited: `pin.set` / `pin.remove` (low), `auth.pin_failed` (low, attempt
  number), `auth.pin_disabled` (medium), `auth.unlock { method: "pin" }`
  (low) — never digits or passwords.
- PIN policy (judgment call): 4–8 digits, not one repeated digit, not a
  straight ascending / descending run.
- The idle auto-lock is unchanged — it back-dates the lock a full idle window
  and so is still an automatic logoff that no PIN re-opens. The PIN re-opens
  a lock the user started (Lock button, another tab) within 15 minutes.
- Lock screen: the locked `GET /api/user` body carries `pinUnlock: true` when
  the module is on, a PIN is set and it is not disabled for this session; the
  screen asks each time it opens (after the lock call has landed) and offers
  the PIN first with "Use password instead". A wrong PIN says how many
  attempts are left; disabled / session ended / module off fall back to the
  password. On success the tab's lock flag is cleared and the normal session
  restore re-opens the socket and data. Nothing about the PIN is stored in
  the browser.
- Settings → Security → PIN unlock: Set PIN / Change / Remove (the dialog
  takes the password, the PIN and the PIN again). `pinStatus` is cleared on
  sign-out / identity switch.
- Tests: tests/pin-unlock.test.ts (13, all failed on the old server),
  tests/client-pin.test.ts (7, failed on the HEAD client); check:
  scripts/pin-unlock-check.mjs.
