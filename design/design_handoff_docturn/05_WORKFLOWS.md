# 05 — Workflows

The behavioral heart of DocTurn. Implement these as pure, testable functions in `server/services/`
so the state machine and rotation can be unit-tested without HTTP.

## 1. Patient assignment — end to end

1. **Intake** (`er_doctor`): submit a patient. Optional free-text note → `ai-intake` returns
   `{ initials, roomNumber, issueSummary, specialty }`.
2. **Routing:** server selects a hospitalist via `rotation.selectNext(orgId, { shiftType, specialty })`
   (round-robin) **or** accepts a manual `hospitalistId`.
3. **Persistence:** insert `patients` row (status `waiting`) + `assignments` row (status `pending`,
   `expires_at = now + org.assignment_timeout_min`).
4. **Notification:** `notifications.notifyAssignment(assignment)` → WebSocket to the target provider
   + push/SMS cascade.
5. **Acknowledgement:** provider **accepts** (→ census++, patient `assigned`) or **declines**
   (→ reroute). No response before `expires_at` → **expired** → reroute.

## 2. Round-robin selection (`rotation.selectNext`)

```
eligible = hospitalists in org WHERE
             working = true
             AND shift_type ∈ org.round_robin_shift_types
             AND (specialty matches if required)
             AND current_patient_count < patient_cap

if eligible is empty:                       # cap relief — let the queue drain
    increment patient_cap by 1 for every working provider in org
    recompute eligible

sort eligible by (current_patient_count ASC, rotation_order ASC)   # lowest census wins
pick = eligible[0]
advance org.rotation_index                  # persist cursor so rotation stays fair
return pick
```

- Default selection is **lowest-census**; a `sequential` mode (cycle by `rotation_index`) is an
  org-config option (see `11_CONFIGURABILITY.md`).
- **Always org-scoped.** Never select across tenants.

## 3. Expiry & reassignment (`server/services/expiry.ts`)

- A `setInterval` (~15s) finds `pending` assignments with `expires_at <= now` (**capped at 50 per
  tick**), marks them `expired` (stamp `resolved_at`), and calls `rotation.selectNext` to create a
  new `pending` assignment for the next eligible provider.
- **reject** does the same reroute immediately.
- If no eligible provider exists even after cap relief, leave the patient `waiting` and emit
  `assignment.unrouted` (UI shows "awaiting capacity").
- Reassignment is **server-driven**; the client never computes the next provider.

## 4. Notification delivery — push-first, SMS only on escalation (`server/services/notifications.ts`)

This is the model the established clinical-comms platforms (TigerConnect, PerfectServe, OnPage) use:
**a content-free push wakes the app, which fetches the encrypted message over TLS. SMS/voice are
escalation endpoints — they fire only when a push goes unacknowledged within a timeout.** Routine
traffic rides free APNs/FCM push and never touches carrier-billed SMS.

```
notifyAssignment(assignment):
   ws.sendToUsers([targetUserId], { type:'ASSIGNMENT_CREATED', assignment })   # 1. in-app, live (real)
   push.send(targetUser, { title:'New assignment' })                           # 2. content-free FCM/APNs wake-up

   # escalation is scheduled, gated on acknowledgement (per org delivery profile)
   after profile.ackTimeoutSec, if NOT acknowledged:
        push.send(allDevices(targetUser), { title:'New assignment' })          # 3. re-push / fan-out
   after profile.escalationTimeoutSec, if STILL NOT acknowledged AND profile.mode includes SMS:
        sms.send(targetUser.phone, "New DocTurn assignment — open the app")     # 4. carrier SMS (selected carrier)
        if profile.mode === 'push_sms_voice': voice.call(targetUser.phone)      # 5. voice (optional, last resort)
   if still no ack: reroute (round-robin) / backup recipient / director alert
```

- Order is **WebSocket → push → re-push/fan-out → (timeout) → SMS → (optional) voice → reroute.**
- **Push and SMS payloads carry NO PHI** — a generic wake-up only; the app fetches the message body
  server-side over TLS. SMS contains code/initials + a deep-link at most.
- The escalation clock is driven by **acknowledgement state**, not send success (push opens an
  app-controlled channel with Sent / Delivered / Read + an explicit acknowledge).
- **`ackTimeoutSec`, `escalationTimeoutSec`, `mode`, and `smsCarrier` are per-org configuration**
  (`org_settings.notification_profile`, set in the Developer console — see `06_INTEGRATIONS.md`).
  In **`push` mode** the SMS/voice steps are skipped entirely (zero carrier cost).
- Stub/transport errors are swallowed and logged so the workflow always continues (graceful degradation).

The same delivery path backs **secure messaging** (§5) and **emergency broadcasts**: a new message
WS-pushes to connected recipients, content-free push wakes the rest, SMS escalates only if unread
past the timeout (broadcasts may force escalation immediately by policy).

## 5. Secure messaging

- **Conversations:** `direct` (2 participants), `group` (named, N participants), `emergency`
  (broadcast). Participants stored as a json id array.
- **Send:** insert `messages` row → create `message_delivery_status` rows for each participant
  (delivered_at = now for connected users) → `ws.sendToUsers(participants, { type:'MESSAGE_RECEIVED', message })`.
- **Read receipts:** `POST /messaging/messages/mark-read` sets `read_at`; emit a delivery update so
  the sender's ticks turn blue.
- **Typing:** `typing_start`/`typing_stop` over WS relayed to other participants as `user_typing`.
- **Delete:** soft-delete (set `deleted_at`) by the sender only; append an `audit_logs` row.
- **Access:** a message is never delivered to a non-participant; non-participant fetch → 403.

## 6. Presence

- On WS connect, mark the user online and broadcast `USER_PRESENCE_CHANGED` to the org.
- A 20s `PING`/`PONG` heartbeat keeps presence fresh; on disconnect, broadcast offline.

## 7. Authentication & MFA

1. `POST /api/login` validates credentials scoped to the org code.
2. If `two_factor_enabled`, respond `202 { twoFactorRequired }` and set `req.session.pendingMfa`;
   the session is **not** authenticated until MFA completes.
3. `POST /api/2fa/complete-login` accepts a TOTP code (speakeasy), an SMS OTP (Twilio), or a backup
   code. Backup codes are stored as SHA-256 hashes and marked `used_at` on consumption (no reuse).
4. Session lifetime is **15 minutes, rolling**, with inactivity expiry; cookies are `httpOnly`,
   `sameSite=strict`, `secure` in production.

## Acceptance invariants (tests assert these)

- A provider's `current_patient_count` increases **only** on accept, decreases on cancel of an
  accepted assignment — never on create/reject/expire.
- An expired/rejected assignment **always** produces exactly one new pending assignment when an
  eligible provider exists, and zero when none do.
- `rotation.selectNext` never returns a provider from another org, never one at/over cap (unless cap
  relief raised every working provider's cap), and prefers the lowest census.
- Messaging never delivers a message to a non-participant.
