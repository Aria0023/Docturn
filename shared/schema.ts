import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { MODULE_IDS } from "./modules.js";

/* ────────────────────────────────────────────────────────────────────────────
 * Enums (text columns with a fixed value set). `er_doctor` is canonical.
 * ──────────────────────────────────────────────────────────────────────────── */

export const ROLES = [
  "director",
  "er_director",
  "er_doctor",
  "hospitalist",
  "developer",
] as const;
export type Role = (typeof ROLES)[number];

export const ASSIGNMENT_STATUS = [
  "pending",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUS)[number];

export const ASSIGNMENT_VIA = ["round_robin", "manual"] as const;
export const PATIENT_STATUS = [
  "waiting",
  "assigned",
  "admitted",
  "discharged",
] as const;
export const CONVERSATION_TYPE = ["direct", "group", "emergency"] as const;
export const SHIFT_TYPE = ["day", "night", "swing"] as const;
export const RISK_LEVEL = ["low", "medium", "high"] as const;
export const SETTING_SCOPE = ["org", "user"] as const;
export const CREDENTIAL = ["MD", "DO", "NP", "PA", "RN"] as const;
export const CONSULT_STATUS = ["requested", "accepted", "declined", "active", "closed"] as const;
export const BROADCAST_SEVERITY = ["info", "urgent", "critical"] as const;
/**
 * The roles a broadcast can be addressed to (FR-6.5). A broadcast with no
 * audience (null) goes to everyone in the org; otherwise only to the org's
 * active accounts holding one of these roles when it is sent.
 */
export const BROADCAST_AUDIENCE = ["hospitalist", "er_doctor", "er_director", "director"] as const;
export type BroadcastAudienceRole = (typeof BROADCAST_AUDIENCE)[number];
export const REGISTRATION_STATUS = ["pending", "approved", "rejected"] as const;

/* Billing (docs/BILLING.md). Kept here with the other enums so shared/billing.ts
 * can re-export them without a circular import. */
export const CONTRACT_TERMS = ["monthly", "annual"] as const;
export const CONTRACT_STATUSES = ["trial", "active", "past_due", "cancelled", "expired"] as const;
export const INVOICE_STATUSES = ["draft", "issued", "paid", "void"] as const;
/** ISO 4217, upper case. A contract's currency is fixed. */
export const BILLING_CURRENCIES = ["USD", "CAD", "EUR", "GBP"] as const;

/**
 * Roles a stranger may REQUEST through the public self-registration form.
 * Privileged roles (director, er_director, developer) are never
 * self-requested: an existing director/ER director provisions them through
 * POST /api/director/hospitalists, or the platform operator through
 * /api/dev/users — both authenticated, audited, and with a one-time password.
 */
export const SELF_REGISTRABLE_ROLES = ["hospitalist", "er_doctor"] as const;
export type SelfRegistrableRole = (typeof SELF_REGISTRABLE_ROLES)[number];

/**
 * Org code of the platform/operator tenant (seeded by server/seed.ts). It holds
 * the cross-tenant root account and never accepts public self-registration.
 */
export const PLATFORM_ORG_CODE = "DOCTURN";
/** Where an org stands on a MANUAL compliance control it must attest to. */
export const ATTESTATION_STATUS = [
  "met",
  "not_met",
  "in_progress",
  "na",
] as const;
export type AttestationStatus = (typeof ATTESTATION_STATUS)[number];

/* ────────────────────────────────────────────────────────────────────────────
 * Core tables — almost every table carries organization_id (the tenant boundary).
 * ──────────────────────────────────────────────────────────────────────────── */

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  city: text("city"),
  state: text("state"),
  timezone: text("timezone").notNull().default("America/New_York"),
  assignmentTimeoutMin: integer("assignment_timeout_min").notNull().default(10),
  roundRobinShiftTypes: jsonb("round_robin_shift_types")
    .$type<string[]>()
    .notNull()
    .default(sql`'["day","night"]'::jsonb`),
  rotationMode: text("rotation_mode", { enum: ["lowest_census", "sequential"] })
    .notNull()
    .default("lowest_census"),
  rotationIndex: integer("rotation_index").notNull().default(0),
});

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    displayName: text("display_name").notNull(),
    credential: text("credential", { enum: CREDENTIAL }),
    phone: text("phone"),
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    // Set on every provisioned / admin-reset account: the one-time credential
    // must be replaced before anything but /api/user, /api/logout and
    // /api/account/password works (server/auth.ts passwordChangeGate).
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    // Workforce termination (HIPAA §164.308(a)(3)(ii)(C)): a disabled account
    // cannot sign in and its live sessions stop deserialising immediately.
    disabledAt: timestamp("disabled_at"),
    // Session generation marker. Every login stamps this value into the session
    // (server/auth.ts serializeUser); a self-service change or an administrative
    // reset moves it, so every OTHER session of the user stops deserialising and
    // its WebSocket is closed. NULL = never changed since provisioning.
    passwordChangedAt: timestamp("password_changed_at"),
    // "Sign out everywhere" (E2, module enterprise.sessionPolicy): every
    // session issued BEFORE this moment stops resolving — the same rule as
    // the platform-wide sign-out, per user. Deliberately a column on the user
    // row, not a decision recorded in `user_sessions`: it is then enforced by
    // server/auth.ts resolveSessionUser on every HTTP request and every
    // socket upgrade, on every instance, whatever the module is set to
    // afterwards. NULL = never.
    sessionsRevokedAt: timestamp("sessions_revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    usernamePerOrg: uniqueIndex("users_org_username_uniq").on(
      t.organizationId,
      t.username,
    ),
    // Usernames are case-insensitive (server/usernames.ts, A.CON-SHO-12/57):
    // one account per (org, lower(username)). Mirrored in server/db.ts, which
    // also repairs pre-existing case variants before building it.
    usernameCiPerOrg: uniqueIndex("users_org_username_ci_uniq").on(
      t.organizationId,
      sql`lower(${t.username})`,
    ),
  }),
);

export const hospitalists = pgTable("hospitalists", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  specialty: text("specialty").notNull().default("General"),
  currentPatientCount: integer("current_patient_count").notNull().default(0),
  patientCap: integer("patient_cap").notNull().default(12),
  rotationOrder: integer("rotation_order").notNull().default(0),
  working: boolean("working").notNull().default(false),
  shiftType: text("shift_type", { enum: SHIFT_TYPE }).notNull().default("day"),
  // Director's "Rotation / Off" switch: an on-shift provider can be taken out
  // of round-robin (never previewed, picked or cap-relieved) while staying on
  // shift for manual assignment and on-call (services/rotation.ts routablePool).
  inRotation: boolean("in_rotation").notNull().default(true),
});

export const patients = pgTable("patients", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  initials: text("initials").notNull(),
  roomNumber: text("room_number"),
  issueSummary: text("issue_summary").notNull().default(""),
  specialty: text("specialty"),
  department: text("department"),
  // ESI triage level 1–5 (1 = resuscitation, 5 = non-urgent); null = unset.
  acuity: integer("acuity"),
  status: text("status", { enum: PATIENT_STATUS }).notNull().default("waiting"),
  erDoctorId: integer("er_doctor_id").references(() => users.id),
  assignedHospitalistId: integer("assigned_hospitalist_id").references(
    () => hospitalists.id,
  ),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // EHR identifier (MRN / CSN) for "Open in EHR" deep links. PHI: resolved
  // server-side only (GET /api/patients/:id/ehr-link) and never included in
  // push, SMS or WebSocket payloads.
  ehrId: text("ehr_id"),
});

