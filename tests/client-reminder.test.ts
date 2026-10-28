import { afterEach, describe, expect, it } from "vitest";
import { boot, closeAll, count, sleep, until } from "./client-parity-harness.js";

/**
 * Unread-message reminder, client half (PerfectServe parity #5, module
 * messaging.unreadReminder) — the real store.js + api-bridge.js in jsdom. The
 * Settings row is measured on iPhones by scripts/unread-reminder-check.mjs.
 */
afterEach(closeAll);

async function withPrefs(extra: any = {}) {
  const h = await boot({ modules: extra.modules });
  (h as any).prefs = { enabled: false, intervalMin: 10, intervals: [5, 10, 15, 30], ...(extra.prefs || {}) };
  h.routes.reminder = (r) => (r.path === "/api/messaging/unread-reminder" && r.method === "GET" ? { status: 200, body: (h as any).prefs } : undefined);
  return h;
}

describe("Unread-message reminder (client)", () => {
  it("reads my preference from the server (and never while the module is off)", async () => {
    const h = await withPrefs({ prefs: { enabled: true, intervalMin: 15 } });
    await h.w.DT.actions.loadReminderPrefs();
    expect(h.state().reminderPrefs).toEqual({ enabled: true, intervalMin: 15, intervals: [5, 10, 15, 30] });

    const off = await withPrefs({ modules: { "messaging.unreadReminder": false } });
    const before = count(off, "GET", "/api/messaging/unread-reminder");
    await off.w.DT.actions.loadReminderPrefs();
    expect(count(off, "GET", "/api/messaging/unread-reminder")).toBe(before);
    expect(off.state().reminderPrefs).toBeNull();
  });

  it("a change is ONE PUT and the screen shows the server's stored answer", async () => {
    const h = await withPrefs();
    await h.w.DT.actions.loadReminderPrefs();
    h.routes.put = (r) => (r.path === "/api/messaging/unread-reminder" && r.method === "PUT" ? { status: 200, body: { enabled: true, intervalMin: 5, intervals: [5, 10, 15, 30] } } : undefined);
    expect(await h.w.DT.actions.setReminderPrefs(true, 5)).toBe(true);
    const puts = h.reqs.filter((r) => r.method === "PUT" && r.path === "/api/messaging/unread-reminder");
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body).toEqual({ enabled: true, intervalMin: 5 });
    expect(h.state().reminderPrefs).toMatchObject({ enabled: true, intervalMin: 5 });
    expect(h.state().__toast).toMatchObject({ tone: "accepted", title: "Unread reminder on" });
    expect(h.state().__toast.msg).toMatch(/every 5 min/);
  });

  it("a refused or failed change leaves the screen on the server's state and says so", async () => {
    const h = await withPrefs({ prefs: { enabled: false, intervalMin: 10 } });
    await h.w.DT.actions.loadReminderPrefs();
    h.routes.put = (r) => (r.method === "PUT" ? { network: true } : undefined);
    expect(await h.w.DT.actions.setReminderPrefs(true, 5)).toBe(false);
    expect(h.state().reminderPrefs).toMatchObject({ enabled: false, intervalMin: 10 });
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Reminder not changed" });
    expect(h.state().__toast.msg).toMatch(/No connection/);
  });

  it("module off: a refused change says so and re-reads the switches", async () => {
    const h = await withPrefs();
    h.routes.put = (r) => (r.method === "PUT" ? { status: 404, body: { error: "module_disabled", module: "messaging.unreadReminder" } } : undefined);
    const before = count(h, "GET", "/api/modules");
    h.modules = { "messaging.unreadReminder": false };
    expect(await h.w.DT.actions.setReminderPrefs(true, 5)).toBe(false);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", msg: "Unread-message reminders are switched off for your organization." });
    await until(() => count(h, "GET", "/api/modules") > before);
    await until(() => h.w.DT.moduleOn("messaging.unreadReminder") === false);
    await sleep(10);
  });
});
