// MUST be the first import: patches Express so a rejected promise from any
// async handler reaches the JSON error middleware instead of hanging the
// request. See server/async-errors.ts.
import "./async-errors.js";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import session from "express-session";
import passport from "passport";
import rateLimit from "express-rate-limit";
import { configurePassport, verifyPassword } from "./auth.js";
import {
  ACCOUNT_RATE_LIMIT,
  AUTH_RATE_LIMIT,
  GENERAL_RATE_LIMIT,
  RATE_LIMIT_RESPONSE,
  SESSION_POLICY,
  clientIpKey,
  securityHeaders,
  sessionCookieOptions,
  setRateLimitState,
} from "./config.js";
import { getHandle } from "./db.js";
import { registerRoutes } from "./routes/index.js";
import { demoTokenAuth, issueDemoToken } from "./demoAuth.js";
import { moduleGate } from "./modules.js";
import { registerNumericParams } from "./params.js";
import { createSessionStore } from "./session-store.js";
import { storage } from "./storage.js";
import { toSafeUser } from "@shared/schema";

export interface CreateAppOptions {
  sessionSecret?: string;
  /** When false (tests), disable rate limiting for determinism. */
  rateLimiting?: boolean;
  /**
   * Express `trust proxy` value. `true` means "loopback" (a reverse proxy on
   * this host); a string is an address list / keyword list; a number is the
   * legacy (spoofable) hop count. See resolveTrustProxy() in server/config.ts.
   */
  trustProxy?: boolean | string | number;
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

  // Forwarded headers (client IP for rate limiting + audit rows, X-Forwarded-
  // Proto for the Secure-cookie decision) are believed only from the trusted
  // proxy peer(s) — never from a hop count, which any direct client satisfies.
  if (opts.trustProxy === true) app.set("trust proxy", "loopback");
  else if (typeof opts.trustProxy === "string" || typeof opts.trustProxy === "number") {
    app.set("trust proxy", opts.trustProxy);
  }

  // Security response headers (helmet CSP/HSTS/… + Permissions-Policy). The
  // instance lives in server/config.ts so the compliance monitor can probe the
  // SAME middleware for the headers it emits.
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

  // Session store: real Postgres (DATABASE_URL) → connect-pg-simple on the
  // app's own pg.Pool, so sessions survive restarts and are shared between
  // instances; PGlite → in-memory. The choice is recorded for the compliance
  // monitor (getSessionStoreState) so it can report the real posture.
  const { store } = createSessionStore({
    databaseUrl: process.env.DATABASE_URL,
    pool: process.env.DATABASE_URL ? getHandle().pool : undefined,
  });

  const secret =
    opts.sessionSecret ??
    process.env.SESSION_SECRET ??
    randomBytes(32).toString("hex");

