import { createServer } from "node:http";
import type { RequestHandler } from "express";
import { createApp } from "./app.js";
import { initDbWithRecovery } from "./db.js";
import { DatabaseStorage, setStorage } from "./storage.js";
import { ensureDemoTenants, ensurePlatform, seed } from "./seed.js";
import { startExpiryLoop, startAutoCleanLoop } from "./services/expiry.js";
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
  if (recovered) {
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
  try {
    const storage = new DatabaseStorage(handle.db);
    setStorage(storage);
    const existing = await storage.getOrganizationByCode("ISPN");
    if (!existing) {
      await seed(storage);
      console.log("[db] empty database — seeded demo data (org ISPN + platform).");
    } else {
      await ensurePlatform(storage);
    }
    // Idempotently provision the two isolated demo tenants (HOSP + ER).
    await ensureDemoTenants(storage);
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

  server.listen(PORT, () => {
    const mode = handle.ephemeral ? "PGlite (in-process)" : "PostgreSQL";
    console.log(
      `DocTurn API + WebSocket listening on :${PORT} — db: ${mode}`,
    );
    if (handle.ephemeral) {
      console.log(
        "  ↳ no DATABASE_URL set; using an ephemeral in-process database. Run `npm run seed` to populate it (dev only).",
      );
    }
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
