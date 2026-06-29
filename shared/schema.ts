import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums (SQLite has no native enum; we constrain via Zod + text columns)
// ---------------------------------------------------------------------------
export const ROLES = ['director', 'er_director', 'er_doctor', 'hospitalist', 'developer'] as const;
export const ASSIGNMENT_STATUS = ['pending', 'accepted', 'rejected', 'expired', 'cancelled'] as const;
export const ASSIGNMENT_VIA = ['round_robin', 'manual'] as const;
export const PATIENT_STATUS = ['waiting', 'assigned', 'admitted', 'discharged'] as const;
export const CONVERSATION_TYPE = ['direct', 'group', 'emergency'] as const;
export const SHIFT_TYPE = ['day', 'night', 'swing'] as const;
export const RISK_LEVEL = ['low', 'medium', 'high'] as const;
export const SETTING_SCOPE = ['org', 'user'] as const;

export type Role = (typeof ROLES)[number];
export type AssignmentStatus = (typeof ASSIGNMENT_STATUS)[number];
export type PatientStatus = (typeof PATIENT_STATUS)[number];

const now = sql`(unixepoch())`;

// ---------------------------------------------------------------------------
// organizations
// ---------------------------------------------------------------------------
export const organizations = sqliteTable('organizations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  timezone: text('timezone').notNull().default('America/New_York'),
  assignmentTimeoutMin: integer('assignment_timeout_min').notNull().default(10),
  roundRobinIndex: integer('round_robin_index').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').notNull().references(() => organizations.id),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  fullName: text('full_name').notNull(),
  email: text('email'),
  phone: text('phone'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  mfaEnabled: integer('mfa_enabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// hospitalists
// ---------------------------------------------------------------------------
export const hospitalists = sqliteTable('hospitalists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').notNull().references(() => organizations.id),
  userId: integer('user_id').notNull().references(() => users.id),
  specialty: text('specialty').notNull().default('General'),
  capacity: integer('capacity').notNull().default(12),
  census: integer('census').notNull().default(0),
  isWorking: integer('is_working', { mode: 'boolean' }).notNull().default(false),
  shiftType: text('shift_type').notNull().default('day'),
  rotationOrder: integer('rotation_order').notNull().default(0),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// patients (PHI — only initials exposed in PHI-free contexts)
// ---------------------------------------------------------------------------
export const patients = sqliteTable('patients', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').notNull().references(() => organizations.id),
  initials: text('initials').notNull(),
  fullName: text('full_name'),
  room: text('room'),
  chiefComplaint: text('chief_complaint'),
  diagnosis: text('diagnosis'),
  riskLevel: text('risk_level').notNull().default('low'),
  status: text('status').notNull().default('waiting'),
  structuredData: text('structured_data'),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// assignments
// ---------------------------------------------------------------------------
export const assignments = sqliteTable('assignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').notNull().references(() => organizations.id),
  patientId: integer('patient_id').notNull().references(() => patients.id),
  hospitalistId: integer('hospitalist_id').notNull().references(() => hospitalists.id),
  assignedByUserId: integer('assigned_by_user_id').references(() => users.id),
  status: text('status').notNull().default('pending'),
  via: text('via').notNull().default('round_robin'),
  expiresAt: integer('expires_at'),
  respondedAt: integer('responded_at'),
  rejectionReason: text('rejection_reason'),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// conversations
// ---------------------------------------------------------------------------
export const conversations = sqliteTable('conversations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').notNull().references(() => organizations.id),
  type: text('type').notNull().default('direct'),
  title: text('title'),
  participantIds: text('participant_ids').notNull(), // JSON array of userIds
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------
export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').notNull().references(() => organizations.id),
  conversationId: integer('conversation_id').notNull().references(() => conversations.id),
  senderId: integer('sender_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  deletedAt: integer('deleted_at'),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// message_delivery_status
// ---------------------------------------------------------------------------
export const messageDeliveryStatus = sqliteTable('message_delivery_status', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id').notNull().references(() => messages.id),
  userId: integer('user_id').notNull().references(() => users.id),
  deliveredAt: integer('delivered_at'),
  readAt: integer('read_at'),
});

// ---------------------------------------------------------------------------
// audit_logs
// ---------------------------------------------------------------------------
export const auditLogs = sqliteTable('audit_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id'),
  userId: integer('user_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: integer('target_id'),
  detail: text('detail'),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// mfa_credentials
// ---------------------------------------------------------------------------
export const mfaCredentials = sqliteTable('mfa_credentials', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  type: text('type').notNull().default('totp'),
  secret: text('secret').notNull(),
  verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// mfa_backup_codes
// ---------------------------------------------------------------------------
export const mfaBackupCodes = sqliteTable('mfa_backup_codes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  codeHash: text('code_hash').notNull(),
  used: integer('used', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// sms_verification_codes
// ---------------------------------------------------------------------------
export const smsVerificationCodes = sqliteTable('sms_verification_codes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id),
  phone: text('phone').notNull(),
  code: text('code').notNull(),
  expiresAt: integer('expires_at').notNull(),
  consumed: integer('consumed', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// phi_access_logs
// ---------------------------------------------------------------------------
export const phiAccessLogs = sqliteTable('phi_access_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').notNull(),
  userId: integer('user_id').notNull(),
  patientId: integer('patient_id'),
  action: text('action').notNull(),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// security_incidents
// ---------------------------------------------------------------------------
export const securityIncidents = sqliteTable('security_incidents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id'),
  userId: integer('user_id'),
  kind: text('kind').notNull(),
  severity: text('severity').notNull().default('low'),
  detail: text('detail'),
  resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// pending_registrations
// ---------------------------------------------------------------------------
export const pendingRegistrations = sqliteTable('pending_registrations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgCode: text('org_code').notNull(),
  username: text('username').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  fullName: text('full_name').notNull(),
  email: text('email'),
  approved: integer('approved', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// device_tokens
// ---------------------------------------------------------------------------
export const deviceTokens = sqliteTable('device_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  token: text('token').notNull(),
  platform: text('platform').notNull().default('ios'),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// push_notifications
// ---------------------------------------------------------------------------
export const pushNotifications = sqliteTable('push_notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  body: text('body').notNull(),
  data: text('data'),
  sentAt: integer('sent_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// departments
// ---------------------------------------------------------------------------
export const departments = sqliteTable('departments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  code: text('code'),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// beds
// ---------------------------------------------------------------------------
export const beds = sqliteTable('beds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').notNull().references(() => organizations.id),
  departmentId: integer('department_id').references(() => departments.id),
  label: text('label').notNull(),
  occupied: integer('occupied', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// equipment
// ---------------------------------------------------------------------------
export const equipment = sqliteTable('equipment', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  status: text('status').notNull().default('available'),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// resource_alerts
// ---------------------------------------------------------------------------
export const resourceAlerts = sqliteTable('resource_alerts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').notNull().references(() => organizations.id),
  kind: text('kind').notNull(),
  message: text('message').notNull(),
  resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// resource_metrics
// ---------------------------------------------------------------------------
export const resourceMetrics = sqliteTable('resource_metrics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').notNull().references(() => organizations.id),
  metric: text('metric').notNull(),
  value: text('value').notNull(),
  recordedAt: integer('recorded_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// emergency_broadcasts
// ---------------------------------------------------------------------------
export const emergencyBroadcasts = sqliteTable('emergency_broadcasts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').notNull().references(() => organizations.id),
  senderId: integer('sender_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  body: text('body').notNull(),
  severity: text('severity').notNull().default('high'),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// broadcast_acknowledgments
// ---------------------------------------------------------------------------
export const broadcastAcknowledgments = sqliteTable('broadcast_acknowledgments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  broadcastId: integer('broadcast_id').notNull().references(() => emergencyBroadcasts.id),
  userId: integer('user_id').notNull().references(() => users.id),
  acknowledgedAt: integer('acknowledged_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// landing_page_settings
// ---------------------------------------------------------------------------
export const landingPageSettings = sqliteTable('landing_page_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').references(() => organizations.id),
  heroTitle: text('hero_title'),
  heroSubtitle: text('hero_subtitle'),
  content: text('content'),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// contact_page_settings
// ---------------------------------------------------------------------------
export const contactPageSettings = sqliteTable('contact_page_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').references(() => organizations.id),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// sms_history
// ---------------------------------------------------------------------------
export const smsHistory = sqliteTable('sms_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id'),
  userId: integer('user_id'),
  toPhone: text('to_phone').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('sent'),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// org_settings
// ---------------------------------------------------------------------------
export const orgSettings = sqliteTable('org_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').notNull().references(() => organizations.id),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// user_preferences
// ---------------------------------------------------------------------------
export const userPreferences = sqliteTable('user_preferences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// feature_flags
// ---------------------------------------------------------------------------
export const featureFlags = sqliteTable('feature_flags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id'),
  key: text('key').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  description: text('description'),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// suggestions
// ---------------------------------------------------------------------------
export const suggestions = sqliteTable('suggestions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id'),
  userId: integer('user_id'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('open'),
  createdAt: integer('created_at').notNull().default(now),
});

// ---------------------------------------------------------------------------
// Zod insert schemas
// ---------------------------------------------------------------------------
export const insertOrganizationSchema = createInsertSchema(organizations, {
  code: z.string().min(2).max(16),
}).omit({ id: true, createdAt: true });

export const insertUserSchema = createInsertSchema(users, {
  role: z.enum(ROLES),
  username: z.string().min(3),
}).omit({ id: true, createdAt: true });

export const insertHospitalistSchema = createInsertSchema(hospitalists, {
  shiftType: z.enum(SHIFT_TYPE),
}).omit({ id: true, createdAt: true });

export const insertPatientSchema = createInsertSchema(patients, {
  riskLevel: z.enum(RISK_LEVEL).optional(),
  status: z.enum(PATIENT_STATUS).optional(),
}).omit({ id: true, createdAt: true });

export const insertAssignmentSchema = createInsertSchema(assignments, {
  status: z.enum(ASSIGNMENT_STATUS).optional(),
  via: z.enum(ASSIGNMENT_VIA).optional(),
}).omit({ id: true, createdAt: true });

export const insertConversationSchema = createInsertSchema(conversations, {
  type: z.enum(CONVERSATION_TYPE),
}).omit({ id: true, createdAt: true });

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
  deleted: true,
  deletedAt: true,
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Hospitalist = typeof hospitalists.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

export type SafeUser = Omit<User, 'passwordHash'>;
export function sanitizeUser(u: User): SafeUser {
  const { passwordHash, ...rest } = u;
  return rest;
}
