# FHIR resource mapping and DocumentReference write-back

Only **standard FHIR R4** resources are read or written; no vendor extensions. Mapping code:
`server/notes/fhir/mapping.ts`; orchestration: `server/notes/context/assembler.ts`.

## Reads → `ContextPackage`

| FHIR query | Context field | Transform |
|---|---|---|
| `GET Patient/{id}` | `patient.age`, `patient.sex` | age computed from `birthDate`; name, identifiers, DOB are **not** carried (minimum necessary). |
| `GET Encounter/{id}` | `encounter.{class,start,status,reasonDisplay}` | `period.start` drives POA. |
| `GET Condition?patient=&clinical-status=active` | `problems[]` | display + coding; `poa` = `Y` if onset/recorded ≤ encounter start, `N` if after, `U` unknown. |
| `GET MedicationRequest?patient=&status=active` and `MedicationStatement?...` | `medications[]` | `genericName` (brand map, strength/form stripped; RxNorm ingredient resolution via a connector in production), dose **without unit**, route, frequency. |
| `GET AllergyIntolerance?patient=` | `allergies[]` | substance, first manifestation, criticality. |
| `GET Observation?patient=&category=vital-signs&_sort=-date` | `vitals[]` | latest per code; numeric value **unit-free**; BP from components as `sys/dia`. |
| `GET Observation?patient=&category=laboratory&_sort=-date` | `labs[]` | latest per code; `flag` from `interpretation` (H/L/HH/LL). |
| `GET DocumentReference?patient=&_sort=-date&_count=5` | `priorNotes[]` | inline `attachment.data` (text/*) or `Binary` fetched, then **extractive summary** (prefers Assessment/Plan; ≤480 chars). Raw text is dropped. |

Pagination follows `Bundle.link[next]` (≤5 pages). A `401/403/404` on a search is treated as
"scope not granted / no data" and recorded in `provenance.warnings`, so a missing scope never
blocks the note.

### `ContextPackage` shape (`server/notes/types.ts`)

```ts
{
  schemaVersion: 1,
  patient: { reference: "Patient/123", age?: number, sex?: string },
  encounter?: { reference, class?, start?, reasonDisplay?, status? },
  problems: [{ display, system?, code?, clinicalStatus?, onset?, poa?: "Y"|"N"|"U" }],
  medications: [{ genericName, display, dose?, route?, frequency?, status?, source }],
  allergies: [{ substance, reaction?, criticality? }],
  vitals: [{ display, code?, value /* unit-free */, effective?, category, flag? }],
  labs:   [ ...same ],
  priorNotes: [{ date?, type?, author?, summary }],
  knowledge: [{ connector, kind, title, content, citations?, relatesTo? }],
  provenance: { sources: ["ehr:fhir", "aggregator:metriport", "knowledge:uptodate"], assembledAt, warnings[] }
}
```

The package is the **only** thing the note-generation module and the connectors ever see.

## Write-back → `DocumentReference`

`server/notes/export/documentreference.ts` builds:

```jsonc
{
  "resourceType": "DocumentReference",
  "status": "current",
  "docStatus": "preliminary",                 // clinician signs in the EHR
  "type": { "coding": [{ "system": "http://loinc.org", "code": "34117-5", "display": "History and physical note" }] },
  "category": [{ "coding": [{ "system": "http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category", "code": "clinical-note" }] }],
  "subject": { "reference": "Patient/123" },
  "date": "2026-10-16T04:12:00Z",
  "author": [{ "reference": "Practitioner/dr-chen" }],         // from fhirUser
  "content": [{ "attachment": { "contentType": "text/plain", "data": "<base64 CRLF text>", "title": "History and physical note", "creation": "..." } }],
  "context": { "encounter": [{ "reference": "Encounter/456" }], "period": { "start": "..." } }
}
```

`POST {iss}/DocumentReference` with the session token. The LOINC code comes from the active
template module (`loincCode`), so a progress-note template writes `11506-3` without code
changes. Vendor-specific note types (e.g. Epic note-type codes) are passed as
`typeOverride`/`categoryOverride` from connection config when a customer requires them.

Text is CRLF, plain, with escaped-dash lists, so the same bytes paste cleanly into Word and
Epic's note editor (clipboard path) or render verbatim from the attachment (write-back path).

## External aggregator (optional, on-demand)

`includeExternal: true` on `POST /api/notes/context` runs the enabled aggregator
(`connectors/metriport.ts`): `GET /medical/v1/patient/{id}/consolidated?resources=...`,
mapped by the same functions, merged with de-duplication, and tagged `source: "external"`.
It is never run implicitly.
