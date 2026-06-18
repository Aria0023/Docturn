/**
 * AI patient-intake extraction. Like every external integration it sits behind
 * an interface with a deterministic local stub (default, no secrets); a live
 * OpenAI implementation is selected by env in M10.
 */
export interface ExtractedPatient {
  initials: string;
  roomNumber: string;
  issueSummary: string;
  specialty: string;
}

export interface AIExtractor {
  extract(note: string): Promise<ExtractedPatient>;
}

const SPECIALTY_KEYWORDS: Array<[RegExp, string]> = [
  [/chest pain|cardiac|heart|arrhythmia|mi\b|stemi/i, "Cardiology"],
  [/stroke|seizure|neuro|headache|migraine/i, "Neurology"],
  [/fracture|ortho|joint|knee|hip|bone/i, "Orthopedics"],
  [/abdom|gi\b|nausea|vomit|appendic/i, "Gastroenterology"],
  [/breath|copd|asthma|pneumonia|respir|lung/i, "Pulmonology"],
  [/kidney|renal|urin/i, "Nephrology"],
];

/**
 * Deterministic extractor: pulls initials, a room number, a one-line summary,
 * and a best-guess specialty from a free-text note. Same input → same output,
 * so tests can assert exact fields.
 */
export class MockAIExtractor implements AIExtractor {
  async extract(note: string): Promise<ExtractedPatient> {
    const text = note.trim();

    const room =
      text.match(/\broom\s*#?\s*([0-9]{1,4}[A-Za-z]?)/i)?.[1] ??
      text.match(/\b([0-9]{2,4}[A-Za-z]?)\b/)?.[1] ??
      "";

    let initials =
      text.match(/\b([A-Z])\.\s*([A-Z])\.?/)?.slice(1, 3).join("") ?? "";
    if (!initials) {
      const nameMatch = text.match(
        /\b(?:patient|pt|mr|mrs|ms|dr)\.?\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/,
      );
      if (nameMatch) {
        initials = `${nameMatch[1]![0]}${nameMatch[2]![0]}`;
      }
    }
    if (!initials) {
      const caps = text.match(/\b[A-Z][a-z]+\b/g) ?? [];
      initials = caps
        .slice(0, 2)
        .map((w) => w[0])
        .join("");
    }
    initials = (initials || "XX").toUpperCase().slice(0, 4);

    let specialty = "General";
    for (const [re, spec] of SPECIALTY_KEYWORDS) {
      if (re.test(text)) {
        specialty = spec;
        break;
      }
    }

    // Summary = first line, or first sentence break that isn't an initial's
    // period (e.g. don't cut "J.D." in half). Capped to keep it one-line.
    const firstLine = text.split(/\n/)[0]?.trim() ?? text;
    const sentenceEnd = firstLine.search(/[.!?](?:\s|$)/);
    const issueSummary = (
      sentenceEnd > 20 ? firstLine.slice(0, sentenceEnd) : firstLine
    ).slice(0, 160);

    return { initials, roomNumber: room, issueSummary, specialty };
  }
}

/**
 * Live extractor (gpt-4o). PHI is truncated in the prompt; on any failure it
 * falls back to the deterministic mock so intake never blocks.
 */
export class OpenAIExtractor implements AIExtractor {
  private fallback = new MockAIExtractor();
  async extract(note: string): Promise<ExtractedPatient> {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Extract {initials, roomNumber, issueSummary, specialty} as JSON from an ER intake note. Use initials only — never full names.",
            },
            { role: "user", content: note.slice(0, 1000) },
          ],
        }),
      });
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
      return {
        initials: String(parsed.initials ?? "XX").toUpperCase().slice(0, 4),
        roomNumber: String(parsed.roomNumber ?? ""),
        issueSummary: String(parsed.issueSummary ?? note.slice(0, 80)),
        specialty: String(parsed.specialty ?? "General"),
      };
    } catch (err) {
      console.error("[ai] extraction failed; falling back to mock", err);
      return this.fallback.extract(note);
    }
  }
}

let _extractor: AIExtractor | null = null;
export function getExtractor(): AIExtractor {
  if (_extractor) return _extractor;
  // Live only when a key is present AND the stub isn't forced (CI sets nothing).
  if (process.env.OPENAI_API_KEY && process.env.USE_STUB_AI !== "true") {
    _extractor = new OpenAIExtractor();
  } else {
    _extractor = new MockAIExtractor();
  }
  return _extractor;
}
export function setExtractor(e: AIExtractor) {
  _extractor = e;
}
