/**
 * Serving the web client (webapp/) — A.CON-SHO-43 / SHO-59 / SHO-64.
 *
 * Two modes, chosen ONCE at startup:
 *
 *   bundle  The precompiled build from `npm run build:webapp`
 *           (scripts/build-webapp.mjs → webapp/dist): production React, every
 *           JSX file already compiled, content-hashed file names. The shell
 *           document has no inline script, so its Content-Security-Policy drops
 *           'unsafe-inline' from script-src. Used when NODE_ENV=production (or
 *           WEBAPP_BUNDLE=on) AND a build exists whose recorded source hashes
 *           match the files on disk — a stale or partial build is never served.
 *   dev     The no-build kit exactly as before: webapp/index.html, development
 *           React and in-browser Babel. The default outside production, and the
 *           fallback (with a warning) when production has no usable build.
 *           WEBAPP_BUNDLE=off forces it.
 *
 * In both modes:
 *   • static text assets are sent brotli/gzip-compressed when the client
 *     accepts it — the build's precompressed .br/.gz siblings when present,
 *     otherwise compressed once per file version and kept in memory. Only the
 *     static client is compressed: API responses carry PHI next to
 *     attacker-influenced input (BREACH), and the production proxy (Caddy
 *     `encode`) already handles them;
 *   • content-hashed build files are `Cache-Control: public, max-age=31536000,
 *     immutable`; everything else (the shell, sw.js, the manifest, icons, the
 *     dev files) stays `no-cache, must-revalidate`;
 *   • /sw.js is served with the shell's version and its COMPLETE precache list
 *     prepended (`self.__DT_SHELL__`), so every deploy that changes the shell
 *     changes the service worker's bytes, which makes the browser install a new
 *     worker that precaches the new shell before it takes over.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, posix, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, brotliCompressSync, constants as zlibConstants, gzip, gzipSync } from "node:zlib";
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from "express";

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

export type WebappMode = "auto" | "dev" | "bundle";

export interface WebappOptions {
  /**
   * auto (default): the bundle when NODE_ENV=production or WEBAPP_BUNDLE=on and
   * a fresh build exists, otherwise dev (WEBAPP_BUNDLE=off forces dev).
   * "bundle" REQUIRES a fresh build (throws otherwise); "dev" never uses one.
   */
  mode?: WebappMode;
  /** The client directory (default: resolved by createApp). */
  dir?: string;
  /** Build output directory; must be inside `dir` (default `<dir>/dist`). */
  distDir?: string;
}

export interface BuildManifest {
  schema: number;
  version: string;
  index: string;
  files: Record<string, { bytes: number; br: number; gzip: number; sha256: string }>;
  precache: string[];
  sources: Record<string, string>;
}

export interface WebappServing {
  mode: "dev" | "bundle";
  /** Why this mode was chosen (logged; asserted by tests). */
  reason: string;
  /** Build version (bundle) or a fingerprint of the dev shell files. */
  version(): string;
  /** Every URL the service worker precaches (never /api or /ws). */
  precache(): string[];
}

/** Hashed build outputs: `<urlBase>/<stem>.<10 hex>.<js|css>`. */
const HASH_SEGMENT = /\.[0-9a-f]{10}\.(?:js|css)$/;
const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "no-cache, must-revalidate";
const COMPRESSIBLE = new Set([".js", ".mjs", ".jsx", ".css", ".html", ".json", ".webmanifest", ".svg", ".map", ".txt"]);
/** Below this, compression saves less than its headers cost. */
const MIN_COMPRESS_BYTES = 1024;
const RUNTIME_CACHE_LIMIT = 64 * 1024 * 1024;

export const isApiOrWsPath = (p: string) => p === "/api" || p.startsWith("/api/") || p === "/ws" || p.startsWith("/ws/");

const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

/* ── content negotiation ──────────────────────────────────────────────────── */

/** "br" when acceptable, else "gzip", else null (q=0 excludes a coding). */
export function negotiateEncoding(header: string | string[] | undefined): "br" | "gzip" | null {
  const raw = Array.isArray(header) ? header.join(",") : header || "";
  const q: Record<string, number> = {};
  for (const part of raw.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    let weight = 1;
    for (const p of params) {
      const m = /^\s*q=([0-9.]+)\s*$/.exec(p);
      if (m) weight = Number(m[1]);
    }
    q[name] = weight;
  }
  const ok = (c: string) => (q[c] ?? q["*"] ?? 0) > 0;
  if (ok("br")) return "br";
  if (ok("gzip")) return "gzip";
  return null;
}

