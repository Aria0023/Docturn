#!/usr/bin/env node
/**
 * Phone-shell regression check (playwright-core + the bundled Chromium).
 *
 * MEASURES — never eyeballs — the iPhone PWA shell against a running, seeded
 * server (RATE_LIMIT=off recommended). Simulates a Face-ID iPhone with the CDP
 * safe-area override (34px home indicator; 59px ears in landscape) and checks:
 *
 *  - bottom tab bar: 58px tab row ABOVE the inset, icons+labels inside the bar,
 *    <main> reserves exactly the bar's height; thread composer sits flush on the
 *    bar with no dead band                                  (A.CON-SHO-42/45/46/60)
 *  - landscape phone keeps the mobile shell, content and tab bar honour the
 *    left/right insets, no horizontal overflow; the compact landscape tab bar
 *    (44px row); an OPEN thread gets the full height — composer tappable on
 *    the inset, message list >= 120px, even with the install banner
 *                                                            (A.CON-MIN-10, A.CON-NEE-2)
 *  - every control >= 44x44 CSS px, every text control >= 16px, no UI text
 *    under 12px, on every primary screen                    (A.CON-SHO-52, -12/44/51/57, A.CON-MIN-11)
 *  - login: role picker keeps 2 columns, "Sign in" above the 390x844 fold
 *    and on short screens (375x667, Safari's 390x664), forms carry the
 *    iOS/autofill attributes, Enter submits                  (A.CON-MIN-12, A.CON-SHO-12/57)
 *  - Patient board: every select (the "Assign…" reassign included) >= 16px;
 *    the data-source banner wraps, Connect EHR on its own row (A.CON-SHO-44/51, A.CON-MIN-12)
 *  - deep links /messages/42 and /messages/ render the shell  (A.CON-SHO-58)
 *  - lock survives a reload, the /api/modules poll pauses while locked and
 *    resumes after a real unlock, a wrong password stays locked; the lock is
 *    the SERVER's: the page's own fetches get 423, the socket closes, ward
 *    activity triggers zero requests, and deleting the browser's lock flag
 *    then reloading still lands on the lock screen          (A.CON-SHO-7)
 *  - status tokens as the browser renders them meet 4.5:1, and a sweep of
 *    every visible text node (4 roles, phone) finds nothing under AA
 *                                                            (A.CON-SHO-53)
 *  - iOS polish CSS is in effect (tap highlight, overscroll, text-size-adjust) (A.CON-MIN-16)
 *
 * Usage: BASE_URL=http://127.0.0.1:5050 node scripts/phone-shell-check.mjs [--shots DIR]
 * Exit code 1 on any failed check. Credentials: seeded synthetic org ISPN.
 */
import { chromium } from "playwright-core";
import fs from "fs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const SHOTS = (() => { const i = process.argv.indexOf("--shots"); return i > 0 ? process.argv[i + 1] : null; })();
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CREDS = { org: "ISPN", user: "chen", pass: "docturn" };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });

async function phone({ w, h, insets, clock }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  const page = await ctx.newPage();
  if (clock) await page.clock.install();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 0, bottom: 0, right: 0, ...(insets || {}) } });
  return { ctx, page, cdp };
}
async function desktop() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  return { ctx, page: await ctx.newPage() };
}
async function login(page, creds = CREDS) {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForSelector("form input[name=username]", { timeout: 20000 });
  await page.fill("input[name=organization]", creds.org);
  await page.fill("input[name=username]", creds.user);
  await page.fill("input[name=password]", creds.pass);
  await page.click("form button[type=submit]");
  await page.waitForSelector("nav[aria-label=Primary], aside", { timeout: 20000 });
  await page.waitForTimeout(600);
}
const shot = (page, name) => SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {}) : Promise.resolve();

// Geometry/typography/target audit of the current screen. Runs in the page.
const auditScreen = (page) => page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("[aria-hidden=true]"); };
  const snippet = (el) => (el.getAttribute("aria-label") || el.getAttribute("title") || (el.textContent || "").trim().slice(0, 30) || el.tagName.toLowerCase()).replace(/\s+/g, " ");
  const targets = [...document.querySelectorAll("button, [role=button], select, input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=hidden]), textarea")].filter(vis);
  const smallTargets = targets.filter((el) => { const r = el.getBoundingClientRect(); return r.height < 43.5 || (el.matches("button, [role=button]") && r.width < 43.5); })
    .map((el) => { const r = el.getBoundingClientRect(); return `${snippet(el)} ${Math.round(r.width)}x${Math.round(r.height)}`; });
  const controls = [...document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=hidden]), select, textarea")].filter(vis);
  const smallFontControls = controls.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => `${snippet(el)} ${getComputedStyle(el).fontSize}`);
  const smallText = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest("script, style, [aria-hidden=true]") || !vis(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12) smallText.push(`"${n.nodeValue.trim().slice(0, 24)}" ${fs}px`);
  }
  const main = document.querySelector("main");
  return {
    smallTargets, smallFontControls, smallText: [...new Set(smallText)],
    docOverflow: document.documentElement.scrollWidth - innerWidth,
    mainOverflow: main ? main.scrollWidth - main.clientWidth : 0,
  };
});

