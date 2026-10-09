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
 *   • tap targets of the controls these screens own are ≥ 44px tall,
 *   • the ER intake triage (ESI) row fits its card under the shell's 12px
 *     text floor and names the selected level.
 *
 * Covers findings A.CON-SHO-48/49/50/54/55/56 and A.CON-MIN-13, including the
 * fix-up items: the Admissions log "Clear all" header (director Home panel and
 * Admissions log screen), the Compliance screen (tabs / Export / Clear logs row,
 * audit / PHI / logs tables), the presence dots in CareTeam and Messaging, and
 * the Appearance screen for developer, director and ER director. The final
 * A.CON-SHO-50 round adds the Settings tab strip (Organization / Appearance /
 * Compliance / Compliance monitor) and a sweep of every screen of every role
 * that no button draws its label or icon outside its own box.
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
    // Horizontal extent of what a control actually DRAWS: its text runs and
    // in-flow descendants (icons), clamped by any clipping box inside it.
    // Absolutely positioned descendants (a count badge on the bell's corner)
    // are deliberate overhangs and are left out.
    const contentBox = (el) => {
      let minL = Infinity, maxR = -Infinity;
      const add = (r, cl, cr) => { if (!r.width) return; const l = Math.max(r.left, cl), rt = Math.min(r.right, cr); if (rt <= l) return; minL = Math.min(minL, l); maxR = Math.max(maxR, rt); };
      const visit = (n, cl, cr) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) {
            if (!c.textContent.trim()) continue;
            const rg = document.createRange(); rg.selectNodeContents(c); add(rg.getBoundingClientRect(), cl, cr);
          } else if (c.nodeType === 1) {
            const cs = getComputedStyle(c);
            if (cs.display === "none" || cs.position === "absolute" || cs.position === "fixed") continue;
            const r = c.getBoundingClientRect();
            add(r, cl, cr);
            const clips = cs.overflowX !== "visible";
            visit(c, clips ? Math.max(cl, r.left) : cl, clips ? Math.min(cr, r.right) : cr);
          }
        }
      };
      const own = el.getBoundingClientRect(), ocs = getComputedStyle(el);
      const clips = ocs.overflowX !== "visible";
      visit(el, clips ? own.left : -Infinity, clips ? own.right : Infinity);
      return minL === Infinity ? null : { left: minL, right: maxR };
    };
    // px of label/icon drawn outside the control's own box (0 = all inside)
    const labelSpill = (el) => { const r = el.getBoundingClientRect(), c = contentBox(el); return c ? Math.max(0, c.right - r.right, r.left - c.left) : 0; };
    const spilledButtons = () => [...document.querySelectorAll("button,[role='button']")]
      .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== "hidden"; })
      .map((b) => ({ b, s: labelSpill(b) })).filter((x) => x.s > 1)
      .map((x) => ({ text: (x.b.textContent || x.b.getAttribute("title") || "").trim().slice(0, 24), spill: Math.round(x.s * 10) / 10, w: Math.round(x.b.getBoundingClientRect().width * 10) / 10 }));
    // Buttons that sit past the viewport or stick out of their Card (nearest
    // ancestor drawn as a card: shadow + rounded corners) — controls inside a
    // sideways-scrolling strip are reached by scrolling it and are skipped.
    const outOfBox = () => {
      const out = [];
      for (const b of document.querySelectorAll("main button, main [role='button']")) {
        const r = b.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(b).visibility === "hidden") continue;
        let p = b.parentElement, scroller = false, card = null;
        while (p && p.tagName !== "MAIN") {
          const cs = getComputedStyle(p);
          if (/(auto|scroll)/.test(cs.overflowX)) { scroller = true; break; }
          if (!card && cs.boxShadow !== "none" && parseFloat(cs.borderTopLeftRadius) > 0 && p.getBoundingClientRect().width > r.width + 20) card = p;
          p = p.parentElement;
        }
        if (scroller) continue;
        const t = (b.textContent || b.getAttribute("title") || "").trim().slice(0, 24);
        const c = card && card.getBoundingClientRect();
        const span = "'" + t + "' [" + Math.round(r.left) + ".." + Math.round(r.right) + "]";
        if (!inViewportX(r)) out.push(span + " past the " + vw() + "px viewport");
        else if (c && (r.left < c.left - 0.5 || r.right > c.right + 0.5)) out.push(span + " outside its card [" + Math.round(c.left) + ".." + Math.round(c.right) + "]");
      }
      return out;
    };
    return { rect, visible, fullyVisible, inViewportX, overflow, byText, h2, overlap, truncated, summarize, vw, contentBox, labelSpill, spilledButtons, outOfBox };
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

