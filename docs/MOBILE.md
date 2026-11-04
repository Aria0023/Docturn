# DocTurn on phones — the unified PWA

There is **one** DocTurn app. The web app served at `/` is responsive and
installable: on a phone it *is* the mobile app (a Progressive Web App with a
manifest, service worker, home-screen icons and Web Push), and on a desktop it
is the clinical workstation. Same accounts, same session, same REST API, same
WebSocket — a change on one surface is a change on both, so there is no
feature drift between "phone" and "web". On the App Store and Google Play the
same web app ships inside a **native shell** (`mobile-app/`, the last
sections of this document) that adds APNs/FCM push, universal / app links and
the store presence — not a second client.

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
4. For push notifications: open the installed app and tap **Turn on** on the
   one-time "Turn on alerts for STAT messages" card at the top (or, any time,
   **Settings → Notifications → Push notifications → Turn on**), then allow
   when iOS asks. The app never asks on its own — iOS only shows the prompt
   for a tap. (iOS delivers Web Push only to apps added to the home screen,
   iOS 16.4 or later; in a Safari tab the card — once the install banner is
   dismissed — and the Settings row explain the Add to Home Screen step
   instead.)

**Android (Chrome)**
1. Open `https://<your-host>/` in Chrome and sign in.
2. Tap **Install** on the in-app banner, or the Chrome menu ⋮ → **Install app**
   / **Add to Home screen**.
