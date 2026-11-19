#!/usr/bin/env node
/**
 * Static WCAG AA contrast check for the design tokens in webapp/tokens.css
 * (A.CON-SHO-53) — for EVERY display preset a person can choose and EVERY
 * accent an organization can choose.
 *
 * The preset maps and the accent maths are read out of webapp/AppShell.jsx
 * (PALETTES and the pure accentTokens(), evaluated from the file itself), so
 * this check and the browser agree on every derived shade instead of each
 * holding its own copy of the formula. For each of the 5 presets x 8 accents
 * it rebuilds the whole token table and asserts:
 *   - every status colour >= 4.5:1 on its own tint, on the card and on
 *     --secondary, the deeper -fg shades >= 6:1 on the tint;
 *   - muted and body text on the card, the canvas and --secondary;
 *   - the ink on every solid fill (--primary-foreground on --primary,
 *     --destructive-foreground on --destructive, --on-status on each status);
 *   - the accent as TEXT on the card, on --primary-tint and on the tile;
 *   - the ink on the deliberately dark panels (--inverse-*);
 *   - borders visible against the card (nothing invisible);
 *   - 7:1 instead of 4.5:1 throughout the high-contrast preset.
 *
 * Usage: node scripts/contrast-check.mjs            (exit 1 on any failure)
 *        node scripts/contrast-check.mjs --verbose   (print every pair)
 * The rendered counterpart (what the browser actually computes, per preset x
 * text size x width, on the real screens) is scripts/theme-check.mjs.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(ROOT, "webapp", "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const baseTokens = {};
for (const m of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) if (!(m[1] in baseTokens)) baseTokens[m[1]] = m[2].trim();
let tokens = baseTokens;

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

// ---------------------------------------------------------------------------
// The preset maps and the accent maths, read out of webapp/AppShell.jsx so this
// check cannot drift from what the browser computes. The extracted functions
// are plain ES5 with no DOM access — that is exactly why accentTokens() is
// written as a pure function there.
// ---------------------------------------------------------------------------
const shell = fs.readFileSync(path.join(ROOT, "webapp", "AppShell.jsx"), "utf8");
function slice(src, startMarker, open, close) {
  const i = src.indexOf(startMarker);
  if (i < 0) throw new Error("contrast-check: cannot find " + startMarker + " in AppShell.jsx");
  let depth = 0, j = src.indexOf(open, i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === open) depth++;
    else if (src[k] === close && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error("contrast-check: unbalanced " + startMarker);
}
const fn = (name) => slice(shell, "function " + name + "(", "{", "}");
const KIT = new Function(
  [fn("hexToHsl"), fn("hslToRgb255"), fn("relLum"), fn("contrastRatio"), fn("chToRgb255"), fn("fitLightness"),
   slice(shell, "var TILE_BLUE =", "[", "]") + ";",
   "var AA = " + (shell.match(/var AA = ([\d.]+);/) || [, "4.6"])[1] + ";",
   fn("accentTokens"),
   slice(shell, "var PALETTES = {", "{", "}") + ";",
   slice(shell, "var PRESET_MIN = {", "{", "}") + ";",
   "return { PALETTES: PALETTES, PRESET_MIN: PRESET_MIN, accentTokens: accentTokens };"].join("\n"),
)();
// Every accent an organization can pick (webapp/Appearance.jsx ACCENTS): the
// contract has to hold for all of them, not just the shipped blue.
const accentSrc = fs.readFileSync(path.join(ROOT, "webapp", "Appearance.jsx"), "utf8");
const ACCENTS = [...(accentSrc.match(/const ACCENTS = \[[\s\S]*?\];/) || [""])[0].matchAll(/"(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]);
if (ACCENTS.length < 8) { console.log("FAIL  could not read ACCENTS from Appearance.jsx"); process.exit(1); }

// Consult specialty chips (components.jsx SPECIALTY_PALETTE) and the ESI
// triage chips: fixed, self-contained colour LANGUAGES (a chip carries its own
// background and its own ink, in every preset), so they are checked once as
// pairs rather than against the preset's surfaces.
const kit = fs.readFileSync(path.join(ROOT, "webapp", "components.jsx"), "utf8");
const palSrc = (kit.match(/const SPECIALTY_PALETTE = \[([\s\S]*?)\];/) || [])[1] || "";
const palette = [...palSrc.matchAll(/color:\s*"(#[0-9A-Fa-f]{6})",\s*bg:\s*"(#[0-9A-Fa-f]{6})"/g)].map((m) => [m[1], m[2]]);
if (palette.length < 8) { console.log("FAIL  could not read SPECIALTY_PALETTE from components.jsx"); process.exit(1); }
const esiSrc = (kit.match(/const ESI = \{([\s\S]*?)\n\};/) || [])[1] || "";
const esi = [...esiSrc.matchAll(/bg:\s*"(#[0-9A-Fa-f]{6})",\s*fg:\s*"(#[0-9A-Fa-f]{6})"/g)].map((m) => [m[2], m[1]]);
if (esi.length !== 5) { console.log("FAIL  could not read the 5 ESI levels from components.jsx"); process.exit(1); }

const VERBOSE = process.argv.includes("--verbose");
const STATUS = ["pending", "accepted", "active", "rejected", "neutral"];
const PRESETS = ["classic", "calm", "warm", "night", "contrast"];

/** The token table a preset + accent actually renders with. */
function tableFor(preset, accent) {
  const t = { ...baseTokens };
  const palette = KIT.PALETTES[preset] || null;
  if (palette) for (const k of Object.keys(palette)) t[k] = palette[k];
  const min = KIT.PRESET_MIN[preset];
  const derived = KIT.accentTokens(accent, t["--card-ch"], t["--background-ch"], min);
  for (const k of Object.keys(derived)) t[k] = derived[k];
  return { t, min: min || 4.5 };
}

