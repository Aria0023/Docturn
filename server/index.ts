import { createServer } from "node:http";
import type { RequestHandler } from "express";
import { createApp } from "./app.js";
import { getSessionStoreState, resolveTrustProxy } from "./config.js";
import { initDbWithRecovery, type DbHandle } from "./db.js";
import { DatabaseStorage, setStorage } from "./storage.js";
import {
  ensureDemoTenants,
  ensurePlatform,
  isSyntheticDataMode,
  seed,
} from "./seed.js";
import { startExpiryLoop, startAutoCleanLoop } from "./services/expiry.js";
import { startAmionSyncLoop } from "./services/amion.js";
import { startStatEscalationLoop } from "./services/escalation.js";
import { startRetentionLoop } from "./services/retention.js";
import { initWebPush, LivePushTransport } from "./services/push.js";
import { configureNotifications } from "./services/notifications.js";
import { attachWebSocket } from "./ws/index.js";
import { installLogScrubber, loggableError } from "./log-safe.js";

// PHI-safe logs for the whole process: every Error handed to console.* — by a
// route's own catch block, a background sweep, a library — is rebuilt from an
// allow-list first (no bound query params, no Postgres detail, no quoted
// values, no request body). See server/log-safe.ts.
installLogScrubber();

const PORT = Number(process.env.PORT ?? 3000);

/**
 * Bind address. The documented production topology (deploy/aws) terminates
 * TLS in Caddy on the SAME host and proxies to 127.0.0.1:3000, so in
 * production the default is loopback: the Node port is then unreachable from
 * the network, and only the trusted proxy can originate requests (which is
 * also what makes X-Forwarded-For trustworthy — see resolveTrustProxy). Set
 * HOST=0.0.0.0 explicitly for a PaaS/container that reaches the process over
 * the network. Outside production the default stays 0.0.0.0 so a phone on the
 * LAN or a dev tunnel can reach a trial instance.
 */
const HOST =
  process.env.HOST?.trim() ||
  (process.env.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0");

// Safety net: a single bad request must never take the whole server down.
// Log and keep serving rather than letting an unhandled async rejection crash.
// (Route handlers no longer reach this path — server/async-errors.ts forwards
// their rejections to the JSON error middleware — so anything logged here is a
// background task, not a request.)
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", loggableError(reason));
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", loggableError(err));
});

