import type { Express, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import { userStore, orgStore, auditStore } from './storage.js';
import { sanitizeUser, type Role } from '../shared/schema.js';
import { SqliteSessionStore } from './session-store.js';

export const BCRYPT_ROUNDS = 12;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}
export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface User {
      id: number;
      orgId: number;
      role: Role;
      username: string;
      fullName: string;
    }
  }
}

export function configureAuth(app: Express) {
  passport.use(
    new LocalStrategy({ usernameField: 'username', passwordField: 'password' }, async (username, password, done) => {
      try {
        const user = await userStore.getByUsername(username);
        if (!user || !user.active) return done(null, false);
        if (!verifyPassword(password, user.passwordHash)) return done(null, false);
        return done(null, {
          id: user.id,
          orgId: user.orgId,
          role: user.role as Role,
          username: user.username,
          fullName: user.fullName,
        });
      } catch (err) {
        return done(err as Error);
      }
    }),
  );

  passport.serializeUser((user: Express.User, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await userStore.getById(id);
      if (!user) return done(null, false);
      done(null, {
        id: user.id,
        orgId: user.orgId,
        role: user.role as Role,
        username: user.username,
        fullName: user.fullName,
      });
    } catch (err) {
      done(err as Error);
    }
  });

  app.use(
    session({
      store: new SqliteSessionStore(),
      secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 1000 * 60 * 60 * 12,
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'developer') return next();
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    return next();
  };
}

/**
 * Ensures the acting user belongs to the same org as `targetOrgId`.
 * Developers bypass and the bypass is audited.
 */
export async function assertSameOrg(req: Request, targetOrgId: number): Promise<void> {
  if (!req.user) {
    const e: any = new Error('Unauthorized');
    e.status = 401;
    throw e;
  }
  if (req.user.role === 'developer') {
    if (req.user.orgId !== targetOrgId) {
      await auditStore.log({
        orgId: targetOrgId,
        userId: req.user.id,
        action: 'developer_cross_org_access',
        targetType: 'organization',
        targetId: targetOrgId,
        detail: `Developer ${req.user.username} accessed org ${targetOrgId}`,
      });
    }
    return;
  }
  if (req.user.orgId !== targetOrgId) {
    const e: any = new Error('Forbidden');
    e.status = 403;
    throw e;
  }
}

export { passport, sanitizeUser, orgStore };
