# Note-generation module interface

The module is EHR-agnostic and source-agnostic: it accepts **a template + structured
context (+ today's visit input)** and returns **only the finished note**. It has no access to
storage, the EHR, or any connector.

## Entry point (`server/notes/generation/engine.ts`)

```ts
generateNote({
  template: TemplateModule,        // the ACTIVE version's module (JSON)
  context: ContextPackage,         // from the assembler (+ connectors)
  visit: VisitInput,               // what the clinician typed today
  templateVersionId, templateName, templateVersion,
  engineConfig?                    // per-org engine settings (org_connectors kind="engine")
}) → Promise<NoteResult>

NoteResult = {
  text: string,                    // Word-safe, Epic-ready plain text (LF; export converts)
  sections: [{ key, title, body }],
  warnings: string[],              // hard-lock corrections applied
  templateVersionId, templateName, templateVersion, engine
}
```

Internally: `selectEngine(template)` → `engine.render()` → `applyHardLocks()`. An engine
failure falls back to the deterministic engine; the hard locks run **regardless of engine**.

## Template module (`note_template_versions.module`, schema in `generation/template.ts`)

```jsonc
{
  "schemaVersion": 1,
  "noteType": "H&P",
  "loincCode": "34117-5", "loincDisplay": "History and physical note",
  "engine": "auto",                       // deterministic | llm | auto
  "instructions": "<the clinician's locked template prose, fed verbatim to the engine>",
  "sections": [                           // FULL SECTION ORDER — enforced
    { "key": "cc",   "title": "CHIEF COMPLAINT", "required": true, "guidance": "One line.", "sources": ["visit.chiefComplaint"] },
    { "key": "hpi",  "title": "HISTORY OF PRESENT ILLNESS", "required": true, ... },
    ...
    { "key": "ap",   "title": "ASSESSMENT AND PLAN", "required": true, ... },
    { "key": "dispo","title": "DISPOSITION", "required": true, ... }
  ],
  "hardLocks": {
    "unitFreeValues": true, "escapedDashLists": true, "genericMedicationNames": true,
    "poaTagging": true, "twoMidnightLanguage": true, "wordSafe": true,
    "fullSectionOrder": true, "strictDataIsolation": true,
    "balancedAssessmentPlan": true, "epicReady": true
  },
  "phrases": {
    "twoMidnightInpatient": "Inpatient admission is medically necessary; the patient is expected to require hospital care spanning at least two midnights.",
    "twoMidnightObservation": "Observation status; anticipated hospital stay is less than two midnights ...",
    "blank": "***"
  }
}
```

The platform default v1 (`generation/default-template.ts`) encodes the locked H&P rules:
HARD_LOCK list, balanced A&P, Epic-ready formatting, unit-free values, POA tagging,
two-midnight language, generic medication names, escaped-dash lists, full section order,
strict data isolation. **To load the clinician's complete locked template text**, upload a new
version whose `instructions` is that text (see 06); the hard locks stay enforced.

## HARD_LOCK post-processors (`generation/hardlocks.ts`)

| Lock | What it does to any engine output |
|---|---|
| `wordSafe` / `epicReady` | CRLF→LF, straight quotes, ASCII dashes, tabs→spaces, strips markdown (`#`, `**`, `*`, backticks, tables), preserves `***` wildcards. |
| `escapedDashLists` | `- `, `• `, `* `, `1. ` → `\- ` |
| `genericMedicationNames` | Brand → generic using the package's medications plus a brand dictionary. |
| `strictDataIsolation` | Scrubs MRN/DOB patterns and `Patient/…` references; the route layer additionally rejects a package for a different patient than the launch. |
| `fullSectionOrder` | Re-orders recognised `UPPERCASE:` headers to the template order; inserts missing required sections with `***`; drops unknown sections (warned). |
| `poaTagging` | Every A&P problem line ends with `(POA)` / `(not POA)` / `(POA unknown)` from the package's onset-vs-admission flag. |
| `balancedAssessmentPlan` | Every problem line is followed by ≥1 `\- ` plan line (inserts `\- Plan: ***`). |
| `twoMidnightLanguage` | Inserts the configured inpatient/observation sentence into DISPOSITION when absent. |
| `unitFreeValues` | Strips `mg/dL`, `mmol/L`, `mmHg`, `bpm`, `%`, `mg`, `g`, … after numbers. |

## Engines

* **DeterministicEngine** (`deterministic-v1`) — renders each section from the package and
  visit input by rule. Zero external calls; the default when no LLM is configured; always the
  fallback.
* **LlmEngine** — sends `template.instructions` + section spec as the system prompt and the
  package + visit JSON as the user turn to a **BAA-covered** provider
  (`generation/llm.ts`: Anthropic Messages API, OpenAI-compatible/Azure, or stub). Selected by
  `NOTE_LLM_PROVIDER` / `NOTE_LLM_API_KEY` / `NOTE_LLM_MODEL` or per-org `org_connectors`
  row with `connector_key="engine"`.

Both outputs go through the same hard locks, so output compliance does not depend on the
engine's behaviour.