// Intake panel (shared by the ER physician and ER director homes). With the
// shell's 12px phone text floor, in-button ESI names ("Resuscitation" ≈ 92px)
// cannot fit a fifth of a phone card; they used to widen the single grid track
// and push both intake cards ~31-46px past the viewport. Phones show a numbered
// segmented row plus the selected level's name, which must update on tap.
async function checkIntakeTriage(page, label) {
  const m = await page.evaluate(() => {
    const M = window.__m;
    const h = M.h2(/^New patient intake$/);
    if (!h) return null;
    const card = h.closest("div[style*='box-shadow']");
    const btns = [...card.querySelectorAll("button[title^='ESI ']")];
    const caption = M.byText("span", /^ESI \d · /).find((s) => card.contains(s)) || null;
    return {
      card: { r: M.rect(card), vis: M.fullyVisible(card), parentW: M.rect(card.parentElement).width },
      btns: btns.map((b) => ({ vis: M.fullyVisible(b), h: M.rect(b).height, spill: b.scrollWidth > b.clientWidth + 1 })),
      caption: caption ? caption.textContent.trim() : null,
    };
  });
  if (!m) { rec(`${label} intake: panel present`, false); return; }
  rec(`${label} intake: card inside the viewport and its grid track`, m.card.vis && m.card.r.width <= m.card.parentW + 0.5, `card=${rectStr(m.card.r)} track=${fmt(m.card.parentW)}`);
  rec(`${label} intake: 5 ESI buttons fully visible`, m.btns.length === 5 && m.btns.every((b) => b.vis), `${m.btns.length} buttons`);
  rec(`${label} intake: ESI button tap height ≥ 44`, m.btns.length === 5 && m.btns.every((b) => b.h >= TAP), `h=${m.btns.map((b) => fmt(b.h)).join(",")}`);
  rec(`${label} intake: no ESI label spills out of its button`, m.btns.every((b) => !b.spill));
  rec(`${label} intake: selected ESI level named on phone`, m.caption === "ESI 3 · Urgent", `caption=${m.caption}`);
  await page.evaluate(() => { const b = document.querySelector("button[title='ESI 1 · Resuscitation']"); if (b) b.click(); });
  await sleep(150);
  const after = await page.evaluate(() => {
    const M = window.__m;
    const card = M.h2(/^New patient intake$/).closest("div[style*='box-shadow']");
    const s = M.byText("span", /^ESI \d · /).find((x) => card.contains(x));
    const b = card.querySelector("button[title='ESI 1 · Resuscitation']");
    return { caption: s ? s.textContent.trim() : null, pressed: b && b.getAttribute("aria-pressed") };
  });
  rec(`${label} intake: tapping ESI 1 selects it and names it`, after.caption === "ESI 1 · Resuscitation" && after.pressed === "true", `caption=${after.caption} aria-pressed=${after.pressed}`);
  await page.evaluate(() => { const b = document.querySelector("button[title='ESI 3 · Urgent']"); if (b) b.click(); });
  await sleep(100);
}