async function main() {
  // PGlite (no DATABASE_URL) bootstraps its schema in-process so the app boots
  // with zero secrets. Real Postgres is provisioned via `npm run db:push`.
  // initDbWithRecovery self-heals a corrupted on-disk PGlite store (e.g. after a
  // hard kill) so the server always boots instead of dying on init.
  const { handle, recovered } = await initDbWithRecovery();
  // Shared demo credentials exist ONLY on a synthetic-data instance. When the
  // operator has deliberately switched to real PHI (SYNTHETIC_DATA=false) we
  // seed nothing: no demo clinical roster, no demo tenants.
  const synthetic = isSyntheticDataMode();
  if (!synthetic) {
    console.warn(
      "[db] SYNTHETIC_DATA=false (real-PHI mode) — demo seeding is disabled. " +
        "No demo clinical accounts or demo tenants will be created; provision real accounts instead.",
    );
  }
  if (recovered && synthetic) {
    // The corrupt store was recreated empty — restore the demo data so logins
    // work again without a manual `npm run seed`.
    const storage = new DatabaseStorage(handle.db);
    setStorage(storage);
    try {
      await seed(storage);
      console.log("[db] recovered from a corrupted database and reseeded demo data.");
    } catch (e) {
      console.error("[db] recovery reseed failed (run `npm run seed`):", e);
    }
  }

  // Make the demo usable out of the box — including a brand-new cloud deploy
  // with an empty database: seed the demo org + accounts if they're missing,
  // otherwise just ensure the platform org/developer exist. Idempotent.
  // ensurePlatform() self-gates the cross-tenant root account behind
  // PLATFORM_ADMIN_PASSWORD on production / real-PHI instances.
  try {
    const storage = new DatabaseStorage(handle.db);
    setStorage(storage);
    if (!synthetic) {
      await ensurePlatform(storage);
    } else {
      const existing = await storage.getOrganizationByCode("ISPN");
      if (!existing) {
        await seed(storage);
        console.log("[db] empty database — seeded demo data (org ISPN + platform).");
      } else {
        await ensurePlatform(storage);
      }
      // Idempotently provision the two isolated demo tenants (HOSP + ER).
      await ensureDemoTenants(storage);
    }
  } catch (e) {
    console.error("[db] seed/ensure failed:", e);
  }

  // Which peers' X-Forwarded-* headers to believe. Default: a reverse proxy on
  // THIS host (loopback) — Caddy in production, cloudflared/ngrok in dev. A hop
  // count would let any direct client forge its address (and so its rate-limit
  // bucket); an address list does not. TRUST_PROXY=0 opts out for a strictly
  // local-only run; TRUST_PROXY=<ips/CIDRs/keywords> names a remote proxy.
  const trust = resolveTrustProxy(process.env.TRUST_PROXY);
  if (trust.spoofable) {
    console.warn(
      `[security] TRUST_PROXY=${process.env.TRUST_PROXY}: ${trust.description}. ` +
        "Use TRUST_PROXY=loopback (same-host proxy) or a comma-separated list of proxy IPs/CIDRs.",
    );
  }
  const app = createApp({ trustProxy: trust.value });

  const server = createServer(app);
  attachWebSocket(
    server,
    app.locals.sessionMiddleware as RequestHandler,
  );

  startExpiryLoop();
  // Auto-clean: hourly sweep purges patients/assignments older than 24h so stale
  // board and log data clears itself. Manual "Clear" controls call the same path.
  startAutoCleanLoop();
  // Amion schedule sync: if AMION_OCS_URL is set, pull the live on-call grid
  // shortly after boot (non-blocking, errors logged + recorded) and then on the
  // AMION_SYNC_INTERVAL_MIN cadence. No-op when the env var is absent.
  startAmionSyncLoop();
  // STAT non-response loop: unacked STAT → re-alert (2 min) → covering-provider
  // escalation (5 min). Tunable via STAT_REALERT_MS / STAT_ESCALATE_MS.
  startStatEscalationLoop();
  // Per-org message retention purge (org setting messageRetentionDays; hourly).
  startRetentionLoop();
  // Real push: web-push (VAPID; generated + persisted on first boot) for the
  // PWA/browsers, Expo push for the native app. Content-free payloads only.
  const vapidKey = await initWebPush();
  configureNotifications({ push: new LivePushTransport() });
  if (vapidKey) console.log("[push] web push ready (VAPID configured)");

  server.listen(PORT, HOST, () => {
    console.log(
      `DocTurn API + WebSocket listening on ${HOST}:${PORT} — db: ${describeDb(handle)}`,
    );
    for (const line of dbBootNotes(handle)) console.log("  ↳ " + line);
    console.log(
      `  ↳ sessions: ${getSessionStoreState().kind === "postgres" ? "Postgres `session` table (survive restarts, shared across instances)" : "in-memory (a restart signs everyone out; single instance only)"}`,
    );
    console.log(`  ↳ proxy trust: ${trust.description}${trust.source === "default" ? " (default)" : ""}`);
    if (HOST === "127.0.0.1" || HOST === "::1" || HOST === "localhost") {
      console.log(
        "  ↳ bound to loopback: reachable only through the reverse proxy on this host (set HOST=0.0.0.0 to accept network connections directly).",
      );
    }
  });
}

/** One truthful phrase per store kind for the boot banner. */
function describeDb(h: DbHandle): string {
  switch (h.storage) {
    case "postgres":
      return "PostgreSQL (DATABASE_URL)";
    case "pglite-disk":
      return `PGlite on disk (${h.dataDir})`;
    case "pglite-memory":
      return "PGlite in memory";
  }
}

/**
 * The boot path already seeds the PGlite database, so these notes never tell
 * the operator to run `npm run seed` — a second process on the same PGlite
 * directory corrupts it. Seeding manually is only for a server that is stopped.
 */
function dbBootNotes(h: DbHandle): string[] {
  switch (h.storage) {
    case "postgres":
      return [];
    case "pglite-disk":
      return [
        `no DATABASE_URL set; using the on-disk PGlite store at ${h.dataDir} — a single-process dev/trial database.`,
        "data PERSISTS across restarts (delete the directory to reset); the files are NOT encrypted at rest. Not for production or real PHI.",
      ];
    case "pglite-memory":
      return [
        "no DATABASE_URL and no PGLITE_DIR; using an in-memory PGlite database — data resets on restart.",
      ];
  }
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
