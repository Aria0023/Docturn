/**
 * BAA-covered LLM provider abstraction. The note engine and the fallback
 * knowledge connector share it. Selection (env, overridable per org via
 * connector config):
 *   NOTE_LLM_PROVIDER = anthropic | openai | stub   (default: stub unless a key exists)
 *   NOTE_LLM_API_KEY, NOTE_LLM_MODEL, NOTE_LLM_BASE_URL
 * Only providers under a signed BAA may be configured in production; the
 * admin console shows `baaRequired` for every connector/engine.
 */
export interface LlmRequest {
  system: string;
  user: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<string>;
}

export class StubLlmProvider implements LlmProvider {
  readonly name = "stub-llm";
  async complete(req: LlmRequest): Promise<string> {
    // Deterministic: echoes a minimal structure so callers can parse it.
    if (req.user.includes('"items"') || req.system.toLowerCase().includes("knowledge")) {
      return JSON.stringify({ items: [] });
    }
    return "";
  }
}

export class AnthropicProvider implements LlmProvider {
  readonly name: string;
  constructor(
    private apiKey: string,
    private model = "claude-sonnet-5-5",
    private baseUrl = "https://api.anthropic.com",
  ) {
    this.name = `anthropic:${model}`;
  }
  async complete(req: LlmRequest): Promise<string> {
    const res = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 2000,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      }),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(`anthropic_error ${res.status}`);
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  }
}

/** OpenAI-compatible chat completions (Azure OpenAI with a BAA, etc.). */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly name: string;
  constructor(
    private apiKey: string,
    private model = "gpt-4o",
    private baseUrl = "https://api.openai.com/v1",
  ) {
    this.name = `openai:${model}`;
  }
  async complete(req: LlmRequest): Promise<string> {
    const res = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 2000,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(`openai_error ${res.status}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? "";
  }
}

let _override: LlmProvider | null = null;
/** Tests / plugins can force a provider. */
export function setLlmProvider(p: LlmProvider | null) {
  _override = p;
}

export function getLlmProvider(config: Record<string, unknown> = {}): LlmProvider {
  if (_override) return _override;
  const provider = String(config.provider && config.provider !== "env" ? config.provider : process.env.NOTE_LLM_PROVIDER ?? "");
  const apiKey = String(config.apiKey ?? process.env.NOTE_LLM_API_KEY ?? "");
  const model = config.model && config.model !== "env" ? String(config.model) : process.env.NOTE_LLM_MODEL;
  const baseUrl = config.baseUrl ? String(config.baseUrl) : process.env.NOTE_LLM_BASE_URL;
  if (!apiKey || provider === "stub") return new StubLlmProvider();
  if (provider === "anthropic" || (!provider && apiKey.startsWith("sk-ant-"))) {
    return new AnthropicProvider(apiKey, model || "claude-sonnet-5-5", baseUrl || "https://api.anthropic.com");
  }
  if (provider === "openai" || !provider) {
    return new OpenAICompatibleProvider(apiKey, model || "gpt-4o", baseUrl || "https://api.openai.com/v1");
  }
  return new StubLlmProvider();
}
