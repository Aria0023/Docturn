# DocTurn on phones — the unified PWA

There is **one** DocTurn app. The web app served at `/` is responsive and
installable: on a phone it *is* the mobile app (a Progressive Web App with a
manifest, service worker, home-screen icons and Web Push), and on a desktop it
is the clinical workstation. Same accounts, same session, same REST API, same
WebSocket — a change on one surface is a change on both, so there is no
feature drift between "phone" and "web".

- Source: `webapp/` (designer's kit + `api-bridge.js` live bridge) plus the
  PWA plumbing `webapp/manifest.webmanifest`, `webapp/sw.js`, `webapp/icons/`
  and the in-app `InstallPrompt.jsx` banner.
- Server: `server/app.ts` serves `webapp/` at `/` through
  `server/webapp-static.ts`. In production (`NODE_ENV=production` with a fresh
  `npm run build`) that is the **precompiled bundle**: production React, every
  `.jsx` already compiled, content-hashed and brotli/gzip-precompressed files —
  about 1.5 MB raw / 270 KB brotli for the shell. Outside production it is the
  no-build kit (in-browser Babel, development React): about 5.7 MB raw /
  1.1 MB brotli. Hashed files are cached immutably; the shell, `sw.js` and the
  manifest are always revalidated. The retired slim phone URL still redirects
  to `/`, and a self-destructing service worker is served at its old scope so
  devices that installed the old kit heal themselves on their next visit.
- All JS is vendored locally (React, Babel, Lucide), so the app loads with no
  external CDN and behind hospital firewalls.
- Verification (each exits non-zero on any failed check):
  `npm run test:e2e` runs `scripts/interop-unified.mjs` — real Chromium, an
  iPhone-viewport session against desktop sessions on one backend (messaging
  both ways, STAT acknowledge, admission accept, broadcast delivery, role
  targets, DND, typed credentials). `npm run test:offline` proves the offline
  shell (below) in both serving modes; `scripts/realtime-e2e.mjs` the realtime,
  reconnect, push-permission and sign-out behaviour described here;
  `scripts/phone-shell-check.mjs`, `phone-layout-check.mjs` and
  `messaging-phone-check.mjs` the phone layouts at 375 / 390 / 430 px.

## Install on a phone

The app must be reached over **HTTPS** in production (the session cookie is
`Secure`); any tunnel that fronts the dev server with TLS works for testing.
When the app detects it can be installed, a blue **Install** banner appears at
the top of the screen — one tap on Android/desktop Chrome, guided steps on iOS.

**iPhone / iPad (Safari)**
1. Open `https://<your-host>/` in Safari and sign in.
2. Tap the **Share** button (square with an up-arrow) → **Add to Home Screen**
   → **Add**.
3. Launch "DocTurn" from the home screen — it opens full-screen (standalone,
   no browser chrome) with the blue "D" icon.
4. For push notifications: open the installed app, go to **Settings →
   Notifications → Push notifications → Turn on** and allow when iOS asks.
   The app never asks on its own — iOS only shows the prompt for a tap.
   (iOS delivers Web Push only to apps added to the home screen, iOS 16.4 or
   later; in a Safari tab that row explains the Add to Home Screen step
   instead.)

**Android (Chrome)**
1. Open `https://<your-host>/` in Chrome and sign in.
2. Tap **Install** on the in-app banner, or the Chrome menu ⋮ → **Install app**
   / **Add to Home screen**.
3. Launch from the home screen or app drawer; turn alerts on in **Settings →
   Notifications** (allow when Chrome asks).

**Desktop (Chrome / Edge)** — the same **Install** banner (or the install icon
in the address bar) installs DocTurn as a windowed app.

## What works on a phone

Everything, because it is the same app. What differs is layout only: the
sidebar becomes a drawer, Messaging switches to list/thread panes on narrow
screens, dashboards stack their tiles.

| Area | On a phone |
| --- | --- |
| Login | Org code + username + password; 2FA-enrolled accounts complete the code on the same screen (authenticator, SMS or backup code). Privileged roles whose org requires MFA are taken straight into enrolment. |
| Secure messaging | Conversation list with unread counts and presence, live threads, priority/STAT with acknowledge, typing indicators, attachments, forwarding, templates, role-addressed ("the on-call cardiologist") targets, DND with a covering provider. |
| Assignments | Hospitalist: live census/cap, incoming assignments with expiry countdown + Accept/Decline, on/off-shift toggle. ER: intake and routing, sent board with live status. |
| Director / ER director | Overview tiles, per-provider shift and census controls, reassignment, emergency broadcasts with per-recipient acknowledgement. |
| Directory / on call | Everyone in the org, on-shift status, live presence, one-tap message. |
| Broadcasts | Live banner on every signed-in device, one-tap acknowledge; offline devices catch up on next open. |

Patients are always shown by **initials only** (no names/DOB), matching the
backend's compact payloads. Desktop-oriented areas (developer console,
compliance monitor, Amion admin, org configuration) are reachable on a phone but
not optimised for it.

