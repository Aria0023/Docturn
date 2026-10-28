import { afterEach, describe, expect, it } from "vitest";
import { boot, closeAll, count, sleep, until } from "./client-parity-harness.js";

/**
 * End shift / Start shift, client half (PerfectServe parity #4, module
 * shift.handoff) — the real store.js + api-bridge.js in jsdom. The Settings
 * row and the confirm dialog are measured on iPhones by
 * scripts/shift-handoff-check.mjs.
 */
afterEach(closeAll);

const STATUS = { hasProfile: true, working: true, pendingCount: 1, acceptedCount: 2, coveringUserId: null, dnd: false, awayMessage: null };

async function withShift(extra: any = {}) {
  const h = await boot({ modules: extra.modules });
  await sleep(60); // let the boot hydrate settle before seeding my profile
  h.routes.shift = (r) => {
    if (r.path === "/api/shift" && r.method === "GET") return { status: 200, body: h.user && (h as any).shift };
    return undefined;
  };
  (h as any).shift = { ...STATUS, ...(extra.status || {}) };
  h.w.DT.set((s: any) => { s.myProvider = { id: "h5", census: 2, cap: 12, working: true, inRotation: true }; return s; });
  return h;
}

describe("End shift (client)", () => {
  it("reads the caller's shift truth from the server (and never while the module is off)", async () => {
    const h = await withShift();
    await h.w.DT.actions.loadShift();
    expect(h.state().shiftStatus).toMatchObject({ working: true, pendingCount: 1, acceptedCount: 2 });

    const off = await withShift({ modules: { "shift.handoff": false } });
    const before = count(off, "GET", "/api/shift");
    await off.w.DT.actions.loadShift();
    expect(count(off, "GET", "/api/shift")).toBe(before);
    expect(off.state().shiftStatus).toBeNull();
  });

  it("End shift is ONE server write; the server's answer is what the screen shows", async () => {
    const h = await withShift();
    await h.w.DT.actions.loadShift();
    h.routes.end = (r) => (r.path === "/api/shift/end" ? { status: 200, body: { ...STATUS, working: false, pendingCount: 0, coveringUserId: 12, dnd: true, awayMessage: "Back at 7", handedOff: 1, acceptedKept: 2 } } : undefined);
    const out = await h.w.DT.actions.endShift({ coveringUserId: 12, dnd: true, awayMessage: "Back at 7" });
    expect(out).toMatchObject({ ok: true });
    const writes = h.reqs.filter((r) => r.method === "POST" && r.path === "/api/shift/end");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.body).toEqual({ coveringUserId: 12, dnd: true, awayMessage: "Back at 7" });
    expect(h.state().shiftStatus).toMatchObject({ working: false, coveringUserId: 12 });
    expect(h.state().myProvider.working).toBe(false);
    expect(h.state().myPrefs).toMatchObject({ dnd: true, coveringUserId: 12, awayMessage: "Back at 7" });
    expect(h.state().__toast).toMatchObject({ tone: "accepted", title: "Shift ended" });
    expect(h.state().__toast.msg).toMatch(/1 pending request handed to your covering provider/);
    expect(h.state().__toast.msg).toMatch(/2 accepted patients stay with you/);
  });

  it("a refusal says why and changes nothing on screen", async () => {
    const h = await withShift();
    await h.w.DT.actions.loadShift();
    h.routes.end = (r) => (r.path === "/api/shift/end" ? { status: 409, body: { error: "covering_required", pendingCount: 1 } } : undefined);
    const out = await h.w.DT.actions.endShift({});
    expect(out).toMatchObject({ ok: false, error: "covering_required" });
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Shift not ended" });
    expect(h.state().__toast.msg).toMatch(/1 pending request/);
    expect(h.state().shiftStatus.working).toBe(true);
    expect(h.state().myProvider.working).toBe(true);
    h.routes.end = (r) => (r.path === "/api/shift/end" ? { status: 409, body: { error: "covering_off_shift", pendingCount: 1 } } : undefined);
    await h.w.DT.actions.endShift({ coveringUserId: 12 });
    expect(h.state().__toast.msg).toMatch(/covering provider is off shift/i);
  });

  it("module off: a refused End shift says so and re-reads the switches", async () => {
    const h = await withShift();
    h.routes.end = (r) => (r.path === "/api/shift/end" ? { status: 404, body: { error: "module_disabled", module: "shift.handoff" } } : undefined);
    const before = count(h, "GET", "/api/modules");
    h.modules = { "shift.handoff": false };
    expect((await h.w.DT.actions.endShift({ coveringUserId: 12 })).ok).toBe(false);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", msg: "End shift is switched off for your organization." });
    await until(() => count(h, "GET", "/api/modules") > before);
    await until(() => h.w.DT.moduleOn("shift.handoff") === false);
    await sleep(10);
  });

  it("DND / away message are never sent while messaging.dnd is off", async () => {
    const h = await withShift({ modules: { "messaging.dnd": false } });
    h.routes.end = (r) => (r.path === "/api/shift/end" ? { status: 200, body: { ...STATUS, working: false, handedOff: 0, acceptedKept: 0 } } : undefined);
    await h.w.DT.actions.endShift({ coveringUserId: 12, dnd: true, awayMessage: "x" });
    const w = h.reqs.find((r) => r.path === "/api/shift/end")!;
    expect(w.body).toEqual({ coveringUserId: 12 });
  });

  it("Start shift is the inverse, applied from the server's answer", async () => {
    const h = await withShift({ status: { working: false, dnd: true } });
    h.w.DT.set((s: any) => { s.myProvider = { ...s.myProvider, working: false }; s.myPrefs = { ...s.myPrefs, dnd: true }; return s; });
    h.routes.start = (r) => (r.path === "/api/shift/start" ? { status: 200, body: { ...STATUS, working: true, dnd: false } } : undefined);
    expect((await h.w.DT.actions.startShift()).ok).toBe(true);
    expect(count(h, "POST", "/api/shift/start")).toBe(1);
    expect(h.state().shiftStatus.working).toBe(true);
    expect(h.state().myProvider.working).toBe(true);
    expect(h.state().myPrefs.dnd).toBe(false);
    expect(h.state().__toast).toMatchObject({ tone: "accepted", title: "Shift started" });
  });
});