export function cacheControlFor(urlPath: string, distUrlBase: string): string {
  return urlPath.startsWith(distUrlBase + "/") && HASH_SEGMENT.test(urlPath) ? IMMUTABLE : REVALIDATE;
}

/* ── the shell's asset list (dev mode; the build writes its own) ───────────── */

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) attrs[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return attrs;
}

function localPath(url: string | undefined): string | null {
  if (!url) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) return null;
  const clean = url.split(/[?#]/)[0] ?? "";
  return clean.startsWith("/") ? clean : "/" + clean; // the shell has <base href="/">
}

const ASSET_LITERAL = /["'`](\/(?:assets|icons)\/[A-Za-z0-9._\-/]+\.(?:svg|png|jpe?g|webp|gif|ico|woff2?))["'`]/g;

/**
 * Everything the no-build shell loads: index.html, every <script src> (vendor,
 * store.js, api-bridge.js, every .jsx), every local <link> (stylesheet,
 * manifest, icons), the manifest's icons, and images the app's own scripts
 * reference by URL (e.g. the wordmark on the login screen). Files that do not
 * exist are left out (the install would fail on a 404); /api and /ws never
 * appear.
 */
export function devShellAssets(dir: string): string[] {
  const html = readFileSync(join(dir, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const list: string[] = ["/index.html"];
  const seen = new Set(list);
  const add = (p: string | null) => {
    if (!p || seen.has(p) || isApiOrWsPath(p)) return;
    if (!existsSync(join(dir, p))) return;
    seen.add(p);
    list.push(p);
  };
  const appScripts: string[] = [];
  const tag = /<(script|link)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(html))) {
    const attrs = parseAttrs(m[2] ?? "");
    if (m[1]!.toLowerCase() === "script") {
      const p = localPath(attrs.src);
      add(p);
      if (p && !p.startsWith("/assets/vendor/")) appScripts.push(p);
    } else {
      const rel = (attrs.rel || "").toLowerCase();
      if (/(^|\s)(stylesheet|manifest|icon|apple-touch-icon|shortcut)(\s|$)/.test(rel)) add(localPath(attrs.href));
    }
  }
  const manifestFile = join(dir, "manifest.webmanifest");
  if (existsSync(manifestFile)) {
    add("/manifest.webmanifest");
    try {
      const mf = JSON.parse(readFileSync(manifestFile, "utf8")) as { icons?: Array<{ src?: string }> };
      for (const icon of mf.icons ?? []) add(localPath(icon.src));
    } catch {
      /* the browser reports a broken manifest */
    }
  }
  const inline = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
  const texts: string[] = [];
  while ((m = inline.exec(html))) texts.push(m[1] ?? "");
  for (const p of appScripts) {
    try {
      texts.push(readFileSync(join(dir, p), "utf8"));
    } catch {
      /* missing script: not in the list either */
    }
  }
  for (const text of texts) {
    ASSET_LITERAL.lastIndex = 0;
    while ((m = ASSET_LITERAL.exec(text))) add(m[1] ?? null);
  }
  return list;
}

/* ── build validation ─────────────────────────────────────────────────────── */

export type BuildCheck = { ok: true; manifest: BuildManifest } | { ok: false; reason: string };

/**
 * A build is usable only if its manifest is readable, every output it lists is
 * present with the recorded hash, and every source file it was built from is
 * byte-identical to the file on disk now (otherwise the bundle would run code
 * that no longer matches the repository).
 */
export function checkBuild(dir: string, distDir: string): BuildCheck {
  const manifestPath = join(distDir, "build-manifest.json");
  if (!existsSync(manifestPath)) return { ok: false, reason: "no build (run npm run build:webapp)" };
  let manifest: BuildManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BuildManifest;
  } catch {
    return { ok: false, reason: "unreadable build-manifest.json" };
  }
  if (manifest.schema !== 1 || !manifest.version || !manifest.index || !manifest.files || !manifest.sources) {
    return { ok: false, reason: "unsupported build-manifest.json" };
  }
  const urlBase = distUrlBase(dir, distDir);
  const escapes = (p: string) => p.split(/[\\/]/).some((seg) => seg === "..");
  if ([...Object.keys(manifest.files), ...Object.keys(manifest.sources), manifest.index].some(escapes)) {
    return { ok: false, reason: "build manifest names a path outside the client directory" };
  }
  for (const [url, info] of Object.entries(manifest.files)) {
    if (!url.startsWith(urlBase + "/")) return { ok: false, reason: `build file outside ${urlBase}: ${url}` };
    const file = join(distDir, url.slice(urlBase.length + 1));
    if (!existsSync(file)) return { ok: false, reason: `incomplete build: ${url} missing` };
    if (sha256(readFileSync(file)) !== info.sha256) return { ok: false, reason: `incomplete build: ${url} does not match the manifest` };
  }
  if (!manifest.files[manifest.index]) return { ok: false, reason: "build manifest has no shell" };
  for (const [rel, hash] of Object.entries(manifest.sources)) {
    const file = join(dir, rel);
    if (!existsSync(file)) return { ok: false, reason: `stale build: ${rel} no longer exists` };
    if (sha256(readFileSync(file)) !== hash) return { ok: false, reason: `stale build: ${rel} changed since it was built` };
  }
  if ((manifest.precache ?? []).some(isApiOrWsPath)) return { ok: false, reason: "build precache lists /api or /ws" };
  return { ok: true, manifest };
}

function distUrlBase(dir: string, distDir: string): string {
  const rel = relative(dir, distDir).split(sep).join("/");
  if (!rel || rel.startsWith("..") || posix.isAbsolute(rel)) {
    throw new Error(`webapp: the build directory (${distDir}) must be inside the client directory (${dir})`);
  }
  return "/" + rel;
}

/* ── compressed bodies ────────────────────────────────────────────────────── */

interface Variant {
  body: Buffer;
  etag: string;
}
interface Representation {
  identity: Variant;
  br?: Variant;
  gzip?: Variant;
}

function variant(body: Buffer, tag: string): Variant {
  return { body, etag: `"${tag}-${sha256(body).slice(0, 27)}"` };
}

async function compressAll(body: Buffer): Promise<Representation> {
  const rep: Representation = { identity: variant(body, "id") };
  if (body.length >= MIN_COMPRESS_BYTES) {
    const [br, gz] = await Promise.all([
      brotliAsync(body, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
          [zlibConstants.BROTLI_PARAM_SIZE_HINT]: body.length,
        },
      }),
      gzipAsync(body, { level: 6 }),
    ]);
    if (br.length < body.length) rep.br = variant(br, "br");
    if (gz.length < body.length) rep.gzip = variant(gz, "gz");
  }
  return rep;
}

