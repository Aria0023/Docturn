import type { TemplateModule } from "./template.js";

/**
 * PLATFORM DEFAULT v1 — encodes the clinician's locked H&P rules.
 *
 * `instructions` is the authoritative engine prompt. Replace/extend its text
 * with the clinician's full locked template via the admin API (a new version)
 * — the hard locks below stay machine-enforced regardless of the prose.
 */
export const DEFAULT_TEMPLATE_NAME = "Locked H&P";

export const DEFAULT_TEMPLATE_MODULE: TemplateModule = {
  schemaVersion: 1,
  noteType: "H&P",
  loincCode: "34117-5",
  loincDisplay: "History and physical note",
  engine: "auto",
  instructions: [
    "You are generating an inpatient History & Physical from ONLY the supplied context package and today's visit input.",
    "HARD_LOCK rules (non-negotiable):",
    "1. Use ONLY the data provided. Never invent findings, results, history, or medications. Use *** where information is missing.",
    "2. STRICT DATA ISOLATION: the context belongs to one patient. Never include names, MRNs, dates of birth, or other identifiers in the note body.",
    "3. Values are UNIT-FREE (write 'Na 134', 'K 3.2', 'BP 142/88', 'HR 96'). Never append units.",
    "4. Medications by GENERIC name only, lower-case, with dose/route/frequency when known.",
    "5. Lists use an ESCAPED DASH: each list line starts with '\\- ' (backslash, dash, space). Never use bullets, asterisks, numbered lists, or markdown.",
    "6. Section headers are UPPERCASE followed by a colon, in the EXACT configured order; every required section is present even if its body is ***.",
    "7. ASSESSMENT AND PLAN is BALANCED: for each problem, one assessment line (problem + POA tag + one-line reasoning), then plan lines as an escaped-dash list. Problems ordered by acuity (reason for admission first).",
    "8. POA TAGGING: every A&P problem ends with (POA), (not POA) or (POA unknown) based on onset relative to admission.",
    "9. TWO-MIDNIGHT LANGUAGE: for inpatient admissions, include the configured two-midnight expectation sentence in the DISPOSITION section; for observation, the observation sentence.",
    "10. Output is WORD-SAFE and EPIC-READY: plain text only, straight quotes, no tabs, no tables, no markdown, no emoji.",
    "11. Knowledge items (drug monographs, evidence) inform the plan but are summarized in the clinician's own words; cite the source name in parentheses only when a recommendation is drawn from it.",
    "12. Prior notes are summaries only; reference them as 'per prior documentation' without quoting.",
    "Style: concise hospitalist voice, complete sentences in HPI, terse fragments in exam/labs, no editorializing.",
  ].join("\n"),
  sections: [
    { key: "cc", title: "CHIEF COMPLAINT", required: true, sources: ["visit.chiefComplaint", "encounter.reasonDisplay"], guidance: "One line." },
    { key: "hpi", title: "HISTORY OF PRESENT ILLNESS", required: true, sources: ["visit.hpi", "visit.freeText", "priorNotes"], guidance: "Chronological narrative; integrate prior documentation summaries as 'per prior documentation'." },
    { key: "pmh", title: "PAST MEDICAL HISTORY", required: true, sources: ["problems"], guidance: "Escaped-dash list of active problems." },
    { key: "meds", title: "HOME MEDICATIONS", required: true, sources: ["medications"], guidance: "Escaped-dash list; generic names; dose/route/frequency when known; unit-free." },
    { key: "allergies", title: "ALLERGIES", required: true, sources: ["allergies"], guidance: "Escaped-dash list or 'No known drug allergies'." },
    { key: "ros", title: "REVIEW OF SYSTEMS", required: true, sources: ["visit.ros"], guidance: "Pertinent positives/negatives; *** if not provided." },
    { key: "exam", title: "PHYSICAL EXAM", required: true, sources: ["vitals", "visit.exam"], guidance: "Vitals line first (unit-free), then exam by system." },
    { key: "data", title: "LABS AND IMAGING", required: true, sources: ["labs"], guidance: "Unit-free values; flag abnormal with (H)/(L)." },
    { key: "ap", title: "ASSESSMENT AND PLAN", required: true, sources: ["problems", "visit.assessment", "visit.plan", "knowledge"], guidance: "Balanced per-problem A&P with POA tags." },
    { key: "dispo", title: "DISPOSITION", required: true, sources: ["visit.admissionStatus"], guidance: "Level of care, two-midnight language, code status ***, DVT/GI prophylaxis." },
  ],
  hardLocks: {
    unitFreeValues: true,
    escapedDashLists: true,
    genericMedicationNames: true,
    poaTagging: true,
    twoMidnightLanguage: true,
    wordSafe: true,
    fullSectionOrder: true,
    strictDataIsolation: true,
    balancedAssessmentPlan: true,
    epicReady: true,
  },
  phrases: {
    twoMidnightInpatient:
      "Inpatient admission is medically necessary; the patient is expected to require hospital care spanning at least two midnights.",
    twoMidnightObservation:
      "Observation status; anticipated hospital stay is less than two midnights with reassessment for conversion to inpatient if the clinical course warrants.",
    blank: "***",
  },
};
