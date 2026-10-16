import { FhirClient } from "../fhir/client.js";
import type { TemplateModule } from "../generation/template.js";

/**
 * DocumentReference write-back (FHIR R4). The note travels as a base64
 * text/plain attachment; `context.encounter` links it to the visit. Works on
 * any SMART-enabled EHR that grants `patient/DocumentReference.write` (Epic,
 * Oracle Health, athenahealth, MEDITECH all accept this shape; some require a
 * vendor-specific `type`/`category` set, which is per-connection config).
 */
export function buildDocumentReference(input: {
  noteText: string;
  patientId: string;
  encounterId?: string;
  practitionerRef?: string; // e.g. Practitioner/123 (from fhirUser)
  template: TemplateModule;
  now?: Date;
  /** Optional vendor overrides (e.g. Epic note type codes) from connection config. */
  typeOverride?: { system: string; code: string; display?: string };
  categoryOverride?: { system: string; code: string; display?: string };
}) {
  const now = input.now ?? new Date();
  const type = input.typeOverride ?? { system: "http://loinc.org", code: input.template.loincCode, display: input.template.loincDisplay };
  const category = input.categoryOverride ?? {
    system: "http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category",
    code: "clinical-note",
    display: "Clinical Note",
  };
  return {
    resourceType: "DocumentReference" as const,
    status: "current",
    docStatus: "preliminary", // the clinician signs in the EHR
    type: { coding: [type], text: type.display },
    category: [{ coding: [category] }],
    subject: { reference: `Patient/${input.patientId}` },
    date: now.toISOString(),
    ...(input.practitionerRef ? { author: [{ reference: input.practitionerRef }] } : {}),
    content: [
      {
        attachment: {
          contentType: "text/plain",
          data: Buffer.from(input.noteText.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n"), "utf8").toString("base64"),
          title: input.template.loincDisplay,
          creation: now.toISOString(),
        },
      },
    ],
    ...(input.encounterId
      ? { context: { encounter: [{ reference: `Encounter/${input.encounterId}` }], period: { start: now.toISOString() } } }
      : {}),
  };
}

export async function writeBackDocumentReference(
  client: FhirClient,
  doc: ReturnType<typeof buildDocumentReference>,
): Promise<{ id?: string; location?: string }> {
  const res = await client.create(doc);
  return { id: res.id, location: res.location };
}
