# DocTurn Horizon — Predictive Operations Surface (parked idea)

> Status: **parked / not started.** Captured for later. Nothing here is built yet.
> Context: a Pretura-Health–inspired predictive layer for DocTurn, ED/ER-focused,
> feeding the existing assignment + messaging workflow.

---

## 1. The concept (as proposed)

**Vision:** turn DocTurn from a reactive assignment tool into a proactive ops
command center with 30–240 min of forward visibility — surge, boarding,
admit/discharge likelihood — adapted to hospitalist + MDR workflows.

**Target users:** hospitalists & medical directors, charge nurses / bed-flow
coordinators, nursing leadership, administrators.

**90-day pilot success metrics:**
- Reduce average boarding time 15–25%
- Improve discharge-readiness identification
- More proactive (predictive) round-robin assignments
- ≥80% charge-desk adoption

**MVP features:** real-time 4-tier Surge Index (60s refresh); per-patient
discharge probability (4h/8h/24h) + confidence; high-acuity / rapid-risk flags;
boarding-risk heatmap; actionable alerts (into secure messaging); override +
feedback loop; explainability ("Reasons" panel).

**Phase 2:** predictive bed demand & staffing; EMS / pre-hospital integration;
facility-specific ML retraining; MDR auto-population of barriers + predictions.

**NFRs:** HIPAA (BAA, encryption, audit), multi-tenant + RBAC, <2s dashboard
latency, 99.9% uptime, scalable to 800+ beds.

### Proposed architecture (full version)
Ingestion (FHIR R4 subscriptions + HL7v2 + internal events, Kafka/RabbitMQ) →
feature store (TimescaleDB/InfluxDB) → hybrid prediction core (rules first, then
ML: Prophet/TFT for surge, XGBoost/LightGBM for discharge, ensembles for risk;
served via FastAPI + ONNX/SageMaker; weekly retraining) → safety & governance
(clinical rule validator that ML cannot override, override capture, SHAP/bias
monitoring) → app/real-time (FastAPI + Node, Socket.io/WebSockets, Redis) →
frontend (React + React Native, Recharts/Tremor) → infra (AWS HIPAA BAA,
Postgres + vector DB, Sentry/Prometheus/ELK, existing auth + fine-grained RBAC).

### Proposed schema (starter)
```sql
CREATE TABLE horizon_predictions (
  id UUID PRIMARY KEY, tenant_id UUID, patient_id UUID, timestamp TIMESTAMPTZ,
  surge_index INT, discharge_prob_4h FLOAT, discharge_prob_8h FLOAT,
  discharge_prob_24h FLOAT, high_acuity_risk FLOAT, boarding_risk FLOAT,
  reasons JSONB, model_version TEXT
);
CREATE TABLE horizon_feedback (
  id UUID PRIMARY KEY, prediction_id UUID REFERENCES horizon_predictions,
  user_id UUID, actual_outcome TEXT, override_reason TEXT, created_at TIMESTAMPTZ
);
CREATE TABLE horizon_audit_log (...); -- append-only, mandatory for HIPAA
```

---

## 2. Assessment (Claude's take)

**Is it basically what Pretura does?** Directionally yes — same category
(ED/hospital operational forecasting + forward visibility), ported to the
hospitalist/MDR side and bolted onto DocTurn's assignment engine. Caveats:
don't anchor the spec to "match Pretura" (anchor to user decisions); it's a
crowded field (Qventus, LeanTaaS iQueue, Hospital IQ/Lightbeam, Epic's own
predictive models).

**The blueprint describes the easy 20% in detail and waves at the hard 80%.**
The three things that actually decide success:

1. **Data access, not architecture.** Every prediction is gated on real Epic
   FHIR + historical labeled outcomes. DocTurn today is synthetic/store-backed
   with no EHR feed. Real-time bed/admit/discharge realistically comes from
   **HL7v2 ADT**, not FHIR Subscriptions (vitals subscription support is uneven
   across Epic versions). Epic enablement is **per-customer** (Connection Hub /
   Vendor Services). This is the real cost center — quarters of work.
2. **Model validity & calibration, not model choice.** XGBoost/LightGBM +
   strong rules layer = right instinct. Prophet/TFT for surge is overkill early
   (start recent-trend + simple regression/queueing). Must do **prospective
   silent validation** and track **calibration** (Brier score, calibration
   curves), not just AUC — a miscalibrated discharge model destroys trust fast.
3. **Regulatory framing.** Per-patient acuity/discharge scores that drive
   clinical action can drift into SaMD. To stay inside the 21st Century Cures
   Act **CDS carve-out**, the clinician must be able to review the *basis* —
   so the Reasons/SHAP panel is load-bearing, not optional. ADT-only
   operational signals (surge, boarding, bed demand) carry much lower
   regulatory risk than per-patient clinical risk.

**Changes to the plan:**
- Cut the MVP stack hard. No Kafka/Timescale/ONNX/SageMaker/Redis/ELK on day
  one. Use existing Postgres + one Python service + the WebSocket layer already
  in DocTurn. Add infra when throughput justifies it.
- Schema: store a **feature-vector snapshot/hash per prediction** with
  `model_version` (reproducibility, drift, audit); make audit log append-only;
  add `(tenant_id, patient_id, timestamp)` indexes; time-partition predictions.
- Fix metrics: "boarding time" is an ED metric; hospitalist analogs are
  admit-decision-to-bed and discharge-order-to-departure. Pick the interval,
  define the denominator, capture a **baseline** before the pilot.
- Don't trust "generate the whole thing" prompts — they produce plausible,
  unvalidated code. Scaffold UI/arch that way; never the clinical validity.

**Strategic point (the important one):** DocTurn's moat is NOT becoming another
ops-forecasting command center (that's a fight vs. funded incumbents). It's the
**assignment / round-robin / secure-messaging workflow** already owned. So make
predictions *feed that*: boarding-risk- and discharge-readiness-aware routing,
proactive assignments, load-balancing the round-robin by predicted census
change. The dashboard is the demo; **predictive routing is the product.**

---

## 3. Recommended phasing

- **Phase 0 (weeks, low risk):** ADT-only operational layer on the ER-director
  surface — Surge Index + Boarding Heatmap, **no per-patient clinical risk.**
  Useful immediately, minimal regulatory exposure, slots into the existing
  customizable ER-director dashboard widgets.
- **Phase 1:** discharge-probability as a single validated POC (synthetic →
  one pilot facility's real data), shown as an explainable card with override +
  feedback capture.
- **Phase 2:** wire those signals into the assignment engine (predictive
  routing).

---

## 4. What can be demoed now vs. real work

- **Demoable quickly (honest mock):** the Horizon *surface* — `SurgeCard`,
  `BoardingHeatmap`, `DischargeReadinessTable`, `AlertsPanel`, `ReasonsPanel` —
  driven by synthetic data, dropped in as draggable widgets on the ER /
  ER-director dashboards using the existing store + `CustomizableDashboard`
  patterns. Clearly labeled as a predictive *preview*, not live ML.
- **Real, multi-quarter work:** the prediction core (Epic FHIR/HL7 access,
  feature store, validated + calibrated models, safety governance, retraining).

**Open decision when we resume:** start the demo with just **Surge + Boarding
(Phase 0)**, or also include the **per-patient Discharge Readiness** table.
