import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import session from "express-session";
import passport from "passport";
import rateLimit from "express-rate-limit";
import createMemoryStore from "memorystore";
import { configurePassport, verifyPassword } from "./auth.js";
import {
  AUTH_RATE_LIMIT,
  GENERAL_RATE_LIMIT,
  SESSION_POLICY,
  securityHeaders,
  sessionCookieOptions,
  setRateLimitState,
} from "./config.js";
import { registerRoutes } from "./routes/index.js";
import { demoTokenAuth, issueDemoToken } from "./demoAuth.js";
import { storage } from "./storage.js";
import { toSafeUser } from "@shared/schema";

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

  // Security response headers. The instance lives in server/config.ts so the
  // compliance monitor can probe the SAME middleware for the headers it emits.
  app.use(securityHeaders);
  // Global JSON body parser (1 MB). The attachment-upload route needs a larger
  // limit for base64 file bodies, so it is excluded here and mounts its OWN
  // express.json({ limit: "12mb" }) — otherwise this 1 MB cap would reject the
  // upload before the route-level parser could run.
  const globalJson = express.json({ limit: "1mb" });
  app.use((req, res, next) => {
    if (req.method === "POST" && req.path === "/api/messaging/attachments") {
      return next();
    }
    return globalJson(req, res, next);
  });

  // Session store: real Postgres uses connect-pg-simple; otherwise in-memory.
  const MemoryStore = createMemoryStore(session);
  const store = new MemoryStore({ checkPeriod: 86_400_000 });

  const secret =
    opts.sessionSecret ??
    process.env.SESSION_SECRET ??
    randomBytes(32).toString("hex");

  // Cookie/session posture comes from SESSION_POLICY (server/config.ts) — the
  // same values the `session-timeout` / `session-cookie-flags` controls read.
  const sessionMiddleware: RequestHandler = session({
    name: SESSION_POLICY.name,
    secret,
    resave: false,
    saveUninitialized: false,
    store,
    rolling: SESSION_POLICY.rolling, // maxAge behaves as INACTIVITY expiry.
    cookie: sessionCookieOptions(),
  });
  app.locals.sessionMiddleware = sessionMiddleware;

  app.use(sessionMiddleware);

  configurePassport();
  app.use(passport.initialize());
  app.use(passport.session());
  // Demo-token auth: lets the side-by-side demo console give each pane its own
  // identity without colliding on the shared session cookie. Additive — a
  // request with no token is unaffected.
  app.use(demoTokenAuth());

  // Mint a demo token from valid demo credentials. Non-production only; the
  // 3-up demo console (/demo) calls this once per pane, then loads the real app
  // in an iframe with ?token=<t>. Requires the demo password, like normal login.
  if (!isProd) {
    app.post("/api/demo/login", async (req, res) => {
      // Demo tokens are a synthetic-data affordance: refuse when the operator
      // has deliberately switched the instance to real-PHI mode.
      if (process.env.SYNTHETIC_DATA === "false") {
        return res.status(403).json({ error: "demo_disabled" });
      }
      const { orgCode, username, password } = (req.body ?? {}) as {
        orgCode?: string; username?: string; password?: string;
      };
      try {
        const org = await storage().getOrganizationByCode(String(orgCode ?? ""));
        if (!org) return res.status(401).json({ error: "invalid_org" });
        const user = await storage().getUserByUsername(org.id, String(username ?? ""));
        if (!user || !(await verifyPassword(String(password ?? ""), user.passwordHash))) {
          return res.status(401).json({ error: "invalid_credentials" });
        }
        res.json({ token: issueDemoToken(user.id), user: toSafeUser(user) });
      } catch {
        res.status(500).json({ error: "demo_login_failed" });
      }
    });
  }

  // Rate limiting is on by default; set RATE_LIMIT=off to disable (useful for
  // local dev, the headless UI smoke test, and load testing). Whatever we decide
  // here is RECORDED so the `auth-rate-limit` control reports the limiters this
  // process actually mounted — not what an env var implies.
  const rateLimitDisabledByOption = opts.rateLimiting === false;
  const rateLimitDisabledByEnv = process.env.RATE_LIMIT === "off";
  const rateLimitEnabled = !rateLimitDisabledByOption && !rateLimitDisabledByEnv;
  setRateLimitState({
    enabled: rateLimitEnabled,
    reason: rateLimitEnabled
      ? "enabled"
      : rateLimitDisabledByEnv
        ? "disabled_by_env"
        : "disabled_by_app_option",
  });
  if (rateLimitEnabled) {
    // Tiered limits: stricter on auth, looser on general traffic.
    // Disable the X-Forwarded-For validation: behind a dev tunnel the proxy hop
    // count can differ from `trust proxy`, and a failed validation otherwise
    // throws and 500s the request (breaking login from a phone). We still get
    // correct client IPs via `trust proxy`; this just stops the hard failure.
    const authLimiter = rateLimit({
      ...AUTH_RATE_LIMIT,
      standardHeaders: true,
      legacyHeaders: false,
      // Count only FAILED auth attempts (status >= 400). The control we need is
      // brute-force / credential-stuffing protection (§164.308(a)(5)(ii)(C)),
      // and that is entirely about wrong guesses — a successful sign-in is not
      // an attack. Counting successes too meant ordinary use burned the budget:
      // every role switch costs 1 (or 2, since a miss retries the role's home
      // org), and a whole demo room behind one hospital NAT shares a single IP,
      // so a legitimate session could lock everyone out mid-demo.
      skipSuccessfulRequests: true,
      validate: { xForwardedForHeader: false },
    });
    const generalLimiter = rateLimit({
      ...GENERAL_RATE_LIMIT,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
    });
    app.use("/api/login", authLimiter);
    app.use("/api/register", authLimiter);
    app.use("/api/2fa", authLimiter);
    app.use("/api", generalLimiter);
  }

  registerRoutes(app);

  // Unified mobile: the installable PWA IS the full, responsive web app served
  // at "/" (manifest + service worker live in webapp/). The old slim /m kit is
  // retired.
  //
  // Old /m installs registered a service worker at /m/sw.js that CACHES the
  // retired slim app and intercepts /m navigations (so a plain redirect never
  // reaches them). Serve a self-destructing SW there: on activate it clears all
  // caches, unregisters itself, and reloads open windows into the unified app.
  // This heals stale devices on their next visit. Must precede the redirect.
  app.get("/m/sw.js", (_req, res) => {
    res.type("application/javascript").set("Cache-Control", "no-cache");
    res.send(
      'self.addEventListener("install",function(){self.skipWaiting();});\n' +
        'self.addEventListener("activate",function(e){e.waitUntil((async function(){' +
        'try{var k=await caches.keys();await Promise.all(k.map(function(x){return caches.delete(x);}));}catch(_){}' +
        'try{await self.registration.unregister();}catch(_){}' +
        'try{var cs=await self.clients.matchAll({type:"window"});cs.forEach(function(c){try{c.navigate("/");}catch(_){}});}catch(_){}' +
        "})());});\n",
    );
  });
  // Redirect /m and any /m/* to "/" so existing links, bookmarks, and home-screen
  // installs land on the unified app. Registered BEFORE the SPA catch-all.
  app.get(/^\/m(\/.*)?$/, (_req, res) => res.redirect(302, "/"));

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
    // Convenience alias for the side-by-side demo console (served from demo.html
    // by express.static; without this the SPA fallback below would shadow it).
    app.get("/demo", (_req, res) => res.redirect("/demo.html"));
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
