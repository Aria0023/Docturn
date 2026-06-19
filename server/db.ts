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

export interface DbHandle {
  db: DbType;
  /** Whether we are running on in-process PGlite (true) or a real Postgres pool. */
  ephemeral: boolean;
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

export interface CreateDbOptions {
  databaseUrl?: string;
  /** PGlite data directory. Omit for an in-memory database (tests). */
  pgliteDir?: string;
}

export function createDb(opts: CreateDbOptions = {}): DbHandle {
  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL;
  if (databaseUrl) {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    const db = drizzlePg(pool, { schema }) as unknown as DbType;
    return {
      db,
      ephemeral: false,
      ensureSchema: async () => {
        // Real Postgres schema is managed by `npm run db:push` (drizzle-kit).
      },
      close: async () => {
        await pool.end();
      },
    };
  }

  // PGlite: persistent dir for the app (so `seed` and `dev` share state),
  // in-memory for tests (isolation).
  const client = opts.pgliteDir ? new PGlite(opts.pgliteDir) : new PGlite();
  const db = drizzlePglite(client, { schema }) as unknown as DbType;
  return {
    db,
    ephemeral: true,
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
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_org_username_uniq ON users(organization_id, username);

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

CREATE TABLE IF NOT EXISTS patients (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  initials TEXT NOT NULL,
  room_number TEXT,
  issue_summary TEXT NOT NULL DEFAULT '',
  specialty TEXT,
  department TEXT,
  status TEXT NOT NULL DEFAULT 'waiting',
  er_doctor_id INTEGER REFERENCES users(id),
  assigned_hospitalist_id INTEGER REFERENCES hospitalists(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL DEFAULT 'direct',
  name TEXT,
  participant_ids JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS message_delivery_status (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  delivered_at TIMESTAMP,
  read_at TIMESTAMP
);

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
  method TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

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
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

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
  status TEXT NOT NULL DEFAULT 'requested',
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
`;