## Push notifications — status

- **Web Push is live.** The server signs with VAPID keys (`VAPID_PUBLIC_KEY` /
  `VAPID_PRIVATE_KEY`; without them a pair is generated on first boot and
  stored in the database's platform settings, so subscriptions survive
  restarts).
- **Permission is asked only from a tap** — Settings → Notifications → Push
  notifications → **Turn on**. Sign-in and reloads never prompt (WebKit ignores
  a prompt without a user gesture, and an unprompted dialog is easily
  dismissed into a permanent block). Once allowed, the app subscribes through
  the service worker and registers the subscription with
  `POST /api/mobile/device-tokens` (platform `webpush`); every later sign-in on
  that device re-registers it silently for whoever signed in.
- **Sign-out unregisters the device.** It deletes this device's subscription
  on the server (`DELETE /api/mobile/device-tokens/:token`, while the session
  still exists), unsubscribes it in the browser, and only then ends the server
  session — the signed-out clinician's wake-ups stop reaching the device. A
  session that merely expires keeps the subscription (STAT wake-ups to a phone
  in a pocket are the point); the next sign-in re-assigns it.
- **Payloads are content-free by design.** A push carries a generic title only
  — never message text, names or patient data — because Apple, Google and the
  push relays do not sign BAAs for push content. Tapping a message
  notification opens the app on Messages, which fetches the real content over
  TLS. While the app is in the background a push also sets the app-icon badge
  (a plain flag — the payload carries no count); in front, the badge and the
  window title show the real unread count.
- Dead subscriptions (404/410 from the push service) are pruned automatically.
- Realtime updates while the app is open arrive over the WebSocket and are
  applied as they come (no re-fetch per event); push is the wake-up for a
  backgrounded or closed app.
- **A dropped socket reconnects and then re-syncs.** Reconnects use
  exponential backoff with jitter capped at 30 s, and retry at once when the
  browser reports it is back `online` or the app returns to the foreground.
  When the server greets the new socket (`CONNECTION_ESTABLISHED`), the client
  makes ONE conversation-list request and re-reads only the threads that can
  have changed (a newer last message, an unread-count mismatch, group threads,
  threads with my unread/unacknowledged messages), plus the role's dashboard
  data and broadcasts. So a message, assignment or broadcast that arrived
  while the socket was down appears after the reconnect, without a manual
  reload (measured by `scripts/realtime-e2e.mjs` scenario B). Until the
  socket is back, nothing new appears on its own. iOS suspends a backgrounded
  web app's socket entirely; the catch-up runs when it comes to the front.
- A socket the server closes because the session is over (password
  changed/reset elsewhere, or expired) returns the app to sign-in instead of
  retrying.

## Limits (honest list)

