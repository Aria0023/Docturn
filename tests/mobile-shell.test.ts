import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import type * as Bridge from "../mobile-app/src/shell/bridge.js";
import type * as Links from "../mobile-app/src/shell/links.js";
import type * as Theme from "../mobile-app/src/shell/theme.js";
import { expoChannelFor } from "../server/services/push-channels.js";

/**
 * The native shell's pure logic (mobile-app/src/shell/{links,bridge,theme}.ts)
 * against the server's real contract: the push titles server code sends, the
 * URL shapes server/routes/well-known.ts publishes as universal / app links,
 * and the window.__dtShell API webapp/api-bridge.js defines. Vite cannot
 * transform files under mobile-app/ (its tsconfig extends expo's, installed
 * only there), so each module is transpiled with the TypeScript compiler and
 * evaluated — the exact code the app ships. Nothing here needs React Native.
 */
function load<T>(file: string): T {
  const src = readFileSync(new URL("../mobile-app/src/shell/" + file, import.meta.url), "utf8");
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const mod = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", "require", out.outputText)(mod, mod.exports, () => { throw new Error("no imports expected in " + file); });
  return mod.exports as unknown as T;
}

let links: typeof Links;
let bridge: typeof Bridge;
let theme: typeof Theme;
beforeAll(() => {
  links = load<typeof Links>("links.ts");
  bridge = load<typeof Bridge>("bridge.ts");
  theme = load<typeof Theme>("theme.ts");
});

const HOST = "docturn.example.org";

// The literal titles the server sends (routes/messaging.ts, services/escalation.ts,
// services/notifications.ts, routes/board.ts).
const TITLES = [
  "STAT secure message", "Urgent secure message", "New secure message",
  "STAT message awaiting your acknowledgement", "Escalated STAT message needs attention",
  "New assignment", "New consult request",
];

describe("native shell: links and notification taps", () => {
  it("opens the thread for the universal-link shapes the server publishes, and nothing for other URLs", () => {
    expect(links.linkTarget(`https://${HOST}/messages/42`, HOST)).toEqual({ nav: "messages", conversationId: 42 });
    expect(links.linkTarget(`https://${HOST}/messages/42/`, HOST)).toEqual({ nav: "messages", conversationId: 42 });
    expect(links.linkTarget(`https://${HOST}/messages`, HOST)).toEqual({ nav: "messages" });
    expect(links.linkTarget(`https://${HOST}/?open=messages`, HOST)).toEqual({ nav: "messages" });
    expect(links.linkTarget(`https://${HOST}/?x=1&open=messages`, HOST)).toEqual({ nav: "messages" });
    expect(links.linkTarget(`HTTPS://${HOST.toUpperCase()}/messages/7`, HOST)).toEqual({ nav: "messages", conversationId: 7 });
    expect(links.linkTarget("docturn://messages/42", HOST)).toEqual({ nav: "messages", conversationId: 42 });
    expect(links.linkTarget("docturn://messages", HOST)).toEqual({ nav: "messages" });
    // Another host, another path, a non-numeric id, a bare open-anything: just open the app.
    expect(links.linkTarget("https://evil.example/messages/42", HOST)).toBeNull();
    expect(links.linkTarget(`https://${HOST}/settings`, HOST)).toBeNull();
    expect(links.linkTarget(`https://${HOST}/messages/abc`, HOST)).toBeNull();
    expect(links.linkTarget(`https://${HOST}/?open=settings`, HOST)).toBeNull();
    expect(links.linkTarget("not a url", HOST)).toBeNull();
    expect(links.linkTarget(`https://${HOST}/`, HOST)).toBeNull();
  });

  it("keeps navigation on the configured host only", () => {
    expect(links.sameHost(`https://${HOST}/api/x`, HOST)).toBe(true);
    expect(links.sameHost(`http://${HOST}/`, HOST)).toBe(true);
    expect(links.sameHost(`https://${HOST}.evil.example/`, HOST)).toBe(false);
    expect(links.sameHost(`https://evil.example/${HOST}`, HOST)).toBe(false);
    expect(links.sameHost("about:blank", HOST)).toBe(false);
    expect(links.sameHost(`javascript:alert(1)`, HOST)).toBe(false);
  });

  it("a tapped push opens Messages for every message title and only the app for the rest (payloads carry no id)", () => {
    for (const t of TITLES) {
      const target = links.pushTarget(t);
      if (/message/i.test(t)) expect(target, t).toEqual({ nav: "messages" });
      else expect(target, t).toBeNull();
      // Every title the server sends has an Android channel the shell defines.
      expect(["stat", "urgent", "routine"]).toContain(expoChannelFor(t));
    }
    expect(links.pushTarget(null)).toBeNull();
  });

  it("builds the start URL the bridge consumes", () => {
    const base = `https://${HOST}`;
    expect(links.startUrl(base + "/", null)).toBe(`${base}/`);
    expect(links.startUrl(base, { nav: "messages" })).toBe(`${base}/?open=messages`);
    expect(links.startUrl(base, { nav: "messages", conversationId: 42 })).toBe(`${base}/messages/42`);
  });
});

