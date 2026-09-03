import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { DbType } from "./db.js";
import { getDb } from "./db.js";
import {
  assignments,
  auditLogs,
  beds,
  broadcastAcknowledgments,
  careTeamMembers,
  complianceAttestations,
  contactPageSettings,
  conversations,
  departments,
  deviceTokens,
  emergencyBroadcasts,
  equipment,
  featureFlags,
  hospitalists,
  landingPageSettings,
  mfaBackupCodes,
  mfaCredentials,
  messageAttachments,
  messageDeliveryStatus,
  messageTemplates,
  messages,
  orgSettings,
  organizations,
  patientConsults,
  patients,
  pendingRegistrations,
  phiAccessLogs,
  retainedComplianceRecords,
  securityIncidents,
  smsHistory,
  suggestions,
  userPreferences,
  users,
  type Assignment,
  type AuditLog,
  type Bed,
  type BroadcastAck,
  type AttestationStatus,
  type CareTeamMember,
  type ComplianceAttestation,
  type Conversation,
  type Department,
  type DeviceToken,
  type EmergencyBroadcast,
  type Equipment,
  type FeatureFlag,
  type ForwardedFrom,
  type Hospitalist,
  type InsertHospitalist,
  type Message,
  type MessageTemplate,
  type MessageAttachment,
  type MessageDeliveryStatus,
  type Organization,
  type PatientConsult,
  type PendingRegistration,
  type Patient,
  type RetainedComplianceRecord,
  type User,
} from "@shared/schema";

/** Insert shape for a patient — the EHR id (MRN/CSN) is optional. */
export type NewPatient = Omit<Patient, "id" | "createdAt" | "ehrId"> & { ehrId?: string | null };

/**
 * Normalize a timestamp aggregate. Depending on driver, `min()`/`max()` over a
 * timestamp column arrives as a Date or as an ISO string — accept both.
 */
function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Insert shape for a message; forwarding provenance is optional (NULL = original). */
export type NewMessage = Omit<
  Message,
  "id" | "createdAt" | "deletedAt" | "forwardedFrom"
> & { forwardedFrom?: ForwardedFrom | null };

/** Fields a director may set on a manual compliance attestation. */
export interface AttestationPatch {
  status: AttestationStatus;
  owner?: string | null;
  note?: string | null;
  evidenceUrl?: string | null;
  reviewDue?: Date | null;
}

/** Aggregate shape of one org's audit trail — counts and dates, never rows. */
export interface AuditStats {
  total: number;
  last24h: number;
  last30d: number;
  oldestAt: Date | null;
  newestAt: Date | null;
  byRisk: Record<string, number>;
  byAction: Record<string, number>;
}

/** Aggregate shape of one org's PHI-access trail. */
export interface PhiAccessStats {
  total: number;
  /** Reads = safe HTTP methods (GET/HEAD). */
  reads: number;
  writes: number;
  oldestAt: Date | null;
  newestAt: Date | null;
}

export interface AttachmentStats {
  count: number;
  totalBytes: number;
}

/**
 * Cross-tenant ROW COUNTS ONLY (integers — never rows, ids or content). The
 * tenant-isolation control needs to know that other tenants' rows exist in this
 * database, otherwise "the scoped query returned only my org's rows" proves
 * nothing on a single-tenant database. No caller may use this to read data.
 */
export interface GlobalRowCounts {
  organizations: number;
  users: number;
  patients: number;
  assignments: number;
  auditLogs: number;
}

/**
 * The single data-access surface. EVERY tenant-scoped method takes
 * `organizationId` as its first argument and filters by it — a route handler
 * literally cannot read another tenant's rows through this interface. The
 * `developer` role bypasses scoping at the route layer (audited), never here.
 */
export interface IStorage {
  // organizations
  getOrganization(id: number): Promise<Organization | undefined>;
  getOrganizationByCode(code: string): Promise<Organization | undefined>;
  updateOrganization(
    id: number,
    patch: Partial<Organization>,
  ): Promise<Organization | undefined>;
  createOrganization(
    org: Omit<Organization, "id">,
  ): Promise<Organization>;

  // users
  getUser(orgId: number, id: number): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  getUserByUsername(orgId: number, username: string): Promise<User | undefined>;
  listUsers(orgId: number): Promise<User[]>;
  createUser(user: Omit<User, "id" | "createdAt">): Promise<User>;

  // hospitalists
  getHospitalist(orgId: number, id: number): Promise<Hospitalist | undefined>;
  getHospitalistByUser(
    orgId: number,
    userId: number,
  ): Promise<Hospitalist | undefined>;
  listHospitalists(orgId: number): Promise<Hospitalist[]>;
  listWorkingHospitalists(orgId: number): Promise<Hospitalist[]>;
  createHospitalist(h: InsertHospitalist): Promise<Hospitalist>;
  updateHospitalist(
    orgId: number,
    id: number,
    patch: Partial<Hospitalist>,
  ): Promise<Hospitalist | undefined>;
  deleteHospitalist(orgId: number, id: number): Promise<void>;
  bulkSetWorking(orgId: number, working: boolean): Promise<void>;

  // patients
  getPatient(orgId: number, id: number): Promise<Patient | undefined>;
  listPatients(orgId: number): Promise<Patient[]>;
  createPatient(p: NewPatient): Promise<Patient>;
  updatePatient(
    orgId: number,
    id: number,
    patch: Partial<Patient>,
  ): Promise<Patient | undefined>;

  // assignments
  getAssignment(orgId: number, id: number): Promise<Assignment | undefined>;
  listAssignments(orgId: number): Promise<Assignment[]>;
  listPendingForHospitalist(
    orgId: number,
    hospitalistId: number,
  ): Promise<Assignment[]>;
  listAcceptedForHospitalist(
    orgId: number,
    hospitalistId: number,
  ): Promise<Assignment[]>;
  listPendingExpired(now: Date, limit: number): Promise<Assignment[]>;
  hasPendingForHospitalist(
    orgId: number,
    hospitalistId: number,
  ): Promise<boolean>;
  createAssignment(
    a: Omit<Assignment, "id" | "createdAt" | "resolvedAt">,
  ): Promise<Assignment>;
  updateAssignment(
    orgId: number,
    id: number,
    patch: Partial<Assignment>,
  ): Promise<Assignment | undefined>;

  // messaging
  listConversationsForUser(
    orgId: number,
    userId: number,
  ): Promise<Conversation[]>;
  getConversation(
    orgId: number,
    id: number,
  ): Promise<Conversation | undefined>;
  createConversation(
    c: Omit<Conversation, "id" | "createdAt">,
  ): Promise<Conversation>;
  getConversationByPatient(
    orgId: number,
    patientId: number,
  ): Promise<Conversation | undefined>;
  purgeMessagesOlderThan(orgId: number, cutoff: Date): Promise<number>;
  listConsultsForOrg(orgId: number): Promise<PatientConsult[]>;
  countMessagesSince(orgId: number, since: Date): Promise<number>;
  listStatAckLatencies(orgId: number): Promise<number[]>;
  listMessages(orgId: number, conversationId: number): Promise<Message[]>;
  createMessage(m: NewMessage): Promise<Message>;
  getMessage(orgId: number, id: number): Promise<Message | undefined>;
  softDeleteMessage(orgId: number, id: number): Promise<void>;
  createDeliveryStatuses(
    rows: Omit<MessageDeliveryStatus, "id">[],
  ): Promise<void>;
  markRead(userId: number, messageIds: number[]): Promise<void>;
  listDeliveryForMessages(
    messageIds: number[],
  ): Promise<MessageDeliveryStatus[]>;
  listUnackedStatDeliveries(): Promise<
    Array<{
      deliveryId: number;
      userId: number;
      realertedAt: Date | null;
      escalatedAt: Date | null;
      messageId: number;
      conversationId: number;
      organizationId: number;
      senderId: number;
      createdAt: Date;
    }>
  >;
  markDeliveryRealerted(deliveryId: number): Promise<void>;
  markDeliveryEscalated(deliveryId: number): Promise<void>;

  // message attachments
  createAttachment(a: {
    organizationId: number;
    uploaderId: number;
    fileName: string;
    mimeType: string;
    byteSize: number;
    dataBase64: string;
  }): Promise<{ id: number }>;
  getAttachment(
    orgId: number,
    id: number,
  ): Promise<MessageAttachment | undefined>;
  linkAttachmentsToMessage(
    orgId: number,
    messageId: number,
    ids: number[],
    uploaderId: number,
  ): Promise<void>;
  listAttachmentsForMessages(
    orgId: number,
    messageIds: number[],
  ): Promise<
    Array<{
      id: number;
      messageId: number | null;
      fileName: string;
      mimeType: string;
      byteSize: number;
    }>
  >;