const navRects = (page) => page.evaluate(() => {
  const nav = document.querySelector("nav[aria-label=Primary]");
  if (!nav) return null;
  const nr = nav.getBoundingClientRect(); const cs = getComputedStyle(nav);
  const inset = parseFloat(cs.paddingBottom) || 0;
  const tabs = [...nav.querySelectorAll(":scope > button")].map((b) => {
    const br = b.getBoundingClientRect();
    const icon = b.querySelector("svg") || b.querySelector("span");
    const label = [...b.querySelectorAll("span")].find((s) => s.textContent.trim());
    const ir = icon ? icon.getBoundingClientRect() : null, lr = label ? label.getBoundingClientRect() : null;
    return { top: br.top, bottom: br.bottom, height: br.height, width: br.width, iconTop: ir && ir.top, iconBottom: ir && ir.bottom, labelBottom: lr && lr.bottom, labelFs: label ? parseFloat(getComputedStyle(label).fontSize) : null, left: br.left, right: br.right };
  });
  const main = document.querySelector("main");
  const mr = main.getBoundingClientRect();
  const shell = document.querySelector(".dt-mobile-shell");
  const header = document.querySelector("header");
  const composer = document.querySelector("input[aria-label=Message]");
  const composerBox = composer ? composer.closest("div[style*='border-top']") : null;
  return {
    nav: { top: nr.top, bottom: nr.bottom, height: nr.height, left: nr.left, right: nr.right, inset, padLeft: parseFloat(cs.paddingLeft), padRight: parseFloat(cs.paddingRight) },
    tabs, mainPB: parseFloat(getComputedStyle(main).paddingBottom), mainBottom: mr.bottom, mainTop: mr.top, mainLeft: mr.left, mainRight: mr.right,
    shellPadLeft: shell ? parseFloat(getComputedStyle(shell).paddingLeft) : null, shellPadRight: shell ? parseFloat(getComputedStyle(shell).paddingRight) : null,
    headerBtns: header ? [...header.querySelectorAll("button")].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }) : [],
    headerLeft: header ? header.getBoundingClientRect().left : null,
    composerBottom: composerBox ? composerBox.getBoundingClientRect().bottom : null,
    composerInputBottom: composer ? composer.getBoundingClientRect().bottom : null,
    vh: innerHeight, vw: innerWidth,
  };
});

// Open a thread with the first directory colleague and measure it (landscape).
async function openThreadAndMeasure(page) {
  const banner = await page.evaluate(() => !!document.querySelector(".dt-install-slot > div"));
  await page.evaluate(() => { const d = (window.DT.getState().directory || []).find((p) => p.id !== (window.DT.getState().me || {}).id); if (d) window.DT.actions.startConversation(d); window.DT.actions.setNav("messages"); });
  await page.waitForTimeout(900);
  if (!(await page.locator("input[aria-label=Message]").count())) {
    const row = page.locator("main button[style*='border-bottom']").first();
    if (await row.count()) await row.click();
  }
  if (!(await page.waitForSelector("input[aria-label=Message]", { timeout: 8000 }).then(() => true).catch(() => false))) return null;
  await page.waitForTimeout(400);
  return page.evaluate((b) => {
    const inp = document.querySelector("input[aria-label=Message]"); const r = inp.getBoundingClientRect();
    return {
      banner: b,
      inputTappable: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === inp,
      listH: Math.round(document.querySelector("[data-thread-scroll]").getBoundingClientRect().height),
      composerBottom: Math.round(document.querySelector("[data-composer]").getBoundingClientRect().bottom),
    };
  }, banner);
}

