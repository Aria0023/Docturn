import { and, eq, asc, desc, inArray, sql } from 'drizzle-orm';
import { db } from './db.js';
import {
  organizations,
  users,
  hospitalists,
  patients,
  assignments,
  conversations,
  messages,
  messageDeliveryStatus,
  auditLogs,
  emergencyBroadcasts,
  broadcastAcknowledgments,
  deviceTokens,
  pushNotifications,
  smsHistory,
  orgSettings,
  userPreferences,
  featureFlags,
  suggestions,
  phiAccessLogs,
  type User,
  type Hospitalist,
  type Patient,
} from '../shared/schema.js';

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------
export const orgStore = {
  async getById(id: number) {
    return db.select().from(organizations).where(eq(organizations.id, id)).get();
  },
  async getByCode(code: string) {
    return db.select().from(organizations).where(eq(organizations.code, code.toUpperCase())).get();
  },
  async list() {
    return db.select().from(organizations).all();
  },
  async create(data: typeof organizations.$inferInsert) {
    return db.insert(organizations).values({ ...data, code: data.code.toUpperCase() }).returning().get();
  },
  async update(id: number, patch: Partial<typeof organizations.$inferInsert>) {
    return db.update(organizations).set(patch).where(eq(organizations.id, id)).returning().get();
  },
  async resetRoundRobin(id: number) {
    return db.update(organizations).set({ roundRobinIndex: 0 }).where(eq(organizations.id, id)).returning().get();
  },
};

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const userStore = {
  async getById(id: number) {
    return db.select().from(users).where(eq(users.id, id)).get();
  },
  async getByUsername(username: string) {
    return db.select().from(users).where(eq(users.username, username)).get();
  },
  async create(data: typeof users.$inferInsert) {
    return db.insert(users).values(data).returning().get();
  },
  async listByOrg(orgId: number) {
    return db.select().from(users).where(eq(users.orgId, orgId)).all();
  },
};

// ---------------------------------------------------------------------------
// Hospitalists
// ---------------------------------------------------------------------------
export type HospitalistWithUser = Hospitalist & { user: Pick<User, 'id' | 'fullName' | 'username' | 'role'> };

function joinHospitalistUser(rows: { hospitalists: Hospitalist; users: User }[]): HospitalistWithUser[] {
  return rows.map((r) => ({
    ...r.hospitalists,
    user: {
      id: r.users.id,
      fullName: r.users.fullName,
      username: r.users.username,
      role: r.users.role,
    },
  }));
}

export const hospitalistStore = {
  async getById(id: number) {
    return db.select().from(hospitalists).where(eq(hospitalists.id, id)).get();
  },
  async getByUserId(userId: number) {
    return db.select().from(hospitalists).where(eq(hospitalists.userId, userId)).get();
  },
  async listByOrg(orgId: number): Promise<HospitalistWithUser[]> {
    const rows = db
      .select()
      .from(hospitalists)
      .innerJoin(users, eq(hospitalists.userId, users.id))
      .where(eq(hospitalists.orgId, orgId))
      .orderBy(asc(hospitalists.rotationOrder))
      .all();
    return joinHospitalistUser(rows);
  },
  async listWorking(orgId: number): Promise<HospitalistWithUser[]> {
    const rows = db
      .select()
      .from(hospitalists)
      .innerJoin(users, eq(hospitalists.userId, users.id))
      .where(and(eq(hospitalists.orgId, orgId), eq(hospitalists.isWorking, true)))
      .orderBy(asc(hospitalists.census), asc(hospitalists.rotationOrder))
      .all();
    return joinHospitalistUser(rows);
  },
  async create(data: typeof hospitalists.$inferInsert) {
    return db.insert(hospitalists).values(data).returning().get();
  },
  async update(id: number, patch: Partial<typeof hospitalists.$inferInsert>) {
    return db.update(hospitalists).set(patch).where(eq(hospitalists.id, id)).returning().get();
  },
  async delete(id: number) {
    return db.delete(hospitalists).where(eq(hospitalists.id, id)).run();
  },
  async incrementCensus(id: number, delta: number) {
    const h = await this.getById(id);
    if (!h) return undefined;
    const next = Math.max(0, h.census + delta);
    return db.update(hospitalists).set({ census: next }).where(eq(hospitalists.id, id)).returning().get();
  },
  async bumpCapacities(orgId: number, delta: number) {
    return db
      .update(hospitalists)
      .set({ capacity: sql`${hospitalists.capacity} + ${delta}` })
      .where(and(eq(hospitalists.orgId, orgId), eq(hospitalists.isWorking, true)))
      .run();
  },
};

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------
export const patientStore = {
  async getById(id: number) {
    return db.select().from(patients).where(eq(patients.id, id)).get();
  },
  async listByOrg(orgId: number): Promise<Patient[]> {
    return db.select().from(patients).where(eq(patients.orgId, orgId)).orderBy(desc(patients.createdAt)).all();
  },
  async create(data: typeof patients.$inferInsert) {
    return db.insert(patients).values(data).returning().get();
  },
  async update(id: number, patch: Partial<typeof patients.$inferInsert>) {
    return db.update(patients).set(patch).where(eq(patients.id, id)).returning().get();
  },
};

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------
export const assignmentStore = {
  async getById(id: number) {
    return db.select().from(assignments).where(eq(assignments.id, id)).get();
  },
  async create(data: typeof assignments.$inferInsert) {
    return db.insert(assignments).values(data).returning().get();
  },
  async update(id: number, patch: Partial<typeof assignments.$inferInsert>) {
    return db.update(assignments).set(patch).where(eq(assignments.id, id)).returning().get();
  },
  async listPendingByOrg(orgId: number) {
    return db
      .select()
      .from(assignments)
      .where(and(eq(assignments.orgId, orgId), eq(assignments.status, 'pending')))
      .all();
  },
  async listByHospitalist(hospitalistId: number) {
    return db
      .select()
      .from(assignments)
      .where(eq(assignments.hospitalistId, hospitalistId))
      .orderBy(desc(assignments.createdAt))
      .all();
  },
  async listExpiredCandidates(nowSec: number) {
    return db
      .select()
      .from(assignments)
      .where(and(eq(assignments.status, 'pending'), sql`${assignments.expiresAt} IS NOT NULL AND ${assignments.expiresAt} < ${nowSec}`))
      .all();
  },
};

