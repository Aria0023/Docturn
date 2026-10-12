/**
 * Cold / warm load measurement of the web client on an emulated iPhone under
 * Chrome DevTools "Slow 4G" network throttling and 4x CPU slowdown (CDP).
 *
 * What it measures, per run:
 *   cold — a brand-new browser context (empty HTTP cache, no service worker):
 *          navigation start → the login form is on screen and usable
 *          (3 inputs + a "Sign in" button), plus FCP, DOMContentLoaded, load,
 *          main-thread long-task total, request count and bytes on the wire;
 *   warm — the same context reloaded once the service worker is active (the
 *          installed-PWA relaunch case).
 *
 * The shell's build mode is read from <meta name="docturn-build"> (present only
 * when the server serves the precompiled bundle; absent = in-browser Babel).
 *
 * Run (server up with RATE_LIMIT=off):
 *   BASE_URL=http://127.0.0.1:3000 node scripts/load-perf.mjs
 * Options: RUNS=2  CPU_RATE=4  NETWORK=slow4g|none  LABEL=after  JSON=out.json
 *          CHROME_PATH=/opt/pw-browsers/chromium
 * Prints a table and (with JSON=) writes the raw numbers. Exit code is 0 unless
 * the login form never appears (then 1).
 */
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
const RUNS = Number(process.env.RUNS || 1);
const CPU_RATE = Number(process.env.CPU_RATE || 4);
const LABEL = process.env.LABEL || "";
// Chrome DevTools' "Slow 4G" preset (SDK NetworkManager): 1.6 Mbps down /
// 750 kbps up at 90% goodput, 150 ms RTT x 3.75 = 562.5 ms request latency.
const NETWORKS = {
  slow4g: { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1000 * 1000) / 8 * 0.9, uploadThroughput: (750 * 1000) / 8 * 0.9 },
  none: null,
};
const NET = NETWORKS[process.env.NETWORK || "slow4g"];
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// Installed before any page script: long-task accounting and the exact moment
// the login form becomes usable (MutationObserver, so polling cost and the CPU
// throttle cannot blur the timestamp).
const INIT = `(() => {
  const p = (window.__perf = { longTasks: 0, longTaskCount: 0, loginReadyAt: null });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { p.longTasks += e.duration; p.longTaskCount++; }
    }).observe({ type: "longtask", buffered: true });
  } catch (e) {}
  const check = () => {
    if (p.loginReadyAt != null) return;
    if (document.querySelectorAll("input").length < 3) return;
    const btn = Array.prototype.some.call(document.querySelectorAll("button"), (b) => /Sign in/.test(b.textContent || ""));
    if (btn) p.loginReadyAt = performance.now();
  };
  new MutationObserver(check).observe(document, { childList: true, subtree: true });
})();`;

async function throttle(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  if (NET) await cdp.send("Network.emulateNetworkConditions", NET);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });
  const wire = { bytes: 0, requests: 0, fromServiceWorker: 0, fromCache: 0 };
  cdp.on("Network.responseReceived", (e) => {
    wire.requests++;
    if (e.response.fromServiceWorker) wire.fromServiceWorker++;
    if (e.response.fromDiskCache) wire.fromCache++;
  });
  cdp.on("Network.loadingFinished", (e) => { wire.bytes += e.encodedDataLength || 0; });
  return { cdp, wire };
}

