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
- Server: `server/app.ts` serves `webapp/` at `/`. The retired slim phone URL
  still redirects to `/`, and a self-destructing service worker is served at
  its old scope so devices that installed the old kit heal themselves on their
  next visit.
- All JS is vendored locally (React, Babel, Lucide), so the app loads with no
  external CDN and behind hospital firewalls.
- Verification: `npm run test:e2e` runs `scripts/interop-unified.mjs` — real
  Chromium, an iPhone-viewport session against desktop sessions on one backend
  (messaging both ways, STAT acknowledge, admission accept, broadcast delivery,
  role targets, DND).

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
4. For push notifications: open the installed app, allow notifications when
   asked. (iOS delivers Web Push only to apps added to the home screen, iOS
   16.4 or later.)

**Android (Chrome)**
1. Open `https://<your-host>/` in Chrome and sign in.
2. Tap **Install** on the in-app banner, or the Chrome menu ⋮ → **Install app**
   / **Add to Home screen**.
3. Launch from the home screen or app drawer; allow notifications when asked.

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
  `VAPID_PRIVATE_KEY`, or a pair generated and persisted on first boot). After
  sign-in the app asks for notification permission, subscribes through the
  service worker and registers the subscription with
  `POST /api/mobile/device-tokens` (platform `webpush`).
- **Payloads are content-free by design.** A push carries a generic title only
  — never message text, names or patient data — because Apple, Google and the
  push relays do not sign BAAs for push content. Tapping the notification opens
  the app, which fetches the real content over TLS.
- Dead subscriptions (404/410 from the push service) are pruned automatically.
- Realtime updates while the app is open arrive over the WebSocket; push is the
  wake-up for a backgrounded or closed app.

## Limits (honest list)

- **iOS requires the home-screen install for push.** Safari tabs do not
  receive Web Push; only the installed app does (iOS 16.4+), and iOS may
  throttle delivery to apps the user rarely opens.
- **Session lifetime is the 15-minute rolling cookie.** Reopening the installed
  app after idle asks you to sign in again — deliberate for the current
  security posture. Biometric unlock / refresh tokens would need a native
  wrapper.
- **No delivery latency SLA yet.** Push delivery on physical iOS/Android
  devices has not been measured end-to-end; that is the next verification
  step.
- **Offline is read-only shell.** The service worker caches only the static
  app shell so the app opens offline; `/api` and `/ws` are never cached (no
  PHI in browser caches), so live data needs a connection.
- **Per-message read receipts** show "Delivered"; the other party's read time
  is not yet exposed per message.

## The Expo native app (`mobile-app/`)

`mobile-app/` remains an Expo / React Native **skeleton, not a product**: a
typed API client, a reconnecting WebSocket and three screens (login,
assignments, profile). It has no messaging, directory, intake or director
surface and no push wiring. The unified PWA above delivers "install on your
phone and message securely" today; the backend (`/api/mobile/*`, device-token
storage, push-first notification service) is already in place if a native app
is ever needed for APNs/FCM or biometric unlock.
