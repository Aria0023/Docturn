# 07 — Screens → API Map

Bridges the `design/ui_kits/` prototypes to the API. Recreate each screen in React + Vite +
Tailwind + shadcn/ui, matching the prototype's look (high-fidelity), and wire it to these endpoints
with TanStack Query. The design tokens are in `design/colors_and_type.css`.

> Routing: `wouter`. Server state: TanStack Query (query keys = the endpoint path). Auth context
> exposes `user`; a `WebSocketProvider` streams events and invalidates queries.

## Login
- **Purpose:** authenticate into a hospital workspace.
- **Fields:** org code, username, password.
- **Calls:** `POST /api/login` → on `200` store user + route to the role's dashboard; on `202` show
  the MFA step → `POST /api/2fa/complete-login`.
- **States:** invalid credentials (inline error), loading button, MFA entry.

## App shell
- Sidebar nav (role-dependent), top bar with on-shift toggle (hospitalist) + notifications.
- **Calls:** `GET /api/user` (session bootstrap); nav badge counts from `GET /api/assignments/pending`.

## Hospitalist dashboard
- **Stats:** census, cap, pending, accepted-today.
- **Pending requests:** list with Accept / Decline. **My patients:** accepted list.
- **Calls:** `GET /api/assignments/pending`, `GET /api/assignments/my`,
  `PATCH /api/assignments/:id/accept`, `PATCH /api/assignments/:id/reject`,
  `PATCH /api/hospitalists/:id/working-status`.
- **Realtime:** `ASSIGNMENT_CREATED` → prepend to pending; `ASSIGNMENT_UPDATED` → reconcile.

## ER physician dashboard
- **Intake:** textarea note → **Extract with AI** → editable fields. **Routing:** Quick
  (round-robin) shows the next provider; Manual lists providers. **Recently sent:** status badges.
- **Calls:** `POST /api/patients/extract`, `POST /api/patients`, `GET /api/hospitalists/working`,
  `POST /api/assignments` (`mode: round_robin | manual`).
- **Realtime:** `ASSIGNMENT_UPDATED` updates the sent list's status.

## Director dashboard
- **Providers:** list with census/cap + working toggle. **Round-robin config:** timeout,
  auto-reassign, reset rotation. **Rotation order:** drag to reorder (`@dnd-kit`).
- **Calls:** `GET /api/hospitalists`, `PATCH /api/hospitalists/:id/working-status`,
  `GET/PATCH /api/org/config`, `POST /api/round-robin/reset`, `POST /api/director/hospitalists`,
  `PATCH /api/hospitalists/rotation-order`.

## Messaging
- Conversation list + thread + composer; presence dots; delivery/read ticks; typing.
- **Calls:** `GET /api/messaging/conversations`, `GET /api/messaging/conversations/:id/messages`,
  `POST /api/messaging/send`, `POST /api/messaging/messages/mark-read`.
- **Realtime:** `MESSAGE_RECEIVED` appends; `user_typing` shows indicator; `USER_PRESENCE_CHANGED`
  updates dots. Send `typing_start/stop` on input.

## Directory
- Searchable provider grid with presence + quick message/call.
- **Calls:** `GET /api/physicians/directory` (client-side filter).

## Settings (configurability)
- **Org policy** (director): timeout, rotation mode, auto-reassign, reminder cadence, specialty map.
- **My preferences** (everyone): default routing mode, notification channel, quiet hours, templates.
- **Suggestions** (director): review adaptive proposals with evidence → accept / dismiss.
- **Calls:** `GET /api/settings`, `PATCH /api/settings/org`, `PATCH /api/settings/me`,
  `GET /api/suggestions`, `POST /api/suggestions/:id/accept|dismiss`, `GET/PATCH /api/feature-flags`.

## Developer console
- Cross-tenant org admin, impersonation (audited), AI diagnostics, CMS editor for public pages.
- **Calls:** `/api/dev/*`, `GET/PUT /api/cms/:key`.

## Mobile (Expo)
- Bottom-tab nav; QR org onboarding; realtime assignments; FCM push registration.
- **Calls:** `GET /api/mobile/org/:code`, `GET /api/mobile/assignments`, `POST /api/mobile/device-tokens`.

## Design fidelity notes
- Status-color language is fixed: **amber = pending, emerald = accepted, blue = sent/active, red =
  rejected, slate = offline**. Pair every status color with an icon and/or label.
- Tokens, radii, shadows, and spacing live in `design/colors_and_type.css` (map shadcn theming to
  those CSS variables). Icons: `lucide-react`. **Light mode only. One primary action per view.
  Patients shown by initials only.**