async function waitLoginReady(page) {
  await page.waitForFunction(() => window.__perf && window.__perf.loginReadyAt != null, null, {
    timeout: 300000,
    polling: 250,
  });
  // Let load fire so the navigation entry is complete (bounded wait).
  await page.waitForLoadState("load", { timeout: 120000 }).catch(() => {});
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] || {};
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const res = performance.getEntriesByType("resource");
    const meta = document.querySelector('meta[name="docturn-build"]');
    return {
      mode: meta ? "bundle " + meta.getAttribute("content") : "in-browser-babel",
      loginReadyMs: Math.round(window.__perf.loginReadyAt),
      fcpMs: fcp ? Math.round(fcp.startTime) : null,
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd || 0),
      loadMs: Math.round(nav.loadEventEnd || 0),
      longTaskMs: Math.round(window.__perf.longTasks),
      longTaskCount: window.__perf.longTaskCount,
      resources: res.length + 1,
      transferBytes: res.reduce((a, r) => a + (r.transferSize || 0), nav.transferSize || 0),
      decodedBytes: res.reduce((a, r) => a + (r.decodedBodySize || 0), nav.decodedBodySize || 0),
      babelLoaded: typeof window.Babel !== "undefined",
    };
  });
}

async function swSettled(page) {
  return page
    .evaluate(
      () =>
        new Promise((resolve) => {
          if (!("serviceWorker" in navigator)) return resolve({ ok: false, reason: "unsupported" });
          const t = setTimeout(() => resolve({ ok: false, reason: "timeout" }), 240000);
          navigator.serviceWorker.ready.then((reg) => {
            const done = () => {
              if (navigator.serviceWorker.controller && reg.active && reg.active.state === "activated" && !reg.installing && !reg.waiting) {
                clearTimeout(t);
                resolve({ ok: true });
              } else setTimeout(done, 250);
            };
            done();
          });
        }),
    )
    .catch((e) => ({ ok: false, reason: String(e) }));
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const out = [];
let failed = false;
for (let i = 0; i < RUNS; i++) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: UA,
    serviceWorkers: "allow",
  });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const { wire } = await throttle(ctx, page);
  try {
    await page.goto(BASE + "/", { waitUntil: "commit", timeout: 300000 });
    const cold = { ...(await waitLoginReady(page)), wireBytes: wire.bytes, wireRequests: wire.requests };
    const sw = await swSettled(page);
    // Give the install's precache a moment to finish writing.
    await page.waitForTimeout(1500);
    Object.assign(wire, { bytes: 0, requests: 0, fromServiceWorker: 0, fromCache: 0 });
    await page.reload({ waitUntil: "commit", timeout: 300000 });
    const warm = {
      ...(await waitLoginReady(page)),
      wireBytes: wire.bytes,
      wireRequests: wire.requests,
      servedByServiceWorker: wire.fromServiceWorker,
      swReady: sw.ok,
    };
    out.push({ run: i + 1, cold, warm });
  } catch (e) {
    failed = true;
    console.error("run", i + 1, "failed:", e && e.message);
  }
  await ctx.close();
}
await browser.close();

const fmtS = (ms) => (ms == null ? "-" : (ms / 1000).toFixed(2) + " s");
const fmtB = (b) => (b == null ? "-" : b >= 1e6 ? (b / 1e6).toFixed(2) + " MB" : (b / 1e3).toFixed(1) + " KB");
console.log(`\nload-perf ${LABEL} — ${BASE} — network ${process.env.NETWORK || "slow4g"}, CPU x${CPU_RATE}`);
for (const r of out) {
  for (const kind of ["cold", "warm"]) {
    const m = r[kind];
    console.log(
      `run ${r.run} ${kind.padEnd(4)} [${m.mode}] login form ${fmtS(m.loginReadyMs)} | FCP ${fmtS(m.fcpMs)} | DCL ${fmtS(m.domContentLoadedMs)} | load ${fmtS(m.loadMs)} | long tasks ${fmtS(m.longTaskMs)} (${m.longTaskCount}) | ${m.wireRequests} req, ${fmtB(m.wireBytes)} on the wire, ${fmtB(m.decodedBytes)} decoded` +
        (kind === "warm" ? ` | via SW ${m.servedByServiceWorker}` : ""),
    );
  }
}
if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify({ label: LABEL, base: BASE, cpu: CPU_RATE, network: NET, runs: out }, null, 2));
process.exit(failed || out.length === 0 ? 1 : 0);
