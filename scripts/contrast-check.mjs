#!/usr/bin/env node
/**
 * Static WCAG AA contrast check for the design tokens in webapp/tokens.css
 * (A.CON-SHO-53). Every status colour must read >= 4.5:1 on its own tint, on
 * white and on --secondary; the deeper -fg shades >= 6:1 on the tint; muted
 * text >= 4.5:1 on --secondary and white; white text >= 4.5:1 on the
 * destructive and primary fills.
 *
 * Usage: node scripts/contrast-check.mjs            (exit 1 on any failure)
 * The rendered counterpart (what the browser actually computes, including the
 * applyTheme overrides) runs inside scripts/phone-shell-check.mjs.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(ROOT, "webapp", "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const tokens = {};
for (const m of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) if (!(m[1] in tokens)) tokens[m[1]] = m[2].trim();

const hexToRgb = (h) => {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const hslToRgb = (H, S, L) => {
  S /= 100; L /= 100;
  const k = (n) => (n + H / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
};
function resolve(value, depth = 0) {
  if (depth > 6) throw new Error("token recursion: " + value);
  value = value.trim();
  if (value.startsWith("#")) return hexToRgb(value);
  let m = value.match(/^var\((--[a-zA-Z0-9-]+)\)$/);
  if (m) return resolve(tokens[m[1]], depth + 1);
  m = value.match(/^hsl\(\s*var\((--[a-zA-Z0-9-]+)\)\s*\)$/);
  if (m) { const ch = tokens[m[1]].match(/([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/); return hslToRgb(+ch[1], +ch[2], +ch[3]); }
  m = value.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/);
  if (m) return hslToRgb(+m[1], +m[2], +m[3]);
  if (value === "white") return [255, 255, 255];
  throw new Error("cannot resolve " + value);
}
const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

const WHITE = "#ffffff";
const pairs = [];
for (const x of ["pending", "accepted", "active", "rejected", "neutral"]) {
  pairs.push([`var(--status-${x})`, `var(--status-${x}-bg)`, 4.5, `status-${x} text on its tint`]);
  pairs.push([`var(--status-${x}-fg)`, `var(--status-${x}-bg)`, 6.0, `status-${x}-fg badge text on its tint`]);
  pairs.push([`var(--status-${x})`, WHITE, 4.5, `status-${x} on white`]);
  pairs.push([`var(--status-${x})`, "var(--secondary)", 4.5, `status-${x} on --secondary`]);
}
pairs.push(["var(--muted-foreground)", "var(--secondary)", 4.5, "muted text on --secondary"]);
pairs.push(["var(--muted-foreground)", WHITE, 4.5, "muted text on white"]);
pairs.push([WHITE, "var(--destructive)", 4.5, "white text on destructive"]);
pairs.push([WHITE, "var(--primary)", 4.5, "white text on primary"]);
pairs.push(["var(--foreground)", "var(--secondary)", 7.0, "body text on --secondary"]);

let failed = 0;
for (const [fg, bg, min, label] of pairs) {
  const r = ratio(resolve(fg), resolve(bg));
  const ok = r >= min;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${r.toFixed(2).padStart(5)}:1  (min ${min})  ${label}`);
}
console.log(failed ? `\n${failed} contrast pair(s) below threshold` : "\nAll token pairs meet WCAG AA");
process.exit(failed ? 1 : 0);