async function checkErDoctorHome(page) {
  await nav(page, "dashboard");
  await noOverflow(page, "ER doctor home");
  await checkIntakeTriage(page, "ER doctor");
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
  await checkIntakeTriage(page, "ER director");
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

// Admissions log header (A.CON-SHO-49 fix-up): the "Clear 24h+" / "Clear all"
// buttons share a no-wrap row with the title inside an overflow:hidden Card;
// at ≤390px "Clear all" was drawn 21-36px past the Card edge ("Clea").
// Shown on the director Home admissions panel and on the Admissions log screen.
async function checkAdmissionsHeader(page, label) {
  const m = await page.evaluate(() => {
    const M = window.__m;
    const h = M.byText("h3", /^Admissions log$/)[0];
    if (!h) return null;
    const row = h.parentElement;
    const btns = [/^Clear 24h\+$/, /^Clear all$/].map((re) => M.byText("button", re).find((b) => row.contains(b))).filter(Boolean);
    return { scroll: row.scrollWidth, client: row.clientWidth, btns: btns.map((b) => ({ t: b.textContent.trim(), vis: M.fullyVisible(b), r: M.rect(b) })) };
  });
  if (!m) { rec(`${label}: Admissions log header present`, false); return; }
  rec(`${label}: Admissions log header row does not overflow its Card`, m.scroll <= m.client + 1, `scrollWidth=${m.scroll} clientWidth=${m.client}`);
  rec(`${label}: 'Clear 24h+' and 'Clear all' fully visible`, m.btns.length === 2 && m.btns.every((b) => b.vis), m.btns.map((b) => `${b.t}=${rectStr(b.r)}`).join(" "));
  rec(`${label}: Clear buttons tap height ≥ 44`, m.btns.length === 2 && m.btns.every((b) => b.r.height >= TAP), m.btns.map((b) => fmt(b.r.height)).join(","));
}

// Compliance (A.CON-SHO-50 fix-up): tabs + Export + Clear logs row, the
// ComplianceTabs strip, and the audit / PHI / logs tables with fixed-width
// columns used to push <main> to 449px and clip the Risk column.
async function checkCompliance(page, label, { clear = true } = {}) {
  await nav(page, "compliance");
  await noOverflow(page, `${label} compliance`);
  const top = await page.evaluate(() => {
    const M = window.__m;
    const logsTab = M.byText("button", /^System logs$/)[0];
    if (!logsTab) return null;
    const strip = logsTab.parentElement;
    const stripR = M.rect(strip);
    strip.scrollLeft = strip.scrollWidth;
    const after = M.rect(logsTab);
    const reach = M.inViewportX(after) && after.right <= stripR.right + 0.5 && after.left >= stripR.left - 0.5;
    strip.scrollLeft = 0;
    const tabs = [...strip.querySelectorAll("button")];
    const exp = M.byText("button", /^Export$/)[0];
    const clr = M.byText("button", /^Clear logs$/)[0];
    const tiles = [...document.querySelectorAll("div")].filter((d) => getComputedStyle(d).fontSize === "28px" && getComputedStyle(d).fontWeight === "700").map((v) => v.parentElement);
    return {
      stripRight: stripR.right, reach, after, minTabH: Math.min(...tabs.map((b) => M.rect(b).height)),
      exp: exp ? { vis: M.fullyVisible(exp), r: M.rect(exp) } : null,
      clr: clr ? { vis: M.fullyVisible(clr), r: M.rect(clr) } : null,
      expClrOverlap: exp && clr ? M.overlap(exp, clr) : false,
      tilesClipped: tiles.filter((t) => !M.fullyVisible(t) || t.scrollWidth > t.clientWidth + 1).length, tiles: tiles.length,
      vw: window.innerWidth,
    };
  });
  if (!top) { rec(`${label} compliance: tab strip present`, false); return; }
  rec(`${label} compliance: KPI tiles inside the viewport, values not clipped`, top.tiles === 4 && top.tilesClipped === 0, `${top.tiles} tiles, ${top.tilesClipped} clipped`);
  rec(`${label} compliance: tab strip inside the viewport`, top.stripRight <= top.vw + 0.5, `strip.right=${fmt(top.stripRight)}`);
  rec(`${label} compliance: 'System logs' tab reachable by scrolling the strip`, top.reach, `after scroll=${rectStr(top.after)}`);
  rec(`${label} compliance: tab tap height ≥ 44`, top.minTabH >= TAP, `minH=${fmt(top.minTabH)}`);
  rec(`${label} compliance: Export fully visible`, !!(top.exp && top.exp.vis), top.exp ? rectStr(top.exp.r) : "none");
  if (clear) {
    rec(`${label} compliance: Clear logs fully visible`, !!(top.clr && top.clr.vis), top.clr ? rectStr(top.clr.r) : "none");
    rec(`${label} compliance: Export and Clear logs do not overlap`, !top.expClrOverlap);
    rec(`${label} compliance: Export / Clear logs tap height ≥ 44`, !!(top.exp && top.clr) && top.exp.r.height >= TAP && top.clr.r.height >= TAP, top.exp && top.clr ? `${fmt(top.exp.r.height)},${fmt(top.clr.r.height)}` : "");
  } else {
    rec(`${label} compliance: no Clear logs for this role`, !top.clr);
    rec(`${label} compliance: Export tap height ≥ 44`, !!top.exp && top.exp.r.height >= TAP, top.exp ? fmt(top.exp.r.height) : "");
  }

  for (const [tabLabel, lastHead] of [["Audit log", "Risk"], ["PHI access", "Result"], ["System logs", "Event"], ["Security incidents", null]]) {
    if (!lastHead) {
      // The web client lists no incidents from the server today, so render two
      // display-only rows in local state (never sent anywhere) to measure the
      // incident card layout; the previous list is restored afterwards.
      await page.evaluate(() => window.DT.set((s) => {
        window.__savedIncidents = s.incidents;
        s.incidents = [
          { id: "lay-1", type: "unusual_access_pattern_detected", sev: "high", desc: "Layout check: 48 chart opens in 5 minutes from one workstation", status: "open", at: Date.now() - 600000 },
          { id: "lay-2", type: "brute_force", sev: "critical", desc: "Layout check: repeated failed sign-ins", status: "investigating", at: Date.now() - 60000 },
        ];
        return s;
      }));
    }
    await page.evaluate((t) => { const b = window.__m.byText("button", new RegExp("^" + t + "$"))[0]; if (b) b.click(); }, tabLabel);
    await sleep(200);
    await noOverflow(page, `${label} compliance ${tabLabel}`);
    const t = await page.evaluate((lastHead) => {
      const M = window.__m;
      if (!lastHead) {
        // incident cards: Resolve buttons and status badges inside the viewport
        const res = M.byText("button", /^Resolve$/);
        const cards = res.map((b) => { let p = b.parentElement; while (p && !/box-shadow/.test(p.getAttribute("style") || "")) p = p.parentElement; return p; }).filter(Boolean);
        const all = [...document.querySelectorAll("span.ds-mono")].filter((t) => /^[a-z ]+$/i.test(t.textContent.trim())).map((t) => { let p = t.parentElement; while (p && !/box-shadow/.test(p.getAttribute("style") || "")) p = p.parentElement; return p; }).filter(Boolean);
        const spill = (c) => [...c.querySelectorAll("div,span")].some((e) => getComputedStyle(e).display !== "inline" && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === "visible");
        return { kind: "incidents", res: res.map((b) => ({ vis: M.fullyVisible(b), h: M.rect(b).height })), cards: cards.map((c) => ({ vis: M.fullyVisible(c), over: c.scrollWidth > c.clientWidth + 1 })), spilling: [...new Set(all)].filter(spill).length, n: new Set(all).size };
      }
      const head = [...document.querySelectorAll("span")].find((s) => s.textContent.trim() === lastHead && s.children.length === 0 && getComputedStyle(s.parentElement).textTransform === "uppercase");
      if (!head) return null;
      const headRow = head.parentElement;
      const card = headRow.parentElement;
      const rows = [...card.children].filter((r) => r !== headRow && getComputedStyle(r).display === "flex");
      const sample = rows.slice(0, 12);
      const lastCells = sample.map((r) => r.lastElementChild);
      // text columns that must not draw over each other (audit: actor vs action)
      const overlaps = sample.filter((r) => { const kids = [...r.children]; for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) if (M.rect(kids[i]).width && M.rect(kids[j]).width && M.overlap(kids[i], kids[j])) return true; return false; }).length;
      // a cell whose content is wider than the cell and not clipped/ellipsised
      // draws over its neighbour (the "ExpoC" / action-over-actor smear)
      const spills = (k) => k.scrollWidth > k.clientWidth + 1 && getComputedStyle(k).overflow === "visible";
      const spilling = sample.map((r) => [...r.children].map((k, i) => spills(k) ? `#${i}:${k.textContent.trim().slice(0, 16)}(${k.scrollWidth}>${k.clientWidth})` : null).filter(Boolean)).filter((x) => x.length);
      const textOverflow = spilling.length;
      return {
        kind: "table",
        head: { vis: M.fullyVisible(head), r: M.rect(head) },
        headOver: headRow.scrollWidth > headRow.clientWidth + 1,
        rowsOver: sample.filter((r) => r.scrollWidth > r.clientWidth + 1).length,
        lastVis: lastCells.filter((c) => c && !M.fullyVisible(c)).length,
        overlaps, textOverflow, spillWhat: spilling.slice(0, 2).map((x) => x.join(" ")).join(" | "), n: rows.length,
      };
    }, lastHead);
    if (!t) { rec(`${label} compliance ${tabLabel}: table present`, false); continue; }
    if (t.kind === "incidents") {
      rec(`${label} compliance incidents: cards and Resolve buttons inside the viewport`, t.cards.every((c) => c.vis && !c.over) && t.res.every((b) => b.vis), `${t.cards.length} open cards`);
      rec(`${label} compliance incidents: no text spills out of its column`, t.n === 2 && t.spilling === 0, `${t.spilling} of ${t.n} cards spill`);
      rec(`${label} compliance incidents: Resolve tap height ≥ 44`, t.res.length === 2 && t.res.every((b) => b.h >= TAP), t.res.map((b) => fmt(b.h)).join(","));
      await page.evaluate(() => window.DT.set((s) => { s.incidents = window.__savedIncidents || []; return s; }));
      continue;
    }
    rec(`${label} compliance ${tabLabel}: '${lastHead}' header fully visible`, t.head.vis, rectStr(t.head.r));
    rec(`${label} compliance ${tabLabel}: header and rows fit the Card`, !t.headOver && t.rowsOver === 0, `headOver=${t.headOver} rowsOver=${t.rowsOver}/${t.n}`);
    rec(`${label} compliance ${tabLabel}: last column visible in every row`, t.lastVis === 0, `${t.lastVis} clipped`);
    rec(`${label} compliance ${tabLabel}: no column drawn over another`, t.overlaps === 0 && t.textOverflow === 0, `overlapping rows=${t.overlaps} rows with spilling cells=${t.textOverflow} ${t.spillWhat || ""}`);
  }
  await page.evaluate(() => { const b = window.__m.byText("button", /^Audit log$/)[0]; if (b) b.click(); });
}

