#!/usr/bin/env node
/**
 * Production build for the no-build web client (webapp/) — A.CON-SHO-59/64.
 *
 * In development the browser downloads Babel standalone (3.1 MB) plus the
 * development builds of React and compiles ~36 JSX files on EVERY launch:
 * ~15 s of main-thread work on a mid-range phone, warm or cold. This script
 * does that work once, at deploy time, and writes webapp/dist/:
 *
 *   index.html           the shell, rewritten to load ONLY precompiled,
 *                        content-hashed scripts — no Babel, no text/babel,
 *                        and no inline <script> (so the server can drop
 *                        'unsafe-inline' from script-src for this document);
 *   runtime.<hash>.js    every plain head script, in document order: the
 *                        inline boot block, production React/ReactDOM, lucide,
 *                        store.js, api-bridge.js;
 *   app.<hash>.js        every <script type="text/babel" src> compiled, in
 *                        document order;
 *   inline.<hash>.js     the inline text/babel block (the App root);
 *   tokens.<hash>.css    the stylesheet;
 *   *.br / *.gz          brotli (q11) and gzip (-9) variants the server sends
 *                        when the client accepts them;
 *   build-manifest.json  version, the service worker's precache list, and a
 *                        sha256 of every source file read (the server refuses a
 *                        STALE build and falls back to in-browser Babel).
 *
 * The previous build's hashed files are kept (two generations), so a server
 * still running the old build while the new one is written keeps working.
 *
 * Fidelity: each JSX file is compiled with exactly the options @babel/standalone
 * uses for <script type="text/babel"> in the browser (buildBabelOptions():
 * presets ["react","env"] or the tag's data-presets, plugins class-properties /
 * object-rest-spread / flow-strip-types, no targets) — so the bundle runs the
 * same code the in-browser compiler produced, minus the per-launch compile.
 * Scripts are concatenated only when that cannot change semantics: pieces of a
 * bundle share one strictness (a "use strict" prologue applies to a whole
 * script), and every bundle must parse as one classic script (vm.Script), which
 * catches any duplicate top-level lexical declaration.
 *
 * Usage:  node scripts/build-webapp.mjs [--src webapp] [--out webapp/dist]
 *         (npm run build:webapp; part of npm run build)
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import Babel from "@babel/standalone";

export const BUILD_MANIFEST = "build-manifest.json";
export const BUILD_SCHEMA = 1;

/** Vendor files swapped for their production builds in the bundle. */
const PRODUCTION_VENDOR = {
  "/assets/vendor/react.js": "/assets/vendor/react.production.min.js",
  "/assets/vendor/react-dom.js": "/assets/vendor/react-dom.production.min.js",
};
/** Only needed to compile text/babel in the browser; never shipped in a build. */
const IN_BROWSER_COMPILER = "/assets/vendor/babel.min.js";
const BABEL_TYPES = new Set(["text/babel", "text/jsx"]);
const JS_TYPES = new Set(["", "text/javascript", "application/javascript"]);
/** Static images/fonts the scripts reference by absolute URL (e.g. the wordmark). */
const ASSET_LITERAL = /["'`](\/(?:assets|icons)\/[A-Za-z0-9._\-/]+\.(?:svg|png|jpe?g|webp|gif|ico|woff2?))["'`]/g;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const shortHash = (buf) => sha256(buf).slice(0, 10);

/* ── HTML parsing (index.html is a small, hand-written document) ───────────── */

export function parseAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(raw))) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return attrs;
}

function commentRanges(html) {
  const out = [];
  const re = /<!--[\s\S]*?-->/g;
  let m;
  while ((m = re.exec(html))) out.push([m.index, m.index + m[0].length]);
  return out;
}
const inRanges = (ranges, i) => ranges.some(([a, b]) => i >= a && i < b);

/** Every <script> element outside comments, in document order. */
export function parseScripts(html) {
  const comments = commentRanges(html);
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (inRanges(comments, m.index)) continue;
    const attrs = parseAttrs(m[1]);
    const type = (attrs.type || "").split(";")[0].trim().toLowerCase();
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      attrs,
      type,
      src: attrs.src || null,
      content: m[2],
      kind: BABEL_TYPES.has(type) ? "babel" : JS_TYPES.has(type) ? "js" : "other",
    });
  }
  return out;
}

