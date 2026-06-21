import { relations, sql } from "drizzle-orm";
import {
  boolean,
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
export const CONSULT_STATUS = ["requested", "active", "closed"] as const;
export const BROADCAST_SEVERITY = ["info", "urgent", "critical"] as const;
export const REGISTRATION_STATUS = ["pending", "approved", "rejected"] as const;

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
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    usernamePerOrg: uniqueIndex("users_org_username_uniq").on(
      t.organizationId,
      t.username,
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

/* ── Messaging ─────────────────────────────────────────────────────────────── */

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  type: text("type", { enum: CONVERSATION_TYPE }).notNull().default("direct"),
  name: text("name"),
  participantIds: jsonb("participant_ids").$type<number[]>().notNull(),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

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
});

/* ── Audit, PHI access & security ──────────────────────────────────────────── */

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  userId: integer("user_id").references(() => users.id),
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
  method: text("method").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
  status: text("status", { enum: CONSULT_STATUS })
    .notNull()
    .default("requested"),
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
    platform: text("platform", { enum: ["ios", "android", "web"] })
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
export type MessageDeliveryStatus = typeof messageDeliveryStatus.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type OrgSetting = typeof orgSettings.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;

/** A user object safe to return over the API — never includes the password hash. */
export type SafeUser = Pick<
  User,
  "id" | "username" | "role" | "displayName" | "organizationId" | "credential"
>;

export function toSafeUser(u: User): SafeUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    displayName: u.displayName,
    organizationId: u.organizationId,
    credential: u.credential,
  };
}

/* ── Request-body schemas shared by server validation and client forms ─────── */

export const loginSchema = z.object({
  orgCode: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});

export const registerSchema = z.object({
  orgCode: z.string().min(1),
  username: z.string().min(3),
  password: z.string().min(6),
  displayName: z.string().min(1),
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

export const sendMessageSchema = z.object({
  conversationId: z.number().int().positive(),
  content: z.string().min(1),
});

export const markReadSchema = z.object({
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
});

export const deviceTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android", "web"]).default("ios"),
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

export const orgConfigSchema = z
  .object({
    assignmentTimeoutMin: z.number().int().min(1).max(120).optional(),
    roundRobinShiftTypes: z.array(z.enum(SHIFT_TYPE)).optional(),
    rotationMode: z.enum(["lowest_census", "sequential"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field is required",
  });
