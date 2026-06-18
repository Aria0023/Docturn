# 02 — Data Model

PostgreSQL via Drizzle ORM. The schema in `shared/schema.ts` is the single source of truth; the
storage layer matches it, and Zod insert schemas are derived from it for both server validation and
client forms.

## Conventions

- Integer autoincrement `id` PK on every table.
- Timestamps via Drizzle `timestamp` columns (`created_at`, `resolved_at`, …).
- Enums are `text({ enum: [...] })` columns.
- Almost every table carries `organization_id` → `organizations.id`. **Every storage query filters by it.**
- For each insertable table export `insertXSchema = createInsertSchema(x).omit({ id, createdAt })`
  and the inferred `X` / `InsertX` types.

## Enums

```ts
export const ROLES = ['director','er_director','er_doctor','hospitalist','developer'] as const;
export const ASSIGNMENT_STATUS = ['pending','accepted','rejected','expired','cancelled'] as const;
export const ASSIGNMENT_VIA = ['round_robin','manual'] as const;
export const PATIENT_STATUS = ['waiting','assigned','admitted','discharged'] as const;
export const CONVERSATION_TYPE = ['direct','group','emergency'] as const;
export const SHIFT_TYPE = ['day','night','swing'] as const;
export const RISK_LEVEL = ['low','medium','high'] as const;
export const SETTING_SCOPE = ['org','user'] as const;
```
> `er_doctor` is canonical (not `er_physician`).

## Core tables

### organizations — tenant root
| column | type | notes |
|---|---|---|
| id | int pk | |
| name | text | "Mercy General Hospital" |
| code | text unique | short login code, e.g. `MERCY` |
| timezone | text | IANA, default `America/New_York` |
| assignment_timeout_min | int | default 10 — round-robin expiry window |
| round_robin_shift_types | text (json) | default `["day","night"]` |
| rotation_index | int | persisted round-robin cursor, default 0 |

### users — all accounts, every role
| column | type | notes |
|---|---|---|
| id | int pk | |
| organization_id | int fk | |
| username | text | unique within org |
| password_hash | text | scrypt/bcrypt(12) with per-user salt |
| role | text enum ROLES | |
| display_name | text | "Dr. Jordan Chen" |
| phone | text | for SMS MFA (nullable) |
| two_factor_enabled | int (bool) | default false |
| created_at | timestamp | |

### hospitalists — provider rotation profile (also ER physicians)
| column | type | notes |
|---|---|---|
| id | int pk | |
| organization_id | int fk | |
| user_id | int fk → users | one profile per provider |
| specialty | text | "Cardiology" |
| current_patient_count | int | census, default 0 |
| patient_cap | int | default 12 |
| rotation_order | int | stable tiebreak ordering |
| working | int (bool) | on shift today |
| shift_type | text enum SHIFT_TYPE | |

### patients — PHI-bearing (initials only, never full names)
| column | type | notes |
|---|---|---|
| id | int pk | |
| organization_id | int fk | |
| initials | text | e.g. "SC" |
| room_number | text | |
| issue_summary | text | chief complaint |
| specialty | text | suggested/required specialty |
| status | text enum PATIENT_STATUS | default `waiting` |
| er_doctor_id | int fk → users | who admitted |
| assigned_hospitalist_id | int fk → hospitalists | null until accepted |
| created_at | timestamp | |

### assignments — the routing request lifecycle
| column | type | notes |
|---|---|---|
| id | int pk | |
| organization_id | int fk | |
| patient_id | int fk → patients | |
| hospitalist_id | int fk → hospitalists | current target |
| er_doctor_id | int fk → users | |
| status | text enum ASSIGNMENT_STATUS | default `pending` |
| via | text enum ASSIGNMENT_VIA | how it was routed |
| expires_at | timestamp | createdAt + org.assignment_timeout_min |
| created_at | timestamp | |
| resolved_at | timestamp | when accepted/rejected/expired/cancelled |

### conversations / messages / message_delivery_status
- **conversations:** id · organization_id · type (CONVERSATION_TYPE) · name (null for direct) · participant_ids (json int[]) · created_at.
- **messages:** id · conversation_id · sender_id → users · content · created_at · deleted_at (nullable, soft-delete).
- **message_delivery_status:** id · message_id · user_id · delivered_at · read_at (null until read).

### audit_logs — HIPAA trail
id · organization_id · user_id (actor) · action (e.g. `assignment.accept`, `auth.login`) ·
resource_type · resource_id · details (json, no PHI beyond initials) · risk_level (RISK_LEVEL) · created_at.

### sessions
Managed by `connect-pg-simple` — not hand-modeled.

## Expansion tables (grouped by subsystem)

- **Auth/Security (5):** `mfa_credentials` (TOTP secret), `mfa_backup_codes` (SHA-256, used_at),
  `sms_verification_codes`, `phi_access_logs` (user·org·resource·method·ip·ua), `security_incidents`
  (type·severity·description·linked user/org).
- **Registration (1):** `pending_registrations` (director-approval gate).
- **Mobile/Push (3):** `device_tokens` (user·token·platform), `push_notifications` (log),
  `firebase_configurations` (per-org).
- **Resources (6):** `departments`, `beds`, `equipment`, `resource_alerts`, `resource_metrics`,
  `amion_sync_state`.
- **Directory (2):** `provider_directory`, `on_call_schedules`.
- **Broadcast (2):** `emergency_broadcasts`, `broadcast_acknowledgments` (per-recipient ack).
- **CMS (2):** `landing_page_settings`, `contact_page_settings`.
- **Messaging+ (2):** `message_threads`, `sms_history` (body ≤255 chars, audit).
- **Reference (4):** `role_types` + reference/junction tables.
- **Configuration (4):** see below.

### Configuration tables
| table | columns |
|---|---|
| `org_settings` | id · organization_id · key · value (json) · type · updated_by · updated_at |
| `user_preferences` | id · organization_id · user_id · key · value (json) |
| `feature_flags` | id · organization_id · flag · enabled (bool) / variant (text) |
| `suggestions` | id · organization_id · scope (SETTING_SCOPE) · key · proposed_value (json) · evidence (text) · status (`pending`/`accepted`/`dismissed`) · created_at |

## Relations

- `organizations` 1—∞ `users`, `hospitalists`, `patients`, `assignments`, `conversations`, settings.
- `users` 1—1 `hospitalists` (optional provider profile).
- `patients` 1—∞ `assignments`; a patient's `assigned_hospitalist_id` set on accept.
- `conversations` 1—∞ `messages` 1—∞ `message_delivery_status`.

## Assignment status state machine

```
            create (ER physician)
                    │
                    ▼
               ┌─────────┐   expires_at reached    ┌─────────┐
               │ pending │ ──────────────────────► │ expired │ ── reroute → next eligible (new pending)
               └────┬────┘                         └─────────┘
        accept │    │ reject ── reroute → next eligible (new pending)
               ▼    ▼
        ┌──────────┐ ┌──────────┐
        │ accepted │ │ rejected │
        └────┬─────┘ └──────────┘
   director  │ cancel
             ▼
        ┌───────────┐
        │ cancelled │
        └───────────┘
```

- **accept** → `accepted`; set `patients.assigned_hospitalist_id`, `patients.status='assigned'`,
  `hospitalists.current_patient_count++`, stamp `resolved_at`.
- **reject / expire** → stamp `resolved_at`; rotation re-selects the next eligible provider and
  creates a **new** `pending` assignment (history preserved).
- **cancel** (director) → `cancelled`, decrement census if it had been accepted.
- **Census changes only on accept (++) and cancel-of-accepted (−−).**
