import session from "express-session";
import createMemoryStore from "memorystore";
import connectPgSimple from "connect-pg-simple";
import type pg from "pg";
import { setSessionStoreState, type SessionStoreKind } from "./config.js";

/**
 * Session store selection — ONE decision, recorded for the compliance monitor.
 *
 *  - DATABASE_URL set (real Postgres): `connect-pg-simple` on the SAME pg.Pool
 *    the app queries through, table `session` (created on first use if it is
 *    missing). Sessions survive a restart/deploy and are shared by every
 *    instance behind the load balancer. The WebSocket upgrade authenticates
 *    through `app.locals.sessionMiddleware`, so it inherits this store too.
 *  - otherwise (PGlite dev/trial store): in-memory `memorystore`. A restart
 *    logs everyone out, and two processes cannot share sessions — that is the
 *    truth, and `getSessionStoreState()` says so.
 */
export interface SessionStoreSelection {
  store: session.Store;
  kind: SessionStoreKind;
  /** Human-readable, non-secret explanation of why this store was chosen. */
  reason: string;
}

export interface CreateSessionStoreOptions {
  /** The connection string that selects Postgres. Never logged. */
  databaseUrl?: string;
  /** The app's pg.Pool (from server/db.ts DbHandle.pool). */
  pool?: pg.Pool;
  /** Seconds between prune sweeps of expired rows; `false` disables (tests). */
  pruneSessionInterval?: number | false;
}

export function createSessionStore(opts: CreateSessionStoreOptions): SessionStoreSelection {
  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL;
  let selection: SessionStoreSelection;
  if (databaseUrl) {
    const PGStore = connectPgSimple(session);
    const store = new PGStore({
      // Prefer the pool the app already holds so there is exactly one set of
      // connections; fall back to a dedicated connection only if no pool was
      // handed in (never expected in the server boot path).
      ...(opts.pool ? { pool: opts.pool } : { conString: databaseUrl }),
      tableName: "session",
      createTableIfMissing: true,
      ...(opts.pruneSessionInterval !== undefined
        ? { pruneSessionInterval: opts.pruneSessionInterval }
        : {}),
    });
    selection = {
      store,
      kind: "postgres",
      reason: opts.pool
        ? "DATABASE_URL is set; sessions are rows in the Postgres `session` table (connect-pg-simple) on the application's connection pool"
        : "DATABASE_URL is set; sessions are rows in the Postgres `session` table (connect-pg-simple) on a dedicated connection",
    };
  } else {
    const MemoryStore = createMemoryStore(session);
    selection = {
      store: new MemoryStore({ checkPeriod: 86_400_000 }),
      kind: "memory",
      reason:
        "no DATABASE_URL (PGlite store); sessions live in this process's memory — a restart signs every user out and instances cannot share sessions",
    };
  }
  setSessionStoreState({ kind: selection.kind, reason: selection.reason });
  return selection;
}