export const assignments = pgTable("assignments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  patientId: integer("patient_id")
    .notNull()
    .references(() => patients.id),
  hospitalistId: integer("hospitalist_id")
    .notNull()
    .references(() => hospitalists.id),
  erDoctorId: integer("er_doctor_id").references(() => users.id),
  status: text("status", { enum: ASSIGNMENT_STATUS })
    .notNull()
    .default("pending"),
  via: text("via", { enum: ASSIGNMENT_VIA }).notNull().default("round_robin"),
  acceptedByUserId: integer("accepted_by_user_id").references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

/**
 * Admissions ledger: ONE row per patient the first time it is routed to a
 * hospitalist (storage.createAssignment inserts it; a re-route, decline or
 * hand-off is the same admission). It is what "Admissions since last reset"
 * and "Last 24 hours" count, so the counter does not drop when Clear 24h+ /
 * Clear all / Remove admission or the hourly auto-clean sweep deletes the
 * patient and its assignments (A.CON schedule #6). PHI-free on purpose — ids,
 * the route and the time only, no initials, room or complaint — so keeping it
 * after the patient is gone keeps no patient data. patient_id is a plain
 * number (no FK): the patient row may be purged. Removed with the tenant.
 */
export const admissionEvents = pgTable(
  "admission_events",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    patientId: integer("patient_id").notNull(),
    via: text("via", { enum: ASSIGNMENT_VIA }).notNull(),
    firstRoutedAt: timestamp("first_routed_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    patient: uniqueIndex("admission_events_patient_uniq").on(t.patientId),
    orgRouted: index("admission_events_org_routed_idx").on(t.organizationId, t.firstRoutedAt),
  }),
);
export type AdmissionEvent = typeof admissionEvents.$inferSelect;

/* ── Messaging ─────────────────────────────────────────────────────────────── */

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  type: text("type", { enum: CONVERSATION_TYPE }).notNull().default("direct"),
  name: text("name"),
  participantIds: jsonb("participant_ids").$type<number[]>().notNull(),
  // Patient-linked thread: the care-team conversation for one patient.
  patientId: integer("patient_id").references(() => patients.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  senderId: integer("sender_id")
    .notNull()
    .references(() => users.id),
  content: text("content").notNull(),
  // routine | urgent | stat — STAT messages demand an explicit acknowledgement
  // (see messageDeliveryStatus.acknowledgedAt), mirroring clinical-comms tools.
  priority: text("priority").notNull().default("routine"),
  // Provenance of a forwarded message: where it came from and who wrote it.
  // NULL for an original message. Ids + a display name + a timestamp only.
  forwardedFrom: jsonb("forwarded_from").$type<ForwardedFrom | null>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, (t) => ({
  // Thread pages are keyset-paginated by id (A.CON-SHO-65); mirrored in server/db.ts.
  conversationPage: index("messages_conversation_id_idx").on(t.conversationId, t.id),
}));

/** Provenance stamped on a forwarded message (see messages.forwardedFrom). */
export interface ForwardedFrom {
  messageId: number;
  senderId: number;
  senderName: string;
  conversationId: number;
  sentAt: string;
}

export const messageDeliveryStatus = pgTable("message_delivery_status", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id")
    .notNull()
    .references(() => messages.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  deliveredAt: timestamp("delivered_at"),
  readAt: timestamp("read_at"),
  // Explicit acknowledgement (distinct from read) — required for STAT messages.
  acknowledgedAt: timestamp("acknowledged_at"),
  // Escalation bookkeeping for unacknowledged STATs (set by the sweep so each
  // step fires exactly once): re-alert nudge, then covering-provider escalation.
  realertedAt: timestamp("realerted_at"),
  escalatedAt: timestamp("escalated_at"),
}, (t) => ({
  // Receipts / unread counts are read per message; mirrored in server/db.ts.
  byMessage: index("message_delivery_status_message_idx").on(t.messageId),
}));

