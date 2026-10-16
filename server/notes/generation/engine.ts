import type { ContextPackage, NoteResult, VisitInput } from "../types.js";
import { applyHardLocks } from "./hardlocks.js";
import { getLlmProvider, StubLlmProvider } from "./llm.js";
import type { TemplateModule } from "./template.js";

/**
 * NOTE-GENERATION MODULE INTERFACE
 * --------------------------------
 *   generate({ template, context, visit }) → NoteResult
 *
 * The engine receives a template module + structured context + visit input
 * and returns ONLY the finished note. It has no access to storage, the EHR,
 * or any connector. Two engines implement the same interface:
 *   - DeterministicEngine: template-driven renderer (no external calls; the
 *     zero-secrets default and the fallback when the LLM fails).
 *   - LlmEngine: BAA-covered LLM fed the template `instructions` verbatim.
 * Both outputs pass through the HARD_LOCK post-processors.
 */
export interface GenerateInput {
  template: TemplateModule;
  context: ContextPackage;
  visit: VisitInput;
}

export interface NoteEngine {
  readonly name: string;
  render(input: GenerateInput): Promise<string>;
}

const BL = (items: string[], blank: string) => (items.length ? items.map((i) => `\\- ${i}`).join("\n") : blank);

export class DeterministicEngine implements NoteEngine {
  readonly name = "deterministic-v1";

  async render({ template, context: c, visit: v }: GenerateInput): Promise<string> {
    const blank = template.phrases.blank;
    const parts: string[] = [];
    for (const s of template.sections) {
      let body = blank;
      switch (s.key) {
        case "cc":
          body = v.chiefComplaint ?? c.encounter?.reasonDisplay ?? blank;
          break;
        case "hpi": {
          const demo = [c.patient.age != null ? `${c.patient.age}-year-old` : "", c.patient.sex ?? ""].filter(Boolean).join(" ");
          const prior = c.priorNotes.length
            ? `Per prior documentation: ${c.priorNotes.map((n) => n.summary).join(" ").slice(0, 600)}`
            : "";
          const hpi = v.hpi ?? v.freeText ?? "";
          body = [demo ? `${demo} patient presenting with ${v.chiefComplaint ?? c.encounter?.reasonDisplay ?? "***"}.` : "", hpi, prior]
            .filter(Boolean)
            .join(" ")
            .trim() || blank;
          break;
        }
        case "pmh":
          body = BL(c.problems.map((p) => p.display), blank);
          break;
        case "meds":
          body = BL(
            c.medications.map((m) => [m.genericName, m.dose, m.route?.toLowerCase(), m.frequency?.toLowerCase()].filter(Boolean).join(" ")),
            "No home medications documented",
          );
          break;
        case "allergies":
          body = c.allergies.length
            ? BL(c.allergies.map((a) => `${a.substance}${a.reaction ? ` (${a.reaction})` : ""}`), blank)
            : "No known drug allergies";
          break;
        case "ros":
          body = v.ros ?? blank;
          break;
        case "exam": {
          const vit = c.vitals.map((o) => `${abbrevVital(o.display)} ${o.value}`).join(", ");
          body = [vit ? `Vitals: ${vit}` : "", v.exam ?? ""].filter(Boolean).join("\n") || blank;
          break;
        }
        case "data":
          body = c.labs.length ? c.labs.map((l) => `${l.display} ${l.value}${l.flag ? ` (${l.flag})` : ""}`).join(", ") : blank;
          break;
        case "ap":
          body = this.renderAp(c, v, blank);
          break;
        case "dispo": {
          const lines = [
            v.admissionStatus === "inpatient" ? "Admit inpatient, medicine floor." : v.admissionStatus === "observation" ? "Observation status." : "Level of care: ***",
            "Code status: ***",
            `DVT prophylaxis: ***`,
            `GI prophylaxis: ***`,
          ];
          body = lines.join("\n");
          break;
        }
        default:
          body = blank;
      }
      parts.push(`${s.title}:\n${body}`);
    }
    return parts.join("\n\n");
  }

