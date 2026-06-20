import { hashPassword } from "./auth.js";
import { getHandle } from "./db.js";
import { DatabaseStorage, setStorage } from "./storage.js";

const DEV_PASSWORD = "docturn";

interface SeedResult {
  orgId: number;
  userIds: Record<string, number>;
  hospitalistIds: Record<string, number>;
  patientIds: Record<string, number>;
}

/**
 * Deterministic seed (fixed ordering) shared by `npm run seed` and the test
 * harness. One org (MERCY), one user per role, providers with varied census/cap,
 * and a couple of pending assignments so dashboards aren't empty.
 */
export async function seed(storage: DatabaseStorage): Promise<SeedResult> {
  const org = await storage.createOrganization({
    name: "Mercy General Hospital",
    code: "MERCY",
    city: "Springfield",
    state: "NY",
    timezone: "America/New_York",
    assignmentTimeoutMin: 10,
    roundRobinShiftTypes: ["day", "night"],
    rotationMode: "lowest_census",
    rotationIndex: 0,
  });

  const passwordHash = await hashPassword(DEV_PASSWORD);
  const userIds: Record<string, number> = {};

  async function mkUser(
    username: string,
    role: string,
    displayName: string,
    credential: string | null = null,
  ) {
    const u = await storage.createUser({
      organizationId: org.id,
      username,
      passwordHash,
      role: role as never,
      displayName,
      credential: credential as never,
      phone: null,
      twoFactorEnabled: false,
    });
    userIds[username] = u.id;
    return u;
  }

  await mkUser("director", "director", "Dr. Dana Director");
  await mkUser("er.director", "er_director", "Dr. Evan Marsh", "MD");
  await mkUser("dev", "developer", "Platform Operator");
  await mkUser("er.doc", "er_doctor", "Dr. Erin Reyes", "MD");
  const chen = await mkUser("chen", "hospitalist", "Dr. Jordan Chen", "MD");
  const patel = await mkUser("patel", "hospitalist", "Dr. Priya Patel", "MD");
  const lopez = await mkUser("lopez", "hospitalist", "Dr. Luis Lopez", "DO");
  const liu = await mkUser("liu", "hospitalist", "Dr. Mei Liu", "MD");
  // A midlevel (NP): an ordinary user with role hospitalist + credential NP, but
  // NO rotation profile — they receive/accept via a care-team unit, not rotation.
  const wu = await mkUser("wu", "hospitalist", "Jordan Wu, PA-C", "PA");

  const hospitalistIds: Record<string, number> = {};
  async function mkProvider(
    userId: number,
    key: string,
    specialty: string,
    census: number,
    cap: number,
    working: boolean,
    order: number,
  ) {
    const h = await storage.createHospitalist({
      organizationId: org.id,
      userId,
      specialty,
      currentPatientCount: census,
      patientCap: cap,
      rotationOrder: order,
      working,
      shiftType: "day",
    });
    hospitalistIds[key] = h.id;
    return h;
  }

  // Chen 3/12, Patel 5/12, Lopez 7/10 (all working); Liu 2/8 (off).
  await mkProvider(chen.id, "chen", "Cardiology", 3, 12, true, 0);
  await mkProvider(patel.id, "patel", "General", 5, 12, true, 1);
  await mkProvider(lopez.id, "lopez", "Pulmonology", 7, 10, true, 2);
  await mkProvider(liu.id, "liu", "Neurology", 2, 8, false, 3);

  // A couple of patients with pending assignments to the lowest-census provider.
  const erDocId = userIds["er.doc"]!;
  const p1 = await storage.createPatient({
    organizationId: org.id,
    initials: "SC",
    roomNumber: "204",
    issueSummary: "Chest pain, possible cardiac event",
    specialty: "Cardiology",
    department: "Emergency",
    status: "waiting",
    erDoctorId: erDocId,
    assignedHospitalistId: null,
  });
  await storage.createAssignment({
    organizationId: org.id,
    patientId: p1.id,
    hospitalistId: hospitalistIds["chen"]!,
    erDoctorId: erDocId,
    status: "pending",
    via: "round_robin",
    acceptedByUserId: null,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });

  // v2 seed: Wu (PA) is on Chen's on-call unit; a Cardiology consult on p1; a dept.
  await storage.addCareTeamMember({
    organizationId: org.id,
    ownerUserId: chen.id,
    memberUserId: wu.id,
    onCall: true,
  });
  await storage.createConsult({
    organizationId: org.id,
    patientId: p1.id,
    specialty: "Cardiology",
    consultantUserId: null,
    status: "requested",
  });
  await storage.createDepartment({
    organizationId: org.id,
    code: "MED",
    name: "Internal Medicine",
    bedCapacity: 24,
  });

  return {
    orgId: org.id,
    userIds,
    hospitalistIds,
    patientIds: { sc: p1.id },
  };
}