// Presence dot on an avatar (A.CON-SHO-55 fix-up). Each wrapper is a
// position:relative box holding an Avatar and an absolutely-positioned ring
// around the 9px StatusDot; without display:flex the ring's line box is
// 19-23px tall, so the white ring becomes a tall pill over the initials.
async function checkPresenceDots(page, label, scopeKind) {
  const d = await page.evaluate((kind) => {
    const M = window.__m;
    let scope = null;
    if (kind === "careteam") { const h = M.h2(/^Doctors on service$/); scope = h ? h.parentElement.nextElementSibling : null; }
    else if (kind === "convlist") { const h = M.h2(/^Messages$/); scope = h ? h.parentElement.parentElement.parentElement : null; }
    else if (kind === "picker") { const t = M.byText("div", /^New message$/).find((x) => x.children.length === 0); scope = t ? t.parentElement.parentElement : null; }
    if (!scope) return null;
    const rings = [...scope.querySelectorAll("span[style*='position: absolute'][style*='border: 2px solid']")].filter((s) => s.firstElementChild && getComputedStyle(s.firstElementChild).width === "9px");
    return rings.map((ring) => {
      const avatar = ring.previousElementSibling;
      const dot = ring.firstElementChild;
      return { ringH: M.rect(ring).height, ringW: M.rect(ring).width, dotBottom: M.rect(dot).bottom, dotRight: M.rect(dot).right, avBottom: avatar ? M.rect(avatar).bottom : null, avRight: avatar ? M.rect(avatar).right : null };
    });
  }, scopeKind);
  if (!d || !d.length) { rec(`${label}: presence dots present`, false, d ? "0 dots" : "screen not found"); return; }
  const onRim = d.every((r) => r.avBottom != null && Math.abs(r.dotBottom - r.avBottom) <= 3 && Math.abs(r.dotRight - r.avRight) <= 3);
  const round = d.every((r) => r.ringH <= 14 && Math.abs(r.ringH - r.ringW) <= 1);
  rec(`${label}: presence dot on the avatar's bottom-right rim (±3px)`, onRim, `${d.length} dots; first dotBottom=${fmt(d[0].dotBottom)} avatarBottom=${fmt(d[0].avBottom)} dotRight=${fmt(d[0].dotRight)} avatarRight=${fmt(d[0].avRight)}`);
  rec(`${label}: presence ring is a 13px circle, not a tall pill`, round, `ring=${fmt(d[0].ringW)}x${fmt(d[0].ringH)}`);
}