  private renderAp(c: ContextPackage, v: VisitInput, blank: string): string {
    const lines: string[] = [];
    const planText = v.plan ?? "";
    const assessText = v.assessment ?? "";
    const primary = v.chiefComplaint ?? c.encounter?.reasonDisplay;
    const problems = [...c.problems];
    // Reason for admission first when it isn't already a problem.
    if (primary && !problems.some((p) => p.display.toLowerCase() === primary.toLowerCase())) {
      problems.unshift({ display: primary, poa: "Y" });
    }
    if (!problems.length) return assessText || planText ? `${assessText}\n\\- ${planText || blank}` : blank;
    problems.forEach((p, i) => {
      const tag = p.poa === "Y" ? "(POA)" : p.poa === "N" ? "(not POA)" : "(POA unknown)";
      const reasoning = i === 0 && assessText ? ` - ${assessText}` : "";
      lines.push(`${p.display}${reasoning} ${tag}`);
      const kn = c.knowledge.filter((k) => k.relatesTo?.some((r) => r.toLowerCase() === p.display.toLowerCase()));
      if (i === 0 && planText) {
        for (const pl of planText.split(/\n|;/).map((x) => x.trim()).filter(Boolean)) lines.push(`\\- ${pl}`);
      } else {
        lines.push(`\\- Continue home regimen; monitor. ${blank}`);
      }
      for (const k of kn.slice(0, 1)) lines.push(`\\- ${k.title.replace(/ \(stub\)/, "")} reviewed (${k.connector}).`);
    });
    return lines.join("\n");
  }
}

function abbrevVital(display: string): string {
  const d = display.toLowerCase();
  if (d.includes("blood pressure")) return "BP";
  if (d.includes("heart rate") || d.includes("pulse")) return "HR";
  if (d.includes("respiratory")) return "RR";
  if (d.includes("temp")) return "T";
  if (d.includes("oxygen") || d.includes("spo2") || d.includes("saturation")) return "SpO2";
  if (d.includes("weight")) return "Wt";
  if (d.includes("height")) return "Ht";
  return display;
}

export class LlmEngine implements NoteEngine {
  readonly name: string;
  private fallback = new DeterministicEngine();
  constructor(private config: Record<string, unknown> = {}) {
    this.name = `llm:${getLlmProvider(config).name}`;
  }
  async render(input: GenerateInput): Promise<string> {
    const llm = getLlmProvider(this.config);
    if (llm instanceof StubLlmProvider) return this.fallback.render(input);
    const { template, context, visit } = input;
    const sectionSpec = template.sections.map((s) => `${s.title}: ${s.guidance ?? ""}`).join("\n");
    const out = await llm.complete({
      system: `${template.instructions}\n\nSECTION ORDER (exact headers, each on its own line followed by a colon):\n${sectionSpec}`,
      user: `CONTEXT PACKAGE (JSON):\n${JSON.stringify(context)}\n\nTODAY'S VISIT INPUT (JSON):\n${JSON.stringify(visit)}\n\nReturn the complete note as plain text.`,
      maxTokens: 3000,
    });
    return out.trim() ? out : this.fallback.render(input);
  }
}

/** Resolve the engine for a template (org config may override later). */
export function selectEngine(template: TemplateModule, config: Record<string, unknown> = {}): NoteEngine {
  if (template.engine === "deterministic") return new DeterministicEngine();
  if (template.engine === "llm") return new LlmEngine(config);
  const llm = getLlmProvider(config);
  return llm instanceof StubLlmProvider ? new DeterministicEngine() : new LlmEngine(config);
}

/**
 * THE module entry point: template + structured context (+ visit) → note.
 * Pure with respect to storage; safe to call from anywhere.
 */
export async function generateNote(
  input: GenerateInput & { templateVersionId: number; templateName: string; templateVersion: number; engineConfig?: Record<string, unknown> },
): Promise<NoteResult> {
  const engine = selectEngine(input.template, input.engineConfig);
  let raw: string;
  let engineName = engine.name;
  try {
    raw = await engine.render(input);
  } catch (err) {
    const fb = new DeterministicEngine();
    raw = await fb.render(input);
    engineName = `${fb.name} (fallback: ${(err as Error).message})`;
  }
  const locked = applyHardLocks(raw, input.template, input.context, input.visit);
  return {
    text: locked.text,
    sections: locked.sections,
    warnings: locked.warnings,
    templateVersionId: input.templateVersionId,
    templateName: input.templateName,
    templateVersion: input.templateVersion,
    engine: engineName,
  };
}