  addConversationParticipant(
    orgId: number,
    conversationId: number,
    userId: number,
  ): Promise<Conversation | undefined>;

  // config
  getOrgSetting(orgId: number, key: string): Promise<unknown>;
  setOrgSetting(
    orgId: number,
    key: string,
    value: unknown,
    updatedBy: number | null,
  ): Promise<void>;
  getUserPreference(userId: number, key: string): Promise<unknown>;
  setUserPreference(
    orgId: number,
    userId: number,
    key: string,
    value: unknown,
  ): Promise<void>;
  getFeatureFlag(orgId: number, flag: string): Promise<boolean>;

  // audit & phi
  appendAudit(row: Omit<AuditLog, "id" | "createdAt">): Promise<void>;
  logPhiAccess(row: {
    organizationId: number;
    userId: number;
    resource: string;
    /** Id of the specific record read (conversation id, patient id, …). */
    resourceId?: number | null;
    /** Patient the read concerns, when the record is patient-linked. */
    patientId?: number | null;
    method: string;
    ip?: string;
    userAgent?: string;
  }): Promise<void>;
  countPhiAccess(orgId: number): Promise<number>;
  /** Copy an org's audit/PHI/security rows into the six-year retained archive. */
  archiveComplianceRecords(orgId: number, reason: string): Promise<number>;
  listRetainedComplianceRecords(
    orgId?: number,
    limit?: number,
  ): Promise<RetainedComplianceRecord[]>;
  countRetainedComplianceRecords(orgId?: number): Promise<number>;

  // ── continuous compliance monitoring (org-scoped) ────────────────────────────
  listAttestations(orgId: number): Promise<ComplianceAttestation[]>;
  upsertAttestation(
    orgId: number,
    controlId: string,
    patch: AttestationPatch,
    userId: number,
  ): Promise<ComplianceAttestation>;
  auditStats(orgId: number): Promise<AuditStats>;
  phiAccessStats(orgId: number): Promise<PhiAccessStats>;
  attachmentStats(orgId: number): Promise<AttachmentStats>;
  lastAuditActivityByUser(orgId: number): Promise<Map<number, Date>>;
  globalRowCounts(): Promise<GlobalRowCounts>;

  // ── comms KPIs (org-scoped) ──────────────────────────────────────────────────
  avgStatAckSeconds(orgId: number, since: Date): Promise<number | null>;
  avgConsultResponseSeconds(orgId: number, since: Date): Promise<number | null>;
}

export class DatabaseStorage implements IStorage {
  constructor(private readonly db: DbType = getDb()) {}

