# Minimal prototype path — SMART launch to exported note

Runs today with **zero secrets** thanks to the in-process mock EHR, stub connectors and the
deterministic engine. Swap any piece for the real thing by configuration.

```bash
npm install
npm run dev            # API + UI on :3000, auto-seeds org ISPN, platform default template,
                       # trial license, mock EHR connection, UpToDate connector (stub)
```

1. Open http://localhost:3000, sign in as `chen` / `docturn` (org `ISPN`), then open
   http://localhost:3000/notes.html.
2. Click **Simulate EHR launch** — this is exactly what Epic/Cerner do:
   `/smart/launch?iss=http://localhost:3000/mock-ehr/fhir&launch=…` → authorize → callback.
   (Or **Standalone launch**.)
3. **Assemble context from EHR** — pulls Patient, Encounter, Conditions, Medications,
   Allergies, Observations, DocumentReferences; shows generic names, unit-free values, POA,
   prior-note summaries and UpToDate (stub) knowledge.
4. Fill chief complaint / HPI / exam / assessment / plan, pick **Inpatient**, **Generate note**.
5. Edit the draft. **Copy to clipboard** (paste into Word/Epic) or **Write back as
   DocumentReference** (inspect at http://localhost:3000/mock-ehr/_inspect/written).
6. **End session & discard** — tokens and context are gone; `GET /api/notes/audit` (as
   `director`) shows only metadata.

The same flow is automated in `tests/notes.test.ts` (`npm test`).

## Pointing it at a real EHR sandbox

1. Register the app with the vendor sandbox (redirect URI `https://<public host>/smart/callback`).
2. `PUT /api/notes/ehr` with the sandbox `iss`, client id (+ secret) — see 06 C.
3. Set `PUBLIC_URL=https://<public host>` so redirect URIs are stable behind a tunnel/LB.
4. Launch from the vendor's sandbox launcher, or `GET /smart/standalone?org=ISPN&connection=<id>`.

## Going live with real sources

| Piece | Prototype | Production switch |
|---|---|---|
| EHR | mock | `ehr_connections` row per customer (vendor registration first — 08) |
| Knowledge | UpToDate stub | `apiKey` in `PUT /api/notes/connectors/uptodate` |
| Fallback knowledge / engine | stub | `NOTE_LLM_*` env or per-org `engine` row (BAA provider only) |
| External records | Metriport stub | `apiKey` on the `metriport` connector; still on-demand |
| Sessions | in-memory | Postgres/Redis session store with TTL (08) |
| Billing | log hook | `STRIPE_SECRET_KEY` + `billingRef` per license |
