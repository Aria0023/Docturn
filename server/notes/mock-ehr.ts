import { createHash, randomBytes } from "node:crypto";
import express, { Router, type Request, type Response } from "express";

/**
 * MOCK EHR — an in-process SMART-on-FHIR sandbox so the whole plugin runs
 * (and is tested) with zero secrets and no vendor sandbox account. It
 * implements exactly what the plugin uses: smart-configuration discovery,
 * an auto-approving authorize endpoint, PKCE token exchange with launch
 * context, read/search of the standard R4 resources, and DocumentReference
 * create. Mounted at /mock-ehr outside production (or MOCK_EHR=on).
 *
 * Nothing here is used against a real EHR.
 */
export const MOCK_CLIENT_ID = "docturn-notes-mock";
export const MOCK_PATIENT_ID = "pt-1001";
export const MOCK_ENCOUNTER_ID = "enc-5001";
export const MOCK_PRACTITIONER = "Practitioner/dr-chen";

interface IssuedCode {
  challenge: string;
  redirectUri: string;
  scope: string;
  launch?: string;
}

const codes = new Map<string, IssuedCode>();
const tokens = new Map<string, { scope: string; expiresAt: number }>();
const written: Array<Record<string, unknown>> = [];

export function _mockWrittenDocuments() {
  return written;
}
export function _resetMockEhr() {
  codes.clear();
  tokens.clear();
  written.length = 0;
}

function fhirBase(req: Request): string {
  const proto = (req.get("x-forwarded-proto") ?? req.protocol) || "http";
  return `${proto}://${req.get("host")}/mock-ehr/fhir`;
}

function requireBearer(req: Request, res: Response): boolean {
  const auth = req.get("authorization") ?? "";
  const t = auth.replace(/^Bearer\s+/i, "");
  const rec = tokens.get(t);
  if (!rec || rec.expiresAt < Date.now()) {
    res.status(401).json({ resourceType: "OperationOutcome", issue: [{ severity: "error", code: "login" }] });
    return false;
  }
  return true;
}

const bundle = (resources: Array<Record<string, unknown>>) => ({
  resourceType: "Bundle",
  type: "searchset",
  total: resources.length,
  entry: resources.map((r) => ({ resource: r })),
});