3. Tap **Turn on** on the one-time "Turn on alerts for STAT messages" card
   (works in the browser tab too), or later in **Settings → Notifications**,
   and allow when Chrome asks.

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
- **Permission is asked only from a tap** — the one-time "Turn on alerts for
  STAT messages" card shown after sign-in on a device that can take Web Push
  and has not been asked yet (its **Turn on** button; dismissed, answered or
  turned on, it does not come back on that device), or Settings →
  Notifications → Push notifications → **Turn on**. Sign-in and reloads never
  prompt (WebKit ignores a prompt without a user gesture, and an unprompted
  dialog is easily dismissed into a permanent block). Once allowed, the app subscribes through
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
- **Threads are read when they are opened, a page at a time.** Sign-in and
  reloads fetch the conversation LIST only (each thread's newest message and
  the server's unread count). Opening a thread fetches its newest page
  (`GET /api/messaging/conversations/:id/messages?limit=…`, 50 by default,
  enough to cover what is unread, at most 200); **Load earlier messages**
  pages back with `?before=<id>`. Every thread read is one PHI-access audit
  row, so the log records the threads a clinician actually opened.
- **A dropped socket reconnects and then re-syncs.** Reconnects use
  exponential backoff with jitter capped at 30 s, and retry at once when the
  browser reports it is back `online` or the app returns to the foreground.
  When the server greets the new socket (`CONNECTION_ESTABLISHED`), the client
  asks `GET /api/messaging/sync` ONCE: messages newer than the newest id it
  holds (decorated like thread rows), receipts and recalls since its previous
  sync cursor, and a per-thread summary of ids and counters. It re-reads no
  thread and no list; when nothing changed the answer carries no message
  content and the server writes no PHI-access row (when it does deliver
  messages, the row is `conversation-sync` — a background delivery, not the
  user opening the thread). The role's dashboard data and broadcasts are
  re-read too. So a message, assignment or broadcast that arrived while the
  socket was down appears after the reconnect, without a manual reload
  (measured by `scripts/realtime-e2e.mjs`). Until the
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
  The native shell does not change this: v1 lock / PIN inside the shell is
  the web app's server-backed screens, unchanged (nothing device-held);
  biometric unlock / refresh tokens remain a follow-up.
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

## The native shell (`mobile-app/`) — Expo + react-native-webview

`mobile-app/` is a **native shell** around the web app above: one WebView on
the configured DocTurn host (`EXPO_PUBLIC_API_BASE_URL`, default
`https://docturn.onrender.com`). The web app is the product; the shell adds
what a web page cannot do on its own and nothing else. Nothing clinical lives
in the shell and nothing is stored in it — no PHI, no credentials; the page's
session cookie in the WebView's own cookie store is the only state. v1
lock / PIN is the web app's server-backed screens, unchanged.

The former native screens (login, Messages, Assignments, Profile), the typed
API client, the native WebSocket client and `src/threadEvents.ts` with its
root test are **retired**: inside the shell the complete web app is the
client, and the frames those helpers handled are covered by
`tests/client-realtime.test.ts` and `tests/recall.test.ts`.

### What the shell adds

| | How |
| --- | --- |
| **Detection** | The WebView's user agent ends with `DocTurnShell/<version>` and `window.DocTurnShell = { version, platform }` is injected before any page script. `webapp/api-bridge.js` exposes `DT.shell` (null in a browser) and hides the browser Install banner and the one-time "Turn on STAT alerts" card — push goes through the shell. |
| **Native push (APNs / FCM via Expo)** | When the page reports a session (`{type:"dt-session", state:"active"}`) the shell asks for the OS notification permission — the only moment it prompts, never before sign-in — reads its Expo push token and hands it to the page (`window.__dtShell.pushToken`). The page registers it with the signed-in account through the existing `POST /api/mobile/device-tokens` (platform `expo`) and only then shows **On** in Settings → Notifications. With permission already granted the token is handed on every page load. **Sign-out** `DELETE`s the token while the session still exists, before `POST /api/logout`, then tells the shell (`ended`), which clears delivered notifications and the badge. The server's push service already relays `expo` tokens through Expo's push API with content-free titles. |
| **Android channels** | `stat` (max importance, bypasses Do Not Disturb, long vibration), `urgent` (high), `routine` (default) — defined by the shell at start. The **server names the channel** per push (`server/services/push-channels.ts`, from its own content-free title: a whole-word STAT → `stat`; urgent / consult / assignment → `urgent`; else `routine`, with `priority: "high"` for the first two), so a STAT wake-up is loud and a routine one is quiet. In the foreground the OS shows no banner and plays no sound (the page is live over its WebSocket and plays its own per-priority tone); the notification still lands in the shade. |
| **Notification tap → Messages** | A tap opens the app on Messages for every message title (the rule `webapp/sw.js` applies), and simply opens the app for assignment / consult titles. Payloads carry **no thread id by design** (content-free), so a tap cannot open a specific thread; the newest unread thread is at the top of the list. |
| **Universal / app links → the thread** | `https://<host>/messages/<id>` opens the app on that thread once the account's list is live (a thread the account does not have opens the list, nothing more); `https://<host>/?open=messages` opens Messages; `docturn://messages[/<id>]` is the app's own scheme. The server publishes exactly those two HTTPS shapes in `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` (`server/routes/well-known.ts`; from `APPLE_TEAM_ID`, `IOS_BUNDLE_ID`, `ANDROID_PACKAGE`, `ANDROID_SHA256_CERT_FINGERPRINTS`; **404 until they are set — never a placeholder**, because Apple's CDN and Android's verifier cache what they fetch). The app declares the matching `applinks:` / `webcredentials:` associated domains and an `autoVerify` intent filter for the configured host. |
| **Offline page** | When the host cannot be reached (no network, DNS, TLS, server down) the shell shows "Can't reach DocTurn" with **Try again**, and retries by itself when the app returns to the front. It says nothing about data: once the page loads, the web app's own offline rules above apply. |
| **Pull to refresh** | `pullToRefreshEnabled` — **iOS only** in react-native-webview; on Android the error page's Try again and the foreground retry are the refresh. |
| **Android back button** | The page is one document, so Back walks the WebView's own history when there is any (a link opened in-page) and otherwise lets the OS background the app. Predictive back is off. |
| **Safe areas + status bar** | The top inset is painted with the page's `<meta name="theme-color">`, the bottom inset with the page's body background, and the status-bar icons are light or dark by luminance — live, through a watcher the shell injects, so a theme the user switches to is followed at once. (Android 16 is edge-to-edge; the shell paints the insets itself.) |
| **Camera / microphone for the page** | `mediaCapturePermissionGrantType="grant"`, `allowsInlineMediaPlayback`, `mediaPlaybackRequiresUserAction={false}`, `android.permission.CAMERA` / `RECORD_AUDIO` / `MODIFY_AUDIO_SETTINGS`, `NSCameraUsageDescription` / `NSMicrophoneUsageDescription` — so the web app's voice messages (`getUserMedia` / `MediaRecorder`) and `<input type="file" capture>` image capture work inside the WebView. **Device checks only** (no simulator here) — see the list below. |
| **Service worker inside WKWebView** | iOS allows a page's service worker only for *app-bound domains*: `WKAppBoundDomains` lists the configured host and the WebView sets `limitsNavigationsToAppBoundDomains`, so the precached offline shell and the lock / dismissed-banner storage work as in Safari. The shell never navigates elsewhere: any other `https:` / `mailto:` / `tel:` link leaves for the system browser, mail or dialer. |
| **Store assets and config** | 1024 px opaque iOS icon, Android adaptive + monochrome icons, splash (brand blue, 160 px glyph), Android notification small icon — all generated from `webapp/icons/` by `mobile-app/scripts/make-assets.py` (the iOS icon is a 2× upscale of the 512 px master; replace with a 1024 px master before submission). `PrivacyInfo.xcprivacy` (no tracking; required-reason APIs UserDefaults / FileTimestamp / SystemBootTime / DiskSpace; collected data types Name, User ID, Health, Other User Content, Device ID — linked, app functionality — **must match the App Privacy answers in App Store Connect**). `ITSAppUsesNonExemptEncryption = false` (HTTPS only). Android `allowBackup=false` (no cloud backup of the WebView's cookie / storage). Bundle id / package `com.docturn.app`. `eas.json`: `development` (dev client), `preview` (internal, APK) and `production` profiles, each setting `EXPO_PUBLIC_API_BASE_URL`. |

Verified here (no simulator or device in this environment): `npx expo-doctor`
— 18 of 20 checks pass; the two that do not, "Check Expo config schema" and
"Validate packages against React Native Directory", need `api.expo.dev` /
`exp.host`, which this environment cannot reach, and must be run on a
networked machine; `npx expo prebuild --no-install --platform all --clean`
succeeds for both platforms and the generated `Info.plist`,
`PrivacyInfo.xcprivacy`, entitlements (`aps-environment`, associated
domains), `AndroidManifest.xml` (permissions, `allowBackup`, `autoVerify`
intent filter, notification icon / colour, default channel) and splash
resources were inspected; `tsc --noEmit` is clean; the pure shell logic and
the page's half of the contract are tested from the repo root
(`tests/mobile-shell.test.ts`, `tests/client-shell.test.ts`; the server files
in `tests/well-known.test.ts`, `tests/push-channels.test.ts`).

### Store requirements — verified 2026-11-04

Established from the sources named, not from memory. `expo.dev` and
`support.google.com` did not resolve from the verification environment; the
Expo facts come from the search index of the pages named plus the npm
registry and the installed package, the Google Play facts from
developer.android.com, which restates the Play Console help page.

| | Current | Source |
| --- | --- | --- |
| **Expo SDK** | **SDK 58** — `expo@58.0.23` is npm `latest`; it pins **React Native 0.88.1** (`node_modules/expo/bundledNativeModules.json`; the `sdk-58` template pins `react-native@0.88.1`, `react@19.3.0`, `typescript@~6.0.3`); minimum Node 22.13. `mobile-app/` is on it. | https://expo.dev/changelog/sdk-58 ("Expo SDK 58 ships with React Native 0.88"), https://docs.expo.dev/versions/v58.0.0/, `npm view expo dist-tags` |
| **Apple — upload requirement** | Since **April 28, 2026**: "Apps uploaded to App Store Connect must be built with **Xcode 26** or later using an SDK for **iOS 26**, iPadOS 26, tvOS 26, visionOS 26, or watchOS 26." Since **September 9, 2026**: "iOS and iPadOS apps uploaded to App Store Connect must target iOS 13 or later." SDK 58 builds against the iOS 27 SDK and sets the deployment target to iOS 16.4 (`ios/Podfile`), so both are met; EAS Build's iOS image provides the Xcode. | https://developer.apple.com/news/upcoming-requirements/ |
| **Google Play — target API level** | From **August 31, 2026**: new apps and app updates must target **Android 16 (API level 36)** or higher; existing apps must target Android 15 (API 35) to stay available to new users on newer devices; an extension to **November 1, 2026** can be requested in Play Console. SDK 58 builds with `targetSdk 36`, `compileSdk 37`, `minSdk 24` (React Native 0.88's Gradle version catalog), so it is met. | https://developer.android.com/google/play/requirements/target-sdk (restating https://support.google.com/googleplay/android-developer/answer/11926878) |

**App Store Review Guideline 4.2 — Minimum Functionality** (text as fetched
from https://developer.apple.com/app-store/review/guidelines/ on 2026-11-04):

> **4.2 Minimum Functionality.** Your app should include features, content,
> and UI that elevate it beyond a repackaged website. If your app is not
> particularly useful, unique, or "app-like," it doesn't belong on the App
> Store. If your App doesn't provide some sort of lasting entertainment value
> or adequate utility, it may not be accepted. Apps that are simply a song or
> movie should be submitted to the iTunes Store. Apps that are simply a book or
> game guide should be submitted to the Apple Books Store.
>
> 4.2.1 Apps using ARKit should provide rich and integrated augmented reality
> experiences; merely dropping a model into an AR view or replaying animation
> is not enough.
> 4.2.2 Other than catalogs, apps shouldn't primarily be marketing materials,
> advertisements, web clippings, content aggregators, or a collection of links.
> 4.2.3 (i) Your app should work on its own without requiring installation of
> another app to function. (ii) If your app needs to download additional
> resources in order to function on initial launch, disclose the size of the
> download and prompt users before doing so.
> 4.2.4 Intentionally omitted. 4.2.5 Intentionally omitted.
> 4.2.6 Apps created from a commercialized template or app generation service
> will be rejected unless they are submitted directly by the provider of the
> app's content. […]
> 4.2.7 Remote Desktop Clients: […] (e) Thin clients for cloud-based apps are
> not appropriate for the App Store.

How it applies to this app, honestly: a shell that only wraps a website is
exactly what 4.2 refuses, and reviewers also cite 4.2.7(e). The case for
DocTurn rests on what the native build provides that the web page cannot —
APNs/FCM push with priority channels that wake a clinician's phone for a STAT
message, universal links into a thread, camera and microphone capture for
voice messages and images, the offline page, lock-screen and badge
integration — and on the app being the product's own client submitted by the
product's owner (4.2.6), with no third-party content, catalog or links. The
**review risk is real**: a reviewer may still judge the first build "a
repackaged website". Mitigations that help in practice: submit with push
working end to end, a review note that explains the clinical use and the
native capabilities, a demo account on a **synthetic-data** instance (never
real PHI), and screenshots that show the app, not a browser.

### What the founder must do

1. **Apple Developer Program** — enrol as an **organization** (not an
   individual): needs the legal entity's **D-U-N-S number**, legal authority
   to bind the organization, and an Apple ID for the Account Holder. Then in
   App Store Connect: create the app record for `com.docturn.app`, fill the
   **App Privacy** questionnaire to match `PrivacyInfo.xcprivacy`
   (`mobile-app/app.config.ts`), export compliance (standard HTTPS encryption
   only — `ITSAppUsesNonExemptEncryption` is already `false`), and add review
   notes with a synthetic-data demo account. The Team ID shown in the
   membership page is `APPLE_TEAM_ID` for the server.
2. **Google Play Console** — register a developer account **as an
   organization** (Google applies extra identity and testing requirements to
   new personal accounts), create the app for `com.docturn.app`, complete the
   Data safety form to match the privacy manifest, and enable **Play App
   Signing**. The **first** upload to Play must be done manually in the
   console (a preview `.aab`); `eas submit` works from the second one. The
   app-signing certificate's SHA-256 (Play Console → App integrity) and the
   upload key's SHA-256 (`eas credentials`) are the
   `ANDROID_SHA256_CERT_FINGERPRINTS` for the server (comma-separated).
3. **Expo / EAS account** — `npm install -g eas-cli`, `eas login`, then in
   `mobile-app/`: `eas init` (links the project; put the printed id in
   `eas.json` under each profile's `env` as `EAS_PROJECT_ID` — without it
   there is no push token), `eas credentials` for iOS (APNs key, created and
   stored by EAS) and Android (keystore; **FCM V1** service-account JSON from a
   Firebase project for `com.docturn.app`), and upload that project's
   `google-services.json` as an EAS **file-type environment variable** named
   `GOOGLE_SERVICES_JSON` — never commit it.
4. **Server environment** (Render / the deploy) for the links:
   `APPLE_TEAM_ID`, `IOS_BUNDLE_ID=com.docturn.app`,
   `ANDROID_PACKAGE=com.docturn.app`, `ANDROID_SHA256_CERT_FINGERPRINTS`.
   Check: `curl -i https://<host>/.well-known/apple-app-site-association` and
   `/.well-known/assetlinks.json` answer `200 application/json` (404 means a
   value is missing or malformed). Also set `EXPO_PUBLIC_API_BASE_URL` in
   `eas.json` to the real production host if it is not
   `docturn.onrender.com` (associated domains and app links are derived from
   it at build time).
5. **Build and submit** (from `mobile-app/`):
   `eas build --profile development --platform all` (dev client for a
   physical device), `eas build --profile preview --platform all` (internal
   testers: TestFlight / an APK), `eas build --profile production --platform
   all`, then `eas submit --platform ios --latest` and `eas submit --platform
   android --latest`. Production builds get `aps-environment: production`
   from EAS automatically.
6. **Device-only checks** (nothing here runs on a device; each needs a
   development or preview build on a real iPhone and Android phone):
   - sign in → the OS notification prompt appears once, after sign-in; Settings
     → Notifications shows **On**; `GET` the account's device tokens show one
     `expo` row;
   - a STAT message to a backgrounded / closed phone arrives on the `stat`
     channel (loud, bypasses Do Not Disturb on Android), a routine one on
     `routine`; tapping opens Messages; the title is content-free;
   - sign out → the token row is gone and no further push arrives on that
     phone; sign in as someone else → the row moves to that account;
   - `https://<host>/messages/<id>` from Mail / Messages / another app opens
     the app on that thread (iOS: after the AASA has been fetched — Apple's
     CDN can take up to a day; Android: `adb shell pm get-app-links
     com.docturn.app` shows `verified`);
   - voice message: `getUserMedia` + `MediaRecorder` inside the WebView records
     and the message sends (iOS 16.4+ WKWebView; Android System WebView);
     attachment with `<input type="file" accept="image/*" capture>` opens the
     camera; the permission prompts use the strings above;
   - airplane mode at launch → the offline page; back online → the page loads
     by itself when the app returns to the front; airplane mode while signed
     in → the web app's own offline behaviour (above);
   - status bar and insets follow the theme (switch themes in Settings);
     Android back from a thread backgrounds the app rather than crashing;
   - the lock screen / PIN, MFA and sign-in flows inside the WebView (the
     web app's screens).
