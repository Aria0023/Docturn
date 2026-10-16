# Security & compliance checklist; EHR registration vs. customer activation

## What is implemented

- [x] **No PHI at rest.** Notes, context packages and EHR tokens are never written to the
  database. Audit rows hold user, action, timestamp, patient/encounter *references* and counts
  (tested: audit JSON contains no note text).
- [x] **Minimum necessary.** The assembler drops names, identifiers and DOB; connectors receive a
  declared projection only; the external aggregator runs only on explicit request.
- [x] **Strict data isolation.** One patient per session; generation rejects a package whose
  patient differs from the launch context; identifiers scrubbed from output.
- [x] **Tenant isolation.** Every table and storage method is org-scoped; `iss` resolution is the
  only cross-tenant lookup (by design — the EHR identifies the tenant), and ambiguity returns 409.
- [x] **OAuth hygiene.** PKCE S256, random `state` with 10-minute expiry, exact redirect URI,
  `aud` = `iss`, confidential-client Basic auth, refresh handled server-side; the browser never
  sees tokens.
- [x] **Secrets at rest.** Client secrets and connector keys AES-256-GCM encrypted
  (`SECRETS_KEY`), masked in API responses.
- [x] **RBAC.** Clinicians generate/export; directors manage templates, connectors, EHR
  connections and read licensing/audit; only the platform developer sets licenses or platform
  defaults.
- [x] **Licensing before generation/export**; usage metered per user per period; billing hooks
  emit no PHI.
- [x] **Existing DocTurn controls apply:** Helmet, rate limiting, 15-minute rolling sessions,
  MFA for password logins, PHI-access logs, security-incident log.
- [x] **Fail-safe generation.** A failing connector or LLM never blocks the note; hard locks
  guarantee output format regardless of engine.

## Production hardening (configuration / small additions, tracked)

- [ ] **Verify `id_token` signatures** against the EHR's `jwks_uri` (today: claims decoded,
  `aud`/`exp` checked). Add `jose` and cache JWKS per `iss`.
- [ ] **Session store with TTL** (`connect-pg-simple` or Redis) instead of the memory store;
  encrypt the session row at rest; set `SESSION_SECRET` and `SECRETS_KEY` from a KMS.
- [ ] **Epic/athena confidential clients** using `private_key_jwt` (SMART backend-style
  client assertion) where the vendor requires it — a second branch in `smart/launch.ts`.
- [ ] **CSP** for `/notes.html` (the app currently relaxes CSP for the design-kit UI).
- [ ] **BAA inventory:** every connector/engine marked `baaRequired` must have a signed BAA
  (UpToDate: data-use agreement; LLM provider: BAA; Metriport: BAA). Enforce in the admin UI
  by blocking enablement until a BAA reference is recorded in connector config.
- [ ] **Retention:** audit logs 6 years (HIPAA), `license_usage` per contract; nothing else to
  retain. Document in the customer-facing security packet.
- [ ] **Egress allow-list** per environment (EHR hosts, UpToDate, LLM provider, Metriport).
- [ ] **SSO for admins** (SAML/OIDC) via the existing Passport layer; SCIM for pre-provisioning
  when `jit_provisioning=false`.
- [ ] **Penetration test + SOC 2 Type II** evidence: the audit and licensing tables are the
  control evidence; add alerting on `notes.user_jit_provisioned` spikes.

## Data-flow summary (for the BAA / security questionnaire)

| Data | Where it exists | Lifetime |
|---|---|---|
| EHR access/refresh token | server session (`req.session.smart`) | until end-session, logout, or 15-min inactivity |
| Context package | HTTP response → browser memory; request body on generate | request/session |
| Draft note | browser textarea; request body on export | request/session |
| Connector requests | minimum-necessary projection to the enabled vendor | transient (vendor's own policy under BAA) |
| Audit metadata | `audit_logs`, `phi_access_logs` | retained |
| Configuration | `ehr_connections`, `org_connectors` (secrets encrypted), `note_template_versions`, `licenses` | retained |

## EHR registration (one-time, ours) vs. customer activation (per health system)

| | One-time vendor registration (DocTurn) | Per-customer activation (health system) |
|---|---|---|
| **Epic** | Create the app in **Epic on FHIR / Vendor Services** (formerly App Orchard): app name, SMART launch URL `https://<app>/smart/launch`, redirect `https://<app>/smart/callback`, requested FHIR R4 resources/scopes (`Patient, Encounter, Condition, MedicationRequest, AllergyIntolerance, Observation, DocumentReference` read + `DocumentReference` create), non-production client ID for sandbox testing. Publish → production client ID. | The health system's Epic analyst **downloads/activates** the app in their instance (Connection Hub), maps it to the production client ID, enables the write-back note type, and places the launch (activity/toolbar button). We add one `ehr_connections` row with their `iss`. |
| **Oracle Health (Cerner)** | Register on **code.cerner.com / Oracle Health developer portal**: SMART provider app, redirect URI, scopes, patient/user context; sandbox `iss` for testing. | Customer's Oracle Health team approves the app for their tenant (`iss` = `https://fhir-ehr.cerner.com/r4/<tenant>`), adds the launch to PowerChart MPages. We add the row. |
| **athenahealth** | Register in the **athenahealth Marketplace / Developer Portal**; obtain client ID/secret; app review. | Practice enables the Marketplace app; we add the row with their practice-level `iss`. |
| **MEDITECH** | **MEDITECH Greenfield / Alliance** registration; SMART launch configured. | Site-level activation; row added. |
| **Any other SMART EHR** | Register once per vendor program. | Config row. |

**Rule of thumb:** vendor programs are where *we* register the code once; customers never
receive a new build — they receive a client ID/activation in their EHR and we receive their
`iss`. `PUT /api/notes/ehr` is the entire onboarding step on our side.