/* ── Fixture: one synthetic inpatient ──────────────────────────────────────── */
const PATIENT = {
  resourceType: "Patient",
  id: MOCK_PATIENT_ID,
  name: [{ family: "Testpatient", given: ["Alex"] }],
  gender: "female",
  birthDate: "1958-03-14",
  identifier: [{ system: "urn:mock:mrn", value: "MRN0001001" }],
};
const ENCOUNTER = {
  resourceType: "Encounter",
  id: MOCK_ENCOUNTER_ID,
  status: "in-progress",
  class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "IMP", display: "inpatient encounter" },
  subject: { reference: `Patient/${MOCK_PATIENT_ID}` },
  period: { start: "2026-10-15T22:10:00Z" },
  reasonCode: [{ text: "Acute decompensated heart failure" }],
};
const cond = (id: string, display: string, code: string, onset: string, status = "active") => ({
  resourceType: "Condition",
  id,
  clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: status }] },
  code: { coding: [{ system: "http://snomed.info/sct", code, display }], text: display },
  subject: { reference: `Patient/${MOCK_PATIENT_ID}` },
  onsetDateTime: onset,
});
const CONDITIONS = [
  cond("c1", "Chronic systolic heart failure", "88805009", "2021-06-01"),
  cond("c2", "Type 2 diabetes mellitus", "44054006", "2015-02-10"),
  cond("c3", "Chronic kidney disease stage 3", "433144002", "2022-09-01"),
  cond("c4", "Hypertension", "38341003", "2010-01-01"),
  cond("c5", "Acute kidney injury", "14669001", "2026-10-16T03:00:00Z"),
];
const med = (id: string, text: string, rx: string, value: number, unit: string, freq: string, route = "Oral") => ({
  resourceType: "MedicationRequest",
  id,
  status: "active",
  intent: "order",
  medicationCodeableConcept: { coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: rx, display: text }], text },
  subject: { reference: `Patient/${MOCK_PATIENT_ID}` },
  dosageInstruction: [
    {
      route: { text: route },
      timing: { code: { text: freq } },
      doseAndRate: [{ doseQuantity: { value, unit } }],
    },
  ],
});
const MEDS = [
  med("m1", "Lasix 40 MG Oral Tablet", "200801", 40, "mg", "daily"),
  med("m2", "Toprol XL 50 MG", "866511", 50, "mg", "daily"),
  med("m3", "Metformin 1000 MG Oral Tablet", "861007", 1000, "mg", "BID"),
  med("m4", "Lisinopril 20 MG Oral Tablet", "314077", 20, "mg", "daily"),
  med("m5", "Eliquis 5 MG Oral Tablet", "1364445", 5, "mg", "BID"),
];
const ALLERGIES = [
  {
    resourceType: "AllergyIntolerance",
    id: "a1",
    clinicalStatus: { coding: [{ code: "active" }] },
    code: { text: "Penicillin" },
    criticality: "high",
    patient: { reference: `Patient/${MOCK_PATIENT_ID}` },
    reaction: [{ manifestation: [{ text: "Hives" }] }],
  },
];
const obs = (
  id: string,
  category: "vital-signs" | "laboratory",
  loinc: string,
  display: string,
  value: number,
  unit: string,
  when: string,
  interp?: string,
) => ({
  resourceType: "Observation",
  id,
  status: "final",
  category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: category }] }],
  code: { coding: [{ system: "http://loinc.org", code: loinc, display }], text: display },
  subject: { reference: `Patient/${MOCK_PATIENT_ID}` },
  effectiveDateTime: when,
  valueQuantity: { value, unit, system: "http://unitsofmeasure.org" },
  ...(interp ? { interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: interp }] }] } : {}),
});
const T0 = "2026-10-16T04:00:00Z";
const VITALS = [
  {
    resourceType: "Observation",
    id: "v1",
    status: "final",
    category: [{ coding: [{ code: "vital-signs" }] }],
    code: { coding: [{ system: "http://loinc.org", code: "85354-9", display: "Blood pressure" }] },
    effectiveDateTime: T0,
    component: [
      { code: { coding: [{ code: "8480-6" }] }, valueQuantity: { value: 148, unit: "mmHg" } },
      { code: { coding: [{ code: "8462-4" }] }, valueQuantity: { value: 92, unit: "mmHg" } },
    ],
  },
  obs("v2", "vital-signs", "8867-4", "Heart rate", 102, "/min", T0),
  obs("v3", "vital-signs", "9279-1", "Respiratory rate", 22, "/min", T0),
  obs("v4", "vital-signs", "2708-6", "Oxygen saturation", 91, "%", T0, "L"),
  obs("v5", "vital-signs", "8310-5", "Body temperature", 37.1, "Cel", T0),
];
const LABS = [
  obs("l1", "laboratory", "2951-2", "Sodium", 134, "mmol/L", T0, "L"),
  obs("l2", "laboratory", "2823-3", "Potassium", 5.3, "mmol/L", T0, "H"),
  obs("l3", "laboratory", "2160-0", "Creatinine", 2.1, "mg/dL", T0, "H"),
  obs("l4", "laboratory", "33762-6", "NT-proBNP", 4800, "pg/mL", T0, "H"),
  obs("l5", "laboratory", "718-7", "Hemoglobin", 11.2, "g/dL", T0, "L"),
  obs("l6", "laboratory", "2160-0", "Creatinine", 1.4, "mg/dL", "2026-09-01T10:00:00Z"),
];
const PRIOR_NOTE_TEXT = `CARDIOLOGY CLINIC NOTE
Seen for follow-up of chronic systolic heart failure, EF 30%. Doing well on guideline-directed therapy.
Assessment and Plan:
Chronic systolic HF, NYHA II, euvolemic today. Continue furosemide 40 daily, metoprolol succinate 50 daily, lisinopril 20 daily. Discussed SGLT2 inhibitor; defer pending renal function.
Type 2 diabetes, A1c 7.4. Continue metformin.
CKD 3a, creatinine 1.4, stable.`;
const DOCREFS = [
  {
    resourceType: "DocumentReference",
    id: "d1",
    status: "current",
    type: { coding: [{ system: "http://loinc.org", code: "11488-4", display: "Consult note" }] },
    subject: { reference: `Patient/${MOCK_PATIENT_ID}` },
    date: "2026-09-01T10:30:00Z",
    author: [{ display: "Cardiology Clinic" }],
    content: [{ attachment: { contentType: "text/plain", data: Buffer.from(PRIOR_NOTE_TEXT).toString("base64") } }],
  },
];