async function checkCareTeamDots(page) {
  await nav(page, "team");
  await checkPresenceDots(page, "care team 'Doctors on service'", "careteam");
}

async function checkMessagingDots(page) {
  await nav(page, "messages");
  // New-message picker (pencil button next to the "Messages" title)
  await page.evaluate(() => { const h = window.__m.h2(/^Messages$/); const b = h && h.parentElement.querySelector("button"); if (b) b.click(); });
  await sleep(400);
  await prep(page);
  await checkPresenceDots(page, "messages new-message picker", "picker");
  // Fixture for the conversation list: a 1:1 thread needs to exist. If the
  // list has none, pick the first person in the directory (opens a thread),
  // then come back to the list.
  const started = await page.evaluate(() => {
    const st = window.DT.getState();
    if ((st.conversations || []).some((c) => !c.group && !c.broadcast)) { const b = window.__m.byText("button", /^Close$/)[0]; if (b) b.click(); return false; }
    const t = window.__m.byText("div", /^New message$/).find((x) => x.children.length === 0);
    const ring = t && t.parentElement.parentElement.querySelector("span[style*='border: 2px solid']");
    const btn = ring && ring.closest("button");
    if (btn) btn.click();
    return !!btn;
  });
  await sleep(600);
  if (started) { await nav(page, "dashboard"); }
  await nav(page, "messages");
  await checkPresenceDots(page, "messages conversation list", "convlist");
}

