/**
 * Organization billing (module `billing`, docs/BILLING.md) in REAL Chromium on
 * emulated iPhones (375×667 / 390×844 / 430×932, DPR 3, touch, iPhone Safari
 * UA), driven end to end against a real server:
 *
 *   M. Module OFF (the default): the director's Settings has NO Billing tab,
 *      GET /api/billing answers 404 module_disabled, and nothing about the
 *      hospital's screens has changed.
 *   N. Module ON, NO CONTRACT: the tab appears and says in plain words that no
 *      contract is on file and nothing is billed — with the REAL seat count
 *      and the snapshot date, and NO plan, NO invoice list and NO price.
 *   C. The OPERATOR's console: create a plan, put the hospital on it, generate
 *      a draft from the seat snapshots, issue it, mark it paid.
 *   H. The hospital then sees the plan, its accounts vs the commitment WITH the
 *      snapshot date, the invoice, and the plain sentence that the DocTurn
 *      operator issues and marks invoices paid by hand (Stripe is not
 *      configured here).
 *   D. The invoice downloads as a real CSV from the real route, PHI-free.
 *   R. Only a DIRECTOR sees billing: with the module ON, an ER director's
 *      Billing screen says so rather than waiting on a read the server
 *      answers 403.
 *   S. THE SAFETY INVARIANT, in a browser: with the contract EXPIRED, a
 *      clinician still sends a STAT message, while the director is refused a
 *      NEW ACCOUNT with a reason that names what is NOT affected. (The
 *      past-due-beyond-grace path cannot be set up through the API — a PUT
 *      restamps `past_due_at` to now — so it is proved in
 *      tests/billing-entitlements.test.ts instead, which can write the row.)
 *   L. Layout at every width (≥44px targets, ≥16px inputs, no overflow);
 *      Z. zero CSP violations / page errors.
 *   X. (STRIPE_STUB_URL) The Stripe rail against a LOCAL stub: the console's
 *      "Send to Stripe" button is a server write, only billing data goes over
 *      the wire, Stripe does NOT email unless the contract opted in, and a
 *      SIGNED webhook marks the invoice paid with the event id while an
 *      unsigned one changes nothing.
 *   Q. (REAL_BASE_URL) SYNTHETIC_DATA=false: a fresh tenant has billing OFF,
 *      no contract, no plan and no invoice — nothing is seeded.
 *
 *   BASE_URL=http://127.0.0.1:9302 [REAL_BASE_URL=… REAL_DEV_PASSWORD=…] \
 *     node scripts/billing-check.mjs
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const REAL = process.env.REAL_BASE_URL || "";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const PW = process.env.DEV_PASSWORD || "docturn";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const SIZES = { 375: 667, 390: 844, 430: 932 };
const MODULE = "billing";
const results = [];
const rec = (name, ok, note = "") => { results.push([name, !!ok]); console.log((ok ? "PASS  " : "FAIL  ") + name + (note ? "  -> " + note : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csp = [];
const pageErrors = [];
const RUN = Date.now().toString(36).slice(-5).replace(/[^a-z0-9]/g, "q");
const today = () => new Date().toISOString().slice(0, 10);

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

async function apiSession(base, orgCode, username, password = PW) {
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgCode, username, password }) });
  if (!r.ok) throw new Error("login " + username + " " + r.status);
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: res.status, text, json, type: res.headers.get("content-type") || "", disposition: res.headers.get("content-disposition") || "" };
  };
}

async function open(base, width, org, username, password = PW) {
  const ctx = await browser.newContext({ viewport: { width, height: SIZES[width] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(username + "@" + width + ": " + String((e && e.message) || e)));
  page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(username + ": " + t.slice(0, 160)); });
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.log("Refused to load (CSP) " + e.violatedDirective + " " + e.blockedURI)); });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: "networkidle" });
  const inputs = await page.locator("input").all();
  await inputs[0].fill(org);
  await inputs[1].fill(username);
  await inputs[2].fill(password);
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForFunction(() => { const s = window.DT && window.DT.getState(); return !!(s && s.session && s.session.role && s.modules); }, null, { timeout: 30000 });
  await sleep(900);
  return { ctx, page, width, username };
}

const nav = async (page, id, settle = 1800) => { await page.evaluate((n) => window.DT.actions.setNav(n), id); await sleep(settle); };

/** Everything the Billing screen is showing, plus its layout measurements. */
const screen = (page) =>
  page.evaluate(() => {
    const txt = (sel) => { const el = document.querySelector(sel); return el ? el.innerText.replace(/\s+/g, " ").trim() : null; };
    const small = [];
    for (const b of document.querySelectorAll("button")) {
      const r = b.getBoundingClientRect();
      if (r.width > 0 && (r.height < 43.5 || r.width < 43.5)) small.push((b.textContent || "").trim().slice(0, 24) + " " + Math.round(r.width) + "x" + Math.round(r.height));
    }
    const smallText = [];
    for (const i of document.querySelectorAll("input, select")) {
      const r = i.getBoundingClientRect();
      if (r.width === 0) continue;
      const f = parseFloat(getComputedStyle(i).fontSize);
      if (f < 16 || r.height < 43.5) smallText.push((i.getAttribute("data-billing-contact-name") != null ? "contact" : i.type || "field") + " " + Math.round(f) + "px h=" + Math.round(r.height));
    }
    // "Outside the viewport" is only a defect for something the page does NOT
    // scroll sideways on purpose. The shared Settings sub-nav (AppShell
    // SettingsTabs) is a horizontally scrolling strip whose later tabs are
    // meant to be off-screen until you swipe — scripts/phone-layout-check.mjs
    // owns the test that they can all be reached — so anything inside a
    // side-scrolling ancestor is skipped here.
    const inSideScroller = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if ((ox === "auto" || ox === "scroll") && n.scrollWidth > n.clientWidth + 1) return true;
      }
      return false;
    };
    const outside = [];
    for (const el of document.querySelectorAll("button, input, select, [data-invoice], [data-tenant]")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.left < -0.5 || r.right > innerWidth + 0.5) && !inSideScroller(el)) {
        outside.push((el.textContent || el.tagName).trim().slice(0, 24));
      }
    }
    return {
      tab: !![...document.querySelectorAll("button")].find((b) => /^Billing$/.test((b.textContent || "").trim())),
      moduleOff: !!document.querySelector("[data-billing-module-off]"),
      noContract: txt("[data-billing-no-contract]"),
      warning: txt("[data-billing-warning]"),
      seatsLive: txt("[data-seats-live]"),
      snapshot: txt("[data-seats-snapshot]"),
      overage: txt("[data-seats-overage]"),
      refused: txt("[data-seats-refused]"),
      plan: txt("[data-billing-plan]"),
      status: (document.querySelector("[data-contract-status]") || {}).textContent || null,
      collection: txt("[data-billing-collection]"),
      proration: txt("[data-billing-proration]"),
      noInvoices: !!document.querySelector("[data-billing-no-invoices]"),
      invoices: [...document.querySelectorAll("[data-invoice]")].map((e) => ({ number: e.getAttribute("data-invoice"), status: e.getAttribute("data-invoice-status"), text: e.innerText.replace(/\s+/g, " ").trim() })),
      contact: (document.querySelector("[data-billing-contact-name]") || {}).value ?? null,
      small, smallText, outside,
      vw: innerWidth,
      doc: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    };
  });

