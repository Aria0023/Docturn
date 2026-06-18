# DocTurn — Configurability & Adaptive Behavior (DT-NOTE-001)

Goal: let users make **little tweaks at runtime without a new release**, and let the app **learn
usage patterns and suggest** better defaults. This is an **additive** extension of the existing
server-authoritative, config-driven core — not a pivot. Org config (timeout, shift types, rotation
cursor, caps) is already read live at decision time; this generalizes that.

## Three tiers (adopt in order)

### C1 — Runtime settings (in-app, instant effect)
- `org_settings` (director-only policy) + `user_preferences` (self-service) + a cached `config`
  service read in hot paths (rotation, expiry, notifications, messaging).
- Values typed & validated with Zod (bounded ranges). Editing a setting takes effect on the next
  action — **no redeploy.**
- **Effort:** small · **Risk:** low. Extends existing org config; can land early.

### C2 — Behavior flags (per-org rollout)
- `feature_flags` (boolean / variant per org). Ship a behavior dark, flip per hospital, instant
  rollback, safe default when unset.

### C3 — Adaptive defaults (learn → suggest → human confirms)
- `suggestions` table + a periodic, org-scoped, read-only `analyze()` loop over data you already
  log (`assignments`, `audit_logs`, `messages`). Surfaces proposals **with evidence**; nothing
  changes until a human accepts (→ writes setting + `audit_logs`). No ML infrastructure.

## Tweakables catalog (starter set)

| Tweak | Scope | Consumed by | Adaptive? |
|---|---|---|---|
| Assignment timeout (expiry window) | Org | expiry | suggest from median accept time |
| Rotation mode (lowest-census vs sequential) | Org | rotation | — |
| Auto-reassign on no-response (on/off) | Org | expiry | — |
| Reminder cadence + escalation threshold | Org | expiry · notifications | suggest from response times |
| Specialty → service routing map | Org | rotation | learn from past assignments |
| Default intake specialty per complaint keyword | Org | ai-intake | learn from corrections |
| Quick-reply / message templates | User | messaging | surface frequent phrasings |
| Notification channel preference | User | notifications | — |
| Default routing mode (quick vs manual) | User | web | learn per ER doctor |
| Dashboard layout / default landing tab | User | web | learn most-used view |
| Quiet hours / on-shift default window | User | notifications | learn from shift toggles |

> **Org policy vs user preference:** org-scope tweaks are *policy* (director-only, affect everyone);
> user-scope are *preference* (self-service). **Clinical-routing behavior is always org policy —
> never a silent per-user change.**

## Data model additions (4 tables)
`org_settings` (key·value(json)·type·updated_by·updated_at) · `user_preferences` (user_id·key·value) ·
`feature_flags` (org_id·flag·enabled/variant) · `suggestions` (scope·key·proposed_value·evidence·status).

## Suggestion loop (pseudocode)
```
analyze(orgId):                          # periodic, org-scoped, read-only
  m = median(acceptTime from assignments)
  if m < org.timeout * 0.6:
    propose('assignment_timeout', ceil(m), evidence="median accept 4m vs 10m window")
  byKeyword = topSpecialty(per complaint, assignments)
  for kw, spec in byKeyword: propose('specialty_map', {kw: spec}, evidence=…)
# nothing changes until a human accepts:
accept(s)  -> write org_settings + audit_logs
dismiss(s) -> record, stop re-proposing
```

## Principles for a self-adjusting system
1. **Suggest, don't impose** — system proposes, human applies; never silently change clinical behavior.
2. **Audited & reversible** — every applied tweak writes `audit_logs` (who, old→new) and can be reverted.
3. **Policy vs preference** — separated, scope obvious in the UI.
4. **Legible** — show current value, who set it, when.
5. **Show the evidence** — every suggestion carries its reasoning.
6. **Bounded & validated** — every tweak has a type + allowed range (Zod), enforced server-side.

## Roadmap
- **C1** runtime settings (extends org config — can land early)
- **C2** behavior flags
- **C3** adaptive suggestions

Requirements: FR-CFG-01..06, DR-05 (see `10_SYSTEM_REQUIREMENTS.md`). Functions: F17.1..6.
Use cases: UC-29/30/31.