// Message attachments (images + files). SYNTHETIC-DATA PILOT ONLY: bytes live
// inline as base64 in `dataBase64`. Production PHI needs encrypted object storage
// (S3/GCS behind a BAA), AV scanning, and signed-URL fetch — not this inline store.
export const messageAttachments = pgTable("message_attachments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  // NULL until the attachment is linked to a message at send time.
  messageId: integer("message_id").references(() => messages.id),
  uploaderId: integer("uploader_id")
    .notNull()
    .references(() => users.id),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  dataBase64: text("data_base64").notNull(),
  // Playback length for audio (voice-message) attachments; NULL for images/docs.
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Canned messages for the composer. ownerUserId NULL = org-wide template
// (directors/developers manage those); otherwise a personal template.
export const messageTemplates = pgTable("message_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  priority: text("priority").notNull().default("routine"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ── Audit, PHI access & security ──────────────────────────────────────────── */

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  userId: integer("user_id").references(() => users.id),
  // The REAL operator when `user_id` is a borrowed identity: a developer who
  // entered an impersonated / managed-org session (server/audit.ts merges it
  // from the request context). NULL for an ordinary session. No FK on purpose:
  // the attribution must outlive the operator account and never block a
  // tenant or user delete.
  impersonatorUserId: integer("impersonator_user_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceId: integer("resource_id"),
  details: jsonb("details").$type<Record<string, unknown>>(),
  riskLevel: text("risk_level", { enum: RISK_LEVEL }).notNull().default("low"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const phiAccessLogs = pgTable("phi_access_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  userId: integer("user_id").references(() => users.id),
  resource: text("resource").notNull(),
  // WHICH record was read. `resource` alone ("conversation-messages") cannot
  // answer §164.528 accounting-of-disclosures or scope a breach; these two ids
  // can. No FK on purpose: the row must outlive the record it refers to (and a
  // tenant deletion), and it must never carry clinical content — ids only.
  resourceId: integer("resource_id"),
  patientId: integer("patient_id"),
  // WHO was really at the keyboard when `user_id` is an impersonated identity
  // (§164.528 names the person, not the borrowed login). NULL otherwise; no FK.
  impersonatorUserId: integer("impersonator_user_id"),
  method: text("method").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Six-year compliance archive (§164.316(b)(2)(i)). Audit / PHI-access / security
 * rows are FK-bound to organizations + users, so deleting a tenant would delete
 * exactly the records the rule says must be retained. Before a tenant cascade
 * we copy them here, denormalized to TEXT (org code/name, username, display
 * name) and with NO foreign keys, so the record survives its tenant intact and
 * still answers "who did this, to what, when". Ids/actions only — never PHI.
 */
export const retainedComplianceRecords = pgTable(
  "retained_compliance_records",
  {
    id: serial("id").primaryKey(),
    sourceTable: text("source_table").notNull(),
    sourceId: integer("source_id").notNull(),
    organizationId: integer("organization_id"),
    organizationCode: text("organization_code"),
    organizationName: text("organization_name"),
    userId: integer("user_id"),
    userUsername: text("user_username"),
    userDisplayName: text("user_display_name"),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: integer("resource_id"),
    patientId: integer("patient_id"),
    method: text("method"),
    ip: text("ip"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    riskLevel: text("risk_level").notNull().default("low"),
    occurredAt: timestamp("occurred_at").notNull(),
    archivedAt: timestamp("archived_at").notNull().defaultNow(),
    archivedReason: text("archived_reason").notNull().default("organization_deleted"),
  },
);

export const securityIncidents = pgTable("security_incidents", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  userId: integer("user_id").references(() => users.id),
  type: text("type").notNull(),
  severity: text("severity", { enum: RISK_LEVEL }).notNull().default("medium"),
  description: text("description").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ── Configuration (C1–C3) ─────────────────────────────────────────────────── */

export const orgSettings = pgTable(
  "org_settings",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>(),
    type: text("type"),
    updatedBy: integer("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    keyPerOrg: uniqueIndex("org_settings_org_key_uniq").on(
      t.organizationId,
      t.key,
    ),
  }),
);

/**
 * A hospital's OWN credentials for an organization-scope integration (Amion
 * OCS feed, Epic backend app) — see server/integrations/. Write-only from the
 * API: the secret fields are one AES-256-GCM ciphertext (key from the
 * INTEGRATION_KEY env, AAD = org + integration + key version, so a row cannot
 * be replayed under another tenant). `summary` holds NON-secret display fields
 * only (e.g. the FHIR host). `updated_by` deliberately has no foreign key so a
 * credential row never blocks deleting a user or a tenant; the tenant cascade
 * (storage.deleteOrganization) removes the org's rows. Mirrored in
 * server/db.ts SCHEMA_SQL.
 */
export const orgIntegrationCredentials = pgTable(
  "org_integration_credentials",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    integrationId: text("integration_id").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    summary: jsonb("summary").$type<Record<string, string>>(),
    updatedBy: integer("updated_by"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    perOrg: uniqueIndex("org_integration_credentials_org_integration_uniq").on(
      t.organizationId,
      t.integrationId,
    ),
  }),
);

export const userPreferences = pgTable(
  "user_preferences",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>(),
  },
  (t) => ({
    keyPerUser: uniqueIndex("user_prefs_user_key_uniq").on(t.userId, t.key),
  }),
);

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    flag: text("flag").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    variant: text("variant"),
  },
  (t) => ({
    flagPerOrg: uniqueIndex("feature_flags_org_flag_uniq").on(
      t.organizationId,
      t.flag,
    ),
  }),
);

export const suggestions = pgTable("suggestions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  scope: text("scope", { enum: SETTING_SCOPE }).notNull().default("org"),
  key: text("key").notNull(),
  proposedValue: jsonb("proposed_value").$type<unknown>(),
  evidence: text("evidence"),
  status: text("status", { enum: ["pending", "accepted", "dismissed"] })
    .notNull()
    .default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ── MFA (M9) ──────────────────────────────────────────────────────────────── */

export const mfaCredentials = pgTable("mfa_credentials", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  secret: text("secret").notNull(),
  activated: boolean("activated").notNull().default(false),
  // Re-enrolment in progress: the NEW secret waits here until its first code
  // verifies, so the live `secret` keeps protecting sign-in meanwhile.
  pendingSecret: text("pending_secret"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const mfaBackupCodes = pgTable("mfa_backup_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  codeHash: text("code_hash").notNull(),
  usedAt: timestamp("used_at"),
});

/* ── v2: care teams & patient board ────────────────────────────────────────── */

export const careTeamMembers = pgTable(
  "care_team_members",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    ownerUserId: integer("owner_user_id")
      .notNull()
      .references(() => users.id),
    memberUserId: integer("member_user_id")
      .notNull()
      .references(() => users.id),
    onCall: boolean("on_call").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    link: uniqueIndex("care_team_owner_member_uniq").on(
      t.ownerUserId,
      t.memberUserId,
    ),
  }),
);

export const patientConsults = pgTable("patient_consults", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  patientId: integer("patient_id")
    .notNull()
    .references(() => patients.id),
  specialty: text("specialty").notNull(),
  consultantUserId: integer("consultant_user_id").references(() => users.id),
  consultantName: text("consultant_name"),
  status: text("status", { enum: CONSULT_STATUS })
    .notNull()
    .default("requested"),
  respondedAt: timestamp("responded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ── M11: registration & developer tooling ─────────────────────────────────── */

export const pendingRegistrations = pgTable("pending_registrations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  requestedRole: text("requested_role", { enum: ROLES })
    .notNull()
    .default("hospitalist"),
  status: text("status", { enum: REGISTRATION_STATUS })
    .notNull()
    .default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Self-registration requests that name an unknown org code or the platform org
 * (server/auth.ts POST /api/register). They are dropped — never queued — but
 * answered exactly like a real org's, so the endpoint is not an org-code
 * oracle. Only an opaque SHA-256 key of (upper-cased org code, username) is
 * kept, so a re-submission answers 409 request_pending like a real org's would.
 */
export const unroutedRegistrations = pgTable("unrouted_registrations", {
  id: serial("id").primaryKey(),
  requestKey: text("request_key").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const landingPageSettings = pgTable("landing_page_settings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  heroTitle: text("hero_title").notNull().default("DocTurn"),
  heroSubtitle: text("hero_subtitle").notNull().default(""),
  body: jsonb("body").$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const contactPageSettings = pgTable("contact_page_settings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  body: jsonb("body").$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* ── M12: resources, scheduling & broadcasts ───────────────────────────────── */

export const departments = pgTable("departments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  bedCapacity: integer("bed_capacity").notNull().default(0),
});

export const beds = pgTable("beds", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  departmentId: integer("department_id").references(() => departments.id),
  label: text("label").notNull(),
  occupied: boolean("occupied").notNull().default(false),
});

export const equipment = pgTable("equipment", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  status: text("status", { enum: ["available", "in_use", "maintenance"] })
    .notNull()
    .default("available"),
});

export const emergencyBroadcasts = pgTable("emergency_broadcasts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  senderId: integer("sender_id")
    .notNull()
    .references(() => users.id),
  message: text("message").notNull(),
  severity: text("severity", { enum: BROADCAST_SEVERITY })
    .notNull()
    .default("urgent"),
  // Who it was addressed to: null = everyone in the org, else the roles
  // (BROADCAST_AUDIENCE) it was sent to.
  audience: jsonb("audience").$type<BroadcastAudienceRole[] | null>(),
  // The recipient set, frozen when it was sent (user ids). The ack tally's
  // denominator and who may acknowledge it. NULL on rows sent before it was
  // stored: those derive it from the roster at send time (broadcasts.ts).
  recipientIds: jsonb("recipient_ids").$type<number[] | null>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const broadcastAcknowledgments = pgTable("broadcast_acknowledgments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  broadcastId: integer("broadcast_id")
    .notNull()
    .references(() => emergencyBroadcasts.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at").notNull().defaultNow(),
});

/* ── M13: mobile / push ────────────────────────────────────────────────────── */

export const deviceTokens = pgTable(
  "device_tokens",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    token: text("token").notNull(),
    platform: text("platform", { enum: ["ios", "android", "web", "webpush", "expo"] })
      .notNull()
      .default("ios"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    tokenUniq: uniqueIndex("device_tokens_token_uniq").on(t.token),
  }),
);

export const smsHistory = pgTable("sms_history", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  userId: integer("user_id").references(() => users.id),
  toPhone: text("to_phone").notNull(),
  body: text("body").notNull(),
  carrier: text("carrier").notNull().default("console"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ── Continuous compliance monitoring ──────────────────────────────────────── */

/**
 * An organization's attestation for ONE control in the compliance catalog
 * (`server/compliance/controls.ts`). Only the controls code CANNOT verify —
 * BAAs, risk analysis, training, drills — are attested here; the automated
 * controls are recomputed from live system state on every read and are never
 * stored. One row per (organization, control).
 */
export const complianceAttestations = pgTable(
  "compliance_attestations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    controlId: text("control_id").notNull(),
    status: text("status", { enum: ATTESTATION_STATUS })
      .notNull()
      .default("not_met"),
    owner: text("owner"),
    note: text("note"),
    evidenceUrl: text("evidence_url"),
    attestedAt: timestamp("attested_at"),
    reviewDue: timestamp("review_due"),
    updatedBy: integer("updated_by").references(() => users.id),
  },
  (t) => ({
    controlPerOrg: uniqueIndex("compliance_attestations_org_control_uniq").on(
      t.organizationId,
      t.controlId,
    ),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * PerfectServe-parity tables (docs/PERFECTSERVE_PARITY_BLUEPRINT.md). Every
 * row is per-organization AND per-user, same-org validated on write, and
 * cascaded by the tenant delete (server/storage.ts deleteOrganization) and the
 * user delete. Mirrored as idempotent DDL in server/db.ts SCHEMA_SQL.
 * ──────────────────────────────────────────────────────────────────────────── */

export const FAVORITE_TARGET_KINDS = ["user", "role"] as const;
export type FavoriteTargetKind = (typeof FAVORITE_TARGET_KINDS)[number];

/**
 * Directory favorites (module directory.favorites): a person (target_id = the
 * in-org user id, as text) or an on-call role (target_id = the role key
 * resolveOnCallTargets serves). No FK on target_id: a role is not a row, and a
 * favorited user who is deleted is removed by deleteUser.
 */
export const directoryFavorites = pgTable(
  "directory_favorites",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    targetKind: text("target_kind", { enum: FAVORITE_TARGET_KINDS }).notNull(),
    targetId: text("target_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    favoriteUniq: uniqueIndex("directory_favorites_uniq").on(
      t.organizationId,
      t.userId,
      t.targetKind,
      t.targetId,
    ),
  }),
);

/**
 * Per-user "Done" state of a conversation (module messaging.done). A thread is
 * done for that user while its newest live message id is <= through_message_id
 * (the newest message when it was marked; NULL = it had none) — a new message
 * re-opens it without any write, and no clock is compared.
 */
export const conversationDone = pgTable(
  "conversation_done",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id),
    doneAt: timestamp("done_at").notNull().defaultNow(),
    throughMessageId: integer("through_message_id"),
  },
  (t) => ({
    donePerUser: uniqueIndex("conversation_done_user_convo_uniq").on(
      t.userId,
      t.conversationId,
    ),
  }),
);

/** Unread-message reminder opt-in (module messaging.unreadReminder). Off by default. */
export const REMINDER_INTERVALS_MIN = [5, 10, 15, 30] as const;
export const userReminderPrefs = pgTable(
  "user_reminder_prefs",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    enabled: boolean("enabled").notNull().default(false),
    intervalMin: integer("interval_min").notNull().default(10),
    /** When the sweep last reminded this user (null: never). */
    lastRemindedAt: timestamp("last_reminded_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    reminderPerUser: uniqueIndex("user_reminder_prefs_user_uniq").on(t.userId),
  }),
);

/** The in-app alert tones (generated by WebAudio in the client — no audio files). */
export const ALERT_SOUNDS = ["siren", "alarm", "chime", "ping", "soft", "none"] as const;
export type AlertSound = (typeof ALERT_SOUNDS)[number];
/** What each priority plays while the user has not chosen (a NULL column). */
export const ALERT_SOUND_DEFAULTS = { stat: "siren", urgent: "alarm", routine: "ping" } as const;

/**
 * In-app alert sound per priority (module messaging.alertSounds). NULL = the
 * built-in default tone for that priority. Played by the open app only.
 */
export const userSoundPrefs = pgTable(
  "user_sound_prefs",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    statSound: text("stat_sound"),
    urgentSound: text("urgent_sound"),
    routineSound: text("routine_sound"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    soundPerUser: uniqueIndex("user_sound_prefs_user_uniq").on(t.userId),
  }),
);

/**
 * PIN unlock (module security.pin, default off): a scrypt hash (the password
 * hasher) that re-opens an authenticated, LOCKED session — never a sign-in.
 */
export const userPins = pgTable(
  "user_pins",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    pinHash: text("pin_hash").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    pinPerUser: uniqueIndex("user_pins_user_uniq").on(t.userId),
  }),
);

/**
 * Wrong-PIN counter, one row per (user, SESSION) — the session is identified
 * by a SHA-256 of its id (or of a demo bearer token's connection id), never
 * the id itself. Per session by construction: one session's failures never
 * reset or spend another's. At PIN_MAX_FAILURES the PIN is disabled for that
 * session (disabled_at) and only the password re-opens it.
 */
export const pinUnlockFailures = pgTable(
  "pin_unlock_failures",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    sessionHash: text("session_hash").notNull(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    disabledAt: timestamp("disabled_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    pinFailurePerSession: uniqueIndex("pin_unlock_failures_session_uniq").on(t.userId, t.sessionHash),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * Enterprise readiness (docs/ENTERPRISE_READINESS.md). Every table here is
 * mirrored in server/db.ts SCHEMA_SQL. The per-org ones are cascaded by the
 * tenant delete (storage.deleteOrganization); the per-user one by the user
 * delete as well. `updated_by` / `created_by` deliberately carry NO foreign
 * key (the org_integration_credentials pattern) so a row never blocks a
 * user or tenant delete.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Background-job leases (E1 multi-instance safety). One row per job name;
 * an instance runs a tick only after claiming the row
 * (`UPDATE … WHERE lease_until <= NOW()`), so N instances never run the same
 * tick twice and a crashed holder's lease is reclaimed once it lapses.
 * Not tenant data — no organization column.
 */
export const jobLeases = pgTable("job_leases", {
  name: text("name").primaryKey(),
  /** The instance id holding the lease (server/instance.ts), never a secret. */
  holder: text("holder").notNull(),
  leaseUntil: timestamp("lease_until").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * The non-secret half of an SSO connection (sso_connections.role_mapping).
 * `map` is an IdP group / claim VALUE → DocTurn role; `defaultRole` is what
 * someone no mapping matches gets (null = the sign-in is refused, which is
 * how a hospital keeps DocTurn to a named group).
 */
export interface SsoConnectionConfig {
  claim: string;
  defaultRole: string | null;
  map: Record<string, string>;
  scopes: string;
  acrMfaValue: string | null;
}

/**
 * Per-org OIDC single sign-on connection (module enterprise.sso). The client
 * secret (and anything else secret) is ONE AES-256-GCM ciphertext under
 * INTEGRATION_KEY (server/integrations/crypto.ts; AAD binds it to the org).
 * `issuer`, `client_id` and `role_mapping` are non-secret display /
 * routing fields; `sso_required` makes password sign-in refuse for the org.
 */
export const ssoConnections = pgTable(
  "sso_connections",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    issuer: text("issuer").notNull(),
    clientId: text("client_id").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    /**
     * Non-secret configuration (E2.1): which claim carries the IdP's groups,
     * which value maps to which DocTurn role, the role for everyone else, the
     * scopes to request, and the `acr` value (if any) that the hospital's IdP
     * uses to say "this sign-in was multi-factor".
     */
    roleMapping: jsonb("role_mapping").$type<SsoConnectionConfig>(),
    ssoRequired: boolean("sso_required").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    updatedBy: integer("updated_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    onePerOrg: uniqueIndex("sso_connections_org_uniq").on(t.organizationId),
  }),
);

/**
 * Per-org SCIM 2.0 bearer tokens (module enterprise.scim). Only a SHA-256 of
 * the token is stored; the token itself is shown once at creation. A revoked
 * token keeps its row (revoked_at) for the audit trail.
 */
export const scimTokens = pgTable(
  "scim_tokens",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    tokenHash: text("token_hash").notNull(),
    label: text("label").notNull(),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => ({
    hashUniq: uniqueIndex("scim_tokens_hash_uniq").on(t.tokenHash),
    byOrg: index("scim_tokens_org_idx").on(t.organizationId),
  }),
);

/**
 * Per-org session policy (module enterprise.sessionPolicy). NULL = the
 * platform default (SESSION_POLICY in server/config.ts). One row per org.
 */
export const orgSessionPolicy = pgTable(
  "org_session_policy",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    idleMinutes: integer("idle_minutes"),
    maxConcurrent: integer("max_concurrent"),
    absoluteHours: integer("absolute_hours"),
    updatedBy: integer("updated_by"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    onePerOrg: uniqueIndex("org_session_policy_org_uniq").on(t.organizationId),
  }),
);

/**
 * Live cookie sessions of one user (module enterprise.sessionPolicy). ONE row
 * per express-session id, written the first time that session makes an
 * authenticated request, so every sign-in path (password, second factor, SSO)
 * is covered without each one having to remember. Only a SHA-256 of the
 * session id is stored — the row can never be used to impersonate the
 * session it describes.
 *
 * What it is for: the maximum-concurrent-sessions rule (the oldest live
 * session is evicted, and the evicted row says WHY so the client can show
 * it) and the absolute session lifetime. "Sign out everywhere" does NOT use
 * this table — see users.sessions_revoked_at.
 */
export const userSessions = pgTable(
  "user_sessions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    /** SHA-256 of the express-session id — never the id itself. */
    sidHash: text("sid_hash").notNull(),
    /** When this session was first seen: the absolute-lifetime clock. */
    issuedAt: timestamp("issued_at").notNull().defaultNow(),
    /** Touched at most once a minute; a row older than the idle window is dead. */
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    revokedAt: timestamp("revoked_at"),
    /** Why it was ended: the reason the client is given. */
    revokedReason: text("revoked_reason"),
  },
  (t) => ({
    sidUniq: uniqueIndex("user_sessions_sid_uniq").on(t.sidHash),
    byUser: index("user_sessions_user_idx").on(t.userId),
  }),
);

/**
 * The display presets a person may choose for themselves over their
 * organization's branding (module platform.userThemes). The ORGANIZATION keeps
 * appName / accent / radius / sidebar / contentWidth and its own `palette`
 * (classic | calm | warm) — "org" means "follow whatever my organization
 * chose", and is the default for everyone.
 *   classic / calm / warm — the three light canvases, picked for yourself
 *   night                 — a true dark canvas
 *   contrast              — high contrast (AA+ on every pair)
 */
export const THEME_PRESETS = ["org", "classic", "calm", "warm", "night", "contrast"] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];
/** Root text size. `large` scales the whole app up; it is not a font swap. */
export const THEME_TEXT_SIZES = ["default", "large"] as const;
export type ThemeTextSize = (typeof THEME_TEXT_SIZES)[number];
/**
 * The presets that can follow the device's `prefers-color-scheme`: only the
 * two with a light AND a dark reading ("org" → the org palette by day, night
 * by night; "night" → night only while the device is dark). Choosing warm or
 * high contrast is a deliberate choice the device must not override.
 */
export const THEME_FOLLOW_DEVICE_PRESETS = ["org", "night"] as const;
/** What a user sees while they have made no choice (a missing or NULL row). */
export const USER_THEME_DEFAULTS = { preset: "org", textSize: "default", followDevice: false } as const;

/**
 * Per-user display preferences over the org's branding (module
 * platform.userThemes): preset (org / classic / calm / warm / night /
 * contrast), text size (default / large) and whether it follows the device.
 * Not PHI; cleared with the user.
 */
export const userThemePrefs = pgTable(
  "user_theme_prefs",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    preset: text("preset"),
    textSize: text("text_size"),
    followDevice: boolean("follow_device").notNull().default(false),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    onePerUser: uniqueIndex("user_theme_prefs_user_uniq").on(t.userId),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * Billing (docs/BILLING.md). DocTurn the PLATFORM operator bills each tenant
 * hospital. Money is INTEGER CENTS; never a float. No PHI ever reaches these
 * tables: a seat count, a hospital's billing contact and a PO number are the
 * most personal things here.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * One day's billable-seat count for one organization, written by the
 * `seat-snapshot` job lease. `snapshot_date` is the calendar day in the
 * ORGANIZATION's own timezone (organizations.timezone), because that is the
 * day a hospital argues about: an invoice line cites these dates, so
 * "you charged me for 47 seats on 3 March" can be answered from the row.
 */
export const seatSnapshots = pgTable(
  "seat_snapshots",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    /** YYYY-MM-DD in the org's timezone. */
    snapshotDate: text("snapshot_date").notNull(),
    seatCount: integer("seat_count").notNull(),
    /** role → count. Never a name. */
    breakdown: jsonb("breakdown").$type<Record<string, number>>().notNull(),
    /** The timezone the date was computed in, recorded so a later change is visible. */
    timezone: text("timezone").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    onePerOrgDay: uniqueIndex("seat_snapshots_org_date_uniq").on(t.organizationId, t.snapshotDate),
    byOrg: index("seat_snapshots_org_idx").on(t.organizationId),
  }),
);

/**
 * A plan the DocTurn OPERATOR sells: a code, a name, the module ids the plan
 * GRANTS, and a per-seat price in integer cents with a fixed currency.
 * Nothing is seeded — a price nobody typed would be demo data shown as real.
 * A plan only ever grants: it never switches an organization's module off.
 */
export const billingPlans = pgTable(
  "billing_plans",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Module ids from shared/modules.ts that this plan includes. */
    moduleIds: jsonb("module_ids").$type<string[]>().notNull(),
    perSeatPriceCents: integer("per_seat_price_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    /** Listed on the public website's pricing section (/home). Off by default. */
    showOnWebsite: boolean("show_on_website").notNull().default(false),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => ({
    codeUniq: uniqueIndex("billing_plans_code_uniq").on(t.code),
  }),
);

/**
 * ONE contract per hospital — the operator's own record of what was agreed.
 * Stripe, when it is configured at all, is only the collection rail: this row
 * is the source of truth. A trial is a plan with an END DATE, not a special
 * mode. `past_due_at` is when the clock started: the hospital's directors and
 * the operator are warned from that day, and nothing changes at all until
 * PAST_DUE_GRACE_DAYS have passed, when the only change is that a NEW SEAT is
 * refused (never messaging, never STAT, never sign-in).
 */
export const orgContracts = pgTable(
  "org_contracts",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    planId: integer("plan_id")
      .notNull()
      .references(() => billingPlans.id),
    term: text("term", { enum: ["monthly", "annual"] }).notNull(),
    /** YYYY-MM-DD. */
    startDate: text("start_date").notNull(),
    /** YYYY-MM-DD, or null for an open-ended contract. A trial has one. */
    endDate: text("end_date"),
    committedSeats: integer("committed_seats").notNull(),
    /** Overrides the plan's per-seat price for this hospital only. */
    priceOverrideCents: integer("price_override_cents"),
    poNumber: text("po_number"),
    billingContactName: text("billing_contact_name"),
    billingContactEmail: text("billing_contact_email"),
    status: text("status", {
      enum: ["trial", "active", "past_due", "cancelled", "expired"],
    })
      .notNull()
      .default("active"),
    pastDueAt: timestamp("past_due_at"),
    /** The Stripe Customer for this hospital, once Stripe is configured. */
    stripeCustomerId: text("stripe_customer_id"),
    /**
     * Stripe's `send_invoice` makes STRIPE email the hospital. Off until the
     * operator opts this contract in explicitly.
     */
    stripeSendInvoiceEmail: boolean("stripe_send_invoice_email").notNull().default(false),
    /** Net terms: Stripe's days_until_due, and the manual path's due date. */
    daysUntilDue: integer("days_until_due").notNull().default(30),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    onePerOrg: uniqueIndex("org_contracts_org_uniq").on(t.organizationId),
  }),
);


