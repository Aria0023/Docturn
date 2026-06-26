import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { DbType } from "./db.js";
import { getDb } from "./db.js";
import {
  assignments,
  auditLogs,
  beds,
  broadcastAcknowledgments,
  careTeamMembers,
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
  messageDeliveryStatus,
  messages,
  orgSettings,
  organizations,
  patientConsults,
  patients,
  pendingRegistrations,
  phiAccessLogs,
  securityIncidents,
  smsHistory,
  suggestions,
  userPreferences,
  users,
  type Assignment,
  type AuditLog,
  type Bed,
  type BroadcastAck,
  type CareTeamMember,
  type Conversation,
  type Department,
  type DeviceToken,
  type EmergencyBroadcast,
  type Equipment,
  type FeatureFlag,
  type Hospitalist,
  type InsertHospitalist,
  type Message,
  type MessageDeliveryStatus,
  type Organization,
  type PatientConsult,
  type PendingRegistration,
  type Patient,
  type User,
} from "@shared/schema";

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
  createPatient(p: Omit<Patient, "id" | "createdAt">): Promise<Patient>;
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
  listMessages(orgId: number, conversationId: number): Promise<Message[]>;
  createMessage(m: Omit<Message, "id" | "createdAt" | "deletedAt">): Promise<Message>;
  getMessage(orgId: number, id: number): Promise<Message | undefined>;
  softDeleteMessage(orgId: number, id: number): Promise<void>;
  createDeliveryStatuses(
    rows: Omit<MessageDeliveryStatus, "id">[],
  ): Promise<void>;
  markRead(userId: number, messageIds: number[]): Promise<void>;
  listDeliveryForMessages(
    messageIds: number[],
  ): Promise<MessageDeliveryStatus[]>;

  // config
  getOrgSetting(orgId: number, key: string): Promise<unknown>;
  setOrgSetting(
    orgId: number,
    key: string,
    value: unknown,
    updatedBy: number,
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
    method: string;
    ip?: string;
    userAgent?: string;
  }): Promise<void>;
  countPhiAccess(orgId: number): Promise<number>;
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
  async createPatient(p: Omit<Patient, "id" | "createdAt">) {
    const [row] = await this.db.insert(patients).values(p).returning();
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
  async createMessage(m: Omit<Message, "id" | "createdAt" | "deletedAt">) {
    const [row] = await this.db.insert(messages).values(m).returning();
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
  async listDeliveryForMessages(messageIds: number[]) {
    if (messageIds.length === 0) return [];
    return this.db
      .select()
      .from(messageDeliveryStatus)
      .where(inArray(messageDeliveryStatus.messageId, messageIds));
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
    updatedBy: number,
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
    method: string;
    ip?: string;
    userAgent?: string;
  }) {
    await this.db.insert(phiAccessLogs).values(row);
  }
  async countPhiAccess(orgId: number) {
    const rows = await this.db
      .select({ id: phiAccessLogs.id })
      .from(phiAccessLogs)
      .where(eq(phiAccessLogs.organizationId, orgId));
    return rows.length;
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
    if (messageIds.length) {
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
    return this.db
      .select()
      .from(patientConsults)
      .where(
        and(
          eq(patientConsults.organizationId, orgId),
          inArray(patientConsults.status, ["requested", "active"]),
        ),
      );
  }
  async createConsult(row: Omit<PatientConsult, "id" | "createdAt">) {
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
