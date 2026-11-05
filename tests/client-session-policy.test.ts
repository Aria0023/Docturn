import { afterEach, describe, expect, it } from "vitest";
import { boot, closeAll, count, ME, sleep, until } from "./client-parity-harness.js";

/**
 * Per-org session policy + "sign out everywhere", client half (E2, module
 * `enterprise.sessionPolicy`) — the real store.js + api-bridge.js in jsdom.
 *
 * What the client must do:
 *   • arm its own idle auto-lock with the window the SERVER reported
 *     (`idleMinutes` on the identity body), never a hard-coded 15 minutes;
 *   • say WHY the person was signed out, from the server's reason — the
 *     WebSocket close reason and `401 { error: "session_ended", reason }` —
 *     instead of a generic "your session expired";
 *   • send one request per change to the policy card and show the server's
 *     own answer; never enforce or clamp anything itself;
 *   • send nothing at all while the module is off, and say so when the server
 *     refuses with module_disabled.
 *
 * The card and the People action are measured in Chromium on iPhones by
 * scripts/session-policy-check.mjs.
 *
 * CLIENT_SRC_ROOT=<dir> runs these against another copy of webapp/ (used to
 * show they fail on the previous client).
 */
afterEach(closeAll);

const on = { "enterprise.sessionPolicy": true };
const POLICY = {
  stored: true,
  policy: { idleMinutes: 30, maxConcurrent: 2, absoluteHours: null },
  effective: { idleMinutes: 30, maxConcurrent: 2, absoluteHours: null },
  limits: { idleMinutes: { min: 5, max: 480, default: 15 }, maxConcurrent: { min: 1, max: 20 }, absoluteHours: { min: 1, max: 720 } },
};

describe("session policy (client) — the idle window is the server's", () => {
  it("reads idleMinutes off the identity body; absent means the platform default", async () => {
    const wide = await boot({ modules: on, user: { ...ME, idleMinutes: 45 } });
    expect(wide.state().idleLockMinutes).toBe(45);

    const plain = await boot({ modules: on });
    expect(plain.state().idleLockMinutes).toBeNull();
  });
});

describe("session policy (client) — why you were signed out", () => {
  it("a 401 session_ended carries the reason into the sign-in screen", async () => {
    const h = await boot({ modules: on });
    h.routes.ended = (r) => (r.path === "/api/org/session-policy" ? { status: 401, body: { error: "session_ended", reason: "max_concurrent" } } : undefined);
    await h.w.DT.actions.loadSessionPolicy();
    await until(() => !h.state().session, 3000);
    expect(h.state().loginError).toMatch(/signed in on another device/i);
    expect(h.state().loginError).not.toMatch(/session expired/i);
  });

  for (const [reason, pattern] of [
    ["session_evicted", /another device/i],
    ["session_expired", /maximum length/i],
    ["signed_out_everywhere", /signed out everywhere/i],
  ] as const) {
    it(`a socket closed 1008 "${reason}" says so and does not reconnect`, async () => {
      const h = await boot({ modules: on });
      const before = h.sockets.length;
      h.sockets[0].close(1008, reason);
      await until(() => !h.state().session, 3000);
      expect(h.state().loginError).toMatch(pattern);
      // No probe, no reconnect: the server already said the session is over.
      await sleep(300);
      expect(h.sockets.length).toBe(before);
      expect(count(h, "GET", "/api/user")).toBe(0);
    });
  }
});