// ---------------------------------------------------------------------------
// Conversations & Messages
// ---------------------------------------------------------------------------
export const conversationStore = {
  async getById(id: number) {
    return db.select().from(conversations).where(eq(conversations.id, id)).get();
  },
  async create(data: typeof conversations.$inferInsert) {
    return db.insert(conversations).values(data).returning().get();
  },
  async listForUser(orgId: number, userId: number) {
    const all = db.select().from(conversations).where(eq(conversations.orgId, orgId)).all();
    return all.filter((c) => {
      try {
        const ids: number[] = JSON.parse(c.participantIds);
        return ids.includes(userId);
      } catch {
        return false;
      }
    });
  },
};

export const messageStore = {
  async getById(id: number) {
    return db.select().from(messages).where(eq(messages.id, id)).get();
  },
  async create(data: typeof messages.$inferInsert) {
    return db.insert(messages).values(data).returning().get();
  },
  async listByConversation(conversationId: number) {
    return db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt))
      .all();
  },
  async softDelete(id: number) {
    return db
      .update(messages)
      .set({ deleted: true, deletedAt: Math.floor(Date.now() / 1000) })
      .where(eq(messages.id, id))
      .returning()
      .get();
  },
  async createDeliveryStatus(messageId: number, userIds: number[]) {
    if (userIds.length === 0) return [];
    const rows = userIds.map((userId) => ({ messageId, userId, deliveredAt: Math.floor(Date.now() / 1000) }));
    return db.insert(messageDeliveryStatus).values(rows).returning().all();
  },
  async markRead(conversationId: number, userId: number) {
    const msgs = await this.listByConversation(conversationId);
    const ids = msgs.map((m) => m.id);
    if (ids.length === 0) return 0;
    const readAt = Math.floor(Date.now() / 1000);
    const res = db
      .update(messageDeliveryStatus)
      .set({ readAt })
      .where(and(inArray(messageDeliveryStatus.messageId, ids), eq(messageDeliveryStatus.userId, userId), sql`${messageDeliveryStatus.readAt} IS NULL`))
      .run();
    return res.changes;
  },
  async listDeliveryStatus(messageId: number) {
    return db.select().from(messageDeliveryStatus).where(eq(messageDeliveryStatus.messageId, messageId)).all();
  },
};

// ---------------------------------------------------------------------------
// Audit & PHI
// ---------------------------------------------------------------------------
export const auditStore = {
  async log(entry: typeof auditLogs.$inferInsert) {
    return db.insert(auditLogs).values(entry).returning().get();
  },
  async listByOrg(orgId: number) {
    return db.select().from(auditLogs).where(eq(auditLogs.orgId, orgId)).orderBy(desc(auditLogs.createdAt)).all();
  },
};

