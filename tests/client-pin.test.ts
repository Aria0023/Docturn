import { afterEach, describe, expect, it } from "vitest";
import { boot, closeAll, count, sleep, until, type Harness } from "./client-parity-harness.js";

/**
 * PIN unlock, client half (PerfectServe parity #7, module security.pin) — the
 * real store.js + api-bridge.js in jsdom. The server holds the hash and the
 * failure count; the client keeps nothing about the PIN — not the digits, not
 * whether one is set — in storage, asks the server (GET /api/user while
 * locked) whether the PIN may be used, and on success re-establishes the
 * session through the normal restore. The lock screen and Settings are
 * measured on iPhones by scripts/pin-unlock-check.mjs.
 */
afterEach(closeAll);

const PIN = "4826";
const on = { "security.pin": true };

/** A stand-in for index.html's window.__dtLock (the persisted lock flag). */
function installLock(h: Harness) {
  let v: any = null;
  h.w.__dtLock = {
    KEY: "dt_lock",
    isLocked: () => !!v,
    read: () => v,
    set: (id: any) => { v = { locked: true, ...id }; },
    clear: () => { v = null; },
  };
  return h.w.__dtLock;
}

describe("PIN unlock (client) — Settings", () => {
  it("reads the server's answer; sends nothing while the module is off", async () => {
    const h = await boot({ modules: on });
    h.routes.pin = (r) => (r.path === "/api/security/pin" && r.method === "GET" ? { status: 200, body: { set: true, minLength: 4, maxLength: 8 } } : undefined);
    await h.w.DT.actions.loadPin();
    expect(h.state().pinStatus).toEqual({ set: true, minLength: 4, maxLength: 8 });

    const off = await boot({ modules: { "security.pin": false } });
    off.w.DT.set((s: any) => { s.pinStatus = { set: true }; return s; });
    expect(await off.w.DT.actions.loadPin()).toBeNull();
    expect(count(off, "GET", "/api/security/pin")).toBe(0);
    expect(off.state().pinStatus).toBeNull();
  });

  it("setting a PIN is ONE PUT with the password re-entered; the screen shows the server's answer; nothing is stored", async () => {
    const h = await boot({ modules: on });
    h.routes.put = (r) => (r.path === "/api/security/pin" && r.method === "PUT" ? { status: 200, body: { set: true, minLength: 4, maxLength: 8 } } : undefined);
    expect(await h.w.DT.actions.setPin("my-password", PIN)).toBe(true);
    const puts = h.reqs.filter((r) => r.method === "PUT" && r.path === "/api/security/pin");
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body).toEqual({ currentPassword: "my-password", pin: PIN });
    expect(h.state().pinStatus).toMatchObject({ set: true });
    const ls = JSON.stringify(Object.entries(h.w.localStorage));
    expect(ls).not.toContain(PIN);
    expect(ls).not.toContain("my-password");
  });

  it("a wrong password / weak PIN / module off says why and changes nothing", async () => {
    const h = await boot({ modules: on });
    h.w.DT.set((s: any) => { s.pinStatus = { set: false, minLength: 4, maxLength: 8 }; return s; });
    let reply: any = { status: 403, body: { error: "wrong_password" } };
    h.routes.put = (r) => (r.path === "/api/security/pin" && r.method === "PUT" ? reply : undefined);
    expect(await h.w.DT.actions.setPin("nope", PIN)).toBe(false);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", msg: "That password is not right — nothing was changed." });
    expect(h.state().pinStatus).toMatchObject({ set: false });
    expect(h.state().session).toBeTruthy(); // a 403 is not a signed-out session

    reply = { status: 400, body: { error: "weak_pin" } };
    expect(await h.w.DT.actions.setPin("pw", "1234")).toBe(false);
    expect(h.state().__toast.msg).toMatch(/not one repeated digit or a straight run/);

    reply = { status: 404, body: { error: "module_disabled", module: "security.pin" } };
    const before = count(h, "GET", "/api/modules");
    h.modules = { "security.pin": false };
    expect(await h.w.DT.actions.setPin("pw", PIN)).toBe(false);
    expect(h.state().__toast.msg).toBe("PIN unlock is switched off for your organization.");
    await until(() => count(h, "GET", "/api/modules") > before);
  });

  it("removing the PIN is ONE DELETE and shows the server's answer", async () => {
    const h = await boot({ modules: on });
    h.w.DT.set((s: any) => { s.pinStatus = { set: true, minLength: 4, maxLength: 8 }; return s; });
    h.routes.del = (r) => (r.path === "/api/security/pin" && r.method === "DELETE" ? { status: 200, body: { set: false, minLength: 4, maxLength: 8 } } : undefined);
    expect(await h.w.DT.actions.removePin()).toBe(true);
    expect(count(h, "DELETE", "/api/security/pin")).toBe(1);
    expect(h.state().pinStatus).toMatchObject({ set: false });
  });
});

