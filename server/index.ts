import { createServer } from "node:http";
import type { RequestHandler } from "express";
import { createApp } from "./app.js";
import { initDbWithRecovery } from "./db.js";
import { DatabaseStorage, setStorage } from "./storage.js";
import { ensurePlatform, seed } from "./seed.js";
import { startExpiryLoop } from "./services/expiry.js";
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
    const existing = await storage.getOrganizationByCode("MERCY");
    if (!existing) {
      await seed(storage);
      console.log("[db] empty database — seeded demo data (org MERCY + platform).");
    } else {
      await ensurePlatform(storage);
    }
  } catch (e) {
    console.error("[db] seed/ensure failed:", e);
  }

  const app = createApp({ trustProxy: process.env.NODE_ENV === "production" });

  const server = createServer(app);
  attachWebSocket(
    server,
    app.locals.sessionMiddleware as RequestHandler,
  );

  startExpiryLoop();

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
