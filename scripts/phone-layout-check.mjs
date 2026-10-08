/**
 * Phone-layout regression check for the role dashboards and directory screens.
 *
 * Drives the REAL web app in headless Chromium with an iPhone profile at three
 * widths (375 / 390 / 430) and MEASURES layout — nothing is eyeballed:
 *   • no horizontal overflow of <main> or the document,
 *   • every row control (reassign select, roster steppers/toggles, Config/Manage
 *     buttons, tab strips, popovers) fully inside the viewport AND not clipped by
 *     an overflow:hidden ancestor,
 *   • text columns keep a readable width (no 0–13px "word per line" collapse),
 *   • KPI tiles render ≥ 2-up on phones, the custom-stat popover is on-screen,
 *   • the presence dot sits on the avatar rim, status pills stay single-line,
 *   • tap targets of the controls these screens own are ≥ 44px tall.
 *
 * Covers findings A.CON-SHO-48/49/50/54/55/56 and A.CON-MIN-13.
 *
 * Usage: start a seeded synthetic server, then
 *   BASE_URL=http://127.0.0.1:5060 node scripts/phone-layout-check.mjs
 * Exits non-zero on any failed check. WIDTHS=390 limits the viewports.
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ALL_WIDTHS = { 375: 667, 390: 844, 430: 932 };
const WIDTHS = (process.env.WIDTHS || "375,390,430").split(",").map((w) => Number(w.trim())).filter((w) => ALL_WIDTHS[w]);
const TAP = 44;

const results = [];
let cur = "";
const rec = (name, ok, note = "") => {
  results.push({ name: cur + name, ok, note });
  console.log((ok ? "PASS  " : "FAIL  ") + cur + name + (note ? "  ↳ " + note : ""));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- in-page measurement helpers (serialised into the page) ----------------
const HELPERS = `
  window.__m = window.__m || (() => {
    const vw = () => window.innerWidth;
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    // Intersect the element box with every clipping ancestor; a control that is
    // drawn past an overflow:hidden Card edge is unreachable even if its own
    // rect looks fine.
    const visible = (el) => {
      let box = rect(el);
      let p = el.parentElement;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        if (/(hidden|auto|scroll|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) {
          const pr = p.getBoundingClientRect();
          box = { left: Math.max(box.left, pr.left), right: Math.min(box.right, pr.right), top: Math.max(box.top, pr.top), bottom: Math.min(box.bottom, pr.bottom) };
        }
        p = p.parentElement;
      }
      return box;
    };
    const inViewportX = (r) => r.left >= -0.5 && r.right <= vw() + 0.5;
    // fully visible: not clipped horizontally by any ancestor and inside the viewport width
    const fullyVisible = (el) => { const r = rect(el), v = visible(el); return r.width > 0 && inViewportX(r) && Math.abs(v.left - r.left) < 0.5 && Math.abs(v.right - r.right) < 0.5; };
    const overflow = () => { const main = document.querySelector("main"); return { vw: vw(), mainScroll: main ? main.scrollWidth : 0, mainClient: main ? main.clientWidth : 0, docScroll: document.documentElement.scrollWidth }; };
    const byText = (sel, re) => [...document.querySelectorAll(sel)].filter((e) => re.test((e.textContent || "").trim()));
    const h2 = (re) => byText("h2", re)[0] || null;
    const overlap = (a, b) => { const ra = rect(a), rb = rect(b); return ra.left < rb.right - 0.5 && rb.left < ra.right - 0.5 && ra.top < rb.bottom - 0.5 && rb.top < ra.bottom - 0.5; };
    const truncated = (el) => el.scrollWidth > el.clientWidth + 1;
    const summarize = (els) => els.map((e) => ({ r: rect(e), vis: fullyVisible(e), text: (e.textContent || e.getAttribute("title") || e.tagName).trim().slice(0, 24) }));
    return { rect, visible, fullyVisible, inViewportX, overflow, byText, h2, overlap, truncated, summarize, vw };
  })();
`;

async function prep(page) { await page.evaluate(HELPERS); }

async function login(page, role, org, user) {
  await page.evaluate(([role, org, user]) => window.DT.actions.login(role, org, user, "docturn"), [role, org, user]);
  await page.waitForFunction((r) => { const s = window.DT.getState(); return !!(s.session && s.session.role === r); }, role, { timeout: 20000 });
  await sleep(900); // hydrate burst
}
async function nav(page, id) {
  await page.evaluate((id) => window.DT.actions.setNav(id), id);
  await page.waitForFunction((id) => window.DT.getState().ui.nav === id, id);
  await sleep(500);
  await prep(page);
}
const fmt = (n) => Math.round(n * 10) / 10;
const rectStr = (r) => `[${fmt(r.left)}..${fmt(r.right)} x ${fmt(r.top)}..${fmt(r.bottom)}]`;

async function noOverflow(page, label) {
  const o = await page.evaluate(() => window.__m.overflow());
  rec(`${label}: no horizontal overflow`, o.mainScroll <= o.vw && o.docScroll <= o.vw, `main.scrollWidth=${o.mainScroll} doc.scrollWidth=${o.docScroll} vw=${o.vw}`);
}

// Ensure the seed has rows for every screen under test: the hospitalist (chen)
// needs an ACCEPTED admission this shift AND a still-pending request (seeded
// pendings expire and re-route after 15 min, so one is (re)created each run);
// the ER doctor needs routed rows on the patient board.
async function ensureFixtures(page) {
  await login(page, "er_doctor", "ISPN", "er.doc");
  const sentTo = await page.evaluate(() => {
    const st = window.DT.getState();
    const target = (window.DT.sortedProviders() || []).find((p) => /Alyesh/.test(p.name)) || window.DT.sortedProviders()[0];
    if (!target) return null;
    const mine = (st.sent || []).filter((s) => s.provider === target.name);
    const out = { target: target.name, sentAccepted: false, sentPending: false };
    if (!mine.some((s) => s.status === "accepted")) {
      window.DT.actions.sendAssignment(target, { initials: "LY", room: "Hall 7", complaint: "Layout check — chest pain, SOB on exertion", specialty: "Cardiology", acuity: 2 }, ["Cardiology"]);
      out.sentAccepted = true;
    }
    if (!mine.some((s) => s.status === "sent" && s.initials !== "LY")) {
      window.DT.actions.sendAssignment(target, { initials: "PQ", room: "412", complaint: "Layout check — pending request", specialty: "Hospital Medicine", acuity: 3 }, []);
      out.sentPending = true;
    }
    return out;
  });
  await sleep(1500);
  await login(page, "hospitalist", "ISPN", "chen");
  await page.evaluate(() => {
    const st = window.DT.getState();
    const p = (st.pending || []).find((x) => x.initials === "LY");
    if (p) window.DT.actions.accept(p.id);
  });
  await sleep(1200);
  return sentTo;
}

// ---- per-screen checks ------------------------------------------------------
async function checkHospitalistHome(page) {
  await nav(page, "dashboard");
  await noOverflow(page, "hospitalist home");
  const m = await page.evaluate(() => {
    const M = window.__m;
    // KPI strip: tiles are the Cards holding a 28px value under a label.
    const tiles = [...document.querySelectorAll("div")].filter((d) => getComputedStyle(d).fontSize === "28px" && getComputedStyle(d).fontWeight === "700").map((v) => v.parentElement);
    const tops = [...new Set(tiles.map((t) => Math.round(M.rect(t).top)))];
    const perRow = tiles.length && tops.length ? tiles.length / tops.length : 0;
    const stripTop = tiles.length ? Math.min(...tiles.map((t) => M.rect(t).top)) : null;
    const incoming = M.h2(/Incoming assignment requests/);
    const accept = M.byText("button", /^Accept$/)[0] || null;
    const decline = M.byText("button", /^Decline$/)[0] || null;
    const acceptedH2 = M.h2(/Accepted this shift/);
    let rows = [];
    if (acceptedH2) {
      const card = acceptedH2.parentElement.nextElementSibling && acceptedH2.parentElement.nextElementSibling.nextElementSibling;
      const titles = M.byText("div", /^Patient \S+ · Room/).filter((d) => d.children.length === 0 || getComputedStyle(d).fontWeight === "600");
      rows = titles.map((t) => {
        const row = t.parentElement.parentElement; // title -> text col -> row
        const consult = M.byText("button", /Consult$/).find((b) => row.contains(b)) || null;
        const msg = M.byText("button", /Message$/).find((b) => row.contains(b)) || null;
        return { titleW: M.rect(t).width, consultOverlapsTitle: consult ? M.overlap(consult, t) : false, msg: msg ? { vis: M.fullyVisible(msg), h: M.rect(msg).height } : null, consult: consult ? { vis: M.fullyVisible(consult), h: M.rect(consult).height } : null };
      });
    }
    // pending card text column (Patient XX span's row)
    let pendText = null;
    const patientSpan = M.byText("span", /^Patient \S+$/).find((s) => getComputedStyle(s).fontSize === "15px");
    if (patientSpan) { const col = patientSpan.parentElement.parentElement; pendText = M.rect(col).width; }
    return { tiles: tiles.length, rows: tops.length, perRow, stripTop, incomingTop: incoming ? M.rect(incoming).top : null, accept: accept ? { r: M.rect(accept), vis: M.fullyVisible(accept) } : null, decline: decline ? { r: M.rect(decline), vis: M.fullyVisible(decline) } : null, pendText, accepted: rows, vh: window.innerHeight };
  });
  rec("hospitalist home: KPI tiles ≥ 2-up on phone", m.tiles > 0 && m.perRow >= 2, `${m.tiles} tiles in ${m.rows} rows`);
  if (m.accept) {
    rec("hospitalist home: Accept/Decline inside viewport", m.accept.vis && m.decline.vis, `accept=${rectStr(m.accept.r)} decline=${rectStr(m.decline.r)}`);
    rec("hospitalist home: pending request above the fold (first screen)", m.accept.r.top < m.vh, `accept.top=${fmt(m.accept.r.top)} vh=${m.vh} incomingTitle.top=${fmt(m.incomingTop)} stripTop=${fmt(m.stripTop)}`);
    rec("hospitalist home: pending card text column ≥ 150px", m.pendText != null && m.pendText >= 150, `textCol=${fmt(m.pendText)}`);
    rec("hospitalist home: Accept/Decline tap height ≥ 44", m.accept.r.height >= TAP && m.decline.r.height >= TAP, `h=${fmt(m.accept.r.height)}`);
  } else rec("hospitalist home: pending request present (fixture)", false, "no Accept button — seed has no pending request for chen");
  rec("hospitalist home: accepted rows present (fixture)", m.accepted.length > 0, `${m.accepted.length} rows`);
  if (m.accepted.length) {
    const r0 = m.accepted[0];
    rec("hospitalist home: accepted row title column ≥ 120px", m.accepted.every((r) => r.titleW >= 120), `widths=${m.accepted.map((r) => fmt(r.titleW)).join(",")}`);
    rec("hospitalist home: '+ Consult' chip not drawn over the title", m.accepted.every((r) => !r.consultOverlapsTitle));
    rec("hospitalist home: Message button fully visible", m.accepted.every((r) => !r.msg || r.msg.vis), JSON.stringify(r0.msg));
    rec("hospitalist home: Message button tap height ≥ 44", m.accepted.every((r) => !r.msg || r.msg.h >= TAP), `h=${r0.msg && fmt(r0.msg.h)}`);
  }
}

async function checkDirectory(page, hub) {
  await nav(page, "directory");
  await noOverflow(page, (hub ? "directory hub" : "directory"));
  if (hub) {
    const t = await page.evaluate(() => {
      const M = window.__m;
      const roles = M.byText("button", /Roles & permissions/)[0];
      if (!roles) return null;
      const strip = roles.parentElement;
      const before = M.rect(roles);
      const stripR = M.rect(strip);
      const cs = getComputedStyle(strip);
      strip.scrollLeft = strip.scrollWidth;
      const after = M.rect(roles);
      strip.scrollLeft = 0;
      const tabs = [...strip.querySelectorAll("button")];
      return { stripRight: stripR.right, stripScrollable: /auto|scroll/.test(cs.overflowX), before, after, afterVisible: M.inViewportX(after) && after.right <= stripR.right + 0.5, minH: Math.min(...tabs.map((b) => M.rect(b).height)), singleLine: tabs.every((b) => M.rect(b).height < 60) };
    });
    if (!t) rec("directory hub: sub-tab strip present", false);
    else {
      rec("directory hub: sub-tab strip stays inside the viewport", t.stripRight <= (await page.evaluate(() => window.innerWidth)) + 0.5, `strip.right=${fmt(t.stripRight)}`);
      rec("directory hub: 4th sub-tab reachable (scroll strip, not page)", t.afterVisible && t.singleLine, `Roles tab after scroll=${rectStr(t.after)} scrollable=${t.stripScrollable}`);
      rec("directory hub: sub-tab tap height ≥ 44", t.minH >= TAP, `minH=${fmt(t.minH)}`);
    }
  }
  const d = await page.evaluate(() => {
    const M = window.__m;
    const h = M.h2(/Provider directory/);
    if (!h) return null;
    // The provider list is the first Card after the "Provider directory" title
    // (skipping the mobile-only full-width search row).
    let card = h.parentElement.nextElementSibling;
    while (card && !card.querySelector("button")) card = card.nextElementSibling;
    const rows = card ? [...card.children].filter((r) => r.querySelector("button")) : [];
    return rows.slice(0, 6).map((row) => {
      const btn = row.querySelector("button");
      const pill = M.byText("span", /^(On|Off) shift$/).find((s) => row.contains(s));
      const dot = row.querySelector("span[style*='position: absolute']");
      const avatar = dot ? dot.previousElementSibling : null;
      const name = [...row.querySelectorAll("div")].find((d) => getComputedStyle(d).fontSize === "14px" && getComputedStyle(d).fontWeight === "600");
      const dotInner = dot ? dot.firstElementChild : null;
      return {
        btn: btn ? { r: M.rect(btn), vis: M.fullyVisible(btn) } : null,
        pillH: pill ? M.rect(pill).height : null,
        name: name ? { w: M.rect(name).width, text: name.textContent.trim(), truncated: M.truncated(name) } : null,
        dot: dot && avatar && dotInner ? { dotBottom: M.rect(dotInner).bottom, dotRight: M.rect(dotInner).right, avBottom: M.rect(avatar).bottom, avRight: M.rect(avatar).right } : null,
        rowRight: M.rect(row).right,
      };
    });
  });
  if (!d || !d.length) { rec("directory: provider rows present", false); return; }
  rec("directory: row message button fully visible", d.every((r) => r.btn && r.btn.vis), rectStr(d[0].btn.r));
  rec("directory: row message button tap size ≥ 44", d.every((r) => r.btn && r.btn.r.height >= TAP && r.btn.r.width >= TAP), `${fmt(d[0].btn.r.width)}x${fmt(d[0].btn.r.height)}`);
  rec("directory: 'On shift' pill single line (≤ 26px)", d.every((r) => r.pillH == null || r.pillH <= 26), `pillH=${d.map((r) => fmt(r.pillH)).join(",")}`);
  rec("directory: provider name column ≥ 180px and not truncated", d.every((r) => r.name && r.name.w >= 180 && !r.name.truncated), d.map((r) => r.name && `${fmt(r.name.w)}${r.name.truncated ? "(cut)" : ""}`).join(","));
  const dotOk = d.every((r) => !r.dot || (Math.abs(r.dot.dotBottom - r.dot.avBottom) <= 3 && Math.abs(r.dot.dotRight - r.dot.avRight) <= 3));
  rec("directory: presence dot sits on the avatar's bottom-right rim (±3px)", dotOk, d[0].dot ? `dotBottom=${fmt(d[0].dot.dotBottom)} avatarBottom=${fmt(d[0].dot.avBottom)} dotRight=${fmt(d[0].dot.dotRight)} avatarRight=${fmt(d[0].dot.avRight)}` : "no dot");
}

async function checkRoutedBoard(page, label) {
  const m = await page.evaluate(() => {
    const M = window.__m;
    const h = M.h2(/^Patient board$/);
    if (!h) return null;
    const section = h.parentElement.parentElement;
    const selects = [...section.querySelectorAll("select")].filter((s) => s.options[0] && /Reassign/.test(s.options[0].text));
    return selects.slice(0, 8).map((sel) => {
      const row = sel.closest("div[style*='border-left']") || sel.parentElement.parentElement.parentElement;
      const title = [...row.querySelectorAll("div")].find((d) => /^Patient /.test(d.textContent) && getComputedStyle(d).fontWeight === "600");
      const badge = [...row.querySelectorAll("span")].find((s) => /^(Accepted|Sent|Declined|Re-routed|Expired|Pending)/.test(s.textContent.trim()) && getComputedStyle(s).borderRadius !== "0px" && s.children.length <= 2 && s.querySelector("i,svg,span"));
      const consult = M.byText("button", /Consult$/).find((b) => row.contains(b)) || null;
      return { sel: { r: M.rect(sel), vis: M.fullyVisible(sel) }, titleW: title ? M.rect(title.parentElement).width : null, badge: badge ? { r: M.rect(badge), vis: M.fullyVisible(badge) } : null, consultOverlap: consult && title ? M.overlap(consult, title) : false, rowRight: M.rect(row).right };
    });
  });
  if (!m || !m.length) { rec(`${label} patient board: routed rows present (fixture)`, false, "no Reassign selects found"); return; }
  rec(`${label} patient board: status Badge inside viewport`, m.every((r) => !r.badge || r.badge.vis), m[0].badge ? rectStr(m[0].badge.r) : "no badge");
  rec(`${label} patient board: Reassign select fully visible`, m.every((r) => r.sel.vis), rectStr(m[0].sel.r));
  rec(`${label} patient board: Reassign select tap height ≥ 44`, m.every((r) => r.sel.r.height >= TAP), `h=${fmt(m[0].sel.r.height)}`);
  rec(`${label} patient board: title column ≥ 120px`, m.every((r) => r.titleW != null && r.titleW >= 120), `widths=${m.map((r) => fmt(r.titleW)).join(",")}`);
  rec(`${label} patient board: '+ Consult' chip not over the title`, m.every((r) => !r.consultOverlap));
}

async function checkStatPopover(page, label) {
  // open Customize → New stat on the FIRST stat strip of the page
  const opened = await page.evaluate(() => {
    const M = window.__m;
    const cust = M.byText("button", /^Customize$/)[0];
    if (!cust) return false; cust.click(); return true;
  });
  if (!opened) { rec(`${label}: stat strip Customize present`, false); return; }
  await sleep(250);
  await page.evaluate(() => { const b = window.__m.byText("button", /^New stat$/)[0]; if (b) b.click(); });
  await sleep(300);
  const p = await page.evaluate(() => {
    const M = window.__m;
    const title = M.byText("div", /^Build a stat box$/)[0];
    if (!title) return null;
    const pop = title.parentElement;
    const inputs = [...pop.querySelectorAll("input,select")];
    return { r: M.rect(pop), vis: M.fullyVisible(pop), inputs: inputs.map((i) => ({ vis: M.fullyVisible(i), fs: getComputedStyle(i).fontSize, h: M.rect(i).height })), vw: window.innerWidth };
  });
  if (!p) rec(`${label}: custom-stat popover opens`, false);
  else {
    rec(`${label}: custom-stat popover fully on-screen`, p.vis && p.r.left >= 0 && p.r.right <= p.vw, `${rectStr(p.r)} vw=${p.vw}`);
    rec(`${label}: popover fields on-screen`, p.inputs.length >= 3 && p.inputs.every((i) => i.vis), `${p.inputs.length} fields`);
    rec(`${label}: popover inputs 16px (no iOS focus zoom)`, p.inputs.every((i) => parseFloat(i.fs) >= 16), `fs=${p.inputs.map((i) => i.fs).join(",")}`);
  }
  await page.evaluate(() => { const b = window.__m.byText("button", /^Cancel$/)[0]; if (b) b.click(); });
  await sleep(150);
  await page.evaluate(() => { const b = window.__m.byText("button", /^Done$/)[0]; if (b) b.click(); });
  await sleep(200);
}

async function checkErDoctorHome(page) {
  await nav(page, "dashboard");
  await noOverflow(page, "ER doctor home");
  await checkRoutedBoard(page, "ER doctor");
  await checkStatPopover(page, "ER doctor my-metrics");
}

async function checkDirectorHome(page) {
  await nav(page, "dashboard");
  await noOverflow(page, "director home");
  const m = await page.evaluate(() => {
    const M = window.__m;
    const sel = [...document.querySelectorAll("select")].filter((s) => [...s.options].some((o) => /Day|Swing|Night/i.test(o.text)));
    const dec = [...document.querySelectorAll("button[title^='Decrease']")];
    const inc = [...document.querySelectorAll("button[title^='Increase']")];
    const rot = [...document.querySelectorAll("button[title*='rotation']")];
    const tog = [...document.querySelectorAll("button[title='Toggle shift']")];
    const rm = [...document.querySelectorAll("button[title='Remove provider']")];
    const names = sel.map((s) => { const row = s.closest("div[draggable]") || s.parentElement.parentElement; const n = row.querySelector("span[title='Click to edit']"); return n ? M.rect(n.parentElement).width : null; });
    const groups = { select: sel, decrease: dec, increase: inc, rotation: rot, toggle: tog, remove: rm };
    const out = {};
    for (const k of Object.keys(groups)) out[k] = { n: groups[k].length, allVisible: groups[k].every((e) => M.fullyVisible(e)), minH: groups[k].length ? Math.min(...groups[k].map((e) => M.rect(e).height)) : null, first: groups[k][0] ? M.rect(groups[k][0]) : null, firstVis: groups[k][0] ? M.visible(groups[k][0]) : null };
    return { out, names };
  });
  rec("director roster: rows present (fixture)", m.out.select.n > 0, `${m.out.select.n} rows`);
  for (const k of ["select", "decrease", "increase", "rotation", "toggle", "remove"]) {
    const g = m.out[k];
    if (!g.n) continue;
    rec(`director roster: ${k} control fully visible (not clipped by Card)`, g.allVisible, `first=${rectStr(g.first)} visibleBox=${g.firstVis ? rectStr(g.firstVis) : "-"}`);
    rec(`director roster: ${k} tap height ≥ 44`, g.minH >= TAP, `minH=${fmt(g.minH)}`);
  }
  rec("director roster: name column ≥ 150px", m.names.length > 0 && m.names.every((w) => w != null && w >= 150), `widths=${m.names.map(fmt).join(",")}`);
  await checkStatPopover(page, "director stats");
}

async function checkBoardControls(page, label) {
  await nav(page, "board");
  await noOverflow(page, `${label} board`);
  const m = await page.evaluate(() => {
    const M = window.__m;
    const btns = ["Clear 24h+", "Clear all", "Customize board"].map((t) => M.byText("button", new RegExp("^" + t.replace(/[+]/g, "\\+") + "$"))[0]).filter(Boolean);
    return btns.map((b) => ({ t: b.textContent.trim(), vis: M.fullyVisible(b), r: M.rect(b) }));
  });
  rec(`${label} board: Clear/Customize controls fully inside viewport`, m.length >= 2 && m.every((b) => b.vis), m.map((b) => `${b.t}=${rectStr(b.r)}`).join(" "));
  const pop = await page.evaluate(() => {
    const M = window.__m;
    const b = M.byText("button", /^Customize board$/)[0];
    if (!b) return null;
    b.click();
    return true;
  });
  if (pop) {
    await sleep(250);
    const r = await page.evaluate(() => { const M = window.__m; const t = M.byText("div", /^Customize board$/).find((d) => d.tagName === "DIV" && d.children.length === 0); if (!t) return null; const pop = t.parentElement.parentElement; return { r: M.rect(pop), vis: M.fullyVisible(pop) }; });
    rec(`${label} board: Customize popover on-screen`, !!(r && r.vis), r ? rectStr(r.r) : "not found");
    await page.evaluate(() => { const b = window.__m.byText("button", /^Customize board$/)[0]; if (b) b.click(); });
    await sleep(150);
  }
}

async function checkErDirectorHome(page) {
  await nav(page, "dashboard");
  await noOverflow(page, "ER director home");
  const m = await page.evaluate(() => {
    const M = window.__m;
    const tog = [...document.querySelectorAll("button[title='End shift'],button[title='Start shift']")];
    const rm = [...document.querySelectorAll("button[title='Remove']")];
    // the roster row is the nearest ancestor that holds the editable name
    const rowOf = (el) => { let p = el.parentElement; while (p && !p.querySelector("span[title='Click to edit']")) p = p.parentElement; return p; };
    const sels = tog.map((t) => rowOf(t) && rowOf(t).querySelector("select")).filter(Boolean);
    const names = tog.map((t) => { const row = rowOf(t); const n = row && row.querySelector("span[title='Click to edit']"); return n ? M.rect(n.parentElement).width : null; });
    const g = (els) => ({ n: els.length, allVisible: els.every((e) => M.fullyVisible(e)), minH: els.length ? Math.min(...els.map((e) => M.rect(e).height)) : null, first: els[0] ? M.rect(els[0]) : null });
    const divBtn = M.byText("button", /diversion$/)[0];
    return { tog: g(tog), rm: g(rm), sel: g(sels), names, diversion: divBtn ? { vis: M.fullyVisible(divBtn), r: M.rect(divBtn) } : null };
  });
  rec("ER director roster: rows present (fixture)", m.tog.n > 0, `${m.tog.n} rows`);
  if (m.tog.n) {
    rec("ER director roster: shift select fully visible", m.sel.allVisible, rectStr(m.sel.first));
    rec("ER director roster: on/off toggle fully visible", m.tog.allVisible, rectStr(m.tog.first));
    rec("ER director roster: remove button fully visible", m.rm.allVisible, rectStr(m.rm.first));
    rec("ER director roster: controls tap height ≥ 44", m.sel.minH >= TAP && m.tog.minH >= TAP && m.rm.minH >= TAP, `select=${fmt(m.sel.minH)} toggle=${fmt(m.tog.minH)} remove=${fmt(m.rm.minH)}`);
    rec("ER director roster: name column ≥ 150px", m.names.every((w) => w != null && w >= 150), `widths=${m.names.map(fmt).join(",")}`);
  }
  if (m.diversion) rec("ER director: diversion button fully visible", m.diversion.vis, rectStr(m.diversion.r));
  await checkRoutedBoard(page, "ER director");
}

async function checkDeveloper(page) {
  await nav(page, "dashboard");
  await noOverflow(page, "developer organizations");
  const m = await page.evaluate(() => {
    const M = window.__m;
    const cfg = M.byText("button", /^Config$/), man = M.byText("button", /^Manage$/), open = M.byText("button", /^Open portal$/);
    const tiles = [...document.querySelectorAll("div")].filter((d) => getComputedStyle(d).fontSize === "28px" && getComputedStyle(d).fontWeight === "700").map((v) => v.parentElement);
    const tops = [...new Set(tiles.map((t) => Math.round(M.rect(t).top)))];
    const tileOverflow = tiles.some((t) => t.scrollWidth > t.clientWidth + 1 || [...t.querySelectorAll("div")].some((d) => d.scrollWidth > d.clientWidth + 1));
    const g = (els) => ({ n: els.length, allVisible: els.every((e) => M.fullyVisible(e)), first: els[0] ? M.rect(els[0]) : null });
    return { cfg: g(cfg), man: g(man), open: g(open), tiles: tiles.length, rows: tops.length, tileOverflow };
  });
  rec("developer organizations: Config buttons fully visible", m.cfg.n > 0 && m.cfg.allVisible, m.cfg.first ? rectStr(m.cfg.first) : "none");
  rec("developer organizations: Manage buttons fully visible", m.man.n > 0 && m.man.allVisible, m.man.first ? rectStr(m.man.first) : "none");
  rec("developer organizations: 'Open portal' buttons fully visible", m.open.n === 0 || m.open.allVisible, m.open.first ? rectStr(m.open.first) : "none");
  rec("developer organizations: KPI tiles 2-up and values not clipped", m.tiles > 0 && m.tiles / m.rows >= 2 && !m.tileOverflow, `${m.tiles} tiles / ${m.rows} rows overflow=${m.tileOverflow}`);
  for (const [id, label] of [["enterprise", "enterprise defaults"], ["settings", "organization config"]]) {
    await nav(page, id);
    await noOverflow(page, `developer ${label}`);
    const t = await page.evaluate(() => {
      const M = window.__m;
      const comp = M.byText("button", /^Compliance$/)[0];
      if (!comp) return null;
      const strip = comp.parentElement;
      const stripR = M.rect(strip);
      strip.scrollLeft = strip.scrollWidth;
      const after = M.rect(comp);
      const reach = M.inViewportX(after) && after.right <= stripR.right + 0.5;
      strip.scrollLeft = 0;
      const tabs = [...strip.querySelectorAll("button")];
      const manage = M.byText("button", /Manage full portal/)[0];
      return { stripRight: stripR.right, reach, after, minH: Math.min(...tabs.map((b) => M.rect(b).height)), manage: manage ? { vis: M.fullyVisible(manage), r: M.rect(manage) } : null, vw: window.innerWidth };
    });
    if (!t) { rec(`developer ${label}: tab strip present`, false); continue; }
    rec(`developer ${label}: tab strip inside viewport`, t.stripRight <= t.vw + 0.5, `strip.right=${fmt(t.stripRight)}`);
    rec(`developer ${label}: Compliance tab reachable without panning the page`, t.reach, `after scroll=${rectStr(t.after)}`);
    rec(`developer ${label}: tab tap height ≥ 44`, t.minH >= TAP, `minH=${fmt(t.minH)}`);
    if (t.manage) rec(`developer ${label}: 'Manage full portal' fully visible`, t.manage.vis, rectStr(t.manage.r));
  }
}

// ---- driver -----------------------------------------------------------------
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
try {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: ALL_WIDTHS[w] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e && e.message || e)));
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.DT && document.querySelector("#root") && document.querySelector("#root").children.length > 0, null, { timeout: 60000 });
    await prep(page);
    cur = `[${w}] `;
    const fx = await ensureFixtures(page);
    rec("fixtures: ER→hospitalist routed/accepted row available", !!fx, JSON.stringify(fx));

    await login(page, "hospitalist", "ISPN", "chen");
    await checkHospitalistHome(page);
    await checkDirectory(page, false);

    await login(page, "er_doctor", "ISPN", "er.doc");
    await checkErDoctorHome(page);

    await login(page, "director", "ISPN", "director");
    await checkDirectorHome(page);
    await checkDirectory(page, true);
    await checkBoardControls(page, "director");

    await login(page, "er_director", "ISPN", "er.director");
    await checkErDirectorHome(page);
    await checkBoardControls(page, "ER director");

    await login(page, "developer", "DOCTURN", "dev");
    await checkDeveloper(page);

    rec("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
}

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length} passed, ${fails.length} failed, ${results.length} total`);
process.exit(fails.length ? 1 : 0);
