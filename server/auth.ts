import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Express, Request, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import {
  loginSchema,
  registerSchema,
  toSafeUser,
  PLATFORM_ORG_CODE,
  SELF_REGISTRABLE_ROLES,
  type User,
} from "@shared/schema";
import { storage } from "./storage.js";
import { appendAudit } from "./audit.js";
import { getModules } from "./modules.js";
import { REGISTER_RATE_LIMIT, RATE_LIMIT_RESPONSE, clientIpKey, getRateLimitState } from "./config.js";

// promisify() picks the 3-argument overload; we always pass explicit parameters.
const scryptAsync = promisify(scrypt) as unknown as (
  password: string,
  salt: string,
  keylen: number,
  options: import("node:crypto").ScryptOptions,
) => Promise<Buffer>;

/* ── MFA enrolment gate ─────────────────────────────────────────────────────
 * When the org has the `security.mfaRequired` module ON, a privileged user
 * (director / ER director / developer — see PRIVILEGED_ROLES in rbac.ts) who
 * has not enrolled a second factor may sign in, but the session is then only
 * good for enrolling: every /api route except the exemptions below answers
 * 403 { error: "mfa_enrollment_required" }. The check re-reads the user row
 * and the org's module map on every request, so completing enrolment (the
 * existing POST /api/mfa/verify flow) lifts the block immediately, and
 * flipping the module mid-session takes effect without a re-login.
 */
export const MFA_REQUIRED_MODULE = "security.mfaRequired";

/** Paths (relative to the /api mount) a flagged session may still use. */
const MFA_GATE_EXEMPT: readonly RegExp[] = [
  /^\/user\/?$/,
  /^\/logout\/?$/,
  /^\/mfa(\/|$)/,
  /^\/modules\/?$/,
  /^\/config\/?$/,
];

export function isMfaGateExempt(apiRelativePath: string): boolean {
  return MFA_GATE_EXEMPT.some((re) => re.test(apiRelativePath));
}

/**
 * Must this user enrol MFA before doing anything else? Reads live state — the
 * org's module switch and the user's twoFactorEnabled column — never the
 * session, so it cannot go stale.
 */
export async function mfaEnrollmentRequired(user: {
  id: number;
  organizationId: number;
  role: string;
}): Promise<boolean> {
  if (!isPrivilegedRole(user.role)) return false;
  const modules = await getModules(user.organizationId);
  if (modules[MFA_REQUIRED_MODULE] !== true) return false;
  const fresh = await storage().getUserById(user.id);
  return !!fresh && !fresh.twoFactorEnabled;
}