describe("native shell: the injected bridge", () => {
  function page(): { w: Record<string, unknown>; posted: unknown[]; run: (js: string) => unknown } {
    const posted: unknown[] = [];
    const w: Record<string, unknown> = {};
    w.window = w;
    w.ReactNativeWebView = { postMessage: (s: string) => posted.push(JSON.parse(s)) };
    w.document = { readyState: "loading", addEventListener: () => {}, querySelector: () => null, head: null, body: null, documentElement: {} };
    w.setTimeout = (fn: () => void) => { fn(); return 0; };
    w.matchMedia = () => ({ addEventListener: () => {} });
    const ctx = vm.createContext(w);
    return { w, posted, run: (js: string) => vm.runInContext(js, ctx) };
  }

  it("the flag script marks the page and primes the queue", () => {
    const p = page();
    p.run(bridge.flagScript("1.2.3", "ios"));
    expect(p.w.DocTurnShell).toEqual({ version: "1.2.3", platform: "ios" });
    expect(p.w.__dtShellQueue).toEqual([]);
  });

  it("a call before the bridge is up is queued in the order the bridge replays; after, it is a direct call", () => {
    const p = page();
    p.run(bridge.flagScript("1.2.3", "android"));
    p.run(bridge.callShellScript("pushToken", "ExponentPushToken[abc]"));
    p.run(bridge.callShellScript("open", { nav: "messages", conversationId: 42 }));
    expect(p.w.__dtShellQueue).toEqual([["pushToken", "ExponentPushToken[abc]"], ["open", { nav: "messages", conversationId: 42 }]]);
    const calls: unknown[][] = [];
    p.w.__dtShell = { pushToken: (...a: unknown[]) => calls.push(["pushToken", ...a]), open: (...a: unknown[]) => calls.push(["open", ...a]) };
    p.run(bridge.callShellScript("pushToken", "ExponentPushToken[abc]"));
    expect(calls).toEqual([["pushToken", "ExponentPushToken[abc]"]]);
    // An unknown method never throws inside the page.
    expect(() => p.run(bridge.callShellScript("nope"))).not.toThrow();
    // Arguments are JSON — a token with quotes or a </script> cannot break out.
    expect(() => p.run(bridge.callShellScript("pushToken", "\"</script><script>alert(1)"))).not.toThrow();
    expect(calls[1]).toEqual(["pushToken", "\"</script><script>alert(1)"]);
  });

  it("the theme watcher posts the page's theme-color and body background once per change", () => {
    const p = page();
    let color = "#2563EB";
    const meta = { getAttribute: () => color };
    p.w.document = { readyState: "complete", querySelector: () => meta, head: { }, body: {}, documentElement: {}, addEventListener: () => {} };
    p.w.getComputedStyle = () => ({ backgroundColor: "rgb(255, 255, 255)" });
    let observe = 0;
    p.w.MutationObserver = class { observe() { observe++; } };
    p.run(bridge.flagScript("1.0.0", "ios"));
    expect(p.posted).toEqual([{ type: "dt-theme", v: 1, color: "#2563EB", background: "rgb(255, 255, 255)" }]);
    expect(observe).toBe(3);
  });

  it("parses only the three message types the page may post", () => {
    expect(bridge.parseShellMessage(JSON.stringify({ type: "dt-session", v: 1, state: "active" }))).toEqual({ type: "dt-session", state: "active" });
    expect(bridge.parseShellMessage(JSON.stringify({ type: "dt-session", state: "ended" }))).toEqual({ type: "dt-session", state: "ended" });
    expect(bridge.parseShellMessage(JSON.stringify({ type: "dt-push", action: "request" }))).toEqual({ type: "dt-push", action: "request" });
    expect(bridge.parseShellMessage(JSON.stringify({ type: "dt-theme", color: "#000", background: "" }))).toEqual({ type: "dt-theme", color: "#000", background: "" });
    expect(bridge.parseShellMessage(JSON.stringify({ type: "dt-session", state: "whatever" }))).toBeNull();
    expect(bridge.parseShellMessage(JSON.stringify({ type: "eval", code: "x" }))).toBeNull();
    expect(bridge.parseShellMessage("not json")).toBeNull();
    expect(bridge.parseShellMessage(42)).toBeNull();
  });
});

describe("native shell: status bar follows the page's colour", () => {
  it("parses the colour forms a page emits and picks icon colour by luminance", () => {
    expect(theme.parseColor("#2563EB")).toEqual({ r: 37, g: 99, b: 235 });
    expect(theme.parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(theme.parseColor("rgb(15, 23, 42)")).toEqual({ r: 15, g: 23, b: 42 });
    expect(theme.parseColor("rgba(0, 0, 0, 0)")).toBeNull(); // a transparent body is no colour
    expect(theme.parseColor("transparent")).toBeNull();
    expect(theme.parseColor("")).toBeNull();
    expect(theme.isLight({ r: 37, g: 99, b: 235 })).toBe(false); // brand blue → light icons
    expect(theme.isLight({ r: 255, g: 255, b: 255 })).toBe(true); // white → dark icons
    expect(theme.isLight({ r: 15, g: 23, b: 42 })).toBe(false); // night → light icons
    expect(theme.toHex({ r: 37, g: 99, b: 235 })).toBe("#2563eb");
  });
});
