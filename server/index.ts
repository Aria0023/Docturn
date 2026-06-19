import { createServer } from "node:http";
import type { RequestHandler } from "express";
import { createApp } from "./app.js";
import { getHandle } from "./db.js";
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
  const handle = getHandle();
  // PGlite (no DATABASE_URL) bootstraps its schema in-process so the app boots
  // with zero secrets. Real Postgres is provisioned via `npm run db:push`.
  await handle.ensureSchema();

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