/** Runtime-compressed static files, keyed by path + size + mtime. */
class CompressionCache {
  private entries = new Map<string, { key: string; rep: Promise<Representation>; bytes: number }>();
  private total = 0;

  get(file: string, size: number, mtimeMs: number): Promise<Representation> {
    const key = `${size}:${mtimeMs}`;
    const hit = this.entries.get(file);
    if (hit && hit.key === key) {
      // refresh LRU position
      this.entries.delete(file);
      this.entries.set(file, hit);
      return hit.rep;
    }
    if (hit) {
      this.entries.delete(file);
      this.total -= hit.bytes;
    }
    const rep = compressAll(readFileSync(file));
    const entry = { key, rep, bytes: size };
    this.entries.set(file, entry);
    rep.then(
      (r) => {
        entry.bytes = (r.br?.body.length ?? 0) + (r.gzip?.body.length ?? 0);
        this.total += entry.bytes;
        this.evict();
      },
      () => this.entries.delete(file),
    );
    return rep;
  }

  private evict() {
    for (const [file, e] of this.entries) {
      if (this.total <= RUNTIME_CACHE_LIMIT) break;
      this.entries.delete(file);
      this.total -= e.bytes;
    }
  }
}

/** Send one representation of an in-memory body: Vary, ETag, 304, HEAD. */
function sendRepresentation(req: Request, res: Response, rep: Representation, contentType: string) {
  const enc = negotiateEncoding(req.headers["accept-encoding"]);
  const chosen = (enc === "br" && rep.br) || (enc === "gzip" && rep.gzip) || rep.identity;
  res.setHeader("Vary", "Accept-Encoding");
  res.setHeader("Content-Type", contentType);
  res.setHeader("ETag", chosen.etag);
  if (chosen !== rep.identity) res.setHeader("Content-Encoding", chosen === rep.br ? "br" : "gzip");
  const inm = req.headers["if-none-match"];
  if (inm && inm.split(",").some((t) => t.trim().replace(/^W\//, "") === chosen.etag)) {
    res.removeHeader("Content-Encoding");
    res.status(304).end();
    return;
  }
  res.setHeader("Content-Length", String(chosen.body.length));
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(chosen.body);
}

/** Absolute file for a URL path inside root; null for traversal, dotfiles, non-files. */
function resolveInside(root: string, urlPath: string): { file: string; size: number; mtimeMs: number } | null {
  let p: string;
  try {
    p = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (p.includes("\0") || p.split("/").some((seg) => seg.startsWith("."))) return null;
  const file = resolve(root, "." + p);
  if (file !== root && !file.startsWith(root + sep)) return null;
  const st = statSync(file, { throwIfNoEntry: false });
  if (!st || !st.isFile()) return null;
  return { file, size: st.size, mtimeMs: st.mtimeMs };
}

const contentTypeFor = (file: string): string => {
  const type = express.static.mime.lookup(file) || "application/octet-stream";
  const charset = express.static.mime.charsets.lookup(type, "");
  return charset ? `${type}; charset=${charset}` : type;
};

/* ── CSP for the precompiled shell ────────────────────────────────────────── */

/**
 * The bundle shell loads only same-origin script files — no inline <script>,
 * no in-browser compiler injecting inline scripts — so script-src (which
 * script-src-attr inherits) no longer needs 'unsafe-inline'. Every other
 * directive is left exactly as server/config.ts emitted it.
 */
export function withoutInlineScript(csp: string): string {
  return csp
    .split(";")
    .map((d) => {
      const t = d.trim();
      if (!/^script-src(-elem|-attr)?(\s|$)/i.test(t)) return t;
      return t
        .split(/\s+/)
        .filter((tok) => tok !== "'unsafe-inline'")
        .join(" ");
    })
    .join(";");
}

/* ── mounting ─────────────────────────────────────────────────────────────── */

function chooseMode(opt: WebappMode | undefined): { mode: WebappMode; source: string } {
  if (opt) return { mode: opt, source: "option" };
  const env = (process.env.WEBAPP_BUNDLE || "").trim().toLowerCase();
  if (["off", "0", "false", "no"].includes(env)) return { mode: "dev", source: "WEBAPP_BUNDLE=off" };
  if (["on", "1", "true", "yes"].includes(env)) return { mode: "bundle", source: "WEBAPP_BUNDLE=on" };
  return { mode: "auto", source: "auto" };
}

/**
 * Mount the client on `app` (after the API routes): /sw.js, the shell, the
 * compressed static files, express.static, and the SPA fallback.
 */
export function mountWebapp(app: Express, dir: string, opts: WebappOptions = {}): WebappServing {
  const root = resolve(dir);
  const distDir = resolve(opts.distDir ?? join(root, "dist"));
  const urlBase = distUrlBase(root, distDir);
  const { mode: requested, source } = chooseMode(opts.mode);

  let manifest: BuildManifest | null = null;
  let reason: string;
  if (requested === "dev") {
    reason = `in-browser Babel (${source})`;
  } else {
    const check = checkBuild(root, distDir);
    const wanted = requested === "bundle" || process.env.NODE_ENV === "production";
    if (!wanted) {
      reason = "in-browser Babel (development; NODE_ENV=production or WEBAPP_BUNDLE=on serves the build)";
    } else if (check.ok) {
      manifest = check.manifest;
      reason = `precompiled bundle ${manifest.version} (${source === "auto" ? "production" : source})`;
    } else if (requested === "bundle" && source === "option") {
      throw new Error(`webapp: bundle mode requested but the build is not usable: ${check.reason}`);
    } else {
      reason = `in-browser Babel — ${check.reason}`;
      console.warn(
        `[webapp] serving the in-browser-Babel client: ${check.reason}. ` +
          "Launch is far slower on phones; run `npm run build` (build:webapp) before starting.",
      );
    }
  }
  if (manifest) console.log(`[webapp] serving ${reason}`);

  const compression = new CompressionCache();

  /* shell document */
  // The bundle shell is held in memory for the life of the process: a rebuild
  // on disk (deploys build first, restart after) cannot change what this
  // process serves, and the previous build's hashed files it references are
  // kept by the build for exactly that window.
  let bundleShell: Representation | null = null;
  if (manifest) {
    const body = readFileSync(join(distDir, manifest.index.slice(urlBase.length + 1)));
    bundleShell = {
      identity: variant(body, "id"),
      br: variant(brotliCompressSync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }), "br"),
      gzip: variant(gzipSync(body, { level: 9 }), "gz"),
    };
  }
  const sendShell: RequestHandler = async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", REVALIDATE);
      if (bundleShell) {
        const csp = res.getHeader("Content-Security-Policy");
        if (typeof csp === "string") res.setHeader("Content-Security-Policy", withoutInlineScript(csp));
        return sendRepresentation(req, res, bundleShell, "text/html; charset=UTF-8");
      }
      const st = statSync(join(root, "index.html"));
      const rep = await compression.get(join(root, "index.html"), st.size, st.mtimeMs);
      return sendRepresentation(req, res, rep, "text/html; charset=UTF-8");
    } catch (e) {
      next(e);
    }
  };

  /* service worker: version + full precache list, then sw.js itself */
  let devCache: { at: number; list: string[]; version: string } | null = null;
  const devShell = () => {
    if (devCache && Date.now() - devCache.at < 2000) return devCache;
    const list = devShellAssets(root);
    const h = createHash("sha256");
    for (const p of list) {
      const st = statSync(join(root, p), { throwIfNoEntry: false });
      h.update(`${p}:${st ? st.size : -1}:${st ? st.mtimeMs : -1}\n`);
    }
    devCache = { at: Date.now(), list, version: "dev-" + h.digest("hex").slice(0, 10) };
    return devCache;
  };
  const serving: WebappServing = {
    mode: manifest ? "bundle" : "dev",
    reason,
    version: () => (manifest ? manifest.version : devShell().version),
    precache: () => (manifest ? [...manifest.precache] : [...devShell().list]),
  };
  const swFile = join(root, "sw.js");
  app.get("/sw.js", async (req, res, next) => {
    try {
      if (!existsSync(swFile)) return next();
      const shell = { version: serving.version(), precache: serving.precache(), immutable: urlBase + "/" };
      const body = Buffer.from(`self.__DT_SHELL__ = ${JSON.stringify(shell)};\n` + readFileSync(swFile, "utf8"), "utf8");
      res.setHeader("Cache-Control", REVALIDATE);
      sendRepresentation(req, res, await compressAll(body), "application/javascript; charset=UTF-8");
    } catch (e) {
      next(e);
    }
  });

  app.get(["/", "/index.html"], sendShell);
  if (manifest) app.get(manifest.index, sendShell);

  /* compressed static files (precompressed sibling or runtime-compressed) */
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.headers.range) return next(); // ranges: identity bytes from express.static
    const enc = negotiateEncoding(req.headers["accept-encoding"]);
    if (!enc) return next();
    const hit = resolveInside(root, req.path);
    if (!hit || !COMPRESSIBLE.has(extname(hit.file).toLowerCase()) || hit.size < MIN_COMPRESS_BYTES) return next();
    try {
      res.setHeader("Cache-Control", cacheControlFor(req.path, urlBase));
      const pre = hit.file + (enc === "br" ? ".br" : ".gz");
      const preSt = statSync(pre, { throwIfNoEntry: false });
      if (preSt && preSt.isFile() && preSt.mtimeMs >= hit.mtimeMs) {
        res.setHeader("Vary", "Accept-Encoding");
        res.setHeader("Content-Type", contentTypeFor(hit.file));
        res.setHeader("Content-Encoding", enc);
        return res.sendFile(pre, { cacheControl: false, acceptRanges: false, lastModified: true, etag: true }, (err) => {
          if (err && !res.headersSent) next(err);
        });
      }
      const rep = await compression.get(hit.file, hit.size, hit.mtimeMs);
      return sendRepresentation(req, res, rep, contentTypeFor(hit.file));
    } catch (e) {
      return next(e);
    }
  });

  /* everything else (images, ranges, identity) */
  app.use(
    express.static(root, {
      etag: true,
      lastModified: true,
      index: false,
      setHeaders: (res, filePath) => {
        const rel = "/" + relative(root, filePath).split(sep).join("/");
        res.setHeader("Cache-Control", cacheControlFor(rel, urlBase));
        // The same URL is sent compressed to clients that accept it, so a
        // shared cache must key this identity response on Accept-Encoding too.
        if (COMPRESSIBLE.has(extname(filePath).toLowerCase())) res.setHeader("Vary", "Accept-Encoding");
      },
    }),
  );
  // Convenience alias for the side-by-side demo console (served from demo.html
  // by express.static; without this the SPA fallback below would shadow it).
  app.get("/demo", (_req, res) => res.redirect("/demo.html"));
  app.get(/^(?!\/api|\/ws).*/, sendShell);

  app.locals.webapp = serving;
  return serving;
}
