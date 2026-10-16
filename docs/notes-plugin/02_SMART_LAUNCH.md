# SMART on FHIR launch and token flow

Implements HL7 **SMART App Launch 2.x**: EHR launch and standalone launch, public or
confidential client, PKCE (S256), OpenID `fhirUser` identity. The same three endpoints serve
every EHR; per-vendor differences are configuration (`ehr_connections` row).

## Endpoints

| Endpoint | Role |
|---|---|
| `GET /smart/launch?iss=&launch=[&org=]` | EHR launch entry. Resolves the tenant from `iss`, discovers endpoints, redirects to the EHR's authorize URL. |
| `GET /smart/standalone?org=CODE[&connection=ID]` | Standalone launch (patient picked in the EHR). |
| `GET /smart/callback?code=&state=` | Exchanges the code, binds the EHR identity to a DocTurn user, stores the session, redirects to `/notes.html`. |
| `GET /api/notes/session` / `DELETE` | Inspect / discard the ephemeral session. |

## Sequence

```mermaid
sequenceDiagram
  participant EHR
  participant B as Browser
  participant A as DocTurn Notes
  participant DB as config DB

  EHR->>B: open https://notes.docturn.app/smart/launch?iss=<FHIR base>&launch=<opaque>
  B->>A: GET /smart/launch
  A->>DB: ehr_connections WHERE iss = ? (enabled)
  A->>EHR: GET <iss>/.well-known/smart-configuration (cached 10 min)
  A->>A: PKCE verifier/challenge, state; store SmartPending in session
  A-->>B: 302 <authorization_endpoint>?response_type=code&client_id&redirect_uri&scope&state&aud=<iss>&code_challenge&code_challenge_method=S256&launch
  B->>EHR: authorize (user already signed in to EHR; consent per vendor policy)
  EHR-->>B: 302 /smart/callback?code&state
  B->>A: GET /smart/callback
  A->>A: verify state (and ≤10 min age)
  A->>EHR: POST <token_endpoint> grant_type=authorization_code&code&redirect_uri&code_verifier (+ Basic auth if confidential)
  EHR-->>A: { access_token, expires_in, scope, patient, encounter, id_token, refresh_token? }
  A->>A: decode id_token → fhirUser (prod: verify JWS via jwks_uri)
  A->>DB: ehr_user_links(connection, fhirUser) → user, else link signed-in user, else JIT-provision
  A->>A: req.login(user); req.session.smart = {token, patient, encounter, ...}
  A->>DB: audit notes.launch (metadata)
  A-->>B: 302 /notes.html
```

## Launch-context handling

* `patient` / `encounter` from the token response become `SmartSession.patientId/encounterId`.
  Every later call enforces that the context package's `patient.reference` equals the launched
  patient (`409 context_patient_mismatch`) — strict data isolation.
* Scopes requested are the connection's `scopes` string. For standalone launches `launch` is
  removed and `launch/patient` added automatically.
* Write-back is offered only when the connection allows it **and** the granted scope includes
  `DocumentReference` write (`.write`, `.*`, or SMART v2 `c`/`u`).
* Token refresh: `requireSmart` refreshes 30 s before expiry when a refresh token exists
  (`offline_access` / `online_access` granted); otherwise the session ends and the clinician
  relaunches.

## Identity binding (EHR SSO)

1. `ehr_user_links` maps `(connection, fhirUser)` → DocTurn user (preferred).
2. If the browser already has a DocTurn session in the same org, that user is linked.
3. Otherwise, if the connection has `jit_provisioning`, a password-less user is created with
   `jit_role` (default `hospitalist`), and the link recorded (`notes.user_jit_provisioned`).
   Set `jit_provisioning=false` for customers who require pre-provisioning via SAML/SCIM.

SAML/OIDC for the *admin console* is unchanged DocTurn auth (Passport). For clinicians the EHR
launch **is** the SSO: the EHR authenticated them, and `fhirUser` is the assertion.

## Per-vendor notes (configuration only)

| Vendor | `iss` example | Client type | Quirks handled by config |
|---|---|---|---|
| Epic | `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4` (sandbox) / customer URL | public (PKCE) or confidential (JWT in production → *hardening*: add `private_key_jwt`) | Register the exact redirect URI; non-production `iss` differs per customer. |
| Oracle Health (Cerner) | `https://fhir-ehr-code.cerner.com/r4/<tenant>` | public/confidential | Requires `aud`; supports `offline_access`. |
| athenahealth | `https://api.platform.athenahealth.com/fhir/r4` | confidential | Practice-level `iss`; DocumentReference write via standard create. |
| MEDITECH Expanse | customer-specific | public | Standard SMART v1 scopes (`patient/*.read`). |
| Mock (this repo) | `<host>/mock-ehr/fhir` | public | Auto-approves; `launch=practitioner:<id>` impersonates. |