describe("session policy (client) — the director's card", () => {
  it("sends nothing while the module is off, and reads the server's values when on", async () => {
    const off = await boot({ modules: { "enterprise.sessionPolicy": false } });
    off.w.DT.set((s: any) => { s.sessionPolicy = POLICY; return s; });
    expect(await off.w.DT.actions.loadSessionPolicy()).toBeNull();
    expect(count(off, "GET", "/api/org/session-policy")).toBe(0);
    expect(off.state().sessionPolicy).toBeNull();

    const h = await boot({ modules: on });
    h.routes.policy = (r) => (r.path === "/api/org/session-policy" && r.method === "GET" ? { status: 200, body: POLICY } : undefined);
    await h.w.DT.actions.loadSessionPolicy();
    expect(h.state().sessionPolicy).toEqual(POLICY);
  });

  it("one change is ONE PUT of that field only, and the toast is the server's answer", async () => {
    const h = await boot({ modules: on });
    const answer = { ...POLICY, policy: { ...POLICY.policy, maxConcurrent: 3 }, effective: { idleMinutes: 30, maxConcurrent: 3, absoluteHours: null } };
    h.routes.policy = (r) => (r.path === "/api/org/session-policy" && r.method === "PUT" ? { status: 200, body: answer } : undefined);
    await h.w.DT.actions.saveSessionPolicy({ maxConcurrent: 3 });
    const puts = h.reqs.filter((r) => r.method === "PUT" && r.path === "/api/org/session-policy");
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body).toEqual({ maxConcurrent: 3 });
    expect(h.state().sessionPolicy).toEqual(answer);
    expect(h.state().__toast).toMatchObject({ tone: "accepted", title: "Session policy updated" });
    expect(h.state().__toast.msg).toMatch(/30 minutes idle/);
    expect(h.state().__toast.msg).toMatch(/3 sessions at a time/);
    expect(h.state().sessionPolicySaving).toBeFalsy();
  });

  it("a refusal says why and leaves the server's values on screen", async () => {
    const h = await boot({ modules: on });
    h.w.DT.set((s: any) => { s.sessionPolicy = POLICY; return s; });
    let reply: any = { status: 404, body: { error: "module_disabled", module: "enterprise.sessionPolicy" } };
    h.routes.policy = (r) => (r.path === "/api/org/session-policy" ? reply : undefined);
    expect(await h.w.DT.actions.saveSessionPolicy({ idleMinutes: 60 })).toBeNull();
    expect(h.state().__toast).toMatchObject({ tone: "rejected" });
    expect(h.state().__toast.msg).toMatch(/switched off/i);
    expect(h.state().sessionPolicy).toEqual(POLICY);

    reply = { status: 400, body: { error: "validation_error" } };
    expect(await h.w.DT.actions.saveSessionPolicy({ idleMinutes: 1 })).toBeNull();
    expect(h.state().__toast.msg).toMatch(/refused that value/i);
    expect(h.state().sessionPolicy).toEqual(POLICY);
  });

  it("clearing the policy is one DELETE and reports what is now in force", async () => {
    const h = await boot({ modules: on });
    const cleared = { stored: false, policy: { idleMinutes: null, maxConcurrent: null, absoluteHours: null }, effective: { idleMinutes: 15, maxConcurrent: null, absoluteHours: null }, limits: POLICY.limits };
    h.routes.policy = (r) => (r.path === "/api/org/session-policy" && r.method === "DELETE" ? { status: 200, body: cleared } : undefined);
    await h.w.DT.actions.clearSessionPolicy();
    expect(count(h, "DELETE", "/api/org/session-policy")).toBe(1);
    expect(h.state().sessionPolicy).toEqual(cleared);
    expect(h.state().__toast.msg).toMatch(/15 minutes idle/);
    expect(h.state().__toast.msg).not.toMatch(/at a time/);
  });
});

describe("sign out everywhere (client)", () => {
  it("mine: one POST, and the count in the toast is the server's", async () => {
    const h = await boot({ modules: on });
    h.routes.soe = (r) => (r.path === "/api/account/sessions/revoke-all" && r.method === "POST" ? { status: 200, body: { ok: true, sessionsEnded: 3 } } : undefined);
    await h.w.DT.actions.signOutEverywhere();
    expect(count(h, "POST", "/api/account/sessions/revoke-all")).toBe(1);
    expect(h.state().__toast).toMatchObject({ tone: "accepted", title: "Signed out everywhere else" });
    expect(h.state().__toast.msg).toMatch(/ended 3 other sessions/);
    // This session keeps working: nothing signed itself out.
    expect(h.state().session).toBeTruthy();
  });

  it("someone else's: the route carries their id and the toast names them", async () => {
    const h = await boot({ modules: on });
    h.routes.soe = (r) => (/^\/api\/accounts\/\d+\/sessions\/revoke-all$/.test(r.path) ? { status: 200, body: { ok: true, id: 42, sessionsEnded: 1 } } : undefined);
    await h.w.DT.actions.signOutUserEverywhere(42, "Dr. Patel");
    expect(count(h, "POST", "/api/accounts/42/sessions/revoke-all")).toBe(1);
    expect(h.state().__toast.msg).toMatch(/Dr\. Patel was signed out of 1 session/);
    expect(h.state().__toast.msg).toMatch(/account still works/);
  });

  it("a module_disabled refusal says so and nothing is claimed", async () => {
    const h = await boot({ modules: on });
    h.routes.soe = (r) => (r.path === "/api/account/sessions/revoke-all" ? { status: 404, body: { error: "module_disabled", module: "enterprise.sessionPolicy" } } : undefined);
    expect(await h.w.DT.actions.signOutEverywhere()).toBeNull();
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Not signed out" });
    expect(h.state().__toast.msg).toMatch(/switched off/i);
  });
});
