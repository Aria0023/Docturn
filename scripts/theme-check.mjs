/**
 * Rendered theme check — the per-user display presets, measured in a real
 * browser on the real screens.
 *
 * scripts/contrast-check.mjs proves the TOKEN table meets its contrast floors
 * for every preset x accent. This proves the SCREENS do: that no component
 * carries a hard-coded colour that survives a dark canvas, and that "large"
 * text does not break the phone rules.
 *
 * For every preset (org, classic, calm, warm, night, contrast) x text size
 * (default, large) x width (375 / 390 / 430) it signs in, stores the preset
 * through the server, reloads, and on each of several screens asserts:
 *   • WCAG AA for every piece of rendered text against the background it
 *     actually sits on (3:1 for large text, per WCAG 1.4.3),
 *   • nothing invisible: no element painted the same colour as the surface
 *     behind it, and no text the colour of its own background,
 *   • tap targets >= 44px and inputs >= 16px (the phone rules),
 *   • no horizontal overflow of the document or <main>,
 *   • zero CSP violations and zero page errors.
 * Then, once:
 *   • the preset round-trips through the server: a reload keeps it, and a
 *     SECOND browser signed in as the same user sees it,
 *   • another user in the same organization is unaffected,
 *   • with the module off the section is gone and the server refuses the PUT.
 *
 * Usage: start a seeded server, then
 *   BASE_URL=http://127.0.0.1:9092 node scripts/theme-check.mjs
 * PRESETS / SIZES / WIDTHS narrow the matrix (comma-separated).
 * Exits non-zero on any failed check.
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ALL_WIDTHS = { 375: 667, 390: 844, 430: 932 };
const WIDTHS = (process.env.WIDTHS || "375,390,430").split(",").map(Number).filter((w) => ALL_WIDTHS[w]);
const PRESETS = (process.env.PRESETS || "org,classic,calm,warm,night,contrast").split(",");
const SIZES = (process.env.SIZES || "default,large").split(",");
const TAP = 44;

const results = [];
let cur = "";
const rec = (name, ok, note = "") => {
  results.push({ name: cur + name, ok, note });
  console.log((ok ? "PASS  " : "FAIL  ") + cur + name + (note ? "  ↳ " + note : ""));
};

// ---------------------------------------------------------------------------
// In-page scanner. Everything it reports is MEASURED from computed styles and
// client rects — nothing is eyeballed and nothing is read from our own tokens.
// ---------------------------------------------------------------------------
const SCANNER = `
window.__themeScan = function () {
  var lum = function (rgb) {
    var c = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  var ratio = function (a, b) { var l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  var parse = function (v) {
    var m = String(v || "").match(/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s/]+([\\d.]+))?/);
    if (!m) return null;
    return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
  };
  var over = function (fg, bg) { // composite fg (with alpha) over an opaque bg
    return [0, 1, 2].map(function (i) { return Math.round(fg.rgb[i] * fg.a + bg[i] * (1 - fg.a)); });
  };
  // The opaque colour actually painted behind \`el\`: walk up compositing every
  // translucent layer. An ancestor with a background-image (a gradient, the
  // synthetic-data stripe) is unknowable from here, so such subtrees are
  // reported separately instead of guessed at.
  var backdrop = function (el) {
    var stack = [], p = el, img = false;
    while (p) {
      var cs = getComputedStyle(p);
      if (cs.backgroundImage && cs.backgroundImage !== "none") img = true;
      var c = parse(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
      p = p.parentElement;
    }
    var base = [255, 255, 255];
    for (var i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return { rgb: base, img: img };
  };
  var visible = function (el, cs) {
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    if (parseFloat(cs.opacity) < 0.15) return false;
    var r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.bottom > -200 && r.top < window.innerHeight + 2000;
  };
  var ownText = function (el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.textContent.trim().length) return n.textContent.trim();
    }
    return "";
  };
  var where = function (el) {
    var t = el.tagName.toLowerCase(), id = el.getAttribute("data-my-preset") || el.getAttribute("data-user-theme") || "";
    return t + (id ? "[" + id + "]" : "") + " \\"" + (ownText(el) || (el.getAttribute("aria-label") || "")).slice(0, 28) + "\\"";
  };

  var dark = getComputedStyle(document.documentElement).colorScheme === "dark";
  var out = { text: [], invisible: [], stray: [], taps: [], inputs: [], gradientText: 0, scanned: 0, dark: dark };
  var all = document.querySelectorAll("body *");
  for (var i = 0; i < all.length; i++) {
    var el = all[i], cs = getComputedStyle(el);
    if (!visible(el, cs)) continue;
    out.scanned++;
    var bd = backdrop(el);

    // --- text contrast (WCAG 1.4.3: 3:1 for large text, else 4.5:1) --------
    var txt = ownText(el);
    if (txt) {
      var fg = parse(cs.color);
      if (fg && fg.a > 0.2) {
        var ink = over(fg, bd.rgb);
        var px = parseFloat(cs.fontSize) || 16;
        var w = parseInt(cs.fontWeight, 10) || 400;
        var large = px >= 24 || (px >= 18.66 && w >= 700);
        var need = large ? 3.0 : 4.5;
        var r = ratio(ink, bd.rgb);
        if (bd.img) out.gradientText++;
        else if (r < need - 0.02) out.text.push({ at: where(el), r: Math.round(r * 100) / 100, need: need, px: px, color: cs.color, bg: "rgb(" + bd.rgb.join(",") + ")" });
      }
    }

    // --- nothing invisible: an element's own opaque paint must differ from
    //     the surface behind it (white card on a white card, or a dark panel
    //     that dissolved into a dark canvas).
    var own = parse(cs.backgroundColor);
    if (own && own.a >= 0.95 && el.getBoundingClientRect().width >= 8 && el.getBoundingClientRect().height >= 8) {
      var parentBd = el.parentElement ? backdrop(el.parentElement) : { rgb: [255, 255, 255], img: false };
      var hasBorder = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderLeftWidth) || 0) > 0 || cs.boxShadow !== "none";
      // A full-bleed layer with square corners is a CANVAS layer (the shell, a
      // scroll pane, <main>): it is painted the canvas colour on purpose and is
      // not meant to read as a surface of its own.
      var r3 = el.getBoundingClientRect();
      var radius = parseFloat(cs.borderTopLeftRadius) || 0;
      var canvasLayer = radius < 2 && r3.width >= window.innerWidth * 0.85;
      // A surface that is EXACTLY its backdrop and draws no edge of its own is
      // invisible; one that draws a border or a shadow is a deliberate flat
      // panel, so it is only a failure if that edge is invisible too.
      // "Invisible" means the SAME COLOUR, not the same luminance: a yellow
      // badge on a grey row has a contrast ratio of 1.0 and is perfectly
      // visible, so the test is per-channel distance. It applies to elements
      // that carry NO text — a dot, a bar, a divider, a swatch, a preview
      // block: things that convey something by their fill alone. Where there
      // IS text, what has to be seen is the text, and the AA sweep covers it.
      var same = Math.max(Math.abs(own.rgb[0] - parentBd.rgb[0]), Math.abs(own.rgb[1] - parentBd.rgb[1]), Math.abs(own.rgb[2] - parentBd.rgb[2]));
      var anyText = (el.textContent || "").trim().length > 0;
      if (same <= 6 && !anyText && !hasBorder && !canvasLayer && !parentBd.img) out.invisible.push({ at: where(el), bg: cs.backgroundColor, behind: "rgb(" + parentBd.rgb.join(",") + ")", w: Math.round(r3.width), h: Math.round(r3.height), radius: radius });

      // The sweep's own regression test: on a DARK canvas nothing may paint a
      // light surface, because that is exactly what a surviving hard-coded
      // #fff looks like. The two fixed clinical colour languages (ESI triage,
      // consult specialty chips) are light on purpose and are exempt because
      // they carry their OWN ink that reads AA on their own fill.
      if (dark && lum(own.rgb) > 0.72) {
        var selfContained = false;
        if (txt) {
          var f2 = parse(cs.color);
          if (f2 && f2.a > 0.2) selfContained = ratio(over(f2, own.rgb), own.rgb) >= 4.5;
        }
        if (!selfContained) out.stray.push({ at: where(el), bg: cs.backgroundColor, w: Math.round(r3.width), h: Math.round(r3.height) });
      }
    }

    // --- phone rules -------------------------------------------------------
    var tag = el.tagName.toLowerCase();
    if (tag === "button" || el.getAttribute("role") === "button") {
      var r2 = el.getBoundingClientRect();
      // Only real, laid-out controls: an icon-only affordance inside another
      // button (the kit nests none) and off-screen rows are skipped above.
      if (r2.height > 0 && r2.height < ${TAP} - 0.5 && !el.closest("[data-compact-rail]")) out.taps.push({ at: where(el), h: Math.round(r2.height * 10) / 10 });
    }
    if (tag === "input" || tag === "select" || tag === "textarea") {
      var type = (el.getAttribute("type") || "text").toLowerCase();
      if (["checkbox", "radio", "range", "file", "hidden"].indexOf(type) < 0) {
        var fpx = parseFloat(cs.fontSize) || 0;
        if (fpx < 16) out.inputs.push({ at: where(el), px: fpx });
      }
    }
  }
  var main = document.querySelector("main");
  out.overflow = {
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    main: main ? main.scrollWidth - main.clientWidth : 0,
    vw: window.innerWidth,
  };
  out.root = (function () {
    var cs = getComputedStyle(document.documentElement);
    return { zoom: cs.zoom, dtZoom: cs.getPropertyValue("--dt-zoom").trim(), scheme: cs.colorScheme,
      bg: cs.getPropertyValue("--background").trim(), card: cs.getPropertyValue("--card").trim(),
      meta: (document.querySelector('meta[name="theme-color"]') || { getAttribute: function () { return null; } }).getAttribute("content"),
      manifest: (document.querySelector('link[rel="manifest"]') || { getAttribute: function () { return null; } }).getAttribute("href") };
  })();
  return out;
};
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser, width, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: ALL_WIDTHS[width] || 844 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA,
    colorScheme: opts.colorScheme || "light",
  });
  const page = await ctx.newPage();
  const errs = [];
  const csp = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|404|Failed to load resource/i.test(m.text())) errs.push("console: " + m.text().slice(0, 160)); });
  await page.addInitScript(SCANNER);
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + (e.blockedURI || "")));
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.DT && window.DT.actions && window.DT.actions.login, null, { timeout: 25000 });
  return { ctx, page, errs, csp };
}

async function signIn(page, role, org, user) {
  await page.evaluate(([r, o, u]) => window.DT.actions.login(r, o, u, "docturn"), [role, org, user]);
  await page.waitForFunction(() => { const s = window.DT.getState(); return s.session && s.session.role; }, null, { timeout: 25000 });
  await sleep(1200);
}

async function go(page, nav) {
  await page.evaluate((n) => window.DT.actions.setNav(n), nav);
  await sleep(700);
}

function report(scan, label, size) {
  const px = scan.root.zoom === "1.125" ? 1.125 : 1;
  if (scan.text.length) {
    rec(label + " AA for every rendered text run", false,
      scan.text.length + " below floor, e.g. " + scan.text.slice(0, 3).map((t) => `${t.at} ${t.r}:1 (need ${t.need}) ${t.color} on ${t.bg}`).join(" | "));
  } else {
    rec(label + " AA for every rendered text run", true, scan.scanned + " elements scanned, " + scan.gradientText + " on a gradient (checked statically)");
  }
  rec(label + " nothing invisible (no surface painted its own backdrop)", scan.invisible.length === 0,
    scan.invisible.length ? scan.invisible.slice(0, 3).map((t) => `${t.at} ${t.bg} on ${t.behind} (${t.w}x${t.h} r${t.radius})`).join(" | ") : "");
  if (scan.dark) {
    rec(label + " no light surface survives on a dark canvas", scan.stray.length === 0,
      scan.stray.length ? scan.stray.length + " stray, e.g. " + scan.stray.slice(0, 3).map((t) => `${t.at} ${t.bg} (${t.w}x${t.h})`).join(" | ") : "");
  }
  rec(label + " tap targets ≥ " + TAP + "px", scan.taps.length === 0,
    scan.taps.length ? scan.taps.length + " short, e.g. " + scan.taps.slice(0, 3).map((t) => `${t.at} ${t.h}px`).join(" | ") : "");
  rec(label + " inputs ≥ 16px", scan.inputs.length === 0,
    scan.inputs.length ? scan.inputs.slice(0, 3).map((t) => `${t.at} ${t.px}px`).join(" | ") : "");
  rec(label + " no horizontal overflow", scan.overflow.doc <= 1 && scan.overflow.main <= 1,
    `doc +${scan.overflow.doc}px, main +${scan.overflow.main}px at ${scan.overflow.vw}px`);
  if (size === "large") rec(label + " large text zooms the root", px === 1.125, "zoom=" + scan.root.zoom + " --dt-zoom=" + scan.root.dtZoom);
}

// Screens chosen to cover the widest spread of the kit's components: the role
// dashboard, the message list + composer, the Appearance screen (which carries
// the theme controls themselves), the directory, "My settings" (the long form
// screen) and the audit trail (dense tables and the dark panels).
const SCREENS = ["dashboard", "messages", "appearance", "directory", "account", "compliance"];

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
try {
  // ---- 1. the matrix: every preset x text size x width -------------------
  for (const width of WIDTHS) {
    const { ctx, page, errs } = await newPage(browser, width);
    await signIn(page, "hospitalist", "ISPN", "chen");
    for (const preset of PRESETS) {
      for (const size of SIZES) {
        cur = `[${width}px ${preset}/${size}] `;
        // followDevice explicitly off: the matrix asserts what each preset
        // renders, and a preset that follows the device would (correctly)
        // render the organization's palette under an emulated light scheme.
        const saved = await page.evaluate(([p, s]) => window.DT.actions.setMyTheme({ preset: p, textSize: s, followDevice: false }), [preset, size]);
        rec("the server stored the preset", saved === true);
        await page.reload({ waitUntil: "networkidle" });
        await page.waitForFunction(() => { const s = window.DT.getState(); return s.session && s.userTheme; }, null, { timeout: 25000 });
        await sleep(1200);
        const live = await page.evaluate(() => window.DT.getState().userTheme);
        rec("a reload keeps it", live.preset === preset && live.textSize === size, JSON.stringify({ preset: live.preset, textSize: live.textSize }));
        const dark = preset === "night" || preset === "contrast";
        const root = await page.evaluate(() => window.__themeScan().root);
        rec("color-scheme + theme-color follow the preset",
          root.scheme === (dark ? "dark" : "light") && /^#[0-9A-F]{6}$/i.test(root.meta || "") && (!dark || /theme=/.test(root.manifest || "")),
          `scheme=${root.scheme} theme-color=${root.meta} manifest=${root.manifest}`);
        for (const nav of SCREENS) {
          await go(page, nav);
          const scan = await page.evaluate(() => window.__themeScan());
          report(scan, nav, size);
        }
        const csp = await page.evaluate(() => window.__csp || []);
        rec("zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
        rec("zero page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
        errs.length = 0;
      }
    }
    await ctx.close();
  }

  // ---- 1b. the rest of the swept surface, in the two dark presets --------
  // The matrix above walks one role's six screens at every size and width;
  // the sweep touched every screen of every role, so each remaining screen is
  // visited once in `night` and once in `contrast`. The stray-light rule is
  // what matters here: a literal colour that survived the sweep paints a light
  // surface on a dark canvas and is caught in one pass.
  for (const leg of [
    { role: "director", org: "ISPN", user: "director", width: 390, navs: ["dashboard", "board", "admissions", "broadcasts", "oncall", "settings", "approvals", "consult", "roles", "compliance-monitor"] },
    { role: "er_doctor", org: "ISPN", user: "er.doc", width: 390, navs: ["dashboard", "oncall", "directory"] },
    { role: "er_director", org: "ISPN", user: "er.director", width: 430, navs: ["dashboard", "board", "broadcasts", "settings"] },
    // the developer console carries the --inverse panels, and the DESKTOP
    // shell (sidebar + topbar) has its own surfaces the phone shell never uses
    { role: "developer", org: "DOCTURN", user: "dev", width: 1200, navs: ["dashboard", "enterprise", "settings", "users", "compliance", "compliance-monitor", "appearance"] },
  ]) {
    const ctx = await browser.newContext({ viewport: { width: leg.width, height: leg.width > 500 ? 900 : (ALL_WIDTHS[leg.width] || 844) }, isMobile: leg.width <= 500, hasTouch: leg.width <= 500, userAgent: leg.width <= 500 ? UA : undefined });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
    await page.addInitScript(SCANNER);
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.DT && window.DT.actions && window.DT.actions.login, null, { timeout: 25000 });
    await signIn(page, leg.role, leg.org, leg.user);
    for (const preset of ["night", "contrast"].filter((p) => PRESETS.includes(p))) {
      cur = `[${leg.width}px ${leg.role} ${preset}] `;
      await page.evaluate((p) => window.DT.actions.setMyTheme({ preset: p, textSize: "default", followDevice: false }), preset);
      await sleep(900);
      for (const nav of leg.navs) {
        await go(page, nav);
        const scan = await page.evaluate(() => window.__themeScan());
        if (!scan.dark) { rec(nav + " renders the dark preset", false, "the page is not dark"); continue; }
        rec(nav + " AA for every rendered text run", scan.text.length === 0,
          scan.text.length ? scan.text.length + " below floor, e.g. " + scan.text.slice(0, 3).map((t) => `${t.at} ${t.r}:1 ${t.color} on ${t.bg}`).join(" | ") : scan.scanned + " elements scanned");
        rec(nav + " no light surface survives on a dark canvas", scan.stray.length === 0,
          scan.stray.length ? scan.stray.length + " stray, e.g. " + scan.stray.slice(0, 3).map((t) => `${t.at} ${t.bg} (${t.w}x${t.h})`).join(" | ") : "");
        rec(nav + " nothing invisible", scan.invisible.length === 0,
          scan.invisible.length ? scan.invisible.slice(0, 2).map((t) => `${t.at} ${t.bg} on ${t.behind}`).join(" | ") : "");
        rec(nav + " no horizontal overflow", scan.overflow.doc <= 1 && scan.overflow.main <= 1, `doc +${scan.overflow.doc}px, main +${scan.overflow.main}px`);
      }
      rec("zero page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
      errs.length = 0;
    }
    await ctx.close();
  }

  // ---- 2. it is the SERVER's, not the browser's --------------------------
  cur = "[round trip] ";
  const a = await newPage(browser, 390);
  await signIn(a.page, "hospitalist", "ISPN", "chen");
  await a.page.evaluate(() => window.DT.actions.setMyTheme({ preset: "night", textSize: "large", followDevice: false }));
  await sleep(800);
  const b = await newPage(browser, 390);
  await signIn(b.page, "hospitalist", "ISPN", "chen");
  const second = await b.page.evaluate(() => window.DT.getState().userTheme);
  rec("a second browser signed in as the same person sees the preset",
    second && second.preset === "night" && second.textSize === "large", JSON.stringify(second && { p: second.preset, t: second.textSize }));
  const darkRoot = await b.page.evaluate(() => window.__themeScan().root);
  rec("and renders dark there too", darkRoot.scheme === "dark", JSON.stringify(darkRoot.bg));
  await b.ctx.close();

  const other = await newPage(browser, 390);
  await signIn(other.page, "hospitalist", "ISPN", "patel");
  const theirs = await other.page.evaluate(() => window.DT.getState().userTheme);
  rec("another person in the same organization is unaffected",
    theirs && theirs.preset === "org" && theirs.textSize === "default", JSON.stringify(theirs && { p: theirs.preset, t: theirs.textSize }));
  const theirRoot = await other.page.evaluate(() => window.__themeScan().root);
  rec("and still sees the organization's light palette", theirRoot.scheme === "light", theirRoot.bg);
  await other.ctx.close();

  // ---- 3. follow the device ----------------------------------------------
  cur = "[follow device] ";
  await a.page.evaluate(() => window.DT.actions.setMyTheme({ preset: "org", textSize: "default", followDevice: true }));
  await sleep(800);
  await a.page.emulateMedia({ colorScheme: "dark" });
  await sleep(600);
  let r1 = await a.page.evaluate(() => window.__themeScan().root);
  rec("a dark device turns the app dark", r1.scheme === "dark", r1.bg);
  await a.page.emulateMedia({ colorScheme: "light" });
  await sleep(600);
  r1 = await a.page.evaluate(() => window.__themeScan().root);
  rec("a light device returns it to the organization's palette", r1.scheme === "light", r1.bg);
  const storedAfter = await a.page.evaluate(() => window.DT.getState().userTheme);
  rec("following the device never rewrites the stored choice", storedAfter.preset === "org" && storedAfter.followDevice === true, JSON.stringify(storedAfter.preset));

  // ---- 4. module off ----------------------------------------------------
  cur = "[module off] ";
  const dev = await newPage(browser, 430);
  await signIn(dev.page, "developer", "DOCTURN", "dev");
  // PATCH /api/dev/modules/:orgId { id, enabled } — the developer console's own
  // route, so the switch is flipped exactly the way an operator flips it.
  const flip = (on) => dev.page.evaluate(async (v) => {
    const orgs = window.DT.getState().orgs || [];
    const ispn = orgs.find((o) => o.code === "ISPN");
    if (!ispn) return 0;
    const r = await fetch("/api/dev/modules/" + ispn.id, {
      method: "PATCH", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "platform.userThemes", enabled: v }),
    });
    return r.status;
  }, on);
  await dev.page.evaluate(() => (window.DT.actions.loadOrgs ? window.DT.actions.loadOrgs() : null));
  await sleep(1200);
  const offStatus = await flip(false);
  rec("the operator switched platform.userThemes off for the org", offStatus === 200, "PATCH → " + offStatus);
  if (offStatus === 200) {
    await a.page.evaluate(() => window.DT.actions.loadModules());
    await sleep(900);
    await a.page.reload({ waitUntil: "networkidle" });
    await a.page.waitForFunction(() => window.DT.getState().session, null, { timeout: 25000 });
    await sleep(1500);
    await go(a.page, "appearance");
    const off = await a.page.evaluate(() => ({
      section: !!document.querySelector("[data-user-theme]"),
      says: !!document.querySelector("[data-user-theme-off]"),
      slice: window.DT.getState().userTheme,
    }));
    rec("the person's theme section is gone and the screen says why", !off.section && off.says, JSON.stringify(off));
    rec("the slice is forgotten (the org's palette only)", off.slice === null);
    const refused = await a.page.evaluate(async () => {
      const r = await fetch("/api/me/theme", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preset: "night", textSize: "default", followDevice: false }) });
      return { status: r.status, body: await r.json().catch(() => null) };
    });
    rec("the server refuses the PUT", refused.status === 404 && refused.body && refused.body.error === "module_disabled", JSON.stringify(refused));
    await flip(true);
  }
  await dev.ctx.close();
  await a.ctx.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length} checks, ${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) { console.log("\nFailures:"); for (const f of failed) console.log("  • " + f.name + (f.note ? "  ↳ " + f.note : "")); }
process.exit(failed.length ? 1 : 0);