/**
 * One invoice. Generated from the contract and the seat snapshots, and it
 * CITES the snapshot dates each line counted (lines[].citedDates), so a
 * hospital can audit every number against `seat_snapshots`.
 *
 * `number` is gap-free and never reused: it is allocated from
 * `billing_counters` inside the SAME transaction as this row. An issued
 * invoice is immutable except for its status — the only correction is
 * void-and-reissue, and a void keeps its number forever.
 *
 * "Paid" has exactly two possible sources, both recorded: the operator's own
 * action (`paid_source` = 'operator', with their user id) or a Stripe webhook
 * event (`paid_source` = 'stripe', with the event id in `paid_reference`).
 * There is no third source and there are no mock invoices.
 */
export const billingInvoices = pgTable(
  "billing_invoices",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    /** The contract as it was when this invoice was generated. */
    contractId: integer("contract_id"),
    number: text("number").notNull(),
    /** Inclusive period, in the organization's own days (YYYY-MM-DD). */
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    currency: text("currency").notNull(),
    lines: jsonb("lines")
      .$type<
        Array<{
          description: string;
          quantity: number;
          unitCents: number;
          amountCents: number;
          citedDates: string[];
        }>
      >()
      .notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    status: text("status", { enum: INVOICE_STATUSES }).notNull().default("draft"),
    issuedAt: timestamp("issued_at"),
    /** Net terms applied at issue (YYYY-MM-DD). */
    dueOn: text("due_on"),
    paidAt: timestamp("paid_at"),
    /** 'operator' | 'stripe' — never anything else. */
    paidSource: text("paid_source"),
    /** The operator who marked it paid, when paid_source = 'operator'. */
    paidByUserId: integer("paid_by_user_id"),
    /** The Stripe event id, or the operator's own reference (a cheque number). */
    paidReference: text("paid_reference"),
    stripeInvoiceId: text("stripe_invoice_id"),
    voidReason: text("void_reason"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    numberUniq: uniqueIndex("billing_invoices_number_uniq").on(t.number),
    byOrg: index("billing_invoices_org_idx").on(t.organizationId),
  }),
);

