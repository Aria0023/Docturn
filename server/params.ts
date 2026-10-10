import type { Express, Request } from "express";

/**
 * Numeric route parameters, validated in ONE place.
 *
 * Every `:id`-style parameter in this API is a positive Postgres `integer`
 * primary key. Route handlers used to do `Number(req.params.id)` and pass the
 * result straight to the database, so `/api/patients/abc/consults` turned into
 * `WHERE id = NaN`, PGlite threw inside an async handler, and the request hung
 * (see server/async-errors.ts for the hang itself). Registering an `app.param`
 * guard for each numeric parameter name means a malformed id is answered with
 * the same `404 {error:"not_found"}` a well-formed-but-missing id gets — no
 * handler has to remember to validate, and new routes that reuse these names
 * are covered automatically.
 *
 * Only the parameter NAMES listed here are treated as numeric; string params
 * (`:code`, `:key`, `:token`, `:controlId`) are untouched.
 */
export const NUMERIC_PARAMS = [
  "id",
  "attId",
  "memberUserId",
  "orgId",
  "userId",
] as const;

/**
 * Routes whose `:id` is NOT an integer key and must bypass the guard. Manual
 * on-call slots are JSON documents inside org_settings addressed by a
 * generated string id (server/routes/oncall.ts, `String(req.params.id)`); the
 * route reuses the `:id` name. Listed explicitly so the exemption is visible
 * in one place — the right long-term fix is renaming that parameter to
 * `:slotId` in the on-call route file.
 */
export const STRING_ID_PATHS: readonly RegExp[] = [/^\/api\/oncall\/manual\/[^/]+$/];

/** Largest value a Postgres `integer` column (SERIAL) can hold. */
const PG_INT_MAX = 2_147_483_647;

/**
 * Parse a positive integer id. Returns null for anything that is not a plain
 * decimal integer in `1..2147483647` — so "abc", "", "1.5", "-3", "0", "1e3",
 * " 7" and values that would overflow `integer` are all rejected.
 */
export function parseId(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isInteger(v) && v > 0 && v <= PG_INT_MAX ? v : null;
  }
  if (typeof v !== "string" || !/^[1-9][0-9]{0,9}$/.test(v)) return null;
  const n = Number(v);
  return n <= PG_INT_MAX ? n : null;
}

/** Read an already-validated numeric param (the guard ran first). */
export function idParam(req: Request, name: (typeof NUMERIC_PARAMS)[number] = "id"): number {
  return Number(req.params[name]);
}

/**
 * Mount the guard. Must run BEFORE the routes are registered so Express has
 * the param callback when it compiles each route.
 */
export function registerNumericParams(app: Express): void {
  for (const name of NUMERIC_PARAMS) {
    app.param(name, (req, res, next, value: unknown) => {
      if (name === "id" && STRING_ID_PATHS.some((re) => re.test(req.path))) return next();
      if (parseId(value) === null) {
        return res.status(404).json({ error: "not_found" });
      }
      next();
    });
  }
}