// Appearance (A.CON-MIN-13 fix-up): the collapsed 1fr grid track kept the
// children's min-content width (420px), so the workspace-name input, swatches,
// segmented controls, nav toggles and Reset sat past the viewport.
async function checkAppearance(page, label) {
  await nav(page, "appearance");
  await noOverflow(page, `${label} appearance`);
  const m = await page.evaluate(() => {
    const M = window.__m;
    const g = (els) => ({ n: els.length, bad: els.filter((e) => !M.fullyVisible(e)).map((e) => (e.getAttribute("title") || e.textContent || e.tagName).trim().slice(0, 18) + rectStrIn(M.rect(e))), minH: els.length ? Math.min(...els.map((e) => M.rect(e).height)) : null });
    function rectStrIn(r) { return `[${Math.round(r.left)}..${Math.round(r.right)}]`; }
    const input = [...document.querySelectorAll("input")].filter((i) => i.placeholder === "DocTurn");
    const swatches = ["Blue", "Teal", "Violet", "Pink", "Red", "Orange", "Cyan", "Slate"].map((n) => document.querySelector(`button[title='${n}']`)).filter(Boolean);
    const segs = M.byText("button", /^(Classic|Calm|Warm|Sharp|Rounded|Soft|Expanded|Compact|Standard|Wide|Full)$/);
    const toggles = M.byText("button", /^Visible$/);
    const reset = M.byText("button", /^Reset to defaults$/);
    const preview = M.byText("span", /^Live preview$/)[0];
    const previewCard = preview ? preview.parentElement.parentElement : null;
    return { input: g(input), swatches: g(swatches), segs: g(segs), toggles: g(toggles), reset: g(reset), preview: previewCard ? M.fullyVisible(previewCard) : null };
  });
  for (const [k, name, min] of [["input", "workspace-name input", 1], ["swatches", "accent swatches", 8], ["segs", "segmented controls", 11], ["toggles", "nav 'Visible' toggles", 1], ["reset", "'Reset to defaults'", 1]]) {
    const g = m[k];
    rec(`${label} appearance: ${name} fully visible`, g.n >= min && g.bad.length === 0, `${g.n} found${g.bad.length ? "; clipped: " + g.bad.slice(0, 4).join(" ") : ""}`);
    rec(`${label} appearance: ${name} tap height ≥ 44`, g.n >= min && g.minH >= TAP, `minH=${fmt(g.minH)}`);
  }
  rec(`${label} appearance: live preview card inside the viewport`, m.preview === true, String(m.preview));
}

// Access & people strip (People.jsx AccessPeople, reached via setNav("access")):
// the "identical strip" A.CON-SHO-50 names next to the Directory hub one.
async function checkAccessStrip(page, label) {
  await nav(page, "access");
  await noOverflow(page, `${label} access & people`);
  const t = await page.evaluate(() => {
    const M = window.__m;
    const roles = M.byText("button", /Roles & permissions/)[0];
    if (!roles) return null;
    const strip = roles.parentElement;
    const tabs = [...strip.querySelectorAll("button")];
    return { strip: M.rect(strip), tabs: tabs.map((b) => ({ vis: M.fullyVisible(b), h: M.rect(b).height })), vw: window.innerWidth };
  });
  if (!t) { rec(`${label} access & people: tab strip present`, false); return; }
  rec(`${label} access & people: tab strip and both tabs inside the viewport`, t.strip.right <= t.vw + 0.5 && t.tabs.every((b) => b.vis), `strip=${rectStr(t.strip)}`);
  rec(`${label} access & people: tabs single-line, tap height ≥ 44`, t.tabs.every((b) => b.h >= TAP && b.h < 60), t.tabs.map((b) => fmt(b.h)).join(","));
}