/**
 * Monotonic counters. One row, `invoice`, whose value is bumped inside the
 * invoice transaction so numbers are gap-free and never reused.
 */
export const billingCounters = pgTable("billing_counters", {
  name: text("name").primaryKey(),
  value: integer("value").notNull().default(0),
});

/**
 * Invoices of a DELETED tenant. The seat history leaves with the tenant — a
 * count means nothing without it — but an invoice is a financial record of the
 * operator's own business, so it is copied here (no foreign keys,
 * denormalized) inside the delete transaction and only then removed, exactly
 * the way `retained_compliance_records` keeps the compliance trail.
 */
export const retainedInvoices = pgTable("retained_invoices", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull(),
  organizationId: integer("organization_id"),
  organizationCode: text("organization_code"),
  organizationName: text("organization_name"),
  number: text("number").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  currency: text("currency").notNull(),
  lines: jsonb("lines").$type<Record<string, unknown>[]>().notNull(),
  subtotalCents: integer("subtotal_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  status: text("status").notNull(),
  issuedAt: timestamp("issued_at"),
  dueOn: text("due_on"),
  paidAt: timestamp("paid_at"),
  paidSource: text("paid_source"),
  paidByUserId: integer("paid_by_user_id"),
  paidReference: text("paid_reference"),
  stripeInvoiceId: text("stripe_invoice_id"),
  archivedAt: timestamp("archived_at").notNull().defaultNow(),
  archivedReason: text("archived_reason").notNull().default("organization_deleted"),
});


