import { defineConfig } from "drizzle-kit";

// DocTurn uses Drizzle Kit's `push` workflow (no hand-written SQL migrations).
// When DATABASE_URL is set we push to that Postgres; otherwise the app/tests run
// against an in-process PGlite database (see server/db.ts) and `db:push` is a no-op
// path you should only run with a real DATABASE_URL.
export default defineConfig({
  schema: "./shared/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/docturn",
  },
  strict: true,
  verbose: true,
});
