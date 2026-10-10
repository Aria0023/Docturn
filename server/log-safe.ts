/**
 * PHI-safe error logging (runbook §13: "logs are PHI-free").
 *
 * An error object is not safe to hand to console.* as-is:
 *
 *  - Drizzle's DrizzleQueryError message is `Failed query: <sql>\nparams: <every
 *    bound value>` and it keeps `params` as a property — an insert that fails
 *    logs the patient's issue summary, MRN, message text … verbatim. Its stack
 *    starts with the same message.
 *  - A Postgres error (pg / PGlite DatabaseError) quotes values in its message
 *    (`invalid input syntax for type integer: "<value>"`) and in `detail`
 *    (`Key (ehr_id)=(<MRN>) already exists.`), `where` and `hint`.
 *  - body-parser attaches the raw request body as `err.body`.
 *  - util.inspect prints every own property and follows the `cause` chain.
 *
 * loggableError() rebuilds an error from an ALLOW-list instead: name, a
 * scrubbed message, the stack FRAMES (never the message lines of the original
 * stack), SQLSTATE code / condition name, schema/table/column/constraint
 * names, the parameterised SQL with any inline string literal redacted and the
 * NUMBER of params — and recurses into `cause` the same way. Anything else an
 * error carries (params, detail, where, hint, internalQuery, body, …) is
 * dropped. A non-database error keeps its message (written in code — it is
 * what makes a TypeError debuggable) with everything between its first and
 * last double quote redacted, which is where JSON.parse and Postgres put input
 * excerpts. A thrown non-Error value (a bare string, …) is logged as its type
 * only.
 *
 * installLogScrubber() applies the same rebuild to every Error passed to
 * console.error/warn/log/info/debug anywhere in the process, so a route's own
 * `catch (err) { console.error("[x] failed", err) }` or a background sweep is
 * covered without each call site having to remember. The JSON error
 * middleware (server/app.ts) calls loggableError() explicitly as well.
 */

const MAX_DEPTH = 4;
const MAX_MESSAGE = 500;
const MAX_QUERY = 400;
const MAX_FRAMES = 25;
/**
 * A V8 stack frame line: "    at fn (file:line:col)", "    at file:line:col",
 * "    at new Promise (<anonymous>)", "    at async Promise.all (index 0)".
 * Requiring the location suffix means a message line that merely starts with
 * "    at " (a value containing "\n    at …") is never mistaken for a frame.
 */
const FRAME = /^\s+at\s.*(?::\d+:\d+\)?|\((?:native|<anonymous>|index \d+)\))$/;

/** Common SQLSTATEs → condition names, so a log line reads without a lookup. */
const PG_CONDITIONS: Record<string, string> = {
  "22001": "string_data_right_truncation",
  "22003": "numeric_value_out_of_range",
  "22007": "invalid_datetime_format",
  "22008": "datetime_field_overflow",
  "22021": "character_not_in_repertoire",
  "22P02": "invalid_text_representation",
  "22P05": "untranslatable_character",
  "23502": "not_null_violation",
  "23503": "foreign_key_violation",
  "23505": "unique_violation",
  "23514": "check_violation",
  "25P02": "in_failed_sql_transaction",
  "40001": "serialization_failure",
  "40P01": "deadlock_detected",
  "42601": "syntax_error",
  "42703": "undefined_column",
  "42P01": "undefined_table",
  "53300": "too_many_connections",
  "57014": "query_canceled",
  "57P01": "admin_shutdown",
};

/** Postgres error fields that name schema objects — never row values. */
const PG_SAFE_FIELDS = ["severity", "schema", "table", "column", "dataType", "constraint", "routine"] as const;

/** Extra properties of a non-database error that are safe and useful. */
const GENERIC_SAFE_FIELDS = ["code", "errno", "syscall", "type", "status", "statusCode"] as const;

/** Marks an error that loggableError() already rebuilt (idempotence). */
const REBUILT = Symbol.for("docturn.loggableError");

/**
 * One Error subclass per logged name, so util.inspect prints the familiar
 * "TypeError: …" header (it brackets the name when the constructor's name
 * differs). Names come from code; anything odd collapses to "Error".
 */
const CLASSES = new Map<string, new (message: string) => Error>();
function safeName(name: string): string {
  return /^[A-Za-z_$][\w$.-]{0,80}$/.test(name) ? name : "Error";
}
function classFor(safe: string): new (message: string) => Error {
  let C = CLASSES.get(safe);
  if (!C) {
    C = { [safe]: class extends Error {} }[safe]!;
    if (CLASSES.size < 100) CLASSES.set(safe, C);
  }
  return C;
}

