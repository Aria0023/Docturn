import { randomBytes } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import passport from "passport";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import createMemoryStore from "memorystore";
import { configurePassport } from "./auth.js";
import { registerRoutes } from "./routes/index.js";

export interface CreateAppOptions {
  sessionSecret?: string;
  /** When false (tests), disable rate limiting for determinism. */
  rateLimiting?: boolean;
  trustProxy?: boolean;
}

/**
 * Build the Express app: security middleware, session, Passport, routes, and a
 * consistent JSON error shape. Listening is the caller's job (so Supertest can
 * use the app directly).
 */
export function createApp(opts: CreateAppOptions = {}): Express {
  const app = express();
  const isProd = process.env.NODE_ENV === "production";

  if (opts.trustProxy) app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: false, // SPA served separately; relax for dev.
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  // Session store: real Postgres uses connect-pg-simple; otherwise in-memory.
  const MemoryStore = createMemoryStore(session);
  const store = new MemoryStore({ checkPeriod: 86_400_000 });

  const secret =
    opts.sessionSecret ??
    process.env.SESSION_SECRET ??
    randomBytes(32).toString("hex");

  app.use(
    session({
      name: "docturn.sid",
      secret,
      resave: false,
      saveUninitialized: false,
      store,
      rolling: true, // 15-minute rolling, inactivity expiry.
      cookie: {
        httpOnly: true,
        sameSite: "strict",
        secure: isProd,
        maxAge: 15 * 60 * 1000,
      },
    }),
  );

  configurePassport();
  app.use(passport.initialize());
  app.use(passport.session());

  if (opts.rateLimiting !== false) {
    // Tiered limits: stricter on auth, looser on general traffic.
    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 50,
      standardHeaders: true,
      legacyHeaders: false,
    });
    const generalLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    });
    app.use("/api/login", authLimiter);
    app.use("/api/register", authLimiter);
    app.use("/api/2fa", authLimiter);
    app.use("/api", generalLimiter);
  }

  registerRoutes(app);

  // Consistent error shape.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[error]", err);
    if (res.headersSent) return;
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
