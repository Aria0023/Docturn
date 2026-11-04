# DocTurn native shell (Expo + react-native-webview)

The DocTurn phone app is the responsive web app (`webapp/`, see
`docs/MOBILE.md`). This directory is its **native shell**: one WebView on the
configured DocTurn host, plus what a web page cannot do on its own — APNs/FCM
push through Expo, universal / app links, the App Store and Play presence,
camera and microphone grants for the page, the device's back button, safe
areas and a status bar that follows the page's theme. Nothing clinical lives
here and nothing is stored here: no PHI, no credentials. The page's session
cookie, inside the WebView's own cookie store, is the only state.

Expo SDK 58 (`expo@58.0.23`, React Native 0.88.1, React 19.3.0,
`react-native-webview@14.0.1`, `expo-notifications@58.1.8`) — see
`docs/MOBILE.md` for how those versions were established and what the stores
currently require.

## What's here

| Path | Role |
| --- | --- |
| `App.tsx` | The shell: WebView, push hand-over, links, back button, safe areas, status bar, offline page. |
| `src/shell/config.ts` | Build-time config read from the manifest (`extra.apiBaseUrl`, `extra.eas.projectId`, version). |
| `src/shell/bridge.ts` | The shell ↔ page contract: the injected flag script (with the theme-color watcher), `window.__dtShell` calls, the messages the page posts. Pure. |
| `src/shell/links.ts` | Universal-link / notification-tap → what to open. Pure. |
| `src/shell/theme.ts` | theme-color → status-bar icon colour. Pure. |
| `src/shell/push.ts` | Android channels (`stat` / `urgent` / `routine`), permission, the Expo push token, foreground presentation. |
| `src/shell/OfflinePage.tsx` | Shown when the host cannot be reached; Retry, and an automatic retry when the app returns to the front. |
| `app.config.ts` | Expo config: bundle ids, icons, splash, permission strings, privacy manifest, associated domains / app-link intent filters, plugins. |
| `eas.json` | `development` / `preview` / `production` build profiles (each sets `EXPO_PUBLIC_API_BASE_URL`). |
| `assets/` | Icons, splash and notification icon generated from `webapp/icons/` by `scripts/make-assets.py` (needs Pillow). |

The pure modules are tested from the repo root against the server's real push
titles and the link shapes the server publishes: `tests/mobile-shell.test.ts`.
The web app's half of the contract is `tests/client-shell.test.ts`.

The former native screens (login / Messages / Assignments / Profile, the typed
API client, the WebSocket client and `threadEvents.ts` with its root test) are
retired: the web app inside the shell is the complete client, and the frames
those helpers handled are covered by `tests/client-realtime.test.ts` and
`tests/recall.test.ts`.

## The shell ↔ web app contract

- **Detection.** The WebView's user agent ends with `DocTurnShell/<version>`
  (`applicationNameForUserAgent`), and `window.DocTurnShell = { version,
  platform }` is injected before any page script. `webapp/api-bridge.js`
  exposes it as `DT.shell` (null in a browser) and then hides the browser
  install banner and the one-time "Turn on STAT alerts" card.
- **Session.** The page posts `{type:"dt-session", v:1, state:"active"|"ended"}`
  whenever a session appears or ends (sign-in, restore, MFA completion,
  sign-out, expiry).
- **Push.** On `active` the shell asks for the OS notification permission
  (the only moment it prompts — never before sign-in), reads its Expo push
  token and hands it to the page: `window.__dtShell.pushToken(token)`. The
  page registers it with the signed-in account through the existing
  `POST /api/mobile/device-tokens` (platform `expo`) and only then reports
  "On" in Settings. Already-granted permission → the token is handed on every
  page load, so the page always holds it. Sign-out: the page `DELETE`s the
  token while the session still exists, then ends the session, then posts
  `ended`; the shell clears delivered notifications and the badge. A refused
  permission is reported as `window.__dtShell.pushStatus("denied")`; the
  Settings row's Turn on asks the shell again (`{type:"dt-push",
  action:"request"}`) and, once the OS will not ask again, opens the system
  settings.
- **Open.** `window.__dtShell.open({nav:"messages", conversationId?})` — a
  tapped notification (Messages; the payload is content-free, so there is no
  thread id) or a universal link while the app is up. A link that starts the
  app loads `https://<host>/messages/<id>` or `/?open=messages` directly; the
  bridge consumes the path after sign-in.
- **Theme.** The injected script posts `{type:"dt-theme", color, background}`
  from `<meta name="theme-color">` and the body background, and again whenever
  they change; the shell paints the top safe area with `color`, the bottom
  one with `background`, and picks light or dark status-bar icons by
  luminance.
- Calls the shell makes before the bridge has run are queued on
  `window.__dtShellQueue` and replayed by the bridge.

## Run

```bash
npm install
npx expo-doctor                       # 20 checks; two need api.expo.dev
npx tsc --noEmit
npx expo prebuild --no-install --platform all --clean   # generates ios/ and android/ (gitignored)
npx expo start                        # with a development build installed (see below)
```

`EXPO_PUBLIC_API_BASE_URL` chooses the host at build time (`eas.json` sets it
per profile; the default is `https://docturn.onrender.com`). A development
build against a local server needs a host the device can reach — an Android
emulator reaches the machine at `http://10.0.2.2:3000`, a physical phone needs
an HTTPS tunnel, because the production session cookie is `Secure`.

Regenerate the store assets after changing `webapp/icons/`:

```bash
python3 -m pip install pillow
python3 scripts/make-assets.py
```

## Build and submit (EAS)

One-time setup, then the commands, are in `docs/MOBILE.md` ("What the founder
must do"). In short:

```bash
npm install -g eas-cli && eas login
eas init                                  # prints the project id → EAS_PROJECT_ID in eas.json env
eas credentials                           # APNs key (iOS), FCM V1 service account + keystore (Android)
eas build --profile development --platform all
eas build --profile preview --platform all
eas build --profile production --platform all
eas submit --platform ios --latest
eas submit --platform android --latest    # EAS has required the first Play upload by hand — see docs/MOBILE.md
```

`ios/` and `android/` are generated by prebuild on every build and are not
committed. `google-services.json` is an EAS file-type environment variable
(`GOOGLE_SERVICES_JSON`), never a file in the repo.
