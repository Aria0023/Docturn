# Live demo (for sales calls)

Makes the demo hospital come alive while you present. It exists only on a
test-data instance (`SYNTHETIC_DATA` not `false`); on a real-patient-data
instance the control is hidden and `/api/demo/live` answers 404.

## Two modes

**Go live** offers:

- **Guided story** (start here). One patient, JM, goes from the ER to admitted
  in 7 captioned steps, about 2–3 minutes. A card in the corner says what just
  happened and why it matters. When a step is yours (Accept, Acknowledge) it
  says "Your turn" and waits for your tap. **Next** skips ahead, **Pause**
  holds, **Follow** opens the right screen for you, **Show me** jumps there.
  At the end: **Replay** or **Keep it busy**.
- **Busy hospital** (for questions). Admissions, messages and consults keep
  arriving, as described below.

## A simple strategy for a demo call (about 15 minutes)

1. **Ask first (2 min).** "How do admissions reach your hospitalists tonight?
   How do you page for something urgent?" Listen for pagers, phone tag,
   whiteboards, texting apps. Those are the pains the story answers.
2. **Tell the story (3 min).** Sign in as the hospitalist (use **Mobile view**
   to show the phone), press **Go live → Guided story**, and let the card
   narrate. Tap Accept and Acknowledge yourself when it says "Your turn":
   that is the moment people remember.
3. **Show their seat (3 min).** Switch **Demo as** to the role of the person
   on the call (director, ER physician) and point at what changed for them.
4. **Let it get busy (5 min).** On the finale press **Keep it busy** and take
   questions while the hospital runs.
5. **Close (2 min).** Security in one sentence (BAA, audit trail, no patient
   details on the lock screen), then the next step: a pilot on one service.

Keep it to one story and three "wow" moments (the request arriving, the STAT,
the live board). Skip settings and admin screens unless asked.

## Running it

1. Sign in to the demo hospital (org `ISPN`) as any role.
2. Press **Go live** in the top bar (on a phone: menu → Demo as role → Go live)
   and pick **Guided story** or **Busy hospital**.
3. A red **Live** chip shows the time left (30 minutes, then it stops by itself)
   and **Stop**. In Busy hospital it also has a **Steady / Busy** switch, and a
   "Live demo" line under the top bar shows the latest event.

Switch roles with **Demo as** at any time: the demo keeps running.

## What happens in Busy hospital

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
