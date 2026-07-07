# Providence Hospitalist Notes — ChatGPT Prompts

Two prompts live here:

- **Progress note** — `providence-progress-note-v7.4.json` (current)
- **H&P (admission note)** — `providence-hnp-v4.0.json` (current)

# H&P Prompt

## v4.0 — CURRENT: full port of the progress-note conventions

`providence-hnp-v4.0.json` rebuilds the provider's H&P v3.3 prompt with every
convention converged on for the progress note (v6.5 → v7.4):

- Removed the same structural defects the original progress note had: triple-nested
  ASSESSMENT & PLAN, a duplicate progress-note body pasted inside the H&P template,
  loose trailing instructions, hardcoded-name disclaimer (now `@ME@`), and the
  Confirmed/Likely/Possible confidence hierarchy.
- A&P: bold `**#Dx [POA]**` titles (no heading marks), escaped `\- ` dash lines tight
  under the title, `&nbsp;` spacer between problems, evidence-first ordering, ≥4 lines
  per active problem, no "If X then Y" advisory lines, no interpretation lines,
  no ICD codes, POA-only titles with the uncertain-diagnosis fallback, chronic
  problems as full blocks.
- Escaped-dash format also applied to Physical Exam (8 H&P systems: Gen, HEENT, Resp,
  Cardio, Abd, Ext, Neuro, Psych) **and** to PMH, PSH, Home Medications, and Active
  Medications (`HISTORY_AND_MEDS_DASH_LINES_LOCK`).
- H&P-specific machinery preserved: Two-Midnight status statement (gated, final dash
  line of the main diagnosis — shown in the worked example; exempt from the
  no-advisory-lines ban, as is the C. diff prophylaxis statement), GMLOS inference
  exception, stroke NIHSS lock, CHF GDMT, ROS inference-only (no blanket negatives),
  provider-voice HPI/ROS with no source attribution, locked statement templates,
  and the ACP ancillary.
- 19-section completeness checklist (`FULL_NOTE_ALL_SECTIONS_REQUIRED_LOCK`) adapted
  to the H&P section order, with the same first-line/last-line anchors and
  full-rewrite-on-reprompt rule.

# Progress Note Prompt

## v7.9 — CURRENT: three-line title header

**Use `providence-progress-note-v7.9.json`.** Adds a flush-left, three-line title header
at the very top (no markdown heading marks), then the demographics:

```
**Hospitalist Progress Note**
Providence Saint Joseph's Medical Center
Benchmark Hospitalist Group
```

`NOTE_TITLE_HEADER_LOCK` pins the exact wording/order and forbids the old
`PROVIDENCE HEALTH AND SERVICES` letterhead; `FULL_NOTE_ALL_SECTIONS_REQUIRED_LOCK` is
back to 14 sections with the title header as section 1. Everything else (flush-left
dashless demographics, APSO order, escaped-dash A&P/exam) unchanged from v7.8.

## v7.8 (superseded) — no letterhead; demographics flush-left, no dashes

**Use `providence-progress-note-v7.8.json`.** Provider wants the note to start clean at
the left margin with no Providence letterhead. v7.8:

- Removes the entire top letterhead — `PROVIDENCE HEALTH AND SERVICES`, hospital
  location, `HOSPITAL MEDICINE PROGRESS NOTE`, `Benchmark Hospitalists Group` — and the
  leftover `<!-- Licensed... -->` HTML comment. The note now begins directly with the
  patient demographics.
- Patient demographics are now plain flush-left `**Label:** value` lines (bold label,
  **no** leading `-`/bullet, no `PATIENT INFORMATION` heading). Provided fields only;
  missing fields omitted; never fabricated.
- `FULL_NOTE_ALL_SECTIONS_REQUIRED_LOCK` rewritten to 13 sections with no letterhead and
  the demographics as section 1; the first-line/"starting with PROVIDENCE" anchors in the
  rewrite/checklist locks were repointed to the demographics.
- A&P and Physical Exam still use escaped `\-` dash lines (unchanged); only the
  demographics lost their dashes.

## v7.7 (superseded) — APSO order (A&P + Disposition above the objective data)

**Use `providence-progress-note-v7.7.json`.** Provider reordered the Epic wrapper so the
note reads Assessment & Plan first, then Disposition, with the objective data and MDM
time statement at the bottom. v7.7 reorders the ChatGPT template to match, keeping the
v7.6 demographics block (no Unit/Room). New section order:

