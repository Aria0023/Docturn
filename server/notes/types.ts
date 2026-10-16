/**
 * Shared types for the clinical-note plugin. Everything here is EPHEMERAL:
 * these objects exist in a request/session and are discarded afterwards.
 * Nothing in this file is ever written to the database.
 */

/* ── SMART session (lives in req.session; cleared on end-session/expiry) ───── */

export interface SmartPending {
  orgId: number;
  connectionId: number;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  /** Present for an EHR launch, absent for standalone. */
  launch?: string;
  authorizeEndpoint: string;
  tokenEndpoint: string;
  createdAt: number;
}

export interface SmartSession {
  orgId: number;
  connectionId: number;
  iss: string;
  tokenEndpoint: string;
  accessToken: string;
  refreshToken?: string;
  /** epoch ms */
  expiresAt: number;
  scope: string;
  /** FHIR logical ids from the launch context. */
  patientId?: string;
  encounterId?: string;
  fhirUser?: string;
  startedAt: number;
}

/* ── Context package (the only input the note-generation module sees) ─────── */

export interface Coded {
  system?: string;
  code?: string;
  display: string;
}

export interface ContextProblem extends Coded {
  clinicalStatus?: string; // active | resolved | inactive
  onset?: string;
  /** Present-on-admission hint derived from onset vs encounter start. */
  poa?: "Y" | "N" | "U";
}

export interface ContextMedication {
  /** Generic (RxNorm ingredient) name when resolvable, else the display. */
  genericName: string;
  display: string;
  dose?: string;
  route?: string;
  frequency?: string;
  status?: string;
  source: "MedicationRequest" | "MedicationStatement" | "external";
}

export interface ContextAllergy {
  substance: string;
  reaction?: string;
  criticality?: string;
}

export interface ContextObservation extends Coded {
  /** Unit-free numeric or string value (units are stripped per HARD_LOCK). */
  value: string;
  effective?: string;
  category: "vital-signs" | "laboratory" | "other";
  /** Flag relative to reference range when the EHR supplies one. */
  flag?: "H" | "L" | "HH" | "LL";
}

export interface PriorNoteSummary {
  date?: string;
  type?: string;
  author?: string;
  /** Short extractive summary — raw note text is never carried forward. */
  summary: string;
}

export interface KnowledgeItem {
  connector: string;
  kind: "drug-monograph" | "evidence" | "guideline" | "interaction" | "other";
  title: string;
  content: string;
  citations?: string[];
  /** Which context element(s) this item relates to (display strings). */
  relatesTo?: string[];
}

export interface ContextPackage {
  schemaVersion: 1;
  patient: {
    reference: string; // Patient/<id>
    age?: number;
    sex?: string;
  };
  encounter?: {
    reference: string; // Encounter/<id>
    class?: string;
    start?: string;
    reasonDisplay?: string;
    status?: string;
  };
  problems: ContextProblem[];
  medications: ContextMedication[];
  allergies: ContextAllergy[];
  vitals: ContextObservation[];
  labs: ContextObservation[];
  priorNotes: PriorNoteSummary[];
  knowledge: KnowledgeItem[];
  provenance: {
    sources: string[]; // e.g. ["ehr:fhir", "aggregator:metriport", "knowledge:uptodate"]
    assembledAt: string;
    warnings: string[];
  };
}

/* ── Visit input (what the clinician types today) ─────────────────────────── */

export interface VisitInput {
  chiefComplaint?: string;
  hpi?: string;
  ros?: string;
  exam?: string;
  assessment?: string;
  plan?: string;
  /** Free-form dictation/notes; the engine distributes it into sections. */
  freeText?: string;
  /** Admission status language (two-midnight rule). */
  admissionStatus?: "inpatient" | "observation" | "unspecified";
}

/* ── Generation result ─────────────────────────────────────────────────────── */

export interface NoteResult {
  /** Final, Word-safe, Epic-ready plain text (LF line endings; export converts). */
  text: string;
  sections: Array<{ key: string; title: string; body: string }>;
  warnings: string[];
  templateVersionId: number;
  templateName: string;
  templateVersion: number;
  engine: string;
}
