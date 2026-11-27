# Patient identity and the EHR admission feed

## Name, date of birth and MRN (module `patients.identity`, on by default)

A patient can carry a name, date of birth and MRN beside their initials. The
ER physician enters them at intake (typing the name fills the initials); a
director can correct them on the Patient board. They appear under the
initials on the Patient board, the hospitalist's requests and census, the
charge nurse's tracker and hand-off notes.

Where they never go: push notifications, text messages, live-update frames,
audit details and server logs. Tests assert this. Reports still show initials
only. With the module off, the server refuses the fields and returns initials
only, including for patients entered earlier.

## Bed ready

Staff (the charge nurse), directors, ER directors and ER physicians can mark a
bed ready for a patient, with the unit. The board and the hospitalist's census
show "Bed ready · unit". It can be undone. Each change is audited.

## EHR admission feed (module `ehr.adtFeed`, off by default)

The hospital's interface engine posts HL7 v2 ADT messages, one per request:

    POST https://<your DocTurn host>/api/ehr/adt
    Authorization: Bearer <token>
    Content-Type: x-application/hl7-v2+er7   (any text type is accepted)

A director generates the token in Settings → Integrations → EHR admission
feed. It is shown once; DocTurn keeps only a hash. Generating a new one
replaces the old one at once.

| Message | What DocTurn does |
| --- | --- |
| A01 admit, A04 register, A05 pre-admit | Adds the patient, waiting for a hospitalist (or updates the one with that MRN) |
| A02 transfer, A06/A07, A08 update | Updates room, unit, name, date of birth, reason |
| A03 discharge, A11 cancel admit | Marks the patient discharged |
| anything else | Acknowledged and ignored |

Fields read: PID-3 (MRN; the identifier typed `MR`, else the first), PID-5
(name), PID-7 (date of birth), PV1-2 (class), PV1-3 (unit^room^bed), PV2-3 or
DG1 (reason). The reply is an HL7 ACK: `AA` applied, `AE` could not be read
(HTTP 400), `AR` not authorized (HTTP 401).

A patient from the feed stays in DocTurn until the EHR discharges them; the
hourly auto-clean leaves them alone. That is what makes Team census the
hospital's census rather than the last 24 hours.

Messages are not stored or logged. DocTurn keeps counts and the time and type
of the last message, shown on the card.

### Not yet verified against a live interface engine

This was built to the HL7 v2 standard and tested with generated messages.
Field positions and the transport (most engines can post over HTTPS; some
expect MLLP, which DocTurn does not speak) vary by hospital and are confirmed
with the interface team during onboarding. The feed does not route an
admission to a hospitalist by itself: the patient arrives waiting, and the ER
physician or a director sends the request.
