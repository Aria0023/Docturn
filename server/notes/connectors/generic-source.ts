import type { KnowledgeItem } from "../types.js";
import type {
  ClinicalKnowledgeConnector,
  ConnectorContext,
  ConnectorDescriptor,
  MinimalContext,
  QueryResult,
} from "./types.js";

/**
 * TEMPLATE for a future source (Doximity Ask/Scribe, OpenEvidence, a drug
 * database, a guideline API...). Copy this file, change the descriptor and
 * the two HTTP calls, and register it in registry.ts. Nothing else changes.
 *
 * It is shipped as a working "generic HTTP JSON source": point `baseUrl` at
 * any endpoint that accepts {question, context} and returns {answer,
 * citations[]} — enough for an enterprise OpenEvidence/Doximity path when
 * one is offered, or an internal guideline service today.
 */
export class GenericHttpSourceConnector implements ClinicalKnowledgeConnector {
  readonly descriptor: ConnectorDescriptor;

  constructor(opts: { key: string; name: string; vendor: string; description: string }) {
    this.descriptor = {
      key: opts.key,
      name: opts.name,
      vendor: opts.vendor,
      kind: "knowledge",
      description: opts.description,
      configSchema: [
        { key: "baseUrl", label: "Endpoint URL", required: true },
        { key: "apiKey", label: "API key", secret: true },
        { key: "question", label: "Standing enrichment question", default: "What should the admitting clinician consider for these problems and medications?" },
      ],
      requires: ["problems", "medications"],
      baaRequired: true,
    };
  }

  async enrichContext(minimal: MinimalContext, ctx: ConnectorContext): Promise<KnowledgeItem[]> {
    const q = String(ctx.config.question ?? "");
    if (!ctx.config.baseUrl) return this.stub(q, minimal);
    const r = await this.query(q, minimal, ctx);
    return r.items ?? [{ connector: this.descriptor.key, kind: "evidence", title: this.descriptor.name, content: r.answer, citations: r.citations }];
  }

  async query(question: string, minimal: MinimalContext, ctx: ConnectorContext): Promise<QueryResult> {
    if (!ctx.config.baseUrl) {
      return { connector: this.descriptor.key, answer: `[stub] ${this.descriptor.name} is not configured.`, citations: [] };
    }
    const res = await fetch(String(ctx.config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ctx.config.apiKey ? { Authorization: `Bearer ${ctx.config.apiKey}` } : {}),
      },
      body: JSON.stringify({ question, context: minimal }),
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`${this.descriptor.key}_error ${res.status}`);
    const data = (await res.json()) as { answer?: string; citations?: string[] };
    return { connector: this.descriptor.key, answer: data.answer ?? "", citations: data.citations ?? [] };
  }

  private stub(q: string, minimal: MinimalContext): KnowledgeItem[] {
    return [
      {
        connector: this.descriptor.key,
        kind: "evidence",
        title: `${this.descriptor.name} (stub)`,
        content: `[stub] Would ask "${q}" about ${(minimal.problems ?? []).slice(0, 3).join(", ") || "no problems"}.`,
        citations: [`${this.descriptor.vendor} (stub)`],
      },
    ];
  }
}
