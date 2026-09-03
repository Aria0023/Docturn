import { createServer } from "node:http";
import type { RequestHandler } from "express";
import { createApp } from "./app.js";
import { initDbWithRecovery } from "./db.js";
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

const PORT = Number(process.env.PORT ?? 3000);

// Safety net: a single bad request must never take the whole server down.
// Log and keep serving rather than letting an unhandled async rejection crash.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
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

  // Trust one proxy hop by default. In production this is the load balancer;
  // in dev it's whatever tunnel (cloudflared/ngrok/localtunnel) you use to reach
  // the app from a phone. Without it, the tunnel's X-Forwarded-For header makes
  // express-rate-limit throw on every request (and can 500 /api/login). Set
  // TRUST_PROXY=0 to opt out for a strictly local-only run.
  const app = createApp({ trustProxy: process.env.TRUST_PROXY !== "0" });

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

  server.listen(PORT, () => {
    const mode = handle.ephemeral ? "PGlite (in-process)" : "PostgreSQL";
    console.log(
      `DocTurn API + WebSocket listening on :${PORT} — db: ${mode}`,
    );
    if (handle.ephemeral) {
      // The boot path already seeds this database, so do NOT tell the operator
      // to run `npm run seed` — a second process on the same PGlite directory
      // corrupts it. Seeding manually is only for a server that is stopped.
      console.log(
        "  ↳ no DATABASE_URL set; using an ephemeral in-process database (seeded automatically; data resets on restart).",
      );
    }
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
