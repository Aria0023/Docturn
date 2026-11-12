import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

/**
 * DocTurn talks to Postgres through Drizzle. To honor "boots and tests with no
 * secrets", the default driver is in-process PGlite (a full Postgres compiled to
 * WASM). When DATABASE_URL is present we use a real `pg.Pool` instead — same
 * schema, same queries.
 */

export type DbType = ReturnType<typeof drizzlePg<typeof schema>>;

/**
 * Where the rows actually live. Spelled out because "ephemeral" alone was
 * misleading: an on-disk PGlite store DOES survive a restart — it is simply a
 * single-process, unencrypted dev/trial database, not a production one.
 *
 *  - postgres       external Postgres via DATABASE_URL (RDS etc.). Durable,
 *                   multi-instance, encryption-at-rest is the hosting tier's.
 *  - pglite-disk    PGlite data files under `dataDir` (PGLITE_DIR, default
 *                   ./.pglite). Durable across restarts, single process only,
 *                   NOT encrypted by the application — plain files on disk.
 *  - pglite-memory  PGlite with no directory (tests). Gone when the process
 *                   exits.
 */
export type DbStorageKind = "postgres" | "pglite-disk" | "pglite-memory";

export interface DbHandle {
  db: DbType;
  /** Whether we are running on in-process PGlite (true) or a real Postgres pool. */
  ephemeral: boolean;
  /** Precise description of the store (see DbStorageKind). */
  storage: DbStorageKind;
  /** PGlite data directory when storage === "pglite-disk". Never sent to clients. */
  dataDir?: string;
  /** Rows survive a process restart (postgres and pglite-disk). */
  durable: boolean;
  /** The pg.Pool behind a real Postgres handle (shared with the session store). */
  pool?: pg.Pool;
  /** Push the schema. Only meaningful for PGlite; for real PG use `drizzle-kit push`. */
  ensureSchema: () => Promise<void>;
  close: () => Promise<void>;
}

let handle: DbHandle | null = null;

export function getDb(): DbType {
  return getHandle().db;
}

export function getHandle(): DbHandle {
  if (!handle) {
    handle = createDb({
      pgliteDir: process.env.DATABASE_URL
        ? undefined
        : (process.env.PGLITE_DIR ?? "./.pglite"),
    });
  }
  return handle;
}

/** Drop the cached handle so the next getHandle() rebuilds it (used in recovery). */
export function resetHandle(): void {
  handle = null;
}

/**
 * Point the global handle at a specific database. Used by tests so getDb() (e.g.
 * the health endpoint) hits the isolated in-memory test DB instead of the shared
 * on-disk ./.pglite, which parallel test workers would otherwise contend on.
 */
export function setHandle(h: DbHandle): void {
  handle = h;
}

/**
 * Open the database and apply the schema, self-healing a corrupted on-disk
 * PGlite store. A hard kill of the dev server can leave ./.pglite in a state
 * where PGlite's WASM aborts on init ("_pg_initdb"), which previously made the
 * server fail to boot entirely. For the in-process dev database we recover by
 * deleting the directory and recreating it; the caller reseeds. Real Postgres
 * (DATABASE_URL) is never auto-wiped.
 */
export async function initDbWithRecovery(): Promise<{ handle: DbHandle; recovered: boolean }> {
  const dir = process.env.DATABASE_URL ? undefined : (process.env.PGLITE_DIR ?? "./.pglite");

  // Force Drizzle to resolve every schema-defined column on the core tables. A
  // store created by an older schema (data present, columns missing) opens fine
  // but throws "column ... does not exist" on these selects — which previously
  // surfaced as a 500 on login. Running it here lets recovery catch schema drift
  // the same way it catches a corrupt/uninitialized store. Uses a dummy org id
  // so it works even on an empty database.
  async function probeSchema(h: DbHandle): Promise<void> {
    const { DatabaseStorage } = await import("./storage.js");
    const s = new DatabaseStorage(h.db);
    await s.listOrganizations();
    await s.listUsers(0);
    await s.listHospitalists(0);
    await s.listPatients(0);
    await s.listAssignments(0);
    await s.listDepartments(0);
    await s.listBeds(0);
    await s.listEquipment(0);
  }

  try {
    const h = getHandle();
    await h.ensureSchema();
    await probeSchema(h);
    return { handle: h, recovered: false };
  } catch (err) {
    if (!dir) throw err; // real Postgres — don't touch the user's data
    console.error("[db] dev database is corrupt or schema-stale — recovering by recreating " + dir + ":", err);
    try { await handle?.close(); } catch { /* the corrupt handle may throw on close */ }
    resetHandle();
    const { rm } = await import("node:fs/promises");
    await rm(dir, { recursive: true, force: true });
    const h = getHandle();
    await h.ensureSchema();
    return { handle: h, recovered: true };
  }
}