/** Express middleware mounted at /api by registerAuthRoutes. */
export function mfaEnrollmentGate(): RequestHandler {
  return async (req, res, next) => {
    try {
      const me = req.user as unknown as User | undefined;
      // Unauthenticated requests are the routes' own business (401 there).
      if (!me || !isPrivilegedRole(me.role)) return next();
      if (isMfaGateExempt(req.path)) return next();
      if (await mfaEnrollmentRequired(me)) {
        return res.status(403).json({ error: "mfa_enrollment_required" });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Paths (relative to /api) usable while a forced password change is pending. */
const PASSWORD_GATE_EXEMPT: readonly RegExp[] = [
  /^\/user\/?$/,
  /^\/logout\/?$/,
  /^\/account\/password\/?$/,
  /^\/modules\/?$/,
  /^\/config\/?$/,
];

/**
 * Forced password change. Every provisioned or admin-reset account carries a
 * one-time credential (users.must_change_password). Until the user replaces it
 * via PATCH /api/account/password, every other /api route answers
 * 403 { error: "password_change_required" }. Re-reads the user row on each
 * request so the gate lifts the moment the password is changed.
 */
export function passwordChangeGate(): RequestHandler {
  return async (req, res, next) => {
    try {
      const me = req.user as unknown as User | undefined;
      if (!me) return next();
      if (PASSWORD_GATE_EXEMPT.some((re) => re.test(req.path))) return next();
      const fresh = await storage().getUserById(me.id);
      if (fresh?.mustChangePassword) {
        return res.status(403).json({ error: "password_change_required" });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * The well-known demo password (and anything too short) can never be set on an
 * account by a user or an administrator — on ANY instance, synthetic or not.
 * Seed data is the only place it may exist.
 */
export function isForbiddenPassword(pw: string): boolean {
  if (pw.length < 8) return true;
  const demo = process.env.DEMO_PASSWORD || "docturn";
  return pw === demo || pw.toLowerCase() === "docturn" || pw.toLowerCase() === "password";
}

/**
 * One-time credential for a provisioned or reset account: 16 characters from an
 * unambiguous alphabet (no 0/O/1/l/I), grouped for reading out over the phone.
 * ~80 bits of entropy from crypto randomness. Returned to the administrator
 * exactly once and never stored in clear.
 */
export function issueTemporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) out += "-";
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

/* ── Password hashing ────────────────────────────────────────────────────────
 * scrypt (RFC 7914) with a per-user random salt. The work factor follows the
 * OWASP Password Storage Cheat Sheet's scrypt table: N=2^15, r=8, p=3 is one
 * of its listed equal-cost settings (with N=2^17 p=1, N=2^16 p=2, N=2^14 p=5).
 * It was chosen over N=2^17 p=1 because one derivation costs ~240 ms and
 * 32 MiB here (measured; 2^17 p=1 is ~400 ms and 128 MiB), which keeps login
 * latency acceptable and bounds memory even with the libuv pool's 4 scrypts
 * in flight. `maxmem` is set explicitly: Node's 32 MiB default would throw
 * "memory limit exceeded" for N=2^15 r=8 and every login would 500.
 *
 * Stored form (PHC-style, hex):  $scrypt$ln=15,r=8,p=3$<32 hex salt>$<128 hex key>
 * Legacy form (Node defaults, N=2^14 r=8 p=1):  <128 hex key>.<32 hex salt>
 *
 * Legacy credentials still verify; a successful sign-in with one re-hashes it
 * under the current parameters (see configurePassport) without touching
 * passwordChangedAt, so the upgrade never logs anyone out.
 */
export interface ScryptParams {
  /** log2(N) — the CPU/memory cost. */
  ln: number;
  /** Block size. */
  r: number;
  /** Parallelization (sequential in OpenSSL, so it multiplies time, not memory). */
  p: number;
}

export const SCRYPT_PARAMS: Readonly<ScryptParams> = { ln: 15, r: 8, p: 3 };
/** What Node's `scrypt(password, salt, keylen)` used before the upgrade. */
export const LEGACY_SCRYPT_PARAMS: Readonly<ScryptParams> = { ln: 14, r: 8, p: 1 };
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;

function scryptOptions(params: ScryptParams) {
  const N = 2 ** params.ln;
  // OpenSSL needs 128·r·(N+2) + 128·r·p bytes; allow twice that so the cap can
  // never be the reason a login fails.
  return { N, r: params.r, p: params.p, maxmem: 256 * params.r * (N + 2 + params.p) };
}

async function deriveKey(password: string, saltHex: string, params: ScryptParams): Promise<Buffer> {
  return (await scryptAsync(password, saltHex, SCRYPT_KEYLEN, scryptOptions(params))) as Buffer;
}

function formatHash(params: ScryptParams, saltHex: string, keyHex: string): string {
  return `$scrypt$ln=${params.ln},r=${params.r},p=${params.p}$${saltHex}$${keyHex}`;
}

/** Hash a password under the CURRENT parameters. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES).toString("hex");
  const derived = await deriveKey(password, salt, SCRYPT_PARAMS);
  return formatHash(SCRYPT_PARAMS, salt, derived.toString("hex"));
}

/** Human-readable description of what {@link hashPassword} produces. */
export const PASSWORD_HASH_FORMAT =
  `scrypt N=2^${SCRYPT_PARAMS.ln} r=${SCRYPT_PARAMS.r} p=${SCRYPT_PARAMS.p} (OWASP work factor), ` +
  `${SCRYPT_KEYLEN}-byte key + ${SCRYPT_SALT_BYTES}-byte random salt, stored as ` +
  `$scrypt$ln=${SCRYPT_PARAMS.ln},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}$<32 hex>$<128 hex>`;

/** The pre-upgrade shape, still accepted for verification and upgraded on login. */
export const LEGACY_PASSWORD_HASH_FORMAT =
  `scrypt N=2^${LEGACY_SCRYPT_PARAMS.ln} r=${LEGACY_SCRYPT_PARAMS.r} p=${LEGACY_SCRYPT_PARAMS.p}, stored as <128 hex>.<32 hex>`;

interface ParsedHash {
  params: ScryptParams;
  saltHex: string;
  keyHex: string;
  legacy: boolean;
}

const HEX_KEY = /^[0-9a-f]{128}$/;
const HEX_SALT = /^[0-9a-f]{32}$/;

/** Format-only parse. Never derives, logs or returns anything but the fields. */
function parseStoredHash(stored: unknown): ParsedHash | null {
  if (typeof stored !== "string") return null;
  if (stored.startsWith("$scrypt$")) {
    const parts = stored.split("$"); // ["", "scrypt", "ln=..,r=..,p=..", salt, key]
    if (parts.length !== 5) return null;
    const m = /^ln=(\d{1,2}),r=(\d{1,3}),p=(\d{1,3})$/.exec(parts[2]!);
    if (!m) return null;
    const params = { ln: Number(m[1]), r: Number(m[2]), p: Number(m[3]) };
    if (params.ln < 1 || params.ln > 24 || params.r < 1 || params.p < 1) return null;
    if (!HEX_SALT.test(parts[3]!) || !HEX_KEY.test(parts[4]!)) return null;
    return { params, saltHex: parts[3]!, keyHex: parts[4]!, legacy: false };
  }
  const legacy = stored.split(".");
  if (legacy.length === 2 && HEX_KEY.test(legacy[0]!) && HEX_SALT.test(legacy[1]!)) {
    return { params: { ...LEGACY_SCRYPT_PARAMS }, saltHex: legacy[1]!, keyHex: legacy[0]!, legacy: true };
  }
  return null;
}

export type PasswordHashClass = "current" | "legacy" | "invalid";

/**
 * Classify a stored credential by FORMAT (never by content): `current` is what
 * {@link hashPassword} emits today, `legacy` a still-verifiable pre-upgrade
 * scrypt hash (weaker work factor, upgraded at the user's next sign-in), and
 * `invalid` anything else — plaintext, an unknown scheme, or a truncated value.
 * The compliance monitor reports on these classes.
 */
export function classifyPasswordHash(stored: unknown): PasswordHashClass {
  const parsed = parseStoredHash(stored);
  if (!parsed) return "invalid";
  if (parsed.legacy) return "legacy";
  const { ln, r, p } = parsed.params;
  return ln === SCRYPT_PARAMS.ln && r === SCRYPT_PARAMS.r && p === SCRYPT_PARAMS.p
    ? "current"
    : "legacy";
}

/**
 * Does a stored credential match the shape {@link hashPassword} emits TODAY?
 * Used by the compliance monitor to prove no user row holds a plaintext or
 * legacy credential. Deliberately format-only.
 */
export function isValidPasswordHashFormat(stored: unknown): boolean {
  return classifyPasswordHash(stored) === "current";
}

/** Should this credential be re-hashed under the current parameters? */
export function needsRehash(stored: unknown): boolean {
  return classifyPasswordHash(stored) !== "current";
}

/**
 * A syntactically valid, randomly generated credential nobody knows. The login
 * path verifies against it whenever the org or the user does not exist, so an
 * unknown account costs exactly one scrypt — the same as a wrong password —
 * and response time cannot be used to enumerate org codes or usernames.
 */
const DUMMY_HASH = formatHash(
  SCRYPT_PARAMS,
  randomBytes(SCRYPT_SALT_BYTES).toString("hex"),
  randomBytes(SCRYPT_KEYLEN).toString("hex"),
);

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  // An unparsable stored value still costs one scrypt (against the dummy) so a
  // malformed row cannot be told apart from a wrong password by timing.
  const parsed = parseStoredHash(stored) ?? parseStoredHash(DUMMY_HASH)!;
  const derived = await deriveKey(password, parsed.saltHex, parsed.params);
  const known = Buffer.from(parsed.keyHex, "hex");
  if (known.length !== derived.length) return false;
  return timingSafeEqual(known, derived);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // Passport's User is our DB user.
    interface User {
      id: number;
      organizationId: number;
      role: string;
      username: string;
      displayName: string;
      passwordChangedAt?: Date | null;
    }
  }
}

/* ── Session principal ───────────────────────────────────────────────────────
 * What Passport stores in the session is not a bare user id but
 * { id, pg } where `pg` is the user's password generation (the epoch-ms of
 * users.password_changed_at, 0 when never changed). Every place that turns a
 * session into a user — Passport's deserializeUser for HTTP and the WebSocket
 * upgrade (server/ws) — goes through resolveSessionUser(), which rejects a
 * session whose generation no longer matches the row. So a password change
 * (self-service or administrative reset) ends every OTHER session on its next
 * request, and the live sockets are closed through the revoker below.
 */
export interface SessionPrincipal {
  id: number;
  /** Password generation the session was issued under. */
  pg: number;
}

export function passwordGeneration(user: { passwordChangedAt?: Date | string | null } | null | undefined): number {
  const v = user?.passwordChangedAt;
  if (!v) return 0;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function sessionPrincipalFor(user: { id: number; passwordChangedAt?: Date | string | null }): SessionPrincipal {
  return { id: user.id, pg: passwordGeneration(user) };
}

/** Parse whatever `session.passport.user` holds. A bare number is a pre-upgrade session (generation 0). */
export function parseSessionPrincipal(raw: unknown): SessionPrincipal | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return { id: raw, pg: 0 };
  if (raw && typeof raw === "object") {
    const o = raw as { id?: unknown; pg?: unknown };
    if (typeof o.id === "number" && Number.isInteger(o.id) && o.id > 0) {
      return { id: o.id, pg: typeof o.pg === "number" && Number.isFinite(o.pg) ? o.pg : 0 };
    }
  }
  return null;
}

/**
 * Resolve a stored session principal to a LIVE user, or null when the session
 * must be treated as signed out: unknown user, deactivated account, or a
 * password generation that no longer matches (the password was changed or
 * reset after this session was issued).
 */
export async function resolveSessionUser(raw: unknown): Promise<User | null> {
  const principal = parseSessionPrincipal(raw);
  if (!principal) return null;
  const user = await storage().getUserById(principal.id);
  if (!user) return null;
  // A deactivated account's live sessions die on their next request —
  // deactivation is immediate, not "at next login".
  if (user.disabledAt) return null;
  if (passwordGeneration(user) !== principal.pg) return null;
  return user;
}

/* ── Session revocation (live transports) ─────────────────────────────────── */
export interface SessionRevocation {
  userId: number;
  /** The session performing the change keeps its own live connections. */
  exceptSessionId?: string;
  reason: "password_changed" | "password_reset";
}
export type SessionRevoker = (revocation: SessionRevocation) => void;
const sessionRevokers = new Set<SessionRevoker>();

/**
 * Register a hook that is told whenever a user's other sessions are revoked.
 * The WebSocket hub registers one to close that user's live sockets; HTTP
 * sessions need no hook because resolveSessionUser() rejects them on their
 * next request. Returns an unsubscribe function.
 */
export function onSessionsRevoked(fn: SessionRevoker): () => void {
  sessionRevokers.add(fn);
  return () => {
    sessionRevokers.delete(fn);
  };
}

function revokeSessions(revocation: SessionRevocation): void {
  for (const fn of sessionRevokers) {
    try {
      fn(revocation);
    } catch (err) {
      console.error("[auth] session revoker failed", err);
    }
  }
}

/**
 * Persist a new credential and end every OTHER session of that user: the row's
 * password generation moves (so stale sessions stop resolving) and the live
 * transports are told to drop the user's sockets. `keepSessionId` is the
 * session performing a self-service change, which stays signed in.
 */
export async function rotatePassword(
  userId: number,
  newPassword: string,
  opts: { mustChangePassword: boolean; keepSessionId?: string; reason: SessionRevocation["reason"] },
): Promise<User | undefined> {
  const passwordHash = await hashPassword(newPassword);
  const updated = await storage().updateUser(userId, {
    passwordHash,
    mustChangePassword: opts.mustChangePassword,
    passwordChangedAt: new Date(),
  });
  revokeSessions({ userId, exceptSessionId: opts.keepSessionId, reason: opts.reason });
  return updated;
}

/**
 * After a self-service password change the CURRENT session must carry the new
 * generation or it would be rejected on its next request like the others.
 * Only a cookie session that is actually signed in is re-stamped (a demo-token
 * request has no passport entry and must not acquire one).
 */
function restampSession(req: Request, user: User): Promise<void> {
  return new Promise((resolve, reject) => {
    const sess = req.session as (typeof req.session & { passport?: { user?: unknown } }) | undefined;
    if (!sess?.passport || sess.passport.user === undefined) return resolve();
    sess.passport = { ...sess.passport, user: sessionPrincipalFor(user) };
    sess.save((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Wires Passport's local strategy. Credentials are scoped to an org code, so the
 * same username can exist in different tenants without collision.
 */
export function configurePassport() {
  passport.use(
    new LocalStrategy(
      { usernameField: "username", passwordField: "password", passReqToCallback: true },
      async (req, username, password, done) => {
        try {
          const orgCode = String(req.body.orgCode ?? "");
          const org = await storage().getOrganizationByCode(orgCode);
          // Constant-cost path: an unknown org still performs the user lookup
          // (against an impossible org id) and an unknown user still performs
          // one scrypt (against DUMMY_HASH), so "does this org/user exist" is
          // not readable from the response time. The answer is one generic
          // invalid_credentials for every miss.
          const user = await storage().getUserByUsername(org?.id ?? -1, username);
          const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
          if (!user || !ok) return done(null, false, { message: "invalid_credentials" });
          // Deactivated workforce member: a correct password still fails, with
          // the same generic answer (never confirm the account exists) — but the
          // attempt is audited at high risk so the org can see a leaver trying.
          if (user.disabledAt) {
            void appendAudit({
              organizationId: user.organizationId,
              userId: user.id,
              action: "auth.login_denied_disabled",
              resourceType: "user",
              resourceId: user.id,
              details: {},
              riskLevel: "high",
            });
            return done(null, false, { message: "invalid_credentials" });
          }
          // Transparent work-factor upgrade: a credential stored under the
          // legacy parameters is re-hashed now that we hold the plaintext. Not
          // a password CHANGE — passwordChangedAt is untouched, so no session
          // is invalidated. A failure here never fails the sign-in.
          if (needsRehash(user.passwordHash)) {
            try {
              await storage().updateUser(user.id, { passwordHash: await hashPassword(password) });
            } catch (err) {
              console.error("[auth] password re-hash failed", err);
            }
          }
          return done(null, user as unknown as Express.User);
        } catch (err) {
          return done(err as Error);
        }
      },
    ),
  );

  // Every req.login() in the codebase (password login, MFA completion, developer
  // impersonation) passes through here, so stamping the generation in ONE place
  // covers them all. A caller that hands in a partial user without the column
  // gets the live value from the row.
  passport.serializeUser((user, done) => {
    const u = user as unknown as { id: number; passwordChangedAt?: Date | string | null };
    // A DB row carries the column (null = never changed); only a partial
    // object lacks it entirely.
    if (u.passwordChangedAt !== undefined) return done(null, sessionPrincipalFor(u));
    storage()
      .getUserById(u.id)
      .then((fresh) => done(null, { id: u.id, pg: passwordGeneration(fresh) }))
      .catch((err: Error) => done(err));
  });

  passport.deserializeUser(async (raw: unknown, done) => {
    try {
      const user = await resolveSessionUser(raw);
      done(null, (user ?? false) as unknown as Express.User);
    } catch (err) {
      done(err as Error);
    }
  });
}

/** Is this the platform/operator tenant? Compared on the RESOLVED org (lookups are case-insensitive). */
export function isPlatformOrg(org: { code: string }): boolean {
  return org.code.toUpperCase() === PLATFORM_ORG_CODE;
}

/** Postgres unique-violation (23505), however the driver wraps it. */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e && typeof e === "object" && depth < 4; depth++) {
    const o = e as { code?: unknown; message?: unknown; cause?: unknown };
    if (o.code === "23505") return true;
    if (typeof o.message === "string" && /duplicate key value violates unique constraint/i.test(o.message)) return true;
    e = o.cause;
  }
  return false;
}

/**
 * Express 4 does not catch a rejected async handler: the request would hang
 * with no response and the client's buttons stay disabled (the SHO-8 symptom).
 * server/async-errors.ts now patches Express app-wide (imported first by
 * createApp); this explicit wrapper is kept so these handlers forward to
 * next(err) → the JSON error handler even where that patch is not loaded.
 */
type AsyncHandler = (req: Request, res: import("express").Response, next: import("express").NextFunction) => Promise<unknown>;
const wrap = (fn: AsyncHandler): RequestHandler => (req, res, next) => {
  fn(req, res, next).catch(next);
};

/** Registers the auth routes onto the app. */
export function registerAuthRoutes(app: Express) {
  // Privileged-role MFA enrolment gate. Mounted here, before every /api route
  // that follows (registerRoutes calls this second, right after /api/health).
  app.use("/api", mfaEnrollmentGate());
  app.use("/api", passwordChangeGate());

  // Public self-registration is the one unauthenticated WRITE in the API, and
  // every accepted request lands in a director's queue. The auth limiter in
  // app.ts counts failures only (brute force is about wrong guesses), so a
  // second limiter here counts EVERY request, 201s included. Honours the same
  // on/off decision createApp() recorded (RATE_LIMIT=off, rateLimiting:false),
  // and keys/answers exactly like the limiters in app.ts: clientIpKey() (the
  // address resolved under the trusted-proxy list, IPv6 bucketed by /64) and
  // the shared RATE_LIMIT_RESPONSE body. Supplying a keyGenerator also bypasses
  // the library's X-Forwarded-For validation, so nothing can throw and 500.
  const registerLimiter: RequestHandler = getRateLimitState().enabled
    ? rateLimit({
        ...REGISTER_RATE_LIMIT,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: clientIpKey,
        message: RATE_LIMIT_RESPONSE,
      })
    : (_req, _res, next) => next();

  // Self-registration → pending (a director approves). We model the pending
  // gate minimally here: a registration creates no active user yet.
  //
  // Disclosure policy (mirrors /api/login, which answers one generic 401):
  //   • the org code is an onboarding identifier the director hands out, so a
  //     mistyped one gets a usable 404 — but the platform/operator org answers
  //     that same 404, as if it did not exist;
  //   • whether a USERNAME already exists is never disclosed: a request for a
  //     taken name is accepted (201) exactly like a fresh one and lands in the
  //     director's queue flagged `usernameTaken`, where approving it is refused
  //     (409) and denying it clears it. Timing is uniform too: no user lookup
  //     happens on this path;
  //   • a re-submission for a name that is already PENDING answers 409
  //     request_pending whether or not the account exists, so the pair
  //     (first → 201, again → 409) reveals nothing about accounts either.
  app.post(
    "/api/register",
    registerLimiter,
    wrap(async (req, res) => {
      // Privileged roles are provisioned by an administrator, never requested
      // by a stranger. Answer before schema parsing so the client gets a
      // precise reason instead of a generic validation_error.
      const requested = (req.body ?? {}).requestedRole;
      if (
        requested !== undefined &&
        !(SELF_REGISTRABLE_ROLES as readonly string[]).includes(String(requested))
      ) {
        return res.status(400).json({ error: "role_not_self_registrable" });
      }
      // Same floor as a password change: 8+ characters and never the demo
      // password — a self-chosen credential must not be weaker than a changed
      // one. Checked before the schema so every password failure answers
      // weak_password (the schema's min length would otherwise mask it).
      const pw = (req.body ?? {}).password;
      if (typeof pw !== "string" || isForbiddenPassword(pw)) {
        return res.status(400).json({ error: "weak_password" });
      }
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "validation_error" });
      }
      const org = await storage().getOrganizationByCode(parsed.data.orgCode);
      if (!org || isPlatformOrg(org)) {
        return res.status(404).json({ error: "organization_not_found" });
      }
      const username = parsed.data.username;
      const pending = (await storage().listPendingRegistrations(org.id)).find(
        (r) => r.username === username,
      );
      if (pending) return res.status(409).json({ error: "request_pending" });
      try {
        await storage().createPendingRegistration({
          organizationId: org.id,
          username,
          passwordHash: await hashPassword(parsed.data.password),
          displayName: parsed.data.displayName,
          requestedRole: parsed.data.requestedRole ?? "hospitalist",
          status: "pending",
        });
      } catch (err) {
        // Two submissions raced past the check above; the partial unique index
        // (server/db.ts) kept exactly one of them.
        if (isUniqueViolation(err)) return res.status(409).json({ error: "request_pending" });
        throw err;
      }
      await appendAudit({
        organizationId: org.id,
        userId: null,
        action: "auth.register_request",
        resourceType: "user",
        resourceId: null,
        details: { username, requestedRole: parsed.data.requestedRole ?? "hospitalist" },
        riskLevel: "low",
      });
      // Self-registration requires a director's sign-off before it becomes a user.
      return res.status(201).json({ pending: true });
    }),
  );

  // Approval queue — directors AND ER directors (and developers) can review.
  app.get(
    "/api/registrations",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    wrap(async (req, res) => {
      const me = req.user as unknown as User;
      const rows = await storage().listPendingRegistrations(me.organizationId);
      // The reviewer legitimately knows their own roster: flag requests whose
      // username already belongs to an account (approving one is refused).
      const taken = new Set((await storage().listUsers(me.organizationId)).map((u) => u.username));
      // Never expose credential hashes to the approval UI.
      res.json(
        rows.map(({ passwordHash: _ph, ...rest }) => ({
          ...rest,
          usernameTaken: taken.has(rest.username),
        })),
      );
    }),
  );

  // Idempotent: approving an already-approved request answers 200 with the
  // same userId; a denied request answers 409; a request whose username is
  // meanwhile taken answers 409 and stays in the queue for the director to
  // deny. The DB unique index is the last line against two racing approvals.
  app.post(
    "/api/registrations/:id/approve",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    wrap(async (req, res) => {
      const me = req.user as unknown as User;
      const id = Number(req.params.id);
      const reg = await storage().getPendingRegistration(me.organizationId, id);
      if (!reg) return res.status(404).json({ error: "not_found" });
      const approvedUser = async () =>
        (await storage().getUserByUsername(reg.organizationId, reg.username))?.id ?? null;
      if (reg.status === "approved") {
        return res.status(200).json({ userId: await approvedUser(), alreadyApproved: true });
      }
      if (reg.status === "rejected") return res.status(409).json({ error: "already_denied" });
      if (await storage().getUserByUsername(reg.organizationId, reg.username)) {
        return res.status(409).json({ error: "username_taken" });
      }
      let user: User;
      try {
        user = await storage().createUser({
          organizationId: reg.organizationId,
          username: reg.username,
          passwordHash: reg.passwordHash,
          role: reg.requestedRole,
          displayName: reg.displayName,
          credential: null,
          phone: null,
          twoFactorEnabled: false,
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Lost a race: either a second approver got here first (then this is a
        // plain idempotent success) or the name was taken another way.
        const again = await storage().getPendingRegistration(me.organizationId, id);
        if (again?.status === "approved") {
          return res.status(200).json({ userId: await approvedUser(), alreadyApproved: true });
        }
        return res.status(409).json({ error: "username_taken" });
      }
      // Hospitalists need a rotation profile to appear in routing / dashboards.
      if (reg.requestedRole === "hospitalist") {
        const existing = await storage().listHospitalists(reg.organizationId);
        await storage().createHospitalist({
          organizationId: reg.organizationId,
          userId: user.id,
          specialty: "Hospital Medicine",
          currentPatientCount: 0,
          patientCap: 12,
          rotationOrder: existing.length,
          working: false,
          shiftType: "day",
        });
      }
      await storage().updatePendingRegistration(me.organizationId, id, {
        status: "approved",
      });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "registration.approve",
        resourceType: "user",
        resourceId: user.id,
        details: { username: reg.username, role: reg.requestedRole },
        riskLevel: "medium",
      });
      res.status(201).json({ userId: user.id });
    }),
  );

  // Idempotent: denying twice is a no-op success; an approved request cannot be
  // denied (the account exists — deactivate it instead).
  app.post(
    "/api/registrations/:id/deny",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    wrap(async (req, res) => {
      const me = req.user as unknown as User;
      const id = Number(req.params.id);
      const reg = await storage().getPendingRegistration(me.organizationId, id);
      if (!reg) return res.status(404).json({ error: "not_found" });
      if (reg.status === "approved") return res.status(409).json({ error: "already_approved" });
      if (reg.status === "rejected") return res.json({ ok: true, alreadyDenied: true });
      await storage().updatePendingRegistration(me.organizationId, id, {
        status: "rejected",
      });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "registration.deny",
        resourceType: "user",
        resourceId: null,
        details: { username: reg.username },
        riskLevel: "low",
      });
      res.json({ ok: true });
    }),
  );

  app.post("/api/login", (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error" });
    }
    passport.authenticate(
      "local",
      (err: Error | null, user: User | false) => {
        if (err) return next(err);
        if (!user) {
          return res.status(401).json({ error: "invalid_credentials" });
        }
        // MFA gate: if enabled, hold the session pending a second factor.
        if (user.twoFactorEnabled) {
          req.session.pendingMfaUserId = user.id;
          return res.status(202).json({ twoFactorRequired: true });
        }
        req.login(user as unknown as Express.User, async (loginErr) => {
          if (loginErr) return next(loginErr);
          // Login SUCCEEDS for a privileged user who still has to enrol MFA —
          // the session is simply flagged, and the gate above limits it to the
          // enrolment routes until /api/mfa/verify flips twoFactorEnabled.
          let enrolmentRequired = false;
          try {
            enrolmentRequired = await mfaEnrollmentRequired(user);
          } catch (err) {
            return next(err);
          }
          if (enrolmentRequired) req.session.mfaEnrollmentRequired = true;
          void appendAudit({
            organizationId: user.organizationId,
            userId: user.id,
            action: "auth.login",
            resourceType: "user",
            resourceId: user.id,
            details: enrolmentRequired ? { mfaEnrollmentRequired: true } : {},
            riskLevel: "low",
          });
          return res.status(200).json(
            enrolmentRequired
              ? { ...toSafeUser(user), mfaEnrollmentRequired: true }
              : toSafeUser(user),
          );
        });
      },
    )(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => res.status(204).end());
    });
  });

  app.get("/api/user", async (req, res, next) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const me = req.user as unknown as User;
    try {
      // Re-checked from the DB + module map on every call (not the session):
      // the UI polls this to learn the block has lifted after enrolment.
      const required = await mfaEnrollmentRequired(me);
      if (req.session) {
        if (required) req.session.mfaEnrollmentRequired = true;
        else if (req.session.mfaEnrollmentRequired) delete req.session.mfaEnrollmentRequired;
      }
      return res.json(
        required ? { ...toSafeUser(me), mfaEnrollmentRequired: true } : toSafeUser(me),
      );
    } catch (err) {
      return next(err);
    }
  });

  app.get("/api/users", requireAuth, requireRole("director", "developer"), async (req, res) => {
    const me = req.user as unknown as User;
    const list = await storage().listUsers(me.organizationId);
    res.json(list.map(toSafeUser));
  });

  // Self-service password change: verify the current password, then set a new one
  // (scrypt-hashed). Lets users move off the shared demo password for real use.
  // Every OTHER session of the user ends (HTTP on its next request, WebSocket
  // immediately); the session making the change is re-stamped and continues.
  app.patch(
    "/api/account/password",
    requireAuth,
    wrap(async (req, res) => {
      const me = req.user as unknown as User;
      const current = String((req.body || {}).currentPassword || "");
      const next = String((req.body || {}).newPassword || "");
      // Too short, the demo password, or the same as the current one are all
      // refused — on every instance, not only in real-PHI mode.
      if (isForbiddenPassword(next) || next === current) return res.status(400).json({ error: "weak_password" });
      const fresh = await storage().getUserById(me.id);
      if (!fresh) return res.status(404).json({ error: "not_found" });
      const ok = await verifyPassword(current, fresh.passwordHash);
      if (!ok) return res.status(403).json({ error: "wrong_password" });
      const wasForced = !!fresh.mustChangePassword;
      const updated = await rotatePassword(me.id, next, {
        mustChangePassword: false,
        keepSessionId: req.sessionID,
        reason: "password_changed",
      });
      await restampSession(req, updated ?? fresh);
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "auth.password_change",
        resourceType: "user",
        resourceId: me.id,
        details: { forced: wasForced, otherSessionsRevoked: true },
        riskLevel: "medium",
      });
      res.json({ ok: true });
    }),
  );
}

// Imported here to avoid a cycle at module top in some bundlers.
import { isPrivilegedRole, requireAuth, requireRole } from "./rbac.js";

declare module "express-session" {
  interface SessionData {
    pendingMfaUserId?: number;
    /** Privileged user signed in without MFA while the org requires it. */
    mfaEnrollmentRequired?: boolean;
    /** Developer who entered an impersonated / managed-org portal (dev.ts). */
    impersonatorId?: number;
  }
}

export const _testHelpers = { scryptAsync } as { scryptAsync: typeof scryptAsync };
export type { RequestHandler };
