import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { appendFile, cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import http, { type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import type { Express } from "express";
import { createTestApp, type TestContext } from "./helpers.js";
import { createApp } from "../server/app.js";
import {
  cacheControlFor,
  checkBuild,
  devShellAssets,
  negotiateEncoding,
  withoutInlineScript,
  type WebappServing,
} from "../server/webapp-static.js";
import { buildWebapp, parseScripts, type WebappBuildManifest } from "../scripts/build-webapp.mjs";

/**
 * Web client serving and the PWA shell:
 *
 *  SHO-59 / SHO-64  production build (scripts/build-webapp.mjs): every JSX file
 *                   precompiled, production React, no Babel; served with
 *                   brotli/gzip and immutable caching for hashed files while the
 *                   shell stays no-cache; a stale build is never served; the
 *                   bundle shell's CSP drops 'unsafe-inline' from script-src.
 *  SHO-43           /sw.js carries the shell version and the COMPLETE precache
 *                   list (never /api or /ws); the worker precaches all-or-
 *                   nothing, keeps the old cache until the new one is complete,
 *                   never intercepts /api or /ws, and answers offline
 *                   navigations from the precached shell.
 *  MIN-7            the manifest's maskable icon is a full-bleed opaque PNG.
 */

const ROOT = join(__dirname, "..");
const WEBAPP = join(ROOT, "webapp");
const BR = { "Accept-Encoding": "br, gzip, deflate" };
const GZ = { "Accept-Encoding": "gzip" };

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/**
 * GET over a real socket and keep the body exactly as sent (supertest would
 * transparently decompress it, hiding what actually went over the wire).
 */
async function rawGet(app: Express, path: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  try {
    return await new Promise<RawResponse>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.end();
    });
  } finally {
    server.close();
  }
}

function decoded(res: RawResponse): Buffer {
  const enc = res.headers["content-encoding"];
  if (enc === "br") return brotliDecompressSync(res.body);
  if (enc === "gzip") return gunzipSync(res.body);
  return res.body;
}

function swShell(source: string): { version: string; precache: string[]; immutable: string } {
  const first = source.split("\n", 1)[0] ?? "";
  const m = /^self\.__DT_SHELL__ = (\{.*\});$/.exec(first);
  if (!m) throw new Error("sw.js does not start with the injected shell: " + first.slice(0, 80));
  return JSON.parse(m[1]!);
}

async function copyWebapp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "docturn-webapp-"));
  const dst = join(dir, "webapp");
  await cp(WEBAPP, dst, {
    recursive: true,
    filter: (src) => !/[\\/]webapp[\\/](dist|\.dist)/.test(src),
  });
  return dst;
}

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.handle.close();
});

/* ── dev mode (the default outside production) ─────────────────────────────── */

