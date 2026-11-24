# Code protocols

Codes is a screen for hospitalists, ER doctors, ER directors and directors
(module `codes.protocols`, on by default).

## Setting up a protocol (director or ER director)

A protocol has a name (Code Stroke), a team and timed steps.

- **Team.** Each member has a title and is either an on-call role (from the
  Who's on call board or a consult service) or a named person. An on-call role
  is resolved when the code is called, to whoever holds it at that moment.
- **Steps.** Each step can carry a target in minutes, counted from when the
  code is called.

Four starting points are offered (Code Stroke, Code STEMI, Code Sepsis, Rapid
Response). Their teams arrive with nobody set and their targets are common
ones; set both to the hospital's own protocol before clinicians rely on it.

## Calling a code (any clinician)

Pick the protocol, say where, optionally link a patient and add a note. Before
confirming, the screen shows who will be alerted and who cannot be.

- Each team member with a DocTurn account gets a live alert, a sound, a banner
  across the app and a push notification. A member on Do Not Disturb with a
  covering provider hands the alert to that provider.
- Anyone who has not acknowledged is alerted again every 60 seconds, up to
  four alerts in total.
- Alerts carry the protocol name and the location only, never the patient.

## The status board

Each member shows as Alerted, Acknowledged or Arrived, with how long they took
to answer. Each step shows its target, when it was done and by whom, and turns
red when overdue. The clock runs from activation. The team, the caller and the
director roles can tick steps, complete the code or stand it down. Every
action is audited.

## Limits to know

- **Only people with a DocTurn account can be alerted.** DocTurn's account
  types today are hospitalist (including PA/NP), ER physician, ER director and
  director. Nurses, radiology and CT staff, pharmacists and other staff have no
  account type yet, so a slot for them shows as "Not alerted — call them"
  unless it points at someone who does have an account. A role nobody holds is
  shown the same way. Nothing is ever shown as notified when it was not.
- There is no text message or overhead page from a code. Push needs the app
  installed with notifications allowed.
- A patient link disappears when DocTurn's auto-clean removes that patient.
- The starting targets are not clinical guidance from DocTurn.
