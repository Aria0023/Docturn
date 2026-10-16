# Standard connector interface

`server/notes/connectors/types.ts`. A connector is a class with a descriptor and one or both of
`enrichContext` and `query`. The core depends only on this interface.

```ts
interface ClinicalKnowledgeConnector {
  readonly descriptor: {
    key: string;                      // "uptodate"
    name: string; vendor: string;
    kind: "knowledge" | "aggregator" | "engine";
    description: string;
    configSchema: Array<{ key; label; secret?; required?; default? }>;   // what the admin UI collects
    requires: Array<"problems"|"medications"|"allergies"|"labs"|"vitals"|"demographics"|"visit">;
    baaRequired: boolean;
  };
  enrichContext?(minimal: MinimalContext, ctx: ConnectorContext): Promise<KnowledgeItem[]>;
  query?(question: string, minimal: MinimalContext, ctx: ConnectorContext): Promise<QueryResult>;
  healthcheck?(ctx: ConnectorContext): Promise<{ ok: boolean; detail?: string }>;
}
```

* **Minimum necessary:** the registry builds `MinimalContext` with `selectMinimal(pkg,
  descriptor.requires)` — a connector that declares `["problems","medications"]` receives
  problem displays and generic drug names, nothing else. No identifiers ever.
* **Isolation:** each connector runs with its own timeout (8 s) and try/catch; a failing source is
  reported in `knowledge.errors` and never blocks generation.
* **Order:** `org_connectors.priority` ascending; results append to `package.knowledge` and
  `provenance.sources` gets `knowledge:<key>`.
* **Secrets:** keys named `apiKey`, `clientSecret`, `token`, `password` in `config` are
  AES-256-GCM encrypted at rest and masked on read.

## Shipped connectors

| key | file | Mode without a key | Live mode |
|---|---|---|---|
| `uptodate` | `uptodate.ts` | deterministic stub monographs / evidence summaries | `POST {baseUrl}/v1/expert-ai/enrich` with Bearer key (shape isolated in `callLive` for contract-specific adjustment) |
| `baa-llm` | `baa-llm.ts` | stub (no items) | BAA provider from `generation/llm.ts`; asks for structured JSON items |
| `doximity` | `generic-source.ts` | stub | generic `POST {baseUrl} {question, context}` → `{answer, citations}` when Doximity offers an API/handoff |
| `openevidence` | `generic-source.ts` | stub | same generic HTTP contract (enterprise/API path) |
| `metriport` (aggregator) | `metriport.ts` | stub (empty merge) | consolidated FHIR bundle → merged into the package, on demand only |

## Adding a new source (e.g. a drug database)

1. Copy `generic-source.ts` (or implement the interface directly) → `connectors/drugdb.ts`.
2. Add `new DrugDbConnector()` to `CONNECTORS` in `registry.ts` (or call `registerConnector()`
   at boot from a plugin package).
3. Done. It appears in `GET /api/notes/connectors` → `catalog`; an org admin enables it with
   `PUT /api/notes/connectors/drugdb`. No change to the assembler, engine, routes, UI, or schema.

## Ad-hoc questions

`POST /api/notes/ask { question, context }` routes to the first enabled connector implementing
`query()` — the "ask UpToDate / ask OpenEvidence" box in the UI.