export const phiStore = {
  async log(entry: typeof phiAccessLogs.$inferInsert) {
    return db.insert(phiAccessLogs).values(entry).returning().get();
  },
};

// ---------------------------------------------------------------------------
// Broadcasts
// ---------------------------------------------------------------------------
export const broadcastStore = {
  async create(data: typeof emergencyBroadcasts.$inferInsert) {
    return db.insert(emergencyBroadcasts).values(data).returning().get();
  },
  async getById(id: number) {
    return db.select().from(emergencyBroadcasts).where(eq(emergencyBroadcasts.id, id)).get();
  },
  async ack(broadcastId: number, userId: number) {
    const existing = db
      .select()
      .from(broadcastAcknowledgments)
      .where(and(eq(broadcastAcknowledgments.broadcastId, broadcastId), eq(broadcastAcknowledgments.userId, userId)))
      .get();
    if (existing) return existing;
    return db.insert(broadcastAcknowledgments).values({ broadcastId, userId }).returning().get();
  },
  async listAcks(broadcastId: number) {
    return db.select().from(broadcastAcknowledgments).where(eq(broadcastAcknowledgments.broadcastId, broadcastId)).all();
  },
};

// ---------------------------------------------------------------------------
// Device tokens & push
// ---------------------------------------------------------------------------
export const deviceStore = {
  async register(userId: number, token: string, platform: string) {
    const existing = db.select().from(deviceTokens).where(eq(deviceTokens.token, token)).get();
    if (existing) return existing;
    return db.insert(deviceTokens).values({ userId, token, platform }).returning().get();
  },
  async remove(token: string) {
    return db.delete(deviceTokens).where(eq(deviceTokens.token, token)).run();
  },
  async listByUser(userId: number) {
    return db.select().from(deviceTokens).where(eq(deviceTokens.userId, userId)).all();
  },
  async recordPush(userId: number, title: string, body: string, data?: string) {
    return db.insert(pushNotifications).values({ userId, title, body, data }).returning().get();
  },
};

export const smsStore = {
  async record(entry: typeof smsHistory.$inferInsert) {
    return db.insert(smsHistory).values(entry).returning().get();
  },
};

// ---------------------------------------------------------------------------
// Settings, flags, suggestions
// ---------------------------------------------------------------------------
export const settingsStore = {
  async getOrgSettings(orgId: number) {
    const rows = db.select().from(orgSettings).where(eq(orgSettings.orgId, orgId)).all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
  async setOrgSetting(orgId: number, key: string, value: string) {
    const existing = db.select().from(orgSettings).where(and(eq(orgSettings.orgId, orgId), eq(orgSettings.key, key))).get();
    if (existing) {
      return db.update(orgSettings).set({ value, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(orgSettings.id, existing.id)).returning().get();
    }
    return db.insert(orgSettings).values({ orgId, key, value }).returning().get();
  },
  async getUserPrefs(userId: number) {
    const rows = db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
  async setUserPref(userId: number, key: string, value: string) {
    const existing = db.select().from(userPreferences).where(and(eq(userPreferences.userId, userId), eq(userPreferences.key, key))).get();
    if (existing) {
      return db.update(userPreferences).set({ value, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(userPreferences.id, existing.id)).returning().get();
    }
    return db.insert(userPreferences).values({ userId, key, value }).returning().get();
  },
};

export const flagStore = {
  async listByOrg(orgId: number) {
    return db.select().from(featureFlags).where(sql`${featureFlags.orgId} = ${orgId} OR ${featureFlags.orgId} IS NULL`).all();
  },
  async set(orgId: number | null, key: string, enabled: boolean, description?: string) {
    const existing = db
      .select()
      .from(featureFlags)
      .where(and(orgId === null ? sql`${featureFlags.orgId} IS NULL` : eq(featureFlags.orgId, orgId), eq(featureFlags.key, key)))
      .get();
    if (existing) {
      return db.update(featureFlags).set({ enabled, description, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(featureFlags.id, existing.id)).returning().get();
    }
    return db.insert(featureFlags).values({ orgId, key, enabled, description }).returning().get();
  },
};

export const suggestionStore = {
  async listByOrg(orgId: number) {
    return db.select().from(suggestions).where(eq(suggestions.orgId, orgId)).orderBy(desc(suggestions.createdAt)).all();
  },
  async create(data: typeof suggestions.$inferInsert) {
    return db.insert(suggestions).values(data).returning().get();
  },
};