/**
 * Every billing status transition, and every Stripe delivery.
 *
 * Two jobs in one table, on purpose:
 *   • IDEMPOTENCY. A Stripe delivery is recorded here FIRST, keyed on the
 *     Stripe EVENT ID under a unique index, before anything is applied. A
 *     redelivery of the same event is recognised and answered 200 without
 *     being applied twice — Stripe must not keep retrying a delivery we have
 *     already honoured.
 *   • HISTORY. Every status transition is appended too (`stripe_event_id`
 *     null), whoever caused it, so "when did this invoice become paid, and
 *     why" is answerable from one table.
 *
 * No PHI: ids, a type, two statuses and a small detail object.
 */
export const billingEvents = pgTable(
  "billing_events",
  {
    id: serial("id").primaryKey(),
    /** Null only for a delivery we could not attribute to a tenant. */
    organizationId: integer("organization_id"),
    invoiceId: integer("invoice_id"),
    /** The Stripe event id, or null for a transition we made ourselves. */
    stripeEventId: text("stripe_event_id"),
    type: text("type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    actorUserId: integer("actor_user_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    // A PLAIN unique index, not a partial one: Postgres treats NULLs as
    // distinct, so our own transitions (stripe_event_id NULL) never collide,
    // and `ON CONFLICT (stripe_event_id) DO NOTHING` can infer this index — a
    // partial index would make that statement fail with "no unique or
    // exclusion constraint matching the ON CONFLICT specification".
    stripeEventUniq: uniqueIndex("billing_events_stripe_event_uniq").on(t.stripeEventId),
    byOrg: index("billing_events_org_idx").on(t.organizationId),
    byInvoice: index("billing_events_invoice_idx").on(t.invoiceId),
  }),
);

/**
 * Shared rate-limit counters (E1): the Postgres-backed express-rate-limit
 * store, so N instances enforce ONE login / account / registration budget.
 * `key` = "<limiter>:<client key>"; a row is reset when its window lapses.
 * Not tenant data.
 */
export const rateLimitHits = pgTable("rate_limit_hits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start").notNull(),
  count: integer("count").notNull().default(0),
});

/* ────────────────────────────────────────────────────────────────────────────
 * Relations
 * ──────────────────────────────────────────────────────────────────────────── */

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  hospitalists: many(hospitalists),
  patients: many(patients),
  assignments: many(assignments),
}));

export const usersRelations = relations(users, ({ one }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  hospitalist: one(hospitalists, {
    fields: [users.id],
    references: [hospitalists.userId],
  }),
}));

export const hospitalistsRelations = relations(hospitalists, ({ one }) => ({
  user: one(users, {
    fields: [hospitalists.userId],
    references: [users.id],
  }),
}));

export const assignmentsRelations = relations(assignments, ({ one }) => ({
  patient: one(patients, {
    fields: [assignments.patientId],
    references: [patients.id],
  }),
  hospitalist: one(hospitalists, {
    fields: [assignments.hospitalistId],
    references: [hospitalists.id],
  }),
}));

/* ────────────────────────────────────────────────────────────────────────────
 * Zod insert schemas + inferred types
 * ──────────────────────────────────────────────────────────────────────────── */

export const insertOrganizationSchema = createInsertSchema(organizations).omit({
  id: true,
});
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});
export const insertHospitalistSchema = createInsertSchema(hospitalists).omit({
  id: true,
});
export const insertPatientSchema = createInsertSchema(patients).omit({
  id: true,
  createdAt: true,
});
export const insertAssignmentSchema = createInsertSchema(assignments).omit({
  id: true,
  createdAt: true,
});
export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});
export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
});

export type CareTeamMember = typeof careTeamMembers.$inferSelect;
export type PatientConsult = typeof patientConsults.$inferSelect;
export type PendingRegistration = typeof pendingRegistrations.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type Bed = typeof beds.$inferSelect;
export type Equipment = typeof equipment.$inferSelect;
export type EmergencyBroadcast = typeof emergencyBroadcasts.$inferSelect;
export type BroadcastAck = typeof broadcastAcknowledgments.$inferSelect;
export type DeviceToken = typeof deviceTokens.$inferSelect;
export type SmsHistory = typeof smsHistory.$inferSelect;
export type ComplianceAttestation = typeof complianceAttestations.$inferSelect;
export type DirectoryFavorite = typeof directoryFavorites.$inferSelect;
export type ConversationDone = typeof conversationDone.$inferSelect;
export type UserReminderPrefs = typeof userReminderPrefs.$inferSelect;
export type UserSoundPrefs = typeof userSoundPrefs.$inferSelect;
export type UserPin = typeof userPins.$inferSelect;
export type PinUnlockFailure = typeof pinUnlockFailures.$inferSelect;
export type JobLease = typeof jobLeases.$inferSelect;
export type SsoConnection = typeof ssoConnections.$inferSelect;
export type ScimToken = typeof scimTokens.$inferSelect;
export type OrgSessionPolicy = typeof orgSessionPolicy.$inferSelect;
export type UserSession = typeof userSessions.$inferSelect;
export type UserThemePrefs = typeof userThemePrefs.$inferSelect;
export type RateLimitHit = typeof rateLimitHits.$inferSelect;
export type SeatSnapshot = typeof seatSnapshots.$inferSelect;
export type InsertSeatSnapshot = typeof seatSnapshots.$inferInsert;
/**
 * An order request from the public website (/home). Hospitals cannot
 * click-buy: a purchase needs an order form and a signed BAA, so the website
 * files a request here and the operator converts it into a contract from the
 * developer console. Business contact details only — never patient data.
 */
