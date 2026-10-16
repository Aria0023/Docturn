import type { ContextPackage } from "../types.js";
import { mapAllergy, mapCondition, mapMedication, mapObservation, latestPerCode } from "../fhir/mapping.js";
import type { FhirBundle, FhirResource } from "../fhir/client.js";

/**
 * External data AGGREGATOR (Metriport or equivalent): cross-system records
 * and pharmacy history. It is NOT a knowledge connector — it returns extra
 * FHIR data that is merged into the same ContextPackage before the knowledge
 * connectors run. Strictly ON-DEMAND: only called when the clinician ticks
 * "include external records". Stub without an API key.
 */
export interface ExternalDataAggregator {
  readonly key: string;
  fetchConsolidated(input: {
    /** The EHR patient id (used to look up/match the aggregator's patient). */
    patientReference: string;
    demographics: { age?: number; sex?: string };
    config: Record<string, unknown>;
  }): Promise<Partial<Pick<ContextPackage, "problems" | "medications" | "allergies" | "labs">> & { source: string }>;
}

export class MetriportAggregator implements ExternalDataAggregator {
  readonly key = "metriport";

  async fetchConsolidated(input: Parameters<ExternalDataAggregator["fetchConsolidated"]>[0]) {
    if (!input.config.apiKey) {
      return { source: "aggregator:metriport(stub)", medications: [], problems: [], allergies: [], labs: [] };
    }
    const base = String(input.config.baseUrl ?? "https://api.metriport.com").replace(/\/+$/, "");
    // Metriport's medical API: /medical/v1/patient/{id}/consolidated?resources=...
    const externalPatientId = String(input.config.patientIdMap?.[input.patientReference as never] ?? input.patientReference.split("/")[1]);
    const res = await fetch(
      `${base}/medical/v1/patient/${encodeURIComponent(externalPatientId)}/consolidated?resources=Condition,MedicationRequest,MedicationStatement,AllergyIntolerance,Observation`,
      { headers: { "x-api-key": String(input.config.apiKey), Accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`metriport_error ${res.status}`);
    const bundle = (await res.json()) as FhirBundle;
    const resources = (bundle.entry ?? []).map((e) => e.resource).filter((r): r is FhirResource => !!r);
    const by = (t: string) => resources.filter((r) => r.resourceType === t);
    return {
      source: "aggregator:metriport",
      problems: by("Condition").map((c) => mapCondition(c)).filter((x): x is NonNullable<typeof x> => !!x),
      medications: [...by("MedicationRequest"), ...by("MedicationStatement")]
        .map(mapMedication)
        .filter((x): x is NonNullable<typeof x> => !!x)
        .map((m) => ({ ...m, source: "external" as const })),
      allergies: by("AllergyIntolerance").map(mapAllergy).filter((x): x is NonNullable<typeof x> => !!x),
      labs: latestPerCode(by("Observation").map(mapObservation).filter((x): x is NonNullable<typeof x> => !!x)),
    };
  }
}

/** Merge aggregator output into the package, de-duplicating by display/generic name. */
export function mergeExternal(
  pkg: ContextPackage,
  ext: Awaited<ReturnType<ExternalDataAggregator["fetchConsolidated"]>>,
): ContextPackage {
  const lower = (s: string) => s.toLowerCase();
  const probs = new Set(pkg.problems.map((p) => lower(p.display)));
  const meds = new Set(pkg.medications.map((m) => lower(m.genericName)));
  const alls = new Set(pkg.allergies.map((a) => lower(a.substance)));
  const labs = new Set(pkg.labs.map((l) => l.code ?? lower(l.display)));
  return {
    ...pkg,
    problems: [...pkg.problems, ...(ext.problems ?? []).filter((p) => !probs.has(lower(p.display)))],
    medications: [...pkg.medications, ...(ext.medications ?? []).filter((m) => !meds.has(lower(m.genericName)))],
    allergies: [...pkg.allergies, ...(ext.allergies ?? []).filter((a) => !alls.has(lower(a.substance)))],
    labs: [...pkg.labs, ...(ext.labs ?? []).filter((l) => !labs.has(l.code ?? lower(l.display)))],
    provenance: { ...pkg.provenance, sources: [...pkg.provenance.sources, ext.source] },
  };
}
