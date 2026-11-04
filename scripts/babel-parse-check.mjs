/**
 * Babel-parse gate for the no-build client.
 *
 * webapp/*.jsx is compiled IN THE BROWSER by @babel/standalone (dev) or by
 * scripts/build-webapp.mjs (bundle), so a syntax error in a .jsx file is not a
 * build failure — it is a blank screen at runtime. This parses each file the
 * browser's way, and the inline <script type="text/babel"> blocks of an .html
 * shell too, so the error shows up in a gate instead of on a phone.
 *
 * Usage:
 *   node scripts/babel-parse-check.mjs webapp/*.jsx webapp/index.html
 *   node scripts/babel-parse-check.mjs            (defaults to all of the above)
 * Exits non-zero on the first file that does not parse.
 */
import Babel from "@babel/standalone";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let files = process.argv.slice(2);
if (files.length === 0) {
  const dir = path.join(ROOT, "webapp");
  files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsx")).map((f) => path.join(dir, f));
  files.push(path.join(dir, "index.html"));
}

const BABEL_TYPES = /type="(text\/babel|text\/jsx)"/;
let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const rel = path.relative(ROOT, path.resolve(f));
  if (f.endsWith(".html")) {
    const blocks = [...src.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => BABEL_TYPES.test(m[1]));
    let n = 0;
    for (const m of blocks) {
      try { Babel.transform(m[2], { presets: ["react"], filename: rel }); n++; }
      catch (e) { bad++; console.log(`FAIL  ${rel} inline block ${n}: ${String(e.message).split("\n")[0]}`); }
    }
    console.log(`${bad ? "FAIL" : "PASS"}  ${rel}  (${n}/${blocks.length} inline text/babel blocks)`);
  } else {
    try { Babel.transform(src, { presets: ["react"], filename: rel }); console.log("PASS  " + rel); }
    catch (e) { bad++; console.log(`FAIL  ${rel}: ${String(e.message).split("\n")[0]}`); }
  }
}
console.log(bad ? `\n${bad} file(s)/block(s) do not parse` : `\nAll ${files.length} file(s) parse`);
process.exit(bad ? 1 : 0);