export function createMockEhrRouter(): Router {
  const r = Router();
  r.use(express.urlencoded({ extended: false }));
  r.use(express.json({ type: ["application/json", "application/fhir+json"], limit: "2mb" }));

  r.get("/fhir/.well-known/smart-configuration", (req, res) => {
    const base = `${(req.get("x-forwarded-proto") ?? req.protocol) || "http"}://${req.get("host")}/mock-ehr`;
    res.json({
      issuer: fhirBase(req),
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      capabilities: ["launch-ehr", "launch-standalone", "client-public", "client-confidential-symmetric", "context-ehr-patient", "context-ehr-encounter", "permission-patient", "sso-openid-connect"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["openid", "fhirUser", "launch", "launch/patient", "patient/*.read", "patient/DocumentReference.write"],
    });
  });

  // Auto-approving authorize (sandbox). Validates client, redirect and aud.
  r.get("/authorize", (req, res) => {
    const q = req.query as Record<string, string>;
    if (q.client_id !== MOCK_CLIENT_ID) return res.status(400).send("invalid_client");
    if (!q.redirect_uri || !q.state || !q.code_challenge) return res.status(400).send("invalid_request");
    if (q.aud && q.aud.replace(/\/+$/, "") !== fhirBase(req)) return res.status(400).send(`invalid_aud: ${q.aud} != ${fhirBase(req)}`);
    const code = randomBytes(16).toString("hex");
    codes.set(code, { challenge: q.code_challenge, redirectUri: q.redirect_uri, scope: q.scope ?? "", launch: q.launch });
    const u = new URL(q.redirect_uri);
    u.searchParams.set("code", code);
    u.searchParams.set("state", q.state);
    res.redirect(u.toString());
  });

  r.post("/token", (req, res) => {
    const b = req.body as Record<string, string>;
    if (b.grant_type !== "authorization_code") return res.status(400).json({ error: "unsupported_grant_type" });
    const rec = codes.get(b.code ?? "");
    if (!rec) return res.status(400).json({ error: "invalid_grant" });
    codes.delete(b.code!);
    const expected = createHash("sha256").update(b.code_verifier ?? "").digest("base64url");
    if (expected !== rec.challenge) return res.status(400).json({ error: "invalid_grant", detail: "pkce" });
    if (b.redirect_uri !== rec.redirectUri) return res.status(400).json({ error: "invalid_grant", detail: "redirect" });
    const token = randomBytes(24).toString("hex");
    tokens.set(token, { scope: rec.scope, expiresAt: Date.now() + 3600_000 });
    const isEhrLaunch = !!rec.launch;
    // Sandbox convenience: launch=practitioner:<id> impersonates another clinician.
    const practitioner = rec.launch?.startsWith("practitioner:") ? `Practitioner/${rec.launch.slice("practitioner:".length)}` : MOCK_PRACTITIONER;
    const idPayload = Buffer.from(
      JSON.stringify({
        iss: fhirBase(req),
        aud: MOCK_CLIENT_ID,
        sub: practitioner,
        fhirUser: `${fhirBase(req)}/${practitioner}`,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    res.json({
      access_token: token,
      token_type: "Bearer",
      expires_in: 3600,
      scope: rec.scope,
      id_token: `${header}.${idPayload}.`,
      // Launch context: an EHR launch carries patient+encounter; a standalone
      // launch with launch/patient gets the patient only (picker skipped).
      patient: MOCK_PATIENT_ID,
      ...(isEhrLaunch ? { encounter: MOCK_ENCOUNTER_ID } : {}),
      need_patient_banner: true,
    });
  });

  r.use("/fhir", express_json_guard);

  r.get("/fhir/Patient/:id", (req, res) => {
    if (!requireBearer(req, res)) return;
    if (req.params.id !== MOCK_PATIENT_ID) return res.status(404).json({ resourceType: "OperationOutcome" });
    res.json(PATIENT);
  });
  r.get("/fhir/Encounter/:id", (req, res) => {
    if (!requireBearer(req, res)) return;
    if (req.params.id !== MOCK_ENCOUNTER_ID) return res.status(404).json({ resourceType: "OperationOutcome" });
    res.json(ENCOUNTER);
  });
  const search = (type: string, rows: Array<Record<string, unknown>>, filter?: (q: Record<string, string>, r: Record<string, unknown>) => boolean) =>
    r.get(`/fhir/${type}`, (req, res) => {
      if (!requireBearer(req, res)) return;
      const q = req.query as Record<string, string>;
      if (q.patient && q.patient !== MOCK_PATIENT_ID && q.patient !== `Patient/${MOCK_PATIENT_ID}`) return res.json(bundle([]));
      res.json(bundle(filter ? rows.filter((row) => filter(q, row)) : rows));
    });
  search("Condition", CONDITIONS);
  search("MedicationRequest", MEDS);
  search("MedicationStatement", []);
  search("AllergyIntolerance", ALLERGIES);
  search("Observation", [...VITALS, ...LABS], (q, row) => {
    if (!q.category) return true;
    const cats = (row.category as Array<{ coding?: Array<{ code?: string }> }>).flatMap((c) => c.coding ?? []).map((c) => c.code);
    return cats.includes(q.category);
  });
  search("DocumentReference", DOCREFS);

  r.post("/fhir/DocumentReference", (req, res) => {
    if (!requireBearer(req, res)) return;
    const doc = req.body as Record<string, unknown>;
    if (doc.resourceType !== "DocumentReference") return res.status(400).json({ resourceType: "OperationOutcome" });
    const id = `doc-${written.length + 1}`;
    const stored = { ...doc, id, meta: { versionId: "1", lastUpdated: new Date().toISOString() } };
    written.push(stored);
    res.status(201).set("Location", `${fhirBase(req)}/DocumentReference/${id}/_history/1`).json(stored);
  });
  r.get("/fhir/DocumentReference/:id", (req, res) => {
    if (!requireBearer(req, res)) return;
    const d = written.find((w) => w.id === req.params.id) ?? DOCREFS.find((w) => w.id === req.params.id);
    if (!d) return res.status(404).json({ resourceType: "OperationOutcome" });
    res.json(d);
  });

  // Sandbox inspection (no auth; not PHI — synthetic). Lets tests/demos verify write-back.
  r.get("/_inspect/written", (_req, res) => res.json(written));

  return r;
}

function express_json_guard(_req: Request, res: Response, next: () => void) {
  res.setHeader("Content-Type", "application/fhir+json; charset=utf-8");
  next();
}