type ErrorLike = Record<string, unknown> & { message?: unknown; stack?: unknown; name?: unknown };

function isObject(v: unknown): v is ErrorLike {
  return !!v && typeof v === "object";
}

/** A pg / PGlite DatabaseError: a 5-character SQLSTATE plus a severity. */
export function isPgError(v: unknown): v is ErrorLike & { code: string } {
  return isObject(v) && typeof v.code === "string" && /^[0-9A-Z]{5}$/.test(v.code) && typeof v.severity === "string";
}

/** Drizzle's DrizzleQueryError (its `name` is plain "Error", so match the shape). */
function isDrizzleQueryError(v: unknown): v is ErrorLike & { query: string; params: unknown } {
  return isObject(v) && typeof v.query === "string" && "params" in v;
}

/** The first SQLSTATE found on the error or its `cause` chain. */
export function pgErrorCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i <= MAX_DEPTH && isObject(cur); i++) {
    if (isPgError(cur)) return cur.code;
    cur = cur.cause;
  }
  return undefined;
}

/**
 * Redact what may be request data from a free-text error message: everything
 * after a Drizzle "Failed query:" / "params:" marker, and the span between the
 * first and last double quote (Postgres and JSON.parse quote the offending
 * input that way). Bounded.
 */
export function scrubMessage(msg: string): string {
  let m = msg;
  const fq = m.indexOf("Failed query:");
  if (fq >= 0) m = `${m.slice(0, fq)}Failed query (SQL and params omitted from the log)`;
  const pm = m.search(/(^|\n)params:/);
  if (pm >= 0) m = `${m.slice(0, pm)} [params omitted from the log]`;
  // Everything from the FIRST to the LAST double quote goes: a quoted value
  // may itself contain quotes or newlines, so pairing quotes would let part of
  // it through. (Identifiers in between — a table or constraint name — are
  // logged separately from their own fields.)
  const first = m.indexOf('"');
  if (first >= 0) {
    const last = m.lastIndexOf('"');
    m = last > first ? `${m.slice(0, first)}"…"${m.slice(last + 1)}` : `${m.slice(0, first)}"…`;
  }
  return m.length > MAX_MESSAGE ? `${m.slice(0, MAX_MESSAGE)}…` : m;
}

/**
 * Parameterised SQL is code, not data — but an inline string literal could be
 * either, so every '…' literal is redacted. Identifiers ("table") are kept.
 */
function scrubSql(q: string): string {
  const s = q.replace(/'(?:[^']|'')*'/g, "'…'").replace(/\s+/g, " ").trim();
  return s.length > MAX_QUERY ? `${s.slice(0, MAX_QUERY)}…` : s;
}

/**
 * Only the frame lines of a stack. V8 builds a stack as `${name}: ${message}`
 * followed by the frames, so the message (which may span lines) is cut off
 * first, and only the trailing run of frame-shaped lines is kept.
 */
function framesOf(stack: unknown, message: unknown): string {
  if (typeof stack !== "string") return "";
  let rest = stack;
  if (typeof message === "string" && message) {
    const i = rest.indexOf(message);
    if (i >= 0) rest = rest.slice(i + message.length);
  }
  // The frames are the TRAILING run of frame-shaped lines; a frame-looking
  // line inside a message is always followed by more message text.
  const lines = rest.split("\n");
  let start = lines.length;
  while (start > 0 && FRAME.test(lines[start - 1]!)) start--;
  return lines.slice(start, start + MAX_FRAMES).join("\n");
}

function build(
  rawName: string,
  message: string,
  source: ErrorLike | undefined,
  fields: Record<string, unknown>,
  cause?: unknown,
): Error {
  const name = safeName(rawName);
  const out = new (classFor(name))(message);
  Object.defineProperty(out, REBUILT, { value: true, enumerable: false });
  Object.defineProperty(out, "name", { value: name, enumerable: false, configurable: true, writable: true });
  const frames = source ? framesOf(source.stack, source.message) : "";
  out.stack = frames ? `${name}: ${message}\n${frames}` : `${name}: ${message}`;
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== "") (out as unknown as Record<string, unknown>)[k] = v;
  }
  if (cause !== undefined) {
    Object.defineProperty(out, "cause", { value: cause, enumerable: false, configurable: true, writable: true });
  }
  return out;
}