describe("dev mode: in-browser Babel kit, compressed, revalidated", () => {
  it("is the default under test/development, and the shell is the source index.html", async () => {
    expect((ctx.app.locals.webapp as WebappServing).mode).toBe("dev");
    const res = await supertest(ctx.app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.headers["cache-control"]).toBe("no-cache, must-revalidate");
    expect(res.text).toContain('type="text/babel"');
    expect(res.text).toContain("/assets/vendor/babel.min.js");
    // in-browser Babel injects inline scripts → the base policy keeps 'unsafe-inline'
    expect(res.headers["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline'");
  });

  it("serves text assets brotli/gzip-compressed (Vary, ETag, 304) and identical once decoded", async () => {
    const file = readFileSync(join(WEBAPP, "assets/vendor/babel.min.js"));
    const br = await rawGet(ctx.app, "/assets/vendor/babel.min.js", BR);
    expect(br.status).toBe(200);
    expect(br.headers["content-encoding"]).toBe("br");
    expect(br.headers["vary"]).toMatch(/Accept-Encoding/i);
    expect(br.headers["content-type"]).toMatch(/javascript/);
    expect(br.headers["cache-control"]).toBe("no-cache, must-revalidate");
    expect(br.body.length).toBe(Number(br.headers["content-length"]));
    expect(br.body.length).toBeLessThan(file.length / 3);
    expect(decoded(br).equals(file)).toBe(true);

    const gz = await rawGet(ctx.app, "/assets/vendor/babel.min.js", GZ);
    expect(gz.headers["content-encoding"]).toBe("gzip");
    expect(decoded(gz).equals(file)).toBe(true);

    const plain = await rawGet(ctx.app, "/assets/vendor/babel.min.js", { "Accept-Encoding": "identity" });
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.body.equals(file)).toBe(true);

    const again = await rawGet(ctx.app, "/assets/vendor/babel.min.js", { ...BR, "If-None-Match": String(br.headers["etag"]) });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);

    // The shell document too.
    const shell = await rawGet(ctx.app, "/", BR);
    expect(shell.headers["content-encoding"]).toBe("br");
    expect(decoded(shell).toString("utf8")).toBe(readFileSync(join(WEBAPP, "index.html"), "utf8"));
    // HEAD: headers, no body.
    const head = await supertest(ctx.app).head("/api-bridge.js").set(BR);
    expect(head.status).toBe(200);
    expect(head.headers["content-encoding"]).toBe("br");
  });

  it("never compresses API responses (PHI next to attacker-influenced input: BREACH)", async () => {
    const res = await supertest(ctx.app).get("/api/config").set(BR);
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("cannot be steered outside the client directory", async () => {
    for (const p of ["/%2e%2e/server/app.ts", "/..%2fserver/app.ts", "/%2e%2e%2fpackage.json"]) {
      const res = await rawGet(ctx.app, p, BR);
      expect(decoded(res).toString("utf8"), p).not.toContain("createApp");
      expect(decoded(res).toString("utf8"), p).not.toContain('"dependencies"');
    }
  });

  it("/sw.js carries the COMPLETE dev shell — every script, stylesheet, manifest, icon, image — and no /api or /ws", async () => {
    const res = await supertest(ctx.app).get("/sw.js");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-cache, must-revalidate");
    expect(res.headers["content-type"]).toMatch(/javascript/);
    const shell = swShell(res.text);
    expect(shell.version).toMatch(/^dev-[0-9a-f]{10}$/);
    expect(shell.immutable).toBe("/dist/");

    const html = readFileSync(join(WEBAPP, "index.html"), "utf8");
    // Every script the shell loads — parsed by the build's own parser.
    const scripts = parseScripts(html).filter((s) => s.src).map((s) => s.src!);
    expect(scripts.length).toBeGreaterThan(30);
    for (const s of scripts) expect(shell.precache, s).toContain(s);
    for (const must of [
      "/index.html",
      "/tokens.css",
      "/manifest.webmanifest",
      "/store.js",
      "/api-bridge.js", // was swallowed by the old startsWith("/api") exclusion
      "/components.jsx",
      "/assets/vendor/react.js",
      "/assets/vendor/react-dom.js",
      "/assets/vendor/babel.min.js",
      "/assets/vendor/lucide.min.js",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-512-maskable.png",
      "/icons/apple-touch-icon.png",
      "/assets/docturn-wordmark.svg", // the login screen's logo
    ]) {
      expect(shell.precache, must).toContain(must);
    }
    expect(shell.precache.filter((p) => p === "/api" || p.startsWith("/api/") || p === "/ws" || p.startsWith("/ws/"))).toEqual([]);
    expect(new Set(shell.precache).size).toBe(shell.precache.length);
    // Each one is actually servable (Cache.addAll is all-or-nothing).
    for (const p of shell.precache) {
      const r = await supertest(ctx.app).get(p);
      expect(r.status, p).toBe(200);
    }
    expect(devShellAssets(WEBAPP)).toEqual(shell.precache);
  });

  it("the dev shell version changes whenever a shell file changes (so the worker re-precaches)", async () => {
    const dir = await copyWebapp();
    try {
      const app = createApp({ sessionSecret: "t", rateLimiting: false, webapp: { dir, mode: "dev" } });
      const v1 = swShell((await supertest(app).get("/sw.js")).text).version;
      await new Promise((r) => setTimeout(r, 2100)); // the list is memoised for 2 s
      await appendFile(join(dir, "LoginScreen.jsx"), "\n// edit\n");
      const v2 = swShell((await supertest(app).get("/sw.js")).text).version;
      expect(v2).not.toBe(v1);
    } finally {
      await rm(join(dir, ".."), { recursive: true, force: true });
    }
  });
});

/* ── bundle mode (npm run build:webapp) ───────────────────────────────────── */

describe("bundle mode: precompiled, production React, compressed, immutable hashed files", () => {
  let dir: string;
  let manifest: WebappBuildManifest;
  let app: Express;
  beforeAll(async () => {
    dir = await copyWebapp();
    manifest = await buildWebapp({ srcDir: dir, log: () => {} });
    app = createApp({ sessionSecret: "t", rateLimiting: false, webapp: { dir, mode: "bundle" } });
  }, 120000);
  afterAll(async () => {
    await rm(join(dir, ".."), { recursive: true, force: true });
  });

  it("the build compiles every text/babel script and drops the in-browser compiler", () => {
    const html = readFileSync(join(dir, "index.html"), "utf8");
    const babel = parseScripts(html).filter((s) => s.kind === "babel");
    expect(babel.length).toBeGreaterThan(30);
    // every JSX source was read (and fingerprinted) by the build
    for (const s of babel.filter((b) => b.src)) expect(Object.keys(manifest.sources)).toContain(s.src!.slice(1));
    const shell = readFileSync(join(dir, "dist/index.html"), "utf8");
    const left = parseScripts(shell);
    expect(left.filter((s) => s.kind === "babel")).toEqual([]);
    expect(left.filter((s) => !s.src)).toEqual([]); // no inline script at all
    expect(shell).not.toContain("babel.min.js");
    expect(shell).not.toContain("react.js");
    expect(shell).toContain(`<meta name="docturn-build" content="${manifest.version}">`);
    expect(left.map((s) => s.src)).toEqual([manifest.bundles.runtime, ...manifest.bundles.compiled]);

    const runtime = readFileSync(join(dir, manifest.bundles.runtime!.slice(1)), "utf8");
    expect(runtime).toContain("react.production.min.js");
    expect(runtime).toContain("react-dom.production.min.js");
    expect(runtime).not.toContain("react.development.js");
    expect(runtime).toContain("window.__dtLock"); // the inline boot block moved here
    for (const url of [manifest.bundles.runtime!, ...manifest.bundles.compiled]) {
      const code = readFileSync(join(dir, url.slice(1)), "utf8");
      expect(() => new vm.Script(code, { filename: url })).not.toThrow();
    }
    const app1 = readFileSync(join(dir, manifest.bundles.compiled[0]!.slice(1)), "utf8");
    expect(app1.startsWith("/* /components.jsx */\n\"use strict\";")).toBe(true); // same mode as in-browser
    expect(app1).toContain("React.createElement");
  });

  it("serves the bundle shell for /, /index.html and SPA paths — no-cache, and script-src without 'unsafe-inline'", async () => {
    expect((app.locals.webapp as WebappServing).mode).toBe("bundle");
    for (const p of ["/", "/index.html", "/messages/42", "/messages/"]) {
      const res = await supertest(app).get(p);
      expect(res.status, p).toBe(200);
      expect(res.headers["cache-control"], p).toBe("no-cache, must-revalidate");
      expect(res.text, p).toContain(`content="${manifest.version}"`);
      const csp = res.headers["content-security-policy"]!;
      expect(csp, p).toContain("script-src 'self';");
      expect(csp, p).not.toMatch(/script-src[^;]*unsafe-inline/);
      // every other directive exactly as server/config.ts emits it
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toMatch(/connect-src 'self' ws:\/\/127\.0\.0\.1:\d+ wss:\/\/127\.0\.0\.1:\d+/);
    }
    // API responses keep the base policy (only the shell document is tightened)
    expect((await supertest(app).get("/api/config")).headers["content-security-policy"]).toContain("'unsafe-inline'");
  });

  it("hashed files are immutable for a year and sent precompressed; unhashed files revalidate", async () => {
    for (const url of [manifest.bundles.runtime!, ...manifest.bundles.compiled, ...manifest.bundles.css]) {
      const file = readFileSync(join(dir, url.slice(1)));
      const br = await rawGet(app, url, BR);
      expect(br.status, url).toBe(200);
      expect(br.headers["cache-control"], url).toBe("public, max-age=31536000, immutable");
      expect(br.headers["content-encoding"], url).toBe("br");
      expect(br.headers["vary"], url).toMatch(/Accept-Encoding/i);
      // byte-for-byte the build's q11 .br file (not a runtime recompression)
      expect(br.body.equals(readFileSync(join(dir, url.slice(1) + ".br"))), url).toBe(true);
      expect(decoded(br).equals(file), url).toBe(true);
      const gz = await rawGet(app, url, GZ);
      expect(gz.headers["content-encoding"]).toBe("gzip");
      expect(gz.body.equals(readFileSync(join(dir, url.slice(1) + ".gz")))).toBe(true);
      expect(decoded(gz).equals(file)).toBe(true);
      const id = await rawGet(app, url);
      expect(id.headers["content-encoding"]).toBeUndefined();
      expect(id.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      expect(id.body.equals(file)).toBe(true);
      const etag = String(br.headers["etag"]);
      expect((await rawGet(app, url, { ...BR, "If-None-Match": etag })).status).toBe(304);
    }
    for (const p of ["/manifest.webmanifest", "/icons/icon-192.png", "/api-bridge.js"]) {
      expect((await supertest(app).get(p)).headers["cache-control"], p).toBe("no-cache, must-revalidate");
    }
    const total = Object.values(manifest.files).reduce((a, f) => a + f.br, 0);
    expect(total).toBeLessThan(400 * 1024); // was 5.7 MB uncompressed before the build
  });

  it("/sw.js carries the build's version and precache list; every entry is servable", async () => {
    const shell = swShell((await supertest(app).get("/sw.js")).text);
    expect(shell.version).toBe(manifest.version);
    expect(shell.precache).toEqual(manifest.precache);
    expect(shell.precache[0]).toBe("/index.html");
    for (const url of [manifest.bundles.runtime!, ...manifest.bundles.compiled, ...manifest.bundles.css]) {
      expect(shell.precache).toContain(url);
    }
    for (const p of ["/manifest.webmanifest", "/icons/icon-512-maskable.png", "/assets/docturn-wordmark.svg"]) {
      expect(shell.precache).toContain(p);
    }
    for (const p of shell.precache) {
      expect(p.startsWith("/api")).toBe(false);
      expect((await supertest(app).get(p)).status, p).toBe(200);
    }
    // the non-script shell assets are the same set in both modes
    const dev = devShellAssets(dir);
    for (const p of shell.precache.filter((u) => !u.startsWith("/dist/"))) expect(dev).toContain(p);
  });

  it("a stale build is never served: auto/WEBAPP_BUNDLE=on fall back to dev, an explicit bundle request throws", async () => {
    const copy = await copyWebapp();
    try {
      await buildWebapp({ srcDir: copy, log: () => {} });
      expect(checkBuild(copy, join(copy, "dist")).ok).toBe(true);
      await appendFile(join(copy, "Messaging.jsx"), "\n// changed after the build\n");
      const check = checkBuild(copy, join(copy, "dist"));
      expect(check.ok).toBe(false);
      expect(!check.ok && check.reason).toMatch(/stale build: Messaging\.jsx changed/);

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const prev = process.env.WEBAPP_BUNDLE;
      process.env.WEBAPP_BUNDLE = "on";
      try {
        const fallback = createApp({ sessionSecret: "t", rateLimiting: false, webapp: { dir: copy } });
        expect((fallback.locals.webapp as WebappServing).mode).toBe("dev");
        expect((fallback.locals.webapp as WebappServing).reason).toMatch(/stale build/);
        expect((await supertest(fallback).get("/")).text).toContain('type="text/babel"');
        expect(warn).toHaveBeenCalled();
      } finally {
        if (prev === undefined) delete process.env.WEBAPP_BUNDLE;
        else process.env.WEBAPP_BUNDLE = prev;
        warn.mockRestore();
      }
      expect(() => createApp({ sessionSecret: "t", rateLimiting: false, webapp: { dir: copy, mode: "bundle" } })).toThrow(/stale build/);
    } finally {
      await rm(join(copy, ".."), { recursive: true, force: true });
    }
  }, 120000);

  it("production picks the fresh build automatically; WEBAPP_BUNDLE=off forces the dev kit", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const prevEnv = process.env.NODE_ENV;
    const prevFlag = process.env.WEBAPP_BUNDLE;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.WEBAPP_BUNDLE;
      const prod = createApp({ sessionSecret: "t", rateLimiting: false, webapp: { dir } });
      expect((prod.locals.webapp as WebappServing).mode).toBe("bundle");
      process.env.WEBAPP_BUNDLE = "off";
      const forced = createApp({ sessionSecret: "t", rateLimiting: false, webapp: { dir } });
      expect((forced.locals.webapp as WebappServing).mode).toBe("dev");
    } finally {
      if (prevEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevEnv;
      if (prevFlag === undefined) delete process.env.WEBAPP_BUNDLE;
      else process.env.WEBAPP_BUNDLE = prevFlag;
      log.mockRestore();
    }
  });

  it("a rebuild keeps the previous generation's hashed files (a running server still finds them), then prunes", async () => {
    const copy = await copyWebapp();
    try {
      const m1 = await buildWebapp({ srcDir: copy, log: () => {} });
      // (a comment alone would not change the compiled output, so add code)
      await appendFile(join(copy, "LoginScreen.jsx"), "\nwindow.__gen = 2;\n");
      const m2 = await buildWebapp({ srcDir: copy, log: () => {} });
      expect(m2.version).not.toBe(m1.version);
      const files = await readdir(join(copy, "dist"));
      for (const url of [...m1.bundles.compiled, ...m2.bundles.compiled]) expect(files).toContain(url.split("/").pop());
      await appendFile(join(copy, "LoginScreen.jsx"), "\nwindow.__gen = 3;\n");
      const m3 = await buildWebapp({ srcDir: copy, log: () => {} });
      const after = await readdir(join(copy, "dist"));
      const gen1Only = m1.bundles.compiled.filter((u) => !m2.bundles.compiled.includes(u) && !m3.bundles.compiled.includes(u));
      expect(gen1Only.length).toBeGreaterThan(0);
      for (const url of gen1Only) expect(after).not.toContain(url.split("/").pop());
      for (const url of [...m2.bundles.compiled, ...m3.bundles.compiled]) expect(after).toContain(url.split("/").pop());
      expect(after.filter((f) => f.startsWith("."))).toEqual([]); // no temp files left
    } finally {
      await rm(join(copy, ".."), { recursive: true, force: true });
    }
  }, 120000);
});

describe("helpers", () => {
  it("negotiateEncoding honours q-values and wildcards", () => {
    expect(negotiateEncoding("gzip, deflate, br")).toBe("br");
    expect(negotiateEncoding("br;q=0, gzip")).toBe("gzip");
    expect(negotiateEncoding("identity")).toBeNull();
    expect(negotiateEncoding("*")).toBe("br");
    expect(negotiateEncoding("*;q=0")).toBeNull();
    expect(negotiateEncoding(undefined)).toBeNull();
  });
  it("cacheControlFor: only content-hashed build files are immutable", () => {
    expect(cacheControlFor("/dist/app.0123456789.js", "/dist")).toBe("public, max-age=31536000, immutable");
    expect(cacheControlFor("/dist/tokens.abcdef0123.css", "/dist")).toBe("public, max-age=31536000, immutable");
    expect(cacheControlFor("/dist/index.html", "/dist")).toBe("no-cache, must-revalidate");
    expect(cacheControlFor("/app.0123456789.js", "/dist")).toBe("no-cache, must-revalidate");
    expect(cacheControlFor("/components.jsx", "/dist")).toBe("no-cache, must-revalidate");
  });
  it("withoutInlineScript removes 'unsafe-inline' from script-src only", () => {
    const csp = "default-src 'self';script-src 'self' 'unsafe-inline';style-src 'self' 'unsafe-inline';object-src 'none'";
    expect(withoutInlineScript(csp)).toBe("default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';object-src 'none'");
  });
});

/* ── the service worker itself, run against a Cache Storage / fetch double ── */

const ORIGIN = "https://docturn.test";

interface Sw {
  listeners: Record<string, (ev: unknown) => void>;
  store: Map<string, Map<string, Response>>;
  fetched: string[];
  skipWaiting: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
  /** What the "server" currently deploys (appended to every network body). */
  server: { deploy: string };
}

function loadServiceWorker(
  shell: { version: string; precache: string[]; immutable: string | null },
  opts: { fail?: Set<string>; offline?: boolean; caches?: Record<string, Record<string, string>> } = {},
): Sw {
  const source = readFileSync(join(WEBAPP, "sw.js"), "utf8");
  const store = new Map<string, Map<string, Response>>();
  for (const [name, entries] of Object.entries(opts.caches ?? {})) {
    store.set(name, new Map(Object.entries(entries).map(([u, body]) => [new URL(u, ORIGIN).href, new Response(body)])));
  }
  const fetched: string[] = [];
  const server = { deploy: "" };
  const doFetch = async (input: string | { url: string }) => {
    const url = typeof input === "string" ? new URL(input, ORIGIN).href : input.url;
    fetched.push(new URL(url).pathname);
    if (opts.offline) throw new TypeError("Failed to fetch");
    if (opts.fail?.has(new URL(url).pathname)) return new Response("nope", { status: 503 });
    return new Response("net:" + new URL(url).pathname + server.deploy, { status: 200 });
  };
  const keyOf = (req: string | { url: string }) => (typeof req === "string" ? new URL(req, ORIGIN).href : req.url);
  const cacheApi = (name: string) => ({
    addAll: async (urls: string[]) => {
      const got: Array<[string, Response]> = [];
      for (const u of urls) {
        const res = await doFetch(u);
        if (!res.ok) throw new TypeError("Request failed: " + u);
        got.push([new URL(u, ORIGIN).href, res]);
      }
      const c = store.get(name)!;
      for (const [k, v] of got) c.set(k, v);
    },
    put: async (req: string | { url: string }, res: Response) => {
      store.get(name)?.set(keyOf(req), res);
    },
  });
  const caches = {
    has: async (n: string) => store.has(n),
    open: async (n: string) => {
      if (!store.has(n)) store.set(n, new Map());
      return cacheApi(n);
    },
    keys: async () => [...store.keys()],
    delete: async (n: string) => store.delete(n),
    match: async (req: string | { url: string }, o?: { cacheName?: string }) => {
      const names = o?.cacheName ? [o.cacheName] : [...store.keys()];
      for (const n of names) {
        const hit = store.get(n)?.get(keyOf(req));
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };
  const listeners: Record<string, (ev: unknown) => void> = {};
  const skipWaiting = vi.fn(async () => {});
  const claim = vi.fn(async () => {});
  const self = {
    __DT_SHELL__: shell,
    location: new URL(ORIGIN + "/sw.js"),
    addEventListener: (type: string, fn: (ev: unknown) => void) => {
      listeners[type] = fn;
    },
    skipWaiting,
    clients: { claim, matchAll: async () => [] },
    registration: { navigationPreload: null, showNotification: async () => {} },
  };
  vm.runInNewContext(source, { self, caches, fetch: doFetch, URL, Set, Response, Promise, console });
  return { listeners, store, fetched, skipWaiting, claim, server };
}

async function lifecycle(sw: Sw, type: "install" | "activate") {
  let p: Promise<unknown> = Promise.resolve();
  sw.listeners[type]!({ waitUntil: (x: Promise<unknown>) => (p = x) });
  return p;
}

function fetchEvent(sw: Sw, path: string, mode = "no-cors"): Promise<Response> | null {
  let responded: Promise<Response> | null = null;
  sw.listeners.fetch!({
    request: { method: "GET", url: ORIGIN + path, mode },
    respondWith: (r: Promise<Response> | Response) => {
      responded = Promise.resolve(r);
    },
    preloadResponse: Promise.resolve(undefined),
  });
  return responded;
}

describe("service worker (webapp/sw.js)", () => {
  const SHELL = {
    version: "v2abc",
    precache: ["/index.html", "/tokens.css", "/api-bridge.js", "/store.js", "/dist/app.0123456789.js", "/icons/icon-192.png", "/api/user", "/ws"],
    immutable: "/dist/",
  };

  it("install precaches the complete shell (minus any /api, /ws) and only then skips waiting", async () => {
    const sw = loadServiceWorker(SHELL);
    await lifecycle(sw, "install");
    const cache = sw.store.get("docturn-shell-v2abc")!;
    expect([...cache.keys()].map((u) => new URL(u).pathname).sort()).toEqual(
      ["/index.html", "/tokens.css", "/api-bridge.js", "/store.js", "/dist/app.0123456789.js", "/icons/icon-192.png"].sort(),
    );
    expect(sw.fetched).not.toContain("/api/user");
    expect(sw.fetched).not.toContain("/ws");
    expect(sw.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("a failed precache fails the install, leaves no partial cache, and keeps the old version's cache", async () => {
    const sw = loadServiceWorker(SHELL, {
      fail: new Set(["/store.js"]),
      caches: { "docturn-shell-v1old": { "/index.html": "old shell", "/store.js": "old store" } },
    });
    await expect(lifecycle(sw, "install")).rejects.toThrow(/store\.js/);
    expect(sw.skipWaiting).not.toHaveBeenCalled();
    expect(sw.store.has("docturn-shell-v2abc")).toBe(false);
    expect(sw.store.has("docturn-shell-v1old")).toBe(true);
  });

  it("activate deletes older DocTurn caches only, then claims clients", async () => {
    const sw = loadServiceWorker(SHELL, {
      caches: { "docturn-v2": { "/index.html": "a" }, "docturn-shell-v1old": { "/index.html": "b" }, "someone-else": { "/x": "c" } },
    });
    await lifecycle(sw, "install");
    await lifecycle(sw, "activate");
    expect([...sw.store.keys()].sort()).toEqual(["docturn-shell-v2abc", "someone-else"]);
    expect(sw.claim).toHaveBeenCalled();
  });

  it("never intercepts /api or /ws (PHI), but does handle /api-bridge.js", async () => {
    const sw = loadServiceWorker(SHELL);
    for (const p of ["/api", "/api/", "/api/user", "/api/messaging/attachments/7", "/ws", "/ws/x"]) {
      expect(fetchEvent(sw, p), p).toBeNull();
      expect(fetchEvent(sw, p, "navigate"), p).toBeNull();
    }
    expect(fetchEvent(sw, "/api-bridge.js")).not.toBeNull();
    expect(fetchEvent(sw, "/apiary.png")).not.toBeNull();
  });

  it("online responses never rewrite the cache: it stays exactly one version's install-time shell", async () => {
    const sw = loadServiceWorker(SHELL);
    await lifecycle(sw, "install");
    sw.server.deploy = "@next-deploy"; // the server moved on; this worker's own update has not landed
    expect(await (await fetchEvent(sw, "/store.js")!).text()).toBe("net:/store.js@next-deploy"); // network-first online
    expect(await (await fetchEvent(sw, "/", "navigate")!).text()).toBe("net:/@next-deploy");
    const cache = sw.store.get("docturn-shell-v2abc")!;
    expect(await cache.get(ORIGIN + "/store.js")!.clone().text()).toBe("net:/store.js");
    expect(await cache.get(ORIGIN + "/index.html")!.clone().text()).toBe("net:/index.html");
  });

  it("offline: navigations get the precached shell, assets come from the cache", async () => {
    const online = loadServiceWorker(SHELL);
    await lifecycle(online, "install");
    const caches = Object.fromEntries(
      await Promise.all(
        [...online.store.entries()].map(async ([name, m]) => [
          name,
          Object.fromEntries(await Promise.all([...m.entries()].map(async ([u, r]) => [u, await r.clone().text()]))),
        ]),
      ),
    ) as Record<string, Record<string, string>>;
    const sw = loadServiceWorker(SHELL, { offline: true, caches });
    const nav = await fetchEvent(sw, "/?open=messages", "navigate")!;
    expect(await nav.text()).toBe("net:/index.html");
    const deep = await fetchEvent(sw, "/messages/42", "navigate")!;
    expect(await deep.text()).toBe("net:/index.html");
    expect(await (await fetchEvent(sw, "/api-bridge.js")!).text()).toBe("net:/api-bridge.js");
    // immutable: served from cache without touching the network
    const before = sw.fetched.length;
    expect(await (await fetchEvent(sw, "/dist/app.0123456789.js")!).text()).toBe("net:/dist/app.0123456789.js");
    expect(sw.fetched.length).toBe(before);
  });
});

/* ── MIN-7: maskable icon ─────────────────────────────────────────────────── */

/** Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) → RGBA pixels. */
function decodePng(buf: Buffer): { width: number; height: number; colorType: number; px: Buffer } {
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8); // bit depth
      colorType = data[9]!;
      expect(data[12]).toBe(0); // not interlaced
    } else if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  expect(ch).toBeGreaterThan(0);
  const rawBytes = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const px = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = rawBytes[y * (stride + 1)]!;
    const line = Buffer.from(rawBytes.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch]! : 0;
      const b = prev[x]!;
      const c = x >= ch ? prev[x - ch]! : 0;
      let v = line[x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 4; k++) px[(y * width + x) * 4 + k] = k < ch ? line[x * ch + k]! : 255;
    }
    prev = line;
  }
  return { width, height, colorType, px };
}

describe("MIN-7 maskable icon", () => {
  const manifest = JSON.parse(readFileSync(join(WEBAPP, "manifest.webmanifest"), "utf8")) as {
    icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
  };

  it("the manifest's maskable entry is its own file; the 'any' icons are unchanged", () => {
    const maskable = manifest.icons.filter((i) => i.purpose.split(/\s+/).includes("maskable"));
    expect(maskable).toEqual([{ src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }]);
    const any = manifest.icons.filter((i) => i.purpose === "any").map((i) => i.src);
    expect(any).toEqual(["/icons/icon-192.png", "/icons/icon-512.png"]);
    for (const icon of manifest.icons) expect(existsSync(join(WEBAPP, icon.src)), icon.src).toBe(true);
  });

  it("is a 512x512 PNG, every pixel opaque, the background full-bleed #2563EB, the glyph inside the safe zone", () => {
    const img = decodePng(readFileSync(join(WEBAPP, "icons/icon-512-maskable.png")));
    expect([img.width, img.height]).toEqual([512, 512]);
    const at = (x: number, y: number) => [...img.px.subarray((y * 512 + x) * 4, (y * 512 + x) * 4 + 4)];
    let transparent = 0;
    let glyphRadius = 0;
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const [r, g, b, a] = at(x, y);
        if (a !== 255) transparent++;
        if (r !== 37 || g !== 99 || b !== 235) glyphRadius = Math.max(glyphRadius, Math.hypot(x + 0.5 - 256, y + 0.5 - 256));
      }
    }
    expect(transparent).toBe(0);
    for (const [x, y] of [[0, 0], [511, 0], [0, 511], [511, 511], [3, 3], [508, 508]] as const) {
      expect(at(x, y), `${x},${y}`).toEqual([37, 99, 235, 255]);
    }
    // Everything that is not brand blue (the white "D") lies inside the
    // maskable safe zone: a centred circle of radius 40% of the icon.
    expect(glyphRadius).toBeGreaterThan(100);
    expect(glyphRadius).toBeLessThan(0.4 * 512);
  });

  it("keeps the 'any' icon's glyph pixel-for-pixel (only the transparent corners were filled)", () => {
    const any = decodePng(readFileSync(join(WEBAPP, "icons/icon-512.png")));
    const mask = decodePng(readFileSync(join(WEBAPP, "icons/icon-512-maskable.png")));
    let cornerTransparent = 0;
    let differs = 0;
    for (let i = 0; i < 512 * 512 * 4; i += 4) {
      if (any.px[i + 3] === 0) cornerTransparent++;
      if (any.px[i + 3] === 255 && (any.px[i] !== mask.px[i] || any.px[i + 1] !== mask.px[i + 1] || any.px[i + 2] !== mask.px[i + 2])) differs++;
    }
    expect(cornerTransparent).toBeGreaterThan(1000); // the problem MIN-7 describes
    expect(differs).toBe(0);
  });
});