export const purchaseRequests = pgTable("purchase_requests", {
  id: serial("id").primaryKey(),
  organizationName: text("organization_name").notNull(),
  contactName: text("contact_name").notNull(),
  contactTitle: text("contact_title"),
  email: text("email").notNull(),
  phone: text("phone"),
  planCode: text("plan_code"),
  seats: integer("seats").notNull(),
  term: text("term").notNull(),
  message: text("message"),
  status: text("status").notNull().default("new"),
  sourceIp: text("source_ip"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type PurchaseRequest = typeof purchaseRequests.$inferSelect;
export type InsertPurchaseRequest = typeof purchaseRequests.$inferInsert;
export const PURCHASE_TERMS = ["pilot", "annual", "multi_year"] as const;
export const PURCHASE_STATUSES = ["new", "contacted", "converted", "declined"] as const;
export const purchaseRequestCreateSchema = z.object({
  organizationName: z.string().trim().min(2).max(160),
  contactName: z.string().trim().min(2).max(120),
  contactTitle: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.string().trim().max(200).email(),
  phone: z.string().trim().max(40).regex(/^[0-9+().\s-]*$/).optional().or(z.literal("")),
  planCode: z.string().trim().max(60).optional().or(z.literal("")),
  seats: z.number().int().min(1).max(100_000),
  term: z.enum(PURCHASE_TERMS),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
  agreeTerms: z.literal(true),
  /** Honeypot: a hidden field people never fill. */
  website: z.string().max(200).optional(),
});
export const purchaseRequestPatchSchema = z.object({ status: z.enum(PURCHASE_STATUSES) });

export type BillingPlan = typeof billingPlans.$inferSelect;
export type InsertBillingPlan = typeof billingPlans.$inferInsert;
export type OrgContract = typeof orgContracts.$inferSelect;
export type InsertOrgContract = typeof orgContracts.$inferInsert;
export type BillingInvoice = typeof billingInvoices.$inferSelect;
export type InsertBillingInvoice = typeof billingInvoices.$inferInsert;
export type BillingCounter = typeof billingCounters.$inferSelect;
export type RetainedInvoice = typeof retainedInvoices.$inferSelect;
export type BillingEvent = typeof billingEvents.$inferSelect;

/* ── billing request bodies (every billing route safeParses one of these) ──
 * Integer cents only — `z.number().int()` rejects 18.5 outright, so a float
 * price can never reach the database. Module ids are checked against the
 * registry, so a plan can never grant something that does not exist.
 */
const moduleIdSchema = z.string().refine((id) => MODULE_IDS.includes(id), {
  message: "unknown_module",
});
const billingDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const billingPlanCreateSchema = z.object({
  code: z.string().min(2).max(60).regex(/^[a-z0-9][a-z0-9._-]*$/, "lower-case code"),
  name: z.string().min(1).max(120),
  moduleIds: z.array(moduleIdSchema).max(MODULE_IDS.length),
  perSeatPriceCents: z.number().int().min(0).max(100_000_000),
  currency: z.enum(BILLING_CURRENCIES),
  showOnWebsite: z.boolean().optional(),
});
export const billingPlanPatchSchema = billingPlanCreateSchema.partial().extend({
  archived: z.boolean().optional(),
});

export const orgContractPutSchema = z
  .object({
    planId: z.number().int().positive(),
    term: z.enum(CONTRACT_TERMS),
    startDate: billingDaySchema,
    endDate: billingDaySchema.nullable().optional(),
    committedSeats: z.number().int().min(0).max(1_000_000),
    priceOverrideCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
    poNumber: z.string().max(80).nullable().optional(),
    billingContactName: z.string().max(120).nullable().optional(),
    billingContactEmail: z.string().email().max(200).nullable().optional(),
    status: z.enum(CONTRACT_STATUSES),
    daysUntilDue: z.number().int().min(0).max(180).optional(),
    stripeSendInvoiceEmail: z.boolean().optional(),
  })
  .refine((c) => !c.endDate || c.endDate >= c.startDate, {
    message: "endDate must not precede startDate",
    path: ["endDate"],
  });

export const invoiceGenerateSchema = z
  .object({
    orgId: z.number().int().positive(),
    periodStart: billingDaySchema,
    periodEnd: billingDaySchema,
  })
  .refine((v) => v.periodEnd >= v.periodStart, { message: "periodEnd must not precede periodStart", path: ["periodEnd"] });

export const invoiceVoidSchema = z.object({ reason: z.string().min(3).max(300) });
export const invoicePaidSchema = z.object({ reference: z.string().max(200).nullable().optional() });

/** What a DIRECTOR may change on their own contract: the billing contact. */
export const billingContactPatchSchema = z.object({
  billingContactName: z.string().max(120).nullable().optional(),
  billingContactEmail: z.string().email().max(200).nullable().optional(),
});

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Hospitalist = typeof hospitalists.$inferSelect;
export type InsertHospitalist = z.infer<typeof insertHospitalistSchema>;
export type Patient = typeof patients.$inferSelect;
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Assignment = typeof assignments.$inferSelect;
export type InsertAssignment = z.infer<typeof insertAssignmentSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type MessageDeliveryStatus = typeof messageDeliveryStatus.$inferSelect;
export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type InsertMessageAttachment = typeof messageAttachments.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type PhiAccessLog = typeof phiAccessLogs.$inferSelect;
export type RetainedComplianceRecord =
  typeof retainedComplianceRecords.$inferSelect;
export type OrgSetting = typeof orgSettings.$inferSelect;
export type OrgIntegrationCredential = typeof orgIntegrationCredentials.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;

/** A user object safe to return over the API — never includes the password hash. */
export type SafeUser = Pick<
  User,
  | "id"
  | "username"
  | "role"
  | "displayName"
  | "organizationId"
  | "credential"
  | "twoFactorEnabled"
  | "mustChangePassword"
> & { disabled: boolean };

export function toSafeUser(u: User): SafeUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    displayName: u.displayName,
    organizationId: u.organizationId,
    credential: u.credential,
    // Account-state flags the client needs to render truthfully: MFA badge,
    // forced password change, and deactivation. Never the hash.
    twoFactorEnabled: !!u.twoFactorEnabled,
    mustChangePassword: !!u.mustChangePassword,
    disabled: !!u.disabledAt,
  };
}

/* ── Request-body schemas shared by server validation and client forms ─────── */

/** Upper bounds on identity fields — every one is stored, hashed or shown. */
export const MAX_USERNAME_LENGTH = 64;
export const MAX_DISPLAY_NAME_LENGTH = 120;
export const MAX_PASSWORD_LENGTH = 256;
/**
 * What a NEW username may contain: letters, digits and . _ - @ + (so a work
 * e-mail address is a valid username, which is what an identity provider
 * sends). No spaces or control characters — a name two people would read as
 * the same must not be two accounts. Existing accounts are not re-validated.
 */
export const USERNAME_PATTERN = /^[A-Za-z0-9._@+-]+$/;

export const loginSchema = z.object({
  orgCode: z.string().min(1).max(64),
  username: z.string().min(1).max(MAX_USERNAME_LENGTH + 16),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

/** Minimum password length, shared by self-registration and password change. */
export const MIN_PASSWORD_LENGTH = 8;

export const registerSchema = z.object({
  orgCode: z.string().min(1).max(64),
  username: z.string().trim().min(3).max(MAX_USERNAME_LENGTH).regex(USERNAME_PATTERN),
  // Same floor as PATCH /api/account/password (server/auth.ts
  // isForbiddenPassword additionally refuses the demo password there and here).
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  displayName: z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH),
  // Self-selected role; a director / ER director approves. Only clinical,
  // non-privileged roles can be requested (SELF_REGISTRABLE_ROLES) — a
  // director / ER director / developer account is provisioned by an existing
  // administrator, never by a stranger with an org code. Defaults to hospitalist.
  requestedRole: z.enum(SELF_REGISTRABLE_ROLES).optional(),
});

export const extractNoteSchema = z.object({
  note: z.string().min(1),
});

export const createPatientSchema = z.object({
  initials: z.string().min(1).max(8),
  roomNumber: z.string().optional(),
  issueSummary: z.string().default(""),
  specialty: z.string().optional(),
  department: z.string().optional(),
  acuity: z.number().int().min(1).max(5).optional(),
  // Optional EHR identifier (MRN/CSN) — printable characters only, no spaces.
  ehrId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/).optional(),
});

export const createAssignmentSchema = z.object({
  patientId: z.number().int().positive(),
  mode: z.enum(ASSIGNMENT_VIA),
  hospitalistId: z.number().int().positive().optional(),
});

export const createConversationSchema = z.object({
  type: z.enum(CONVERSATION_TYPE).default("direct"),
  name: z.string().optional(),
  participantIds: z.array(z.number().int().positive()).min(1),
});

export const MESSAGE_PRIORITY = ["routine", "urgent", "stat"] as const;

export const sendMessageSchema = z.object({
  conversationId: z.number().int().positive(),
  // Empty allowed so a message can be attachment-only. The send route rejects a
  // message that has NEITHER text nor attachments (400 empty_message).
  content: z.string().max(20_000).default(""),
  priority: z.enum(MESSAGE_PRIORITY).default("routine"),
  attachmentIds: z.array(z.number().int().positive()).max(10).optional(),
});

// Base64 upload of a single attachment (see the attachments route's mime
// allowlist + 8 MB decoded-size cap).
export const attachmentUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  dataBase64: z.string().min(1),
  // Client-measured playback length for a voice message, in milliseconds.
  // Advisory metadata for the player chip; the server independently caps it.
  durationMs: z.number().int().positive().max(10 * 60 * 1000).optional(),
});

export const markReadSchema = z.object({
  messageIds: z.array(z.number().int().positive()).min(1),
});

// Forward one message. Exactly one target: an existing conversation the caller
// is in, a set of people (a direct/group thread is created or reused), or an
// on-call role target id from /api/messaging/on-call-targets.
export const forwardMessageSchema = z
  .object({
    conversationId: z.number().int().positive().optional(),
    participantIds: z.array(z.number().int().positive()).min(1).max(20).optional(),
    roleTarget: z.string().min(1).max(120).optional(),
    // Default routine; the forwarder may opt to keep the original priority.
    keepPriority: z.boolean().default(false),
    // Optional note prepended to the forwarded content.
    note: z.string().max(2000).optional(),
  })
  .refine(
    (v) =>
      [v.conversationId, v.participantIds, v.roleTarget].filter((x) => x != null)
        .length === 1,
    { message: "exactly one target is required" },
  );

export const createTemplateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  priority: z.enum(MESSAGE_PRIORITY).default("routine"),
  // "org" (directors/developers only) or "mine" (default).
  scope: z.enum(["org", "mine"]).default("mine"),
});
export const updateTemplateSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(2000).optional(),
    priority: z.enum(MESSAGE_PRIORITY).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to update" });

export const acknowledgeSchema = z.object({
  messageIds: z.array(z.number().int().positive()).min(1),
});

export const mfaVerifySchema = z.object({ code: z.string().min(4).max(10) });
export const completeLoginSchema = z.object({ code: z.string().min(4).max(12) });