  // ── organizations ──────────────────────────────────────────────────────────
  async getOrganization(id: number) {
    const [row] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id));
    return row;
  }
  async getOrganizationByCode(code: string) {
    const [row] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.code, code.toUpperCase()));
    return row;
  }
  async updateOrganization(id: number, patch: Partial<Organization>) {
    const [row] = await this.db
      .update(organizations)
      .set(patch)
      .where(eq(organizations.id, id))
      .returning();
    return row;
  }
  async createOrganization(org: Omit<Organization, "id">) {
    const [row] = await this.db.insert(organizations).values(org).returning();
    return row!;
  }

  // ── users ──────────────────────────────────────────────────────────────────
  async getUser(orgId: number, id: number) {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.organizationId, orgId), eq(users.id, id)));
    return row;
  }
  async getUserById(id: number) {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    return row;
  }
  async getUserByUsername(orgId: number, username: string) {
    const [row] = await this.db
      .select()
      .from(users)
      .where(
        and(eq(users.organizationId, orgId), eq(users.username, username)),
      );
    return row;
  }
  async listUsers(orgId: number) {
    return this.db
      .select()
      .from(users)
      .where(eq(users.organizationId, orgId))
      .orderBy(asc(users.id));
  }
  async createUser(user: Omit<User, "id" | "createdAt">) {
    const [row] = await this.db.insert(users).values(user).returning();
    return row!;
  }

  // ── hospitalists ─────────────────────────────────────────────────────────────
  async getHospitalist(orgId: number, id: number) {
    const [row] = await this.db
      .select()
      .from(hospitalists)
      .where(
        and(eq(hospitalists.organizationId, orgId), eq(hospitalists.id, id)),
      );
    return row;
  }
  async getHospitalistByUser(orgId: number, userId: number) {
    const [row] = await this.db
      .select()
      .from(hospitalists)
      .where(
        and(
          eq(hospitalists.organizationId, orgId),
          eq(hospitalists.userId, userId),
        ),
      );
    return row;
  }
  async listHospitalists(orgId: number) {
    return this.db
      .select()
      .from(hospitalists)
      .where(eq(hospitalists.organizationId, orgId))
      .orderBy(asc(hospitalists.rotationOrder), asc(hospitalists.id));
  }
  async listWorkingHospitalists(orgId: number) {
    return this.db
      .select()
      .from(hospitalists)
      .where(
        and(
          eq(hospitalists.organizationId, orgId),
          eq(hospitalists.working, true),
        ),
      )
      .orderBy(asc(hospitalists.rotationOrder), asc(hospitalists.id));
  }
  async createHospitalist(h: InsertHospitalist) {
    const [row] = await this.db.insert(hospitalists).values(h).returning();
    return row!;
  }
  async updateHospitalist(
    orgId: number,
    id: number,
    patch: Partial<Hospitalist>,
  ) {
    const [row] = await this.db
      .update(hospitalists)
      .set(patch)
      .where(
        and(eq(hospitalists.organizationId, orgId), eq(hospitalists.id, id)),
      )
      .returning();
    return row;
  }
  async deleteHospitalist(orgId: number, id: number) {
    await this.db
      .delete(hospitalists)
      .where(
        and(eq(hospitalists.organizationId, orgId), eq(hospitalists.id, id)),
      );
  }
  async bulkSetWorking(orgId: number, working: boolean) {
    await this.db
      .update(hospitalists)
      .set({ working })
      .where(eq(hospitalists.organizationId, orgId));
  }

  // ── patients ─────────────────────────────────────────────────────────────────
  async getPatient(orgId: number, id: number) {
    const [row] = await this.db
      .select()
      .from(patients)
      .where(and(eq(patients.organizationId, orgId), eq(patients.id, id)));
    return row;
  }
  async listPatients(orgId: number) {
    return this.db
      .select()
      .from(patients)
      .where(eq(patients.organizationId, orgId))
      .orderBy(desc(patients.createdAt));
  }
  async createPatient(p: NewPatient) {
    const [row] = await this.db.insert(patients).values({ ...p, ehrId: p.ehrId ?? null }).returning();
    return row!;
  }
  /**
   * Delete patients older than `olderThanMs` (0 = all) along with their
   * assignments and consults, then recompute each hospitalist's census from the
   * accepted assignments that remain. Returns the number of patients removed.
   * Used by the manual "clear" controls and the daily auto-clean sweep.
   */
  async purgeOldPatients(orgId: number, olderThanMs: number): Promise<number> {
    const cutoff = olderThanMs > 0 ? new Date(Date.now() - olderThanMs) : null;
    const rows = await this.db
      .select({ id: patients.id })
      .from(patients)
      .where(
        cutoff
          ? and(eq(patients.organizationId, orgId), lt(patients.createdAt, cutoff))
          : eq(patients.organizationId, orgId),
      );
    const ids = rows.map((r) => r.id);
    if (!ids.length) return 0;
    await this.db
      .delete(assignments)
      .where(and(eq(assignments.organizationId, orgId), inArray(assignments.patientId, ids)));
    await this.db
      .delete(patientConsults)
      .where(and(eq(patientConsults.organizationId, orgId), inArray(patientConsults.patientId, ids)));
    await this.db
      .delete(patients)
      .where(and(eq(patients.organizationId, orgId), inArray(patients.id, ids)));
    // Keep census honest: it now equals each provider's remaining accepted load.
    const hosps = await this.listHospitalists(orgId);
    for (const h of hosps) {
      const accepted = await this.db
        .select({ id: assignments.id })
        .from(assignments)
        .where(and(eq(assignments.organizationId, orgId), eq(assignments.hospitalistId, h.id), eq(assignments.status, "accepted")));
      if (h.currentPatientCount !== accepted.length) {
        await this.updateHospitalist(orgId, h.id, { currentPatientCount: accepted.length });
      }
    }
    return ids.length;
  }
  async updatePatient(orgId: number, id: number, patch: Partial<Patient>) {
    const [row] = await this.db
      .update(patients)
      .set(patch)
      .where(and(eq(patients.organizationId, orgId), eq(patients.id, id)))
      .returning();
    return row;
  }

  // ── assignments ──────────────────────────────────────────────────────────────
  async getAssignment(orgId: number, id: number) {
    const [row] = await this.db
      .select()
      .from(assignments)
      .where(
        and(eq(assignments.organizationId, orgId), eq(assignments.id, id)),
      );
    return row;
  }
  async listAssignments(orgId: number) {
    return this.db
      .select()
      .from(assignments)
      .where(eq(assignments.organizationId, orgId))
      .orderBy(desc(assignments.createdAt));
  }
  async listPendingForHospitalist(orgId: number, hospitalistId: number) {
    return this.db
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.organizationId, orgId),
          eq(assignments.hospitalistId, hospitalistId),
          eq(assignments.status, "pending"),
        ),
      )
      .orderBy(desc(assignments.createdAt));
  }
  async listAcceptedForHospitalist(orgId: number, hospitalistId: number) {
    return this.db
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.organizationId, orgId),
          eq(assignments.hospitalistId, hospitalistId),
          eq(assignments.status, "accepted"),
        ),
      )
      .orderBy(desc(assignments.createdAt));
  }
  async listPendingExpired(now: Date, limit: number) {
    return this.db
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.status, "pending"),
          sql`${assignments.expiresAt} <= ${now}`,
        ),
      )
      .orderBy(asc(assignments.expiresAt))
      .limit(limit);
  }
  async hasPendingForHospitalist(orgId: number, hospitalistId: number) {
    const rows = await this.db
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.organizationId, orgId),
          eq(assignments.hospitalistId, hospitalistId),
          eq(assignments.status, "pending"),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
  async createAssignment(
    a: Omit<Assignment, "id" | "createdAt" | "resolvedAt">,
  ) {
    const [row] = await this.db.insert(assignments).values(a).returning();
    return row!;
  }
  async updateAssignment(
    orgId: number,
    id: number,
    patch: Partial<Assignment>,
  ) {
    const [row] = await this.db
      .update(assignments)
      .set(patch)
      .where(
        and(eq(assignments.organizationId, orgId), eq(assignments.id, id)),
      )
      .returning();
    return row;
  }

  // ── messaging ────────────────────────────────────────────────────────────────
  async listConversationsForUser(orgId: number, userId: number) {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.organizationId, orgId))
      .orderBy(desc(conversations.createdAt));
    return rows.filter((c) => c.participantIds.includes(userId));
  }
  async getConversation(orgId: number, id: number) {
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.organizationId, orgId),
          eq(conversations.id, id),
        ),
      );
    return row;
  }
  async createConversation(c: Omit<Conversation, "id" | "createdAt">) {
    const [row] = await this.db.insert(conversations).values(c).returning();
    return row!;
  }
  async listMessages(orgId: number, conversationId: number) {
    return this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, orgId),
          eq(messages.conversationId, conversationId),
          isNull(messages.deletedAt),
        ),
      )
      .orderBy(asc(messages.createdAt));
  }
  async createMessage(m: NewMessage) {
    const [row] = await this.db
      .insert(messages)
      .values({ ...m, forwardedFrom: m.forwardedFrom ?? null })
      .returning();
    return row!;
  }
  async getMessage(orgId: number, id: number) {
    const [row] = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.organizationId, orgId), eq(messages.id, id)));
    return row;
  }
  async softDeleteMessage(orgId: number, id: number) {
    await this.db
      .update(messages)
      .set({ deletedAt: new Date() })
      .where(and(eq(messages.organizationId, orgId), eq(messages.id, id)));
  }
  async createDeliveryStatuses(rows: Omit<MessageDeliveryStatus, "id">[]) {
    if (rows.length === 0) return;
    await this.db.insert(messageDeliveryStatus).values(rows);
  }
  async markRead(userId: number, messageIds: number[]) {
    if (messageIds.length === 0) return;
    await this.db
      .update(messageDeliveryStatus)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(messageDeliveryStatus.userId, userId),
          inArray(messageDeliveryStatus.messageId, messageIds),
          isNull(messageDeliveryStatus.readAt),
        ),
      );
  }
  async acknowledgeMessages(userId: number, messageIds: number[]) {
    if (messageIds.length === 0) return;
    // Acknowledging also marks read (a STAT you acked was, by definition, seen).
    await this.db
      .update(messageDeliveryStatus)
      .set({ acknowledgedAt: new Date(), readAt: new Date() })
      .where(
        and(
          eq(messageDeliveryStatus.userId, userId),
          inArray(messageDeliveryStatus.messageId, messageIds),
          isNull(messageDeliveryStatus.acknowledgedAt),
        ),
      );
  }
  async listDeliveryForMessages(messageIds: number[]) {
    if (messageIds.length === 0) return [];
    return this.db
      .select()
      .from(messageDeliveryStatus)
      .where(inArray(messageDeliveryStatus.messageId, messageIds));
  }
  /**
   * Recipient delivery rows for STAT messages still awaiting acknowledgement,
   * joined with the message so the escalation sweep can age + route them.
   * (Sender rows are auto-acked at send time, so they never appear here.)
   */
  async listUnackedStatDeliveries() {
    return this.db
      .select({
        deliveryId: messageDeliveryStatus.id,
        userId: messageDeliveryStatus.userId,
        realertedAt: messageDeliveryStatus.realertedAt,
        escalatedAt: messageDeliveryStatus.escalatedAt,
        messageId: messages.id,
        conversationId: messages.conversationId,
        organizationId: messages.organizationId,
        senderId: messages.senderId,
        createdAt: messages.createdAt,
      })
      .from(messageDeliveryStatus)
      .innerJoin(messages, eq(messageDeliveryStatus.messageId, messages.id))
      .where(
        and(
          eq(messages.priority, "stat"),
          isNull(messages.deletedAt),
          isNull(messageDeliveryStatus.acknowledgedAt),
        ),
      );
  }
  async markDeliveryRealerted(deliveryId: number) {
    await this.db
      .update(messageDeliveryStatus)
      .set({ realertedAt: new Date() })
      .where(eq(messageDeliveryStatus.id, deliveryId));
  }
  async markDeliveryEscalated(deliveryId: number) {
    await this.db
      .update(messageDeliveryStatus)
      .set({ escalatedAt: new Date() })
      .where(eq(messageDeliveryStatus.id, deliveryId));
  }

  // ── Message attachments ──────────────────────────────────────────────────
  // SYNTHETIC-DATA PILOT ONLY: bytes are stored inline as base64. Production PHI
  // needs encrypted object storage (behind a BAA), AV scanning, and signed-URL
  // fetch — never this inline store.
  async createAttachment(a: {
    organizationId: number;
    uploaderId: number;
    fileName: string;
    mimeType: string;
    byteSize: number;
    dataBase64: string;
  }) {
    const [row] = await this.db
      .insert(messageAttachments)
      .values({ ...a, messageId: null })
      .returning({ id: messageAttachments.id });
    return row!;
  }
  async getAttachment(orgId: number, id: number) {
    const [row] = await this.db
      .select()
      .from(messageAttachments)
      .where(
        and(
          eq(messageAttachments.organizationId, orgId),
          eq(messageAttachments.id, id),
        ),
      );
    return row;
  }
  async linkAttachmentsToMessage(
    orgId: number,
    messageId: number,
    ids: number[],
    uploaderId: number,
  ) {
    if (ids.length === 0) return;
    // Only claim attachments that belong to this org + uploader and are still
    // unlinked — so an id can't be re-pointed at another message or stolen.
    await this.db
      .update(messageAttachments)
      .set({ messageId })
      .where(
        and(
          eq(messageAttachments.organizationId, orgId),
          eq(messageAttachments.uploaderId, uploaderId),
          isNull(messageAttachments.messageId),
          inArray(messageAttachments.id, ids),
        ),
      );
  }
  async listAttachmentsForMessages(orgId: number, messageIds: number[]) {
    if (messageIds.length === 0) return [];
    // Metadata only — never selects dataBase64 into a list response.
    return this.db
      .select({
        id: messageAttachments.id,
        messageId: messageAttachments.messageId,
        fileName: messageAttachments.fileName,
        mimeType: messageAttachments.mimeType,
        byteSize: messageAttachments.byteSize,
      })
      .from(messageAttachments)
      .where(
        and(
          eq(messageAttachments.organizationId, orgId),
          inArray(messageAttachments.messageId, messageIds),
        ),
      );
  }
  /**
   * Hard-delete messages older than the cutoff (plus every row that references
   * them) for one org — the auditable retention purge. Returns the number
   * purged.
   *
   * FK-safe order matters: `message_attachments.message_id` and
   * `message_delivery_status.message_id` both point at `messages`, so both must
   * go first or Postgres rejects the message delete and the whole sweep no-ops.
   * (Attachments were previously omitted, which made retention silently fail for
   * any org that had ever attached a file.) These run as separate statements
   * rather than one transaction: nothing else in this storage layer uses
   * `db.transaction`, and the ordering above is already crash-safe — an
   * interrupted purge leaves orphan-free data (children gone, parents intact)
   * and the next sweep simply finishes the job.
   */
  async purgeMessagesOlderThan(orgId: number, cutoff: Date) {
    const old = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(eq(messages.organizationId, orgId), lt(messages.createdAt, cutoff)),
      );
    const ids = old.map((m) => m.id);
    if (ids.length === 0) return 0;
    await this.db
      .delete(messageAttachments)
      .where(inArray(messageAttachments.messageId, ids));
    await this.db
      .delete(messageDeliveryStatus)
      .where(inArray(messageDeliveryStatus.messageId, ids));
    await this.db.delete(messages).where(inArray(messages.id, ids));
    return ids.length;
  }
  /** All consult rows for an org (analytics). */
  async listConsultsForOrg(orgId: number) {
    return this.db
      .select()
      .from(patientConsults)
      .where(eq(patientConsults.organizationId, orgId));
  }
  /** Message count since a moment (analytics; soft-deleted excluded). */
  async countMessagesSince(orgId: number, since: Date) {
    const rows = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, orgId),
          gte(messages.createdAt, since),
          isNull(messages.deletedAt),
        ),
      );
    return rows.length;
  }
  /** Ack latencies (ms) for acknowledged STAT deliveries, excluding senders. */
  async listStatAckLatencies(orgId: number) {
    const rows = await this.db
      .select({
        createdAt: messages.createdAt,
        acknowledgedAt: messageDeliveryStatus.acknowledgedAt,
        userId: messageDeliveryStatus.userId,
        senderId: messages.senderId,
      })
      .from(messageDeliveryStatus)
      .innerJoin(messages, eq(messageDeliveryStatus.messageId, messages.id))
      .where(
        and(
          eq(messages.organizationId, orgId),
          eq(messages.priority, "stat"),
        ),
      );
    return rows
      .filter((r) => r.acknowledgedAt && r.userId !== r.senderId)
      .map(
        (r) =>
          new Date(r.acknowledgedAt as Date).getTime() -
          new Date(r.createdAt).getTime(),
      );
  }
  /** The (single) patient-linked care-team thread for a patient, if it exists. */
  async getConversationByPatient(orgId: number, patientId: number) {
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.organizationId, orgId),
          eq(conversations.patientId, patientId),
        ),
      );
    return row;
  }
  /** Idempotently add a user to a conversation's participant list. */
  async addConversationParticipant(
    orgId: number,
    conversationId: number,
    userId: number,
  ) {
    const convo = await this.getConversation(orgId, conversationId);
    if (!convo || convo.participantIds.includes(userId)) return convo;
    const [row] = await this.db
      .update(conversations)
      .set({ participantIds: [...convo.participantIds, userId] })
      .where(
        and(
          eq(conversations.organizationId, orgId),
          eq(conversations.id, conversationId),
        ),
      )
      .returning();
    return row;
  }

  // ── config ───────────────────────────────────────────────────────────────────
  async getOrgSetting(orgId: number, key: string) {
    const [row] = await this.db
      .select()
      .from(orgSettings)
      .where(
        and(eq(orgSettings.organizationId, orgId), eq(orgSettings.key, key)),
      );
    return row?.value;
  }
  async setOrgSetting(
    orgId: number,
    key: string,
    value: unknown,
    updatedBy: number | null,
  ) {
    await this.db
      .insert(orgSettings)
      .values({ organizationId: orgId, key, value, updatedBy })
      .onConflictDoUpdate({
        target: [orgSettings.organizationId, orgSettings.key],
        set: { value, updatedBy, updatedAt: new Date() },
      });
  }
  async getUserPreference(userId: number, key: string) {
    const [row] = await this.db
      .select()
      .from(userPreferences)
      .where(
        and(
          eq(userPreferences.userId, userId),
          eq(userPreferences.key, key),
        ),
      );
    return row?.value;
  }
  async setUserPreference(
    orgId: number,
    userId: number,
    key: string,
    value: unknown,
  ) {
    await this.db
      .insert(userPreferences)
      .values({ organizationId: orgId, userId, key, value })
      .onConflictDoUpdate({
        target: [userPreferences.userId, userPreferences.key],
        set: { value },
      });
  }
  async getFeatureFlag(orgId: number, flag: string) {
    const [row] = await this.db
      .select()
      .from(featureFlags)
      .where(
        and(
          eq(featureFlags.organizationId, orgId),
          eq(featureFlags.flag, flag),
        ),
      );
    return row?.enabled ?? false;
  }

  // ── audit & phi ──────────────────────────────────────────────────────────────
  async appendAudit(row: Omit<AuditLog, "id" | "createdAt">) {
    await this.db.insert(auditLogs).values(row);
  }
  async logPhiAccess(row: {
    organizationId: number;
    userId: number;
    resource: string;
    resourceId?: number | null;
    patientId?: number | null;
    method: string;
    ip?: string;
    userAgent?: string;
  }) {
    await this.db.insert(phiAccessLogs).values({
      ...row,
      resourceId: row.resourceId ?? null,
      patientId: row.patientId ?? null,
    });
  }
  async countPhiAccess(orgId: number) {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(phiAccessLogs)
      .where(eq(phiAccessLogs.organizationId, orgId));
    return Number(row?.n ?? 0);
  }
  async countAuditLogs(orgId: number) {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, orgId));
    return Number(row?.n ?? 0);
  }
  async listAuditLogs(orgId: number, limit = 100) {
    return this.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, orgId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }
  async listPhiAccess(orgId: number, limit = 50) {
    return this.db
      .select()
      .from(phiAccessLogs)
      .where(eq(phiAccessLogs.organizationId, orgId))
      .orderBy(desc(phiAccessLogs.createdAt))
      .limit(limit);
  }

  // ── six-year compliance archive (§164.316(b)(2)(i)) ──────────────────────────
  /**
   * Copy an org's audit / PHI-access / security rows into the retained archive
   * before anything deletes them. Denormalizes the org and actor to TEXT so the
   * record still says WHO did WHAT after the org and its users are gone, and
   * carries no foreign keys so nothing can cascade it away. Idempotent-ish by
   * design: re-archiving would duplicate rows, so it is called only from the
   * tenant-delete path.
   */
  async archiveComplianceRecords(orgId: number, reason: string) {
    const [org] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId));
    const orgUsers = await this.db
      .select()
      .from(users)
      .where(eq(users.organizationId, orgId));
    const userById = new Map(orgUsers.map((u) => [u.id, u]));
    const who = (userId: number | null) => {
      const u = userId != null ? userById.get(userId) : undefined;
      return {
        userId: userId ?? null,
        userUsername: u?.username ?? null,
        userDisplayName: u?.displayName ?? null,
      };
    };
    const common = {
      organizationId: orgId,
      organizationCode: org?.code ?? null,
      organizationName: org?.name ?? null,
      archivedReason: reason,
    };

    const audits = await this.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, orgId));
    const phi = await this.db
      .select()
      .from(phiAccessLogs)
      .where(eq(phiAccessLogs.organizationId, orgId));
    const incidents = await this.db
      .select()
      .from(securityIncidents)
      .where(eq(securityIncidents.organizationId, orgId));

    const rows = [
      ...audits.map((a) => ({
        ...common,
        ...who(a.userId),
        sourceTable: "audit_logs",
        sourceId: a.id,
        action: a.action,
        resourceType: a.resourceType ?? null,
        resourceId: a.resourceId ?? null,
        patientId: null,
        method: null,
        ip: null,
        details: a.details ?? null,
        riskLevel: a.riskLevel,
        occurredAt: a.createdAt,
      })),
      ...phi.map((p) => ({
        ...common,
        ...who(p.userId),
        sourceTable: "phi_access_logs",
        sourceId: p.id,
        action: "phi.read",
        resourceType: p.resource,
        resourceId: p.resourceId ?? null,
        patientId: p.patientId ?? null,
        method: p.method,
        ip: p.ip ?? null,
        details: null,
        riskLevel: "medium",
        occurredAt: p.createdAt,
      })),
      ...incidents.map((s) => ({
        ...common,
        ...who(s.userId),
        sourceTable: "security_incidents",
        sourceId: s.id,
        action: "security." + s.type,
        resourceType: "security_incident",
        resourceId: null,
        patientId: null,
        method: null,
        ip: null,
        details: { description: s.description } as Record<string, unknown>,
        riskLevel: s.severity,
        occurredAt: s.createdAt,
      })),
    ];
    if (!rows.length) return 0;
    await this.db.insert(retainedComplianceRecords).values(rows);
    return rows.length;
  }
  /** Retained compliance history, optionally for one (possibly deleted) org. */
  async listRetainedComplianceRecords(orgId?: number, limit = 500) {
    const q = this.db.select().from(retainedComplianceRecords);
    const rows = await (orgId != null
      ? q.where(eq(retainedComplianceRecords.organizationId, orgId))
      : q
    )
      .orderBy(desc(retainedComplianceRecords.occurredAt))
      .limit(limit);
    return rows;
  }
  async countRetainedComplianceRecords(orgId?: number) {
    const [row] = await (orgId != null
      ? this.db
          .select({ n: sql<number>`count(*)` })
          .from(retainedComplianceRecords)
          .where(eq(retainedComplianceRecords.organizationId, orgId))
      : this.db
          .select({ n: sql<number>`count(*)` })
          .from(retainedComplianceRecords));
    return Number(row?.n ?? 0);
  }

  // ── continuous compliance monitoring ─────────────────────────────────────────
  async listAttestations(orgId: number) {
    return this.db
      .select()
      .from(complianceAttestations)
      .where(eq(complianceAttestations.organizationId, orgId))
      .orderBy(asc(complianceAttestations.controlId));
  }
  async upsertAttestation(
    orgId: number,
    controlId: string,
    patch: AttestationPatch,
    userId: number,
  ) {
    const values = {
      organizationId: orgId,
      controlId,
      status: patch.status,
      owner: patch.owner ?? null,
      note: patch.note ?? null,
      evidenceUrl: patch.evidenceUrl ?? null,
      // The attestation date is server-set — an org attests "as of now", it does
      // not get to backdate its own evidence.
      attestedAt: new Date(),
      reviewDue: patch.reviewDue ?? null,
      updatedBy: userId,
    };
    const [row] = await this.db
      .insert(complianceAttestations)
      .values(values)
      .onConflictDoUpdate({
        target: [
          complianceAttestations.organizationId,
          complianceAttestations.controlId,
        ],
        set: {
          status: values.status,
          owner: values.owner,
          note: values.note,
          evidenceUrl: values.evidenceUrl,
          attestedAt: values.attestedAt,
          reviewDue: values.reviewDue,
          updatedBy: values.updatedBy,
        },
      })
      .returning();
    return row!;
  }
  async auditStats(orgId: number): Promise<AuditStats> {
    const now = Date.now();
    const day = new Date(now - 86_400_000);
    const month = new Date(now - 30 * 86_400_000);
    const [totals] = await this.db
      .select({
        n: sql<number>`count(*)`,
        oldest: sql<string | null>`min(${auditLogs.createdAt})`,
        newest: sql<string | null>`max(${auditLogs.createdAt})`,
      })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, orgId));
    const [d1] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(auditLogs)
      .where(
        and(eq(auditLogs.organizationId, orgId), gte(auditLogs.createdAt, day)),
      );
    const [d30] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, orgId),
          gte(auditLogs.createdAt, month),
        ),
      );
    const riskRows = await this.db
      .select({ k: auditLogs.riskLevel, n: sql<number>`count(*)` })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, orgId))
      .groupBy(auditLogs.riskLevel);
    const actionRows = await this.db
      .select({ k: auditLogs.action, n: sql<number>`count(*)` })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, orgId))
      .groupBy(auditLogs.action);
    return {
      total: Number(totals?.n ?? 0),
      last24h: Number(d1?.n ?? 0),
      last30d: Number(d30?.n ?? 0),
      oldestAt: toDate(totals?.oldest),
      newestAt: toDate(totals?.newest),
      byRisk: Object.fromEntries(riskRows.map((r) => [r.k, Number(r.n)])),
      byAction: Object.fromEntries(actionRows.map((r) => [r.k, Number(r.n)])),
    };
  }
  async phiAccessStats(orgId: number): Promise<PhiAccessStats> {
    const rows = await this.db
      .select({ k: phiAccessLogs.method, n: sql<number>`count(*)` })
      .from(phiAccessLogs)
      .where(eq(phiAccessLogs.organizationId, orgId))
      .groupBy(phiAccessLogs.method);
    const [span] = await this.db
      .select({
        oldest: sql<string | null>`min(${phiAccessLogs.createdAt})`,
        newest: sql<string | null>`max(${phiAccessLogs.createdAt})`,
      })
      .from(phiAccessLogs)
      .where(eq(phiAccessLogs.organizationId, orgId));
    let reads = 0;
    let writes = 0;
    for (const r of rows) {
      const m = String(r.k ?? "").toUpperCase();
      if (m === "GET" || m === "HEAD") reads += Number(r.n);
      else writes += Number(r.n);
    }
    return {
      total: reads + writes,
      reads,
      writes,
      oldestAt: toDate(span?.oldest),
      newestAt: toDate(span?.newest),
    };
  }
  async attachmentStats(orgId: number): Promise<AttachmentStats> {
    const [row] = await this.db
      .select({
        n: sql<number>`count(*)`,
        bytes: sql<string>`coalesce(sum(${messageAttachments.byteSize}), 0)`,
      })
      .from(messageAttachments)
      .where(eq(messageAttachments.organizationId, orgId));
    return { count: Number(row?.n ?? 0), totalBytes: Number(row?.bytes ?? 0) };
  }
  /**
   * Last recorded audit activity per user in this org. DocTurn has no
   * `last_login` column, so this is the ONLY genuine activity signal available —
   * the stale-accounts control says so explicitly rather than inventing one.
   */
  async lastAuditActivityByUser(orgId: number): Promise<Map<number, Date>> {
    const rows = await this.db
      .select({
        userId: auditLogs.userId,
        last: sql<string | null>`max(${auditLogs.createdAt})`,
      })
      .from(auditLogs)
      .where(
        and(eq(auditLogs.organizationId, orgId), isNotNull(auditLogs.userId)),
      )
      .groupBy(auditLogs.userId);
    const out = new Map<number, Date>();
    for (const r of rows) {
      const at = toDate(r.last);
      if (r.userId != null && at) out.set(r.userId, at);
    }
    return out;
  }
  /** See {@link GlobalRowCounts} — integers only, deliberately no rows. */
  async globalRowCounts(): Promise<GlobalRowCounts> {
    const [orgs] = await this.db.select({ n: sql<number>`count(*)` }).from(organizations);
    const [us] = await this.db.select({ n: sql<number>`count(*)` }).from(users);
    const [pt] = await this.db.select({ n: sql<number>`count(*)` }).from(patients);
    const [asg] = await this.db.select({ n: sql<number>`count(*)` }).from(assignments);
    const [al] = await this.db.select({ n: sql<number>`count(*)` }).from(auditLogs);
    return {
      organizations: Number(orgs?.n ?? 0),
      users: Number(us?.n ?? 0),
      patients: Number(pt?.n ?? 0),
      assignments: Number(asg?.n ?? 0),
      auditLogs: Number(al?.n ?? 0),
    };
  }

  // ── comms KPIs ─────────────────────────────────────────────────────────────
  // Average seconds from a STAT message being sent to the EARLIEST recipient
  // acknowledgement (excluding the sender's own delivery row). Null when no STAT
  // message in the window has been acknowledged. Durations are averaged in JS to
  // stay dialect-agnostic (pglite in tests, Postgres in prod).
  async avgStatAckSeconds(orgId: number, since: Date) {
    const rows = await this.db
      .select({
        createdAt: messages.createdAt,
        ackAt: sql<string | Date>`min(${messageDeliveryStatus.acknowledgedAt})`,
      })
      .from(messages)
      .innerJoin(
        messageDeliveryStatus,
        eq(messageDeliveryStatus.messageId, messages.id),
      )
      .where(
        and(
          eq(messages.organizationId, orgId),
          eq(messages.priority, "stat"),
          gte(messages.createdAt, since),
          isNull(messages.deletedAt),
          isNotNull(messageDeliveryStatus.acknowledgedAt),
          sql`${messageDeliveryStatus.userId} <> ${messages.senderId}`,
        ),
      )
      .groupBy(messages.id, messages.createdAt);
    const durs = rows
      .filter((r) => r.ackAt != null)
      .map(
        (r) =>
          (new Date(r.ackAt as string | Date).getTime() -
            new Date(r.createdAt).getTime()) /
          1000,
      )
      .filter((s) => s >= 0);
    if (!durs.length) return null;
    return Math.round(durs.reduce((a, b) => a + b, 0) / durs.length);
  }
  // Average seconds from a consult being requested (createdAt) to the consultant
  // responding (respondedAt). Null when no consult in the window has a response.
  async avgConsultResponseSeconds(orgId: number, since: Date) {
    const rows = await this.db
      .select({
        createdAt: patientConsults.createdAt,
        respondedAt: patientConsults.respondedAt,
      })
      .from(patientConsults)
      .where(
        and(
          eq(patientConsults.organizationId, orgId),
          gte(patientConsults.createdAt, since),
          isNotNull(patientConsults.respondedAt),
        ),
      );
    const durs = rows
      .filter((r) => r.respondedAt != null)
      .map(
        (r) =>
          (new Date(r.respondedAt as Date).getTime() -
            new Date(r.createdAt).getTime()) /
          1000,
      )
      .filter((s) => s >= 0);
    if (!durs.length) return null;
    return Math.round(durs.reduce((a, b) => a + b, 0) / durs.length);
  }

  // ── users (extended) ─────────────────────────────────────────────────────────
  async updateUser(id: number, patch: Partial<User>) {
    const [row] = await this.db
      .update(users)
      .set(patch)
      .where(eq(users.id, id))
      .returning();
    return row;
  }
  async listOrganizations() {
    return this.db.select().from(organizations).orderBy(asc(organizations.id));
  }
  async deleteOrganization(id: number) {
    // Full cascade: remove every org-scoped row (and the user-dependent rows
    // those imply) in FK-safe order — children before parents — then the users
    // and finally the org itself. This lets a developer delete an entire tenant
    // from the Danger Zone, matching how platforms (GitHub/Stripe) delete orgs.
    //
    // EXCEPT the compliance trail: audit_logs / phi_access_logs /
    // security_incidents are FK-bound to organizations + users, so they cannot
    // stay behind — but §164.316(b)(2)(i) requires six years of retention. They
    // are copied into `retained_compliance_records` FIRST (denormalized, no FKs)
    // and only then deleted, so the history outlives the tenant.
    await this.archiveComplianceRecords(id, "organization_deleted");

    const orgUsers = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.organizationId, id));
    const userIds = orgUsers.map((u) => u.id);
    const orgMessages = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.organizationId, id));
    const messageIds = orgMessages.map((m) => m.id);

    // leaf rows that point at messages / broadcasts / assignments
    // Attachments reference messages(id) — delete them before the messages, or
    // the whole cascade fails with a FK violation (surfaced as 409
    // org_has_linked_records for any tenant that ever uploaded a file).
    await this.db.delete(messageAttachments).where(eq(messageAttachments.organizationId, id));
    if (messageIds.length) {
      // Belt and braces: an attachment uploaded by a since-moved user could
      // carry a different organization_id while still pointing at this org's
      // message. Clear those by message id too.
      await this.db.delete(messageAttachments).where(inArray(messageAttachments.messageId, messageIds));
      await this.db.delete(messageDeliveryStatus).where(inArray(messageDeliveryStatus.messageId, messageIds));
    }
    await this.db.delete(broadcastAcknowledgments).where(eq(broadcastAcknowledgments.organizationId, id));
    await this.db.delete(assignments).where(eq(assignments.organizationId, id));
    await this.db.delete(patientConsults).where(eq(patientConsults.organizationId, id));
    await this.db.delete(messages).where(eq(messages.organizationId, id));
    await this.db.delete(conversations).where(eq(conversations.organizationId, id));
    await this.db.delete(emergencyBroadcasts).where(eq(emergencyBroadcasts.organizationId, id));
    // patients reference hospitalists + users(er_doctor); delete before both
    await this.db.delete(patients).where(eq(patients.organizationId, id));
    await this.db.delete(hospitalists).where(eq(hospitalists.organizationId, id));
    await this.db.delete(careTeamMembers).where(eq(careTeamMembers.organizationId, id));
    await this.db.delete(deviceTokens).where(eq(deviceTokens.organizationId, id));
    await this.db.delete(userPreferences).where(eq(userPreferences.organizationId, id));
    // user-keyed rows with no org column
    if (userIds.length) {
      await this.db.delete(mfaBackupCodes).where(inArray(mfaBackupCodes.userId, userIds));
      await this.db.delete(mfaCredentials).where(inArray(mfaCredentials.userId, userIds));
    }
    // org-scoped config / logs (some reference users via updated_by / user_id)
    await this.db
      .delete(complianceAttestations)
      .where(eq(complianceAttestations.organizationId, id));
    await this.db.delete(suggestions).where(eq(suggestions.organizationId, id));
    await this.db.delete(featureFlags).where(eq(featureFlags.organizationId, id));
    await this.db.delete(orgSettings).where(eq(orgSettings.organizationId, id));
    await this.db.delete(equipment).where(eq(equipment.organizationId, id));
    await this.db.delete(beds).where(eq(beds.organizationId, id));
    await this.db.delete(departments).where(eq(departments.organizationId, id));
    await this.db.delete(smsHistory).where(eq(smsHistory.organizationId, id));
    await this.db.delete(phiAccessLogs).where(eq(phiAccessLogs.organizationId, id));
    await this.db.delete(securityIncidents).where(eq(securityIncidents.organizationId, id));
    await this.db.delete(auditLogs).where(eq(auditLogs.organizationId, id));
    await this.db.delete(pendingRegistrations).where(eq(pendingRegistrations.organizationId, id));
    await this.db.delete(landingPageSettings).where(eq(landingPageSettings.organizationId, id));
    await this.db.delete(contactPageSettings).where(eq(contactPageSettings.organizationId, id));
    // now the users, then the org
    await this.db.delete(users).where(eq(users.organizationId, id));
    await this.db.delete(organizations).where(eq(organizations.id, id));
  }
  async countOrgUsers(orgId: number): Promise<number> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.organizationId, orgId));
    return rows.length;
  }
  /** Every user across all tenants (developer cross-tenant view). */
  async listAllUsers(): Promise<User[]> {
    return this.db.select().from(users).orderBy(asc(users.organizationId), asc(users.id));
  }
  async listAllHospitalists(): Promise<Hospitalist[]> {
    return this.db.select().from(hospitalists);
  }
  /**
   * Delete a user and their cheap dependents (provider profile, care-team links,
   * device tokens, preferences, MFA). Throws on FK if the user authored content
   * (assignments/messages) — callers convert that to a 409.
   */
  async deleteUser(id: number): Promise<void> {
    await this.db.delete(careTeamMembers).where(eq(careTeamMembers.ownerUserId, id));
    await this.db.delete(careTeamMembers).where(eq(careTeamMembers.memberUserId, id));
    await this.db.delete(deviceTokens).where(eq(deviceTokens.userId, id));
    await this.db.delete(userPreferences).where(eq(userPreferences.userId, id));
    await this.db.delete(mfaBackupCodes).where(eq(mfaBackupCodes.userId, id));
    await this.db.delete(mfaCredentials).where(eq(mfaCredentials.userId, id));
    await this.db.delete(hospitalists).where(eq(hospitalists.userId, id));
    await this.db.delete(users).where(eq(users.id, id));
  }

  // ── MFA ──────────────────────────────────────────────────────────────────────
  async getMfaCredential(userId: number) {
    const [row] = await this.db
      .select()
      .from(mfaCredentials)
      .where(eq(mfaCredentials.userId, userId));
    return row;
  }
  async upsertMfaCredential(userId: number, secret: string) {
    await this.db.delete(mfaCredentials).where(eq(mfaCredentials.userId, userId));
    const [row] = await this.db
      .insert(mfaCredentials)
      .values({ userId, secret, activated: false })
      .returning();
    return row!;
  }
  async activateMfaCredential(userId: number) {
    await this.db
      .update(mfaCredentials)
      .set({ activated: true })
      .where(eq(mfaCredentials.userId, userId));
  }
  async replaceBackupCodes(userId: number, hashes: string[]) {
    await this.db.delete(mfaBackupCodes).where(eq(mfaBackupCodes.userId, userId));
    if (hashes.length === 0) return;
    await this.db
      .insert(mfaBackupCodes)
      .values(hashes.map((codeHash) => ({ userId, codeHash })));
  }
  async consumeBackupCode(userId: number, codeHash: string): Promise<boolean> {
    const [row] = await this.db
      .select()
      .from(mfaBackupCodes)
      .where(
        and(
          eq(mfaBackupCodes.userId, userId),
          eq(mfaBackupCodes.codeHash, codeHash),
          isNull(mfaBackupCodes.usedAt),
        ),
      );
    if (!row) return false;
    await this.db
      .update(mfaBackupCodes)
      .set({ usedAt: new Date() })
      .where(eq(mfaBackupCodes.id, row.id));
    return true;
  }

  // ── care teams ─────────────────────────────────────────────────────────────────
  async listCareTeamOwnedBy(orgId: number, ownerUserId: number) {
    return this.db
      .select()
      .from(careTeamMembers)
      .where(
        and(
          eq(careTeamMembers.organizationId, orgId),
          eq(careTeamMembers.ownerUserId, ownerUserId),
        ),
      );
  }
  async getCareTeamMember(
    orgId: number,
    ownerUserId: number,
    memberUserId: number,
  ) {
    const [row] = await this.db
      .select()
      .from(careTeamMembers)
      .where(
        and(
          eq(careTeamMembers.organizationId, orgId),
          eq(careTeamMembers.ownerUserId, ownerUserId),
          eq(careTeamMembers.memberUserId, memberUserId),
        ),
      );
    return row;
  }
  async addCareTeamMember(row: Omit<CareTeamMember, "id" | "createdAt">) {
    const [created] = await this.db
      .insert(careTeamMembers)
      .values(row)
      .returning();
    return created!;
  }
  async updateCareTeamMember(
    orgId: number,
    ownerUserId: number,
    memberUserId: number,
    patch: Partial<CareTeamMember>,
  ) {
    const [row] = await this.db
      .update(careTeamMembers)
      .set(patch)
      .where(
        and(
          eq(careTeamMembers.organizationId, orgId),
          eq(careTeamMembers.ownerUserId, ownerUserId),
          eq(careTeamMembers.memberUserId, memberUserId),
        ),
      )
      .returning();
    return row;
  }
  async deleteCareTeamMember(
    orgId: number,
    ownerUserId: number,
    memberUserId: number,
  ) {
    await this.db
      .delete(careTeamMembers)
      .where(
        and(
          eq(careTeamMembers.organizationId, orgId),
          eq(careTeamMembers.ownerUserId, ownerUserId),
          eq(careTeamMembers.memberUserId, memberUserId),
        ),
      );
  }
  /** The on-call unit user ids for an attending: {owner} ∪ on-call members. */
  async unitUserIds(orgId: number, ownerUserId: number): Promise<number[]> {
    const members = await this.listCareTeamOwnedBy(orgId, ownerUserId);
    return [
      ownerUserId,
      ...members.filter((m) => m.onCall).map((m) => m.memberUserId),
    ];
  }

  // ── consults ─────────────────────────────────────────────────────────────────
  async listConsultsForPatient(orgId: number, patientId: number) {
    return this.db
      .select()
      .from(patientConsults)
      .where(
        and(
          eq(patientConsults.organizationId, orgId),
          eq(patientConsults.patientId, patientId),
        ),
      );
  }
  async listActiveConsults(orgId: number) {
    // Include accepted/declined so the board can show who responded (and who
    // hasn't) — only fully closed consults drop off.
    return this.db
      .select()
      .from(patientConsults)
      .where(
        and(
          eq(patientConsults.organizationId, orgId),
          inArray(patientConsults.status, ["requested", "accepted", "declined", "active"]),
        ),
      );
  }
  async createConsult(
    row: Omit<PatientConsult, "id" | "createdAt" | "respondedAt" | "consultantName">
      & { respondedAt?: Date | null; consultantName?: string | null },
  ) {
    const [created] = await this.db
      .insert(patientConsults)
      .values(row)
      .returning();
    return created!;
  }
  async getConsult(orgId: number, id: number) {
    const [row] = await this.db
      .select()
      .from(patientConsults)
      .where(
        and(
          eq(patientConsults.organizationId, orgId),
          eq(patientConsults.id, id),
        ),
      );
    return row;
  }
  async updateConsult(orgId: number, id: number, patch: Partial<PatientConsult>) {
    const [row] = await this.db
      .update(patientConsults)
      .set(patch)
      .where(
        and(
          eq(patientConsults.organizationId, orgId),
          eq(patientConsults.id, id),
        ),
      )
      .returning();
    return row;
  }
  /** All non-terminal assignments for the org's patients (board "responsible"). */
  async latestAssignmentByPatient(orgId: number) {
    const rows = await this.listAssignments(orgId); // already newest-first
    const map = new Map<number, Assignment>();
    for (const a of rows) if (!map.has(a.patientId)) map.set(a.patientId, a);
    return map;
  }

  // ── registrations ────────────────────────────────────────────────────────────
  async createPendingRegistration(
    row: Omit<PendingRegistration, "id" | "createdAt">,
  ) {
    const [created] = await this.db
      .insert(pendingRegistrations)
      .values(row)
      .returning();
    return created!;
  }
  async listPendingRegistrations(orgId: number) {
    return this.db
      .select()
      .from(pendingRegistrations)
      .where(
        and(
          eq(pendingRegistrations.organizationId, orgId),
          eq(pendingRegistrations.status, "pending"),
        ),
      );
  }
  async getPendingRegistration(orgId: number, id: number) {
    const [row] = await this.db
      .select()
      .from(pendingRegistrations)
      .where(
        and(
          eq(pendingRegistrations.organizationId, orgId),
          eq(pendingRegistrations.id, id),
        ),
      );
    return row;
  }
  async updatePendingRegistration(
    orgId: number,
    id: number,
    patch: Partial<PendingRegistration>,
  ) {
    const [row] = await this.db
      .update(pendingRegistrations)
      .set(patch)
      .where(
        and(
          eq(pendingRegistrations.organizationId, orgId),
          eq(pendingRegistrations.id, id),
        ),
      )
      .returning();
    return row;
  }

  // ── resources ──────────────────────────────────────────────────────────────────
  async listDepartments(orgId: number): Promise<Department[]> {
    return this.db
      .select()
      .from(departments)
      .where(eq(departments.organizationId, orgId));
  }
  async createDepartment(row: Omit<Department, "id">) {
    const [created] = await this.db.insert(departments).values(row).returning();
    return created!;
  }
  async listBeds(orgId: number): Promise<Bed[]> {
    return this.db.select().from(beds).where(eq(beds.organizationId, orgId));
  }
  async createBed(row: Omit<Bed, "id">) {
    const [created] = await this.db.insert(beds).values(row).returning();
    return created!;
  }
  async updateBed(orgId: number, id: number, patch: Partial<Bed>) {
    const [row] = await this.db
      .update(beds)
      .set(patch)
      .where(and(eq(beds.organizationId, orgId), eq(beds.id, id)))
      .returning();
    return row;
  }
  async listEquipment(orgId: number): Promise<Equipment[]> {
    return this.db
      .select()
      .from(equipment)
      .where(eq(equipment.organizationId, orgId));
  }
  async createEquipment(row: Omit<Equipment, "id">) {
    const [created] = await this.db.insert(equipment).values(row).returning();
    return created!;
  }
  async updateEquipment(orgId: number, id: number, patch: Partial<Equipment>) {
    const [row] = await this.db
      .update(equipment)
      .set(patch)
      .where(and(eq(equipment.organizationId, orgId), eq(equipment.id, id)))
      .returning();
    return row;
  }

  // ── broadcasts ───────────────────────────────────────────────────────────────
  async createBroadcast(row: Omit<EmergencyBroadcast, "id" | "createdAt">) {
    const [created] = await this.db
      .insert(emergencyBroadcasts)
      .values(row)
      .returning();
    return created!;
  }
  async getBroadcast(orgId: number, id: number) {
    const [row] = await this.db
      .select()
      .from(emergencyBroadcasts)
      .where(
        and(
          eq(emergencyBroadcasts.organizationId, orgId),
          eq(emergencyBroadcasts.id, id),
        ),
      );
    return row;
  }
  async listBroadcasts(orgId: number) {
    return this.db
      .select()
      .from(emergencyBroadcasts)
      .where(eq(emergencyBroadcasts.organizationId, orgId))
      .orderBy(desc(emergencyBroadcasts.createdAt));
  }
  async ackBroadcast(
    row: Omit<BroadcastAck, "id" | "acknowledgedAt">,
  ): Promise<void> {
    await this.db.insert(broadcastAcknowledgments).values(row);
  }
  async listBroadcastAcks(orgId: number, broadcastId: number) {
    return this.db
      .select()
      .from(broadcastAcknowledgments)
      .where(
        and(
          eq(broadcastAcknowledgments.organizationId, orgId),
          eq(broadcastAcknowledgments.broadcastId, broadcastId),
        ),
      );
  }

  // ── device tokens & sms ──────────────────────────────────────────────────────
  async upsertDeviceToken(row: Omit<DeviceToken, "id" | "createdAt">) {
    await this.db
      .insert(deviceTokens)
      .values(row)
      .onConflictDoUpdate({
        target: deviceTokens.token,
        set: { userId: row.userId, platform: row.platform },
      });
  }
  async deleteDeviceToken(userId: number, token: string) {
    await this.db
      .delete(deviceTokens)
      .where(
        and(eq(deviceTokens.userId, userId), eq(deviceTokens.token, token)),
      );
  }
  async listDeviceTokens(userId: number) {
    return this.db
      .select()
      .from(deviceTokens)
      .where(eq(deviceTokens.userId, userId));
  }
  async appendSmsHistory(row: {
    organizationId: number | null;
    userId: number | null;
    toPhone: string;
    body: string;
    carrier: string;
  }) {
    await this.db.insert(smsHistory).values(row);
  }
  async listSmsHistory(orgId: number) {
    return this.db
      .select()
      .from(smsHistory)
      .where(eq(smsHistory.organizationId, orgId))
      .orderBy(desc(smsHistory.createdAt));
  }

  // ── feature flags (C2) ───────────────────────────────────────────────────────
  async listFeatureFlags(orgId: number): Promise<FeatureFlag[]> {
    return this.db
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.organizationId, orgId));
  }
  async setFeatureFlag(
    orgId: number,
    flag: string,
    enabled: boolean,
    variant?: string | null,
  ) {
    await this.db
      .insert(featureFlags)
      .values({ organizationId: orgId, flag, enabled, variant: variant ?? null })
      .onConflictDoUpdate({
        target: [featureFlags.organizationId, featureFlags.flag],
        set: { enabled, variant: variant ?? null },
      });
  }

  // ── suggestions (C3) ─────────────────────────────────────────────────────────
  async createSuggestion(row: {
    organizationId: number;
    scope: "org" | "user";
    key: string;
    proposedValue: unknown;
    evidence: string;
  }) {
    await this.db
      .insert(suggestions)
      .values({ ...row, status: "pending" });
  }
  async listSuggestions(orgId: number) {
    return this.db
      .select()
      .from(suggestions)
      .where(eq(suggestions.organizationId, orgId))
      .orderBy(desc(suggestions.createdAt));
  }
  async getSuggestion(orgId: number, id: number) {
    const [row] = await this.db
      .select()
      .from(suggestions)
      .where(
        and(eq(suggestions.organizationId, orgId), eq(suggestions.id, id)),
      );
    return row;
  }
  async setSuggestionStatus(
    orgId: number,
    id: number,
    status: "accepted" | "dismissed",
  ) {
    await this.db
      .update(suggestions)
      .set({ status })
      .where(
        and(eq(suggestions.organizationId, orgId), eq(suggestions.id, id)),
      );
  }
  async hasPendingSuggestion(orgId: number, key: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: suggestions.id })
      .from(suggestions)
      .where(
        and(
          eq(suggestions.organizationId, orgId),
          eq(suggestions.key, key),
          eq(suggestions.status, "pending"),
        ),
      )
      .limit(1);
    return !!row;
  }

  // ── CMS ────────────────────────────────────────────────────────────────────────
  async getCms(key: "landing" | "contact", orgId: number | null) {
    if (key === "landing") {
      const [row] = await this.db
        .select()
        .from(landingPageSettings)
        .where(
          orgId == null
            ? isNull(landingPageSettings.organizationId)
            : eq(landingPageSettings.organizationId, orgId),
        );
      return row ?? null;
    }
    const [row] = await this.db
      .select()
      .from(contactPageSettings)
      .where(
        orgId == null
          ? isNull(contactPageSettings.organizationId)
          : eq(contactPageSettings.organizationId, orgId),
      );
    return row ?? null;
  }
  async setCms(
    key: "landing" | "contact",
    orgId: number | null,
    value: Record<string, unknown>,
  ) {
    const table = key === "landing" ? landingPageSettings : contactPageSettings;
    const existing = await this.getCms(key, orgId);
    if (existing) {
      await this.db
        .update(table)
        .set({ ...value, updatedAt: new Date() } as never)
        .where(eq(table.id, existing.id));
    } else {
      await this.db
        .insert(table)
        .values({ organizationId: orgId, ...value } as never);
    }
  }

  // ── attachment metadata by id (forwarded references) ──────────────────────
  /** Metadata only (never dataBase64) for a set of attachment ids in one org. */
  async listAttachmentMetaByIds(orgId: number, ids: number[]) {
    if (ids.length === 0) return [];
    return this.db
      .select({
        id: messageAttachments.id,
        messageId: messageAttachments.messageId,
        fileName: messageAttachments.fileName,
        mimeType: messageAttachments.mimeType,
        byteSize: messageAttachments.byteSize,
      })
      .from(messageAttachments)
      .where(
        and(
          eq(messageAttachments.organizationId, orgId),
          inArray(messageAttachments.id, ids),
        ),
      );
  }

  // ── broadcast acks (org-wide listing) ─────────────────────────────────────
  /** Every ack for a set of broadcasts in one org (for the catch-up list). */
  async listBroadcastAcksForBroadcasts(orgId: number, broadcastIds: number[]) {
    if (broadcastIds.length === 0) return [];
    return this.db
      .select()
      .from(broadcastAcknowledgments)
      .where(
        and(
          eq(broadcastAcknowledgments.organizationId, orgId),
          inArray(broadcastAcknowledgments.broadcastId, broadcastIds),
        ),
      );
  }
  /** Last N broadcasts for an org, newest first. */
  async listRecentBroadcasts(orgId: number, limit: number) {
    return this.db
      .select()
      .from(emergencyBroadcasts)
      .where(eq(emergencyBroadcasts.organizationId, orgId))
      .orderBy(desc(emergencyBroadcasts.createdAt), desc(emergencyBroadcasts.id))
      .limit(limit);
  }

  // ── message templates ─────────────────────────────────────────────────────
  /** Org-wide templates plus the caller's personal ones. */
  async listMessageTemplates(orgId: number, userId: number): Promise<MessageTemplate[]> {
    const rows = await this.db
      .select()
      .from(messageTemplates)
      .where(eq(messageTemplates.organizationId, orgId))
      .orderBy(asc(messageTemplates.title), asc(messageTemplates.id));
    return rows.filter((t) => t.ownerUserId == null || t.ownerUserId === userId);
  }
  async getMessageTemplate(orgId: number, id: number) {
    const [row] = await this.db
      .select()
      .from(messageTemplates)
      .where(
        and(eq(messageTemplates.organizationId, orgId), eq(messageTemplates.id, id)),
      );
    return row;
  }
  async createMessageTemplate(t: Omit<MessageTemplate, "id" | "createdAt">) {
    const [row] = await this.db.insert(messageTemplates).values(t).returning();
    return row!;
  }
  async updateMessageTemplate(
    orgId: number,
    id: number,
    patch: Partial<Pick<MessageTemplate, "title" | "body" | "priority">>,
  ) {
    const [row] = await this.db
      .update(messageTemplates)
      .set(patch)
      .where(
        and(eq(messageTemplates.organizationId, orgId), eq(messageTemplates.id, id)),
      )
      .returning();
    return row;
  }
  async deleteMessageTemplate(orgId: number, id: number) {
    await this.db
      .delete(messageTemplates)
      .where(
        and(eq(messageTemplates.organizationId, orgId), eq(messageTemplates.id, id)),
      );
  }
}

/** Default singleton bound to the process database. Tests construct their own. */
let _storage: DatabaseStorage | null = null;
export function storage(): DatabaseStorage {
  if (!_storage) _storage = new DatabaseStorage();
  return _storage;
}
export function setStorage(s: DatabaseStorage) {
  _storage = s;
}
