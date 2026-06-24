import { hashPassword } from "./auth.js";
import { getHandle } from "./db.js";
import { DatabaseStorage, setStorage } from "./storage.js";

const DEV_PASSWORD = "docturn";

// The platform/developer tenant. Kept separate from clinical tenants so the
// developer can delete any hospital org without destroying their own account.
const PLATFORM_ORG = { name: "DocTurn Platform", code: "DOCTURN" };

interface SeedResult {
  orgId: number;
  platformOrgId: number;
  userIds: Record<string, number>;
  hospitalistIds: Record<string, number>;
  patientIds: Record<string, number>;
}

/**
 * Deterministic seed (fixed ordering) shared by `npm run seed` and the test
 * harness. One org (ISPN), one user per role, providers with varied census/cap,
 * and a couple of pending assignments so dashboards aren't empty.
 */
export async function seed(storage: DatabaseStorage): Promise<SeedResult> {
  const org = await storage.createOrganization({
    name: "Cedars-Sinai (ISP North)",
    code: "ISPN",
    city: "Springfield",
    state: "NY",
    timezone: "America/New_York",
    assignmentTimeoutMin: 15,
    roundRobinShiftTypes: ["day", "night"],
    rotationMode: "lowest_census",
    rotationIndex: 0,
  });

  const passwordHash = await hashPassword(DEV_PASSWORD);
  const userIds: Record<string, number> = {};

  // Platform org + developer account (separate from the clinical tenant).
  // Idempotent so reseeding a DB that still has the platform org doesn't collide.
  await ensurePlatform(storage);
  const platform = (await storage.getOrganizationByCode(PLATFORM_ORG.code))!;
  const devUser = (await storage.getUserByUsername(platform.id, "dev"))!;
  userIds["dev"] = devUser.id;

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
  await mkUser("er.doc", "er_doctor", "Dr. Erin Reyes", "MD");

  const hospitalistIds: Record<string, number> = {};
  async function mkProvider(
    userId: number,
    key: string,
    specialty: string,
    census: number,
    cap: number,
    working: boolean,
    order: number,
    shiftType: "day" | "swing" | "night" = "day",
  ) {
    const h = await storage.createHospitalist({
      organizationId: org.id,
      userId,
      specialty,
      currentPatientCount: census,
      patientCap: cap,
      rotationOrder: order,
      working,
      shiftType,
    });
    hospitalistIds[key] = h.id;
    return h;
  }

  // Cedars-Sinai / Tarzana ISP North — the REAL Amion on-call roster
  // (amion.com/cgi-bin/ocs), not placeholder names. The first four keep stable
  // demo usernames so the role-based demo login still resolves a hospitalist;
  // the rest fill out the captured grid so the director's roster matches Amion.
  // shiftType drives the schedule-time on-call (day/swing/night).
  const ROSTER: Array<{
    u: string; name: string; cred: string;
    shift: "day" | "swing" | "night"; census: number; cap: number; working: boolean;
  }> = [
    { u: "chen",       name: "Dr. Nathan Alyesh",    cred: "MD", shift: "day",   census: 0, cap: 12, working: true },
    { u: "patel",      name: "Dr. Sharon George",    cred: "MD", shift: "day",   census: 5, cap: 12, working: true },
    { u: "lopez",      name: "Dr. Amir Ahmed",       cred: "DO", shift: "day",   census: 7, cap: 12, working: true },
    { u: "liu",        name: "Dr. Joline Darouichi", cred: "MD", shift: "day",   census: 2, cap: 12, working: true },
    { u: "kazanchyan", name: "Dr. Moe Kazanchyan",   cred: "MD", shift: "day",   census: 4, cap: 12, working: true },
    { u: "gideon",     name: "Dr. Danny Gideon",     cred: "MD", shift: "day",   census: 6, cap: 12, working: true },
    { u: "gopal",      name: "Dr. Arun Gopal",       cred: "MD", shift: "day",   census: 3, cap: 12, working: true },
    { u: "williams",   name: "Dr. Nicole Williams",  cred: "MD", shift: "day",   census: 5, cap: 12, working: true },
    { u: "malhotra",   name: "Dr. Veshal Malhotra",  cred: "MD", shift: "day",   census: 4, cap: 12, working: true },
    { u: "manukian",   name: "Dr. Naira Manukian",   cred: "MD", shift: "swing", census: 2, cap: 12, working: true },
    { u: "kohan",      name: "Dr. Salar Kohan",      cred: "MD", shift: "night", census: 1, cap: 12, working: true },
    { u: "niculescu",  name: "Dr. Alex Niculescu",   cred: "MD", shift: "night", census: 1, cap: 12, working: true },
  ];

  let chen!: Awaited<ReturnType<typeof mkUser>>;
  let order = 0;
  for (const r of ROSTER) {
    const u = await mkUser(r.u, "hospitalist", r.name, r.cred);
    if (r.u === "chen") chen = u;
    await mkProvider(u.id, r.u, "Hospital Medicine", r.census, r.cap, r.working, order++, r.shift);
  }

  // A midlevel (NP/PA): an ordinary user with role hospitalist + credential PA,
  // but NO rotation profile — they receive/accept via a care-team unit, not
  // rotation. Midlevels are NOT on Amion (manual call lists), so Wu stays here.
  const wu = await mkUser("wu", "hospitalist", "Jordan Wu, PA-C", "PA");

  // A couple of patients with pending assignments to the lowest-census provider.
  const erDocId = userIds["er.doc"]!;
  const p1 = await storage.createPatient({
    organizationId: org.id,
    initials: "SC",
    roomNumber: "204",
    issueSummary: "Chest pain, possible cardiac event",
    specialty: "Cardiology",
    department: "Emergency",
    acuity: 2,
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
    platformOrgId: platform.id,
    userIds,
    hospitalistIds,
    patientIds: { sc: p1.id },
  };
}

// The clinical demo roster (ISPN). The developer (`dev`) is provisioned
// separately in the platform org — see ensurePlatform().
const DEMO_USERS: Array<{ username: string; role: string; displayName: string; credential?: string }> = [
  { username: "director", role: "director", displayName: "Dr. Dana Director" },
  { username: "er.director", role: "er_director", displayName: "Dr. Evan Marsh", credential: "MD" },
  { username: "er.doc", role: "er_doctor", displayName: "Dr. Erin Reyes", credential: "MD" },
  // Real Cedars/Tarzana ISP Amion roster; usernames stay stable for demo login.
  { username: "chen", role: "hospitalist", displayName: "Dr. Nathan Alyesh", credential: "MD" },
  { username: "patel", role: "hospitalist", displayName: "Dr. Sharon George", credential: "MD" },
  { username: "lopez", role: "hospitalist", displayName: "Dr. Amir Ahmed", credential: "DO" },
  { username: "liu", role: "hospitalist", displayName: "Dr. Joline Darouichi", credential: "MD" },
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

/**
 * Ensure the platform org + developer account exist (separate from clinical
 * tenants). Returns true if it created anything. Idempotent: safe to run on
 * databases seeded before the platform org existed (it migrates the legacy
 * in-tenant `dev` account out into the platform org).
 */
export async function ensurePlatform(storage: DatabaseStorage): Promise<boolean> {
  let changed = false;
  let platform = await storage.getOrganizationByCode(PLATFORM_ORG.code);
  if (!platform) {
    platform = await storage.createOrganization({
      name: PLATFORM_ORG.name,
      code: PLATFORM_ORG.code,
      city: null,
      state: null,
      timezone: "America/New_York",
      assignmentTimeoutMin: 15,
      roundRobinShiftTypes: ["day", "night"],
      rotationMode: "lowest_census",
      rotationIndex: 0,
    });
    changed = true;
  }
  const dev = await storage.getUserByUsername(platform.id, "dev");
  if (!dev) {
    const passwordHash = await hashPassword(DEV_PASSWORD);
    await storage.createUser({
      organizationId: platform.id,
      username: "dev",
      passwordHash,
      role: "developer" as never,
      displayName: "Platform Operator",
      credential: null as never,
      phone: null,
      twoFactorEnabled: false,
    });
    changed = true;
  }
  return changed;
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
      const existing = await storage.getOrganizationByCode("ISPN");
      if (existing) {
        // Already seeded: top up any missing demo accounts and ensure the
        // platform org + developer account exist (migrating a legacy in-tenant
        // dev account out) — no wipe needed.
        const added = await ensureDemoUsers(storage, existing.id);
        const platformChanged = await ensurePlatform(storage);
        const msgs: string[] = [];
        if (added > 0) msgs.push(`added ${added} missing demo account(s)`);
        if (platformChanged) msgs.push("provisioned the platform org + developer account");
        console.log(
          msgs.length
            ? `Database already seeded — ${msgs.join(" and ")}. Password: "${DEV_PASSWORD}".`
            : "Database already seeded and all accounts present — nothing to do.",
        );
      } else {
        const result = await seed(storage);
        console.log(
          `Seeded org ISPN (#${result.orgId}) + platform org (#${result.platformOrgId}). Dev password: "${DEV_PASSWORD}".`,
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
