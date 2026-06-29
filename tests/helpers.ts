import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../server/app.js';
import { db } from '../server/db.js';
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
} from '../shared/schema.js';
import { hashPassword } from '../server/auth.js';

export function getApp(): Express {
  return createApp();
}

export function resetDb() {
  // FK-safe wipe order.
  db.delete(messageDeliveryStatus).run();
  db.delete(messages).run();
  db.delete(conversations).run();
  db.delete(assignments).run();
  db.delete(patients).run();
  db.delete(hospitalists).run();
  db.delete(auditLogs).run();
  db.delete(users).run();
  db.delete(organizations).run();
}

export interface SeedResult {
  org: typeof organizations.$inferSelect;
  org2: typeof organizations.$inferSelect;
  users: Record<string, typeof users.$inferSelect>;
  hosp: Record<string, typeof hospitalists.$inferSelect>;
  patients: Record<string, typeof patients.$inferSelect>;
}

/**
 * Seeds a deterministic fixture used across tests:
 * - org MERCY with all roles
 * - 3 hospitalists with distinct census so round-robin is testable
 * - a second org (LIGHT) with its own hospitalist + patient for cross-org tests
 */
export function seedFixture(): SeedResult {
  resetDb();
  const pw = hashPassword('pass123');

  const org = db
    .insert(organizations)
    .values({ name: 'Mercy General Hospital', code: 'MERCY', assignmentTimeoutMin: 10 })
    .returning()
    .get();
  const org2 = db
    .insert(organizations)
    .values({ name: 'Lighthouse Medical', code: 'LIGHT', assignmentTimeoutMin: 10 })
    .returning()
    .get();

  const mk = (orgId: number, username: string, role: string, fullName: string) =>
    db.insert(users).values({ orgId, username, passwordHash: pw, role, fullName }).returning().get();

  const director1 = mk(org.id, 'director1', 'director', 'Dr. Sarah Kim');
  const erdoc1 = mk(org.id, 'erdoc1', 'er_doctor', 'Dr. James Torres');
  const erdoc2 = mk(org.id, 'erdoc2', 'er_doctor', 'Dr. Priya Patel');
  const hosp1User = mk(org.id, 'hosp1', 'hospitalist', 'Dr. Jordan Chen');
  const hosp2User = mk(org.id, 'hosp2', 'hospitalist', 'Dr. Maria Santos');
  const hosp3User = mk(org.id, 'hosp3', 'hospitalist', 'Dr. David Kim');
  const erdir1 = mk(org.id, 'erdir1', 'er_director', 'Dr. Lisa Chen');
  const dev1 = mk(org.id, 'dev1', 'developer', 'Dev Admin');

  // Second org users
  const o2director = mk(org2.id, 'o2director', 'director', 'Dr. Other Director');
  const o2hospUser = mk(org2.id, 'o2hosp', 'hospitalist', 'Dr. Other Hospitalist');

  // Hospitalists with distinct census: hosp1=2, hosp2=0, hosp3=working but used for full-board.
  const h1 = db
    .insert(hospitalists)
    .values({ orgId: org.id, userId: hosp1User.id, specialty: 'General', capacity: 12, census: 2, isWorking: true, shiftType: 'day', rotationOrder: 0 })
    .returning()
    .get();
  const h2 = db
    .insert(hospitalists)
    .values({ orgId: org.id, userId: hosp2User.id, specialty: 'Cardiology', capacity: 10, census: 0, isWorking: true, shiftType: 'day', rotationOrder: 1 })
    .returning()
    .get();
  const h3 = db
    .insert(hospitalists)
    .values({ orgId: org.id, userId: hosp3User.id, specialty: 'General', capacity: 12, census: 5, isWorking: false, shiftType: 'night', rotationOrder: 2 })
    .returning()
    .get();

  const o2h = db
    .insert(hospitalists)
    .values({ orgId: org2.id, userId: o2hospUser.id, specialty: 'General', capacity: 12, census: 0, isWorking: true, shiftType: 'day', rotationOrder: 0 })
    .returning()
    .get();

  const pSC = db
    .insert(patients)
    .values({ orgId: org.id, initials: 'SC', room: '101', chiefComplaint: 'chest pain', riskLevel: 'high', status: 'waiting', createdByUserId: erdoc1.id })
    .returning()
    .get();
  const pJM = db
    .insert(patients)
    .values({ orgId: org.id, initials: 'JM', room: '203', chiefComplaint: 'abdominal pain', riskLevel: 'medium', status: 'waiting', createdByUserId: erdoc2.id })
    .returning()
    .get();
  const o2Patient = db
    .insert(patients)
    .values({ orgId: org2.id, initials: 'ZZ', room: '900', chiefComplaint: 'fever', riskLevel: 'low', status: 'waiting' })
    .returning()
    .get();

  return {
    org,
    org2,
    users: { director1, erdoc1, erdoc2, hosp1User, hosp2User, hosp3User, erdir1, dev1, o2director, o2hospUser },
    hosp: { h1, h2, h3, o2h },
    patients: { pSC, pJM, o2Patient },
  };
}

/** Log in and return an agent with the session cookie attached. */
export async function login(app: Express, username: string, password = 'pass123') {
  const agent = request.agent(app);
  const res = await agent.post('/api/login').send({ username, password });
  return { agent, res };
}
