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
      requestedRole: "hospitalist",
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

  // Director-approval queue.
  app.get(
    "/api/registrations",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = req.user as unknown as User;
      res.json(await storage().listPendingRegistrations(me.organizationId));
    },
  );

  app.post(
    "/api/registrations/:id/approve",
    requireAuth,
    requireRole("director", "developer"),
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
      await storage().updatePendingRegistration(me.organizationId, id, {
        status: "approved",
      });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "registration.approve",
        resourceType: "user",
        resourceId: user.id,
        details: { username: reg.username },
        riskLevel: "medium",
      });
      res.status(201).json({ userId: user.id });
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
    req.logout((err) => {
      if (err) return next(err);
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
  }
}

export const _testHelpers = { scryptAsync } as { scryptAsync: typeof scryptAsync };
export type { RequestHandler };
