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
import { appendAudit } from "./audit.js";
import { getModules } from "./modules.js";

const scryptAsync = promisify(scrypt);

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

/** scrypt with a per-user random salt, stored as `hash.salt` (both hex). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${derived.toString("hex")}.${salt}`;
}

/** Human-readable description of what {@link hashPassword} produces. */
export const PASSWORD_HASH_FORMAT =
  "scrypt N=16384 r=8 p=1, 64-byte key + 16-byte random salt, stored as <128 hex>.<32 hex>";

/**
 * Does a stored credential match the shape {@link hashPassword} emits? Used by
 * the compliance monitor to prove no user row holds a plaintext or legacy
 * credential. Deliberately format-only: it never derives, logs or returns the
 * secret material it inspects.
 */
export function isValidPasswordHashFormat(stored: unknown): boolean {
  if (typeof stored !== "string") return false;
  const parts = stored.split(".");
  if (parts.length !== 2) return false;
  const [hashed, salt] = parts;
  // 64-byte derived key and 16-byte salt, both hex.
  return /^[0-9a-f]{128}$/.test(hashed!) && /^[0-9a-f]{32}$/.test(salt!);
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
          if (!org) return done(null, false, { message: "invalid_org" });
          const user = await storage().getUserByUsername(org.id, username);
          if (!user) return done(null, false, { message: "invalid_credentials" });
          const ok = await verifyPassword(password, user.passwordHash);
          if (!ok) return done(null, false, { message: "invalid_credentials" });
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
  // Privileged-role MFA enrolment gate. Mounted here, before every /api route
  // that follows (registerRoutes calls this second, right after /api/health).
  app.use("/api", mfaEnrollmentGate());

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
      const rows = await storage().listPendingRegistrations(me.organizationId);
      // Never expose credential hashes to the approval UI.
      res.json(rows.map(({ passwordHash: _ph, ...rest }) => rest));
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
  app.patch("/api/account/password", requireAuth, async (req, res) => {
    const me = req.user as unknown as User;
    const current = String((req.body || {}).currentPassword || "");
    const next = String((req.body || {}).newPassword || "");
    if (next.length < 8) return res.status(400).json({ error: "weak_password" });
    const fresh = await storage().getUserById(me.id);
    if (!fresh) return res.status(404).json({ error: "not_found" });
    const ok = await verifyPassword(current, fresh.passwordHash);
    if (!ok) return res.status(403).json({ error: "wrong_password" });
    await storage().updateUser(me.id, { passwordHash: await hashPassword(next) });
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "auth.password_change",
      resourceType: "user",
      resourceId: me.id,
      details: {},
      riskLevel: "medium",
    });
    res.json({ ok: true });
  });
}

// Imported here to avoid a cycle at module top in some bundlers.
import { isPrivilegedRole, requireAuth, requireRole } from "./rbac.js";

declare module "express-session" {
  interface SessionData {
    pendingMfaUserId?: number;
    /** Privileged user signed in without MFA while the org requires it. */
    mfaEnrollmentRequired?: boolean;
  }
}

export const _testHelpers = { scryptAsync } as { scryptAsync: typeof scryptAsync };
export type { RequestHandler };
