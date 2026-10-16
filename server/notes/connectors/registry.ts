import type { OrgConnector } from "@shared/schema";
import { decryptConfigSecrets } from "../secrets.js";
import type { ContextPackage, KnowledgeItem } from "../types.js";
import { BaaLlmConnector } from "./baa-llm.js";
import { GenericHttpSourceConnector } from "./generic-source.js";
import { MetriportAggregator, type ExternalDataAggregator } from "./metriport.js";
import type { ClinicalKnowledgeConnector, ConnectorDescriptor, QueryResult } from "./types.js";
import { selectMinimal } from "./types.js";
import { UpToDateConnector } from "./uptodate.js";

/**
 * Connector registry. To add a source: implement ClinicalKnowledgeConnector
 * and add one line to CONNECTORS. Enablement is per organization (org_connectors).
 */
const CONNECTORS: ClinicalKnowledgeConnector[] = [
  new UpToDateConnector(),
  new BaaLlmConnector(),
  // Future sources — same interface, swappable, optional per org:
  new GenericHttpSourceConnector({
    key: "doximity",
    name: "Doximity (Ask / Scribe handoff)",
    vendor: "Doximity",
    description: "Future: Doximity GPT Ask / Scribe API when offered; configured as a generic HTTP source today.",
  }),
  new GenericHttpSourceConnector({
    key: "openevidence",
    name: "OpenEvidence (enterprise/API)",
    vendor: "OpenEvidence",
    description: "Future: OpenEvidence enterprise or API path; configured as a generic HTTP source today.",
  }),
];

const AGGREGATORS: ExternalDataAggregator[] = [new MetriportAggregator()];

export function listConnectors(): ConnectorDescriptor[] {
  return [
    ...CONNECTORS.map((c) => c.descriptor),
    ...AGGREGATORS.map<ConnectorDescriptor>((a) => ({
      key: a.key,
      name: "Metriport (external records aggregator)",
      vendor: "Metriport",
      kind: "aggregator",
      description: "On-demand cross-system / pharmacy history merged into the context package.",
      configSchema: [
        { key: "baseUrl", label: "API base URL", default: "https://api.metriport.com" },
        { key: "apiKey", label: "API key", secret: true, required: true },
      ],
      requires: ["demographics"],
      baaRequired: true,
    })),
  ];
}

export function getConnector(key: string): ClinicalKnowledgeConnector | undefined {
  return CONNECTORS.find((c) => c.descriptor.key === key);
}
export function getAggregator(key: string): ExternalDataAggregator | undefined {
  return AGGREGATORS.find((a) => a.key === key);
}

/** Register an additional connector at runtime (plugins, tests). */
export function registerConnector(c: ClinicalKnowledgeConnector) {
  const i = CONNECTORS.findIndex((x) => x.descriptor.key === c.descriptor.key);
  if (i >= 0) CONNECTORS[i] = c;
  else CONNECTORS.push(c);
}

export interface EnrichmentReport {
  ran: string[];
  skipped: string[];
  errors: Array<{ connector: string; error: string }>;
}

/**
 * Run every enabled knowledge connector for the org (by priority) and merge
 * results into package.knowledge. Failures are isolated: one bad source never
 * blocks note generation.
 */
export async function runEnabledConnectors(
  orgId: number,
  enabled: OrgConnector[],
  pkg: ContextPackage,
  visitSummary?: string,
  timeoutMs = 8000,
): Promise<{ pkg: ContextPackage; report: EnrichmentReport }> {
  const report: EnrichmentReport = { ran: [], skipped: [], errors: [] };
  const items: KnowledgeItem[] = [];
  const sources: string[] = [];
  for (const row of enabled.filter((r) => r.enabled && r.kind === "knowledge").sort((a, b) => a.priority - b.priority)) {
    const c = getConnector(row.connectorKey);
    if (!c?.enrichContext) {
      report.skipped.push(row.connectorKey);
      continue;
    }
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const minimal = selectMinimal(pkg, c.descriptor.requires, visitSummary);
      const got = await c.enrichContext(minimal, { config: decryptConfigSecrets(row.config), orgId, signal: ac.signal });
      items.push(...got);
      report.ran.push(row.connectorKey);
      sources.push(`knowledge:${row.connectorKey}`);
    } catch (err) {
      report.errors.push({ connector: row.connectorKey, error: (err as Error).message });
    } finally {
      clearTimeout(t);
    }
  }
  return {
    pkg: {
      ...pkg,
      knowledge: [...pkg.knowledge, ...items],
      provenance: { ...pkg.provenance, sources: [...pkg.provenance.sources, ...sources] },
    },
    report,
  };
}

/** Ad-hoc question against the first enabled connector that supports query(). */
export async function queryFirstEnabled(
  orgId: number,
  enabled: OrgConnector[],
  question: string,
  pkg: ContextPackage,
): Promise<QueryResult | undefined> {
  for (const row of enabled.filter((r) => r.enabled && r.kind === "knowledge").sort((a, b) => a.priority - b.priority)) {
    const c = getConnector(row.connectorKey);
    if (!c?.query) continue;
    return c.query(question, selectMinimal(pkg, c.descriptor.requires), { config: decryptConfigSecrets(row.config), orgId });
  }
  return undefined;
}