// Settings tab strip (A.CON-SHO-50 final round). SettingsTabs heads the
// director / ER director Organization, Appearance, Compliance and Compliance
// monitor screens. Under the coarse-pointer `button { min-width: 44px }` rule
// (A.CON-SHO-52) its flex '0 1 auto' tabs shrank to 74-118px while their
// labels need 123-185px, drawing each label 33-50px over the next tab
// ('OrganizaⓅoAppea'); the strip must scroll instead of squashing.
const SETTINGS_TAB_SCREENS = ["settings", "appearance", "compliance", "compliance-monitor"];
async function checkSettingsTabs(page, label) {
  for (const id of SETTINGS_TAB_SCREENS) {
    await nav(page, id);
    const t = await page.evaluate(() => {
      const M = window.__m;
      const mon = M.byText("button", /^Compliance monitor$/).find((b) => b.parentElement && b.parentElement.querySelectorAll(":scope > button").length === 4);
      if (!mon) return null;
      const strip = mon.parentElement;
      const tabs = [...strip.querySelectorAll(":scope > button")];
      const stripR = M.rect(strip);
      strip.scrollLeft = 0;
      const info = tabs.map((b) => ({ text: b.textContent.trim(), w: M.rect(b).width, spill: M.labelSpill(b), h: M.rect(b).height }));
      // how far each tab's label is drawn into the NEXT tab's box
      const into = tabs.slice(0, -1).map((b, i) => { const c = M.contentBox(b); return c ? Math.max(0, c.right - M.rect(tabs[i + 1]).left) : 0; });
      strip.scrollLeft = strip.scrollWidth;
      const after = M.rect(mon);
      const reach = after.left >= stripR.left - 0.5 && after.right <= stripR.right + 0.5 && M.inViewportX(after) && M.labelSpill(mon) <= 1;
      strip.scrollLeft = 0;
      return { info, into, reach, after, stripRight: stripR.right, sw: strip.scrollWidth, cw: strip.clientWidth, vw: window.innerWidth };
    });
    const l = `${label} ${id}`;
    if (!t) { rec(`${l}: Settings tab strip present (4 tabs)`, false); continue; }
    rec(`${l}: every Settings tab label inside its own tab`, t.info.every((b) => b.spill <= 1), t.info.map((b) => `${b.text}=${fmt(b.w)}px${b.spill > 1 ? `(+${fmt(b.spill)} outside)` : ""}`).join(" "));
    rec(`${l}: no Settings tab label drawn over the next tab`, t.into.every((d) => d <= 0.5), `overlap into next=${t.into.map(fmt).join("/")}px`);
    rec(`${l}: Settings tab strip inside the viewport`, t.stripRight <= t.vw + 0.5, `strip.right=${fmt(t.stripRight)} scrollWidth=${t.sw} clientWidth=${t.cw}`);
    rec(`${l}: 'Compliance monitor' tab reachable by scrolling the strip`, t.reach, `after scroll=${rectStr(t.after)}`);
    rec(`${l}: Settings tab tap height ≥ 44, single line`, t.info.every((b) => b.h >= TAP && b.h < 60), t.info.map((b) => fmt(b.h)).join(","));
  }
}