function pick(src: ErrorLike, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = src[k];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

function sanitize(err: unknown, depth: number): unknown {
  if (isObject(err) && (err as Record<symbol, unknown>)[REBUILT]) return err;
  if (!isObject(err)) {
    if (err === undefined || err === null) return err;
    // A thrown / rejected non-Error value is arbitrary data with no stack and
    // no code-authored message: log its type (and a string's length) only.
    const detail = typeof err === "string" ? `string of length ${err.length}` : typeof err;
    return build("NonErrorThrown", `a non-Error value was thrown (${detail}; content omitted from the log)`, undefined, {});
  }
  const causeOf = (e: ErrorLike) => (depth < MAX_DEPTH && e.cause !== undefined ? sanitize(e.cause, depth + 1) : undefined);

  if (isDrizzleQueryError(err)) {
    const params = err.params;
    return build(
      "DrizzleQueryError",
      "Failed query (params omitted from the log)",
      err,
      {
        query: scrubSql(err.query),
        paramCount: Array.isArray(params) ? params.length : undefined,
      },
      causeOf(err),
    );
  }

  if (isPgError(err)) {
    return build(
      "DatabaseError",
      typeof err.message === "string" ? scrubMessage(err.message) : "",
      err,
      {
        code: err.code,
        condition: PG_CONDITIONS[err.code],
        ...pick(err, PG_SAFE_FIELDS),
      },
      causeOf(err),
    );
  }

  const name =
    typeof err.name === "string" && err.name
      ? err.name
      : typeof err.constructor === "function" && err.constructor.name
        ? err.constructor.name
        : "Error";
  if (name === "ZodError" && Array.isArray(err.issues)) {
    // Zod messages echo received enum values; keep only codes and paths.
    const issues = (err.issues as Array<Record<string, unknown>>).slice(0, 10).map((i) => ({
      code: i.code,
      path: Array.isArray(i.path) ? i.path.join(".") : undefined,
    }));
    return build(name, `${issues.length} validation issue(s)`, err, { issues }, causeOf(err));
  }
  const fields: Record<string, unknown> = pick(err, GENERIC_SAFE_FIELDS);
  if (Array.isArray(err.errors) && depth < MAX_DEPTH) {
    fields.errors = (err.errors as unknown[]).slice(0, 5).map((e) => sanitize(e, depth + 1));
  }
  return build(
    name,
    typeof err.message === "string" ? scrubMessage(err.message) : "",
    err,
    fields,
    causeOf(err),
  );
}

/**
 * The error as it may be written to a log: rebuilt from an allow-list (see the
 * module comment). Safe to call on anything — a non-Error value comes back as
 * a NonErrorThrown naming only its type; `null`/`undefined` unchanged.
 */
export function loggableError(err: unknown): unknown {
  return sanitize(err, 0);
}

function looksLikeError(v: unknown): boolean {
  return v instanceof Error || (isObject(v) && typeof v.stack === "string" && typeof v.message === "string");
}

/** Replace every Error-like argument of a console call with its loggable form. */
export function sanitizeLogArgs(args: unknown[]): unknown[] {
  return args.some(looksLikeError) ? args.map((a) => (looksLikeError(a) ? loggableError(a) : a)) : args;
}

const SCRUBBED = Symbol.for("docturn.logScrubber");
const METHODS = ["error", "warn", "log", "info", "debug"] as const;

/**
 * Route every Error passed to console.* through loggableError(), for the whole
 * process. Called once from the server entry point (server/index.ts).
 * Idempotent; returns a function that restores the original methods.
 */
export function installLogScrubber(target: Console = console): () => void {
  const t = target as unknown as Record<string | symbol, unknown>;
  if (t[SCRUBBED]) return t[SCRUBBED] as () => void;
  const originals = new Map<string, unknown>();
  for (const m of METHODS) {
    const orig = t[m];
    if (typeof orig !== "function") continue;
    originals.set(m, orig);
    t[m] = function scrubbed(this: unknown, ...args: unknown[]) {
      return (orig as (...a: unknown[]) => unknown).apply(this, sanitizeLogArgs(args));
    };
  }
  const uninstall = () => {
    for (const [m, orig] of originals) t[m] = orig;
    delete t[SCRUBBED];
  };
  Object.defineProperty(t, SCRUBBED, { value: uninstall, configurable: true, enumerable: false });
  return uninstall;
}
