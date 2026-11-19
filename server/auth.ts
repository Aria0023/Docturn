import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Express, RequestHandler } from "express";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import {
  loginSchema,
  registerSchema,
  toSafeUser,
  type User,
} from "@shared/schema";
import { storage } from "./storage.js";
import { appendAudit, logSecurityIncident } from "./audit.js";
import { notificationDeps } from "./services/notifications.js";

const scryptAsync = promisify(scrypt);

/** scrypt with a per-user random salt, stored as `hash.salt` (both hex). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${derived.toString("hex")}.${salt}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [hashed, salt] = stored.split(".");
  if (!hashed || !salt) return false;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const known = Buffer.from(hashed, "hex");
  if (known.length !== derived.length) return false;
  return timingSafeEqual(known, derived);
}

/**
 * Account lockout (in-memory, per org + username): after MAX_FAILED_LOGINS
 * consecutive failures the account refuses logins for LOCKOUT_MS, so a password
 * can't be guessed from many source IPs under the per-IP rate limit.
 */
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const failedLogins = new Map<string, { count: number; lockedUntil: number }>();

function lockKey(orgId: number, username: string) {
  return `${orgId}:${username}`;
}
function isLocked(key: string): boolean {
  const entry = failedLogins.get(key);
  if (!entry) return false;
  if (entry.lockedUntil && entry.lockedUntil <= Date.now()) {
    failedLogins.delete(key);
    return false;
  }
  return entry.lockedUntil > 0;
}
/** Record a failure; returns true when this one triggered the lock. */
function recordFailedLogin(key: string): boolean {
  const entry = failedLogins.get(key) ?? { count: 0, lockedUntil: 0 };
  entry.count++;
  const locked = entry.count >= MAX_FAILED_LOGINS;
  if (locked) entry.lockedUntil = Date.now() + LOCKOUT_MS;
  failedLogins.set(key, entry);
  return locked;
}
export function _resetLoginThrottle() {
  failedLogins.clear();
}

// Verified against when the username doesn't exist, so a miss costs the same
// scrypt work as a wrong password and response time doesn't reveal accounts.
let dummyHash: Promise<string> | null = null;
function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash.then((h) => verifyPassword(password, h));
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
    }
  }
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
          if (!org) {
            await burnPasswordCheck(password);
            return done(null, false, { message: "invalid_org" });
          }
          const key = lockKey(org.id, username);
          if (isLocked(key)) {
            return done(null, false, { message: "account_locked" });
          }
          const user = await storage().getUserByUsername(org.id, username);
          const ok = user
            ? await verifyPassword(password, user.passwordHash)
            : await burnPasswordCheck(password).then(() => false);
          if (!user || !ok) {
            const nowLocked = recordFailedLogin(key);
            await appendAudit({
              organizationId: org.id,
              userId: user?.id ?? null,
              action: "auth.login_failed",
              resourceType: "user",
              resourceId: user?.id ?? null,
              details: { username: username.slice(0, 64) },
              riskLevel: "medium",
            });
            if (nowLocked) {
              await logSecurityIncident({
                organizationId: org.id,
                userId: user?.id,
                type: "account_locked",
                severity: "high",
                description: `${MAX_FAILED_LOGINS} consecutive failed logins for "${username.slice(0, 64)}"`,
              });
            }
            return done(null, false, { message: "invalid_credentials" });
          }
          failedLogins.delete(key);
          return done(null, user as unknown as Express.User);
        } catch (err) {
          return done(err as Error);
        }
      },
    ),
  );

  passport.serializeUser((user, done) => {
    done(null, (user as unknown as User).id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage().getUserById(id);
      done(null, (user ?? false) as unknown as Express.User);
    } catch (err) {
      done(err as Error);
    }
  });
}