/** Every <link> element outside comments, in document order. */
export function parseLinks(html) {
  const comments = commentRanges(html);
  const out = [];
  const re = /<link\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (inRanges(comments, m.index)) continue;
    out.push({ start: m.index, end: m.index + m[0].length, attrs: parseAttrs(m[1]) });
  }
  return out;
}

/** A same-origin, root-absolute URL path ("/x/y.js"), or null. */
export function localPath(url) {
  if (!url || typeof url !== "string") return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) return null;
  const clean = url.split(/[?#]/)[0];
  return clean.startsWith("/") ? clean : "/" + clean; // <base href="/">
}

const isApiPath = (p) => p === "/api" || p.startsWith("/api/") || p === "/ws" || p.startsWith("/ws/");

/**
 * The static files the shell needs besides its scripts/stylesheet: manifest +
 * its icons, <link> icons, and images the scripts reference by URL.
 */
export function staticShellAssets(srcDir, html, scriptTexts) {
  const set = new Set();
  const add = (p) => {
    if (!p || isApiPath(p)) return;
    if (existsSync(join(srcDir, p))) set.add(p);
  };
  for (const l of parseLinks(html)) {
    const rel = (l.attrs.rel || "").toLowerCase();
    if (rel === "stylesheet") continue;
    if (/(^|\s)(manifest|icon|apple-touch-icon|shortcut)(\s|$)/.test(rel)) add(localPath(l.attrs.href));
  }
  const manifestPath = join(srcDir, "manifest.webmanifest");
  if (existsSync(manifestPath)) {
    add("/manifest.webmanifest");
    try {
      const mf = JSON.parse(readFileSync(manifestPath, "utf8"));
      for (const icon of mf.icons || []) add(localPath(icon.src));
    } catch {
      /* a broken manifest is reported by the browser, not here */
    }
  }
  for (const text of scriptTexts) {
    let m;
    ASSET_LITERAL.lastIndex = 0;
    while ((m = ASSET_LITERAL.exec(text))) add(m[1]);
  }
  return [...set];
}

/* ── Babel: the in-browser runner's options ────────────────────────────────── */

const splitList = (v) => (v === undefined ? undefined : v === "" ? [] : v.split(",").map((s) => s.trim()));

/**
 * @babel/standalone 7.29 buildBabelOptions() for a classic <script
 * type="text/babel">, with inline source maps off and config-file lookups off
 * (the browser has no file system, so it never finds one either).
 */
export function babelOptionsFor(attrs, filename) {
  const presets = splitList(attrs["data-presets"]) ?? ["react", "env"];
  const plugins = splitList(attrs["data-plugins"]) ?? [
    "transform-class-properties",
    "transform-object-rest-spread",
    "transform-flow-strip-types",
  ];
  return {
    filename,
    presets,
    plugins,
    targets: { browsers: splitList(attrs["data-targets"]) },
    sourceMaps: false,
    babelrc: false,
    configFile: false,
    browserslistConfigFile: false,
    comments: false,
    compact: true,
  };
}

/** True when the code's first statement is a "use strict" directive. */
function startsStrict(code) {
  const body = code.replace(/^(?:\s+|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n?)*/, "");
  return /^(['"])use strict\1/.test(body);
}

function assertParses(code, filename) {
  try {
    new vm.Script(code, { filename });
  } catch (e) {
    throw new Error(`build-webapp: ${filename} does not parse as one classic script: ${e && e.message}`);
  }
}

/* ── build ─────────────────────────────────────────────────────────────────── */

/**
 * Build srcDir (default webapp/) into outDir (default <srcDir>/dist). Returns
 * the manifest. Everything is compiled and validated in memory first; nothing
 * is written unless the whole build succeeded (see writeBuild for how the
 * files land next to the previous build's).
 */
export async function buildWebapp({ srcDir, outDir, log = console.log } = {}) {
  const here = dirname(fileURLToPath(import.meta.url));
  srcDir = resolve(srcDir ?? join(here, "..", "webapp"));
  outDir = resolve(outDir ?? join(srcDir, "dist"));
  const urlBase = "/" + posix.relative(srcDir.split("\\").join("/"), outDir.split("\\").join("/"));
  if (urlBase.startsWith("/..")) throw new Error("build-webapp: --out must be inside --src (it is served from there)");
  const t0 = Date.now();

  const sources = {}; // relative path → sha256 of every file the build read
  const readSource = async (urlPath) => {
    const rel = urlPath.replace(/^\//, "");
    const buf = await readFile(join(srcDir, rel));
    sources[rel] = sha256(buf);
    return buf;
  };

  const htmlBuf = await readSource("/index.html");
  const html = htmlBuf.toString("utf8");
  const scripts = parseScripts(html);
  if (scripts.some((s) => s.kind === "other")) {
    throw new Error("build-webapp: unsupported <script type> in index.html: " + scripts.filter((s) => s.kind === "other").map((s) => s.type).join(", "));
  }
  const babelScripts = scripts.filter((s) => s.kind === "babel");
  const jsScripts = scripts.filter((s) => s.kind === "js");

  // 1. Head runtime: every plain script, in order (inline ones included).
  const runtimePieces = [];
  for (const s of jsScripts) {
    if (s.src) {
      const p = localPath(s.src);
      if (!p) throw new Error("build-webapp: external script not supported: " + s.src);
      if (p === IN_BROWSER_COMPILER) {
        if (babelScripts.length === 0) throw new Error("build-webapp: babel.min.js present but nothing to compile");
        continue; // replaced by precompilation
      }
      const file = PRODUCTION_VENDOR[p] || p;
      const code = (await readSource(file)).toString("utf8");
      runtimePieces.push({ name: file, code });
    } else {
      runtimePieces.push({ name: "index.html inline script", code: s.content });
    }
  }
  for (const piece of runtimePieces) {
    // A "use strict" prologue is per SCRIPT: concatenating would spread or drop it.
    if (startsStrict(piece.code)) throw new Error(`build-webapp: ${piece.name} starts with a "use strict" directive; cannot concatenate it safely`);
  }

  // 2. Compile every text/babel script exactly like the in-browser runner.
  const compiled = [];
  let inlineCount = 0;
  for (const s of babelScripts) {
    let code;
    let name;
    if (s.src) {
      const p = localPath(s.src);
      if (!p) throw new Error("build-webapp: external text/babel script not supported: " + s.src);
      name = p;
      code = (await readSource(p)).toString("utf8");
    } else {
      inlineCount++;
      name = "Inline Babel script" + (inlineCount > 1 ? ` (${inlineCount})` : "");
      code = s.content;
    }
    let out;
    try {
      out = Babel.transform(code, babelOptionsFor(s.attrs, name)).code;
    } catch (e) {
      throw new Error(`build-webapp: Babel failed on ${name}: ${e && e.message}`);
    }
    compiled.push({ script: s, name, inline: !s.src, strict: startsStrict(out), code: out, source: code });
  }

  // 3. Group consecutive compiled scripts of the same strictness (and origin)
  //    into one bundle each; each bundle replaces its first <script> tag.
  const groups = [];
  for (const c of compiled) {
    const last = groups[groups.length - 1];
    if (last && last.strict === c.strict && last.inline === c.inline) last.items.push(c);
    else groups.push({ strict: c.strict, inline: c.inline, items: [c] });
  }

  const outputs = []; // { url, file, body }
  const emit = (stem, ext, body) => {
    const buf = Buffer.from(body, "utf8");
    const name = `${stem}.${shortHash(buf)}.${ext}`;
    const out = { url: `${urlBase}/${name}`, file: name, body: buf };
    outputs.push(out);
    return out;
  };
  const banner = (name) => `/* ${name.replace(/\*\//g, "* /")} */\n`;

  const runtimeCode = runtimePieces.map((p) => banner(p.name) + p.code.trim() + "\n").join(";\n");
  assertParses(runtimeCode, "runtime bundle");
  const runtime = runtimePieces.length ? emit("runtime", "js", runtimeCode) : null;

  const counters = {};
  const groupOutputs = groups.map((g) => {
    const stem = g.inline ? "inline" : "app";
    counters[stem] = (counters[stem] || 0) + 1;
    const code = g.items.map((c) => banner(c.name) + c.code + "\n").join(";\n");
    // The first piece's prologue must stay first so the bundle keeps its mode.
    if (g.strict && !startsStrict(code)) throw new Error("build-webapp: lost the use-strict prologue");
    assertParses(code, `${stem} bundle`);
    return emit(counters[stem] > 1 ? `${stem}-${counters[stem]}` : stem, "js", code);
  });

  // 4. Stylesheets → hashed copies (only when they have no relative url()).
  const links = parseLinks(html);
  const cssSwaps = [];
  for (const l of links) {
    if ((l.attrs.rel || "").toLowerCase() !== "stylesheet") continue;
    const p = localPath(l.attrs.href);
    if (!p) continue;
    const css = (await readSource(p)).toString("utf8");
    if (/url\(\s*(['"]?)(?!data:|\/|https?:)/i.test(css)) continue; // relative url(): keep in place
    const out = emit(p.replace(/^.*\//, "").replace(/\.css$/, ""), "css", css);
    cssSwaps.push({ link: l, url: out.url });
  }

  // 5. Rewrite the shell: edits applied back to front so offsets stay valid.
  const edits = [];
  const lastJs = jsScripts[jsScripts.length - 1];
  for (const s of jsScripts) {
    edits.push({ start: s.start, end: s.end, text: s === lastJs && runtime ? `<script src="${runtime.url}"></script>` : "" });
  }
  groups.forEach((g, i) => {
    g.items.forEach((c, j) => {
      const s = c.script;
      edits.push({ start: s.start, end: s.end, text: j === 0 ? `<script src="${groupOutputs[i].url}"></script>` : "" });
    });
  });
  for (const { link, url } of cssSwaps) {
    edits.push({ start: link.start, end: link.end, text: `<link rel="stylesheet" href="${url}">` });
  }
  edits.sort((a, b) => b.start - a.start);
  let shell = html;
  for (const e of edits) shell = shell.slice(0, e.start) + e.text + shell.slice(e.end);
  // HTML comments describe the development shell; drop them, then the lines
  // that only held a removed tag or comment.
  shell = shell.replace(/<!--[\s\S]*?-->/g, "");
  shell = shell.replace(/\n[ \t]*(?=\n)/g, "");
  const VERSION_PLACEHOLDER = "__DOCTURN_BUILD_VERSION__";
  shell = shell.replace(/<meta charset="utf-8">/i, (m) => `${m}\n<meta name="docturn-build" content="${VERSION_PLACEHOLDER}">`);
  if (!shell.includes(VERSION_PLACEHOLDER)) throw new Error('build-webapp: index.html has no <meta charset="utf-8">');

  // The built shell must not need the in-browser compiler or inline script.
  const left = parseScripts(shell);
  if (left.some((s) => s.kind === "babel")) throw new Error("build-webapp: text/babel left in the built shell");
  if (left.some((s) => !s.src)) throw new Error("build-webapp: inline <script> left in the built shell");
  if (shell.includes("babel.min.js")) throw new Error("build-webapp: built shell still references babel.min.js");

  // 6. Static assets for the precache (and the staleness check).
  const scriptTexts = [...runtimePieces.map((p) => p.code), ...compiled.map((c) => c.source)];
  const statics = staticShellAssets(srcDir, html, scriptTexts);
  for (const p of statics) await readSource(p);

  const version = shortHash(
    Buffer.from(
      shell +
        outputs.map((o) => o.url).join("\n") +
        statics.map((p) => p + ":" + sources[p.replace(/^\//, "")]).join("\n"),
      "utf8",
    ),
  );
  shell = shell.replace(VERSION_PLACEHOLDER, version);
  const index = { url: `${urlBase}/index.html`, file: "index.html", body: Buffer.from(shell, "utf8") };

  const precache = ["/index.html", ...outputs.map((o) => o.url), ...statics];
  if (precache.some(isApiPath)) throw new Error("build-webapp: an /api or /ws URL reached the precache list");

  // 7. Write (to a temp dir), precompress, then swap into place.
  const manifest = {
    schema: BUILD_SCHEMA,
    version,
    builtAt: new Date().toISOString(),
    babel: Babel.version,
    index: index.url,
    bundles: {
      runtime: runtime ? runtime.url : null,
      compiled: groupOutputs.map((o) => o.url),
      css: cssSwaps.map((c) => c.url),
    },
    files: {},
    precache,
    sources,
  };
  await writeBuild(outDir, [index, ...outputs], manifest);

  const total = (k) => Object.values(manifest.files).reduce((a, f) => a + f[k], 0);
  log(
    `build-webapp: ${babelScripts.length} text/babel scripts compiled into ${groupOutputs.length} bundle(s), ` +
      `${runtimePieces.length} head scripts into ${runtime ? 1 : 0}; ${Object.keys(manifest.files).length} files, ` +
      `${(total("bytes") / 1024).toFixed(0)} KB raw / ${(total("br") / 1024).toFixed(0)} KB brotli / ${(total("gzip") / 1024).toFixed(0)} KB gzip; ` +
      `version ${version} → ${outDir} (${Date.now() - t0} ms)`,
  );
  return manifest;
}

/**
 * Write every output plus its .br/.gz variants, then the manifest, into
 * outDir. Hashed files are immutable and keep their names, so they are written
 * next to the previous build's instead of replacing the directory: a server
 * still running the previous build (deploy scripts build first, restart after)
 * keeps finding every file its shell references. index.html and the manifest
 * are replaced atomically (temp file + rename), manifest LAST — a directory
 * whose manifest does not match its files is never treated as a valid build.
 * Finally, files referenced by neither this build nor the previous one are
 * pruned, so exactly two generations are kept.
 */
async function writeBuild(outDir, outputs, manifest) {
  await mkdir(outDir, { recursive: true });
  let previous = null;
  try {
    previous = JSON.parse(await readFile(join(outDir, BUILD_MANIFEST), "utf8"));
  } catch {
    /* first build, or an unreadable manifest: nothing to keep */
  }
  const atomicWrite = async (file, body) => {
    const tmp = join(outDir, `.${posix.basename(file)}.${process.pid}.tmp`);
    await writeFile(tmp, body);
    await rename(tmp, join(outDir, file));
  };
  // Immutable hashed files first, the shell after them, the manifest last.
  const ordered = [...outputs.filter((o) => o.file !== "index.html"), ...outputs.filter((o) => o.file === "index.html")];
  for (const o of ordered) {
    const br = brotliCompressSync(o.body, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: o.body.length,
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      },
    });
    const gz = gzipSync(o.body, { level: 9 });
    // Identity first: the server only trusts a .br/.gz at least as new as it.
    await atomicWrite(o.file, o.body);
    await atomicWrite(o.file + ".br", br);
    await atomicWrite(o.file + ".gz", gz);
    manifest.files[o.url] = { bytes: o.body.length, br: br.length, gzip: gz.length, sha256: sha256(o.body) };
  }
  await atomicWrite(BUILD_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

  const keep = new Set([BUILD_MANIFEST]);
  for (const m of [manifest, previous]) {
    for (const url of Object.keys((m && m.files) || {})) {
      const name = posix.basename(url);
      keep.add(name);
      keep.add(name + ".br");
      keep.add(name + ".gz");
    }
  }
  for (const name of await readdir(outDir)) {
    if (!keep.has(name)) await rm(join(outDir, name), { recursive: true, force: true });
  }
}

/* ── CLI ───────────────────────────────────────────────────────────────────── */

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  buildWebapp({ srcDir: opt("--src"), outDir: opt("--out") }).catch((e) => {
    console.error(e && e.message ? e.message : e);
    process.exit(1);
  });
}
