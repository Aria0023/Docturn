# 12 — Traceability & Coverage (DT-GAP-001)

A bidirectional coverage audit across the three layers: every use case traced down to a function
and a requirement, every requirement traced back up. (Hand-traced; no automated SE tool was used.)

## Scorecard
- **Use-case coverage: 25 / 31** covered · 2 partial · 4 open (all Could). **All Must + Should UCs covered.**
- **Requirement → function: 67 / 67** — every requirement traces to a function (no orphans).
- **Gaps resolved: 8** (6 Med gaps + 2 verification risks fixed; 4 Could tracked to milestones).

The clinical-safety core (assignment state machine, census invariants, tenant isolation, messaging
access control, PHI logging) is fully traced with **Test**-method verification.

## Coverage (reflected in 10_SYSTEM_REQUIREMENTS.md → 67 reqs)
| Gap | Was | Closed by |
|---|---|---|
| GAP-01 | UC-26 Onboard device (QR), no req (+ security angle) | **FR-MOB-02** + **SEC-12** |
| GAP-02 | UC-27 Register push token, no req | **FR-MOB-03** |
| GAP-03 | F1.3 TOTP enrollment unverified | **FR-AUTH-04** |
| GAP-04 | F8.3 push-send / live integrations under-specified | **FR-NOT-02** + **IR-05** |
| GAP-05 | F6.5 message delete (audit/PHI weight) no req | **FR-MSG-04** |
| GAP-06 | F2.4 developer cross-tenant bypass not fully audited | **SEC-13** |
| VR-01 | SEC-04 (no PHI in payloads) was Inspect-only | promoted to **Test** |
| VR-02 | SEC-05 (cookie flags) was Inspect-only | promoted to **Test** |

## Remaining open (intentional — tracked to milestones)
| Gap | Item | Why deferred |
|---|---|---|
| GAP-07 | UC-17 reset-rotation assertion (F9.2) | Low — timeout/mode covered by FR-CFG; add to test suite |
| GAP-08 | UC-18 approval action (F9.3) covered only via FR-REG-01 | Low — extend trace or add FR-REG-02 at its milestone |
| GAP-09 | Could-tier: UC-19 resources, UC-20 on-call sync, UC-23 CMS, UC-25 AI diagnostics (F14.x/F16.x/F10.3) | Author requirements at their milestone (Platform phase) |
| GAP-10 | Minor functions: F6.4 typing, F3.4 capacity, F5.3 cursor | Fold assertions into existing tests |

## Non-gaps (correct by design)
12 requirements trace to `—` rather than a use case: PR-04, SEC-09, SEC-10, DR-01, IR-02, UR-03,
DEP-01–05. These are **system-wide quality / constraint** requirements (performance, deployment,
error hygiene), not actor behaviors — so having no UC is correct.

## Net state
Every **Must** and **Should** use case and every security-relevant function now has a dedicated,
mostly Test-verified requirement. The only remaining items are **Could**-tier expansion features
whose requirements are best authored when those milestones are scheduled.
