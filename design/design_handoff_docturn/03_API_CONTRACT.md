# 03 — API Contract

REST under `/api`. JSON in/out. Auth via the `docturn.sid` session cookie (set on login). All
non-public routes require a session; privileged routes additionally assert role + tenant (see
`04_RBAC.md`). Validation uses the shared Zod schemas. Non-2xx responses are `{ error: string }`.

**Auth legend:** `public` · `auth` (any logged-in) · role names · `self` (own resource) · `participant`.

## Auth & users

| Method & path | Auth | Body / params → Response |
|---|---|---|
| `POST /api/register` | public | `{ orgCode, username, password, displayName }` → `201 { pending:true }` (director approves) |
| `POST /api/login` | public | `{ orgCode, username, password }` → `200 user` **or** `202 { twoFactorRequired:true }` |
| `POST /api/2fa/complete-login` | public(pending) | `{ code }` → `200 user` (TOTP / SMS OTP / backup code) |
| `POST /api/mfa/enroll` | auth | begin TOTP enrollment → `{ secret, otpauthUrl }` |
| `POST /api/mfa/verify` | auth | `{ code }` → activates 2FA; returns 10 backup codes once |
| `POST /api/logout` | auth | → `204` |
| `GET /api/user` | auth | → sanitized `user` (no `password_hash`) |
| `GET /api/users` | director | → `User[]` in org |
| `GET /api/registrations` · `POST /api/registrations/:id/approve` | director | pending-registration queue |

## Providers, directory & rotation

| Method & path | Auth | Notes |
|---|---|---|
| `GET /api/hospitalists` | auth | all providers (census, cap, working) |
| `GET /api/hospitalists/working` | auth | on-shift only |
| `GET /api/physicians/directory` | auth | HIPAA-safe directory fields |
| `POST /api/director/hospitalists` | director, er_director | create provider user + profile |
| `PATCH /api/hospitalists/:id/working-status` | self or director | `{ working:boolean }` |
| `PATCH /api/physicians/:id/capacity` | self or director | `{ patientCap:number }` |
| `PATCH /api/hospitalists/rotation-order` | director | reorder rotation |
| `DELETE /api/physicians/:id` | director | 409 if pending assignments exist |
| `POST /api/round-robin/reset` | director | resets `org.rotation_index` |
| `GET /api/org/config` · `PATCH /api/org/config` | auth · director | round-robin timeout, shift types |

## Patients & assignments

| Method & path | Auth | Notes |
|---|---|---|
| `POST /api/patients/extract` | er_doctor | `{ note }` → `{ initials, roomNumber, issueSummary, specialty }` |
| `POST /api/patients` | er_doctor | `{ initials, roomNumber, issueSummary, specialty }` → `Patient` |
| `GET /api/patients` | auth | org patients |
| `POST /api/assignments` | er_doctor | `{ patientId, mode:'round_robin'|'manual', hospitalistId? }` → `Assignment` |
| `GET /api/assignments/pending` | hospitalist | caller's pending queue |
| `GET /api/assignments/my` | hospitalist | caller's accepted/active |
| `PATCH /api/assignments/:id/accept` | hospitalist(self) | → `accepted`; census++ |
| `PATCH /api/assignments/:id/reject` | hospitalist(self) | → `rejected`; auto-reroute |
| `PATCH /api/assignments/:id/reassign` | director, er_director | manual reroute to next / `{ hospitalistId }` |
| `PATCH /api/assignments/:id/cancel` | director | → `cancelled` |

## Messaging

| Method & path | Auth | Notes |
|---|---|---|
| `GET /api/messaging/conversations` | auth | caller's conversations (last message, unread count) |
| `POST /api/messaging/conversations` | auth | `{ type, name?, participantIds }` → `Conversation` |
| `GET /api/messaging/conversations/:id/messages` | participant | message history |
| `POST /api/messaging/send` | participant | `{ conversationId, content }` → `Message` |
| `POST /api/messaging/messages/mark-read` | auth | `{ messageIds:int[] }` → `204` |
| `DELETE /api/messaging/messages/:id` | sender | soft delete + audit |

## Broadcasts

| `POST /api/broadcasts` | director | `{ message, severity }` → org-wide; emits `BROADCAST_*` |
| `POST /api/broadcasts/:id/ack` | auth | record acknowledgement |
| `GET /api/broadcasts/:id` | director | ack status per recipient |

## Org · developer · CMS · SMS

| Method & path | Auth | Notes |
|---|---|---|
| `GET/POST/PATCH /api/dev/organizations` | developer | cross-tenant org admin |
| `POST /api/dev/impersonate` | developer | audited session swap |
| `GET /api/dev/ai-diagnostics` | developer | extractor health / prompt review |
| `GET/PUT /api/cms/:key` | auth · developer | landing/contact page settings |
| `POST /api/sms/send` · `GET /api/sms/history` | system/director | Twilio send + audit history |

## Configuration

| Method & path | Auth | Notes |
|---|---|---|
| `GET /api/settings` | auth | effective settings for caller (org policy + own prefs) |
| `PATCH /api/settings/org` | director | upsert `org_settings` (validated, audited) |
| `PATCH /api/settings/me` | auth | upsert own `user_preferences` |
| `GET/PATCH /api/feature-flags` | director, developer | per-org flags |
| `GET /api/suggestions` · `POST /api/suggestions/:id/accept` · `/dismiss` | director | adaptive proposals |

## Health & mobile

| `GET /api/health` | public | `{ ok:true, db:'up' }` |
| `GET /api/mobile/org/:code` | public | **safe fields only** (id, name, code, timezone) |
| `GET /api/mobile/assignments` | auth | compact payload (initials, room, specialty) |
| `POST /api/mobile/device-tokens` · `DELETE …/:token` | auth | FCM token register/deregister |

## Standard responses

- `400` validation (Zod summary) · `401` no session · `403` role/tenant · `404` not found / not in
  your org · `409` conflict (e.g. delete with pending work).
- List endpoints return arrays; single-resource endpoints return the object. Timestamps are ISO-8601.

---

# WebSocket protocol

Mounted at **`/ws`**. On connect the server parses the `docturn.sid` cookie, resolves the session →
`userId` + `organizationId`, and stores the socket in a `clients` map keyed by userId. Connections
that fail session resolution close with code **1008**. All fan-out is **tenant-scoped**.

Helpers: `broadcast(orgId, message)` (every socket in a tenant) · `sendToUsers(userIds, message)`.

| Type | Direction | Meaning |
|---|---|---|
| `CONNECTION_ESTABLISHED` | server→client | handshake + connection id |
| `USER_PRESENCE_CHANGED` | server→org | a user connected/disconnected |
| `ASSIGNMENT_CREATED` | server→user | new pending assignment for you |
| `ASSIGNMENT_UPDATED` | server→org | status change (accepted/expired/cancelled) |
| `MESSAGE_RECEIVED` | server→participants | new message / delivery ack |
| `typing_start` / `typing_stop` | client→server | typing intent |
| `user_typing` | server→participants | relayed typing indicator |
| `PROVIDER_CREATED` / `PROVIDER_UPDATED` / `HOSPITALIST_DELETED` | server→org | directory changed |
| `BROADCAST_CREATED` / `BROADCAST_ACK` | server→org | emergency broadcast + acks |
| `PING` / `PONG` | both | 20s heartbeat; refreshes presence |

**Client reconnect:** exponential backoff; on reconnect, refetch active queries (TanStack
`invalidateQueries`) so missed events reconcile.
