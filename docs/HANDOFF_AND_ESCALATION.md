# Hand-off notes and stuck-admission alerts

## Hand-off notes (module `shift.handoffNotes`, on by default)

Hospitalists (and directors who carry patients) have a Hand-off screen.

- **My patients.** For each accepted patient: how sick (Stable, Watch
  closely, Unstable), a summary, and what to watch or do. Saving creates a new
  version; the newest is the note.
- **Giving it to someone.** Pick a colleague when saving, or leave it and end
  your shift with a covering provider: every note not yet given to anyone is
  given to them. The receiver gets a live notice and a push that say only
  that notes are waiting.
- **Handed to me.** The receiver reads each note and acknowledges it. The
  writer sees who acknowledged and when.

Only the physician responsible for a patient can write its note. Notes are
clinical text: they are removed with the patient, reading the screen writes a
PHI-access entry, and audit entries carry ids only. Ending a shift does not
move accepted patients to the covering provider's census; the note is the
hand-off.

## Stuck-admission alert (module `routing.escalation`, on by default)

An admission is stuck when it has been declined or left unanswered twice, or
when a decline or lapse leaves nobody being asked. The hospitalist director
and ER director are alerted once per patient, live and by push ("An admission
needs a hospitalist", no patient detail). The Patient board marks the patient
"Needs a hospitalist" and the charge nurse's tracker shows "Directors
alerted". It is audited.