1. Header → 2. PATIENT INFORMATION → 3. CC → 4. HOSPITAL COURSE (interval narrative) →
5. Overnight Events + Therapy Updates → **6. ASSESSMENT & PLAN → 7. Chronic Problems →
8. DVT / Code / Disposition** → 9. VITAL SIGNS → 10. PHYSICAL EXAM → 11. LABS &
DIAGNOSTICS → 12. ACTIVE MEDS → 13. 50-minute MDM line → 14. disclaimer.

- The top narrative header was renamed `OBJECTIVE / HOSPITAL COURSE` → `HOSPITAL COURSE`
  (the real objective data now lives lower, so the "OBJECTIVE" label there would
  double up). Each objective section keeps its own header (VITAL SIGNS, PHYSICAL EXAM,
  LABS & DIAGNOSTICS, ACTIVE MEDS); say the word if you want an umbrella `### OBJECTIVE`
  header above them.
- `FULL_NOTE_ALL_SECTIONS_REQUIRED_LOCK` rewritten to the new 14-section order.
- Epic-only interactive fields in your wrapper (`{Medically Ready for Discharge}`,
  `{Dispo location}`) are Epic SmartList tokens, not something ChatGPT generates, so
  they stay in the Epic wrapper and are not added to the prompt.

## v7.6 (superseded) — demographics header without Unit/Room

**Use `providence-progress-note-v7.6.json`.** Same as v7.5 but the Unit/Room line is
removed from the PATIENT INFORMATION block, the input schema, and the section-checklist
wording. Remaining demographics: Patient Name, Age, DOB, MRN, Date of Admission, Date of
Service, Attending, Primary Care Physician.

## v7.5 (superseded) — patient demographics header block

**Use `providence-progress-note-v7.5.json`.** In Doximity/ChatGPT the note came out
with no patient Name / Age / DOB / MRN because the JSON `template` had no demographics
section — it jumped from the "Benchmark Hospitalists Group" letterhead straight to the
Chief Complaint (the demographics in the Epic wrapper are Epic `@NAME@` tokens, which
ChatGPT never sees or fills). v7.5 adds a **PATIENT INFORMATION** block right after the
letterhead:

- Escaped-dash lines (same reliable `\- ` format) for Patient Name, Age, DOB, MRN,
  Unit/Room, Date of Admission, Date of Service, Attending, Primary Care Physician.
- `PATIENT_DEMOGRAPHICS_HEADER_LOCK`: populate ONLY from provided input; omit any field
  not provided (no "not provided"); never fabricate a name/DOB/MRN; omit the whole block
  if no demographics are given.
- `input_data_expected` gains `patient.age` and `encounter.attending_physician`,
  `primary_care_physician`, `unit_room`.
- Completeness checklist is now 14 sections (PATIENT INFORMATION is item 2).

**Provide the demographics as input** (Doximity won't pull them from Epic). If instead
you want the note to keep literal Epic tokens (`@NAME@`, `@BDAY@`, …) so Epic fills them
on paste, tell me and I'll swap the placeholders for those tokens.

## v7.4 (superseded) — extra empty line between A&P problems

**Use `providence-progress-note-v7.4.json`.** Provider wants more breathing room
between consecutive problem blocks. Chat renderers collapse consecutive blank lines,
so "two blank lines" wouldn't survive — instead every pair of problems (and the
`**#Chronic Problems**` header) is now separated by blank line + a line containing
only `&nbsp;` + blank line, which renders as a full extra empty line in ChatGPT and
pastes as one into Epic/Word. The separation rule, template format block, both repeat
instructions, and the worked example (now two problems with the spacer between them)
were all updated.

## v7.3 (superseded) — no interpretation lines; exam uses escaped `\-` dashes

**Use `providence-progress-note-v7.3.json`.** Two provider requests:

- Removed the **"Per my interpretation labs show:"** and **"Per my interpretation
  studies show:"** blocks from LABS & DIAGNOSTICS (template + section checklist; the
  checklist now explicitly prohibits them).
- **Physical Exam** now uses the same backslash-escaped `\- ` dash lines as the A&P
  (template skeleton, exam hard lock, and the Word-safe exception all updated), so the
  nine system lines render and copy as literal `-` instead of • bullets.

## v7.2 (superseded) — no "If X, then Y" contingency/advisory bullets

