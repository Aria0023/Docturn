import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbType } from "./db.js";
import { getDb } from "./db.js";
import {
  assignments,
  auditLogs,
  conversations,
  featureFlags,
  hospitalists,
  messageDeliveryStatus,
  messages,
  orgSettings,
  organizations,
  patients,
  phiAccessLogs,
  userPreferences,
  users,
  type Assignment,
  type AuditLog,
  type Conversation,
  type Hospitalist,
  type InsertHospitalist,
  type Message,
  type MessageDeliveryStatus,
  type Organization,
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
}

/** Default singleton bound to the process database. Tests construct their own. */
let _storage: IStorage | null = null;
export function storage(): IStorage {
  if (!_storage) _storage = new DatabaseStorage();
  return _storage;
}
export function setStorage(s: IStorage) {
  _storage = s;
}
