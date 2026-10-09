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
- **Screens** — Login (org code + credentials; a QR code only pre-fills the
  org code — `/api/mobile/org/:code` is members-only and answers for the
  caller's own org, so it is no org-code oracle), Messages (text-only
  conversations / thread / new on `/api/messaging/*`; an open thread applies
  `MESSAGE_RECALLED` and `MESSAGE_READ` live, marks read only in the
  foreground, and offers Recall on your own unread messages when the org's
  `messaging.recall` module is on), Assignments (realtime pending queue with
  accept/decline), Profile (device-token registration, sign out). `App.tsx`
  also registers an Expo push token at sign-in.
- **`src/threadEvents.ts`** — the pure frame → thread-state helpers the
  Messages screen uses; the root test suite runs them against the real
  server's frames (`tests/mobile-thread-events.test.ts`).

## Run

```bash
npm install
npm start        # Expo dev server; press i / a for iOS / Android
```

Point the app at your API with `expo.extra.apiBaseUrl` in `app.json` (defaults to
`http://localhost:3000`). Start the backend first (`npm run dev` in the repo
root). Compact payloads carry initials/room/specialty only — no PHI in transit
beyond initials, matching the web client and the spec.