export const addCareTeamMemberSchema = z.object({
  memberUserId: z.number().int().positive(),
});
export const toggleOnCallSchema = z.object({ onCall: z.boolean() });

export const createConsultSchema = z.object({
  specialty: z.string().min(1),
  consultantUserId: z.number().int().positive().optional(),
  // Optional explicit team to consult (the consult service's on-call + members),
  // so the requester records WHO was called by name even when a consultant has
  // no user account.
  consultants: z
    .array(z.object({ name: z.string().min(1), userId: z.number().int().positive().optional() }))
    .optional(),
});
export const updateConsultSchema = z.object({
  status: z.enum(CONSULT_STATUS).optional(),
  consultantUserId: z.number().int().positive().optional(),
});

export const censusOverrideSchema = z.object({
  currentPatientCount: z.number().int().min(0),
  reason: z.string().min(1),
});

export const createBroadcastSchema = z.object({
  message: z.string().min(1),
  severity: z.enum(BROADCAST_SEVERITY).default("urgent"),
  // "all" (or absent) = everyone in the org; otherwise the roles to send to.
  audience: z
    .union([z.literal("all"), z.array(z.enum(BROADCAST_AUDIENCE)).min(1).max(BROADCAST_AUDIENCE.length)])
    .default("all"),
});

export const devCreateUserSchema = z.object({
  organizationId: z.number().int().positive(),
  role: z.enum(ROLES),
  displayName: z.string().min(1),
  username: z.string().min(3),
  phone: z.string().optional(),
  credential: z.enum(CREDENTIAL).optional(),
  specialty: z.string().optional(),
  patientCap: z.number().int().min(1).max(50).optional(),
  shiftType: z.enum(SHIFT_TYPE).optional(),
  // When importing from a schedule (Amion/QGenda/etc.) the imported providers
  // are the active roster, so the importer marks them on-shift.
  working: z.boolean().optional(),
});

export const deviceTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android", "web", "webpush", "expo"]).default("ios"),
});

export const notificationProfileSchema = z.object({
  mode: z.enum(["push", "push_sms", "push_sms_voice"]).default("push"),
  smsCarrier: z
    .enum(["twilio", "sns", "pinpoint", "messagebird", "vonage", "console"])
    .default("console"),
  ackTimeoutSec: z.number().int().min(10).max(3600).default(90),
  escalationTimeoutSec: z.number().int().min(10).max(7200).default(180),
});
export type NotificationProfile = z.infer<typeof notificationProfileSchema>;

/**
 * Upsert one MANUAL compliance attestation. Only manual controls are attestable
 * — the route rejects an id that is not in the catalog's manual set, so an org
 * can never "attest" an automated technical control into passing.
 */
/**
 * Per-org session policy (E2, module enterprise.sessionPolicy). Every field
 * is optional and nullable: null clears it back to the platform default. The
 * BOUNDS are the server's (server/session-policy.ts SESSION_POLICY_BOUNDS) —
 * repeated here as literals only because zod needs them at the edge, and
 * tests/session-policy.test.ts compares the two.
 */
export const sessionPolicySchema = z
  .object({
    idleMinutes: z.number().int().min(5).max(480).nullable().optional(),
    maxConcurrent: z.number().int().min(1).max(20).nullable().optional(),
    absoluteHours: z.number().int().min(1).max(720).nullable().optional(),
  })
  .strict();

export const attestationUpsertSchema = z.object({
  controlId: z.string().min(1).max(64),
  status: z.enum(ATTESTATION_STATUS),
  owner: z.string().max(120).optional(),
  note: z.string().max(4000).optional(),
  // Link to the artifact an auditor would ask for (policy PDF, signed BAA,
  // training roster). Empty string clears it.
  evidenceUrl: z.string().url().max(1000).or(z.literal("")).optional(),
  // ISO date (YYYY-MM-DD) or full ISO timestamp; "" clears the review date.
  reviewDue: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}([T ].*)?$/)
    .or(z.literal(""))
    .optional(),
});

export const orgConfigSchema = z
  .object({
    assignmentTimeoutMin: z.number().int().min(1).max(120).optional(),
    // The org's ROUTABLE shift types (Settings → Shift types). Never empty — an
    // empty set would leave no one to route an admission to — and no repeats.
    roundRobinShiftTypes: z
      .array(z.enum(SHIFT_TYPE))
      .min(1)
      .refine((a) => new Set(a).size === a.length, { message: "duplicate shift type" })
      .optional(),
    rotationMode: z.enum(["lowest_census", "sequential"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field is required",
  });

/* ── Org theme (Settings → Appearance) ──────────────────────────────────────
 * PATCH /api/org/preferences { theme } is validated against this and MERGED
 * key by key into the stored theme, so two admins changing different keys
 * never undo each other. "Reset to defaults" writes ORG_THEME_DEFAULTS. */
export const ORG_THEME_DEFAULTS = {
  appName: "DocTurn",
  accent: "#2563EB",
  radius: 8,
  sidebar: "expanded",
  contentWidth: "standard",
  palette: "classic",
} as const;
export const orgThemePatchSchema = z
  .object({
    // Shown in the sidebar; printable characters only.
    appName: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[^\u0000-\u001f\u007f]*$/)
      .optional(),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    radius: z.number().int().min(0).max(24).optional(),
    sidebar: z.enum(["expanded", "compact"]).optional(),
    contentWidth: z.enum(["standard", "wide", "full"]).optional(),
    palette: z.enum(["classic", "calm", "warm"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

/* ── Consult-service catalog (Directory → Consult services) ─────────────────
 * Stored as org setting "consultServices" (read by the ER intake, the on-call
 * board and on-call message addressing) with a revision counter in
 * "consultServicesRev". Edited one item at a time (/api/org/consult-services). */
const consultServiceName = z.string().trim().min(1).max(80);
const consultPersonName = z.string().trim().min(1).max(120);
export const consultOnCallSchema = z
  .object({
    name: consultPersonName,
    avatar: z.string().trim().max(4).optional(),
    userId: z.number().int().positive().optional(),
  })
  .strict()
  .nullable();
export const consultServiceCreateSchema = z.object({ name: consultServiceName }).strict();
export const consultServicePatchSchema = z
  .object({ name: consultServiceName.optional(), onCall: consultOnCallSchema.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });
export const consultMemberCreateSchema = z
  .object({
    name: consultPersonName,
    role: z.enum(["NP", "PA", "RN"]),
    avatar: z.string().trim().max(4).optional(),
  })
  .strict();
/** The legacy whole-catalog replace (PATCH /api/org/preferences { consultServices }). */
export const consultServicesArraySchema = z
  .array(z.object({ id: z.string().max(64).optional(), name: consultServiceName }).passthrough())
  .max(200);

/* ── Clinical screens (A.CON clinical) ────────────────────────────────────────
 * Bodies of the writes behind the ER director, director and patient-board
 * controls. Free text never carries control characters (C0, DEL, C1). */
const noControlChars = /^[^\u0000-\u001f\u007f-\u009f]*$/;

/** PUT /api/er/diversion — declare (true) or lift (false) ER diversion. */
export const erDiversionSchema = z.object({ active: z.boolean() }).strict();

/** PATCH /api/er/roster/:userId — an ER physician's on/off shift and shift. */
export const erRosterPatchSchema = z
  .object({ onShift: z.boolean().optional(), shiftType: z.enum(SHIFT_TYPE).optional() })
  .strict()
  .refine((v) => v.onShift !== undefined || v.shiftType !== undefined, { message: "at least one field is required" });

/** PATCH /api/patients/:id — the board's inline room / issue / unit edits (no status: it is derived from routing). */
export const patientPatchSchema = z
  .object({
    roomNumber: z.string().trim().min(1).max(40).regex(noControlChars).optional(),
    issueSummary: z.string().trim().min(1).max(500).regex(noControlChars).optional(),
    department: z.string().trim().min(1).max(20).regex(noControlChars).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

/** PATCH /api/hospitalists/:id/profile — the director's inline name / specialty edits. */
export const providerProfilePatchSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).regex(noControlChars).optional(),
    specialty: z.string().trim().min(1).max(80).regex(noControlChars).optional(),
  })
  .strict()
  .refine((v) => v.displayName !== undefined || v.specialty !== undefined, { message: "at least one field is required" });
