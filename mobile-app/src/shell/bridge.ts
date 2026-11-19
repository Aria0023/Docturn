/**
 * The JavaScript side of the shell ↔ web app contract (pure strings, no React
 * Native imports — tests/mobile-shell.test.ts runs them in a VM).
 *
 *   shell → page   injected JavaScript calling window.__dtShell.<method>(...)
 *                  (defined by webapp/api-bridge.js). A call made before the
 *                  bridge ran is queued on window.__dtShellQueue and replayed.
 *   page → shell   window.ReactNativeWebView.postMessage(JSON) —
 *                  {type:"dt-session", state:"active"|"ended"}
 *                  {type:"dt-push", action:"request"}
 *                  {type:"dt-theme", color, background}  (from the flag
 *                  script below, whenever the page's theme-color changes)
 */

/**
 * Runs before any page script (injectedJavaScriptBeforeContentLoaded): the
 * detection flag, the call queue, and a theme-color watcher so the status bar
 * and safe areas follow the page's <meta name="theme-color"> live.
 */
export function flagScript(version: string, platform: string): string {
  return `(function(){
  window.DocTurnShell = { version: ${JSON.stringify(version)}, platform: ${JSON.stringify(platform)} };
  window.__dtShellQueue = window.__dtShellQueue || [];
  function post(m){ try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} }
  var last = "";
  function theme(){
    var meta = document.querySelector('meta[name="theme-color"]');
    var color = (meta && meta.getAttribute("content")) || "";
    var bg = "";
    try { bg = (document.body && getComputedStyle(document.body).backgroundColor) || ""; } catch (e) {}
    var key = color + "|" + bg;
    if (key === last) return;
    last = key;
    post({ type: "dt-theme", v: 1, color: color, background: bg });
  }
  var queued = false;
  function schedule(){ if (queued) return; queued = true; setTimeout(function(){ queued = false; theme(); }, 50); }
  function watch(){
    theme();
    try {
      var mo = new MutationObserver(schedule);
      if (document.head) mo.observe(document.head, { subtree: true, childList: true, attributes: true, attributeFilter: ["content", "name"] });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
      if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    } catch (e) {}
    try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", schedule); } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
})(); true;`;
}

/** `window.__dtShell.<method>(...args)` — or queue it until the bridge is up. */
export function callShellScript(method: string, ...args: unknown[]): string {
  const call = JSON.stringify([method, ...args]);
  return `(function(){var c=${call};try{var s=window.__dtShell;if(s&&typeof s[c[0]]==="function"){s[c[0]].apply(null,c.slice(1));}else{(window.__dtShellQueue=window.__dtShellQueue||[]).push(c);}}catch(e){}})();true;`;
}

export type ShellMessage =
  | { type: "dt-session"; state: "active" | "ended" }
  | { type: "dt-push"; action: "request" }
  | { type: "dt-theme"; color: string; background: string };

/** Parse what the page posted; anything unexpected is ignored (null). */
export function parseShellMessage(data: unknown): ShellMessage | null {
  if (typeof data !== "string") return null;
  let m: unknown;
  try { m = JSON.parse(data); } catch { return null; }
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  if (o.type === "dt-session" && (o.state === "active" || o.state === "ended")) return { type: "dt-session", state: o.state };
  if (o.type === "dt-push" && o.action === "request") return { type: "dt-push", action: "request" };
  if (o.type === "dt-theme") return { type: "dt-theme", color: String(o.color || ""), background: String(o.background || "") };
  return null;
}