/** Every pair that must hold for one preset. `min` is its text floor. */
function pairsFor(min) {
  const CARD = "var(--card)";
  const CANVAS = "var(--background)";
  const SEC = "var(--secondary)";
  const out = [];
  for (const x of STATUS) {
    out.push([`var(--status-${x})`, `var(--status-${x}-bg)`, min, `status-${x} text on its tint`]);
    out.push([`var(--status-${x}-fg)`, `var(--status-${x}-bg)`, Math.max(min + 1.5, 6.0), `status-${x}-fg badge text on its tint`]);
    out.push([`var(--status-${x})`, CARD, min, `status-${x} on the card`]);
    out.push([`var(--status-${x})`, SEC, min, `status-${x} on --secondary`]);
    // A solid status fill (the STAT bar, an unread count) with ink on it.
    out.push(["var(--on-status)", `var(--status-${x})`, min, `--on-status ink on the solid status-${x} fill`]);
    // The rim must be a line you can see, never text.
    out.push([`var(--status-${x}-rim)`, `var(--status-${x}-bg)`, 1.1, `status-${x}-rim visible on its tint`]);
  }
  out.push(["var(--muted-foreground)", SEC, min, "muted text on --secondary"]);
  out.push(["var(--muted-foreground)", CARD, min, "muted text on the card"]);
  out.push(["var(--muted-foreground)", CANVAS, min, "muted text on the canvas"]);
  out.push(["var(--destructive-foreground)", "var(--destructive)", min, "ink on the destructive fill"]);
  out.push(["var(--destructive)", CARD, min, "destructive as TEXT on the card"]);
  out.push(["var(--primary-foreground)", "var(--primary)", min, "ink on the primary fill"]);
  out.push(["var(--foreground)", SEC, Math.max(min, 7.0), "body text on --secondary"]);
  out.push(["var(--foreground)", CARD, Math.max(min, 7.0), "body text on the card"]);
  out.push(["var(--foreground)", CANVAS, Math.max(min, 7.0), "body text on the canvas"]);
  // Accent text on the accent surfaces: the active nav item / selected chips
  // (--primary on --primary-tint) and initials or labels on the tile.
  // --primary is a FILL only (the operator's exact colour, with
  // --primary-foreground on it); --primary-ink is the accent as TEXT and must
  // read on all four surfaces text can land on.
  out.push(["var(--primary-ink)", CARD, min, "primary-ink (accent text) on the card"]);
  out.push(["var(--primary-ink)", CANVAS, min, "primary-ink (accent text) on the canvas"]);
  out.push(["var(--primary-ink)", "var(--primary-tint)", min, "primary-ink on --primary-tint"]);
  out.push(["var(--primary-ink)", "var(--status-active-bg)", min, "primary-ink on the tile (--status-active-bg)"]);
  // The deliberately dark panels keep their own ink in every preset.
  out.push(["var(--inverse-foreground)", "var(--inverse)", Math.max(min, 7.0), "panel text on --inverse"]);
  out.push(["var(--inverse-muted)", "var(--inverse)", min, "panel muted text on --inverse"]);
  out.push(["var(--inverse-accent)", "var(--inverse)", min, "panel icons/links on --inverse"]);
  out.push(["var(--inverse-warning)", "var(--inverse)", min, "panel warning ink on --inverse"]);
  out.push(["var(--inverse-danger)", "var(--inverse)", min, "panel danger ink on --inverse"]);
  // Nothing invisible: a card's edge and the heavier line must both be seen.
  out.push(["var(--border)", CARD, 1.15, "border visible against the card"]);
  out.push(["var(--border-strong)", CARD, 1.4, "border-strong (switch tracks) visible against the card"]);
  out.push([CARD, "var(--inverse)", 1.2, "a dark panel reads as a panel on the card"]);
  return out;
}