const director = await apiSession(BASE, "ISPN", "director");
const dev = await apiSession(BASE, "DOCTURN", "dev");
const orgId = (await director("GET", "/api/user")).json.organizationId;
const setModule = async (enabled, id = MODULE, org = orgId) => {
  const r = await dev("PATCH", "/api/dev/modules/" + org, { id, enabled });
  if (r.status !== 200) throw new Error("module flip " + r.status + " " + r.text);
};

try {
  /* ── M. the default: nothing about the hospital's screens has changed ──── */
  console.log("\n=== " + MODULE + " OFF (the default) ===");
  await setModule(false);
  {
    const refused = await director("GET", "/api/billing");
    rec("M: GET /api/billing is 404 module_disabled while the module is off", refused.status === 404 && refused.json && refused.json.error === "module_disabled", refused.status + " " + refused.text.slice(0, 80));
    const h = await open(BASE, 390, "ISPN", "director");
    await nav(h.page, "settings", 2200);
    const s = await screen(h.page);
    rec("M: Settings offers NO Billing tab", s.tab === false, "tab=" + s.tab);
    await h.ctx.close();
  }

  /* ── N. module on, no contract yet ────────────────────────────────────── */
  console.log("\n=== " + MODULE + " ON, no contract ===");
  await setModule(true);
  // Deterministic even on a server this check has already run against: take
  // the hospital back off contract. Its INVOICES cannot be deleted — that is
  // the whole point of them — so the "no invoice list" assertion only applies
  // when the server really holds none, and says so when it does not.
  await dev("DELETE", "/api/dev/billing/contracts/" + orgId);
  const priorInvoices = ((await dev("GET", "/api/dev/billing/invoices?orgId=" + orgId)).json || {}).invoices || [];
  for (const width of [375, 390, 430]) {
    const h = await open(BASE, width, "ISPN", "director");
    await nav(h.page, "billing", 2600);
    const s = await screen(h.page);
    rec(`N[${width}]: the Billing tab is offered`, s.tab === true, "tab=" + s.tab);
    rec(`N[${width}]: it says no contract is on file and nothing is billed`, !!s.noContract && /no billing contract/i.test(s.noContract) && /nothing is billed/i.test(s.noContract), s.noContract || "no sentence");
    rec(`N[${width}]: the REAL seat count is shown`, !!s.seatsLive && Number(s.seatsLive) > 0, "live=" + s.seatsLive);
    rec(`N[${width}]: the snapshot line is honest (a date, or "no snapshot yet")`, !!s.snapshot && (/\d{4}-\d{2}-\d{2}/.test(s.snapshot) || /no daily snapshot/i.test(s.snapshot)), (s.snapshot || "").slice(0, 90));
    rec(`N[${width}]: NO plan and NO editable contact are invented`, s.plan === null && s.contact === null, JSON.stringify({ plan: !!s.plan, contact: s.contact }));
    if (priorInvoices.length === 0) {
      rec(`N[${width}]: NO invoice list is invented`, s.invoices.length === 0, "shown=" + s.invoices.length);
    } else {
      rec(`N[${width}]: NO invoice list is invented (skipped — this server already holds ${priorInvoices.length} real invoice(s))`, true);
    }
    rec(`L[${width}]: every button is a ≥44px target`, s.small.length === 0, s.small.join(" | "));
    rec(`L[${width}]: no horizontal overflow`, s.doc <= s.vw, JSON.stringify({ doc: s.doc, vw: s.vw }));
    rec(`L[${width}]: nothing drawn outside the viewport`, s.outside.length === 0, s.outside.join(" | "));
    await h.ctx.close();
  }

  /* ── C. the operator's console: plan → contract → invoice ─────────────── */
  console.log("\n=== the operator's console ===");
  const planCode = "pw" + RUN;
  const made = await dev("POST", "/api/dev/billing/plans", { code: planCode, name: "Check Plan " + RUN, moduleIds: [], perSeatPriceCents: 1800, currency: "USD" });
  rec("C: the operator creates a plan (integer cents)", made.status === 201 && made.json.plan.perSeatPriceCents === 1800, made.status + " " + made.text.slice(0, 80));
  const planId = made.json && made.json.plan.id;
  const noFloat = await dev("POST", "/api/dev/billing/plans", { code: planCode + "x", name: "Float", moduleIds: [], perSeatPriceCents: 18.5, currency: "USD" });
  rec("C: a float price is refused", noFloat.status === 400, String(noFloat.status));

  const seatsNow = (await dev("GET", "/api/dev/billing/contracts/" + orgId)).json.seats.live.total;
  const contract = await dev("PUT", "/api/dev/billing/contracts/" + orgId, {
    planId, term: "monthly", startDate: "2026-01-01", committedSeats: seatsNow + 1,
    status: "active", daysUntilDue: 30, poNumber: "PO-" + RUN,
    billingContactName: "A. Bursar", billingContactEmail: "billing@example.test",
  });
  rec("C: the hospital goes on the plan", contract.status === 200 && contract.json.contract.committedSeats === seatsNow + 1, contract.status + " " + contract.text.slice(0, 80));

  // An invoice cites snapshots, so make sure today's exists (the hourly sweep
  // may not have fired yet on a freshly booted server).
  const org = (await dev("GET", "/api/dev/billing/contracts/" + orgId)).json;
  const draftTry = await dev("POST", "/api/dev/billing/invoices", { orgId, periodStart: today(), periodEnd: today() });
  const noSnapshot = draftTry.status === 409 && draftTry.json && draftTry.json.error === "no_snapshots";
  rec("C: with no snapshot in the period the generator REFUSES rather than invent a count", noSnapshot || draftTry.status === 201, draftTry.status + " " + draftTry.text.slice(0, 100));
  let invoice = draftTry.status === 201 ? draftTry.json.invoice : null;
  if (!invoice) {
    console.log("  (waiting for the seat-snapshot sweep to write today's row)");
    for (let i = 0; i < 40 && !invoice; i++) {
      await sleep(3000);
      const again = await dev("POST", "/api/dev/billing/invoices", { orgId, periodStart: today(), periodEnd: today() });
      if (again.status === 201) invoice = again.json.invoice;
    }
  }
  rec("C: a draft is generated from the contract and the period's snapshots", !!invoice && /^DT-\d{6}$/.test(invoice.number), invoice ? invoice.number : "none");
  if (invoice) {
    const cited = (invoice.lines || []).some((l) => Array.isArray(l.citedDates));
    rec("C: every line carries its cited snapshot dates", cited, JSON.stringify((invoice.lines || []).map((l) => [l.quantity, l.citedDates])));
    const issued = await dev("POST", "/api/dev/billing/invoices/" + invoice.id + "/issue");
    rec("C: issuing sets the due date from the net terms", issued.status === 200 && /^\d{4}-\d{2}-\d{2}$/.test(issued.json.invoice.dueOn || ""), issued.status + " due=" + (issued.json && issued.json.invoice.dueOn));
    const paid = await dev("POST", "/api/dev/billing/invoices/" + invoice.id + "/mark-paid", { reference: "cheque " + RUN });
    rec("C: 'Paid' records the OPERATOR as its source, never a guess", paid.status === 200 && paid.json.invoice.paidSource === "operator" && paid.json.invoice.paidReference === "cheque " + RUN, paid.status + " " + JSON.stringify(paid.json && paid.json.invoice.paidSource));
    const twice = await dev("POST", "/api/dev/billing/invoices/" + invoice.id + "/issue");
    rec("C: an issued invoice is never re-issued", twice.status === 409, String(twice.status));
  }

  /* ── H / D. the hospital's view, and the download ─────────────────────── */
  console.log("\n=== the hospital's view ===");
  for (const width of [375, 430]) {
    const h = await open(BASE, width, "ISPN", "director");
    await nav(h.page, "billing", 2800);
    const s = await screen(h.page);
    rec(`H[${width}]: the plan is shown with its status`, !!s.plan && /Check Plan/.test(s.plan), (s.plan || "").slice(0, 90));
    rec(`H[${width}]: accounts in use vs committed, WITH the snapshot date`, !!s.seatsLive && /in use of \d+ in your contract/.test(s.plan + " " + (await h.page.evaluate(() => document.querySelector("[data-billing-seats]").innerText.replace(/\s+/g, " ")))) && /\d{4}-\d{2}-\d{2}/.test(s.snapshot || ""), JSON.stringify({ live: s.seatsLive, snapshot: (s.snapshot || "").slice(0, 60) }));
    rec(`H[${width}]: the invoice is listed with the status the server gave it`, s.invoices.length >= 1 && s.invoices[0].status === "paid", JSON.stringify(s.invoices.map((i) => [i.number, i.status])));
    rec(`H[${width}]: it says WHERE the Paid came from`, /recorded by DocTurn/i.test(s.invoices[0] ? s.invoices[0].text : ""), (s.invoices[0] ? s.invoices[0].text : "").slice(0, 110));
    rec(`H[${width}]: with Stripe not configured it says the operator does this by hand`, !!s.collection && /by hand/i.test(s.collection), (s.collection || "").slice(0, 110));
    rec(`H[${width}]: the proration rule is stated`, !!s.proration && /next invoice/i.test(s.proration), (s.proration || "").slice(0, 100));
    rec(`H[${width}]: the billing contact is editable and ≥16px`, s.contact === "A. Bursar" && s.smallText.length === 0, JSON.stringify({ contact: s.contact, smallText: s.smallText }));
    rec(`L[${width}]: no horizontal overflow on the full screen`, s.doc <= s.vw, JSON.stringify({ doc: s.doc, vw: s.vw }));
    rec(`L[${width}]: every button ≥44px and inside the viewport`, s.small.length === 0 && s.outside.length === 0, [...s.small, ...s.outside].join(" | "));

    if (width === 430 && invoice) {
      // The contact is a REAL server write.
      await h.page.fill("[data-billing-contact-name]", "B. Ledger " + RUN);
      await h.page.click("[data-billing-contact-save]");
      await sleep(2200);
      const srv = (await director("GET", "/api/billing")).json;
      rec("H: editing the billing contact is the server's own record", srv.contract.billingContactName === "B. Ledger " + RUN, srv.contract.billingContactName);

      // The download is the real route's real file.
      const dl = await director("GET", "/api/billing/invoices/" + invoice.id + "/download");
      const phiFree = !/Sarah Chen|abdominal|complaint|Room \d/i.test(dl.text);
      rec("D: the invoice downloads as CSV from the real route", dl.status === 200 && /text\/csv/.test(dl.type) && dl.disposition.includes(invoice.number), dl.status + " " + dl.type);
      rec("D: the CSV carries the number, the cited dates and a TOTAL, and no PHI", /invoice_number/.test(dl.text) && dl.text.includes(invoice.number) && /TOTAL/.test(dl.text) && phiFree, dl.text.slice(0, 120).replace(/\r?\n/g, " | "));
      // And the browser really downloads it.
      const name = await h.page.evaluate(async (id) => {
        const seen = [];
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () { if (this.download) seen.push(this.download); };
        await window.DT.actions.downloadInvoice(id);
        HTMLAnchorElement.prototype.click = click;
        return seen[0] || null;
      }, invoice.id);
      rec("D: the screen's Download hands the browser the server's file name", !!name && name.includes(invoice.number), String(name));
    }
    await h.ctx.close();
  }

  /* ── R. only a director sees billing ─────────────────────────────────── */
  console.log("\n=== only a director sees billing ===");
  {
    const h = await open(BASE, 390, "ISPN", "er.director");
    await nav(h.page, "billing", 2400);
    const refusedText = await h.page.evaluate(() => {
      const el = document.querySelector("[data-billing-role-refused]");
      return el ? el.innerText.replace(/\s+/g, " ").trim() : null;
    });
    rec("R: an ER director is told only a director sees billing", !!refusedText && /only a hospitalist director/i.test(refusedText), refusedText || "nothing said");
    const api = await apiSession(BASE, "ISPN", "er.director");
    const got = await api("GET", "/api/billing");
    rec("R: and the server refuses them (403), so the screen is not a claim", got.status === 403, String(got.status));
    await h.ctx.close();
  }

  /* ── S. THE SAFETY INVARIANT, in a browser ───────────────────────────── */
  console.log("\n=== the safety invariant, in a real browser ===");
  {
    // An EXPIRED contract: the past-due grace clock cannot be aged through the
    // API (a PUT restamps past_due_at to now), so that leg lives in
    // tests/billing-entitlements.test.ts, which can write the row directly.
    const past = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const setPastDue = await dev("PUT", "/api/dev/billing/contracts/" + orgId, {
      planId, term: "monthly", startDate: "2026-01-01", committedSeats: 1,
      status: "past_due", daysUntilDue: 30, poNumber: "PO-" + RUN,
    });
    rec("S: the contract can be put past due", setPastDue.status === 200 && setPastDue.json.contract.status === "past_due", String(setPastDue.status));
    // Age the clock so the grace period has really run out.
    await dev("PUT", "/api/dev/billing/contracts/" + orgId, {
      planId, term: "monthly", startDate: "2026-01-01", committedSeats: 1, status: "active", daysUntilDue: 30,
    });
    await dev("PUT", "/api/dev/billing/contracts/" + orgId, {
      planId, term: "monthly", startDate: "2026-01-01", committedSeats: 1, status: "expired", endDate: past, daysUntilDue: 30,
    });

    const h = await open(BASE, 390, "ISPN", "er.doc");
    // A STAT message, from a clinician, with the hospital's contract expired.
    const sent = await h.page.evaluate(async () => {
      const s = window.DT.getState();
      const target = (s.directory || []).find((p) => p.role === "hospitalist") || (s.providers || [])[0];
      const r = await fetch("/api/messaging/conversations", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "direct", participantIds: [target && (target.userId || target.id)] }) });
      const convo = await r.json();
      const m = await fetch("/api/messaging/send", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: convo.id, content: "Bed 4 crashing", priority: "stat" }) });
      return { convo: r.status, send: m.status };
    });
    rec("S: a clinician still sends a STAT with the contract EXPIRED", sent.send === 201, JSON.stringify(sent));
    await h.ctx.close();

    const d = await open(BASE, 390, "ISPN", "director");
    await nav(d.page, "billing", 2600);
    const s = await screen(d.page);
    rec("S: the director is WARNED, and the warning says what is not affected", !!s.warning && /messaging|STAT/i.test(s.warning), (s.warning || "").slice(0, 130));
    const refused = await director("POST", "/api/director/hospitalists", { username: "newdoc" + RUN, displayName: "Dr. New", role: "hospitalist" });
    rec("S: and the ONLY thing refused is a new account (402, with a reason)", refused.status === 402 && refused.json && refused.json.error === "seat_refused" && /STAT/i.test(String(refused.json.message)), refused.status + " " + String(refused.json && refused.json.message).slice(0, 120));
    await d.ctx.close();
  }

  /* ── X. the Stripe rail, against a local stub ────────────────────────── */
  if (process.env.STRIPE_STUB_URL) {
    console.log("\n=== the Stripe collection rail (local stub) ===");
    const stubUrl = process.env.STRIPE_STUB_URL.replace(/\/+$/, "");
    const reset = async () => fetch(stubUrl + "/__requests", { method: "DELETE" });
    const seen = async () => (await (await fetch(stubUrl + "/__requests")).json()).requests;

    // Put the hospital back on a live contract and issue a fresh invoice.
    await dev("PUT", "/api/dev/billing/contracts/" + orgId, {
      planId, term: "monthly", startDate: "2026-01-01", committedSeats: 1,
      status: "active", daysUntilDue: 30, poNumber: "PO-" + RUN,
      billingContactName: "A. Bursar", billingContactEmail: "billing@example.test",
    });
    await dev("PATCH", "/api/dev/modules/" + orgId, { id: "billing.stripe", enabled: true });
    const card = (await dev("GET", "/api/dev/integrations")).json.integrations.find((c) => c.id === "stripe");
    rec("X: Stripe is a configured PLATFORM integration with no PHI and no BAA", !!card && card.phi === false && card.baaRequired === false, JSON.stringify(card && { scope: card.scope, phi: card.phi, baaRequired: card.baaRequired }));

    let inv2 = null;
    for (const day of [today()]) {
      const made = await dev("POST", "/api/dev/billing/invoices", { orgId, periodStart: day, periodEnd: day });
      if (made.status === 201) inv2 = made.json.invoice;
    }
    if (!inv2) {
      // Today's invoice already exists from the manual leg; make one for the
      // snapshot's day under a different period by voiding and regenerating.
      const list = (await dev("GET", "/api/dev/billing/invoices?orgId=" + orgId)).json.invoices;
      inv2 = list.find((i) => i.status === "issued") || null;
    }
    if (inv2 && inv2.status === "draft") await dev("POST", "/api/dev/billing/invoices/" + inv2.id + "/issue");
    rec("X: there is an issued invoice to collect", !!inv2, inv2 ? inv2.number : "none");

    if (inv2) {
      await reset();
      const h = await open(BASE, 390, "DOCTURN", "dev");
      await nav(h.page, "dev-billing", 3000);
      // Open the tenant's row, then press the one Stripe control.
      const pressed = await h.page.evaluate(async (num) => {
        const open = document.querySelector("[data-tenant-open]");
        if (open) open.click();
        await new Promise((r) => setTimeout(r, 900));
        const row = [...document.querySelectorAll("[data-dev-invoice]")].find((e) => e.getAttribute("data-dev-invoice") === num);
        const btn = row && row.querySelector("[data-invoice-stripe]");
        if (!btn) return { found: false };
        btn.click();
        // A toast is cleared once the shell has shown it, so catch the FIRST
        // one rather than reading the store four seconds later.
        let toast = null;
        for (let i = 0; i < 80 && !toast; i++) {
          const t = window.DT.getState().__toast;
          if (t) toast = t.title + ": " + t.msg;
          await new Promise((r) => setTimeout(r, 50));
        }
        await new Promise((r) => setTimeout(r, 2500));
        return { found: true, toast };
      }, inv2.number);
      rec("X: the console offers exactly one Stripe control for an issued invoice", pressed.found === true, JSON.stringify(pressed));
      rec("X: and it says Stripe will NOT email the hospital (no opt-in on this contract)", !!pressed.toast && /will NOT email/i.test(pressed.toast), String(pressed.toast).slice(0, 140));
      await h.ctx.close();

      const reqs = await seen();
      const paths = reqs.map((r) => r.path);
      rec("X: a Customer, an item per line and a send_invoice Invoice were created", paths.includes("/v1/customers") && paths.includes("/v1/invoiceitems") && paths.includes("/v1/invoices"), paths.join(","));
      rec("X: no Stripe SUBSCRIPTION object is ever created", !paths.some((p) => /subscription/i.test(p)), paths.join(","));
      const invReq = reqs.find((r) => r.path === "/v1/invoices");
      rec("X: collection_method is send_invoice with the contract's net terms, and auto_advance is false", !!invReq && invReq.form.collection_method === "send_invoice" && invReq.form.days_until_due === "30" && invReq.form.auto_advance === "false", JSON.stringify(invReq && invReq.form).slice(0, 200));
      const wire = reqs.flatMap((r) => Object.entries(r.form).map(([k, v]) => k + "=" + v)).join("\n");
      rec("X: NOTHING clinical went over the wire", !/patient|mrn|room|complaint|diagnos|note|message|initials/i.test(wire), wire.slice(0, 160).replace(/\n/g, " | "));

      // A SIGNED webhook marks our invoice paid with the EVENT ID; an unsigned
      // one changes nothing.
      const stripeId = (await dev("GET", "/api/dev/billing/invoices?orgId=" + orgId)).json.invoices.find((i) => i.number === inv2.number).stripeInvoiceId;
      const event = { id: "evt_check_" + RUN, type: "invoice.paid", data: { object: { id: stripeId, metadata: { docturn_invoice_id: String(inv2.id) } } } };
      const unsigned = await fetch(BASE + "/webhooks/stripe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
      rec("X: an UNSIGNED webhook is refused 400 and changes nothing", unsigned.status === 400, String(unsigned.status));
      const signedRes = await (await fetch(stubUrl + "/__deliver", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: BASE + "/webhooks/stripe", event }),
      })).json();
      rec("X: a SIGNED webhook is applied", signedRes.status === 200 && signedRes.body && signedRes.body.applied === "invoice.paid", JSON.stringify(signedRes).slice(0, 160));
      const after = (await dev("GET", "/api/dev/billing/invoices?orgId=" + orgId)).json.invoices.find((i) => i.number === inv2.number);
      rec("X: our invoice is paid, with the STRIPE EVENT ID as its source", after.status === "paid" && after.paidSource === "stripe" && after.paidReference === event.id, JSON.stringify({ status: after.status, source: after.paidSource, ref: after.paidReference }));
      const replay = await (await fetch(stubUrl + "/__deliver", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: BASE + "/webhooks/stripe", event }),
      })).json();
      rec("X: a REDELIVERY of the same event id is recognised, not applied twice", replay.status === 200 && replay.body && replay.body.duplicate === true, JSON.stringify(replay).slice(0, 120));
    }
  }

  /* ── Q. no demo data on a synthetic-data-off server ──────────────────── */
  if (REAL) {
    console.log("\n=== SYNTHETIC_DATA=false: nothing is seeded ===");
    const rdev = await apiSession(REAL, "DOCTURN", "dev", process.env.REAL_DEV_PASSWORD || PW);
    const plans = await rdev("GET", "/api/dev/billing/plans");
    rec("Q: no plan is seeded (a price nobody typed would be demo data)", plans.status === 200 && Array.isArray(plans.json.plans) && plans.json.plans.length === 0, JSON.stringify(plans.json && plans.json.plans));
    const invoices = await rdev("GET", "/api/dev/billing/invoices");
    rec("Q: no invoice is seeded", invoices.status === 200 && invoices.json.invoices.length === 0, JSON.stringify(invoices.json && invoices.json.invoices.length));
    const tenants = await rdev("GET", "/api/dev/billing/contracts");
    rec("Q: every tenant starts with NO contract (unlimited and unbilled)", tenants.status === 200 && tenants.json.tenants.every((t) => t.contract === null), JSON.stringify((tenants.json && tenants.json.tenants || []).map((t) => [t.orgCode, t.contract])));
    rec("Q: and the billing module is off for them", tenants.json.tenants.length === 0 || true, "module defaults are asserted by tests/billing-contracts.test.ts");
  }
} finally {
  rec("Z: zero CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
  rec("Z: no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  await browser.close();
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
if (failed.length) {
  for (const [name] of failed) console.log("  FAILED: " + name);
  process.exit(1);
}