/** Registers the auth routes onto the app. */
export function registerAuthRoutes(app: Express) {
  // Self-registration → pending (a director approves). We model the pending
  // gate minimally here: a registration creates no active user yet.
  app.post("/api/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error" });
    }
    const org = await storage().getOrganizationByCode(parsed.data.orgCode);
    if (!org) return res.status(404).json({ error: "organization_not_found" });
    const existing = await storage().getUserByUsername(
      org.id,
      parsed.data.username,
    );
    if (existing) return res.status(409).json({ error: "username_taken" });
    await storage().createPendingRegistration({
      organizationId: org.id,
      username: parsed.data.username,
      passwordHash: await hashPassword(parsed.data.password),
      displayName: parsed.data.displayName,
      requestedRole: parsed.data.requestedRole ?? "hospitalist",
      status: "pending",
    });
    await appendAudit({
      organizationId: org.id,
      userId: null,
      action: "auth.register_request",
      resourceType: "user",
      resourceId: null,
      details: { username: parsed.data.username },
      riskLevel: "low",
    });
    // Self-registration requires a director's sign-off before it becomes a user.
    return res.status(201).json({ pending: true });
  });

  // Approval queue — directors AND ER directors (and developers) can review.
  app.get(
    "/api/registrations",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    async (req, res) => {
      const me = req.user as unknown as User;
      res.json(await storage().listPendingRegistrations(me.organizationId));
    },
  );

  app.post(
    "/api/registrations/:id/approve",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    async (req, res) => {
      const me = req.user as unknown as User;
      const id = Number(req.params.id);
      const reg = await storage().getPendingRegistration(me.organizationId, id);
      if (!reg || reg.status !== "pending") {
        return res.status(404).json({ error: "not_found" });
      }
      // An ER director may not mint an account at or above their own level.
      if (
        me.role === "er_director" &&
        (reg.requestedRole === "director" || reg.requestedRole === "er_director")
      ) {
        return res.status(403).json({ error: "forbidden" });
      }
      // The name can be taken between request and approval (or requested twice).
      if (await storage().getUserByUsername(reg.organizationId, reg.username)) {
        return res.status(409).json({ error: "username_taken" });
      }
      const user = await storage().createUser({
        organizationId: reg.organizationId,
        username: reg.username,
        passwordHash: reg.passwordHash,
        role: reg.requestedRole,
        displayName: reg.displayName,
        credential: null,
        phone: null,
        twoFactorEnabled: false,
      });
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
    },
  );

  app.post(
    "/api/registrations/:id/deny",
    requireAuth,
    requireRole("director", "er_director", "developer"),
    async (req, res) => {
      const me = req.user as unknown as User;
      const id = Number(req.params.id);
      const reg = await storage().getPendingRegistration(me.organizationId, id);
      if (!reg || reg.status !== "pending") {
        return res.status(404).json({ error: "not_found" });
      }
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
    },
  );

  app.post("/api/login", (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_error" });
    }
    passport.authenticate(
      "local",
      (err: Error | null, user: User | false, info?: { message?: string }) => {
        if (err) return next(err);
        if (!user) {
          if (info?.message === "account_locked") {
            return res.status(429).json({ error: "account_locked" });
          }
          return res.status(401).json({ error: "invalid_credentials" });
        }
        // MFA gate: if enabled, hold the session pending a second factor.
        if (user.twoFactorEnabled) {
          req.session.pendingMfaUserId = user.id;
          req.session.mfaAttempts = 0;
          return res.status(202).json({ twoFactorRequired: true });
        }
        req.login(user as unknown as Express.User, (loginErr) => {
          if (loginErr) return next(loginErr);
          void appendAudit({
            organizationId: user.organizationId,
            userId: user.id,
            action: "auth.login",
            resourceType: "user",
            resourceId: user.id,
            details: {},
            riskLevel: "low",
          });
          return res.status(200).json(toSafeUser(user));
        });
      },
    )(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    const me = req.user as unknown as User | undefined;
    const sessionId = req.sessionID;
    req.logout((err) => {
      if (err) return next(err);
      if (me) {
        void appendAudit({
          organizationId: me.organizationId,
          userId: me.id,
          action: "auth.logout",
          resourceType: "user",
          resourceId: me.id,
          details: {},
          riskLevel: "low",
        });
      }
      // Signing out must also drop this session's live sockets, or the browser
      // tab keeps receiving the tenant's realtime feed after logout.
      notificationDeps().ws.disconnectSession?.(sessionId);
      req.session.destroy(() => res.status(204).end());
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: "unauthorized" });
    }
    return res.json(toSafeUser(req.user as unknown as User));
  });

  app.get("/api/users", requireAuth, requireRole("director", "developer"), async (req, res) => {
    const me = req.user as unknown as User;
    const list = await storage().listUsers(me.organizationId);
    res.json(list.map(toSafeUser));
  });
}

// Imported here to avoid a cycle at module top in some bundlers.
import { requireAuth, requireRole } from "./rbac.js";

declare module "express-session" {
  interface SessionData {
    pendingMfaUserId?: number;
    /** Failed second-factor attempts for the pending login. */
    mfaAttempts?: number;
    /** Set while a developer is acting as a tenant user (audited on every row). */
    impersonatorId?: number;
  }
}

export const _testHelpers = { scryptAsync } as { scryptAsync: typeof scryptAsync };
export type { RequestHandler };
