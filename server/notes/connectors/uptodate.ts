import type { KnowledgeItem } from "../types.js";
import type {
  ClinicalKnowledgeConnector,
  ConnectorContext,
  ConnectorDescriptor,
  MinimalContext,
  QueryResult,
} from "./types.js";

/**
 * UpToDate connector (Expert AI API / UpToDate Connect). Preferred source for
 * drug monographs and graded evidence.
 *
 * Live mode: when `config.apiKey` is set it calls the configured `baseUrl`.
 * The exact request shape depends on the contract Wolters Kluwer grants the
 * customer, so `callLive` is isolated and small. Without a key the connector
 * runs in STUB mode and returns deterministic placeholder monographs so the
 * end-to-end flow (and tests) run with zero secrets.
 */
export class UpToDateConnector implements ClinicalKnowledgeConnector {
  readonly descriptor: ConnectorDescriptor = {
    key: "uptodate",
    name: "UpToDate Expert AI / Connect",
    vendor: "Wolters Kluwer",
    kind: "knowledge",
    description: "Drug monographs, interactions and graded evidence for the active problem list.",
    configSchema: [
      { key: "baseUrl", label: "API base URL", default: "https://api.uptodate.com" },
      { key: "apiKey", label: "API key", secret: true, required: true },
      { key: "maxItems", label: "Max items per note", default: 6 },
    ],
    requires: ["problems", "medications"],
    baaRequired: false,
  };

  async enrichContext(minimal: MinimalContext, ctx: ConnectorContext): Promise<KnowledgeItem[]> {
    const max = Number(ctx.config.maxItems ?? 6);
    if (ctx.config.apiKey) return (await this.callLive(minimal, ctx)).slice(0, max);
    return this.stub(minimal).slice(0, max);
  }

  async query(question: string, minimal: MinimalContext, ctx: ConnectorContext): Promise<QueryResult> {
    if (ctx.config.apiKey) {
      const items = await this.callLive({ ...minimal, visitSummary: question }, ctx);
      return { connector: this.descriptor.key, answer: items.map((i) => i.content).join("\n"), items };
    }
    return {
      connector: this.descriptor.key,
      answer: `[stub] UpToDate would answer: "${question}" using ${minimal.problems?.length ?? 0} problems and ${minimal.medications?.length ?? 0} medications.`,
      citations: ["UpToDate (stub)"],
    };
  }

  async healthcheck(ctx: ConnectorContext) {
    return { ok: true, detail: ctx.config.apiKey ? "live (key present)" : "stub mode" };
  }

  private async callLive(minimal: MinimalContext, ctx: ConnectorContext): Promise<KnowledgeItem[]> {
    const base = String(ctx.config.baseUrl ?? "https://api.uptodate.com").replace(/\/+$/, "");
    const res = await fetch(`${base}/v1/expert-ai/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.config.apiKey}` },
      body: JSON.stringify({ problems: minimal.problems, medications: minimal.medications, question: minimal.visitSummary }),
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`uptodate_error ${res.status}`);
    const data = (await res.json()) as { items?: Array<{ title: string; content: string; citations?: string[]; kind?: string }> };
    return (data.items ?? []).map((i) => ({
      connector: this.descriptor.key,
      kind: (i.kind as KnowledgeItem["kind"]) ?? "evidence",
      title: i.title,
      content: i.content,
      citations: i.citations,
    }));
  }

  private stub(minimal: MinimalContext): KnowledgeItem[] {
    const items: KnowledgeItem[] = [];
    for (const med of minimal.medications ?? []) {
      items.push({
        connector: this.descriptor.key,
        kind: "drug-monograph",
        title: `${med} — monograph (stub)`,
        content: `Key monitoring and renal/hepatic dosing considerations for ${med} would appear here from UpToDate.`,
        citations: ["UpToDate Lexidrug (stub)"],
        relatesTo: [med],
      });
    }
    for (const p of (minimal.problems ?? []).slice(0, 3)) {
      items.push({
        connector: this.descriptor.key,
        kind: "evidence",
        title: `${p} — inpatient management summary (stub)`,
        content: `Graded recommendations for the inpatient management of ${p} would appear here from UpToDate.`,
        citations: ["UpToDate (stub)"],
        relatesTo: [p],
      });
    }
    return items;
  }
}
