import type { ContextPackage, KnowledgeItem } from "../types.js";

/**
 * STANDARD CONNECTOR INTERFACE
 * ----------------------------
 * Every clinical source (UpToDate, a BAA-covered LLM, Doximity, OpenEvidence,
 * a drug database, a guideline service, ...) implements this. The core product
 * depends only on this interface — adding a source is a new file that
 * registers itself; the rest of the system does not change.
 *
 * Both methods are optional so a source can be enrichment-only or query-only.
 *   - enrichContext(package) → KnowledgeItem[] merged into package.knowledge
 *   - query(question, minimalContext) → structured answer (ad-hoc clinician Q)
 *
 * Connectors receive a MINIMUM-NECESSARY projection of the package built by
 * `selectMinimal` — they never see the whole package unless they declare
 * they need it. No PHI identifiers are ever included (no name, MRN, DOB).
 */

export interface ConnectorDescriptor {
  key: string; // stable id, e.g. "uptodate"
  name: string;
  vendor: string;
  kind: "knowledge" | "aggregator" | "engine";
  description: string;
  /** Config keys the admin UI should collect (secrets are encrypted at rest). */
  configSchema: Array<{ key: string; label: string; secret?: boolean; required?: boolean; default?: unknown }>;
  /** Data this connector needs — the registry sends nothing else. */
  requires: Array<"problems" | "medications" | "allergies" | "labs" | "vitals" | "demographics" | "visit">;
  /** True when a BAA is in place/required for this vendor (admin visibility). */
  baaRequired: boolean;
}

export interface MinimalContext {
  age?: number;
  sex?: string;
  problems?: string[];
  medications?: string[]; // generic names
  allergies?: string[];
  labs?: Array<{ display: string; value: string; flag?: string }>;
  vitals?: Array<{ display: string; value: string }>;
  visitSummary?: string;
}

export interface QueryResult {
  connector: string;
  answer: string;
  citations?: string[];
  items?: KnowledgeItem[];
}

export interface ConnectorContext {
  /** Decrypted per-org config (apiKey etc.). */
  config: Record<string, unknown>;
  orgId: number;
  /** Abort/time budget for the call. */
  signal?: AbortSignal;
}

export interface ClinicalKnowledgeConnector {
  readonly descriptor: ConnectorDescriptor;
  /** Enrich the package with knowledge items. Must be side-effect free. */
  enrichContext?(minimal: MinimalContext, ctx: ConnectorContext): Promise<KnowledgeItem[]>;
  /** Answer an ad-hoc clinical question with minimal context. */
  query?(question: string, minimal: MinimalContext, ctx: ConnectorContext): Promise<QueryResult>;
  /** Optional connectivity check for the admin console. */
  healthcheck?(ctx: ConnectorContext): Promise<{ ok: boolean; detail?: string }>;
}

/** Project a ContextPackage down to exactly what a connector declared it needs. */
export function selectMinimal(
  pkg: ContextPackage,
  requires: ConnectorDescriptor["requires"],
  visitSummary?: string,
): MinimalContext {
  const m: MinimalContext = {};
  const need = new Set(requires);
  if (need.has("demographics")) {
    m.age = pkg.patient.age;
    m.sex = pkg.patient.sex;
  }
  if (need.has("problems")) m.problems = pkg.problems.map((p) => p.display);
  if (need.has("medications")) m.medications = [...new Set(pkg.medications.map((x) => x.genericName))];
  if (need.has("allergies")) m.allergies = pkg.allergies.map((a) => a.substance);
  if (need.has("labs")) m.labs = pkg.labs.map((l) => ({ display: l.display, value: l.value, flag: l.flag }));
  if (need.has("vitals")) m.vitals = pkg.vitals.map((v) => ({ display: v.display, value: v.value }));
  if (need.has("visit") && visitSummary) m.visitSummary = visitSummary.slice(0, 2000);
  return m;
}
