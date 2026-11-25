import { createHash } from "node:crypto";
import { PLATFORM_ORG_CODE } from "@shared/schema";
import { hashPassword, verifyPassword } from "./auth.js";
import { getHandle } from "./db.js";
import { DatabaseStorage, setStorage } from "./storage.js";

// Password for the SYNTHETIC demo clinical roster (chen/director/er.doc/…).
// These are shared, well-known demo credentials by design: they only ever exist
// on a synthetic-data instance (see isSyntheticDataMode) and they never carry
// cross-tenant privilege. Override per-deployment with DEMO_PASSWORD.
const DEFAULT_DEMO_PASSWORD = "docturn";

/** Password used for every seeded demo CLINICAL account. Never logged. */
function demoPassword(): string {
  return process.env.DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD;
}

/**
 * Synthetic-data mode is the default; only the literal string "false" opts a
 * deployment into real PHI. A real-PHI instance must never carry shared demo
 * credentials, so all demo seeding is refused when this returns false.
 */
export function isSyntheticDataMode(): boolean {
  return process.env.SYNTHETIC_DATA !== "false";
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * The `dev` account is cross-tenant root (it can impersonate into and read every
 * org), so it must never be auto-provisioned with a guessable password on a
 * publicly reachable instance. On production — or on any real-PHI instance —
 * it is created ONLY from a PLATFORM_ADMIN_PASSWORD of at least this length.
 */
const MIN_PLATFORM_ADMIN_PASSWORD_LENGTH = 12;

function platformAdminPasswordEnv(): string {
  return process.env.PLATFORM_ADMIN_PASSWORD ?? "";
}

/**
 * True when the root account must be gated behind a strong env password.
 *
 * The gate is REAL-PHI mode, not merely "production". A synthetic instance
 * already publishes shared demo credentials for every clinical role on the same
 * public URL, so refusing to seed `dev` there bought no real protection while
 * making the developer console unreachable on a hosted demo — the operator has
 * no shell to run a seed script and the account cannot be created any other
 * way. What the gate genuinely protects is PATIENT data, and that boundary is
 * unchanged: with SYNTHETIC_DATA=false the account is still refused unless
 * PLATFORM_ADMIN_PASSWORD is set to a strong secret.
 *
 * A synthetic deployment that still wants the account locked down can set
 * PLATFORM_ADMIN_PASSWORD; it takes precedence over the demo password below.
 */
function rootAccountIsGated(): boolean {
  return !isSyntheticDataMode();
}

// The platform/developer tenant. Kept separate from clinical tenants so the
// developer can delete any hospital org without destroying their own account.
// Its code lives in shared/schema.ts (PLATFORM_ORG_CODE) because the auth layer
// must recognise it too: public self-registration against this org is refused
// (server/auth.ts /api/register answers as if the org did not exist).
export const PLATFORM_ORG = { name: "DocTurn Platform", code: PLATFORM_ORG_CODE };

/** Thrown (and caught by callers) when demo seeding is refused in real-PHI mode. */
const REAL_PHI_REFUSAL =
  "refusing to seed shared demo accounts: SYNTHETIC_DATA=false (real-PHI mode). " +
  "Provision real accounts instead, or unset SYNTHETIC_DATA to run a synthetic instance.";

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
  // Real-PHI instances get no demo clinical roster at all.
  if (!isSyntheticDataMode()) {
    console.warn(`[seed] ${REAL_PHI_REFUSAL}`);
    throw new Error(REAL_PHI_REFUSAL);
  }

  const org = await storage.createOrganization({
    name: "Riverside General (demo)",
    code: "ISPN",
    city: "Springfield",
    state: "NY",
    timezone: "America/New_York",
    assignmentTimeoutMin: 15,
    roundRobinShiftTypes: ["day", "night"],
    rotationMode: "lowest_census",
    rotationIndex: 0,
  });

  const passwordHash = await hashPassword(demoPassword());
  const userIds: Record<string, number> = {};

  // Platform org + developer account (separate from the clinical tenant).
  // Idempotent so reseeding a DB that still has the platform org doesn't collide.
  // NOTE: on a gated instance ensurePlatform deliberately does NOT create `dev`,
  // so the account may legitimately be absent here.
  await ensurePlatform(storage);
  const platform = (await storage.getOrganizationByCode(PLATFORM_ORG.code))!;
  const devUser = await storage.getUserByUsername(platform.id, "dev");
  if (devUser) userIds["dev"] = devUser.id;

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

  // The demo on-call roster (fictional names)
  // (amion.com/cgi-bin/ocs), not placeholder names. The first four keep stable
  // demo usernames so the role-based demo login still resolves a hospitalist;
  // the rest fill out the captured grid so the director's roster matches Amion.
  // shiftType drives the schedule-time on-call (day/swing/night).
  const ROSTER: Array<{
    u: string; name: string; cred: string;
    shift: "day" | "swing" | "night"; census: number; cap: number; working: boolean;
  }> = [
    { u: "chen",       name: "Dr. Nolan Avery",    cred: "MD", shift: "day",   census: 0, cap: 12, working: true },
    { u: "patel",      name: "Dr. Sara Grant",    cred: "MD", shift: "day",   census: 5, cap: 12, working: true },
    { u: "lopez",      name: "Dr. Adam Archer",       cred: "DO", shift: "day",   census: 7, cap: 12, working: true },
    { u: "liu",        name: "Dr. Julia Dawson", cred: "MD", shift: "day",   census: 2, cap: 12, working: true },
    { u: "kazanchyan", name: "Dr. Max Keller",   cred: "MD", shift: "day",   census: 4, cap: 12, working: true },
    { u: "gideon",     name: "Dr. Dean Gibson",     cred: "MD", shift: "day",   census: 6, cap: 12, working: true },
    { u: "gopal",      name: "Dr. Aron Gordon",       cred: "MD", shift: "day",   census: 3, cap: 12, working: true },
    { u: "williams",   name: "Dr. Nina Wells",  cred: "MD", shift: "day",   census: 5, cap: 12, working: true },
    { u: "malhotra",   name: "Dr. Victor Mason",  cred: "MD", shift: "day",   census: 4, cap: 12, working: true },
    { u: "manukian",   name: "Dr. Nora Mills",   cred: "MD", shift: "swing", census: 2, cap: 12, working: true },
    { u: "kohan",      name: "Dr. Sam Keane",      cred: "MD", shift: "night", census: 1, cap: 12, working: true },
    { u: "niculescu",  name: "Dr. Alex Novak",   cred: "MD", shift: "night", census: 1, cap: 12, working: true },
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

  // Org-wide composer templates (idempotent by title).
  await ensureMessageTemplates(storage, org.id);

  return {
    orgId: org.id,
    platformOrgId: platform.id,
    userIds,
    hospitalistIds,
    patientIds: { sc: p1.id },
  };
}

// Sensible org-wide message templates for a hospitalist group. `{room}` is a
// placeholder the sender fills in before sending. No PHI.
const ORG_MESSAGE_TEMPLATES: Array<{
  title: string;
  body: string;
  priority: "routine" | "urgent" | "stat";
}> = [
  { title: "Call back re: bed", body: "Please call back re: bed {room}.", priority: "urgent" },
  { title: "Consult requested", body: "Consult requested — see patient thread.", priority: "routine" },
  { title: "STAT: need you at bedside", body: "STAT: need you at bedside — room {room}.", priority: "stat" },
  { title: "Handoff complete", body: "Handoff complete, see notes.", priority: "routine" },
  { title: "Running late", body: "Running late, cover 15 min?", priority: "routine" },
  { title: "Patient ready for admission", body: "Patient ready for admission — room {room}.", priority: "routine" },
];

/**
 * Ensure the org-wide message templates exist for an org. Idempotent: matches
 * on title among the org's ORG-WIDE templates, so re-running never duplicates
 * and never touches personal templates. Returns the number added.
 */
export async function ensureMessageTemplates(
  storage: DatabaseStorage,
  orgId: number,
): Promise<number> {
  // listMessageTemplates(orgId, userId) returns org-wide + that user's own;
  // userId 0 matches nobody, so this is exactly the org-wide set.
  const existing = await storage.listMessageTemplates(orgId, 0);
  const have = new Set(
    existing.filter((t) => t.ownerUserId == null).map((t) => t.title.toLowerCase()),
  );
  let added = 0;
  for (const t of ORG_MESSAGE_TEMPLATES) {
    if (have.has(t.title.toLowerCase())) continue;
    await storage.createMessageTemplate({
      organizationId: orgId,
      ownerUserId: null,
      title: t.title,
      body: t.body,
      priority: t.priority,
    });
    added++;
  }
  return added;
}

// The clinical demo roster (ISPN). The developer (`dev`) is provisioned
// separately in the platform org — see ensurePlatform().
const DEMO_USERS: Array<{ username: string; role: string; displayName: string; credential?: string }> = [
  { username: "director", role: "director", displayName: "Dr. Dana Director" },
  { username: "er.director", role: "er_director", displayName: "Dr. Evan Marsh", credential: "MD" },
  { username: "er.doc", role: "er_doctor", displayName: "Dr. Erin Reyes", credential: "MD" },
  // Fictional demo roster; usernames stay stable for demo login.
  { username: "chen", role: "hospitalist", displayName: "Dr. Nolan Avery", credential: "MD" },
  { username: "patel", role: "hospitalist", displayName: "Dr. Sara Grant", credential: "MD" },
  { username: "lopez", role: "hospitalist", displayName: "Dr. Adam Archer", credential: "DO" },
  { username: "liu", role: "hospitalist", displayName: "Dr. Julia Dawson", credential: "MD" },
  { username: "wu", role: "hospitalist", displayName: "Jordan Wu, PA-C", credential: "PA" },
];

/**
 * Databases seeded before the demo roster was made fictional still hold the
 * earlier display names. Rename exactly those rows (matched by seeded username
 * AND a hash of the earlier name, so a name someone edited is left alone) and
 * the demo hospital's earlier name. Idempotent; synthetic instances only.
 */
const LEGACY_DEMO_NAMES: Array<{ username: string; was: string; name: string }> = [
  { username: "chen", was: "e7af8b745d9a187a", name: "Dr. Nolan Avery" },
  { username: "patel", was: "fcc459eb2ecf8629", name: "Dr. Sara Grant" },
  { username: "lopez", was: "2e48049999c0db07", name: "Dr. Adam Archer" },
  { username: "liu", was: "6368115b6f6f0df2", name: "Dr. Julia Dawson" },
  { username: "kazanchyan", was: "7b60673fe0260029", name: "Dr. Max Keller" },
  { username: "gideon", was: "f3bc5f49a2f1d630", name: "Dr. Dean Gibson" },
  { username: "gopal", was: "b589416ec9fcca9d", name: "Dr. Aron Gordon" },
  { username: "williams", was: "6b303c2193a79654", name: "Dr. Nina Wells" },
  { username: "malhotra", was: "e2a591a63cd73b19", name: "Dr. Victor Mason" },
  { username: "manukian", was: "701178fecdb3893c", name: "Dr. Nora Mills" },
  { username: "kohan", was: "af2dee8b51fe1909", name: "Dr. Sam Keane" },
  { username: "niculescu", was: "ae17da9965eded2d", name: "Dr. Alex Novak" },
];
const LEGACY_DEMO_ORG_NAME = "a8425a49505859f5";
const nameHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
export async function renameLegacyDemoNames(storage: DatabaseStorage, orgId: number): Promise<number> {
  if (!isSyntheticDataMode()) return 0;
  let renamed = 0;
  for (const row of LEGACY_DEMO_NAMES) {
    const u = await storage.getUserByUsername(orgId, row.username);
    if (u && nameHash(u.displayName) === row.was) {
      await storage.updateUser(u.id, { displayName: row.name });
      renamed++;
    }
  }
  const org = await storage.getOrganization(orgId);
  if (org && nameHash(org.name) === LEGACY_DEMO_ORG_NAME) {
    await storage.updateOrganization(orgId, { name: "Riverside General (demo)" });
    renamed++;
  }
  return renamed;
}

/**
 * The demo's charge nurse — a STAFF account, so the demo can show what a
 * nurse sees. Added at server start on synthetic instances only (never by
 * seed(), which the test suite counts accounts against). Idempotent.
 */
export async function ensureDemoStaff(storage: DatabaseStorage, orgId: number): Promise<boolean> {
  if (!isSyntheticDataMode()) return false;
  if (await storage.getUserByUsername(orgId, "nurse")) return false;
  await storage.createUser({
    organizationId: orgId,
    username: "nurse",
    passwordHash: await hashPassword(demoPassword()),
    role: "staff",
    displayName: "Riley Morgan",
    credential: "RN",
    jobTitle: "Charge nurse, ED",
    phone: null,
    twoFactorEnabled: false,
  });
  return true;
}

/**
 * A believable board for the demo: each hospitalist's seeded census number
 * gets that many accepted patients behind it, so Team census, the Patient
 * board, hand-off and the trends have something real to show. Entirely
 * invented people. Added once at server start on synthetic instances only
 * (never by seed(), which the test suite counts rows against); these
 * patients are kept by auto-clean so the demo does not empty overnight.
 */
const DEMO_GIVEN = ["Ada", "Ben", "Cora", "Dev", "Elena", "Felix", "Gia", "Hugo", "Iris", "Jonah", "Kira", "Leo", "Mina", "Noel", "Opal", "Pablo", "Quinn", "Rosa", "Seth", "Tess"];
const DEMO_FAMILY = ["Abbott", "Barlow", "Castell", "Dunmore", "Ellery", "Fenwick", "Garrow", "Hollis", "Ingram", "Jarvis", "Kessler", "Lindqvist", "Marlowe", "Nakata", "Orsini", "Pruett", "Quill", "Rennick", "Sorrell", "Tamsin"];
const DEMO_WHY: Array<[string, string, number]> = [
  ["Community-acquired pneumonia, on oxygen", "Pulmonology", 3], ["CHF exacerbation, diuresing", "Cardiology", 3], ["Cellulitis of the left leg", "General", 4],
  ["Upper GI bleed, stable after transfusion", "Gastroenterology", 2], ["COPD exacerbation", "Pulmonology", 3], ["Urosepsis, improving", "General", 2],
  ["Atrial fibrillation with rapid rate", "Cardiology", 3], ["Diabetic ketoacidosis, gap closed", "Endocrinology", 2], ["Acute kidney injury", "Nephrology", 3],
  ["Hip fracture, awaiting surgery", "Orthopedics", 3], ["Syncope, telemetry", "Cardiology", 4], ["Small bowel obstruction, NG tube", "Surgery", 3],
];
export async function ensureDemoBoard(storage: DatabaseStorage, orgId: number): Promise<number> {
  if (!isSyntheticDataMode()) return 0;
  if ((await storage.getOrgSetting(orgId, "demoBoardSeeded")) === true) return 0;
  const [hosps, erDoc, existing] = await Promise.all([storage.listHospitalists(orgId), storage.getUserByUsername(orgId, "er.doc"), storage.listPatients(orgId)]);
  // Only onto a board that still looks as seeded; a demo someone has been using is left alone.
  if (existing.length > 3 || !erDoc) {
    await storage.setOrgSetting(orgId, "demoBoardSeeded", true, null as unknown as number);
    return 0;
  }
  let n = 0;
  const now = Date.now();
  for (const h of hosps) {
    for (let i = 0; i < Math.min(h.currentPatientCount, 9); i++, n++) {
      const given = DEMO_GIVEN[(n * 7 + 3) % DEMO_GIVEN.length]!, family = DEMO_FAMILY[(n * 11 + 5) % DEMO_FAMILY.length]!;
      const [why, specialty, acuity] = DEMO_WHY[n % DEMO_WHY.length]!;
      const sentAt = new Date(now - (2 + ((n * 37) % 20)) * 3_600_000 - ((n * 13) % 50) * 60_000);
      const patient = await storage.createPatient({
        organizationId: orgId,
        initials: given[0]! + family[0]!,
        roomNumber: String(300 + ((n * 17) % 240)),
        issueSummary: why,
        specialty,
        department: ["4 West", "5 West", "5 East", "6 North", "ICU step-down"][n % 5]!,
        acuity,
        status: "assigned",
        erDoctorId: erDoc.id,
        assignedHospitalistId: h.id,
        fullName: `${given} ${family}`,
        dateOfBirth: `${1938 + ((n * 5) % 55)}-${String(1 + ((n * 3) % 12)).padStart(2, "0")}-${String(1 + ((n * 7) % 28)).padStart(2, "0")}`,
        mrn: "DEMO" + String(100200 + n * 37),
        source: "demo",
      });
      const a = await storage.createAssignment({
        organizationId: orgId, patientId: patient.id, hospitalistId: h.id, erDoctorId: erDoc.id, status: "accepted",
        via: n % 4 === 0 ? "manual" : "round_robin", acceptedByUserId: h.userId, expiresAt: new Date(sentAt.getTime() + 15 * 60_000),
      });
      // Sent some hours ago, accepted a few minutes later.
      await storage.updateAssignment(orgId, a.id, { createdAt: sentAt, resolvedAt: new Date(sentAt.getTime() + (2 + ((n * 5) % 9)) * 60_000) });
      await storage.updatePatient(orgId, patient.id, { createdAt: new Date(sentAt.getTime() - 20 * 60_000) });
    }
  }
  await storage.setOrgSetting(orgId, "demoBoardSeeded", true, null as unknown as number);
  return n;
}

/** Create any missing demo accounts in an already-seeded org. Returns count added. */
async function ensureDemoUsers(
  storage: DatabaseStorage,
  orgId: number,
): Promise<number> {
  if (!isSyntheticDataMode()) {
    console.warn(`[seed] ${REAL_PHI_REFUSAL}`);
    return 0;
  }
  const passwordHash = await hashPassword(demoPassword());
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

  const envPassword = platformAdminPasswordEnv();
  const strongEnvPassword =
    envPassword.length >= MIN_PLATFORM_ADMIN_PASSWORD_LENGTH;
  const gated = rootAccountIsGated();

  const dev = await storage.getUserByUsername(platform.id, "dev");
  if (dev) {
    // PLATFORM_ADMIN_PASSWORD is the operator's EXPLICIT instruction about this
    // account, so honour it even when the account already exists. Without this
    // the variable silently did nothing on any already-seeded database (every
    // persistent deployment after its first boot): the operator sets the secret,
    // redeploys, and still cannot sign in — with no clue why. Aligning the
    // stored hash with the configured secret is the opposite of a silent
    // rotation: it is the operator's own value, applied where they asked.
    if (strongEnvPassword) {
      const alreadyCurrent = await verifyPassword(envPassword, dev.passwordHash);
      if (!alreadyCurrent) {
        // A credential rotation: stamp passwordChangedAt so any session that
        // survived the restart (a shared store) is invalidated like any other
        // password change (server/auth.ts resolveSessionUser).
        await storage.updateUser(dev.id, {
          passwordHash: await hashPassword(envPassword),
          passwordChangedAt: new Date(),
        });
        changed = true;
        console.log(
          "[seed] rotated the platform root account `dev` to the configured PLATFORM_ADMIN_PASSWORD.",
        );
      }
      return changed;
    }
    // Never silently delete or rotate an existing operator account — that would
    // lock the operator out. Warn loudly instead so they rotate it themselves.
    if (gated && !strongEnvPassword) {
      console.warn(
        "[seed] SECURITY: the cross-tenant root account `dev` exists on a " +
          "hardened instance (production and/or real-PHI) but PLATFORM_ADMIN_PASSWORD " +
          `is not set to a value of at least ${MIN_PLATFORM_ADMIN_PASSWORD_LENGTH} characters. ` +
          "This account may still be using the well-known default password and can read " +
          "every tenant. ACTION REQUIRED: set PLATFORM_ADMIN_PASSWORD on this deployment " +
          "and rotate the `dev` password now.",
      );
    }
    return changed;
  }

  if (gated && !strongEnvPassword) {
    // Do not ship a guessable cross-tenant root credential.
    console.warn(
      "[seed] SECURITY: refusing to create the cross-tenant root account `dev` — " +
        "this instance is production and/or real-PHI and PLATFORM_ADMIN_PASSWORD is " +
        (envPassword
          ? `shorter than ${MIN_PLATFORM_ADMIN_PASSWORD_LENGTH} characters.`
          : "not set.") +
        ` ACTION REQUIRED: set PLATFORM_ADMIN_PASSWORD to a strong secret of at least ${MIN_PLATFORM_ADMIN_PASSWORD_LENGTH} ` +
        "characters and restart to provision it. Demo clinical accounts are unaffected.",
    );
    return changed;
  }

  // Outside the gate (local/dev synthetic instances) fall back to the demo
  // password so `npm run dev` keeps working with zero configuration.
  const rootPassword = envPassword || demoPassword();
  await storage.createUser({
    organizationId: platform.id,
    username: "dev",
    passwordHash: await hashPassword(rootPassword),
    role: "developer" as never,
    displayName: "Platform Operator",
    credential: null as never,
    phone: null,
    twoFactorEnabled: false,
  });
  changed = true;
  if (envPassword) {
    console.log(
      "[seed] provisioned the platform root account `dev` from PLATFORM_ADMIN_PASSWORD.",
    );
  } else if (isProduction()) {
    // Reachable from the internet with a shared, well-known password. Fine for
    // synthetic data; say so plainly every boot so it cannot become the quiet
    // default once this deployment starts to matter.
    console.warn(
      "[seed] NOTICE: the cross-tenant root account `dev` was provisioned with the " +
        "shared demo password because this is a SYNTHETIC-data deployment. It can read " +
        "every demo tenant and is reachable from the internet. Before this instance " +
        "carries real PHI, set PLATFORM_ADMIN_PASSWORD (12+ characters) and/or " +
        "SYNTHETIC_DATA=false.",
    );
  } else {
    console.log(
      "[seed] provisioned the platform root account `dev` with the local development password.",
    );
  }
  return changed;
}

/**
 * Two additional, fully-isolated demo tenants, seeded idempotently (skip if the
 * org code already exists — same skip-if-exists pattern the seed uses per org).
 * Kept separate from ISPN/DOCTURN so neither tenant can see the other's users
 * or data.
 *   - HOSP "Summit Hospitalist Group" — hospitalist-director demo.
 *   - ER   "Metro ER Network"        — ER-director demo.
 * Both admins deliberately share username `director` / password `docturn`;
 * usernames are unique per-org, so they differ only by org code.
 */
export async function ensureDemoTenants(storage: DatabaseStorage): Promise<void> {
  if (!isSyntheticDataMode()) {
    console.warn(`[seed] ${REAL_PHI_REFUSAL}`);
    return;
  }
  const passwordHash = await hashPassword(demoPassword());

  async function addUser(
    orgId: number,
    username: string,
    role: string,
    displayName: string,
    credential: string | null = null,
  ) {
    return storage.createUser({
      organizationId: orgId,
      username,
      passwordHash,
      role: role as never,
      displayName,
      credential: credential as never,
      phone: null,
      twoFactorEnabled: false,
    });
  }

  async function addProvider(
    orgId: number,
    userId: number,
    specialty: string,
    census: number,
    cap: number,
    working: boolean,
    order: number,
    shiftType: "day" | "swing" | "night",
  ) {
    return storage.createHospitalist({
      organizationId: orgId,
      userId,
      specialty,
      currentPatientCount: census,
      patientCap: cap,
      rotationOrder: order,
      working,
      shiftType,
    });
  }

  // ---- Hospital A: Summit Hospitalist Group (HOSP) — hospitalist director -----
  if (!(await storage.getOrganizationByCode("HOSP"))) {
    const org = await storage.createOrganization({
      name: "Summit Hospitalist Group",
      code: "HOSP",
      city: "Boulder",
      state: "CO",
      timezone: "America/Denver",
      assignmentTimeoutMin: 15,
      roundRobinShiftTypes: ["day", "night"],
      rotationMode: "lowest_census",
      rotationIndex: 0,
    });

    await addUser(org.id, "director", "director", "Dr. Morgan Hale", "MD");
    // An ER doctor exists purely to author the seeded pending assignments so the
    // hand-off flow is real (an assignment needs an er_doctor creator id).
    const erDoc = await addUser(org.id, "er.doc", "er_doctor", "Dr. Priya Nair", "MD");

    const roster: Array<{
      u: string; name: string; cred: string; specialty: string;
      census: number; cap: number; working: boolean; shift: "day" | "swing" | "night";
    }> = [
      { u: "okafor", name: "Dr. Sam Okafor", cred: "MD", specialty: "General",           census: 3, cap: 10, working: true,  shift: "day"   },
      { u: "voss",   name: "Dr. Lena Voss",  cred: "MD", specialty: "Cardiology",        census: 8, cap: 14, working: true,  shift: "swing" },
      { u: "raj",    name: "Dr. Raj Patel",  cred: "DO", specialty: "Pulmonology",       census: 5, cap: 12, working: false, shift: "night" },
      { u: "kim",    name: "Dr. Chloe Kim",  cred: "MD", specialty: "Hospital Medicine", census: 2, cap: 8,  working: true,  shift: "day"   },
    ];
    const hosp: Record<string, number> = {};
    let order = 0;
    for (const r of roster) {
      const u = await addUser(org.id, r.u, "hospitalist", r.name, r.cred);
      const h = await addProvider(org.id, u.id, r.specialty, r.census, r.cap, r.working, order++, r.shift);
      hosp[r.u] = h.id;
    }

    const patients: Array<{ initials: string; room: string; summary: string; specialty: string; acuity: number }> = [
      { initials: "JD", room: "210", summary: "Chest pain, rule out ACS",              specialty: "Cardiology",  acuity: 2 },
      { initials: "MR", room: "305", summary: "Shortness of breath, COPD flare",       specialty: "Pulmonology", acuity: 3 },
      { initials: "TW", room: "112", summary: "Abdominal pain, possible obstruction",  specialty: "General",     acuity: 3 },
    ];
    const pids: number[] = [];
    for (const p of patients) {
      const created = await storage.createPatient({
        organizationId: org.id,
        initials: p.initials,
        roomNumber: p.room,
        issueSummary: p.summary,
        specialty: p.specialty,
        department: "Emergency",
        acuity: p.acuity,
        status: "waiting",
        erDoctorId: erDoc.id,
        assignedHospitalistId: null,
      });
      pids.push(created.id);
    }

    // Pending assignments routed to a few providers so the director/hospitalist
    // dashboards show live pending work.
    const routes: Array<[number, number]> = [
      [pids[0]!, hosp["voss"]!],
      [pids[1]!, hosp["okafor"]!],
      [pids[2]!, hosp["kim"]!],
    ];
    for (const [patientId, hospitalistId] of routes) {
      await storage.createAssignment({
        organizationId: org.id,
        patientId,
        hospitalistId,
        erDoctorId: erDoc.id,
        status: "pending",
        via: "round_robin",
        acceptedByUserId: null,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });
    }
  }

  // ---- Hospital B: Metro ER Network (ER) — ER director -----------------------
  if (!(await storage.getOrganizationByCode("ER"))) {
    const org = await storage.createOrganization({
      name: "Metro ER Network",
      code: "ER",
      city: "Metro City",
      state: "IL",
      timezone: "America/Chicago",
      assignmentTimeoutMin: 15,
      roundRobinShiftTypes: ["day", "night"],
      rotationMode: "lowest_census",
      rotationIndex: 0,
    });

    await addUser(org.id, "director", "er_director", "Dr. Alex Reyes", "MD");
    const erDocs = [
      await addUser(org.id, "er.doc1", "er_doctor", "Dr. Tara Singh",  "MD"),
      await addUser(org.id, "er.doc2", "er_doctor", "Dr. Ben Carter",  "MD"),
      await addUser(org.id, "er.doc3", "er_doctor", "Dr. Nadia Frost", "DO"),
    ];

    // Two hospitalists exist only as routing targets so the ER hand-off flow is
    // functional. Kept minimal (working=true, no extra data).
    const routeHosp: number[] = [];
    let order = 0;
    for (const h of [
      { u: "holt", name: "Dr. Ivan Holt", cred: "MD", shift: "day" as const },
      { u: "reed", name: "Dr. Maya Reed", cred: "MD", shift: "night" as const },
    ]) {
      const u = await addUser(org.id, h.u, "hospitalist", h.name, h.cred);
      const prof = await addProvider(org.id, u.id, "Hospital Medicine", 0, 12, true, order++, h.shift);
      routeHosp.push(prof.id);
    }

    const patients: Array<{ initials: string; room: string; summary: string; acuity: number }> = [
      { initials: "AB", room: "ER-1", summary: "Fever and cough, awaiting workup", acuity: 3 },
      { initials: "CD", room: "ER-2", summary: "Laceration, awaiting suture",       acuity: 4 },
      { initials: "EF", room: "ER-3", summary: "Palpitations, on monitor",          acuity: 2 },
    ];
    const pids: number[] = [];
    for (const p of patients) {
      const created = await storage.createPatient({
        organizationId: org.id,
        initials: p.initials,
        roomNumber: p.room,
        issueSummary: p.summary,
        specialty: "General",
        department: "Emergency",
        acuity: p.acuity,
        status: "waiting",
        erDoctorId: erDocs[0]!.id,
        assignedHospitalistId: null,
      });
      pids.push(created.id);
    }

    // A couple of pending hand-offs from ER doctors to the routing hospitalists.
    await storage.createAssignment({
      organizationId: org.id,
      patientId: pids[0]!,
      hospitalistId: routeHosp[0]!,
      erDoctorId: erDocs[0]!.id,
      status: "pending",
      via: "round_robin",
      acceptedByUserId: null,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    await storage.createAssignment({
      organizationId: org.id,
      patientId: pids[2]!,
      hospitalistId: routeHosp[1]!,
      erDoctorId: erDocs[1]!.id,
      status: "pending",
      via: "round_robin",
      acceptedByUserId: null,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
  }
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
        await renameLegacyDemoNames(storage, existing.id);
        const added = await ensureDemoUsers(storage, existing.id);
        const platformChanged = await ensurePlatform(storage);
        const templatesAdded = await ensureMessageTemplates(storage, existing.id);
        const msgs: string[] = [];
        if (added > 0) msgs.push(`added ${added} missing demo account(s)`);
        if (templatesAdded > 0) msgs.push(`added ${templatesAdded} org message template(s)`);
        if (platformChanged) msgs.push("provisioned the platform org + developer account");
        console.log(
          msgs.length
            ? `Database already seeded — ${msgs.join(" and ")}. Demo password: DEMO_PASSWORD (default: the documented demo password).`
            : "Database already seeded and all accounts present — nothing to do.",
        );
      } else {
        const result = await seed(storage);
        console.log(
          `Seeded org ISPN (#${result.orgId}) + platform org (#${result.platformOrgId}).`,
        );
      }
      // Idempotently provision the two isolated demo tenants (HOSP + ER).
      await ensureDemoTenants(storage);
    } catch (err) {
      console.error("Seed failed:", err);
      process.exitCode = 1;
    }
    await handle.close();
  })();
}

/**
 * The demo clinical password, resolved once at import. Exported for the test
 * harness (tests/helpers.ts logs in as the seeded demo accounts) and for any
 * caller that needs the same value `seed()` used. This is a SYNTHETIC-only
 * credential — it is never used for the cross-tenant root account on a gated
 * instance (see ensurePlatform / PLATFORM_ADMIN_PASSWORD).
 */
const DEV_PASSWORD = demoPassword();

export { DEV_PASSWORD, demoPassword };