// ---------------------------------------------------------------------------
// 1. Tab bar geometry at three iPhone widths with a 34px home indicator (and
//    once with no inset), plus the thread composer.
for (const [w, h, inset] of [[375, 667, 34], [390, 844, 34], [430, 932, 34], [390, 844, 0]]) {
  const tag = `${w}x${h} inset${inset}`;
  const { ctx, page } = await phone({ w, h, insets: { bottom: inset } });
  try {
    await login(page);
    const m = await navRects(page);
    check(`${tag}: mobile shell rendered`, !!m);
    if (m) {
      check(`${tag}: tab bar height = 58 + inset`, Math.abs(m.nav.height - (58 + inset)) <= 1, `nav ${m.nav.height.toFixed(1)}px, inset ${m.nav.inset}`);
      check(`${tag}: tab row sits above the inset`, m.tabs.length >= 2 && m.tabs.every((t) => t.bottom <= m.nav.bottom - inset + 1 && t.top >= m.nav.top - 0.5), m.tabs.map((t) => `${t.top.toFixed(0)}-${t.bottom.toFixed(0)}`).join(" "));
      check(`${tag}: every tab >= 44x44`, m.tabs.every((t) => t.height >= 44 && t.width >= 44), m.tabs.map((t) => `${Math.round(t.width)}x${Math.round(t.height)}`).join(" "));
      check(`${tag}: icons and labels inside the bar`, m.tabs.every((t) => t.iconTop >= m.nav.top && t.labelBottom <= m.nav.bottom - inset + 1), `icon tops ${m.tabs.map((t) => t.iconTop && t.iconTop.toFixed(1)).join(",")} vs nav top ${m.nav.top}`);
      check(`${tag}: tab labels >= 12px`, m.tabs.every((t) => t.labelFs >= 12), m.tabs.map((t) => t.labelFs).join(","));
      check(`${tag}: main reserves exactly the bar height`, Math.abs(m.mainPB - m.nav.height) <= 1 && Math.abs(m.mainBottom - m.vh) <= 1, `main padding-bottom ${m.mainPB}, nav ${m.nav.height.toFixed(1)}, main bottom ${m.mainBottom.toFixed(1)}/${m.vh}`);
      check(`${tag}: header bell/lock are 44x44`, m.headerBtns.length === 2 && m.headerBtns.every(([bw, bh]) => bw >= 44 && bh >= 44), JSON.stringify(m.headerBtns));
    }
    await shot(page, `tabbar-${w}x${h}-inset${inset}`);
    // Thread composer: start a conversation with the first directory colleague
    // (the same store action the Directory's "Message" button uses — the seeded
    // hospitalist has no threads yet), open it, and measure the composer.
    await page.evaluate(() => { const d = (window.DT.getState().directory || []).find((p) => p.id !== (window.DT.getState().me || {}).id); if (d) window.DT.actions.startConversation(d); window.DT.actions.setNav("messages"); });
    await page.waitForTimeout(900);
    if (!(await page.locator("input[aria-label=Message]").count())) {
      const row = page.locator("main button[style*='border-bottom']").first();
      if (await row.count()) await row.click();
    }
    const gotComposer = await page.waitForSelector("input[aria-label=Message]", { timeout: 8000 }).then(() => true).catch(() => false);
    if (gotComposer) {
      const c = await navRects(page);
      check(`${tag}: composer flush on the tab bar (no dead band)`, c.composerBottom != null && Math.abs(c.composerBottom - c.nav.top) <= 1.5, `composer bottom ${c.composerBottom && c.composerBottom.toFixed(1)} vs nav top ${c.nav.top.toFixed(1)}`);
      check(`${tag}: composer input above the bar`, c.composerInputBottom != null && c.composerInputBottom <= c.nav.top + 0.5, `${c.composerInputBottom && c.composerInputBottom.toFixed(1)} <= ${c.nav.top.toFixed(1)}`);
      await shot(page, `composer-${w}x${h}-inset${inset}`);
    } else check(`${tag}: composer measured`, false, "no composer input found after starting a conversation");
  } catch (e) { check(`${tag}: run`, false, e.message); }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 2. Landscape phone (844x390, 932x430) with 59px ears: mobile shell + insets.
for (const [w, h] of [[844, 390], [932, 430]]) {
  const tag = `landscape ${w}x${h}`;
  const { ctx, page } = await phone({ w, h, insets: { left: 59, right: 59, bottom: 21 } });
  try {
    await login(page);
    const m = await navRects(page);
    const hasAside = await page.locator("aside").count();
    check(`${tag}: keeps the mobile shell (no sidebar)`, !!m && hasAside === 0);
    if (m) {
      check(`${tag}: tab bar content inset by the left/right safe areas`, Math.abs(m.nav.padLeft - 59) < 1 && Math.abs(m.nav.padRight - 59) < 1 && m.tabs[0].left >= 59 && m.tabs[m.tabs.length - 1].right <= w - 59 + 0.5, `padL ${m.nav.padLeft} padR ${m.nav.padRight} first tab left ${m.tabs[0].left.toFixed(1)}`);
      check(`${tag}: shell content inset by the left/right safe areas`, Math.abs(m.shellPadLeft - 59) < 1 && Math.abs(m.shellPadRight - 59) < 1 && m.headerLeft >= 59 && m.mainLeft >= 59 && m.mainRight <= w - 59 + 0.5, `shell padL ${m.shellPadLeft} padR ${m.shellPadRight} main ${m.mainLeft}-${m.mainRight}`);
      check(`${tag}: compact landscape bar = 44 + 21, tabs >= 44`, Math.abs(m.nav.height - 65) <= 1 && m.tabs.every((t) => t.height >= 44 && t.width >= 44), `${m.nav.height}`);
    }
    const a = await auditScreen(page);
    check(`${tag}: no horizontal overflow`, a.docOverflow <= 0 && a.mainOverflow <= 0, `doc +${a.docOverflow} main +${a.mainOverflow}`);
    await shot(page, `landscape-${w}x${h}`);
    const t = await openThreadAndMeasure(page);
    check(`${tag}: thread composer input is tappable`, t && t.inputTappable, JSON.stringify(t));
    check(`${tag}: thread composer sits on the home-indicator inset`, t && Math.abs(t.composerBottom - (h - 21)) <= 1.5, t && `composer bottom ${t.composerBottom} vs ${h - 21}`);
    check(`${tag}: thread message list >= 120px`, t && t.listH >= 120, t && `${t.listH}px (install banner: ${t.banner})`);
    await shot(page, `landscape-thread-${w}x${h}`);
  } catch (e) { check(`${tag}: run`, false, e.message); }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 3. Ergonomics audit across screens at 390x844 (hospitalist) and a director.
const SCREENS = ["dashboard", "messages", "directory", "oncall", "history", "compliance", "account"];
const DIRECTOR_SCREENS = ["dashboard", "board", "admissions", "messages", "directory", "oncall", "approvals", "broadcasts", "settings", "compliance", "account"];
for (const creds of [CREDS, { org: "ISPN", user: "director", pass: "docturn" }]) {
  const { ctx, page } = await phone({ w: 390, h: 844, insets: { bottom: 34 } });
  try {
    await login(page, creds);
    for (const id of (creds.user === "director" ? DIRECTOR_SCREENS : SCREENS)) {
      await page.evaluate((nid) => window.DT.actions.setNav(nid), id);
      await page.waitForTimeout(500);
      const a = await auditScreen(page);
      const tag = `${creds.user}/${id}`;
      check(`${tag}: all controls >= 44x44`, a.smallTargets.length === 0, a.smallTargets.slice(0, 6).join(" | "));
      check(`${tag}: text controls >= 16px`, a.smallFontControls.length === 0, a.smallFontControls.slice(0, 4).join(" | "));
      check(`${tag}: no text under 12px`, a.smallText.length === 0, a.smallText.slice(0, 6).join(" | "));
      check(`${tag}: no horizontal overflow`, a.docOverflow <= 0, `doc +${a.docOverflow}`);
      if (id === "board") {
        const b = await page.evaluate(() => {
          const sels = [...document.querySelectorAll("main select")].map((x) => parseFloat(getComputedStyle(x).fontSize));
          const ban = document.querySelector("[data-testid=data-source-banner]");
          if (!ban) return { sels, ban: null };
          const tr = ban.children[1].getBoundingClientRect(); const btn = ban.querySelector("button");
          const br = btn ? btn.getBoundingClientRect() : null;
          return { sels, ban: { wrap: getComputedStyle(ban).flexWrap, textW: Math.round(tr.width), textBottom: Math.round(tr.bottom), btnTop: br && Math.round(br.top), btnW: br && Math.round(br.width) } };
        });
        check(`${tag}: every board select (Assign… included) >= 16px`, b.sels.length > 0 && b.sels.every((f) => f >= 16), JSON.stringify(b.sels));
        check(`${tag}: data-source banner wraps, text >= 200px wide, Connect EHR on its own row`, b.ban && b.ban.wrap === "wrap" && b.ban.textW >= 200 && (b.ban.btnTop == null || (b.ban.btnTop >= b.ban.textBottom && b.ban.btnW >= 300)), JSON.stringify(b.ban));
      }
      await shot(page, `audit-${creds.user}-${id}`);
    }
    // The More drawer (Sidebar footer actions) at phone width.
    await page.click("nav[aria-label=Primary] button[aria-label=More]");
    await page.waitForTimeout(400);
    const d = await page.evaluate(() => {
      const aside = document.querySelector("aside"); if (!aside) return null;
      const ar = aside.getBoundingClientRect();
      const btns = [...aside.querySelectorAll("button")].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
      const panel = aside.closest("div[style*='fixed']");
      return { btns, overflow: panel ? panel.scrollWidth - panel.clientWidth : 0, width: ar.width };
    });
    check(`${creds.user}/drawer: sidebar buttons >= 44 tall`, d && d.btns.every(([, bh]) => bh >= 44), d && JSON.stringify(d.btns.slice(-4)));
    check(`${creds.user}/drawer: no overflow`, d && d.overflow <= 0, d && `+${d.overflow}`);
    await shot(page, `drawer-${creds.user}`);
  } catch (e) { check(`${creds.user}: audit run`, false, e.message); }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 4. Login screen: 2-column picker, Sign in above the fold, attributes, Enter.
{
  const { ctx, page } = await phone({ w: 390, h: 844, insets: { bottom: 34 } });
  try {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.waitForSelector("form input[name=username]");
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const grid = document.querySelector("div[data-keep-cols]");
      const cols = grid ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length : 0;
      const submit = document.querySelector("form button[type=submit]");
      const sr = submit.getBoundingClientRect();
      const attrs = (sel) => { const el = document.querySelector(sel); return el ? { ac: el.getAttribute("autocomplete"), cap: el.getAttribute("autocapitalize"), corr: el.getAttribute("autocorrect"), spell: el.getAttribute("spellcheck"), name: el.getAttribute("name"), fs: getComputedStyle(el).fontSize, labelled: !!(el.id && document.querySelector(`label[for="${el.id}"]`)) } : null; };
      return { cols, submitBottom: sr.bottom, submitH: sr.height, vh: innerHeight, org: attrs("input[name=organization]"), user: attrs("input[name=username]"), pass: attrs("input[name=password]"), form: !!document.querySelector("form"), docOverflow: document.documentElement.scrollWidth - innerWidth };
    });
    check("login 390x844: role picker keeps 2 columns", m.cols === 2, `${m.cols} columns`);
    check("login 390x844: Sign in above the fold", m.submitBottom <= m.vh, `submit bottom ${m.submitBottom.toFixed(0)} / ${m.vh}`);
    check("login: real <form>", m.form);
    check("login: org field attrs", m.org && m.org.cap === "characters" && m.org.corr === "off" && m.org.spell === "false" && m.org.name === "organization" && m.org.labelled, JSON.stringify(m.org));
    check("login: username field attrs", m.user && m.user.ac === "username" && m.user.cap === "none" && m.user.corr === "off" && m.user.spell === "false" && m.user.labelled, JSON.stringify(m.user));
    check("login: password autocomplete=current-password", m.pass && m.pass.ac === "current-password" && m.pass.name === "password", JSON.stringify(m.pass));
    check("login: inputs >= 16px", [m.org, m.user, m.pass].every((x) => x && parseFloat(x.fs) >= 16), [m.org, m.user, m.pass].map((x) => x && x.fs).join(","));
    check("login: no horizontal overflow", m.docOverflow <= 0, `+${m.docOverflow}`);
    const a = await auditScreen(page);
    check("login: all controls >= 44x44", a.smallTargets.length === 0, a.smallTargets.slice(0, 6).join(" | "));
    check("login: no text under 12px", a.smallText.length === 0, a.smallText.slice(0, 6).join(" | "));
    await shot(page, "login-390x844");
    // Register form attributes.
    await page.click("button:has-text('Create an account')");
    await page.waitForSelector("input[name=new-password]");
    const r = await page.evaluate(() => {
      const g = (sel, a) => { const el = document.querySelector(sel); return el && el.getAttribute(a); };
      return { newPw: g("input[name=new-password]", "autocomplete"), name: g("input[name=name]", "autocomplete"), nameCap: g("input[name=name]", "autocapitalize"), user: g("form input[name=username]", "autocomplete"), userCap: g("form input[name=username]", "autocapitalize"), org: g("form input[name=organization]", "autocapitalize"), form: !!document.querySelector("form") };
    });
    check("register: field attrs", r.newPw === "new-password" && r.name === "name" && r.nameCap === "words" && r.user === "username" && r.userCap === "none" && r.org === "characters" && r.form, JSON.stringify(r));
    await page.click("button:has-text('Back to sign in')");
    // Enter in the password field submits the form.
    await page.waitForSelector("input[name=password]");
    await page.fill("input[name=organization]", CREDS.org);
    await page.fill("input[name=username]", CREDS.user);
    await page.fill("input[name=password]", CREDS.pass);
    await page.press("input[name=password]", "Enter");
    const navOk = await page.waitForSelector("nav[aria-label=Primary]", { timeout: 15000 }).then(() => true).catch(() => false);
    check("login: Enter/Go submits the form", navOk);
  } catch (e) { check("login: run", false, e.message); }
  await ctx.close();
}

// 4b. Short phone screens: "Sign in" above the fold (compact role picker).
for (const [w, h] of [[375, 667], [390, 664]]) {
  const { ctx, page } = await phone({ w, h });
  try {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.waitForSelector("form input[name=username]");
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => { const b = document.querySelector("form button[type=submit]").getBoundingClientRect(); const sel = document.querySelector("#dt-demo-role"); return { bottom: Math.round(b.bottom), vh: innerHeight, sel: sel ? parseFloat(getComputedStyle(sel).fontSize) : null }; });
    check(`login ${w}x${h}: Sign in above the fold`, m.bottom <= m.vh, `submit bottom ${m.bottom} / ${m.vh}`);
    if (m.sel != null) {
      await page.selectOption("#dt-demo-role", "er_doctor");
      check(`login ${w}x${h}: compact demo picker (16px) still pre-fills`, m.sel >= 16 && (await page.inputValue("input[name=username]")) === "er.doc");
    }
    await shot(page, `login-${w}x${h}`);
  } catch (e) { check(`login ${w}x${h}: run`, false, e.message); }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 5. Deep links render the shell (no nosniff-blocked relative assets).
for (const p of ["/messages/42", "/messages/", "/board/x/y"]) {
  const { ctx, page } = await phone({ w: 390, h: 844 });
  const refused = [];
  page.on("console", (msg) => { if (msg.type() === "error" && /Refused|MIME/.test(msg.text())) refused.push(msg.text().slice(0, 100)); });
  try {
    await page.goto(BASE + p, { waitUntil: "networkidle" });
    const ok = await page.waitForSelector("form input[name=username]", { timeout: 15000 }).then(() => true).catch(() => false);
    check(`deep link ${p}: login shell renders`, ok && refused.length === 0, refused[0] || "");
  } catch (e) { check(`deep link ${p}: run`, false, e.message); }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 6. Lock: survives reload, pauses the module poll, wrong password stays locked,
//    correct password unlocks and polling resumes. Uses the fake clock to
//    advance the 60s poll without waiting.
{
  const { ctx, page } = await phone({ w: 390, h: 844, insets: { bottom: 34 }, clock: true });
  const modulesHits = [];
  page.on("request", (req) => { if (/\/api\/modules(\?|$)/.test(req.url())) modulesHits.push(Date.now()); });
  try {
    await login(page);
    await page.clock.runFor(61_000);
    await page.waitForTimeout(400);
    const before = modulesHits.length;
    check("lock: module poll runs while unlocked", before >= 1, `${before} /api/modules request(s) after 61s`);
    await page.click("header button[aria-label='Lock app']");
    await page.waitForSelector("[role=dialog][aria-labelledby=dt-lock-title]", { timeout: 5000 });
    const flag = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("docturn.lock")); } catch (e) { return null; } });
    check("lock: persisted flag written", !!(flag && flag.locked && flag.org === "ISPN" && flag.user === "chen"), JSON.stringify(flag));
    const shellGone = await page.evaluate(() => !document.querySelector("nav[aria-label=Primary]") && !document.querySelector("main"));
    check("lock: shell unmounted behind the lock (nothing readable in the DOM)", shellGone);
    const snapshotGone = await page.evaluate(() => { try { const raw = localStorage.getItem("docturn.state.v2") || localStorage.getItem("docturn"); return raw; } catch (e) { return "err"; } });
    void snapshotGone;
    const hitsAtLock = modulesHits.length;
    await page.clock.runFor(185_000);
    await page.waitForTimeout(400);
    check("lock: /api/modules poll paused while locked", modulesHits.length === hitsAtLock, `${modulesHits.length - hitsAtLock} request(s) in 3 simulated minutes`);
    await page.reload({ waitUntil: "networkidle" });
    const stillLocked = await page.waitForSelector("[role=dialog][aria-labelledby=dt-lock-title]", { timeout: 10000 }).then(() => true).catch(() => false);
    const noShellAfterReload = await page.evaluate(() => !document.querySelector("nav[aria-label=Primary]") && !document.querySelector("form input[name=organization]"));
    check("lock: survives F5 (lock screen, no shell, no login form)", stillLocked && noShellAfterReload);
    await shot(page, "lock-after-reload");
    await page.fill("[role=dialog] input[type=password]", "wrong-password");
    await page.click("[role=dialog] button[type=submit]");
    await page.waitForSelector("[role=dialog] [role=alert]", { timeout: 10000 });
    const stillLocked2 = await page.evaluate(() => !!document.querySelector("[role=dialog][aria-labelledby=dt-lock-title]") && !!localStorage.getItem("docturn.lock"));
    check("lock: wrong password keeps it locked", stillLocked2);
    await page.fill("[role=dialog] input[type=password]", CREDS.pass);
    await page.click("[role=dialog] button[type=submit]");
    const unlocked = await page.waitForSelector("nav[aria-label=Primary]", { timeout: 15000 }).then(() => true).catch(() => false);
    const flagCleared = await page.evaluate(() => !localStorage.getItem("docturn.lock"));
    check("lock: correct password unlocks and clears the flag", unlocked && flagCleared);
    await page.waitForTimeout(500);
    const hitsAfterUnlock = modulesHits.length;
    await page.clock.runFor(61_000);
    await page.waitForTimeout(400);
    check("lock: module poll resumes after unlock", modulesHits.length > hitsAfterUnlock, `${modulesHits.length - hitsAfterUnlock} request(s) after 61s`);
  } catch (e) { check("lock: run", false, e.message); }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 7. Rendered contrast of the status tokens + iOS polish CSS in effect.
{
  const { ctx, page } = await phone({ w: 390, h: 844 });
  try {
    await login(page);
    const c = await page.evaluate(() => {
      const probe = (fg, bg) => { const el = document.createElement("span"); el.style.color = fg; el.style.background = bg; el.textContent = "x"; document.body.appendChild(el); const cs = getComputedStyle(el); const out = { fg: cs.color, bg: cs.backgroundColor }; el.remove(); return out; };
      const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
      const pairs = [];
      for (const x of ["pending", "accepted", "active", "rejected", "neutral"]) {
        pairs.push([`var(--status-${x})`, `var(--status-${x}-bg)`, 4.5]);
        pairs.push([`var(--status-${x}-fg)`, `var(--status-${x}-bg)`, 6]);
        pairs.push([`var(--status-${x})`, "#fff", 4.5]);
      }
      pairs.push(["var(--muted-foreground)", "var(--secondary)", 4.5]);
      pairs.push(["#fff", "var(--destructive)", 4.5]);
      pairs.push(["#fff", "var(--primary)", 4.5]);
      const out = pairs.map(([fg, bg, min]) => { const p = probe(fg, bg); const r = ratio(rgb(p.fg), rgb(p.bg)); return { fg, bg, r: +r.toFixed(2), min, ok: r >= min }; });
      const b = document.querySelector("button"); const bcs = getComputedStyle(b); const hcs = getComputedStyle(document.documentElement);
      return { pairs: out, tap: bcs.webkitTapHighlightColor, overscroll: hcs.overscrollBehavior || hcs.overscrollBehaviorY, tsa: hcs.webkitTextSizeAdjust || hcs.textSizeAdjust, touchAction: bcs.touchAction };
    });
    for (const p of c.pairs) check(`contrast ${p.fg} on ${p.bg} >= ${p.min}:1`, p.ok, `${p.r}:1`);
    check("iOS polish: tap highlight transparent", /rgba\(0, 0, 0, 0\)|transparent/.test(c.tap), c.tap);
    check("iOS polish: overscroll-behavior none on html", /none/.test(c.overscroll), c.overscroll);
    check("iOS polish: text-size-adjust 100%", /100%/.test(c.tsa), c.tsa);
    check("iOS polish: touch-action manipulation on buttons", /manipulation/.test(c.touchAction), c.touchAction);
  } catch (e) { check("contrast: run", false, e.message); }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 6b. The lock is the SERVER's (A.CON-SHO-7 fix-up): 423 for the page's own
//     fetches, socket closed, zero requests during ward activity (an admission
//     routed to this user + an org broadcast), and a reload with every
//     browser-side trace of the lock deleted still lands on the lock screen.
{
  const { ctx, page } = await phone({ w: 390, h: 844, insets: { bottom: 34 } });
  const reqs = [];
  page.on("request", (r) => { if (r.url().includes("/api/")) reqs.push({ t: Date.now(), u: r.method() + " " + r.url().replace(BASE, "") }); });
  const sockets = [];
  page.on("websocket", (ws) => { const sk = { closed: false }; sockets.push(sk); ws.on("close", () => { sk.closed = true; }); });
  const asUser = async (username) => {
    const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgCode: "ISPN", username, password: "docturn" }) });
    const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
    return (method, path, body) => fetch(BASE + path, { method, headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (x) => ({ status: x.status, body: await x.json().catch(() => null) }));
  };
  try {
    await login(page, { org: "ISPN", user: "patel", pass: "docturn" });
    await page.waitForTimeout(800);
    const meId = await page.evaluate(() => window.DT.getState().me.id);
    await page.click("header button[aria-label='Lock app']");
    await page.waitForSelector("[role=dialog][aria-labelledby=dt-lock-title]");
    await page.waitForTimeout(800);
    check("server lock: socket closed on lock", sockets.length > 0 && sockets.every((sk) => sk.closed));
    const p = await page.evaluate(async () => ({ patients: (await fetch("/api/patients", { credentials: "include" })).status, modules: (await fetch("/api/modules", { credentials: "include" })).status, user: await fetch("/api/user", { credentials: "include" }).then((r) => r.json()) }));
    check("server lock: the page's own fetch of /api/patients and /api/modules is 423", p.patients === 423 && p.modules === 423, `${p.patients}/${p.modules}`);
    check("server lock: /api/user reports locked", p.user && p.user.locked === true, JSON.stringify(p.user && { locked: p.user.locked, orgCode: p.user.orgCode }));
    const tQuiet = Date.now();
    const er = await asUser("er.doc"), dir = await asUser("director");
    const hs = (await er("GET", "/api/hospitalists")).body || [];
    const mine = hs.find((x) => x.userId === meId);
    const pt = await er("POST", "/api/patients", { initials: "ZQ", roomNumber: "77", issueSummary: "lock probe", specialty: "Hospital Medicine" });
    await er("POST", "/api/assignments", mine ? { mode: "manual", hospitalistId: mine.id, patientId: pt.body && pt.body.id } : { mode: "round_robin", patientId: pt.body && pt.body.id });
    await dir("POST", "/api/broadcasts", { message: "lock probe", severity: "info" });
    await page.waitForTimeout(3500);
    const during = reqs.filter((r) => r.t > tQuiet).map((r) => r.u);
    check("server lock: zero requests from the locked tab during ward activity", during.length === 0, during.join(", "));
    await page.evaluate(() => { localStorage.removeItem("docturn.lock"); sessionStorage.removeItem("docturn.lock"); });
    await page.reload({ waitUntil: "networkidle" });
    const back = await page.waitForSelector("[role=dialog][aria-labelledby=dt-lock-title]", { timeout: 10000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(800);
    const noShell = await page.evaluate(() => !document.querySelector("nav[aria-label=Primary]") && !document.querySelector("main"));
    check("server lock: flag deleted + reload still lands on the lock screen", back && noShell);
    await page.fill("[role=dialog] input[type=password]", "docturn");
    await page.click("[role=dialog] button[type=submit]");
    const ok = await page.waitForSelector("nav[aria-label=Primary]", { timeout: 15000 }).then(() => true).catch(() => false);
    const after = ok ? await page.evaluate(async () => (await fetch("/api/patients", { credentials: "include" })).status) : 0;
    check("server lock: password re-authentication unlocks (200 again)", ok && after === 200, String(after));
  } catch (e) { check("server lock: run", false, e.message); }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 7b. Rendered text contrast: every visible text node vs its effective
//     background, 4 roles at phone width. Inactive controls (pointer-events
//     none / not-allowed / faded to <= .5) are exempt, as WCAG 1.4.3 allows.
{
  const sweep = () => {
    const parse = (str) => { const m = str.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (x, y) => { const l1 = lum(x), l2 = lum(y); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const blend = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
    const bgOf = (el) => { const layers = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage && cs.backgroundImage !== "none") return null; const c = parse(cs.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base); return base; };
    const fails = []; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = walker.nextNode())) {
      const txt = n.nodeValue.trim(); if (!txt) continue;
      const el = n.parentElement; if (!el || el.closest("script,style,[aria-hidden=true],[disabled],option")) continue;
      const btn = el.closest("button,[role=button]"); if (btn) { const bs = getComputedStyle(btn); if (bs.pointerEvents === "none" || bs.cursor === "not-allowed" || parseFloat(bs.opacity) <= 0.5) continue; }
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el); if (!r.width || !r.height || cs.visibility === "hidden") continue;
      let op = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
      const bg = bgOf(el); let fg = parse(cs.color); if (!bg || !fg) continue;
      fg = blend({ ...fg, a: fg.a * op }, bg);
      const fs = parseFloat(cs.fontSize), min = (fs >= 24 || (parseInt(cs.fontWeight) >= 700 && fs >= 18.66)) ? 3 : 4.5, cr = ratio(fg, bg);
      if (cr < min) fails.push(`"${txt.slice(0, 24)}" ${cr.toFixed(2)}:1 @${fs}px`);
    }
    return [...new Set(fails)];
  };
  const ROLE_SCREENS = { chen: ["dashboard", "history", "oncall", "messages", "directory", "compliance", "account"], "er.doc": ["dashboard", "oncall", "messages", "directory", "account"], director: ["dashboard", "board", "admissions", "oncall", "approvals", "consult", "roles", "broadcasts", "settings", "appearance", "compliance-monitor", "account"], "er.director": ["dashboard", "board", "oncall", "approvals", "broadcasts", "settings", "compliance-monitor", "account"] };
  for (const [user, screens] of Object.entries(ROLE_SCREENS)) {
    const { ctx, page } = await phone({ w: 390, h: 844 });
    try {
      await login(page, { org: "ISPN", user, pass: "docturn" });
      for (const id of screens) {
        await page.evaluate((nid) => window.DT.actions.setNav(nid), id);
        await page.waitForTimeout(700);
        const f = await page.evaluate(sweep);
        check(`contrast sweep ${user}/${id}: no text under AA`, f.length === 0, f.slice(0, 5).join(" | "));
      }
    } catch (e) { check(`contrast sweep ${user}: run`, false, e.message); }
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// 8. Desktop sanity: sidebar shell, no overflow, footer identity still visible.
{
  const { ctx, page } = await desktop();
  try {
    await login(page);
    const d = await page.evaluate(() => {
      const aside = document.querySelector("aside");
      const header = document.querySelector("header");
      const meName = (window.DT && window.DT.getState().me && window.DT.getState().me.name) || "";
      const name = aside && meName && [...aside.querySelectorAll("span")].find((s) => s.children.length === 0 && s.textContent.trim() === meName);
      return { aside: !!aside, headerH: header && header.getBoundingClientRect().height, overflow: document.documentElement.scrollWidth - innerWidth, nameW: name ? name.getBoundingClientRect().width : 0 };
    });
    check("desktop 1280: sidebar shell", d.aside);
    check("desktop 1280: topbar >= 64 tall", d.headerH >= 64, `${d.headerH}`);
    check("desktop 1280: no horizontal overflow", d.overflow <= 0, `+${d.overflow}`);
    check("desktop 1280: footer name visible", d.nameW > 40, `${d.nameW}px`);
    await shot(page, "desktop-1280");
    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(400);
    const n = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, mobileView: !!document.querySelector(".dt-hide-narrow") && getComputedStyle(document.querySelector(".dt-hide-narrow")).display === "none" }));
    check("desktop 900: no horizontal overflow (demo topbar)", n.overflow <= 0, `+${n.overflow}`);
    check("desktop 900: demo 'Mobile view' hidden on narrow desktop", n.mobileView);
  } catch (e) { check("desktop: run", false, e.message); }
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("Failed:"); failed.forEach((f) => console.log(" - " + f.name + (f.detail ? " — " + f.detail : ""))); }
process.exit(failed.length ? 1 : 0);