let failed = 0, checked = 0;
for (const preset of PRESETS) {
  let presetFailed = 0;
  for (const accent of ACCENTS) {
    const { t, min } = tableFor(preset, accent);
    tokens = t;
    for (const [fg, bg, floor, label] of pairsFor(min)) {
      const r = ratio(resolve(fg), resolve(bg));
      const ok = r >= floor;
      checked++;
      if (!ok) { failed++; presetFailed++; }
      if (!ok || VERBOSE) console.log(`${ok ? "PASS" : "FAIL"}  ${r.toFixed(2).padStart(5)}:1  (min ${floor})  [${preset} / accent ${accent}]  ${label}`);
    }
  }
  console.log(`${presetFailed ? "FAIL" : "PASS"}  preset ${preset.padEnd(8)} ${ACCENTS.length} accents  ${presetFailed ? presetFailed + " pair(s) below threshold" : "all pairs meet their floor"}`);
}

// The two fixed clinical colour languages, checked as pairs.
tokens = baseTokens;
for (const [c, b] of palette) {
  for (const [fg, bg, floor, label] of [[c, b, 4.5, `specialty chip ${c} on ${b}`], ["var(--on-fixed)", c, 4.5, `--on-fixed ink on the solid specialty ${c}`]]) {
    const r = ratio(resolve(fg), resolve(bg));
    checked++;
    if (r < floor) { failed++; console.log(`FAIL  ${r.toFixed(2)}:1  (min ${floor})  ${label}`); }
    else if (VERBOSE) console.log(`PASS  ${r.toFixed(2)}:1  ${label}`);
  }
}
for (const [fg, bg] of esi) {
  for (const [a, b, label] of [[fg, bg, `ESI chip ${fg} on ${bg}`], ["var(--on-fixed)", fg, `--on-fixed ink on the solid ESI ${fg}`]]) {
    const r = ratio(resolve(a), resolve(b));
    checked++;
    if (r < 4.5) { failed++; console.log(`FAIL  ${r.toFixed(2)}:1  (min 4.5)  ${label}`); }
    else if (VERBOSE) console.log(`PASS  ${r.toFixed(2)}:1  ${label}`);
  }
}

console.log(`\n${checked} pairs checked across ${PRESETS.length} presets x ${ACCENTS.length} accents`);
console.log(failed ? `${failed} contrast pair(s) below threshold` : "All token pairs meet their contrast floor");
process.exit(failed ? 1 : 0);
