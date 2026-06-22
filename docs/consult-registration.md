# Consult-services registration

## Part A — DONE
The ER intake **Consult services** roster and PA/NP **midlevel pool** are now
driven by the live registered directory (`/api/physicians/directory`), not
hardcoded lists:
- On-call consultant per specialty comes from registered providers (prefers a
  working provider); falls back to demo data for any service with nobody
  registered.
- The "Add PA/NP" pool comes from registered midlevels (credential PA/NP/RN —
  added via People → "Consultant (PA/NP)").
- So a newly registered consultant or midlevel appears **automatically**; the ER
  can still attach them to a consult **manually**.

Source of truth: `store.directory` (hydrated for all roles by the bridge).

## Part B — DEFERRED (do once the app is fully launched)
Self-registration via an organization code:
- Per-org **join/registration code** (admin-visible in director settings).
- Public "register with code" screen → pick role + credential (PA/NP/MD/…) +
  specialty → creates the org user (pending admin approval).
- On approval the person flows into the directory and therefore into Consult
  services automatically (Part A already handles the downstream).

This is an onboarding/auth feature (DocTurn is currently admin-provisioned), so
it's parked until launch.

---

# Parked: Amion scoping (remember for later)
The **Amion** schedule-sync source should be available/enabled **only** for the
Cedars organizations — **Providence Cedars-Sinai** and **Cedars-Sinai Medical
Center** — and NOT defaulted (or offered as the default) for other tenants.
Other orgs use their own sources (QGenda, Word, PDF, online, none).

Current state: per-org `scheduleSources` already keys Amion to a single
`CEDARS` demo org; when the real Cedars tenants exist, set those two to `amion`
and ensure no other tenant defaults to Amion. Consider restricting the Amion
option in the source dropdown to those orgs (or gating by org) once tenants are
finalized.
