import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, like, lt, lte, ne, or, sql } from "drizzle-orm";
import type { AuditInput } from "./audit.js";
import type { DbType } from "./db.js";
import { attachmentStoreFor, FS_REF_PREFIX } from "./services/attachment-store.js";
import { getDb } from "./db.js";
import { normalizeUsername, usernameKey } from "./usernames.js";
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
  orgIntegrationCredentials,
  orgSettings,
  organizations,
  patientConsults,
  patients,
  pendingRegistrations,
  unroutedRegistrations,
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
  type OrgIntegrationCredential,
  type PatientConsult,
  type PendingRegistration,
  type Patient,
  type RetainedComplianceRecord,
  type User,
} from "@shared/schema";

/** Insert shape for a patient — the EHR id (MRN/CSN) is optional. */
export type NewPatient = Omit<Patient, "id" | "createdAt" | "ehrId"> & { ehrId?: string | null };

/** The executor handed to a `db.transaction()` callback. */
type Tx = Parameters<Parameters<DbType["transaction"]>[0]>[0];

/** Insert shape for one row of the six-year retained compliance archive. */
export type NewRetainedComplianceRecord = Omit<RetainedComplianceRecord, "id" | "archivedAt">;

/**
 * WHERE clause selecting a tenant's rows in a table whose organization_id is
 * nullable but whose user_id is one of the tenant's users: `org = id OR
 * user_id IN (users)`. Used by the archive + cascade so a user-keyed row with
 * a NULL (or foreign) organization is still treated as the tenant's.
 */
function tenantRowsScope(orgId: number, userIds: number[]) {
  return (
    orgCol: typeof auditLogs.organizationId | typeof phiAccessLogs.organizationId | typeof securityIncidents.organizationId | typeof smsHistory.organizationId,
    userCol: typeof auditLogs.userId | typeof phiAccessLogs.userId | typeof securityIncidents.userId | typeof smsHistory.userId,
  ) => (userIds.length ? or(eq(orgCol, orgId), inArray(userCol, userIds))! : eq(orgCol, orgId));
}

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

/** Thread page size: default when a caller names none, and the hard cap. */
export const MESSAGE_PAGE_DEFAULT = 50;
export const MESSAGE_PAGE_MAX = 200;
export interface MessagePageOptions {
  limit?: number;
  beforeId?: number;
  afterId?: number;
}
function clampPage(limit: number | undefined): number {
  const n = Number.isFinite(limit) ? Math.floor(limit as number) : MESSAGE_PAGE_DEFAULT;
  return Math.min(MESSAGE_PAGE_MAX, Math.max(1, n));
}

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
/**
 * Remove the stored bytes behind attachment refs (a no-op for inline "db" refs,
 * an unlink for "fsenc:" files). Returns how many could NOT be removed; the
 * caller decides whether that is worth an audit row. Never throws.
 */
export async function deleteAttachmentFiles(refs: string[]): Promise<number> {
  let failures = 0;
  for (const ref of refs) {
    try {
      await attachmentStoreFor(ref).delete(ref);
    } catch {
      failures++;
    }
  }
  return failures;
}

/** What a retention purge removed for one org (audited by the sweep). */
export interface RetentionPurgeResult {
  messages: number;
  /** Attachment rows removed with those messages. */
  attachments: number;
  /** Encrypted attachment FILES the store could not remove (rows are gone). */
  fileDeleteFailures: number;
}

/** What an orphan (never-linked) attachment purge removed for one org. */
export interface OrphanPurgeResult {
  attachments: number;
  fileDeleteFailures: number;
}

