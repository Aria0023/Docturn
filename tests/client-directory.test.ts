import { afterEach, describe, expect, it } from "vitest";
import { boot, closeAll, count, sleep, until, ME } from "./client-parity-harness.js";

/**
 * Directory, client half (PerfectServe parity #1 role contacts, #2 favorites
 * + recently contacted) — the real store.js + api-bridge.js in jsdom. The
 * screen itself is measured on iPhones by scripts/role-contacts-check.mjs and
 * scripts/favorites-check.mjs.
 */
afterEach(closeAll);

const ROLE = {
  role: "schedule:Cardiology call", label: "Cardiology call", kind: "schedule", roundRobin: false,
  holders: [{ userId: 31, name: "Dr. Ada Prior", dnd: false, covering: null, messageUserId: 31, targetId: "schedule:Cardiology call:31" }],
  target: { id: "schedule:Cardiology call:31", label: "Cardiology call", kind: "schedule", userId: 31, holder: "Dr. Ada Prior", role: "schedule:Cardiology call", roleLabel: "Cardiology call", onCallUserId: 31, covering: false },
};

describe("role contacts (client)", () => {
  it("reads the server's role contacts into s.roleContacts — nothing invented", async () => {
    const h = await boot();
    h.routes.rc = (r) => (r.path === "/api/messaging/role-contacts" ? { status: 200, body: [ROLE] } : undefined);
    expect(h.state().roleContacts).toEqual([]);
    const rows = await h.w.DT.actions.listRoleContacts();
    expect(rows).toHaveLength(1);
    expect(h.state().roleContacts[0]).toMatchObject({ role: ROLE.role, label: "Cardiology call" });
  });

  it("Message on a role opens the server-resolved holder through the role-target flow", async () => {
    const h = await boot();
    h.routes.post = (r) => (r.path === "/api/messaging/conversations" && r.method === "POST"
      ? { status: 201, body: { id: 77, type: "direct", name: null, addressedAs: r.body.name, participantIds: [ME.id, 31], patientId: null } } : undefined);
    h.routes.one = (r) => (r.path === "/api/messaging/conversations/77" ? { status: 200, body: { id: 77, type: "direct", name: null, participantIds: [ME.id, 31] } } : undefined);
    await h.w.DT.actions.startRoleConversation(ROLE.target);
    const post = h.reqs.find((r) => r.method === "POST" && r.path === "/api/messaging/conversations");
    expect(post!.body).toEqual({ type: "direct", name: "Cardiology call", participantIds: [31] });
    await until(() => h.state().__activeConvo === 77);
  });

  it("module off: no request and no rows; a refusal while open re-reads the module map", async () => {
    const h = await boot({ modules: { "routing.roleMessaging": false } });
    const rows = await h.w.DT.actions.listRoleContacts();
    expect(rows).toEqual([]);
    expect(count(h, "GET", "/api/messaging/role-contacts")).toBe(0);

    const h2 = await boot();
    h2.routes.rc = (r) => (r.path === "/api/messaging/role-contacts" ? { status: 404, body: { error: "module_disabled", module: "routing.roleMessaging" } } : undefined);
    h2.state().roleContacts = [ROLE];
    const before = count(h2, "GET", "/api/modules");
    h2.modules = { "routing.roleMessaging": false };
    expect(await h2.w.DT.actions.listRoleContacts()).toEqual([]);
    expect(h2.state().roleContacts).toEqual([]);
    await until(() => count(h2, "GET", "/api/modules") > before);
    await until(() => h2.w.DT.moduleOn("routing.roleMessaging") === false);
  });

  it("sign-out leaves no role contacts (another org's holders) for the next person", async () => {
    const h = await boot();
    h.routes.rc = (r) => (r.path === "/api/messaging/role-contacts" ? { status: 200, body: [ROLE] } : undefined);
    await h.w.DT.actions.listRoleContacts();
    expect(h.state().roleContacts).toHaveLength(1);
    await h.w.DT.actions.logout();
    await sleep(30);
    expect(h.state().roleContacts).toEqual([]);
  });
});
