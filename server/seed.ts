import { db } from './db.js';
import {
  organizations,
  users,
  hospitalists,
  patients,
  conversations,
  messages,
  messageDeliveryStatus,
} from '../shared/schema.js';
import { hashPassword } from './auth.js';
import { eq } from 'drizzle-orm';

async function seed() {
  console.log('[seed] starting...');

  // Idempotency: if the MERCY org already exists, skip seeding entirely so we
  // never delete and recreate (and risk data loss) on a re-run.
  const existing = db.select().from(organizations).where(eq(organizations.code, 'MERCY')).get();
  if (existing) {
    console.log('[seed] already seeded, skipping.');
    return;
  }

  // Organization
  const org = db
    .insert(organizations)
    .values({ name: 'Mercy General Hospital', code: 'MERCY', timezone: 'America/New_York', assignmentTimeoutMin: 10 })
    .returning()
    .get();
  console.log(`[seed] org: ${org.name} (${org.code}) id=${org.id}`);

  const pw = hashPassword('pass123');

  const mk = (username: string, role: string, fullName: string) =>
    db.insert(users).values({ orgId: org.id, username, passwordHash: pw, role, fullName }).returning().get();

  const director1 = mk('director1', 'director', 'Dr. Sarah Kim');
  const erdoc1 = mk('erdoc1', 'er_doctor', 'Dr. James Torres');
  const erdoc2 = mk('erdoc2', 'er_doctor', 'Dr. Priya Patel');
  const hosp1User = mk('hosp1', 'hospitalist', 'Dr. Jordan Chen');
  const hosp2User = mk('hosp2', 'hospitalist', 'Dr. Maria Santos');
  const hosp3User = mk('hosp3', 'hospitalist', 'Dr. David Kim');
  mk('erdir1', 'er_director', 'Dr. Lisa Chen');
  mk('dev1', 'developer', 'Dev Admin');
  console.log('[seed] created 8 users across all roles');

  // Hospitalists
  db.insert(hospitalists)
    .values({ orgId: org.id, userId: hosp1User.id, specialty: 'General', capacity: 12, isWorking: true, shiftType: 'day', rotationOrder: 0 })
    .run();
  db.insert(hospitalists)
    .values({ orgId: org.id, userId: hosp2User.id, specialty: 'Cardiology', capacity: 10, isWorking: true, shiftType: 'day', rotationOrder: 1 })
    .run();
  db.insert(hospitalists)
    .values({ orgId: org.id, userId: hosp3User.id, specialty: 'General', capacity: 12, isWorking: false, shiftType: 'night', rotationOrder: 2 })
    .run();
  console.log('[seed] created 3 hospitalists');

  // Patients
  db.insert(patients)
    .values({ orgId: org.id, initials: 'SC', room: '101', chiefComplaint: 'chest pain', riskLevel: 'high', status: 'waiting', createdByUserId: erdoc1.id })
    .run();
  db.insert(patients)
    .values({ orgId: org.id, initials: 'JM', room: '203', chiefComplaint: 'abdominal pain', riskLevel: 'medium', status: 'waiting', createdByUserId: erdoc2.id })
    .run();
  console.log('[seed] created 2 patients');

  // 1 direct conversation between hosp1 and erdoc1 with 1 message
  const conv = db
    .insert(conversations)
    .values({
      orgId: org.id,
      type: 'direct',
      participantIds: JSON.stringify([hosp1User.id, erdoc1.id]),
      createdByUserId: erdoc1.id,
    })
    .returning()
    .get();
  const msg = db
    .insert(messages)
    .values({ orgId: org.id, conversationId: conv.id, senderId: erdoc1.id, body: 'Hi Dr. Chen, sending over patient SC for admission.' })
    .returning()
    .get();
  db.insert(messageDeliveryStatus).values({ messageId: msg.id, userId: hosp1User.id, deliveredAt: Math.floor(Date.now() / 1000) }).run();
  console.log('[seed] created 1 conversation with 1 message');

  console.log('[seed] done. Login with any username + password "pass123" at org code MERCY.');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed] failed', err);
    process.exit(1);
  });
