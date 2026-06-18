import { createApp } from "./app.js";
import { getHandle } from "./db.js";
import { startExpiryLoop } from "./services/expiry.js";

const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  const handle = getHandle();
  // PGlite (no DATABASE_URL) bootstraps its schema in-process so the app boots
  // with zero secrets. Real Postgres is provisioned via `npm run db:push`.
  await handle.ensureSchema();

  const app = createApp({ trustProxy: process.env.NODE_ENV === "production" });

  startExpiryLoop();

  app.listen(PORT, () => {
    const mode = handle.ephemeral ? "PGlite (in-process)" : "PostgreSQL";
    console.log(`DocTurn API listening on :${PORT} — db: ${mode}`);
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
