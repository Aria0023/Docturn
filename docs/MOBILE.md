# DocTurn Mobile (PWA)

DocTurn's mobile app is a **Progressive Web App served at `/m`** by the same
server as the desktop app. It is the designer's mobile UI kit
(`design/ui_kits/mobile/`) wired to the **live backend** — same accounts, same
session, same REST API and same WebSocket as the web app. Nothing is mocked:
what a hospitalist sees on their phone is exactly what the ER sees on the
desktop board, in real time.

- Source: `mobileapp/` (kit copy + `api.js` live bridge + `app.jsx` shell + PWA
  plumbing). The original kit in `design/ui_kits/mobile/` is untouched.
- Server mount: `server/app.ts` serves `mobileapp/` at `/m` with an SPA
  fallback (`/m/*` → `mobileapp/index.html`), registered before the desktop
  kit's catch-all. Works from source (`npm run dev`) and from the compiled
  build (`npm run build && npm start`).
- All JS is vendored locally (React, Babel, Lucide — the same copies the
  desktop kit uses), so the app loads with no external CDN, offline, and behind
  hospital firewalls.

## What it does (feature parity with the web core)

| Area | Mobile behavior |
| --- | --- |
| Login | Org code + username + password; same demo accounts (`ISPN` / `chen` / `docturn` etc.); same 15-min rolling cookie session as the web. Accounts with 2FA enabled are directed to the desktop for now. |
| Secure messaging | Conversation list with unread counts and presence dots, live thread view, send (optimistic + `POST /api/messaging/send`), mark-as-read on open, **typing indicators** and **live delivery over the WebSocket**, new direct/group conversations from the full org directory. Broadcast-type conversations are read-only. |
| Assignments (hospitalist) | Dashboard with live census/cap, round-robin queue (lowest census next), incoming assignments with expiry countdown + Accept/Decline, "My patients" census list, on/off-shift toggle. |
| Assignments (ER doctor) | Intake form (initials, room, complaint, specialty, acuity), route via round-robin or to a specific working hospitalist (`POST /api/patients` + `POST /api/assignments`), "Recently sent" board with live status (Routing / Accepted / Declined / Expired / Re-routed). |
| Director | Overview: on-shift/census tiles, per-provider shift toggle and census/cap steppers (live PATCHes), round-robin next-up, incoming queue if the director takes patients, emergency-broadcast composer. ER director gets the intake surface + broadcast composer. |
| Directory / On call | Everyone in the org with role/credential, hospitalist on-shift status, live online presence (WS), one-tap "message" into a thread. |
| Broadcasts | Live banner on every signed-in device when a director sends one (severity-colored), with one-tap **Acknowledge** (`POST /api/broadcasts/:id/ack`). Directors/ER directors compose broadcasts from their home tab. |

Patients are always shown by **initials only** (no names/DOB), matching the
web client and the backend's compact payloads.

## Install on a phone (Add to Home Screen)

The PWA must be reached over **HTTPS** in production (the session cookie is
`Secure`); any tunnel/host that fronts the dev server with TLS works too.

**iPhone / iPad (Safari)**
1. Open `https://<your-host>/m` in Safari and sign in.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Launch "DocTurn" from the home screen — it opens full-screen (standalone,
   no browser chrome) with the blue "D" icon.

**Android (Chrome)**
1. Open `https://<your-host>/m` in Chrome.
2. Chrome shows an **Install app** prompt (or menu ⋮ → *Add to Home screen* /
   *Install app*).
3. Launch from the home screen or app drawer.

The service worker (`mobileapp/sw.js`) precaches the app shell so the app
opens instantly and still loads offline. **It never caches `/api` or `/ws`
responses — no PHI is ever written to browser caches.**

## Current limitations (honest list)

- **No native push notifications.** Realtime updates arrive over the
  WebSocket, i.e. **while the app is open** (foreground, or briefly
  backgrounded). A page that iOS/Android has frozen won't buzz for a new
  assignment. True push (APNs/FCM) requires the native app below — the backend
  is already ready for it (`POST /api/mobile/device-tokens` stores FCM/APNs
  tokens, and the notification service is push-first with SMS escalation).
- **Session lifetime is the web's 15-minute rolling cookie.** Reopening the
  installed app after idle asks you to sign in again. Fine for v1 security
  posture; biometric unlock / refresh tokens are native-app territory.
- **Per-message read receipts** show "Delivered" (the server records delivery
  immediately and tracks reads via mark-as-read), but the API doesn't yet
  expose the other party's read timestamps to the sender, so "Read" state
  isn't rendered per message.
- **2FA-enrolled accounts** must complete TOTP on the desktop; the mobile
  login surfaces this instead of half-working.
- Compliance/audit browsing, org config, Amion sync, and the developer
  platform console remain desktop-only by design (the kit screens for them
  were mock-only, so they are hidden rather than shipped dead).

## The Expo native app (`mobile-app/`): status and effort to ship

`mobile-app/` is an Expo / React Native **skeleton, not a product** (~390
lines of TS): a typed `ApiClient` with manual cookie handling, a
reconnecting WebSocket, and three screens — Login (org code + credentials),
Assignments (pending accept/decline via `/api/mobile/assignments`), Profile
(device-token registration stub, sign out). It has **no messaging, no
directory, no ER intake, no director surface, no push wiring, and its
dependencies have never been installed/built in this repo**.

To ship it natively you'd need roughly:
1. **Feature build-out** — port the messaging (threads, typing, receipts),
   directory/presence, intake and director screens; ~the same surface the PWA
   now implements (the PWA's `api.js` documents every endpoint mapping).
2. **Push** — Firebase project + APNs key, `expo-notifications` config,
   server-side FCM sender (the DB and `/api/mobile/device-tokens` endpoint
   already exist; the sender currently logs instead of calling FCM).
3. **Auth hardening** — token- or refresh-based sessions (the 15-min cookie is
   hostile to a native app), plus biometric unlock for HIPAA-friendly UX.
4. **Store shipping** — EAS build profiles, signing, App Store / Play review
   (health app privacy questionnaires), plus a crash/update pipeline.

Estimate: weeks of work, most of it push + store logistics. The PWA at `/m`
delivers the "install on your phone and message securely" outcome today, and
nothing in it blocks the native app later — both speak to the same API.

## Verification snapshots

Screenshots from the automated iPhone-viewport (390×844) Playwright run are in
`docs/mobile/`: login (`01`), hospitalist dashboard with live pending
assignment (`02`), messages list (`03`), thread with delivered receipt
(`04`–`05`), directory (`06`), live typing indicator and cross-device delivery
(`07`–`08`), ER intake + sent board (`09`–`10`), broadcast banner with ack
(`11`), director overview (`12`).
