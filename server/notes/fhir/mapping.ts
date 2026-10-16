import type {
  ContextAllergy,
  ContextMedication,
  ContextObservation,
  ContextProblem,
} from "../types.js";
import type { FhirResource } from "./client.js";

/**
 * FHIR R4 → context mapping. Pure functions, no I/O. Values are made
 * UNIT-FREE here (HARD_LOCK) and medications are reduced to generic names.
 */

type Coding = { system?: string; code?: string; display?: string };
type CodeableConcept = { coding?: Coding[]; text?: string };

export function ccDisplay(cc: CodeableConcept | undefined): string {
  if (!cc) return "";
  return cc.text ?? cc.coding?.find((c) => c.display)?.display ?? cc.coding?.[0]?.code ?? "";
}
function ccPrimary(cc: CodeableConcept | undefined): Coding | undefined {
  return cc?.coding?.[0];
}

export function ageFromBirthDate(birthDate: string | undefined, now = new Date()): number | undefined {
  if (!birthDate) return undefined;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return undefined;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

/** POA = condition onset/recorded before the encounter started. */
export function poaFlag(onset: string | undefined, encounterStart: string | undefined): "Y" | "N" | "U" {
  if (!onset || !encounterStart) return "U";
  const o = new Date(onset).getTime();
  const e = new Date(encounterStart).getTime();
  if (Number.isNaN(o) || Number.isNaN(e)) return "U";
  return o <= e ? "Y" : "N";
}

export function mapCondition(r: FhirResource, encounterStart?: string): ContextProblem | undefined {
  const code = r.code as CodeableConcept | undefined;
  const display = ccDisplay(code);
  if (!display) return undefined;
  const status = ccPrimary(r.clinicalStatus as CodeableConcept)?.code;
  const onset =
    (r.onsetDateTime as string | undefined) ??
    (r.recordedDate as string | undefined) ??
    ((r.onsetPeriod as { start?: string } | undefined)?.start);
  const primary = ccPrimary(code);
  return {
    display,
    system: primary?.system,
    code: primary?.code,
    clinicalStatus: status,
    onset,
    poa: poaFlag(onset, encounterStart),
  };
}

/** Small brand → generic map; the live product resolves via RxNorm (connector). */
const BRAND_TO_GENERIC: Record<string, string> = {
  lasix: "furosemide",
  coumadin: "warfarin",
  eliquis: "apixaban",
  xarelto: "rivaroxaban",
  lipitor: "atorvastatin",
  crestor: "rosuvastatin",
  zocor: "simvastatin",
  norvasc: "amlodipine",
  lopressor: "metoprolol tartrate",
  toprol: "metoprolol succinate",
  "toprol xl": "metoprolol succinate",
  glucophage: "metformin",
  synthroid: "levothyroxine",
  protonix: "pantoprazole",
  prilosec: "omeprazole",
  nexium: "esomeprazole",
  zofran: "ondansetron",
  tylenol: "acetaminophen",
  motrin: "ibuprofen",
  advil: "ibuprofen",
  plavix: "clopidogrel",
  lantus: "insulin glargine",
  humalog: "insulin lispro",
  novolog: "insulin aspart",
  flomax: "tamsulosin",
  ativan: "lorazepam",
  xanax: "alprazolam",
  zoloft: "sertraline",
  lexapro: "escitalopram",
  prozac: "fluoxetine",
  seroquel: "quetiapine",
  keflex: "cephalexin",
  augmentin: "amoxicillin-clavulanate",
  zithromax: "azithromycin",
  levaquin: "levofloxacin",
  cipro: "ciprofloxacin",
  bactrim: "sulfamethoxazole-trimethoprim",
  flagyl: "metronidazole",
  vancocin: "vancomycin",
  zosyn: "piperacillin-tazobactam",
  rocephin: "ceftriaxone",
  lovenox: "enoxaparin",
  heparin: "heparin",
  aspirin: "aspirin",
  ventolin: "albuterol",
  proair: "albuterol",
  spiriva: "tiotropium",
  symbicort: "budesonide-formoterol",
  advair: "fluticasone-salmeterol",
  cozaar: "losartan",
  diovan: "valsartan",
  zestril: "lisinopril",
  prinivil: "lisinopril",
  hctz: "hydrochlorothiazide",
  aldactone: "spironolactone",
  cardizem: "diltiazem",
  digoxin: "digoxin",
  amiodarone: "amiodarone",
  colace: "docusate",
  senokot: "senna",
  miralax: "polyethylene glycol",
  neurontin: "gabapentin",
  lyrica: "pregabalin",
  flexeril: "cyclobenzaprine",
  percocet: "oxycodone-acetaminophen",
  norco: "hydrocodone-acetaminophen",
  dilaudid: "hydromorphone",
  morphine: "morphine",
  ultram: "tramadol",
  decadron: "dexamethasone",
  medrol: "methylprednisolone",
  prednisone: "prednisone",
  solu_medrol: "methylprednisolone",
  "solu-medrol": "methylprednisolone",
  benadryl: "diphenhydramine",
  pepcid: "famotidine",
  reglan: "metoclopramide",
  imodium: "loperamide",
};

/** Lower-case, strip strengths/forms, map known brands. */
export function toGenericName(display: string): string {
  const cleaned = display
    .toLowerCase()
    .replace(/\b\d+(\.\d+)?\s*(mg|mcg|g|ml|units?|meq|%)\b.*$/i, "")
    .replace(/\b(tablet|tab|capsule|cap|oral|solution|injection|inj|er|xl|sr|dr)\b/g, " ")
    .replace(/\[.*?\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [brand, generic] of Object.entries(BRAND_TO_GENERIC)) {
    if (cleaned === brand || cleaned.startsWith(brand + " ")) return generic;
  }
  // "generic [BRAND]" style display from RxNorm SBD strings → take generic part.
  return cleaned || display.toLowerCase();
}

type Dosage = {
  text?: string;
  route?: CodeableConcept;
  timing?: { code?: CodeableConcept; repeat?: { frequency?: number; period?: number; periodUnit?: string } };
  doseAndRate?: Array<{ doseQuantity?: { value?: number; unit?: string } }>;
};

function dosageParts(d: Dosage | undefined): Pick<ContextMedication, "dose" | "route" | "frequency"> {
  if (!d) return {};
  const dq = d.doseAndRate?.[0]?.doseQuantity;
  const dose = dq?.value != null ? String(dq.value) : undefined; // unit-free by design
  const route = ccDisplay(d.route) || undefined;
  const freq =
    ccDisplay(d.timing?.code) ||
    (d.timing?.repeat?.frequency && d.timing.repeat.periodUnit
      ? `${d.timing.repeat.frequency}x per ${d.timing.repeat.period ?? 1}${d.timing.repeat.periodUnit}`
      : undefined) ||
    undefined;
  return { dose, route, frequency: freq };
}

export function mapMedication(r: FhirResource): ContextMedication | undefined {
  const cc =
    (r.medicationCodeableConcept as CodeableConcept | undefined) ??
    ((r.medicationReference as { display?: string } | undefined)?.display
      ? { text: (r.medicationReference as { display?: string }).display }
      : undefined);
  const display = ccDisplay(cc);
  if (!display) return undefined;
  const dosage = (r.dosageInstruction as Dosage[] | undefined)?.[0] ?? (r.dosage as Dosage[] | undefined)?.[0];
  return {
    genericName: toGenericName(display),
    display,
    ...dosageParts(dosage),
    status: r.status as string | undefined,
    source: r.resourceType === "MedicationStatement" ? "MedicationStatement" : "MedicationRequest",
  };
}

export function mapAllergy(r: FhirResource): ContextAllergy | undefined {
  const substance = ccDisplay(r.code as CodeableConcept | undefined);
  if (!substance) return undefined;
  const reaction = (r.reaction as Array<{ manifestation?: CodeableConcept[] }> | undefined)?.[0]?.manifestation
    ?.map(ccDisplay)
    .filter(Boolean)
    .join(", ");
  return { substance, reaction: reaction || undefined, criticality: r.criticality as string | undefined };
}

function valueOf(r: FhirResource): string | undefined {
  const q = r.valueQuantity as { value?: number } | undefined;
  if (q?.value != null) return String(q.value); // units stripped (HARD_LOCK)
  if (typeof r.valueString === "string") return r.valueString.replace(/\s*(mg\/dL|mmHg|bpm|%|mmol\/L|g\/dL|K\/uL)\b/gi, "");
  const cc = r.valueCodeableConcept as CodeableConcept | undefined;
  if (cc) return ccDisplay(cc);
  const comps = r.component as Array<{ code?: CodeableConcept; valueQuantity?: { value?: number } }> | undefined;
  if (comps?.length) {
    // e.g. blood pressure: systolic/diastolic
    const vals = comps.map((c) => c.valueQuantity?.value).filter((v) => v != null);
    if (vals.length) return vals.join("/");
  }
  return undefined;
}

function flagOf(r: FhirResource): ContextObservation["flag"] {
  const interp = (r.interpretation as CodeableConcept[] | undefined)?.[0];
  const code = ccPrimary(interp)?.code?.toUpperCase();
  if (code === "H" || code === "L" || code === "HH" || code === "LL") return code;
  return undefined;
}

export function mapObservation(r: FhirResource): ContextObservation | undefined {
  const code = r.code as CodeableConcept | undefined;
  const display = ccDisplay(code);
  const value = valueOf(r);
  if (!display || value == null) return undefined;
  const catCode = ((r.category as CodeableConcept[] | undefined) ?? [])
    .flatMap((c) => c.coding ?? [])
    .map((c) => c.code)
    .find(Boolean);
  const category: ContextObservation["category"] =
    catCode === "vital-signs" ? "vital-signs" : catCode === "laboratory" ? "laboratory" : "other";
  const primary = ccPrimary(code);
  return {
    display,
    system: primary?.system,
    code: primary?.code,
    value,
    effective: (r.effectiveDateTime as string | undefined) ?? (r.issued as string | undefined),
    category,
    flag: flagOf(r),
  };
}

/** Keep the most recent observation per code (vitals/labs panels repeat). */
export function latestPerCode(obs: ContextObservation[]): ContextObservation[] {
  const byKey = new Map<string, ContextObservation>();
  for (const o of obs) {
    const k = o.code ?? o.display;
    const prev = byKey.get(k);
    if (!prev || (o.effective ?? "") > (prev.effective ?? "")) byKey.set(k, o);
  }
  return [...byKey.values()].sort((a, b) => a.display.localeCompare(b.display));
}
