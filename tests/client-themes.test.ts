import { afterEach, describe, expect, it } from "vitest";
import { boot, closeAll, count, until, type Harness } from "./client-parity-harness.js";

/**
 * Per-user display presets, client half (module platform.userThemes) — the
 * real store.js + api-bridge.js in jsdom.
 *
 * What the client must get right: the preset is the SERVER's (GET / PUT
 * /api/me/theme), one PUT carries the whole row, a refusal rolls the screen
 * back to what the server holds and says why, the module being off forgets the
 * slice entirely (so the app falls back to the organization's branding), and
 * the preset is never written to browser storage — a shared ward workstation
 * must not come back up wearing the previous clinician's theme.
 *
 * The rendered half (what the browser actually paints per preset x text size x
 * width) is scripts/theme-check.mjs; the token maths is
 * scripts/contrast-check.mjs.
 */
afterEach(closeAll);

const SERVER_THEME = {
  preset: "night",
  textSize: "default",
  followDevice: false,
  presets: ["org", "classic", "calm", "warm", "night", "contrast"],
  textSizes: ["default", "large"],
  followDevicePresets: ["org", "night"],
  defaults: { preset: "org", textSize: "default", followDevice: false },
};

async function withTheme(body: any = SERVER_THEME, modules?: Record<string, boolean>) {
  const h = await boot({ modules });
  h.routes.theme = (r) => (r.path === "/api/me/theme" && r.method === "GET" ? { status: 200, body } : undefined);
  await h.w.DT.actions.loadMyTheme();
  return h;
}
const puts = (h: Harness) => h.reqs.filter((r) => r.method === "PUT" && r.path === "/api/me/theme");

describe("per-user display presets (client)", () => {
  it("reads my preset from the server, with the catalogues it must offer", async () => {
    const h = await withTheme();
    expect(h.state().userTheme).toMatchObject({ preset: "night", textSize: "default", followDevice: false });
    expect(h.state().userTheme.presets).toEqual(["org", "classic", "calm", "warm", "night", "contrast"]);
    expect(h.state().userTheme.followDevicePresets).toEqual(["org", "night"]);
  });

  it("module off: nothing is read, the slice is forgotten, and the app falls back to the organization's branding", async () => {
    const off = await boot({ modules: { "platform.userThemes": false } });
    off.w.DT.set((s: any) => { s.userTheme = { ...SERVER_THEME }; return s; });
    expect(await off.w.DT.actions.loadMyTheme()).toBeNull();
    expect(count(off, "GET", "/api/me/theme")).toBe(0);
    expect(off.state().userTheme).toBeNull();
    // the organization's own theme is untouched by any of this
    expect(off.state().theme).toMatchObject({ appName: expect.any(String), accent: expect.any(String) });
  });

  it("changing one key is ONE PUT of the whole row, and the screen shows the server's answer", async () => {
    const h = await withTheme();
    h.routes.put = (r) =>
      (r.path === "/api/me/theme" && r.method === "PUT" ? { status: 200, body: { ...SERVER_THEME, ...r.body } } : undefined);

    expect(await h.w.DT.actions.setMyTheme({ textSize: "large" })).toBe(true);
    expect(puts(h).map((p) => p.body)).toEqual([{ preset: "night", textSize: "large", followDevice: false }]);
    expect(h.state().userTheme).toMatchObject({ preset: "night", textSize: "large" });
    expect(h.state().userThemeSave).toMatchObject({ state: "saved" });

    expect(await h.w.DT.actions.setMyTheme({ preset: "contrast", followDevice: true })).toBe(true);
    expect(puts(h)[1]!.body).toEqual({ preset: "contrast", textSize: "large", followDevice: true });
    expect(h.state().userTheme).toMatchObject({ preset: "contrast", textSize: "large", followDevice: true });
  });

  it("a refused save rolls the screen back to what the server holds and says why", async () => {
    const h = await withTheme();
    h.routes.put = (r) => (r.method === "PUT" && r.path === "/api/me/theme" ? { status: 500, body: { error: "boom" } } : undefined);
    expect(await h.w.DT.actions.setMyTheme({ preset: "contrast" })).toBe(false);
    expect(h.state().userTheme).toMatchObject({ preset: "night", textSize: "default" });
    expect(h.state().userThemeSave).toMatchObject({ state: "error" });
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Theme not changed" });

    // A module refusal names the module and makes the client re-read the map,
    // so the section disappears instead of offering a control the server
    // refuses (tests/client-module-refusals.test.ts pattern).
    const before = count(h, "GET", "/api/modules");
    h.routes.put = (r) =>
      (r.method === "PUT" && r.path === "/api/me/theme"
        ? { status: 404, body: { error: "module_disabled", module: "platform.userThemes" } }
        : undefined);
    h.modules = { "platform.userThemes": false };
    expect(await h.w.DT.actions.setMyTheme({ preset: "contrast" })).toBe(false);
    expect(h.state().userTheme).toMatchObject({ preset: "night" });
    expect(h.state().__toast).toMatchObject({ msg: "Personal display presets are switched off for your organization." });
    await until(() => count(h, "GET", "/api/modules") > before);
  });

  it("nothing is sent before the server has answered — there is no local-only theme", async () => {
    const h = await boot();
    expect(h.state().userTheme).toBeNull();
    expect(await h.w.DT.actions.setMyTheme({ preset: "night" })).toBe(false);
    expect(puts(h)).toHaveLength(0);
  });

  it("the preset is never written to browser storage", async () => {
    const h = await withTheme();
    h.w.DT.set((s: any) => s);
    const keys = Object.keys(h.w.localStorage).filter((k) => /docturn/i.test(k));
    for (const k of keys) {
      const raw = h.w.localStorage.getItem(k) || "";
      expect(raw, k).not.toMatch(/userTheme/);
      expect(raw, k).not.toMatch(/"night"/);
    }
  });
});
