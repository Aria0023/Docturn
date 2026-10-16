# Admin examples

All admin endpoints require `director`, `er_director` or `developer`. A developer may act on
another organization with `?org=<id>`. Every call below is audited (metadata only).

## A. Activate a new template version (no deploy)

```bash
# 1. See what is active (platform default v1 unless the org overrode it)
curl -b c -s /api/notes/templates/active
# → {"id":1,"name":"Locked H&P","version":1,"platformDefault":true,"sections":[...]}

# 2. Upload a new version. `module` is the full template JSON (04). Here: the clinician's
#    complete locked template text goes in `instructions`; sections/hard locks unchanged.
curl -b c -s -X POST /api/notes/templates -H 'Content-Type: application/json' -d '{
  "name": "Mercy H&P",
  "changelog": "Load Dr. Chen locked H&P v3 text; add SOCIAL HISTORY",
  "module": { "schemaVersion": 1, "noteType": "H&P", "loincCode": "34117-5",
              "instructions": "<<full locked template text>>",
              "sections": [ ... with {"key":"social","title":"SOCIAL HISTORY","required":true} ... ],
              "hardLocks": { "unitFreeValues": true, "escapedDashLists": true, "genericMedicationNames": true,
                             "poaTagging": true, "twoMidnightLanguage": true, "wordSafe": true,
                             "fullSectionOrder": true, "strictDataIsolation": true,
                             "balancedAssessmentPlan": true, "epicReady": true },
              "phrases": { "twoMidnightInpatient": "Expected length of stay crosses two midnights; inpatient status is appropriate." } }
}'
# → 201 {"id":7,"version":1,"status":"draft",...}     (invalid modules → 400 template_invalid)

# 3. Directors can preview a draft on a real session: POST /api/notes/generate {"templateVersionId":7,...}

# 4. Activate — atomically retires the org's previous active version
curl -b c -s -X POST /api/notes/templates/7/activate
# → {"id":7,"status":"active","activatedAt":...}
#   The very next generation in the org uses it; other orgs are unaffected.

# Platform default (developer only): POST /api/notes/templates?scope=platform, then
# POST /api/notes/templates/:id/activate?scope=platform
```

## B. Enable a new connector for an organization

```bash
# Catalog + current enablement
curl -b c -s /api/notes/connectors
# → {"catalog":[{"key":"uptodate",...},{"key":"baa-llm",...},{"key":"doximity",...},{"key":"openevidence",...},{"key":"metriport","kind":"aggregator",...}],
#    "enabled":[{"connectorKey":"uptodate","enabled":true,"priority":10,"config":{"maxItems":6}}]}

# Enable UpToDate live (key encrypted at rest, masked on read)
curl -b c -s -X PUT /api/notes/connectors/uptodate -H 'Content-Type: application/json' \
  -d '{"enabled":true,"priority":10,"config":{"apiKey":"<customer key>","baseUrl":"https://api.uptodate.com"}}'
# → {"connectorKey":"uptodate","enabled":true,"config":{"apiKey":"••••••••","baseUrl":"..."}}

# Add OpenEvidence ahead of it, and the on-demand Metriport aggregator
curl -b c -s -X PUT /api/notes/connectors/openevidence -d '{"enabled":true,"priority":1,"config":{"baseUrl":"https://.../query","apiKey":"..."}}'
curl -b c -s -X PUT /api/notes/connectors/metriport    -d '{"enabled":true,"config":{"apiKey":"..."}}'

# Optional connectivity check
curl -b c -s -X POST /api/notes/connectors/uptodate/healthcheck
```

## C. Onboard a health system's EHR (registration + config entry, no code)

```bash
curl -b c -s -X PUT /api/notes/ehr -H 'Content-Type: application/json' -d '{
  "name": "Epic (production)", "vendor": "epic",
  "iss": "https://fhir.examplehealth.org/api/FHIR/R4",
  "clientId": "<client id issued by the health system / vendor program>",
  "clientSecret": "<if confidential client>",
  "scopes": "launch openid fhirUser patient/Patient.read patient/Encounter.read patient/Condition.read patient/MedicationRequest.read patient/AllergyIntolerance.read patient/Observation.read patient/DocumentReference.read patient/DocumentReference.write",
  "writeBack": true, "jitProvisioning": false
}'
# The EHR is configured (one-time) to launch https://<app>/smart/launch with redirect https://<app>/smart/callback.
```

## D. Licensing (developer)

```bash
curl -b dev -s -X PUT /api/notes/license/12 -d '{"plan":"seat","seats":40,"billingRef":"si_...","periodEnd":"2027-10-01T00:00:00Z"}'
curl -b c   -s /api/notes/license      # org admin: {"license":{...},"usage":{"periodKey":"2026-10","seatsUsed":12,"generations":310,"exports":298}}
```
Over-limit calls return `402 {"error":"license","reason":"seats_exhausted|usage_exhausted|expired|suspended|no_license"}`.

## E. Configure the BAA LLM engine (optional)

Environment: `NOTE_LLM_PROVIDER=anthropic NOTE_LLM_API_KEY=... NOTE_LLM_MODEL=claude-sonnet-5-5`
(or per-org: `PUT /api/notes/connectors/engine {"enabled":true,"config":{"provider":"anthropic","apiKey":"..."}}`).
Templates with `"engine":"auto"` switch to the LLM automatically; the hard locks still apply.