describe("PIN unlock (client) — the lock screen", () => {
  it("asks the server whether this locked session may use a PIN", async () => {
    const h = await boot({ modules: on });
    const L = installLock(h);
    L.set({ org: "ISPN", user: "chen" });
    h.user = { ...h.user, locked: true, orgCode: "ISPN", pinUnlock: true };
    expect(await h.w.DT.actions.pinUnlockAvailable()).toBe(true);
    h.user = { ...h.user, pinUnlock: undefined };
    expect(await h.w.DT.actions.pinUnlockAvailable()).toBe(false);
  });

  it("a right PIN: one POST leaves the locked tab, the lock flag is cleared and the session is restored (socket + data)", async () => {
    const h = await boot({ modules: on });
    const L = installLock(h);
    L.set({ org: "ISPN", user: "chen" });
    h.user = { ...h.user, locked: true, orgCode: "ISPN" };
    // While locked nothing else leaves the tab.
    await h.w.DT.actions.loadPin();
    expect(count(h, "GET", "/api/security/pin")).toBe(0);
    h.routes.unlock = (r) => {
      if (r.path !== "/api/session/unlock-pin") return undefined;
      h.user = { ...h.user, locked: undefined, orgCode: undefined };
      return { status: 200, body: { locked: false } };
    };
    const sessions = count(h, "GET", "/api/session");
    const sockets = h.sockets.length;
    const r = await h.w.DT.actions.unlockWithPin(PIN);
    expect(r).toEqual({ ok: true });
    expect(h.reqs.filter((x) => x.path === "/api/session/unlock-pin")).toEqual([{ method: "POST", path: "/api/session/unlock-pin", body: { pin: PIN } }]);
    expect(L.isLocked()).toBe(false);
    expect(count(h, "GET", "/api/session")).toBe(sessions + 1);
    await until(() => h.sockets.length > sockets);
    expect(JSON.stringify(Object.entries(h.w.localStorage))).not.toContain(PIN);
  });

  it("a wrong PIN stays locked and says how many attempts are left; disabled / signed out / module off fall back to the password", async () => {
    const h = await boot({ modules: on });
    const L = installLock(h);
    L.set({ org: "ISPN", user: "chen" });
    let reply: any = { status: 403, body: { error: "wrong_pin", attemptsLeft: 2 } };
    h.routes.unlock = (r) => (r.path === "/api/session/unlock-pin" ? reply : undefined);
    expect(await h.w.DT.actions.unlockWithPin("0000")).toEqual({ ok: false, error: "wrong_pin", attemptsLeft: 2, passwordRequired: false });
    expect(L.isLocked()).toBe(true);
    reply = { status: 403, body: { error: "pin_disabled", passwordRequired: true } };
    expect(await h.w.DT.actions.unlockWithPin("0000")).toMatchObject({ ok: false, error: "pin_disabled", passwordRequired: true });
    reply = { status: 401, body: { error: "unauthorized" } };
    expect(await h.w.DT.actions.unlockWithPin(PIN)).toMatchObject({ ok: false, error: "signed_out", passwordRequired: true });
    reply = { status: 404, body: { error: "module_disabled", module: "security.pin" } };
    expect(await h.w.DT.actions.unlockWithPin(PIN)).toMatchObject({ ok: false, error: "module_disabled", passwordRequired: true });
    expect(L.isLocked()).toBe(true);
    await sleep(10);
  });
});