**Use `providence-progress-note-v7.2.json`.** Provider feedback: drop the hypothetical
suggestion lines ("If intolerance develops, then modify therapy", "If persistent BP
elevation or drop occurs, then adjust medications"). Those were mandated by v7.1 —
`PROBLEM_BULLETS_MINIMUM_CONTENT_LOCK` required "ONE contingency bullet in 'If X, then
Y' form" per problem and the worked example ended with one. v7.2:

- Removes the contingency requirement from the minimum-content lock, the template's
  hardwired format block, the skeleton, and both worked examples.
- Adds an explicit prohibition in those same places: no hypothetical contingency or
  advisory lines; document only current, actual orders and monitoring, unless a
  contingency plan is explicitly stated in the provided input data.
- Monitoring thresholds tied to real orders (e.g., "repeat cultures if temperature
  exceeds 38.3 C") remain allowed — the ban targets standalone anticipatory advice.

## v7.1 (superseded) — escaped `\-` dashes (defeat • rendering), chronic problems as full blocks

**Use `providence-progress-note-v7.1.json`.** v7.0 testing showed the model DID output
`- item` lines, but ChatGPT's markdown renderer converts any `- ` line into a • bullet
glyph, which then pastes into Epic as bullets. v7.1 has the model emit each item as
`\- item` (backslash-escaped hyphen): markdown renders the backslash-escaped hyphen as
a literal `-`, so the provider sees and copies plain `- item` lines into Epic. Changes:

- `AP_BOLD_TITLE_AND_DASH_LINES_LOCK`, both examples, the template skeleton, and all
  enforcement rules now require items to start with the literal three characters `\- `.
- **Chronic problems now use the same format as active problems** (bold `**#Title**` +
  escaped dash lines, ≥2 lines when data supports; the 4-line minimum stays
  active-problems-only). The old one-line `→ stable` arrow format is gone.
- **Uncertain-diagnosis fallback**: v7.0 output produced `#Possible urinary tract
  infection` despite the ban. The title lock now gives the model an escape hatch: title
  the objective finding (`#Pyuria on urinalysis`) instead of `Possible X`, with the
  workup in the dash lines.

## v7.0 (superseded) — bold `**#Dx**` titles, literal `-` dashes tight under the title

**Use `providence-progress-note-v7.0.json`.** Provider wants each problem to render as:

```
**#Acute blood loss anemia, improving post transfusion [POA]**
- Hemoglobin improved from 6.8 to 8.2 after PRBC transfusion.
- No active bleeding noted clinically.
```

Bold title (via `**` only — the `####` heading marks are what were injecting extra
vertical spacing in Word/Epic), literal `- ` hyphens instead of `•` bullet glyphs, no
blank line between the title and the first dash, one blank line between problems.

- New `AP_BOLD_TITLE_AND_DASH_LINES_LOCK` with the exact shape spelled out.
- Removed the two-line "section reset" (`### ​` / `### #`) machinery and the
  `####` heading title format everywhere (template, example, ARU lock, Chronic
  Problems header).
- Title qualifier rule relaxed per the provider's own example: factual, data-supported
  trajectory phrases ("improving post transfusion", "resolved") are allowed in titles;
  certainty/hedging words (likely/possible/suspected/confirmed/rule-out) remain banned.

## v6.9 (superseded) — no certainty/status qualifiers; titles are Dx + [POA] only

**Use `providence-progress-note-v6.9.json`.** Provider feedback: diagnosis titles must
never carry certainty words ("Likely", "Confirmed", "Possible", "Suspected") or
status words ("stable", "improving") — a title is the specific diagnosis plus the
optional `[POA]` tag, nothing else. That language came from the original
`GLOBAL_CONFIDENCE_HIERARCHY_PROVIDER_VOICE_LOCK` (which mandated a four-level
Confirmed/Likely/Possible/Under-evaluation hierarchy). v6.9:

- Removes the confidence-hierarchy lock entirely.
- Adds `DX_TITLE_POA_ONLY_NO_QUALIFIERS_LOCK` — titles = maximally specific Dx
  (+ etiology linkage) + optional `[POA]`; explicit violation examples included.
- Adds `PROVIDER_VOICE_NO_HEDGING_LOCK` — no AI-inserted hedging anywhere in the
  note (likely/possibly/suspected/appears/cannot exclude); definitive documentation;
  hedging words reproduced only if verbatim in the source data (e.g., radiology
  impressions). Keeps the integer-score and verbatim-dose-range rules.
- Fixes "suspected type/etiology" wording in the pneumonia specificity rule.
- The template's hardwired A&P format block now restates the title rule inline.

## v6.8 (superseded) — full-note completeness checklist

**Use `providence-progress-note-v6.8.json`.** Testing v6.7 produced the correct
bullets-only A&P but the model output ONLY the A&P, dropping the interval
update/hospital course, exam, vitals, labs, meds, and disposition. Classic
tunnel-vision: heavy emphasis on one section makes the model treat a reprompt as
"redo that section." v6.8 adds:

- `FULL_NOTE_ALL_SECTIONS_REQUIRED_LOCK` — an explicit ordered 13-item section
  checklist; first output line must be `# PROVIDENCE HEALTH AND SERVICES`, last must
  be the disclaimer; omitting/truncating any section is a violation; single-section
  output only when the provider literally writes "output only the [section] section".
- `FULL_NOTE_SECTION_CHECKLIST_ENF` (hidden_logic) — self-check before finishing.
- `FULL_NOTE_REWRITE_ON_REPROMPT_LOCK` strengthened — any reprompt or new data
  regenerates the entire note, never a delta.
- The inline A&P example now ends with an explicit note that it governs only the
  A&P section and all other sections must still render.
- Objective/Hospital Course placeholder now explicitly requires the interval update
  since the prior note.

## v6.7 (superseded) — bullets-only Assessment & Plan

**Use `providence-progress-note-v6.7.json`.** After testing v6.6, the provider
confirmed the *desired* A&P format is the bullets-only one: each problem is a bolded
diagnosis title followed by ONE flat bullet list (evidence bullets first — labs,
imaging, consults — then action bullets), with **no** Assessment paragraph and **no**
"Dx & Consults"/"Plan" subheaders. v6.6 enforced the opposite (paragraph + subsections)
and the model followed it exactly — proving the example-lock works — so v6.7 keeps the
same enforcement machinery and flips the target format:

- `AP_BULLETS_ONLY_NO_PARAGRAPH_LOCK` — title + flat bullets only; voids any
  paragraph/subheader instruction from any source.
- `ASSESSMENT_PLAN_EXAMPLE_FORMAT_LOCK` — worked sepsis example rewritten in
  bullets-only form (in the lock AND inline in the template).
- `PROBLEM_BULLETS_MINIMUM_CONTENT_LOCK` — ≥4 bullets per problem when data supports:
  evidence first, then meds (dose/route/frequency verbatim), antibiotic start date +
  duration, monitoring with thresholds, one "If X, then Y" contingency.
- `MEDICATION_SPECIFICATION_LOCK` fixed — "dose/route/frequency not provided" may only
  be written when details are truly absent; v6.6 output appended it to a fully-specified
  oxycodone order. Verbatim PRN dose ranges are explicitly allowed.
- Chronic problems: one bullet each ("[problem] → stable, continue [med]").
- Removed: assessment-paragraph locks; ARU and consult locks reworded for bullet format.

The v6.6 sections below are kept for history — its root-cause analysis of the original
v6.5 prompt (contradictions, duplicated template, no example) still applies.

---

# v6.6 (superseded) — paragraph-style A&P

`providence-progress-note-v6.6.json` is a corrected version of the v6.5 "hyperspace"
prompt used to generate Epic-ready hospitalist progress notes. v6.5 produced
inconsistent Assessment & Plan output (headers with bare bullets, missing assessment
paragraphs, thin plans). This document explains why, and what v6.6 changes.

## Why ChatGPT was not following the Assessment & Plan rules

### 1. The prompt directly contradicted itself (the biggest problem)

The v6.5 template contained this text — pasted **twice**, once in the middle and once
near the end:

> A/P in problem-based format with NO paragraphs. Each problem = diagnosis header only
> + bullet points underneath. No assessment text.
>
> Format like this:
> #Sepsis
> • Continue antibiotics
> • Monitor labs
> • Supportive care

This is the exact opposite of `ASSESSMENT_PARAGRAPH_DETAILED_LOCK` and
`PLAN_DETAIL_WITH_MEDS_REQUIRED_LOCK`. When a prompt says both "write a detailed
assessment paragraph" and "no paragraphs, no assessment text," the model picks one
essentially at random — and the bullets-only fragment was the *last* instruction in the
template, and models weight later instructions heavily. **This alone explains most of
the misbehavior.** These fragments are deleted in v6.6. Worse, the fragment even
included its own counter-example (`#Sepsis / • Continue antibiotics`), so the only
worked example in the whole prompt demonstrated the format you did NOT want.

### 2. The ASSESSMENT & PLAN section was defined three times, nested inside itself

v6.5 opened `## ASSESSMENT & PLAN` three times, with the section-reset rule and coding
rules restarted mid-sentence (the electrolyte-imbalance rule literally cuts off at
"Electrolyte imbalances:" and a new `# ASSESSMENT & PLAN` begins). The template also
contained a second complete copy of the note (a duplicate Hospital Course / Vitals /
Exam / Labs / Meds block after Disposition) and a hardcoded physician-name disclaimer
alongside the `@ME@` disclaimer. Malformed, duplicated structure makes the model guess
which copy is authoritative. v6.6 has exactly one A&P definition, one problem block
pattern, one disclaimer (`@ME@`), and no trailing duplicate note.

### 3. "Detailed" was not measurable

Models comply far better with countable requirements than with adjectives. v6.6
replaces "must be detailed" with hard minimums:

- **Assessment** = one paragraph, **3–6 full sentences**, and must contain all five:
  certainty level → status/trajectory → ≥2 supporting findings with exact numbers →
  clinical score as a single integer when applicable → treatment response +
  justification for continued inpatient care.
- **Plan** = **minimum 4 bullets** (when data supports them), each starting with an
  action verb, collectively covering: meds (name+dose+route+frequency, antibiotic start
  date + projected duration), monitoring (parameter + frequency + action threshold),
  pending diagnostics, and one contingency ("if X then Y") or disposition task.
- A one-line plan like "Continue antibiotics" is named explicitly as a violation.

### 4. There was no worked example of the format you DO want

v6.6 adds a full worked example (sepsis) in **two places** — a new top-level
`ASSESSMENT_PLAN_EXAMPLE_FORMAT_LOCK`, and inline in the template immediately before
the problem-block skeleton, fenced with:

```
{{FORMAT & DEPTH EXAMPLE — BEGIN ... never copy its diagnoses, values,
medications, consultant names, or dates ... FORMAT & DEPTH EXAMPLE — END}}
```

The fencing matters: without "format only, never copy content," few-shot examples leak
their content into real notes (a fabrication risk in clinical documentation). With it,
the model copies the *shape and depth* only.

## New / changed locks in v6.6

| Lock | Purpose |
|---|---|
| `ASSESSMENT_PLAN_EXAMPLE_FORMAT_LOCK` (new) | Worked sepsis example; every problem block must match its structure and depth; content copying forbidden. |
| `ASSESSMENT_PARAGRAPH_MINIMUM_CONTENT_LOCK` (new) | 3–6 sentences, five required elements. |
| `PLAN_MINIMUM_CONTENT_LOCK` (new) | ≥4 action-verb bullets across meds/monitoring/diagnostics/contingency. |
| `AP_NO_BULLET_ONLY_FORMAT_OVERRIDE_LOCK` (new) | Explicitly voids any "no paragraphs / header + bullets only" instruction from any source — including ChatGPT memory or old custom instructions, which may still carry the old format. |
| `ASSESSMENT_PARAGRAPH_DETAILED_LOCK` (updated) | Now references the example and the sentence minimum. |
| `PLAN_DETAIL_WITH_MEDS_REQUIRED_LOCK` (updated) | Now references the example and the 4-bullet minimum. |
| `NO_ICD_CODES_LOCK` (new) | The "DO not put ICD codes" note was loose text at the bottom of v6.5; now a real lock. The ARU lock's `Z50.89` code was also removed from the rendered title for consistency. |

## Also removed

- The stray trailing lines at the end of v6.5 ("DO not put ICD codes…", the loose
  bullets-only fragments) — everything is now inside a lock or the template.
- The duplicate second note body and hardcoded-name disclaimer.
- Chronic problems now get an explicit lighter rule (1–3 sentence assessment) so the
  4-bullet minimum doesn't force padding on stable problems.

## One thing to do on the ChatGPT side

If this runs as a Custom GPT or with ChatGPT memory enabled, the old
"no paragraphs / bullets only" instruction may persist in **memory or custom
instructions** even after you fix the prompt. Check Settings → Personalization →
Memory and delete anything about note formatting, or the model will keep receiving
the contradiction from outside the prompt.

## The Epic SmartPhrase wrapper (`@DAXASSESSMENTPLAN@` template)

The separate Epic-side SmartPhrase (the one with `@NAME@`, `@LABRCNT(...)@`,
`@DAXASSESSMENTPLAN@`) needs no structural change for this issue — the A&P detail is
controlled by the ChatGPT prompt above, whose output is pasted where
`@DAXASSESSMENTPLAN@` sits. The two loose lines at its bottom ("make plan more
detailed / Make assessment more detailed") can be deleted; they are now enforced by
the locks in v6.6.
