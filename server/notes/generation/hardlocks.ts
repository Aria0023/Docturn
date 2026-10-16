import { toGenericName } from "../fhir/mapping.js";
import type { ContextPackage, VisitInput } from "../types.js";
import type { TemplateModule } from "./template.js";

/**
 * HARD_LOCK post-processors. These run on EVERY engine's output so the note
 * complies with the locked rules even when an LLM drifts. Each lock is a
 * pure text transform; `warnings` reports what was corrected.
 */

export interface LockResult {
  text: string;
  sections: Array<{ key: string; title: string; body: string }>;
  warnings: string[];
}

const UNIT_RE =
  /(\d+(?:\.\d+)?)\s?(?:mg\/dL|mmol\/L|mEq\/L|g\/dL|K\/uL|k\/uL|x10\^?\d\/L|10\^\d\/L|U\/L|IU\/L|ng\/mL|pg\/mL|mcg\/dL|mmHg|mm Hg|bpm|\/min|breaths\/min|°F|°C|degF|degC|kg|lbs?|cm|mL\/min(?:\/1\.73m2)?|%|mg|mcg|mL|g|gm|grams?|units?|IU|mEq|L|mL\/hr|mcg\/kg\/min|mg\/kg)(?![A-Za-z0-9/])/gi;

export function stripUnits(text: string): string {
  // Keep "%" out of O2 sat? Rule is unit-free: "SpO2 96" — strip all.
  return text.replace(UNIT_RE, "$1");
}

export function wordSafe(text: string): string {
  // Protect Epic's "***" wildcard from the markdown stripping below.
  const BLANK = "\u0000BLANK\u0000";
  return text
    .replace(/\*\*\*/g, BLANK)
    .replace(/\r\n?/g, "\n")
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\t/g, "  ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    // markdown
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s*\|.*\|\s*$/gm, (m) => m.replace(/\|/g, " ").trim())
    .replace(/[ ]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\u0000BLANK\u0000/g, "***");
}

/** "- item", "• item", "* item", "1. item" → "\- item" */
export function escapeDashLists(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const m = line.match(/^(\s*)(?:[-•*·‣▪]|\d+[.)])\s+(.*)$/);
      if (m && !line.trimStart().startsWith("\\-")) return `${m[1]}\\- ${m[2]}`;
      return line;
    })
    .join("\n");
}

export function genericizeMedications(text: string, pkg: ContextPackage): string {
  let out = text;
  for (const m of pkg.medications) {
    const brand = m.display.split(/\s+\d/)[0]?.trim();
    if (brand && brand.toLowerCase() !== m.genericName && brand.length > 3) {
      const re = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      out = out.replace(re, m.genericName);
    }
  }
  // Generic pass on well-known brands even if not in the package.
  out = out.replace(/\b(Lasix|Coumadin|Eliquis|Xarelto|Lipitor|Crestor|Norvasc|Lopressor|Toprol XL|Toprol|Glucophage|Synthroid|Protonix|Prilosec|Zofran|Tylenol|Motrin|Advil|Plavix|Lantus|Humalog|Novolog|Flomax|Ativan|Xanax|Zoloft|Lexapro|Seroquel|Keflex|Augmentin|Zithromax|Levaquin|Cipro|Bactrim|Flagyl|Zosyn|Rocephin|Lovenox|Ventolin|ProAir|Spiriva|Symbicort|Advair|Cozaar|Diovan|Zestril|Aldactone|Cardizem|Colace|Senokot|Miralax|Neurontin|Lyrica|Flexeril|Percocet|Norco|Dilaudid|Ultram|Decadron|Medrol|Solu-Medrol|Benadryl|Pepcid|Reglan|Imodium)\b/g, (b) =>
    toGenericName(b),
  );
  return out;
}

const HEADER_RE = /^([A-Z][A-Z &/]+):\s*$/;

/** Split text into {title, body} by UPPERCASE: header lines. */
export function splitSections(text: string): Array<{ title: string; body: string }> {
  const out: Array<{ title: string; body: string }> = [];
  let cur: { title: string; body: string } | null = null;
  for (const line of text.split("\n")) {
    const m = line.match(HEADER_RE);
    if (m) {
      if (cur) out.push(cur);
      cur = { title: m[1]!.trim(), body: "" };
    } else if (cur) {
      cur.body += (cur.body ? "\n" : "") + line;
    } else if (line.trim()) {
      cur = { title: "", body: line };
    }
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ ...s, body: s.body.replace(/^\n+|\n+$/g, "") }));
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, "");

/** Re-order to the template's section order, add missing required sections. */
export function enforceSectionOrder(
  text: string,
  module: TemplateModule,
  warnings: string[],
): { text: string; sections: Array<{ key: string; title: string; body: string }> } {
  const found = splitSections(text);
  const sections: Array<{ key: string; title: string; body: string }> = [];
  const used = new Set<number>();
  for (const def of module.sections) {
    const i = found.findIndex((f, idx) => !used.has(idx) && (norm(f.title) === norm(def.title) || norm(f.title) === norm(def.key)));
    if (i >= 0) {
      used.add(i);
      sections.push({ key: def.key, title: def.title, body: found[i]!.body || module.phrases.blank });
    } else if (def.required) {
      warnings.push(`section_added:${def.key}`);
      sections.push({ key: def.key, title: def.title, body: module.phrases.blank });
    }
  }
  const extra = found.filter((_, idx) => !used.has(idx) && found[idx]!.title);
  if (extra.length) warnings.push(`sections_dropped:${extra.map((e) => e.title).join("|")}`);
  // Unlabeled leading text (no header) is folded into HPI if present, else dropped.
  const lead = found.find((f) => !f.title);
  if (lead?.body) {
    const hpi = sections.find((s) => s.key === "hpi");
    if (hpi) hpi.body = hpi.body === module.phrases.blank ? lead.body : `${lead.body}\n${hpi.body}`;
  }
  return { text: sections.map((s) => `${s.title}:\n${s.body}`).join("\n\n"), sections };
}