export interface CreateDbOptions {
  databaseUrl?: string;
  /** PGlite data directory. Omit for an in-memory database (tests). */
  pgliteDir?: string;
}

/**
 * Session-level advisory lock key for the boot sequence (schema + first-boot
 * seed) on a real Postgres. N instances starting at the same moment take it
 * in turn: `CREATE TABLE IF NOT EXISTS` is NOT atomic across sessions (two
 * parallel runs on an empty database fail with "duplicate key value violates
 * unique constraint pg_type_typname_nsp_index"), and two first-boot seeds
 * would both try to insert the demo org. 0x444f4354 spells "DOCT".
 */
export const BOOT_LOCK_KEY = 0x444f4354;

/**
 * Run `fn` while holding the boot advisory lock (Postgres only; PGlite is a
 * single process, so `fn` simply runs). The lock lives on one dedicated
 * connection for exactly the duration of `fn` and is released even if `fn`
 * throws. Re-entrant across calls, not within one (do not nest).
 */
export async function withBootLock<T>(h: Pick<DbHandle, "pool">, fn: () => Promise<T>): Promise<T> {
  if (!h.pool) return fn();
  const client = await h.pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [BOOT_LOCK_KEY]);
    try {
      return await fn();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [BOOT_LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.release();
  }
}

export function createDb(opts: CreateDbOptions = {}): DbHandle {
  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL;
  if (databaseUrl) {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    const db = drizzlePg(pool, { schema }) as unknown as DbType;
    return {
      db,
      ephemeral: false,
      storage: "postgres",
      durable: true,
      pool,
      ensureSchema: async () => {
        // A fresh cloud Postgres (e.g. a new Render database) starts with zero
        // tables. Apply the SAME idempotent DDL we use for PGlite so the app
        // self-provisions on first boot instead of crashing on an empty schema.
        // SCHEMA_SQL is standard Postgres (CREATE TABLE IF NOT EXISTS + additive
        // ALTER … ADD COLUMN IF NOT EXISTS), so re-running it every start is a
        // no-op once provisioned. (`drizzle-kit push` remains available for
        // richer migrations, but is no longer required just to boot.)
        // Under the boot lock, so N instances starting together apply it one
        // after another instead of racing (tests/pg-boot.test.ts).
        await withBootLock({ pool }, async () => {
          await pool.query(SCHEMA_SQL);
        });
      },
      close: async () => {
        await pool.end();
      },
    };
  }

  // PGlite: on-disk directory for the app (so `seed` and `dev` share state and
  // data persists across restarts), in-memory for tests (isolation).
  const client = opts.pgliteDir ? new PGlite(opts.pgliteDir) : new PGlite();
  const db = drizzlePglite(client, { schema }) as unknown as DbType;
  return {
    db,
    ephemeral: true,
    storage: opts.pgliteDir ? "pglite-disk" : "pglite-memory",
    ...(opts.pgliteDir ? { dataDir: opts.pgliteDir } : {}),
    durable: Boolean(opts.pgliteDir),
    ensureSchema: async () => {
      await pushSchema(client);
    },
    close: async () => {
      await client.close();
    },
  };
}

/**
 * Build a fresh, isolated in-memory database handle. Used by tests so each suite
 * gets its own Postgres with the schema applied.
 */
export async function createTestDb(): Promise<DbHandle> {
  const h = createDb({ databaseUrl: "" });
  await h.ensureSchema();
  return h;
}

