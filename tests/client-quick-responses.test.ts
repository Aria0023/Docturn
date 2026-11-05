import { afterEach, describe, expect, it } from "vitest";
import { boot, closeAll, count, sleep, until } from "./client-parity-harness.js";

/**
 * Quick responses, client half (PerfectServe parity #6) — the real store.js +
 * api-bridge.js in jsdom. Quick responses ARE the existing message templates
 * (module messaging.templates, GET/POST/PATCH/DELETE /api/messaging/templates):
 * there is no second store, so every list on screen is the server's. The
 * composer chips and the Settings page are measured on iPhones by
 * scripts/quick-responses-check.mjs.
 */
afterEach(closeAll);

const MINE = { id: 41, title: "Call back", body: "Call me back on 4321", priority: "routine", scope: "mine", canEdit: true, ownerUserId: 11 };
const ORG = { id: 7, title: "STAT: need you at bedside", body: "Please come to the bedside now.", priority: "stat", scope: "org", canEdit: false, ownerUserId: null };

async function withTemplates(modules?: Record<string, boolean>) {
  const h = await boot({ modules });
  (h as any).rows = [ORG, MINE];
  h.routes.tpl = (r) => (r.path === "/api/messaging/templates" && r.method === "GET" ? { status: 200, body: (h as any).rows } : undefined);
  return h;
}

describe("Quick responses (client)", () => {
  it("reads the server's templates (org-wide + mine) — and sends nothing while the module is off", async () => {
    const h = await withTemplates();
    await h.w.DT.actions.listTemplates();
    expect(h.state().templates.map((t: any) => t.id)).toEqual([7, 41]);

    const off = await withTemplates({ "messaging.templates": false });
    const before = count(off, "GET", "/api/messaging/templates");
    off.w.DT.set((s: any) => { s.templates = [MINE]; return s; });
    const out = await off.w.DT.actions.listTemplates();
    expect(out).toEqual([]);
    expect(count(off, "GET", "/api/messaging/templates")).toBe(before);
    expect(off.state().templates).toEqual([]);
  });

  it("adding a personal quick response is ONE POST (scope mine) and the list is re-read from the server", async () => {
    const h = await withTemplates();
    await h.w.DT.actions.listTemplates();
    const created = { id: 42, title: "Running late", body: "Running 10 min late.", priority: "urgent", scope: "mine", canEdit: true, ownerUserId: 11 };
    h.routes.post = (r) => {
      if (r.path !== "/api/messaging/templates" || r.method !== "POST") return undefined;
      (h as any).rows = [ORG, MINE, created];
      return { status: 201, body: created };
    };
    const before = count(h, "GET", "/api/messaging/templates");
    const t = await h.w.DT.actions.createTemplate({ title: "Running late", body: "Running 10 min late.", priority: "urgent" });
    expect(t).toMatchObject({ id: 42 });
    const posts = h.reqs.filter((r) => r.method === "POST" && r.path === "/api/messaging/templates");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ title: "Running late", body: "Running 10 min late.", priority: "urgent", scope: "mine" });
    expect(count(h, "GET", "/api/messaging/templates")).toBe(before + 1);
    expect(h.state().templates.map((x: any) => x.id)).toEqual([7, 41, 42]);
  });

  it("a refusal because templates went off says so and re-reads the module map; a network failure says nothing was saved", async () => {
    const h = await withTemplates();
    h.routes.post = (r) => (r.method === "POST" && r.path === "/api/messaging/templates" ? { status: 404, body: { error: "module_disabled", module: "messaging.templates" } } : undefined);
    const before = count(h, "GET", "/api/modules");
    h.modules = { "messaging.templates": false };
    expect(await h.w.DT.actions.createTemplate({ title: "x", body: "y" })).toBeNull();
    expect(h.state().__toast).toMatchObject({ tone: "rejected", msg: "Quick responses and templates are switched off for your organization." });
    await until(() => count(h, "GET", "/api/modules") > before);
    await until(() => h.w.DT.moduleOn("messaging.templates") === false);

    const n = await withTemplates();
    n.routes.del = (r) => (r.method === "DELETE" ? { network: true } : undefined);
    expect(await n.w.DT.actions.deleteTemplate(41)).toBeNull();
    expect(n.state().__toast).toMatchObject({ tone: "rejected", msg: "No connection — nothing was changed." });
    await sleep(10);
  });

  it("a read refused because the module went off empties the list and re-reads the switches", async () => {
    const h = await withTemplates();
    await h.w.DT.actions.listTemplates();
    expect(h.state().templates).toHaveLength(2);
    h.routes.tpl = (r) => (r.path === "/api/messaging/templates" ? { status: 404, body: { error: "module_disabled", module: "messaging.templates" } } : undefined);
    const before = count(h, "GET", "/api/modules");
    await h.w.DT.actions.listTemplates();
    expect(h.state().templates).toEqual([]);
    await until(() => count(h, "GET", "/api/modules") > before);
  });
});
