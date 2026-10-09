import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Express, Request, RequestHandler, Response } from "express";
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
import { normalizeUsername, usernameKey } from "./usernames.js";
import { REGISTER_RATE_LIMIT, RATE_LIMIT_RESPONSE, SESSION_POLICY, clientIpKey, getRateLimitState } from "./config.js";

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

/**
 * The way back from an impersonated / managed-org portal. The session's
 * identity is then the BORROWED account, so its gates apply to it — and a
 * freshly provisioned account (one-time password) or an unenrolled privileged
 * account in an MFA-required org would otherwise trap the developer inside
 * (A.CON-SHO-38). The route itself only ever swaps back to the developer the
 * session recorded at entry (400 for a session that is not impersonating) and
 * is audited; the developer's OWN gates apply again from the next request.
 */
const IMPERSONATION_EXIT = /^\/dev\/impersonate\/stop\/?$/;

/** Paths (relative to the /api mount) a flagged session may still use. */
const MFA_GATE_EXEMPT: readonly RegExp[] = [
  /^\/user\/?$/,
  /^\/session\/?$/,
  /^\/logout\/?$/,
  /^\/mfa(\/|$)/,
  /^\/modules\/?$/,
  /^\/config\/?$/,
  IMPERSONATION_EXIT,
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
  /^\/session\/?$/,
  /^\/logout\/?$/,
  /^\/account\/password\/?$/,
  /^\/modules\/?$/,
  /^\/config\/?$/,
  IMPERSONATION_EXIT,
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

/* ── App lock (A.CON-SHO-7) ─────────────────────────────────────────────────
 * The web client's lock screen is backed by the SESSION, not by a flag in the
 * browser: POST /api/session/lock marks the session (or the demo bearer token
 * making the request) locked, and from then on
 *  - every /api route except the identity / sign-in ones below answers
 *    423 { error: "session_locked" } — /api/modules included (it is exempt
 *    from the MFA gate, not from this one);
 *  - GET /api/user and GET /api/session still answer, flagged `locked: true`
 *    (plus the org code the lock screen re-authenticates against), so a page
 *    reload with the browser's own flag deleted still lands on the lock screen;
 *  - the session's live sockets are closed (4423 "session_locked") and a
 *    locked session cannot open a new one (server/ws);
 *  - there is no unlock route: only re-authentication unlocks. POST /api/login
 *    (and its second factor, /api/2fa/complete-login) regenerates the session,
 *    so a successful sign-in replaces the locked session with a fresh one and
 *    a wrong password leaves it locked;
 *  - a locked session cannot be kept alive by traffic. Every request — a 423
 *    included — rolls express-session's 15-minute inactivity expiry, so the
 *    gate enforces its own deadline: one idle window (SESSION_POLICY.maxAgeMs)
 *    after the lock, the session is signed out on its next request however
 *    often it was touched meanwhile. The client may back-date the lock by the
 *    time it had already been idle (`idleMs`, clamped to [0, window]) — which
 *    can only shorten that deadline: the 15-minute idle auto-lock therefore
 *    ends the server session outright, a real automatic logoff.
 */
export const APP_LOCK_CLOSE_CODE = 4423;

/** Paths (relative to /api) the gate never touches: they ARE re-authentication or sign-out. */
const APP_LOCK_PASSTHROUGH: readonly RegExp[] = [
  /^\/login\/?$/,
  /^\/logout\/?$/,
  /^\/2fa\/(complete-login|request-sms)\/?$/,
];

/** Paths (relative to /api) a locked (unexpired) session may still use. */
const APP_LOCK_EXEMPT: readonly RegExp[] = [
  /^\/user\/?$/,
  /^\/session\/?$/,
  /^\/session\/lock\/?$/,
  /^\/config\/?$/,
];

export function isAppLockExempt(apiRelativePath: string): boolean {
  return APP_LOCK_EXEMPT.some((re) => re.test(apiRelativePath));
}

interface AppLockHandle {
  /** Epoch ms the lock counts from, or null when not locked. */
  lockedAt(): number | null;
  /** Lock (never moves an existing lock later). */
  lock(at: number): Promise<void>;
  /** Sign this session (or token) out. */
  end(): Promise<void>;
  /** What this session's live sockets carry as their session id. */
  connectionId: string | null;
}

function cookieSessionUserId(req: Request): number | null {
  const sess = req.session as (typeof req.session & { passport?: { user?: unknown } }) | undefined;
  return parseSessionPrincipal(sess?.passport?.user)?.id ?? null;
}

/**
 * The lock state of the credential that authenticated this request: the demo
 * bearer token when one did (it overrides the cookie), otherwise the cookie
 * session — and only when that session is signed in AS the request's user.
 */
function appLockOf(req: Request, res: Response): AppLockHandle | null {
  const me = req.user as unknown as User | undefined;
  if (!me) return null;
  const bearer = bearerCredentialOf(res);
  if (bearer) {
    if (!bearer.lockedAt || !bearer.lock || !bearer.end) return null;
    return {
      lockedAt: () => bearer.lockedAt!(),
      lock: async (at) => bearer.lock!(at),
      end: async () => {
        bearer.end!();
        (req as unknown as { user?: unknown }).user = undefined;
      },
      connectionId: bearer.connectionId,
    };
  }
  if (!req.session || cookieSessionUserId(req) !== me.id) return null;
  return {
    lockedAt: () => {
      const l = req.session.appLock;
      return l && l.userId === me.id && typeof l.at === "number" ? l.at : null;
    },
    lock: (at) =>
      new Promise<void>((resolve, reject) => {
        const prev = req.session.appLock;
        const keep = prev && prev.userId === me.id && typeof prev.at === "number" ? Math.min(prev.at, at) : at;
        req.session.appLock = { userId: me.id, at: keep };
        req.session.save((err) => (err ? reject(err) : resolve()));
      }),
    end: () =>
      new Promise<void>((resolve, reject) => {
        // passport's logOut regenerates the session: the locked one is gone.
        req.logout((err) => (err ? reject(err) : resolve()));
      }),
    connectionId: req.sessionID ?? null,
  };
}

/** Epoch ms this request's session (or token) was locked at, or null. */
export function appLockedAt(req: Request, res: Response): number | null {
  return appLockOf(req, res)?.lockedAt() ?? null;
}

/** Has a lock that started at `at` outlived the idle window? */
export function appLockExpired(at: number, now = Date.now()): boolean {
  return now - at >= SESSION_POLICY.maxAgeMs;
}

export interface SessionLockEvent {
  userId: number;
  /** The session (or demo token connection id) that was locked. */
  connectionId: string;
}
type SessionLockListener = (e: SessionLockEvent) => void;
const sessionLockListeners = new Set<SessionLockListener>();

/** The WebSocket hub registers here to close a session's sockets when it locks. */
export function onSessionLocked(fn: SessionLockListener): () => void {
  sessionLockListeners.add(fn);
  return () => {
    sessionLockListeners.delete(fn);
  };
}

function announceSessionLocked(e: SessionLockEvent): void {
  for (const fn of sessionLockListeners) {
    try {
      fn(e);
    } catch (err) {
      console.error("[auth] session-lock listener failed", err);
    }
  }
}

/** Express middleware mounted at /api by registerAuthRoutes, before every other gate. */
export function appLockGate(): RequestHandler {
  return async (req, res, next) => {
    try {
      if (APP_LOCK_PASSTHROUGH.some((re) => re.test(req.path))) return next();
      const me = req.user as unknown as User | undefined;
      if (!me) return next();
      const lock = appLockOf(req, res);
      const at = lock?.lockedAt() ?? null;
      if (!lock || at == null) return next();
      if (appLockExpired(at)) {
        // The lock outlived the idle window: this session is over, whatever
        // traffic kept rolling its cookie. The route then sees a signed-out
        // request (401, or { authenticated:false } from the probe).
        await lock.end();
        void appendAudit({
          organizationId: me.organizationId,
          userId: me.id,
          action: "auth.lock_expired",
          resourceType: "user",
          resourceId: me.id,
          details: { lockedForMs: Date.now() - at },
          riskLevel: "low",
        });
        return next();
      }
      if (isAppLockExempt(req.path)) return next();
      return res.status(423).json({ error: "session_locked" });
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
const DUMMY_PARSED = parseStoredHash(DUMMY_HASH)!;

/** Relative scrypt work (N·r·p): what one derivation costs in time. */
function scryptWork(params: ScryptParams): number {
  return 2 ** params.ln * params.r * params.p;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  // An unparsable stored value still costs one scrypt (against the dummy) so a
  // malformed row cannot be told apart from a wrong password by timing.
  const parsed = parseStoredHash(stored) ?? DUMMY_PARSED;
  const derivation = deriveKey(password, parsed.saltHex, parsed.params);
  // A credential stored under CHEAPER parameters than today's (a legacy row not
  // yet upgraded: N=2^14 p=1 is ~1/6 of the work) would be rejected sooner
  // than the dummy comparison an unknown account gets, singling out existing
  // accounts by timing. Run one current-cost derivation alongside it on the
  // libuv pool; the answer waits for both, so its latency is the larger of
  // the two — the same as every other path. Its result is never used.
  const pad =
    scryptWork(parsed.params) < scryptWork(SCRYPT_PARAMS)
      ? deriveKey(password, DUMMY_PARSED.saltHex, SCRYPT_PARAMS)
      : null;
  const [derived] = await Promise.all([derivation, pad]);
  const known = Buffer.from(parsed.keyHex, "hex");
  if (known.length !== derived.length) return false;
  return timingSafeEqual(known, derived);
}

/**
 * The one credential check behind every password sign-in (POST /api/login via
 * Passport, and the demo console's token mint). Constant-cost by construction:
 * an unknown org still performs the user lookup (against an impossible org id)
 * and an unknown user still performs one current-cost scrypt (against
 * DUMMY_HASH), so neither "does this org exist" nor "does this user exist" is
 * readable from the response time. Every miss is the same `null`; callers
 * answer one generic invalid_credentials.
 */
export async function authenticateCredentials(
  orgCode: string,
  username: string,
  password: string,
): Promise<User | null> {
  const org = await storage().getOrganizationByCode(orgCode);
  const user = await storage().getUserByUsername(org?.id ?? -1, username);
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return null;
  // Deactivated workforce member: a correct password still fails, with the
  // same generic answer (never confirm the account exists) — but the attempt
  // is audited at high risk so the org can see a leaver trying.
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
    return null;
  }
  // Transparent work-factor upgrade: a credential stored under the legacy
  // parameters is re-hashed now that we hold the plaintext. Not a password
  // CHANGE — passwordChangedAt is untouched, so no session is invalidated. A
  // failure here never fails the sign-in.
  if (needsRehash(user.passwordHash)) {
    try {
      await storage().updateUser(user.id, { passwordHash: await hashPassword(password) });
    } catch (err) {
      console.error("[auth] password re-hash failed", err);
    }
  }
  return user;
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

/* ── Borrowed sessions (developer impersonation / managed-org portal) ────────
 * POST /api/dev/impersonate and /api/dev/manage-org sign the session in AS
 * another account and remember the developer in session.impersonatorId, so
 * /api/dev/impersonate/stop can swap back without a password. Such a session
 * is the developer's as much as the borrowed account's, so it is bound to the
 * DEVELOPER's password generation too (session.impersonatorPg, recorded at
 * entry): when the developer's password is changed or reset, or the developer
 * is deactivated (or is no longer a developer), every borrowed session they
 * opened is over — on its next HTTP request (deserializeUser), at the socket
 * upgrade (server/ws) and at the way back — and its live sockets are closed
 * through the revoker below. Otherwise a portal entered with the OLD password
 * kept reading the tenant's PHI, and "stop" then turned it into a full
 * developer session stamped with the NEW generation (req.login re-serialises
 * the fresh row).
 */
export function beginImpersonation(
  session: Request["session"],
  developer: { id: number; passwordChangedAt?: Date | string | null },
): void {
  session.impersonatorId = developer.id;
  session.impersonatorPg = passwordGeneration(developer);
}

export function clearImpersonation(session: Request["session"] | undefined): void {
  if (!session) return;
  delete session.impersonatorId;
  delete session.impersonatorPg;
}

export type ImpersonationRevokedReason =
  | "unbound_session"
  | "account_missing"
  | "account_disabled"
  | "not_developer"
  | "password_changed";

export type Impersonation =
  | { state: "none" }
  /** The session is borrowed, but the developer behind it no longer holds (password, account, role). */
  | { state: "revoked"; impersonatorId: number | null; reason: ImpersonationRevokedReason }
  | { state: "ok"; developer: User };

export async function resolveImpersonator(
  session: Pick<NonNullable<Request["session"]>, "impersonatorId" | "impersonatorPg"> | undefined | null,
): Promise<Impersonation> {
  const id = session?.impersonatorId as unknown;
  if (!session || id === undefined || id === null) return { state: "none" };
  const pg = session.impersonatorPg as unknown;
  const impersonatorId = typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
  // A borrowed session written before the generation was recorded cannot be
  // checked, so it is not honoured: the developer simply signs in again.
  if (impersonatorId === null || typeof pg !== "number" || !Number.isFinite(pg)) {
    return { state: "revoked", impersonatorId, reason: "unbound_session" };
  }
  const developer = await resolveSessionUser({ id: impersonatorId, pg });
  if (developer && developer.role === "developer") return { state: "ok", developer };
  const row = developer ?? (await storage().getUserById(impersonatorId));
  const reason: ImpersonationRevokedReason = !row
    ? "account_missing"
    : row.disabledAt
      ? "account_disabled"
      : row.role !== "developer"
        ? "not_developer"
        : "password_changed";
  return { state: "revoked", impersonatorId, reason };
}

/**
 * File the end of a borrowed session in the borrowed account's org (where the
 * portal was acting), naming the developer as the actor. Never throws.
 */
export async function auditRevokedImpersonation(
  borrowed: { id: number; organizationId: number },
  revoked: Extract<Impersonation, { state: "revoked" }>,
): Promise<void> {
  await appendAudit({
    organizationId: borrowed.organizationId,
    // A deleted developer row can no longer be referenced (users FK); the id
    // is still on the record in details.
    userId: revoked.reason === "account_missing" ? null : revoked.impersonatorId,
    action: "dev.impersonation_revoked",
    resourceType: "user",
    resourceId: borrowed.id,
    details: { reason: revoked.reason, developerId: revoked.impersonatorId },
    riskLevel: "high",
  });
}

/* ── Session revocation (live transports) ─────────────────────────────────── */
export interface SessionRevocation {
  /**
   * The user whose sessions end: their own sessions AND every borrowed
   * (impersonated / managed-org) session they opened as a developer.
   */
  userId: number;
  /** The session performing the change keeps its own live connections. */
  exceptSessionId?: string;
  reason: "password_changed" | "password_reset" | "account_deactivated";
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
 * A deactivation is immediate: HTTP sessions (the user's own and any borrowed
 * session they opened as a developer) stop resolving on their next request
 * because the row carries disabled_at; this ends the live transports now —
 * the user's sockets, their demo tokens, and the sockets of every
 * impersonated / managed-org portal they are inside — instead of leaving them
 * open until the next reconnect.
 */
export function endSessionsOfDeactivatedUser(userId: number): void {
  revokeSessions({ userId, reason: "account_deactivated" });
}

/**
 * Persist a new credential and end every OTHER session of that user: the row's
 * password generation moves (so stale sessions stop resolving) and the live
 * transports are told to drop the user's sockets. `keepSessionId` is the
 * session performing a self-service change, which stays signed in. A
 * developer's borrowed (impersonated / managed-org) sessions end too: they
 * were entered under the old generation (resolveImpersonator), and their
 * sockets carry the developer as impersonator, which the hub closes as well.
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

/* ── Bearer credentials ──────────────────────────────────────────────────────
 * A request can be authenticated by something other than the cookie session:
 * today the demo console's bearer token (server/demoAuth.ts), which overrides
 * the cookie for that request. Such a credential obeys the SAME generation
 * rule (it is bound to { id, pg } at issue and resolved through
 * resolveSessionUser), and its middleware describes it on
 * res.locals.bearerCredential so the password-change route can treat it as
 * "the session making the change": keep its live connections and re-bind it
 * to the new generation — instead of re-stamping the cookie session, which on
 * that request may belong to a different user altogether.
 */
export interface BearerCredential {
  /** What its live sockets carry as their session id (WS ClientMeta.sessionId). */
  connectionId: string;
  /** Re-bind this credential to the user's new password generation. */
  restamp(user: User): void;
  /** App lock (A.CON-SHO-7): when this credential was locked, or null. */
  lockedAt?(): number | null;
  /** Lock this credential (an existing lock is never moved later). */
  lock?(at: number): void;
  /** Revoke this credential (its lock outlived the idle window). */
  end?(): void;
}

export function bearerCredentialOf(res: Response): BearerCredential | undefined {
  const c = (res.locals as { bearerCredential?: BearerCredential }).bearerCredential;
  return c && typeof c.connectionId === "string" && typeof c.restamp === "function" ? c : undefined;
}

/**
 * After a self-service password change the CURRENT session must carry the new
 * generation or it would be rejected on its next request like the others.
 * Only a cookie session that is signed in AS THIS USER is re-stamped: a
 * bearer-token request has no passport entry of its own, and the cookie that
 * happens to ride along with it may be someone else's.
 */
function restampSession(req: Request, user: User): Promise<void> {
  return new Promise((resolve, reject) => {
    const sess = req.session as (typeof req.session & { passport?: { user?: unknown } }) | undefined;
    if (!sess?.passport || sess.passport.user === undefined) return resolve();
    if (parseSessionPrincipal(sess.passport.user)?.id !== user.id) return resolve();
    sess.passport = { ...sess.passport, user: sessionPrincipalFor(user) };
    sess.save((err) => (err ? reject(err) : resolve()));
  });
}

/* ── Pending MFA sign-in ─────────────────────────────────────────────────────
 * Between the password step (202 twoFactorRequired) and the second factor the
 * session holds a half-finished login. It is bound to the password generation
 * the password step was checked against, so a password change or reset in
 * between voids it: a second factor can then no longer turn a login begun
 * with the OLD password into a full session (req.login would otherwise stamp
 * the NEW generation and the session would look perfectly valid).
 */
export function beginPendingMfa(
  session: Request["session"],
  user: { id: number; passwordChangedAt?: Date | string | null },
): void {
  session.pendingMfaUserId = user.id;
  session.pendingMfaPg = passwordGeneration(user);
}

export function clearPendingMfa(session: Request["session"]): void {
  delete session.pendingMfaUserId;
  delete session.pendingMfaPg;
}

export type PendingMfa =
  | { state: "none" }
  /** There was a pending login, but its password generation (or the account) is no longer valid. Already cleared. */
  | { state: "revoked"; userId: number; user: User | undefined }
  | { state: "ok"; user: User };

export async function resolvePendingMfa(session: Request["session"] | undefined): Promise<PendingMfa> {
  const id = session?.pendingMfaUserId;
  if (!session || typeof id !== "number") return { state: "none" };
  const pg = session.pendingMfaPg;
  // A pending login written before the generation was recorded cannot be
  // checked, so it is not honoured: the user simply signs in again.
  const user = typeof pg === "number" ? await resolveSessionUser({ id, pg }) : null;
  if (user) return { state: "ok", user };
  clearPendingMfa(session);
  return { state: "revoked", userId: id, user: await storage().getUserById(id) };
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
          const user = await authenticateCredentials(String(req.body.orgCode ?? ""), username, password);
          if (!user) return done(null, false, { message: "invalid_credentials" });
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

  // Arity 3: Passport hands in the request, so a borrowed session is checked
  // against the DEVELOPER behind it as well as the account it is signed in as.
  passport.deserializeUser(async (req: Request, raw: unknown, done: (err: unknown, user?: Express.User | false) => void) => {
    try {
      const user = await resolveSessionUser(raw);
      if (!user) {
        // Signed out; a borrowed session's way back to the developer goes with it.
        clearImpersonation(req.session);
        return done(null, false);
      }
      const imp = await resolveImpersonator(req.session);
      if (imp.state === "revoked") {
        // The developer who entered this portal changed or lost their
        // password, was deactivated or is no longer a developer: the whole
        // session is over — neither the borrowed account nor (via
        // /api/dev/impersonate/stop) the developer.
        clearImpersonation(req.session);
        await auditRevokedImpersonation(user, imp);
        return done(null, false);
      }
      done(null, user as unknown as Express.User);
    } catch (err) {
      done(err as Error);
    }
  });
}

/** Is this the platform/operator tenant? Compared on the RESOLVED org (lookups are case-insensitive). */
export function isPlatformOrg(org: { code: string }): boolean {
  return org.code.toUpperCase() === PLATFORM_ORG_CODE;
}

/**
 * Opaque key of an unrouted registration (unknown org or the platform org):
 * SHA-256 of the org code — upper-cased exactly like the org lookup — and the
 * username. Only this is stored, never the code, the name or a credential; it
 * exists so a re-submission answers 409 like a real org's would.
 */
export function unroutedRegistrationKey(orgCode: string, username: string): string {
  return createHash("sha256")
    .update(`docturn.unrouted-registration\u0000${orgCode.toUpperCase()}\u0000${usernameKey(username)}`)
    .digest("hex");
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
  // The app lock goes first: a locked session gets 423 on everything but the
  // identity / sign-in routes, before any other gate looks at it.
  app.use("/api", appLockGate());
  app.use("/api", mfaEnrollmentGate());
  app.use("/api", passwordChangeGate());

  // Lock this session (A.CON-SHO-7). Idempotent; never moves an existing
  // lock later. `idleMs` (optional) back-dates the lock by how long the client
  // had already been idle — clamped to [0, idle window], so it can only bring
  // the session's end closer. The session's live sockets are closed.
  app.post(
    "/api/session/lock",
    requireAuth,
    wrap(async (req, res) => {
      const me = req.user as unknown as User;
      const lock = appLockOf(req, res);
      if (!lock) return res.status(401).json({ error: "unauthorized" });
      const rawIdle = Number((req.body ?? {}).idleMs);
      const idleMs = Number.isFinite(rawIdle) ? Math.min(Math.max(rawIdle, 0), SESSION_POLICY.maxAgeMs) : 0;
      const wasLocked = lock.lockedAt() != null;
      await lock.lock(Date.now() - idleMs);
      if (lock.connectionId) announceSessionLocked({ userId: me.id, connectionId: lock.connectionId });
      if (!wasLocked) {
        void appendAudit({
          organizationId: me.organizationId,
          userId: me.id,
          action: "auth.lock",
          resourceType: "user",
          resourceId: me.id,
          details: idleMs > 0 ? { idleMs } : {},
          riskLevel: "low",
        });
      }
      return res.json({ locked: true });
    }),
  );

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
  // Disclosure policy (mirrors /api/login, which answers one generic 401 at
  // one cost): an anonymous caller learns NOTHING about which org codes or
  // usernames exist.
  //   • ORG: an unknown org code and the platform/operator org DOCTURN (any
  //     casing) are "unrouted": the request is dropped — nothing reaches any
  //     director's or the operator's queue, and no credential is kept — but the
  //     answer is the same 201 { pending: true } a real org gives, after the
  //     same work (one password hash). A re-submission of the same
  //     (org code, username) answers 409 request_pending exactly like a real
  //     org's, because an opaque SHA-256 key of the pair is remembered in
  //     unrouted_registrations. The drop is audit-logged on the platform org
  //     (auth.register_unrouted, low risk) so the operator can see probing.
  //     The cost of this: a mistyped org code is not pointed out — the form
  //     says the request goes to a director only "if the code is right".
  //   • USERNAME: a request for a taken name is accepted (201) exactly like a
  //     fresh one and lands in the director's queue flagged `usernameTaken`,
  //     where approving it is refused (409) and denying it clears it. No user
  //     lookup happens on this path, so timing is uniform too;
  //   • a re-submission for a name that is already PENDING answers 409
  //     request_pending whether or not the account (or the org) exists, so the
  //     pair (first → 201, again → 409) reveals nothing either.
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
      // Usernames are stored trimmed and compared case-insensitively
      // (server/usernames.ts) — "Chen " is a request for "chen".
      const username = normalizeUsername(parsed.data.username);
      if (username.length < 3) return res.status(400).json({ error: "validation_error" });
      const org = await storage().getOrganizationByCode(parsed.data.orgCode);
      if (!org || isPlatformOrg(org)) {
        // Unrouted (see the policy above): same answers, same cost, nothing queued.
        const claimed = await storage().claimUnroutedRegistration(
          unroutedRegistrationKey(parsed.data.orgCode, username),
        );
        if (!claimed) return res.status(409).json({ error: "request_pending" });
        await hashPassword(parsed.data.password); // cost parity with a routed request; discarded
        const platform = org ?? (await storage().getOrganizationByCode(PLATFORM_ORG_CODE));
        if (platform) {
          await appendAudit({
            organizationId: platform.id,
            userId: null,
            action: "auth.register_unrouted",
            resourceType: "user",
            resourceId: null,
            details: {
              reason: org ? "platform_org" : "unknown_org",
              orgCode: parsed.data.orgCode.slice(0, 64),
              username: username.slice(0, 64),
              requestedRole: parsed.data.requestedRole ?? "hospitalist",
            },
            riskLevel: "low",
          });
        }
        return res.status(201).json({ pending: true });
      }
      const pending = (await storage().listPendingRegistrations(org.id)).find(
        (r) => usernameKey(r.username) === usernameKey(username),
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
      // Compared like sign-in compares: case- and whitespace-insensitively.
      const taken = new Set((await storage().listUsers(me.organizationId)).map((u) => usernameKey(u.username)));
      // Never expose credential hashes to the approval UI.
      res.json(
        rows.map(({ passwordHash: _ph, ...rest }) => ({
          ...rest,
          usernameTaken: taken.has(usernameKey(rest.username)),
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
        // MFA gate: if enabled, hold the session pending a second factor —
        // bound to the password generation just verified.
        if (user.twoFactorEnabled) {
          beginPendingMfa(req.session, user);
          return res.status(202).json({ twoFactorRequired: true });
        }
        // Re-authenticating a locked session (the lock screen) — recorded on
        // the login row. req.login regenerates the session, so the new one
        // starts unlocked and the locked one is gone.
        const unlocking = req.session?.appLock?.userId === user.id;
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
            details: {
              ...(enrolmentRequired ? { mfaEnrollmentRequired: true } : {}),
              ...(unlocking ? { unlock: true } : {}),
            },
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

  // The signed-in user's own record (the same body for GET /api/user and the
  // GET /api/session probe below).
  async function currentUserBody(req: Request, res: Response) {
    const me = req.user as unknown as User;
    // Re-checked from the DB + module map on every call (not the session):
    // the UI polls this to learn the block has lifted after enrolment.
    const required = await mfaEnrollmentRequired(me);
    if (req.session) {
      if (required) req.session.mfaEnrollmentRequired = true;
      else if (req.session.mfaEnrollmentRequired) delete req.session.mfaEnrollmentRequired;
    }
    const body = required ? { ...toSafeUser(me), mfaEnrollmentRequired: true } : toSafeUser(me);
    // A locked session: the client must show its lock screen (not the app),
    // and re-authenticate against this org — even after a reload that lost
    // every browser-side trace of the lock (A.CON-SHO-7).
    if (appLockedAt(req, res) != null) {
      const org = await storage().getOrganization(me.organizationId);
      return { ...body, locked: true as const, orgCode: org?.code ?? null };
    }
    return body;
  }

  app.get("/api/user", async (req, res, next) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      return res.json(await currentUserBody(req, res));
    } catch (err) {
      return next(err);
    }
  });

  // Session probe for an app that is just opening: "is there a session to
  // restore?". Signed out is the normal answer on a fresh device, not an
  // error, so this is 200 either way — GET /api/user's 401 is logged by every
  // browser as "Failed to load resource" on each cold start. Same notion of
  // authenticated as /api/user (a revoked or logged-out session is signed
  // out) and the same user body; /api/user keeps its 401 for the client's
  // dead-session checks. Never cached: it describes who holds this cookie.
  app.get("/api/session", async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.json({ authenticated: false });
    }
    try {
      return res.json({ authenticated: true, user: await currentUserBody(req, res) });
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
      // "This session" is the bearer credential when one authenticated the
      // request (it overrides the cookie), otherwise the cookie session.
      const bearerCred = bearerCredentialOf(res);
      const updated = await rotatePassword(me.id, next, {
        mustChangePassword: false,
        keepSessionId: bearerCred ? bearerCred.connectionId : req.sessionID,
        reason: "password_changed",
      });
      if (bearerCred) bearerCred.restamp(updated ?? fresh);
      else await restampSession(req, updated ?? fresh);
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
    /** Password generation the pending MFA login's password step was checked against. */
    pendingMfaPg?: number;
    /** Privileged user signed in without MFA while the org requires it. */
    mfaEnrollmentRequired?: boolean;
    /** Developer who entered an impersonated / managed-org portal (dev.ts). */
    impersonatorId?: number;
    /** That developer's password generation at entry (beginImpersonation / resolveImpersonator). */
    impersonatorPg?: number;
    /** App lock (A.CON-SHO-7): who locked this session and when the lock counts from. */
    appLock?: { userId: number; at: number };
  }
}

export const _testHelpers = { scryptAsync } as { scryptAsync: typeof scryptAsync };
export type { RequestHandler };