// The full demo roster — used to top up databases seeded before new accounts
// (e.g. dev, er.director) were added, without wiping data.
const DEMO_USERS: Array<{ username: string; role: string; displayName: string; credential?: string }> = [
  { username: "director", role: "director", displayName: "Dr. Dana Director" },
  { username: "er.director", role: "er_director", displayName: "Dr. Evan Marsh", credential: "MD" },
  { username: "dev", role: "developer", displayName: "Platform Operator" },
  { username: "er.doc", role: "er_doctor", displayName: "Dr. Erin Reyes", credential: "MD" },
  { username: "chen", role: "hospitalist", displayName: "Dr. Jordan Chen", credential: "MD" },
  { username: "patel", role: "hospitalist", displayName: "Dr. Priya Patel", credential: "MD" },
  { username: "lopez", role: "hospitalist", displayName: "Dr. Luis Lopez", credential: "DO" },
  { username: "liu", role: "hospitalist", displayName: "Dr. Mei Liu", credential: "MD" },
  { username: "wu", role: "hospitalist", displayName: "Jordan Wu, PA-C", credential: "PA" },
];

/** Create any missing demo accounts in an already-seeded org. Returns count added. */
async function ensureDemoUsers(
  storage: DatabaseStorage,
  orgId: number,
): Promise<number> {
  const passwordHash = await hashPassword(DEV_PASSWORD);
  let added = 0;
  for (const u of DEMO_USERS) {
    const existing = await storage.getUserByUsername(orgId, u.username);
    if (existing) continue;
    const created = await storage.createUser({
      organizationId: orgId,
      username: u.username,
      passwordHash,
      role: u.role as never,
      displayName: u.displayName,
      credential: (u.credential ?? null) as never,
      phone: null,
      twoFactorEnabled: false,
    });
    // Clinical accounts need a provider profile to appear in rotation/dashboards.
    if (u.role === "hospitalist") {
      const prof = await storage.getHospitalistByUser(orgId, created.id);
      if (!prof) {
        const all = await storage.listHospitalists(orgId);
        await storage.createHospitalist({
          organizationId: orgId,
          userId: created.id,
          specialty: "General",
          currentPatientCount: 0,
          patientCap: 12,
          rotationOrder: all.length,
          working: false,
          shiftType: "day",
        });
      }
    }
    added++;
  }
  return added;
}

// CLI entrypoint: wipe-and-reseed the persistent dev database. Normalize
// backslashes so this also fires on Windows (the naive `file://${argv[1]}`
// string compare fails on Windows paths, silently skipping the seed).
const isMain = process.argv[1]
  ?.replace(/\\/g, "/")
  .endsWith("server/seed.ts");
if (isMain) {
  (async () => {
    const handle = getHandle();
    await handle.ensureSchema();
    const storage = new DatabaseStorage(handle.db);
    setStorage(storage);
    try {
      const existing = await storage.getOrganizationByCode("MERCY");
      if (existing) {
        // Already seeded: top up any demo accounts added since (e.g. dev,
        // er.director) so logging in as every role works — no wipe needed.
        const added = await ensureDemoUsers(storage, existing.id);
        console.log(
          added > 0
            ? `Database already seeded — added ${added} missing demo account(s) (incl. dev/er.director). Password: "${DEV_PASSWORD}".`
            : 'Database already seeded and all demo accounts present — nothing to do.',
        );
      } else {
        const result = await seed(storage);
        console.log(
          `Seeded org MERCY (#${result.orgId}) with ${Object.keys(result.userIds).length} users. Dev password: "${DEV_PASSWORD}".`,
        );
      }
    } catch (err) {
      console.error("Seed failed:", err);
      process.exitCode = 1;
    }
    await handle.close();
  })();
}

export { DEV_PASSWORD };