- **iOS requires the home-screen install for push.** Safari tabs do not
  receive Web Push; only the installed app does (iOS 16.4+), and iOS may
  throttle delivery to apps the user rarely opens.
- **Session lifetime is the 15-minute rolling cookie.** Reopening the installed
  app after idle asks you to sign in again — deliberate for the current
  security posture. The app lock (Lock button, or 15 minutes without input)
  survives a reload, is shared by every tab, pauses background polling, and is
  cleared only by re-entering the password (checked by the server).
  Biometric unlock / refresh tokens would need a native wrapper.
- **No delivery latency SLA yet.** Push delivery on physical iOS/Android
  devices has not been measured end-to-end; that is the next verification
  step.
- **Offline: the app opens, but nothing clinical works without a
  connection.** On its first online visit the service worker installs and
  precaches the COMPLETE shell (every script, the stylesheet, manifest, icons)
  all-or-nothing; from the next launch on, the app opens without a network.
  A deploy that changes the shell installs a new worker that precaches the new
  shell before it takes over (if that precache fails, the previous complete
  version stays in charge). `/api` and `/ws` are never cached — no PHI or
  identity in browser caches — so an offline launch shows the **sign-in
  screen**, a reload while signed in returns to sign-in, and signing in
  offline answers **"Can't reach the server. Check your connection and try
  again."** The kit's local demo ("Offline — demo mode", fabricated patients
  under the synthetic-data banner) is offered only when the server has
  confirmed it is a synthetic-data instance during that same page load —
  never on a cold offline launch and never on a real-PHI instance. If the
  connection drops during a session, what is on screen stays (from memory);
  a message sent offline shows **Not sent** with Retry / Edit, an admission or
  a broadcast sent offline is taken back with "No connection — … NOT sent /
  nobody was alerted", and the socket reconnects and re-syncs as described
  above. Proven by `npm run test:offline` and `tests/offline-signin.test.ts`.
- **Per-message receipts** (web app / PWA) come only from the server's
  delivery rows: "Sending…" until the server stores the message, then
  "Delivered", then "Read" — live, via the `MESSAGE_READ` WebSocket frame that
  `POST /api/messaging/messages/mark-read` emits (ids only). A thread counts as
  read only while it is on screen in a foreground tab. A send the server
  refuses or that never leaves the device shows "Not sent" with Retry / Edit.

## The Expo native app (`mobile-app/`)

`mobile-app/` remains an Expo / React Native **skeleton, not a shipped
product**: a typed API client, a reconnecting WebSocket and four tabs (login,
Messages, Assignments, Profile).

- **Messages** is a text-only client of the same `/api/messaging/*` endpoints
  the web app uses: the conversation list with unread counts, a thread, and a
  new-conversation picker. An open thread applies the server's live frames —
  `MESSAGE_RECEIVED` reloads it, `MESSAGE_RECALLED` removes the recalled
  message at once (and refreshes the list and the tab badge), and
  `MESSAGE_READ` turns the sender's receipt from "Sent" to "Read". A thread is
  marked read only while the app is in the foreground. The sender's own unread
  messages carry a **Recall** button (44 pt, with a confirm dialog) when the
  org's `messaging.recall` module is on; a refused recall (already read,
  module off) says why. The frame handling lives in
  `mobile-app/src/threadEvents.ts` and is tested against the real server's
  frames in `tests/mobile-thread-events.test.ts`. There are no attachments,
  voice notes, priorities, acknowledgements, forwarding or broadcasts here.
- **Assignments** is the realtime pending queue with accept / decline.
- **Profile** signs out. At sign-in the app registers an Expo push token,
  which the server's push service sends content-free titles to.

There is no directory, intake or director surface. The unified PWA above is
the shipped phone client; the backend (`/api/mobile/*`, device-token storage,
push-first notification service) is in place if a native app is ever needed
for APNs/FCM or biometric unlock.