/**
 * Apply the schema to a PGlite instance. We generate DDL directly from the
 * Drizzle table definitions' shapes so dev/test never need a migration file.
 */
async function pushSchema(client: PGlite): Promise<void> {
  await client.exec(SCHEMA_SQL);
}

/**
 * Hand-maintained DDL mirroring shared/schema.ts. Kept in lockstep with the
 * Drizzle tables; for production Postgres, `drizzle-kit push` is the source of
 * truth, but PGlite (dev/test) bootstraps from this.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  city TEXT,
  state TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  assignment_timeout_min INTEGER NOT NULL DEFAULT 10,
  round_robin_shift_types JSONB NOT NULL DEFAULT '["day","night"]'::jsonb,
  rotation_mode TEXT NOT NULL DEFAULT 'lowest_census',
  rotation_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  display_name TEXT NOT NULL,
  credential TEXT,
  phone TEXT,
  two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  disabled_at TIMESTAMP,
  password_changed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_org_username_uniq ON users(organization_id, username);
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP;
-- "Sign out everywhere" (E2): every session issued before this stops resolving.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_revoked_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS hospitalists (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  specialty TEXT NOT NULL DEFAULT 'General',
  current_patient_count INTEGER NOT NULL DEFAULT 0,
  patient_cap INTEGER NOT NULL DEFAULT 12,
  rotation_order INTEGER NOT NULL DEFAULT 0,
  working BOOLEAN NOT NULL DEFAULT FALSE,
  shift_type TEXT NOT NULL DEFAULT 'day'
);
-- Director's "Rotation / Off" switch (A.CON-SHO-29); additive, existing rows stay in rotation.
ALTER TABLE hospitalists ADD COLUMN IF NOT EXISTS in_rotation BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS patients (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  initials TEXT NOT NULL,
  room_number TEXT,
  issue_summary TEXT NOT NULL DEFAULT '',
  specialty TEXT,
  department TEXT,
  acuity INTEGER,
  status TEXT NOT NULL DEFAULT 'waiting',
  er_doctor_id INTEGER REFERENCES users(id),
  assigned_hospitalist_id INTEGER REFERENCES hospitalists(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- EHR identifier (MRN/CSN) for "Open in EHR" deep links; additive + nullable.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS ehr_id TEXT;

CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  hospitalist_id INTEGER NOT NULL REFERENCES hospitalists(id),
  er_doctor_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  via TEXT NOT NULL DEFAULT 'round_robin',
  accepted_by_user_id INTEGER REFERENCES users(id),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP
);

-- Admissions ledger (shared/schema.ts admissionEvents): one PHI-free row per
-- patient's FIRST routing, kept when purges delete the patient, so the
-- admissions counter does not drop (A.CON schedule #6). The INSERT backfills
-- patients routed before the ledger existed; idempotent (first routing wins).
CREATE TABLE IF NOT EXISTS admission_events (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  patient_id INTEGER NOT NULL,
  via TEXT NOT NULL,
  first_routed_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS admission_events_patient_uniq ON admission_events(patient_id);
CREATE INDEX IF NOT EXISTS admission_events_org_routed_idx ON admission_events(organization_id, first_routed_at);
INSERT INTO admission_events (organization_id, patient_id, via, first_routed_at)
  SELECT DISTINCT ON (patient_id) organization_id, patient_id, via, created_at
  FROM assignments ORDER BY patient_id, created_at ASC, id ASC
  ON CONFLICT (patient_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL DEFAULT 'direct',
  name TEXT,
  participant_ids JSONB NOT NULL,
  patient_id INTEGER REFERENCES patients(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patients(id);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'routine',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);
-- Additive columns for stores created before these fields existed (no-op on new).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'routine';
-- Forwarding provenance ({messageId, senderId, senderName, conversationId, sentAt}); NULL = original.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS forwarded_from JSONB;
-- Thread pages are keyset-paginated by id within a conversation (A.CON-SHO-65).
CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON messages(conversation_id, id);

-- Composer templates: owner_user_id NULL = org-wide, else personal.
CREATE TABLE IF NOT EXISTS message_templates (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  owner_user_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'routine',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_delivery_status (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  delivered_at TIMESTAMP,
  read_at TIMESTAMP,
  acknowledged_at TIMESTAMP,
  realerted_at TIMESTAMP,
  escalated_at TIMESTAMP
);
ALTER TABLE message_delivery_status ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP;
ALTER TABLE message_delivery_status ADD COLUMN IF NOT EXISTS realerted_at TIMESTAMP;
ALTER TABLE message_delivery_status ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS message_delivery_status_message_idx ON message_delivery_status(message_id);

-- Message attachments (images + files). SYNTHETIC-DATA PILOT ONLY: the bytes are
-- stored inline as base64 in the row. Production PHI requires encrypted object
-- storage (S3/GCS with a BAA), server-side AV scanning, and a signed-URL fetch
-- path — DO NOT ship this inline-base64 store for real patient data.
CREATE TABLE IF NOT EXISTS message_attachments (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  message_id INTEGER REFERENCES messages(id),
  uploader_id INTEGER NOT NULL REFERENCES users(id),
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  data_base64 TEXT NOT NULL,
  duration_ms INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id INTEGER,
  details JSONB,
  risk_level TEXT NOT NULL DEFAULT 'low',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS phi_access_logs (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  user_id INTEGER REFERENCES users(id),
  resource TEXT NOT NULL,
  resource_id INTEGER,
  patient_id INTEGER,
  method TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- WHICH record was read (accounting of disclosures / breach scoping). Additive
-- and nullable so stores written before these columns existed keep their rows.
ALTER TABLE phi_access_logs ADD COLUMN IF NOT EXISTS resource_id INTEGER;
ALTER TABLE phi_access_logs ADD COLUMN IF NOT EXISTS patient_id INTEGER;
-- The real operator behind an impersonated / managed-org session (NULL for an
-- ordinary session; no FK so it outlives the operator account).
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS impersonator_user_id INTEGER;
ALTER TABLE phi_access_logs ADD COLUMN IF NOT EXISTS impersonator_user_id INTEGER;

-- Six-year compliance archive: audit / PHI-access / security rows copied out of
-- a tenant before it is deleted, denormalized and WITHOUT foreign keys so they
-- survive the cascade. Ids + actions only, never clinical content.
CREATE TABLE IF NOT EXISTS retained_compliance_records (
  id SERIAL PRIMARY KEY,
  source_table TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  organization_id INTEGER,
  organization_code TEXT,
  organization_name TEXT,
  user_id INTEGER,
  user_username TEXT,
  user_display_name TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id INTEGER,
  patient_id INTEGER,
  method TEXT,
  ip TEXT,
  details JSONB,
  risk_level TEXT NOT NULL DEFAULT 'low',
  occurred_at TIMESTAMP NOT NULL,
  archived_at TIMESTAMP NOT NULL DEFAULT NOW(),
  archived_reason TEXT NOT NULL DEFAULT 'organization_deleted'
);
CREATE INDEX IF NOT EXISTS retained_compliance_org_idx ON retained_compliance_records(organization_id);

CREATE TABLE IF NOT EXISTS security_incidents (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  user_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  description TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS org_settings (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  key TEXT NOT NULL,
  value JSONB,
  type TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS org_settings_org_key_uniq ON org_settings(organization_id, key);

-- A hospital's own credentials for an organization-scope integration (Amion,
-- Epic). Secrets are ONE AES-256-GCM ciphertext (key: INTEGRATION_KEY env);
-- summary = non-secret display fields only. updated_by has no FK on purpose
-- (never blocks a user/tenant delete). Mirrors shared/schema.ts.
CREATE TABLE IF NOT EXISTS org_integration_credentials (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  integration_id TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  summary JSONB,
  updated_by INTEGER,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS org_integration_credentials_org_integration_uniq
  ON org_integration_credentials(organization_id, integration_id);

CREATE TABLE IF NOT EXISTS user_preferences (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  value JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS user_prefs_user_key_uniq ON user_preferences(user_id, key);

CREATE TABLE IF NOT EXISTS feature_flags (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  flag TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  variant TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_org_flag_uniq ON feature_flags(organization_id, flag);

CREATE TABLE IF NOT EXISTS suggestions (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  scope TEXT NOT NULL DEFAULT 'org',
  key TEXT NOT NULL,
  proposed_value JSONB,
  evidence TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mfa_credentials (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  secret TEXT NOT NULL,
  activated BOOLEAN NOT NULL DEFAULT FALSE,
  pending_secret TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE mfa_credentials ADD COLUMN IF NOT EXISTS pending_secret TEXT;

CREATE TABLE IF NOT EXISTS mfa_backup_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL,
  used_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS care_team_members (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  member_user_id INTEGER NOT NULL REFERENCES users(id),
  on_call BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS care_team_owner_member_uniq ON care_team_members(owner_user_id, member_user_id);

CREATE TABLE IF NOT EXISTS patient_consults (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  specialty TEXT NOT NULL,
  consultant_user_id INTEGER REFERENCES users(id),
  consultant_name TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  responded_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pending_registrations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  requested_role TEXT NOT NULL DEFAULT 'hospitalist',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- At most ONE pending request per (org, username): /api/register answers 409
-- request_pending on a re-submission and this index closes the race between
-- concurrent submissions. Databases written before the index existed may hold
-- duplicates; keep the newest pending row (it carries the credential the
-- requester typed most recently) and retire the older ones first, so the
-- CREATE UNIQUE INDEX below can never fail the boot.
UPDATE pending_registrations p SET status = 'rejected'
  WHERE p.status = 'pending'
    AND EXISTS (
      SELECT 1 FROM pending_registrations q
       WHERE q.organization_id = p.organization_id
         AND q.username = p.username
         AND q.status = 'pending'
         AND q.id > p.id
    );
CREATE UNIQUE INDEX IF NOT EXISTS pending_registrations_org_username_pending_uniq
  ON pending_registrations(organization_id, username) WHERE status = 'pending';

-- Usernames are case- and surrounding-whitespace-insensitive (A.CON-SHO-12/57,
-- server/usernames.ts): stored trimmed, unique per (org, lower(username)).
-- A database written before that rule may hold variants of one name in one
-- org ("chen" + "Chen", "lopez" + "lopez "), every one of them able to sign
-- in. Repair before the index is built: the OLDEST account keeps the name;
-- every later variant is deactivated (its sessions stop resolving at once)
-- and renamed out of the way ("Chen~variant-30"), with a medium-risk audit
-- row naming it, so an administrator can review, reset or remove it. Then
-- surrounding whitespace is stripped from every stored name. Idempotent.
WITH ranked AS (
  SELECT id, row_number() OVER (
           PARTITION BY organization_id,
                        lower(regexp_replace(username, '^[[:space:]]+|[[:space:]]+$', '', 'g'))
           ORDER BY id) AS rn
    FROM users
), blocked AS (
  UPDATE users u
     SET disabled_at = COALESCE(u.disabled_at, NOW()),
         username = regexp_replace(u.username, '^[[:space:]]+|[[:space:]]+$', '', 'g') || '~variant-' || u.id
    FROM ranked r
   WHERE r.id = u.id AND r.rn > 1
  RETURNING u.id, u.organization_id, u.username
)
INSERT INTO audit_logs (organization_id, user_id, action, resource_type, resource_id, details, risk_level)
SELECT organization_id, NULL, 'user.username_variant_blocked', 'user', id,
       jsonb_build_object('renamedTo', username, 'reason', 'case_or_whitespace_variant_of_an_older_account'),
       'medium'
  FROM blocked;
UPDATE users SET username = regexp_replace(username, '^[[:space:]]+|[[:space:]]+$', '', 'g')
 WHERE username ~ '^[[:space:]]|[[:space:]]$';
CREATE UNIQUE INDEX IF NOT EXISTS users_org_username_ci_uniq ON users(organization_id, lower(username));
-- The same rule for the approval queue: one PENDING request per normalised
-- name (the newest wins, as above), stored trimmed.
UPDATE pending_registrations p SET status = 'rejected'
  WHERE p.status = 'pending'
    AND EXISTS (
      SELECT 1 FROM pending_registrations q
       WHERE q.organization_id = p.organization_id
         AND lower(btrim(q.username)) = lower(btrim(p.username))
         AND q.status = 'pending'
         AND q.id > p.id
    );
UPDATE pending_registrations SET username = btrim(username)
 WHERE status = 'pending' AND username <> btrim(username);
CREATE UNIQUE INDEX IF NOT EXISTS pending_registrations_org_username_ci_pending_uniq
  ON pending_registrations(organization_id, lower(username)) WHERE status = 'pending';

-- Requests naming an unknown org code or the platform org: dropped, but
-- answered like a real org's (201, then 409 on a re-submission) so POST
-- /api/register is not an org-code oracle. Only an opaque SHA-256 key of
-- (upper(org code), username) is stored — no code, name or credential.
CREATE TABLE IF NOT EXISTS unrouted_registrations (
  id SERIAL PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS landing_page_settings (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  hero_title TEXT NOT NULL DEFAULT 'DocTurn',
  hero_subtitle TEXT NOT NULL DEFAULT '',
  body JSONB,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact_page_settings (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  body JSONB,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  bed_capacity INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS beds (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  department_id INTEGER REFERENCES departments(id),
  label TEXT NOT NULL,
  occupied BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS equipment (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
);

CREATE TABLE IF NOT EXISTS emergency_broadcasts (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'urgent',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- A.CON comms-account #10: who a broadcast was addressed to (NULL = everyone)
-- and the recipient set frozen at send time.
ALTER TABLE emergency_broadcasts ADD COLUMN IF NOT EXISTS audience JSONB;
ALTER TABLE emergency_broadcasts ADD COLUMN IF NOT EXISTS recipient_ids JSONB;

CREATE TABLE IF NOT EXISTS broadcast_acknowledgments (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  broadcast_id INTEGER NOT NULL REFERENCES emergency_broadcasts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  acknowledged_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'ios',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS device_tokens_token_uniq ON device_tokens(token);

CREATE TABLE IF NOT EXISTS sms_history (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  user_id INTEGER REFERENCES users(id),
  to_phone TEXT NOT NULL,
  body TEXT NOT NULL,
  carrier TEXT NOT NULL DEFAULT 'console',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Continuous compliance monitor: an org's attestation for ONE manual control.
-- Automated controls are recomputed from live state on every read and are never
-- persisted here (a stored "pass" could go stale and mislead an auditor).
CREATE TABLE IF NOT EXISTS compliance_attestations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  control_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_met',
  owner TEXT,
  note TEXT,
  evidence_url TEXT,
  attested_at TIMESTAMP,
  review_due TIMESTAMP,
  updated_by INTEGER REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS compliance_attestations_org_control_uniq ON compliance_attestations(organization_id, control_id);

-- PerfectServe-parity tables (docs/PERFECTSERVE_PARITY_BLUEPRINT.md). Every
-- one is per-org + per-user and cascaded by the tenant delete. Mirrors
-- shared/schema.ts.
-- Directory favorites: a person (target_id = user id as text) or an on-call
-- role (target_id = the role key). No FK on target_id (a role is not a row).
CREATE TABLE IF NOT EXISTS directory_favorites (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS directory_favorites_uniq
  ON directory_favorites(organization_id, user_id, target_kind, target_id);

-- Per-user Done state: done while the thread's newest live message id is
-- <= through_message_id (NULL: it had none when marked).
CREATE TABLE IF NOT EXISTS conversation_done (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  done_at TIMESTAMP NOT NULL DEFAULT NOW(),
  through_message_id INTEGER
);
ALTER TABLE conversation_done ADD COLUMN IF NOT EXISTS through_message_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS conversation_done_user_convo_uniq
  ON conversation_done(user_id, conversation_id);

-- Unread-message reminder opt-in (off by default) + the sweep's last send.
CREATE TABLE IF NOT EXISTS user_reminder_prefs (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  interval_min INTEGER NOT NULL DEFAULT 10,
  last_reminded_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_reminder_prefs_user_uniq ON user_reminder_prefs(user_id);

-- In-app alert sound per priority (NULL = built-in default tone).
CREATE TABLE IF NOT EXISTS user_sound_prefs (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  stat_sound TEXT,
  urgent_sound TEXT,
  routine_sound TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_sound_prefs_user_uniq ON user_sound_prefs(user_id);

-- PIN unlock: scrypt hash + per-session failure state (failed_session is a
-- hash of the session id, never the id).
CREATE TABLE IF NOT EXISTS user_pins (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  pin_hash TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_pins_user_uniq ON user_pins(user_id);
-- Wrong-PIN counter per (user, session hash) — see shared/schema.ts.
CREATE TABLE IF NOT EXISTS pin_unlock_failures (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  session_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  disabled_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS pin_unlock_failures_session_uniq ON pin_unlock_failures(user_id, session_hash);

-- Enterprise readiness (docs/ENTERPRISE_READINESS.md). Mirrors shared/schema.ts.
-- updated_by / created_by carry no FK on purpose (never block a delete).

-- Background-job leases: one row per job; a tick runs only after
-- UPDATE … WHERE lease_until <= NOW() claims the row (E1 multi-instance).
CREATE TABLE IF NOT EXISTS job_leases (
  name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  lease_until TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Per-org OIDC SSO connection: secrets as one AES-256-GCM ciphertext under
-- INTEGRATION_KEY; issuer / client_id / role_mapping are non-secret.
CREATE TABLE IF NOT EXISTS sso_connections (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  role_mapping JSONB,
  sso_required BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS sso_connections_org_uniq ON sso_connections(organization_id);

-- Per-org SCIM bearer tokens (SHA-256 of the token only; revoked rows stay).
CREATE TABLE IF NOT EXISTS scim_tokens (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  token_hash TEXT NOT NULL,
  label TEXT NOT NULL,
  created_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMP,
  revoked_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS scim_tokens_hash_uniq ON scim_tokens(token_hash);
CREATE INDEX IF NOT EXISTS scim_tokens_org_idx ON scim_tokens(organization_id);

-- Live cookie sessions of one user (E2 session policy): a SHA-256 of the
-- session id only. Drives max-concurrent eviction and the absolute lifetime.
CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  sid_hash TEXT NOT NULL,
  issued_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMP,
  revoked_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_sid_uniq ON user_sessions(sid_hash);
CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions(user_id);

-- Per-org session policy (NULL = platform default).
CREATE TABLE IF NOT EXISTS org_session_policy (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  idle_minutes INTEGER,
  max_concurrent INTEGER,
  absolute_hours INTEGER,
  updated_by INTEGER,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS org_session_policy_org_uniq ON org_session_policy(organization_id);

-- Per-user display preset over the org's branding (module platform.userThemes).
CREATE TABLE IF NOT EXISTS user_theme_prefs (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  preset TEXT,
  text_size TEXT,
  follow_device BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_theme_prefs_user_uniq ON user_theme_prefs(user_id);

-- Billing (docs/BILLING.md) — one day's billable-seat count per organization.
-- snapshot_date is the calendar day in the ORG's own timezone; an invoice line
-- cites these dates. No PHI: a count and a role breakdown.
CREATE TABLE IF NOT EXISTS seat_snapshots (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  snapshot_date TEXT NOT NULL,
  seat_count INTEGER NOT NULL,
  breakdown JSONB NOT NULL,
  timezone TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS seat_snapshots_org_date_uniq ON seat_snapshots(organization_id, snapshot_date);
CREATE INDEX IF NOT EXISTS seat_snapshots_org_idx ON seat_snapshots(organization_id);

-- A plan the operator sells: the module ids it GRANTS and a per-seat price in
-- integer cents. Nothing is seeded.
CREATE TABLE IF NOT EXISTS billing_plans (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  module_ids JSONB NOT NULL,
  per_seat_price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_plans_code_uniq ON billing_plans(code);
ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS show_on_website BOOLEAN NOT NULL DEFAULT FALSE;

-- Order requests from the public website (/home). Business contacts only.
CREATE TABLE IF NOT EXISTS purchase_requests (
  id SERIAL PRIMARY KEY,
  organization_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_title TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  plan_code TEXT,
  seats INTEGER NOT NULL,
  term TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  source_ip TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ONE contract per hospital — the operator's own record of what was agreed.
-- Stripe is only the collection rail; this row is the source of truth.
CREATE TABLE IF NOT EXISTS org_contracts (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  plan_id INTEGER NOT NULL REFERENCES billing_plans(id),
  term TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  committed_seats INTEGER NOT NULL,
  price_override_cents INTEGER,
  po_number TEXT,
  billing_contact_name TEXT,
  billing_contact_email TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  past_due_at TIMESTAMP,
  stripe_customer_id TEXT,
  stripe_send_invoice_email BOOLEAN NOT NULL DEFAULT FALSE,
  days_until_due INTEGER NOT NULL DEFAULT 30,
  created_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS org_contracts_org_uniq ON org_contracts(organization_id);

-- One invoice. Generated from the contract and the seat snapshots; each line
-- CITES the snapshot dates it counted (lines[].citedDates). The number is
-- gap-free and never reused — allocated from billing_counters inside the SAME
-- transaction as this row. "Paid" has exactly two sources, both recorded:
-- paid_source='operator' (with the operator's user id) or 'stripe' (with the
-- Stripe event id in paid_reference).
CREATE TABLE IF NOT EXISTS billing_invoices (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  contract_id INTEGER,
  number TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  currency TEXT NOT NULL,
  lines JSONB NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  issued_at TIMESTAMP,
  due_on TEXT,
  paid_at TIMESTAMP,
  paid_source TEXT,
  paid_by_user_id INTEGER,
  paid_reference TEXT,
  stripe_invoice_id TEXT,
  void_reason TEXT,
  created_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_number_uniq ON billing_invoices(number);
CREATE INDEX IF NOT EXISTS billing_invoices_org_idx ON billing_invoices(organization_id);

-- Monotonic counters. One row, 'invoice', bumped inside the invoice
-- transaction so numbers are gap-free and never reused.
CREATE TABLE IF NOT EXISTS billing_counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

-- Invoices of a DELETED tenant. The seat history leaves with the tenant; a
-- financial record of the operator's own business does not, so each invoice is
-- copied here (no foreign keys, denormalized) inside the delete transaction
-- and only then removed — the retained_compliance_records pattern.
CREATE TABLE IF NOT EXISTS retained_invoices (
  id SERIAL PRIMARY KEY,
  source_id INTEGER NOT NULL,
  organization_id INTEGER,
  organization_code TEXT,
  organization_name TEXT,
  number TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  currency TEXT NOT NULL,
  lines JSONB NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  issued_at TIMESTAMP,
  due_on TEXT,
  paid_at TIMESTAMP,
  paid_source TEXT,
  paid_by_user_id INTEGER,
  paid_reference TEXT,
  stripe_invoice_id TEXT,
  archived_at TIMESTAMP NOT NULL DEFAULT NOW(),
  archived_reason TEXT NOT NULL DEFAULT 'organization_deleted'
);
CREATE INDEX IF NOT EXISTS retained_invoices_org_idx ON retained_invoices(organization_id);

-- Every billing status transition, and every Stripe delivery. The unique index
-- on stripe_event_id is the whole idempotency mechanism: a Stripe delivery is
-- recorded here BEFORE it is applied, so a redelivery of the same event is
-- recognised and answered 200 without being applied twice. It is a PLAIN
-- unique index (Postgres treats NULLs as distinct), so our own transitions,
-- which carry no Stripe event id, never collide with each other — and
-- ON CONFLICT (stripe_event_id) can infer it, which a partial index would
-- not allow.
CREATE TABLE IF NOT EXISTS billing_events (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER,
  invoice_id INTEGER,
  stripe_event_id TEXT,
  type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_user_id INTEGER,
  detail JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_events_stripe_event_uniq
  ON billing_events(stripe_event_id);
CREATE INDEX IF NOT EXISTS billing_events_org_idx ON billing_events(organization_id);
CREATE INDEX IF NOT EXISTS billing_events_invoice_idx ON billing_events(invoice_id);

-- Shared rate-limit counters for the Postgres-backed limiter store.
CREATE TABLE IF NOT EXISTS rate_limit_hits (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMP NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
`;
