# 00 — Product Overview

## Purpose

DocTurn coordinates two things inside a hospital and keeps them fast, safe, and auditable:

1. **Patient assignment** — when an ER physician needs to hand a patient to an inpatient
   provider (hospitalist), DocTurn routes the request to the right provider (round-robin by
   live census, or manual), tracks acknowledgement, and re-routes automatically if it expires.
2. **Secure clinical messaging** — HIPAA-aware direct/group/emergency conversations with
   presence, delivery/read receipts, and typing indicators.

It is **multi-tenant** (many hospitals, each an `organization`), runs on **web and mobile**, and
is marketed publicly as **DoctorHeidi**.

## Primary roles

| Role | Who | Primary surface |
|---|---|---|
| `director` | Hospital admin | Provider management, rotation config, reassignment, org settings, incident review |
| `er_director` | ER admin | Manages ER physicians; oversees ER-side flow (superset of `er_doctor`) |
| `er_doctor` | ER physician | Patient intake, AI extraction, create assignments |
| `hospitalist` | Receiving provider | Census, accept/decline assignments, messaging, on-shift toggle |
| `developer` | Platform operator | Cross-tenant administration, impersonation, CMS, diagnostics |

## Core capabilities

- Authentication + multi-factor auth (TOTP, SMS OTP, backup codes); session lifecycle.
- Role-based access control and strict per-organization tenant isolation.
- Provider rotation profiles, capacity (census/cap), working status, directory, on-call schedule.
- AI-assisted patient intake (structured fields from a free-text note).
- Round-robin **and** manual assignment, with expiry-driven automatic re-routing.
- Secure messaging (direct/group/emergency) with delivery/read receipts and typing.
- Realtime WebSocket presence and event fan-out (org-scoped).
- Notification cascade: in-app (WebSocket) → push (FCM) → SMS (Twilio).
- Emergency broadcasts with per-recipient acknowledgement.
- Resources & scheduling (departments, beds, equipment, Amion sync).
- Developer console (cross-tenant admin, impersonation, AI diagnostics) + CMS for public pages.
- Comprehensive audit + PHI access logging + security incident tracking.
- Runtime configurability: in-app tweaks, feature flags, and adaptive (suggested) defaults.

## Scope

This package specifies the **complete system**. It is sequenced into milestones in
`14_BUILD_PLAN.md` so it can be built and verified incrementally, but the documentation describes
the whole target — there is no separate "phase 2" specification to chase later.

**In every milestone:** org-scoping on every query; server-authoritative state; integrations
behind interfaces with local stubs; deterministic tests with no secrets.

## Glossary

- **Organization (tenant):** one hospital; the isolation boundary for all data.
- **Census / cap:** a provider's current patient count and their maximum.
- **Rotation cursor:** persisted index that keeps round-robin selection fair over time.
- **Cap relief:** when no provider is eligible, every working provider's cap is raised by 1 so the queue can drain.
- **Assignment:** one routing request with a lifecycle (`pending → accepted/rejected/expired/cancelled`).
- **PHI:** Protected Health Information; in DocTurn, patients are referenced by **initials only**.
- **Stub vs live:** every external integration has a local stub (default, no secrets) and a live implementation (production, env-gated).
