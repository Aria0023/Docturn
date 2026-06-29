import { RISK_LEVEL } from '../../shared/schema.js';

export interface ExtractedPatient {
  initials: string;
  room: string | null;
  chiefComplaint: string | null;
  diagnosis: string | null;
  riskLevel: (typeof RISK_LEVEL)[number];
  structured: Record<string, unknown>;
}

/**
 * Deterministic mock AI extractor. Replace with OpenAI call later.
 * Given free-text intake notes, returns structured fields deterministically
 * so tests and the demo are reproducible.
 */
export class MockAIExtractor {
  extract(text: string, hints?: { initials?: string; room?: string }): ExtractedPatient {
    const lower = text.toLowerCase();

    // Deterministic risk scoring from keywords.
    const highKeywords = ['chest pain', 'stroke', 'sepsis', 'respiratory distress', 'cardiac', 'shortness of breath'];
    const mediumKeywords = ['abdominal pain', 'fracture', 'fever', 'dehydration', 'infection'];
    let riskLevel: ExtractedPatient['riskLevel'] = 'low';
    if (highKeywords.some((k) => lower.includes(k))) riskLevel = 'high';
    else if (mediumKeywords.some((k) => lower.includes(k))) riskLevel = 'medium';

    // Chief complaint: first sentence, trimmed.
    const firstSentence = text.split(/[.\n]/)[0]?.trim() || null;

    // Room: from hint or "room NNN" pattern.
    const roomMatch = text.match(/room\s+(\w+)/i);
    const room = hints?.room ?? (roomMatch ? roomMatch[1] : null);

    // Initials: from hint or "Patient AB" pattern, else derive deterministically.
    let initials = hints?.initials ?? null;
    if (!initials) {
      const initialsMatch = text.match(/\b([A-Z])\.?\s*([A-Z])\.?\b/);
      if (initialsMatch) initials = `${initialsMatch[1]}${initialsMatch[2]}`;
    }
    if (!initials) {
      // Deterministic fallback from a simple hash of the text.
      let h = 0;
      for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
      const a = String.fromCharCode(65 + (h % 26));
      const b = String.fromCharCode(65 + ((h >> 8) % 26));
      initials = `${a}${b}`;
    }

    return {
      initials,
      room,
      chiefComplaint: firstSentence,
      diagnosis: null,
      riskLevel,
      structured: {
        source: 'mock_ai',
        keywords: [...highKeywords, ...mediumKeywords].filter((k) => lower.includes(k)),
        rawLength: text.length,
      },
    };
  }
}

export const aiExtractor = new MockAIExtractor();
