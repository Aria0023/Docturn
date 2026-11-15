# Live demo (for sales calls)

Makes the demo hospital come alive while you present. It exists only on a
test-data instance (`SYNTHETIC_DATA` not `false`); on a real-patient-data
instance the control is hidden and `/api/demo/live` answers 404.

## Running it

1. Sign in to the demo hospital (org `ISPN`) as any role.
2. Press **Go live** in the top bar (on a phone: menu → Demo as role → Go live).
3. A red **Live** chip shows the time left (30 minutes, then it stops by itself),
   a **Steady / Busy** switch and **Stop**. A "Live demo" line under the top bar
   shows the latest event.

Switch roles with **Demo as** at any time: the demo keeps running.

## What happens

Every 9 seconds (Steady) or 5 seconds (Busy), one of the other demo accounts
does something through the app's real endpoints, so screens update exactly as
they would in a hospital:

- the ER sends an admission (round-robin, or to a named hospitalist when the
  person you are showing already has two requests waiting);
- a hospitalist accepts a request that has waited about 25 seconds;
- clinicians send routine, urgent and STAT messages (STATs are acknowledged
  about 30 seconds later);
- hospitalists request consults, and named consultants answer them.

## What it never does

- It never acts as an account that has the app open. Requests, consults and
  STAT messages addressed to the account you are presenting from are left for
  you to accept, answer or acknowledge on screen.
- It stops adding patients once 18 are open, and keeps going with messages.
- It writes the usual audit entries, plus `demo.live_start` / `demo.live_stop`.

Everything it creates stays on the board after you stop. Use **Clear all** on
the Patient board to reset before the next call.
