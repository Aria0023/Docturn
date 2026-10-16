import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * NOTE-GENERATION MODULE SCHEMA
 * -----------------------------
 * A template version is a self-contained JSON module. It is EHR-agnostic and
 * source-agnostic: it only ever receives a ContextPackage + VisitInput and
 * returns a note. Authorized users upload/edit/activate versions at runtime
 * (no deploy). The module has three layers:
 *   1. `instructions`  — the clinician's authoritative template prose (the
 *                        locked H&P rules) fed verbatim to the engine.
 *   2. `sections`      — ordered section definitions (full section order).
 *   3. `hardLocks`     — machine-enforced output rules applied AFTER any
 *                        engine (deterministic or LLM) so output always
 *                        complies regardless of how it was produced.
 */

export const hardLocksSchema = z.object({
  /** Numeric values carry no units (e.g. "K 3.2", not "3.2 mmol/L"). */
  unitFreeValues: z.boolean().default(true),
  /** Lists use an escaped dash ("\-") so Word/Epic never auto-format bullets. */
  escapedDashLists: z.boolean().default(true),
  /** Medications appear by generic name only. */
  genericMedicationNames: z.boolean().default(true),
  /** Each A&P problem is tagged (POA) / (not POA) / (POA unknown). */
  poaTagging: z.boolean().default(true),
  /** Inpatient admissions include two-midnight expectation language. */
  twoMidnightLanguage: z.boolean().default(true),
  /** Strip markdown, smart quotes, tabs; ASCII punctuation; LF normalized. */
  wordSafe: z.boolean().default(true),
  /** Section headers appear in the exact configured order; required ones always present. */
  fullSectionOrder: z.boolean().default(true),
  /** Only this patient's context is used; identifiers never appear in the body. */
  strictDataIsolation: z.boolean().default(true),
  /** A&P: every problem has both an assessment line and plan lines. */
  balancedAssessmentPlan: z.boolean().default(true),
  /** Epic-ready: uppercase "HEADER:" lines, *** for blanks, no tables. */
  epicReady: z.boolean().default(true),
});

export const sectionSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  required: z.boolean().default(true),
  /** Guidance for the engine (what belongs here, style). */
  guidance: z.string().optional(),
  /** Which context/visit fields feed this section (documentation + deterministic engine). */
  sources: z.array(z.string()).default([]),
});

export const templateModuleSchema = z.object({
  schemaVersion: z.literal(1),
  noteType: z.string().default("H&P"),
  /** LOINC code for the DocumentReference.type on write-back. */
  loincCode: z.string().default("34117-5"),
  loincDisplay: z.string().default("History and physical note"),
  instructions: z.string().min(1),
  sections: z.array(sectionSchema).min(1),
  hardLocks: hardLocksSchema.default({}),
  phrases: z
    .object({
      twoMidnightInpatient: z.string().default(
        "Inpatient admission is medically necessary; the patient is expected to require hospital care spanning at least two midnights.",
      ),
      twoMidnightObservation: z.string().default(
        "Observation status; anticipated hospital stay is less than two midnights with reassessment for conversion to inpatient if the clinical course warrants.",
      ),
      blank: z.string().default("***"),
    })
    .default({}),
  /** Engine preference; the platform may override by org config. */
  engine: z.enum(["deterministic", "llm", "auto"]).default("auto"),
});

export type TemplateModule = z.infer<typeof templateModuleSchema>;
export type HardLocks = z.infer<typeof hardLocksSchema>;

export function parseTemplateModule(raw: unknown): TemplateModule {
  return templateModuleSchema.parse(raw);
}

export function templateChecksum(module: TemplateModule): string {
  return createHash("sha256").update(JSON.stringify(module)).digest("hex").slice(0, 16);
}