  // Cookie/session posture comes from SESSION_POLICY (server/config.ts) — the
  // same values the `session-timeout` / `session-cookie-flags` controls read.
  const cookie = sessionCookieOptions();
  const sessionMiddleware: RequestHandler = session({
    name: SESSION_POLICY.name,
    secret,
    resave: false,
    saveUninitialized: false,
    store,
    rolling: SESSION_POLICY.rolling, // maxAge behaves as INACTIVITY expiry.
    cookie,
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
  // Feature-module gate: per-org on/off switches enforced centrally (one table
  // in server/modules.ts) so route files stay untouched. After session/passport
  // so currentUser(req) is populated; before registerRoutes so it wins.
  app.use(moduleGate());

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
    // Tiered limits: stricter on auth, looser on general traffic. Every limiter
    // keys on clientIpKey(): the address Express resolved under the `trust
    // proxy` ADDRESS LIST above, so an X-Forwarded-For sent by anything other
    // than the trusted proxy peer is ignored and cannot pick its own bucket.
    // (The library's own X-Forwarded-For validation is bypassed by supplying a
    // keyGenerator, so there is nothing left to throw and 500 a login.)
    const common = {
      standardHeaders: true as const,
      legacyHeaders: false,
      message: RATE_LIMIT_RESPONSE,
      keyGenerator: clientIpKey,
    };
    const authLimiter = rateLimit({
      ...AUTH_RATE_LIMIT,
      ...common,
      // Count only FAILED auth attempts (status >= 400). The control we need is
      // brute-force / credential-stuffing protection (§164.308(a)(5)(ii)(C)),
      // and that is entirely about wrong guesses — a successful sign-in is not
      // an attack. Counting successes too meant ordinary use burned the budget:
      // every role switch costs 1 (or 2, since a miss retries the role's home
      // org), and a whole demo room behind one hospital NAT shares a single IP,
      // so a legitimate session could lock everyone out mid-demo.
      skipSuccessfulRequests: true,
    });
    // Per-ACCOUNT failure budget: the per-IP limiter alone is defeated by a
    // guesser that spreads attempts over many addresses, so the same failed
    // password attempts are ALSO counted against the targeted org+username.
    // Keyed on what the client SENT (lower-cased), so it reveals nothing about
    // whether that account exists, and failures only — a correct password is
    // never counted, so ordinary use is unaffected.
    const accountLimiter = rateLimit({
      ...ACCOUNT_RATE_LIMIT,
      standardHeaders: true,
      legacyHeaders: false,
      message: RATE_LIMIT_RESPONSE,
      skipSuccessfulRequests: true,
      // A body without both fields is a validation error, not a guess.
      skip: (req) => !loginAccountKey(req),
      keyGenerator: (req) => loginAccountKey(req) ?? "acct:none",
    });
    const generalLimiter = rateLimit({
      ...GENERAL_RATE_LIMIT,
      ...common,
    });
    app.use("/api/login", authLimiter);
    app.post("/api/login", accountLimiter);
    app.use("/api/register", authLimiter);
    app.use("/api/2fa", authLimiter);
    app.use("/api", generalLimiter);
  }

  // A session can only be established over a transport that will carry the
  // cookie back. When the cookie is configured Secure (production) and this
  // request is NOT seen as HTTPS — no TLS on the socket and no X-Forwarded-Proto
  // from a trusted proxy — the browser would silently drop the Set-Cookie and
  // the user would see a 200 followed by an unexplained "logged out". Refuse
  // clearly instead, so the operator fixes TLS termination / TRUST_PROXY.
  // Gated on the CONFIGURED flag, not on NODE_ENV, so dev over http still works.
  const requireSecureTransport: RequestHandler = (req, res, next) => {
    if (cookie.secure && !req.secure) {
      warnInsecureLoginOnce();
      return res.status(400).json({ error: "insecure_transport" });
    }
    next();
  };
  app.post(["/api/login", "/api/2fa/complete-login"], requireSecureTransport);

  // Every numeric `:id`-style parameter is validated here, once, before any
  // route runs: malformed → 404 JSON instead of NaN reaching the database.
  registerNumericParams(app);

  registerRoutes(app);

  // Unknown API / WS paths answer with the SAME JSON shape every real route
  // uses, instead of Express's default HTML 404 page. (/ws upgrades never reach
  // Express — the WebSocket server owns them — so this only sees plain HTTP.)
  app.all(/^\/(api|ws)(\/|$)/, (_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

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

  // Consistent error shape. Honours the 4xx status body-parser / http-errors
  // already set (malformed JSON → 400, oversized body → 413, …) instead of
  // flattening everything to 500, and NEVER logs a request body: body-parser
  // attaches the raw body to a parse error (`err.body`) and Node's JSON.parse
  // message quotes the offending text, either of which could carry PHI.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const { status, type, name } = classifyError(err);
    if (status >= 500) {
      // A genuine server fault: full error (message + stack) so it can be
      // debugged. Body-parser errors are 4xx and never reach this branch; any
      // other error carrying a `body` property is scrubbed before logging.
      console.error("[error]", req.method, req.path, loggableError(err));
    } else {
      // Client error: classification only — no message, no body.
      console.warn("[warn]", req.method, req.path, { status, type: type ?? name });
    }
    if (res.headersSent) return;
    res.status(status).json({ error: errorCode(status, type) });
  });

  return app;
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

let warnedInsecureLogin = false;
function warnInsecureLoginOnce() {
  if (warnedInsecureLogin) return;
  warnedInsecureLogin = true;
  console.warn(
    "[auth] login refused over a non-HTTPS request while the session cookie is Secure " +
      "(insecure_transport). Check TLS termination, TRUST_PROXY and the proxy's X-Forwarded-Proto header.",
  );
}

/** org+username the client sent on POST /api/login, lower-cased; null if absent. */
function loginAccountKey(req: Request): string | null {
  const body = (req.body ?? {}) as { orgCode?: unknown; username?: unknown };
  const org = typeof body.orgCode === "string" ? body.orgCode.trim().toLowerCase() : "";
  const user = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  if (!org || !user) return null;
  return `acct:${org.slice(0, 64)}:${user.slice(0, 128)}`;
}

interface ErrorClass {
  status: number;
  /** body-parser / http-errors `type` (e.g. "entity.parse.failed"), if any. */
  type?: string;
  name: string;
}

function classifyError(err: unknown): ErrorClass {
  const e = (err && typeof err === "object" ? err : {}) as {
    status?: unknown;
    statusCode?: unknown;
    type?: unknown;
    name?: unknown;
  };
  const raw =
    typeof e.status === "number"
      ? e.status
      : typeof e.statusCode === "number"
        ? e.statusCode
        : 500;
  const status = raw >= 400 && raw < 500 ? raw : 500;
  return {
    status,
    ...(typeof e.type === "string" ? { type: e.type } : {}),
    name: typeof e.name === "string" ? e.name : "Error",
  };
}

function errorCode(status: number, type?: string): string {
  switch (type) {
    case "entity.parse.failed":
      return "invalid_json";
    case "entity.too.large":
      return "payload_too_large";
    case "encoding.unsupported":
    case "charset.unsupported":
      return "unsupported_media_type";
    case "request.aborted":
      return "request_aborted";
  }
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 413:
      return "payload_too_large";
    case 415:
      return "unsupported_media_type";
    case 429:
      return "rate_limited";
    default:
      return status >= 500 ? "internal_error" : "request_error";
  }
}

/** The error as it may be logged: never with a request `body` attached. */
function loggableError(err: unknown): unknown {
  if (err && typeof err === "object" && "body" in err) {
    const { body: _omit, ...rest } = err as Record<string, unknown>;
    const e = err as Partial<Error>;
    return { name: e.name, message: e.message, stack: e.stack, ...rest };
  }
  return err;
}
