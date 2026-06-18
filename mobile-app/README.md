# DocTurn Mobile (Expo)

The DocTurn mobile app — Expo / React Native — sharing the same backend through a
typed `ApiClient`.

## What's here

- **`src/api.ts`** — typed `ApiClient` (login, `/api/mobile/*`, accept/reject,
  device-token registration). Captures and resends the `docturn.sid` session
  cookie (React Native has no browser cookie jar).
- **`src/realtime.ts`** — native WebSocket to `/ws` with the session cookie and
  exponential-backoff reconnect.
- **`App.tsx`** — bottom-tab navigation; gates on `GET /api/user`.
- **Screens** — Login (org code + credentials; QR org onboarding resolves the
  code via the public `/api/mobile/org/:code`), Assignments (realtime pending
  queue with accept/decline), Profile (registers an FCM/APNs device token, sign
  out).

## Run

```bash
npm install
npm start        # Expo dev server; press i / a for iOS / Android
```

Point the app at your API with `expo.extra.apiBaseUrl` in `app.json` (defaults to
`http://localhost:3000`). Start the backend first (`npm run dev` in the repo
root). Compact payloads carry initials/room/specialty only — no PHI in transit
beyond initials, matching the web client and the spec.