// Every control on every screen of a role keeps its label and icon inside its
// own box. Same root cause as the Settings tab strip: with min-width:44px a
// nowrap button in a tight flex row shrinks below its label — the Access &
// people / People "Add person" button drew its icon outside an 79px box, and
// Roles & permissions' "Create new role" its label 9-15px past its edge.
const SCREENS = {
  hospitalist: ["dashboard", "history", "oncall", "messages", "directory", "compliance", "account"],
  er_doctor: ["dashboard", "oncall", "messages", "directory", "compliance", "account"],
  director: ["dashboard", "board", "admissions", "oncall", "approvals", "consult", "roles", "broadcasts", "messages", "directory", "settings", "appearance", "compliance", "compliance-monitor", "account", "access"],
  er_director: ["dashboard", "board", "oncall", "approvals", "broadcasts", "messages", "directory", "settings", "appearance", "compliance", "compliance-monitor", "account", "access"],
  developer: ["dashboard", "enterprise", "settings", "users", "compliance", "compliance-monitor", "appearance", "account"],
};
async function checkLabelsInside(page, label) {
  const bad = await page.evaluate(() => window.__m.spilledButtons());
  rec(`${label}: every button label/icon drawn inside its button`, bad.length === 0, bad.slice(0, 4).map((b) => `'${b.text}' ${b.spill}px outside a ${b.w}px button`).join("; "));
  // ...and a button that keeps its width must wrap with its row, not be
  // pushed past its Card or the screen (director Home "Add provider",
  // Consult services "Remove service").
  const out = await page.evaluate(() => window.__m.outOfBox());
  rec(`${label}: every button inside the viewport and its card`, out.length === 0, `${out.length} outside${out.length ? ": " + [...new Set(out)].slice(0, 3).join("; ") : ""}`);
}
// Forms a screen opens in place or as a modal, checked the same way once open
// (the Add provider modal's 4 equal-width role choices left "Hospitalist"
// drawn past its button at 375px).
const OPENERS = {
  director: { dashboard: ["Add provider"], access: ["Add person"], roles: ["Create new role"] },
  er_director: { dashboard: ["Add"], access: ["Add person"] },
  developer: { dashboard: ["Add user / provider"] },
};
async function sweepLabels(page, role, label) {
  for (const id of SCREENS[role]) {
    await nav(page, id);
    // a button that no longer shrinks must not push the page sideways instead
    await noOverflow(page, `${label} ${id}`);
    await checkLabelsInside(page, `${label} ${id}`);
    for (const opener of (OPENERS[role] || {})[id] || []) {
      const ok = await page.evaluate((t) => { const b = window.__m.byText("main button", new RegExp("^" + t.replace(/[/]/g, "\\/") + "$"))[0]; if (b) b.click(); return !!b; }, opener);
      if (!ok) { rec(`${label} ${id}: '${opener}' present`, false); continue; }
      await sleep(400);
      await prep(page);
      await noOverflow(page, `${label} ${id} › ${opener} open`);
      await checkLabelsInside(page, `${label} ${id} › ${opener} open`);
    }
    if (id === "directory" && (role === "director" || role === "er_director")) {
      for (const sub of ["People", "Consult services", "Roles & permissions", "Directory"]) {
        const ok = await page.evaluate((s) => { const b = window.__m.byText("button", new RegExp("^" + s.replace(/[&]/g, "\\&") + "$"))[0]; if (b) b.click(); return !!b; }, sub);
        if (!ok) { rec(`${label} directory › ${sub}: sub-tab present`, false); continue; }
        await sleep(400);
        await prep(page);
        if (sub === "Directory") continue;
        await noOverflow(page, `${label} directory › ${sub}`);
        await checkLabelsInside(page, `${label} directory › ${sub}`);
      }
    }
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
    // The 44px tap-target rule (and the squash it caused) only applies under
    // (hover: none) and (pointer: coarse); without it these checks prove nothing.
    rec("profile is a touch phone: (hover: none) and (pointer: coarse) matches", await page.evaluate(() => matchMedia("(hover: none) and (pointer: coarse)").matches));
    // LABELS_ONLY=1 runs just the Settings tab strip + label sweep (A.CON-SHO-50 final round).
    const all = !process.env.LABELS_ONLY;
    if (all) {
      const fx = await ensureFixtures(page);
      rec("fixtures: ER→hospitalist routed/accepted row available", !!fx, JSON.stringify(fx));
    }

    await login(page, "hospitalist", "ISPN", "chen");
    if (all) {
      await checkHospitalistHome(page);
      await checkDirectory(page, false);
      await checkCareTeamDots(page);
      await checkMessagingDots(page);
      await checkCompliance(page, "hospitalist", { clear: false });
    }
    await sweepLabels(page, "hospitalist", "hospitalist");

    await login(page, "er_doctor", "ISPN", "er.doc");
    if (all) await checkErDoctorHome(page);
    await sweepLabels(page, "er_doctor", "ER doctor");

    await login(page, "director", "ISPN", "director");
    if (all) {
      await checkDirectorHome(page);
      await checkAdmissionsHeader(page, "director home");
      await checkDirectory(page, true);
      await checkBoardControls(page, "director");
      await nav(page, "admissions");
      await noOverflow(page, "director admissions log");
      await checkAdmissionsHeader(page, "director admissions log");
      await checkCompliance(page, "director");
      await checkAppearance(page, "director");
      await checkAccessStrip(page, "director");
    }
    await checkSettingsTabs(page, "director");
    await sweepLabels(page, "director", "director");

    await login(page, "er_director", "ISPN", "er.director");
    if (all) {
      await checkErDirectorHome(page);
      await checkBoardControls(page, "ER director");
      await checkCompliance(page, "ER director");
      await checkAppearance(page, "ER director");
    }
    await checkSettingsTabs(page, "ER director");
    await sweepLabels(page, "er_director", "ER director");

    await login(page, "developer", "DOCTURN", "dev");
    if (all) {
      await checkDeveloper(page);
      await checkAppearance(page, "developer");
    }
    await sweepLabels(page, "developer", "developer");

    rec("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
}

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length} passed, ${fails.length} failed, ${results.length} total`);
process.exit(fails.length ? 1 : 0);
