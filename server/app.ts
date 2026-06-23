import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from "express";
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
 * use the app directly). The configured session middleware is stashed on
 * `app.locals.sessionMiddleware` so the WebSocket server can authenticate the
 * upgrade request against the SAME session store.
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

  const sessionMiddleware: RequestHandler = session({
    name: "docturn.sid",
    secret,
    resave: false,
    saveUninitialized: false,
    store,
    rolling: true, // 15-minute rolling, inactivity expiry.
    cookie: {
      httpOnly: true,
      // "lax" (not "strict") so the session cookie reliably sticks when the app
      // is reached from another device / through a tunnel (strict can drop the
      // cookie in some navigation contexts, e.g. mobile Safari). Still safe: the
      // API is same-origin and CSRF surface is minimal for this app.
      sameSite: "lax",
      secure: isProd,
      maxAge: 15 * 60 * 1000,
    },
  });
  app.locals.sessionMiddleware = sessionMiddleware;

  app.use(sessionMiddleware);

  configurePassport();
  app.use(passport.initialize());
  app.use(passport.session());

  // Rate limiting is on by default; set RATE_LIMIT=off to disable (useful for
  // local dev, the headless UI smoke test, and load testing).
  if (opts.rateLimiting !== false && process.env.RATE_LIMIT !== "off") {
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

  // Serve the designer's ORIGINAL UI kit verbatim — the exact clinical web app
  // from design/ui_kits/web-app (its own components, store.js, tokens, assets).
  // This guarantees pixel- and behavior-identical fidelity to the delivered
  // design. API/WS routes are registered above and win. The earlier hand-built
  // React client still lives in client/ and builds to client/dist if needed.
  // webapp/ is the designer's kit served verbatim PLUS api-bridge.js, which
  // wires its actions/data to the live backend. Falls back to the pristine kit,
  // then the built React client.
  // Resolve the wired kit whether we run from source (tsx) or compiled (dist):
  // try paths relative to this module AND relative to the project cwd.
  const wiredKit = fileURLToPath(new URL("../webapp", import.meta.url));
  const candidates = [
    wiredKit,
    join(process.cwd(), "webapp"),
    fileURLToPath(new URL("../design/ui_kits/web-app", import.meta.url)),
    join(process.cwd(), "design/ui_kits/web-app"),
    fileURLToPath(new URL("../client/dist", import.meta.url)),
    join(process.cwd(), "client/dist"),
  ];
  const uiDir = candidates.find((d) => existsSync(d)) || wiredKit;
  if (existsSync(uiDir)) {
    // No-cache for the kit: it's plain <script> files with no content hashing,
    // so a browser that caches api-bridge.js/*.jsx would keep running stale
    // client code after a pull. Always revalidate (dev tool; assets are local).
    app.use(
      express.static(uiDir, {
        etag: true,
        lastModified: true,
        setHeaders: (res) => {
          res.setHeader("Cache-Control", "no-cache, must-revalidate");
        },
      }),
    );
    app.get(/^(?!\/api|\/ws).*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      res.sendFile(join(uiDir, "index.html"));
    });
  }

  // Consistent error shape.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[error]", err);
    if (res.headersSent) return;
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
