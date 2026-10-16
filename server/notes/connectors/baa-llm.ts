import { getLlmProvider } from "../generation/llm.js";
import type { KnowledgeItem } from "../types.js";
import type {
  ClinicalKnowledgeConnector,
  ConnectorContext,
  ConnectorDescriptor,
  MinimalContext,
  QueryResult,
} from "./types.js";

/**
 * BAA-covered LLM fallback connector. Used when a specialist source (UpToDate)
 * is not enabled or returns nothing. Sends only the minimal projection, asks
 * for structured items, and never sees identifiers. The provider is the same
 * env-configured one the note engine can use (see generation/llm.ts); without
 * credentials it is a deterministic stub.
 */
export class BaaLlmConnector implements ClinicalKnowledgeConnector {
  readonly descriptor: ConnectorDescriptor = {
    key: "baa-llm",
    name: "BAA-covered LLM (fallback)",
    vendor: "configurable (Anthropic / Azure OpenAI / other BAA provider)",
    kind: "knowledge",
    description: "General clinical-knowledge fallback using a HIPAA-BAA LLM endpoint; minimum-necessary context only.",
    configSchema: [
      { key: "provider", label: "Provider (anthropic|openai|stub)", default: "env" },
      { key: "model", label: "Model", default: "env" },
      { key: "apiKey", label: "API key (overrides env)", secret: true },
      { key: "baseUrl", label: "Base URL (overrides env)" },
    ],
    requires: ["demographics", "problems", "medications", "allergies", "labs"],
    baaRequired: true,
  };

  async enrichContext(minimal: MinimalContext, ctx: ConnectorContext): Promise<KnowledgeItem[]> {
    const llm = getLlmProvider(ctx.config);
    const prompt =
      `Given this de-identified inpatient context, list up to 4 clinically important considerations ` +
      `(drug interactions, monitoring, guideline-directed therapy gaps). Respond as JSON: ` +
      `{"items":[{"title":"...","content":"...","kind":"interaction|evidence|guideline"}]}.\n` +
      JSON.stringify(minimal);
    const raw = await llm.complete({
      system: "You are a clinical knowledge assistant. Be concise, cite guideline names, and never invent patient facts.",
      user: prompt,
      maxTokens: 800,
      signal: ctx.signal,
    });
    try {
      const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as {
        items?: Array<{ title: string; content: string; kind?: string }>;
      };
      return (parsed.items ?? []).map((i) => ({
        connector: this.descriptor.key,
        kind: (i.kind as KnowledgeItem["kind"]) ?? "other",
        title: i.title,
        content: i.content,
        citations: [llm.name],
      }));
    } catch {
      return [];
    }
  }

  async query(question: string, minimal: MinimalContext, ctx: ConnectorContext): Promise<QueryResult> {
    const llm = getLlmProvider(ctx.config);
    const answer = await llm.complete({
      system: "You are a clinical knowledge assistant answering a clinician. Be brief and cite sources by name.",
      user: `Context: ${JSON.stringify(minimal)}\nQuestion: ${question}`,
      maxTokens: 600,
      signal: ctx.signal,
    });
    return { connector: this.descriptor.key, answer, citations: [llm.name] };
  }

  async healthcheck(ctx: ConnectorContext) {
    const llm = getLlmProvider(ctx.config);
    return { ok: true, detail: llm.name };
  }
}
