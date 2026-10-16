import type { EhrConnection } from "@shared/schema";
import { FhirClient, type FhirResource } from "../fhir/client.js";
import {
  ageFromBirthDate,
  ccDisplay,
  latestPerCode,
  mapAllergy,
  mapCondition,
  mapMedication,
  mapObservation,
} from "../fhir/mapping.js";
import type { ContextPackage, PriorNoteSummary, SmartSession } from "../types.js";

/**
 * Context assembler: pulls standard FHIR R4 resources from the primary EHR,
 * summarizes prior notes, and produces a clean, minimum-necessary
 * ContextPackage. The package is returned to the caller and NEVER stored.
 */

export interface AssembleOptions {
  /** How many prior notes to summarize (most recent first). */
  priorNoteLimit?: number;
  /** Max characters of each prior note to read before summarizing. */
  priorNoteReadChars?: number;
}

const DEFAULTS: Required<AssembleOptions> = { priorNoteLimit: 5, priorNoteReadChars: 6000 };

export async function assembleContext(
  session: SmartSession,
  _connection: EhrConnection,
  opts: AssembleOptions = {},
): Promise<ContextPackage> {
  const o = { ...DEFAULTS, ...opts };
  const client = new FhirClient(session.iss, session.accessToken);
  const warnings: string[] = [];
  if (!session.patientId) throw new Error("no_patient_context");
  const pid = session.patientId;

  const safe = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      warnings.push(`${label}: ${(err as Error).message}`);
      return fallback;
    }
  };

  const [patient, encounter, conditions, medReqs, medStmts, allergies, vitals, labs, docRefs] =
    await Promise.all([
      safe("Patient", () => client.read("Patient", pid), undefined),
      session.encounterId
        ? safe("Encounter", () => client.read("Encounter", session.encounterId!), undefined)
        : Promise.resolve(undefined),
      safe("Condition", () => client.search("Condition", { patient: pid, "clinical-status": "active" }), []),
      safe("MedicationRequest", () => client.search("MedicationRequest", { patient: pid, status: "active" }), []),
      safe("MedicationStatement", () => client.search("MedicationStatement", { patient: pid, status: "active" }), []),
      safe("AllergyIntolerance", () => client.search("AllergyIntolerance", { patient: pid }), []),
      safe(
        "Observation(vitals)",
        () => client.search("Observation", { patient: pid, category: "vital-signs", _sort: "-date", _count: "50" }),
        [],
      ),
      safe(
        "Observation(labs)",
        () => client.search("Observation", { patient: pid, category: "laboratory", _sort: "-date", _count: "100" }),
        [],
      ),
      safe(
        "DocumentReference",
        () => client.search("DocumentReference", { patient: pid, _sort: "-date", _count: String(o.priorNoteLimit) }),
        [],
      ),
    ]);

  const encStart = (encounter?.period as { start?: string } | undefined)?.start;
  const problems = conditions.map((c) => mapCondition(c, encStart)).filter((x): x is NonNullable<typeof x> => !!x);
  const medications = [...medReqs, ...medStmts]
    .map(mapMedication)
    .filter((x): x is NonNullable<typeof x> => !!x);
  const allergyList = allergies.map(mapAllergy).filter((x): x is NonNullable<typeof x> => !!x);
  const vitalList = latestPerCode(vitals.map(mapObservation).filter((x): x is NonNullable<typeof x> => !!x));
  const labList = latestPerCode(labs.map(mapObservation).filter((x): x is NonNullable<typeof x> => !!x));

  const priorNotes = await summarizePriorNotes(client, docRefs.slice(0, o.priorNoteLimit), o.priorNoteReadChars, warnings);

  return {
    schemaVersion: 1,
    patient: {
      reference: `Patient/${pid}`,
      age: ageFromBirthDate(patient?.birthDate as string | undefined),
      sex: patient?.gender as string | undefined,
    },
    encounter: encounter
      ? {
          reference: `Encounter/${encounter.id}`,
          class: (encounter.class as { code?: string; display?: string } | undefined)?.display ??
            (encounter.class as { code?: string } | undefined)?.code,
          start: encStart,
          status: encounter.status as string | undefined,
          reasonDisplay: ((encounter.reasonCode as Array<Record<string, unknown>> | undefined) ?? [])
            .map((r) => ccDisplay(r as never))
            .filter(Boolean)
            .join("; ") || undefined,
        }
      : session.encounterId
        ? { reference: `Encounter/${session.encounterId}` }
        : undefined,
    problems,
    medications,
    allergies: allergyList,
    vitals: vitalList,
    labs: labList,
    priorNotes,
    knowledge: [],
    provenance: { sources: ["ehr:fhir"], assembledAt: new Date().toISOString(), warnings },
  };
}

/**
 * Prior-note summarization is extractive and deterministic: the first lines
 * of the Assessment/Plan (or the first sentences) of each note. Raw note
 * text is read, summarized, and dropped — only the summary enters the
 * package. A knowledge connector (BAA-covered LLM) may replace this with an
 * abstractive summary; the contract is the same.
 */
async function summarizePriorNotes(
  client: FhirClient,
  docRefs: FhirResource[],
  readChars: number,
  warnings: string[],
): Promise<PriorNoteSummary[]> {
  const out: PriorNoteSummary[] = [];
  for (const d of docRefs) {
    const content = (d.content as Array<{ attachment?: { contentType?: string; data?: string; url?: string } }> | undefined)?.[0]
      ?.attachment;
    let text: string | undefined;
    try {
      if (content?.data && (content.contentType ?? "").startsWith("text/")) {
        text = Buffer.from(content.data, "base64").toString("utf8");
      } else if (content?.url) {
        text = await client.fetchBinaryText(content.url);
      }
    } catch (err) {
      warnings.push(`DocumentReference/${d.id}: ${(err as Error).message}`);
    }
    out.push({
      date: (d.date as string | undefined) ?? undefined,
      type: ccDisplay(d.type as never) || undefined,
      author: (d.author as Array<{ display?: string }> | undefined)?.[0]?.display,
      summary: text ? extractiveSummary(text.slice(0, readChars)) : "(note body unavailable)",
    });
  }
  return out;
}

export function extractiveSummary(text: string, maxChars = 480): string {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  // Prefer the Assessment/Plan section when present.
  const ap = clean.match(/(?:assessment(?:\s*(?:and|&|\/)\s*plan)?|impression)\s*:?\s*\n?([\s\S]{0,2000})/i)?.[1];
  const src = (ap ?? clean).trim();
  const sentences = src.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  let out = "";
  for (const s of sentences) {
    if ((out + " " + s).trim().length > maxChars) break;
    out = (out + " " + s).trim();
  }
  return out || src.slice(0, maxChars);
}