const POA_RE = /\((?:POA|not POA|POA unknown)\)\s*$/i;

/** Tag A&P problem lines (non-list lines inside the A&P section) with POA. */
export function enforcePoa(sections: Array<{ key: string; title: string; body: string }>, pkg: ContextPackage, warnings: string[]) {
  const ap = sections.find((s) => s.key === "ap");
  if (!ap || ap.body === "***") return;
  const lines = ap.body.split("\n").map((line) => {
    const t = line.trim();
    if (!t || t.startsWith("\\-") || POA_RE.test(t)) return line;
    const problem = pkg.problems.find((p) => t.toLowerCase().includes(p.display.toLowerCase().split(" (")[0]!));
    const tag = problem?.poa === "Y" ? "(POA)" : problem?.poa === "N" ? "(not POA)" : "(POA unknown)";
    warnings.push(`poa_tagged:${t.slice(0, 30)}`);
    return `${line.replace(/\s+$/, "")} ${tag}`;
  });
  ap.body = lines.join("\n");
}

/** Every A&P problem line must be followed by at least one plan line. */
export function enforceBalancedAp(sections: Array<{ key: string; title: string; body: string }>, module: TemplateModule, warnings: string[]) {
  const ap = sections.find((s) => s.key === "ap");
  if (!ap || ap.body === module.phrases.blank) return;
  const lines = ap.body.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    out.push(lines[i]!);
    const isProblem = t && !t.startsWith("\\-");
    const next = lines[i + 1]?.trim();
    if (isProblem && !(next && next.startsWith("\\-"))) {
      out.push(`\\- Plan: ${module.phrases.blank}`);
      warnings.push(`plan_added:${t.slice(0, 30)}`);
    }
  }
  ap.body = out.join("\n");
}

export function enforceTwoMidnight(sections: Array<{ key: string; title: string; body: string }>, module: TemplateModule, visit: VisitInput, warnings: string[]) {
  const d = sections.find((s) => s.key === "dispo");
  if (!d) return;
  const status = visit.admissionStatus ?? "unspecified";
  const phrase =
    status === "inpatient" ? module.phrases.twoMidnightInpatient : status === "observation" ? module.phrases.twoMidnightObservation : undefined;
  if (!phrase) return;
  if (!d.body.toLowerCase().includes("midnight")) {
    d.body = d.body === module.phrases.blank ? phrase : `${phrase}\n${d.body}`;
    warnings.push("two_midnight_added");
  }
}

/** Strict isolation: scrub identifier-looking tokens (MRN-like, DOB-like, "Patient/123"). */
export function scrubIdentifiers(text: string, warnings: string[]): string {
  let n = 0;
  const out = text
    .replace(/\b(?:MRN|medical record (?:number|#))\s*[:#]?\s*\w+/gi, () => (n++, "MRN ***"))
    .replace(/\b(?:DOB|date of birth)\s*[:#]?\s*[\d/.-]+/gi, () => (n++, "DOB ***"))
    .replace(/\b(?:Patient|Encounter|Practitioner)\/[A-Za-z0-9.-]+/g, () => (n++, "***"));
  if (n) warnings.push(`identifiers_scrubbed:${n}`);
  return out;
}

/** Apply every enabled lock. Order matters: structure first, then text-level locks. */
export function applyHardLocks(raw: string, module: TemplateModule, pkg: ContextPackage, visit: VisitInput): LockResult {
  const warnings: string[] = [];
  const L = module.hardLocks;
  let text = raw;
  if (L.wordSafe) text = wordSafe(text);
  if (L.escapedDashLists) text = escapeDashLists(text);
  if (L.genericMedicationNames) text = genericizeMedications(text, pkg);
  if (L.strictDataIsolation) text = scrubIdentifiers(text, warnings);

  let sections: Array<{ key: string; title: string; body: string }>;
  if (L.fullSectionOrder) {
    ({ text, sections } = enforceSectionOrder(text, module, warnings));
  } else {
    sections = splitSections(text).map((s, i) => ({ key: module.sections[i]?.key ?? `s${i}`, title: s.title, body: s.body }));
  }
  if (L.poaTagging) enforcePoa(sections, pkg, warnings);
  if (L.balancedAssessmentPlan) enforceBalancedAp(sections, module, warnings);
  if (L.twoMidnightLanguage) enforceTwoMidnight(sections, module, visit, warnings);

  text = sections.map((s) => `${s.title}:\n${s.body}`).join("\n\n");
  if (L.unitFreeValues) {
    const before = text;
    text = stripUnits(text);
    if (before !== text) warnings.push("units_stripped");
    for (const s of sections) s.body = stripUnits(s.body);
  }
  if (L.wordSafe) text = wordSafe(text);
  return { text: text.trim() + "\n", sections, warnings };
}
