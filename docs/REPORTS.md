# Reports

Reports is a screen for hospitalists, ER doctors, staff, ER directors and directors
(module `ops.reports`, on by default). Rows are built on each run and are never
stored, cached or written to the device. A patient report writes one PHI-access
row per run; every CSV export and every change to a saved report is audited.

## What works today, with no EHR connection

| Report | What it lists |
| --- | --- |
| Team census | Patients a hospitalist has accepted, grouped by hospitalist |
| Pending admits | Patients not routed yet, or routed and not accepted |
| Provider load | Each hospitalist's census counter, cap, open slots, waiting requests |
| Code history | Every code called: answers, duration, steps against target |

These read DocTurn's own records. DocTurn removes a patient after the
organization's auto-clean window (24 hours by default), so Team census is the
patients DocTurn still has on record, not the hospital's full census. When the
hospitalists' census counters and the rows differ, the report says so.

Anyone with access can build a custom report: pick the data, the columns, up
to eight filters, a grouping and a sort, then run it unsaved or save it. A
saved report is private to its owner; a director or ER director can share one
with the organization. Reports download as CSV and print.

## Epic patient lists

Once the hospital's Epic backend app is connected (Settings → Integrations →
Epic, the same connection on-call uses), a report can read an Epic patient
list live: a team list, a unit list, an ED pending-admit list. DocTurn shows
initials, age, sex, room/bed, unit, attending, encounter status and start,
length of stay and reason. It never shows or stores a full name or MRN.

What the hospital's Epic team has to grant the app, in addition to the
on-call scopes:

- `system/List.read` — find and read patient lists
- `system/Patient.read` — initials, age, sex
- `system/Encounter.read` — location, attending, status, reason

How a run reads Epic (FHIR R4):

1. `GET List/{id}` — the list's entries (Patient, or Encounter, references)
2. `GET Patient/{id}` for each entry
3. `GET Encounter?patient={id}` and take the encounter in progress, else the newest

"Find lists" in the report builder calls `GET List?code=patients`. If the
hospital's Epic does not return lists to a backend app, enter the list's ID
(from the Epic team) by hand.

Limits: 150 patients per run, 60 seconds per run, six requests in parallel.
A patient Epic refuses is left out and counted in a note on the report. If
Epic cannot be read at all the report fails with the reason; it is never shown
as an empty list.

### Not yet verified against a live Epic

This was built to the FHIR R4 standard and tested against a simulated Epic.
It has not been run against a real Epic environment. Confirm with the
hospital's Epic team during onboarding: that patient lists are exposed to
backend apps as `List` resources, which list IDs to use, and that the three
scopes above are approved. Cerner and other EHRs are not connected.