/** What a patient purge removed, per table (audited by the callers). */
export interface PurgeResult {
  patients: number;
  assignments: number;
  consults: number;
  conversations: number;
  messages: number;
  attachments: number;
}

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
  createUser(user: Omit<User, "id" | "createdAt" | "mustChangePassword" | "disabledAt" | "passwordChangedAt"> & Partial<Pick<User, "mustChangePassword" | "disabledAt" | "passwordChangedAt">>): Promise<User>;

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
  purgeMessagesOlderThan(orgId: number, cutoff: Date): Promise<RetentionPurgeResult>;
  purgeUnlinkedAttachmentsOlderThan(
    orgId: number,
    cutoff: Date,
  ): Promise<OrphanPurgeResult>;
  /** File ids ("fsenc:" refs without the prefix) of this org's encrypted-file attachments. */
  listEncryptedAttachmentFileIds(orgId: number): Promise<string[]>;
  /**
   * The same across EVERY tenant — used only to decide whether a file on disk
   * is referenced at all (files carry no tenant). Never returned to a caller.
   */
  listAllEncryptedAttachmentFileIds(): Promise<string[]>;
  /** A covering/forward copy of `originalMessageId` already in `conversationId`, if any. */
  findForwardedCopy(
    orgId: number,
    conversationId: number,
    originalMessageId: number,
  ): Promise<Message | undefined>;
  /** Every covering copy (DND / escalation) made of an original message. */
  listCoveringCopies(orgId: number, originalMessageId: number): Promise<Message[]>;
  listConsultsForOrg(orgId: number): Promise<PatientConsult[]>;
  countMessagesSince(orgId: number, since: Date): Promise<number>;
  /** Assignment rows created in the org at or after `since` (developer console). */
  countAssignmentsSince(orgId: number, since: Date): Promise<number>;
  listStatAckLatencies(orgId: number): Promise<number[]>;
  /**
   * One bounded page of a thread, ascending by id (A.CON-SHO-65). Without a
   * cursor: the newest `limit`; `beforeId`: the newest `limit` older than it;
   * `afterId`: the oldest `limit` newer than it. `hasMore` = the server holds
   * more in that direction. `limit` is clamped to 1..MESSAGE_PAGE_MAX.
   */
  listMessagesPage(
    orgId: number,
    conversationId: number,
    opts?: MessagePageOptions,
  ): Promise<{ messages: Message[]; hasMore: boolean }>;
  /** The newest live message of each conversation (one indexed read). */
  lastMessagesFor(orgId: number, conversationIds: number[]): Promise<Map<number, Message>>;
  /** Per conversation: live messages whose delivery row for `userId` is unread. */
  unreadCountsFor(
    orgId: number,
    userId: number,
    conversationIds: number[],
  ): Promise<Map<number, number>>;
  /**
   * Live messages with id > afterId across `conversationIds`, ascending,
   * at most `limit` (reconnect resync).
   */
  listMessagesAfter(
    orgId: number,
    conversationIds: number[],
    afterId: number,
    limit: number,
  ): Promise<{ messages: Message[]; hasMore: boolean }>;
  /**
   * Recipient delivery rows (never the sender's own) of live messages with
   * id <= maxMessageId in `conversationIds` that were delivered, read,
   * acknowledged, STAT-re-alerted or STAT-escalated at/after `since` —
   * receipts a disconnected client missed.
   */
  listReceiptChangesSince(
    orgId: number,
    conversationIds: number[],
    since: Date,
    maxMessageId: number,
    limit: number,
  ): Promise<Array<MessageDeliveryStatus & { conversationId: number }>>;
  /** Messages in `conversationIds` recalled (soft-deleted) at/after `since`. */
  listRecalledSince(
    orgId: number,
    conversationIds: number[],
    since: Date,
    limit: number,
  ): Promise<Array<{ messageId: number; conversationId: number }>>;
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
  /** `at` (default now) is the time stored — the sweep sends the same value
   * in its STAT_REALERT / STAT_ESCALATED frames. */
  markDeliveryRealerted(deliveryId: number, at?: Date): Promise<void>;
  markDeliveryEscalated(deliveryId: number, at?: Date): Promise<void>;

  // message attachments
  createAttachment(a: {
    organizationId: number;
    uploaderId: number;
    fileName: string;
    mimeType: string;
    byteSize: number;
    dataBase64: string;
    durationMs?: number | null;
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
  mutateOrgSettings<R>(
    orgId: number,
    keys: readonly string[],
    updatedBy: number | null,
    fn: (current: Record<string, unknown>) => { write?: Record<string, unknown>; result: R },
  ): Promise<R>;
  // per-hospital integration credentials (ciphertext only — server/integrations/)
  getIntegrationCredential(orgId: number, integrationId: string): Promise<OrgIntegrationCredential | undefined>;
  listIntegrationCredentials(integrationId?: string): Promise<OrgIntegrationCredential[]>;
  upsertIntegrationCredential(
    row: Omit<OrgIntegrationCredential, "id" | "updatedAt">,
  ): Promise<OrgIntegrationCredential>;
  deleteIntegrationCredential(orgId: number, integrationId: string): Promise<boolean>;
  getUserPreference(userId: number, key: string): Promise<unknown>;
  setUserPreference(
    orgId: number,
    userId: number,
    key: string,
    value: unknown,
  ): Promise<void>;
  getFeatureFlag(orgId: number, flag: string): Promise<boolean>;

  // audit & phi
  /** Insert one audit row and return it (callers cross-reference its id). */
  appendAudit(row: AuditInput): Promise<AuditLog>;
  logPhiAccess(row: {
    organizationId: number;
    userId: number;
    /** The real operator when `userId` is an impersonated identity. */
    impersonatorUserId?: number | null;
    resource: string;
    /** Id of the specific record read (conversation id, patient id, …). */
    resourceId?: number | null;
    /** Patient the read concerns, when the record is patient-linked. */
    patientId?: number | null;
    method: string;
    ip?: string;
    userAgent?: string;
  }): Promise<void>;
  countPhiAccess(orgId: number, userId?: number): Promise<number>;
  /** Copy an org's audit/PHI/security rows into the six-year retained archive. */
  archiveComplianceRecords(orgId: number, reason: string): Promise<number>;
  /** Write one record straight into the retained archive (e.g. the deletion of the tenant itself). */
  appendRetainedComplianceRecord(
    row: NewRetainedComplianceRecord,
  ): Promise<RetainedComplianceRecord>;
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
  /**
   * Case- and surrounding-whitespace-insensitive (server/usernames.ts): "Chen"
   * and "chen " find the account "chen". The unique index on
   * (organization_id, lower(username)) guarantees at most one match.
   */
  async getUserByUsername(orgId: number, username: string) {
    const [row] = await this.db
      .select()
      .from(users)
      .where(
        and(eq(users.organizationId, orgId), sql`lower(${users.username}) = ${usernameKey(username)}`),
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
  async createUser(user: Omit<User, "id" | "createdAt" | "mustChangePassword" | "disabledAt" | "passwordChangedAt"> & Partial<Pick<User, "mustChangePassword" | "disabledAt" | "passwordChangedAt">>) {
    // Stored trimmed; uniqueness is on lower(username) (server/db.ts).
    const [row] = await this.db.insert(users).values({ ...user, username: normalizeUsername(user.username) }).returning();
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
  /**
   * Purge patients older than the window (0 = all) together with EVERYTHING
   * that references them — assignments, consults, and patient-linked care-team
   * conversations with their messages, delivery rows and attachments — in ONE
   * transaction. Previously the patient delete FK-failed on a linked
   * conversation after assignments/consults were already gone (silent partial
   * delete, hung request, stalled auto-clean). Returns per-table counts so the
   * caller can audit exactly what left the system.
   */
  async purgeOldPatients(orgId: number, olderThanMs: number): Promise<PurgeResult> {
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
    const empty: PurgeResult = { patients: 0, assignments: 0, consults: 0, conversations: 0, messages: 0, attachments: 0 };
    if (!ids.length) return empty;

    const { result } = await this.purgePatientRows(orgId, ids);
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
    return result;
  }

  /**
   * Remove ONE patient (the Patient board's "Remove admission") with the same
   * single transaction as the purge — assignments, consults, patient-linked
   * threads, their messages, delivery rows and attachment files. Census moves
   * the way the assignment state machine moves it (services/assignments.ts):
   * only a provider who had ACCEPTED this patient loses one; nobody else's
   * (possibly director-set) census is recomputed. Null when the patient is not
   * this org's.
   */
  async deletePatient(orgId: number, id: number): Promise<PurgeResult | null> {
    const patient = await this.getPatient(orgId, id);
    if (!patient) return null;
    const { result, acceptedHospitalistIds } = await this.purgePatientRows(orgId, [id]);
    const drop = new Map<number, number>();
    for (const hid of acceptedHospitalistIds) drop.set(hid, (drop.get(hid) ?? 0) + 1);
    for (const [hid, n] of drop) {
      const h = await this.getHospitalist(orgId, hid);
      if (h) await this.updateHospitalist(orgId, hid, { currentPatientCount: Math.max(0, h.currentPatientCount - n) });
    }
    return result;
  }

  /** The shared transactional delete behind purgeOldPatients and deletePatient. */
  private async purgePatientRows(
    orgId: number,
    ids: number[],
  ): Promise<{ result: PurgeResult; acceptedHospitalistIds: number[] }> {
    const acceptedHospitalistIds: number[] = [];
    const attachmentRefs: string[] = [];
    const result = await this.db.transaction(async (tx) => {
      // Patient-linked threads and everything hanging off them, leaves first.
      const convoRows = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.organizationId, orgId), inArray(conversations.patientId, ids)));
      const convoIds = convoRows.map((c) => c.id);
      let messageCount = 0;
      if (convoIds.length) {
        const msgRows = await tx
          .select({ id: messages.id })
          .from(messages)
          .where(inArray(messages.conversationId, convoIds));
        const msgIds = msgRows.map((m) => m.id);
        if (msgIds.length) {
          const atts = await tx
            .select({ ref: messageAttachments.dataBase64 })
            .from(messageAttachments)
            .where(inArray(messageAttachments.messageId, msgIds));
          attachmentRefs.push(...atts.map((a) => a.ref));
          await tx.delete(messageAttachments).where(inArray(messageAttachments.messageId, msgIds));
          await tx.delete(messageDeliveryStatus).where(inArray(messageDeliveryStatus.messageId, msgIds));
          await tx.delete(messages).where(inArray(messages.id, msgIds));
          messageCount = msgIds.length;
        }
        await tx.delete(conversations).where(inArray(conversations.id, convoIds));
      }
      const accepted = await tx
        .select({ hospitalistId: assignments.hospitalistId })
        .from(assignments)
        .where(and(eq(assignments.organizationId, orgId), inArray(assignments.patientId, ids), eq(assignments.status, "accepted")));
      acceptedHospitalistIds.push(...accepted.map((a) => a.hospitalistId));
      const gone = await tx
        .delete(assignments)
        .where(and(eq(assignments.organizationId, orgId), inArray(assignments.patientId, ids)))
        .returning({ id: assignments.id });
      const consultsGone = await tx
        .delete(patientConsults)
        .where(and(eq(patientConsults.organizationId, orgId), inArray(patientConsults.patientId, ids)))
        .returning({ id: patientConsults.id });
      await tx
        .delete(patients)
        .where(and(eq(patients.organizationId, orgId), inArray(patients.id, ids)));
      return {
        patients: ids.length,
        assignments: gone.length,
        consults: consultsGone.length,
        conversations: convoIds.length,
        messages: messageCount,
        attachments: attachmentRefs.length,
      } satisfies PurgeResult;
    });
    // Encrypted attachment files are removed only after the rows are committed
    // (best effort — an orphaned ciphertext file is unreadable without its row).
    for (const ref of attachmentRefs) {
      try { await attachmentStoreFor(ref).delete(ref); } catch { /* best effort */ }
    }
    return { result, acceptedHospitalistIds };
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
  async listMessagesPage(orgId: number, conversationId: number, opts: MessagePageOptions = {}) {
    const limit = clampPage(opts.limit);
    const conds = [
      eq(messages.organizationId, orgId),
      eq(messages.conversationId, conversationId),
      isNull(messages.deletedAt),
    ];
    if (opts.afterId != null) {
      // Forwards: the oldest `limit` newer than the cursor.
      conds.push(gt(messages.id, opts.afterId));
      const rows = await this.db
        .select()
        .from(messages)
        .where(and(...conds))
        .orderBy(asc(messages.id))
        .limit(limit + 1);
      return { messages: rows.slice(0, limit), hasMore: rows.length > limit };
    }
    // Backwards (or the newest page): read newest-first, return ascending.
    if (opts.beforeId != null) conds.push(lt(messages.id, opts.beforeId));
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(...conds))
      .orderBy(desc(messages.id))
      .limit(limit + 1);
    return { messages: rows.slice(0, limit).reverse(), hasMore: rows.length > limit };
  }
  async lastMessagesFor(orgId: number, conversationIds: number[]) {
    const out = new Map<number, Message>();
    if (conversationIds.length === 0) return out;
    const rows = await this.db
      .selectDistinctOn([messages.conversationId])
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, orgId),
          inArray(messages.conversationId, conversationIds),
          isNull(messages.deletedAt),
        ),
      )
      .orderBy(messages.conversationId, desc(messages.id));
    for (const r of rows) out.set(r.conversationId, r);
    return out;
  }
  async unreadCountsFor(orgId: number, userId: number, conversationIds: number[]) {
    const out = new Map<number, number>();
    if (conversationIds.length === 0) return out;
    const rows = await this.db
      .select({ conversationId: messages.conversationId, n: sql<number>`count(*)` })
      .from(messageDeliveryStatus)
      .innerJoin(messages, eq(messages.id, messageDeliveryStatus.messageId))
      .where(
        and(
          eq(messages.organizationId, orgId),
          inArray(messages.conversationId, conversationIds),
          isNull(messages.deletedAt),
          eq(messageDeliveryStatus.userId, userId),
          isNull(messageDeliveryStatus.readAt),
        ),
      )
      .groupBy(messages.conversationId);
    for (const r of rows) out.set(r.conversationId, Number(r.n));
    return out;
  }
  async listMessagesAfter(orgId: number, conversationIds: number[], afterId: number, limit: number) {
    if (conversationIds.length === 0) return { messages: [] as Message[], hasMore: false };
    const n = clampPage(limit);
    const rows = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, orgId),
          inArray(messages.conversationId, conversationIds),
          isNull(messages.deletedAt),
          gt(messages.id, afterId),
        ),
      )
      .orderBy(asc(messages.id))
      .limit(n + 1);
    return { messages: rows.slice(0, n), hasMore: rows.length > n };
  }
  async listReceiptChangesSince(
    orgId: number,
    conversationIds: number[],
    since: Date,
    maxMessageId: number,
    limit: number,
  ) {
    if (conversationIds.length === 0) return [];
    const rows = await this.db
      .select({ d: messageDeliveryStatus, conversationId: messages.conversationId })
      .from(messageDeliveryStatus)
      .innerJoin(messages, eq(messages.id, messageDeliveryStatus.messageId))
      .where(
        and(
          eq(messages.organizationId, orgId),
          inArray(messages.conversationId, conversationIds),
          isNull(messages.deletedAt),
          lte(messages.id, maxMessageId),
          ne(messageDeliveryStatus.userId, messages.senderId),
          or(
            gte(messageDeliveryStatus.deliveredAt, since),
            gte(messageDeliveryStatus.readAt, since),
            gte(messageDeliveryStatus.acknowledgedAt, since),
            // The STAT sweep's steps: a device whose socket was down when the
            // STAT_REALERT / STAT_ESCALATED frame went out still moves its
            // countdown on at reconnect (A.CON-MIN-18).
            gte(messageDeliveryStatus.realertedAt, since),
            gte(messageDeliveryStatus.escalatedAt, since),
          ),
        ),
      )
      .orderBy(asc(messageDeliveryStatus.id))
      .limit(Math.max(1, Math.floor(limit)));
    return rows.map((r) => ({ ...r.d, conversationId: r.conversationId }));
  }
  async listRecalledSince(orgId: number, conversationIds: number[], since: Date, limit: number) {
    if (conversationIds.length === 0) return [];
    return this.db
      .select({ messageId: messages.id, conversationId: messages.conversationId })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, orgId),
          inArray(messages.conversationId, conversationIds),
          gte(messages.deletedAt, since),
        ),
      )
      .orderBy(asc(messages.id))
      .limit(Math.max(1, Math.floor(limit)));
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
  async markDeliveryRealerted(deliveryId: number, at: Date = new Date()) {
    await this.db
      .update(messageDeliveryStatus)
      .set({ realertedAt: at })
      .where(eq(messageDeliveryStatus.id, deliveryId));
  }
  async markDeliveryEscalated(deliveryId: number, at: Date = new Date()) {
    await this.db
      .update(messageDeliveryStatus)
      .set({ escalatedAt: at })
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
    durationMs?: number | null;
  }) {
    const [row] = await this.db
      .insert(messageAttachments)
      .values({ ...a, durationMs: a.durationMs ?? null, messageId: null })
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
        durationMs: messageAttachments.durationMs,
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
  async purgeMessagesOlderThan(orgId: number, cutoff: Date): Promise<RetentionPurgeResult> {
    const old = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(eq(messages.organizationId, orgId), lt(messages.createdAt, cutoff)),
      );
    const ids = old.map((m) => m.id);
    if (ids.length === 0) return { messages: 0, attachments: 0, fileDeleteFailures: 0 };
    // Collect store refs first so encrypted attachment FILES are removed too,
    // not just the rows (otherwise ciphertext lingers on disk past retention).
    const atts = await this.db
      .select({ ref: messageAttachments.dataBase64 })
      .from(messageAttachments)
      .where(inArray(messageAttachments.messageId, ids));
    await this.db.transaction(async (tx) => {
      await tx.delete(messageAttachments).where(inArray(messageAttachments.messageId, ids));
      await tx.delete(messageDeliveryStatus).where(inArray(messageDeliveryStatus.messageId, ids));
      await tx.delete(messages).where(inArray(messages.id, ids));
    });
    const fileDeleteFailures = await deleteAttachmentFiles(atts.map((a) => a.ref));
    return { messages: ids.length, attachments: atts.length, fileDeleteFailures };
  }
  /**
   * Remove attachments that were uploaded but never linked to a message
   * (message_id NULL) before the cutoff — abandoned uploads whose bytes would
   * otherwise sit in the store forever. Rows first, then the encrypted files.
   */
  async purgeUnlinkedAttachmentsOlderThan(orgId: number, cutoff: Date): Promise<OrphanPurgeResult> {
    const gone = await this.db
      .delete(messageAttachments)
      .where(
        and(
          eq(messageAttachments.organizationId, orgId),
          isNull(messageAttachments.messageId),
          lt(messageAttachments.createdAt, cutoff),
        ),
      )
      .returning({ ref: messageAttachments.dataBase64 });
    if (gone.length === 0) return { attachments: 0, fileDeleteFailures: 0 };
    const fileDeleteFailures = await deleteAttachmentFiles(gone.map((a) => a.ref));
    return { attachments: gone.length, fileDeleteFailures };
  }
  async listEncryptedAttachmentFileIds(orgId: number) {
    const rows = await this.db
      .select({ ref: messageAttachments.dataBase64 })
      .from(messageAttachments)
      .where(
        and(
          eq(messageAttachments.organizationId, orgId),
          like(messageAttachments.dataBase64, `${FS_REF_PREFIX}%`),
        ),
      );
    return rows.map((r) => r.ref.slice(FS_REF_PREFIX.length));
  }
  async listAllEncryptedAttachmentFileIds() {
    const rows = await this.db
      .select({ ref: messageAttachments.dataBase64 })
      .from(messageAttachments)
      .where(like(messageAttachments.dataBase64, `${FS_REF_PREFIX}%`));
    return rows.map((r) => r.ref.slice(FS_REF_PREFIX.length));
  }
  async findForwardedCopy(orgId: number, conversationId: number, originalMessageId: number) {
    const [row] = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, orgId),
          eq(messages.conversationId, conversationId),
          isNull(messages.deletedAt),
          sql`${messages.forwardedFrom}->>'messageId' = ${String(originalMessageId)}`,
        ),
      )
      .limit(1);
    return row;
  }
  async listCoveringCopies(orgId: number, originalMessageId: number) {
    return this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, orgId),
          isNull(messages.deletedAt),
          sql`${messages.forwardedFrom}->>'messageId' = ${String(originalMessageId)}`,
          sql`${messages.forwardedFrom}->>'coveringFor' IS NOT NULL`,
        ),
      );
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
  /** Assignment rows created in the org at or after `since` (developer console). */
  async countAssignmentsSince(orgId: number, since: Date) {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(assignments)
      .where(and(eq(assignments.organizationId, orgId), gte(assignments.createdAt, since)));
    return Number(row?.n ?? 0);
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
  /**
   * Atomic read-modify-write of org settings that several admins edit at once
   * (the consult-service catalog, the org theme). Inside ONE transaction the
   * rows are locked (SELECT … FOR UPDATE; a missing row is created empty first
   * so there is something to lock), `fn` sees the CURRENT values and returns
   * what to write. Concurrent writers are serialized, so neither overwrites a
   * change it never saw. `fn` must be synchronous and side-effect free; a
   * `write` of undefined (or omitted keys) leaves those values untouched.
   */
  async mutateOrgSettings<R>(
    orgId: number,
    keys: readonly string[],
    updatedBy: number | null,
    fn: (current: Record<string, unknown>) => { write?: Record<string, unknown>; result: R },
  ): Promise<R> {
    return this.db.transaction(async (tx) => {
      for (const key of keys) {
        await tx
          .insert(orgSettings)
          .values({ organizationId: orgId, key, value: null, updatedBy: null })
          .onConflictDoNothing({ target: [orgSettings.organizationId, orgSettings.key] });
      }
      const rows = await tx
        .select()
        .from(orgSettings)
        .where(and(eq(orgSettings.organizationId, orgId), inArray(orgSettings.key, [...keys])))
        .for("update");
      const current: Record<string, unknown> = {};
      for (const r of rows) current[r.key] = r.value ?? undefined;
      const { write, result } = fn(current);
      for (const [key, value] of Object.entries(write ?? {})) {
        if (!keys.includes(key)) throw new Error("mutateOrgSettings: unlocked key " + key);
        await tx
          .update(orgSettings)
          .set({ value, updatedBy, updatedAt: new Date() })
          .where(and(eq(orgSettings.organizationId, orgId), eq(orgSettings.key, key)));
      }
      return result;
    });
  }
  // ── per-hospital integration credentials ─────────────────────────────────────
  // Rows hold ciphertext + non-secret summary only; encryption/decryption is
  // server/integrations/crypto.ts's job, never this layer's.
  async getIntegrationCredential(orgId: number, integrationId: string) {
    const [row] = await this.db
      .select()
      .from(orgIntegrationCredentials)
      .where(
        and(
          eq(orgIntegrationCredentials.organizationId, orgId),
          eq(orgIntegrationCredentials.integrationId, integrationId),
        ),
      );
    return row;
  }
  async listIntegrationCredentials(integrationId?: string) {
    const q = this.db.select().from(orgIntegrationCredentials);
    const rows = integrationId
      ? await q.where(eq(orgIntegrationCredentials.integrationId, integrationId))
      : await q;
    return rows.sort((a, b) => a.organizationId - b.organizationId);
  }
  async upsertIntegrationCredential(row: Omit<OrgIntegrationCredential, "id" | "updatedAt">) {
    const set = {
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.authTag,
      keyVersion: row.keyVersion,
      summary: row.summary,
      updatedBy: row.updatedBy,
      updatedAt: new Date(),
    };
    const [saved] = await this.db
      .insert(orgIntegrationCredentials)
      .values({ ...row, updatedAt: set.updatedAt })
      .onConflictDoUpdate({
        target: [orgIntegrationCredentials.organizationId, orgIntegrationCredentials.integrationId],
        set,
      })
      .returning();
    return saved!;
  }
  async deleteIntegrationCredential(orgId: number, integrationId: string) {
    const gone = await this.db
      .delete(orgIntegrationCredentials)
      .where(
        and(
          eq(orgIntegrationCredentials.organizationId, orgId),
          eq(orgIntegrationCredentials.integrationId, integrationId),
        ),
      )
      .returning({ id: orgIntegrationCredentials.id });
    return gone.length > 0;
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
  async appendAudit(row: AuditInput): Promise<AuditLog> {
    const [stored] = await this.db
      .insert(auditLogs)
      .values({ ...row, impersonatorUserId: row.impersonatorUserId ?? null })
      .returning();
    return stored!;
  }
  async logPhiAccess(row: {
    organizationId: number;
    userId: number;
    impersonatorUserId?: number | null;
    resource: string;
    resourceId?: number | null;
    patientId?: number | null;
    method: string;
    ip?: string;
    userAgent?: string;
  }) {
    await this.db.insert(phiAccessLogs).values({
      ...row,
      impersonatorUserId: row.impersonatorUserId ?? null,
      resourceId: row.resourceId ?? null,
      patientId: row.patientId ?? null,
    });
  }
  // The trail readers below take an optional `userId`: set, they read only
  // that user's own rows (GET /api/audit/mine — A.CON comms-account #9).
  async countPhiAccess(orgId: number, userId?: number) {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(phiAccessLogs)
      .where(
        userId == null
          ? eq(phiAccessLogs.organizationId, orgId)
          : and(eq(phiAccessLogs.organizationId, orgId), eq(phiAccessLogs.userId, userId)),
      );
    return Number(row?.n ?? 0);
  }
  async countAuditLogs(orgId: number, userId?: number) {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(auditLogs)
      .where(
        userId == null
          ? eq(auditLogs.organizationId, orgId)
          : and(eq(auditLogs.organizationId, orgId), eq(auditLogs.userId, userId)),
      );
    return Number(row?.n ?? 0);
  }
  async listAuditLogs(orgId: number, limit = 100, userId?: number) {
    return this.db
      .select()
      .from(auditLogs)
      .where(
        userId == null
          ? eq(auditLogs.organizationId, orgId)
          : and(eq(auditLogs.organizationId, orgId), eq(auditLogs.userId, userId)),
      )
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(limit);
  }
  async listPhiAccess(orgId: number, limit = 50, userId?: number) {
    return this.db
      .select()
      .from(phiAccessLogs)
      .where(
        userId == null
          ? eq(phiAccessLogs.organizationId, orgId)
          : and(eq(phiAccessLogs.organizationId, orgId), eq(phiAccessLogs.userId, userId)),
      )
      .orderBy(desc(phiAccessLogs.createdAt), desc(phiAccessLogs.id))
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
    return this.db.transaction((tx) => this.archiveComplianceRecordsIn(tx, orgId, reason));
  }
  /**
   * The archive step proper, on a caller-supplied transaction so the tenant
   * cascade can commit "archived AND deleted" atomically. Rows are selected by
   * `organization_id = org OR user_id IN (the org's users)`: a row filed under
   * a NULL org but keyed to a tenant user (the historical mfa.failed shape)
   * is still that tenant's history, must be retained with it — and must leave
   * with it, or its users FK blocks the delete.
   */
  private async archiveComplianceRecordsIn(tx: Tx, orgId: number, reason: string) {
    const [org] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId));
    const orgUsers = await tx
      .select()
      .from(users)
      .where(eq(users.organizationId, orgId));
    const userIds = orgUsers.map((u) => u.id);
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
    const scope = tenantRowsScope(orgId, userIds);

    const audits = await tx.select().from(auditLogs).where(scope(auditLogs.organizationId, auditLogs.userId));
    const phi = await tx
      .select()
      .from(phiAccessLogs)
      .where(scope(phiAccessLogs.organizationId, phiAccessLogs.userId));
    const incidents = await tx
      .select()
      .from(securityIncidents)
      .where(scope(securityIncidents.organizationId, securityIncidents.userId));

    // Keep the operator attribution of impersonated rows in the archive too:
    // the archive has no column for it, so it travels in `details`.
    const withOperator = (
      details: Record<string, unknown> | null,
      operator: number | null,
    ): Record<string, unknown> | null =>
      operator != null ? { ...(details ?? {}), onBehalfOf: operator } : details;

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
        details: withOperator(a.details ?? null, a.impersonatorUserId),
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
        details: withOperator(null, p.impersonatorUserId),
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
    await tx.insert(retainedComplianceRecords).values(rows);
    return rows.length;
  }
  async appendRetainedComplianceRecord(row: NewRetainedComplianceRecord) {
    const [stored] = await this.db.insert(retainedComplianceRecords).values(row).returning();
    return stored!;
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
    // ONE transaction: either the whole tenant leaves (archived first) or
    // nothing does. The statement-by-statement version could stop halfway on a
    // foreign key the cascade did not cover, leaving an org with its users and
    // messages gone but its row still present — half-deleted and, since every
    // retry hit the same FK, undeletable.
    //
    // EXCEPT the compliance trail: audit_logs / phi_access_logs /
    // security_incidents are FK-bound to organizations + users, so they cannot
    // stay behind — but §164.316(b)(2)(i) requires six years of retention. They
    // are copied into `retained_compliance_records` FIRST (denormalized, no FKs)
    // inside the same transaction and only then deleted, so the history
    // outlives the tenant and a rolled-back attempt leaves no duplicate copy.
    const attachmentRefs: string[] = [];
    await this.db.transaction(async (tx) => {
      await this.archiveComplianceRecordsIn(tx, id, "organization_deleted");

      const orgUsers = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.organizationId, id));
      const userIds = orgUsers.map((u) => u.id);
      const orgMessages = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.organizationId, id));
      const messageIds = orgMessages.map((m) => m.id);
      const scope = tenantRowsScope(id, userIds);

      // leaf rows that point at messages / broadcasts / assignments
      // Attachments reference messages(id) — delete them before the messages, or
      // the whole cascade fails with a FK violation (surfaced as 409
      // org_has_linked_records for any tenant that ever uploaded a file).
      // Collect the encrypted-store refs so the ciphertext FILES go too, once
      // the rows are committed.
      const atts = await tx
        .select({ ref: messageAttachments.dataBase64 })
        .from(messageAttachments)
        .where(
          messageIds.length
            ? or(eq(messageAttachments.organizationId, id), inArray(messageAttachments.messageId, messageIds))!
            : eq(messageAttachments.organizationId, id),
        );
      attachmentRefs.push(...atts.map((a) => a.ref));
      await tx.delete(messageAttachments).where(eq(messageAttachments.organizationId, id));
      if (messageIds.length) {
        // Belt and braces: an attachment uploaded by a since-moved user could
        // carry a different organization_id while still pointing at this org's
        // message. Clear those by message id too.
        await tx.delete(messageAttachments).where(inArray(messageAttachments.messageId, messageIds));
        await tx.delete(messageDeliveryStatus).where(inArray(messageDeliveryStatus.messageId, messageIds));
      }
      if (userIds.length) {
        // Delivery rows are keyed by user, not org.
        await tx.delete(messageDeliveryStatus).where(inArray(messageDeliveryStatus.userId, userIds));
      }
      await tx.delete(broadcastAcknowledgments).where(eq(broadcastAcknowledgments.organizationId, id));
      await tx.delete(assignments).where(eq(assignments.organizationId, id));
      await tx.delete(patientConsults).where(eq(patientConsults.organizationId, id));
      await tx.delete(messages).where(eq(messages.organizationId, id));
      await tx.delete(conversations).where(eq(conversations.organizationId, id));
      await tx.delete(emergencyBroadcasts).where(eq(emergencyBroadcasts.organizationId, id));
      // Composer templates reference organizations AND (personal ones) users.
      // This was the one table missing from the cascade, so any tenant that
      // had saved a template could never be deleted.
      await tx
        .delete(messageTemplates)
        .where(
          userIds.length
            ? or(eq(messageTemplates.organizationId, id), inArray(messageTemplates.ownerUserId, userIds))!
            : eq(messageTemplates.organizationId, id),
        );
      // patients reference hospitalists + users(er_doctor); delete before both
      await tx.delete(patients).where(eq(patients.organizationId, id));
      await tx.delete(hospitalists).where(eq(hospitalists.organizationId, id));
      await tx.delete(careTeamMembers).where(eq(careTeamMembers.organizationId, id));
      await tx.delete(deviceTokens).where(eq(deviceTokens.organizationId, id));
      await tx.delete(userPreferences).where(eq(userPreferences.organizationId, id));
      // user-keyed rows with no org column
      if (userIds.length) {
        await tx.delete(mfaBackupCodes).where(inArray(mfaBackupCodes.userId, userIds));
        await tx.delete(mfaCredentials).where(inArray(mfaCredentials.userId, userIds));
      }
      // org-scoped config / logs (some reference users via updated_by / user_id)
      await tx
        .delete(complianceAttestations)
        .where(eq(complianceAttestations.organizationId, id));
      await tx.delete(suggestions).where(eq(suggestions.organizationId, id));
      await tx.delete(featureFlags).where(eq(featureFlags.organizationId, id));
      await tx.delete(orgSettings).where(eq(orgSettings.organizationId, id));
      // The hospital's own integration credentials (ciphertext) leave with it.
      await tx.delete(orgIntegrationCredentials).where(eq(orgIntegrationCredentials.organizationId, id));
      await tx.delete(equipment).where(eq(equipment.organizationId, id));
      await tx.delete(beds).where(eq(beds.organizationId, id));
      await tx.delete(departments).where(eq(departments.organizationId, id));
      // Nullable-org, user-keyed tables: take the user-keyed rows too (they
      // were archived above under this tenant), or the users delete FK-fails.
      await tx.delete(smsHistory).where(scope(smsHistory.organizationId, smsHistory.userId));
      await tx.delete(phiAccessLogs).where(scope(phiAccessLogs.organizationId, phiAccessLogs.userId));
      await tx.delete(securityIncidents).where(scope(securityIncidents.organizationId, securityIncidents.userId));
      await tx.delete(auditLogs).where(scope(auditLogs.organizationId, auditLogs.userId));
      await tx.delete(pendingRegistrations).where(eq(pendingRegistrations.organizationId, id));
      await tx.delete(landingPageSettings).where(eq(landingPageSettings.organizationId, id));
      await tx.delete(contactPageSettings).where(eq(contactPageSettings.organizationId, id));
      // now the users, then the org
      await tx.delete(users).where(eq(users.organizationId, id));
      await tx.delete(organizations).where(eq(organizations.id, id));
    });
    // Rows are committed; now the encrypted attachment files (best effort — a
    // failure leaves unreadable ciphertext behind, never tenant data). An
    // attachment matched both by org and by message id is listed once.
    const failures = await deleteAttachmentFiles([...new Set(attachmentRefs)]);
    if (failures) console.error(`[storage] org ${id} deleted but ${failures} attachment file(s) could not be removed`);
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
  /**
   * Start (or restart) TOTP enrolment. An ACTIVE credential is never replaced
   * here: the new secret is parked in pending_secret and only promoted by
   * promotePendingMfaSecret() once its first code verifies — so a re-enrolment
   * that is abandoned halfway leaves the user's existing authenticator working.
   */
  async upsertMfaCredential(userId: number, secret: string) {
    const existing = await this.getMfaCredential(userId);
    if (existing?.activated) {
      const [row] = await this.db
        .update(mfaCredentials)
        .set({ pendingSecret: secret })
        .where(eq(mfaCredentials.userId, userId))
        .returning();
      return row!;
    }
    await this.db.delete(mfaCredentials).where(eq(mfaCredentials.userId, userId));
    const [row] = await this.db
      .insert(mfaCredentials)
      .values({ userId, secret, activated: false, pendingSecret: null })
      .returning();
    return row!;
  }
  async activateMfaCredential(userId: number) {
    await this.db
      .update(mfaCredentials)
      .set({ activated: true, pendingSecret: null })
      .where(eq(mfaCredentials.userId, userId));
  }
  /** Re-enrolment verified: the pending secret becomes the live one. */
  async promotePendingMfaSecret(userId: number) {
    const cred = await this.getMfaCredential(userId);
    if (!cred?.pendingSecret) return false;
    await this.db
      .update(mfaCredentials)
      .set({ secret: cred.pendingSecret, pendingSecret: null, activated: true })
      .where(eq(mfaCredentials.userId, userId));
    return true;
  }
  /** Remove every second factor for a user (self-disable or admin reset). */
  async clearMfa(userId: number) {
    await this.db.delete(mfaBackupCodes).where(eq(mfaBackupCodes.userId, userId));
    await this.db.delete(mfaCredentials).where(eq(mfaCredentials.userId, userId));
    await this.db.update(users).set({ twoFactorEnabled: false }).where(eq(users.id, userId));
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
      .values({ ...row, username: normalizeUsername(row.username) })
      .returning();
    return created!;
  }
  /**
   * Remember an unrouted registration (unknown org / platform org) by its
   * opaque key. True when this is the first time the key is seen; false when
   * it was already claimed (the caller answers 409 request_pending, like a
   * duplicate pending request at a real org). Atomic under concurrency.
   */
  async claimUnroutedRegistration(requestKey: string): Promise<boolean> {
    const rows = await this.db
      .insert(unroutedRegistrations)
      .values({ requestKey })
      .onConflictDoNothing({ target: unroutedRegistrations.requestKey })
      .returning({ id: unroutedRegistrations.id });
    return rows.length > 0;
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
        // The device now belongs to this account — and to ITS organization: a
        // subscription re-registered by a user of another tenant must not keep
        // the previous tenant's organizationId (A.CON-SHO-68).
        set: { userId: row.userId, organizationId: row.organizationId, platform: row.platform },
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
        durationMs: messageAttachments.durationMs,
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
