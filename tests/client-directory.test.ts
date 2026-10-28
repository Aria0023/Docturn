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

describe("favorites + recently contacted (client)", () => {
  const FAV_USER = { targetKind: "user", targetId: "31", createdAt: "2026-10-01T00:00:00Z", user: { userId: 31, displayName: "Dr. Ada Prior", credential: "MD", role: "hospitalist", active: true } };
  const RECENT = { userId: 32, displayName: "Dr. Bo Reed", credential: "MD", role: "er_doctor", active: true, conversationId: 5, lastMessageAt: "2026-10-01T00:00:00Z" };

  function serverFavorites(h: any) {
    const stored: any[] = [];
    h.routes.fav = (r: any) => {
      if (r.path === "/api/directory/favorites" && r.method === "GET") return { status: 200, body: { favorites: stored.slice() } };
      if (r.path === "/api/directory/favorites" && r.method === "POST") {
        stored.push({ ...FAV_USER, targetKind: r.body.targetKind, targetId: r.body.targetId });
        return { status: 201, body: { created: true } };
      }
      const m = /^\/api\/directory\/favorites\/(\w+)\/(.+)$/.exec(r.path);
      if (m && r.method === "DELETE") {
        const i = stored.findIndex((f) => f.targetKind === m[1] && f.targetId === decodeURIComponent(m[2]!));
        if (i < 0) return { status: 404, body: { error: "not_found" } };
        stored.splice(i, 1);
        return { status: 204 };
      }
      if (r.path === "/api/directory/recents") return { status: 200, body: { recents: [RECENT] } };
      return undefined;
    };
    return stored;
  }

  it("loads both lists from the server", async () => {
    const h = await boot();
    const stored = serverFavorites(h);
    stored.push(FAV_USER);
    await h.w.DT.actions.loadDirectoryLists();
    expect(h.state().favorites).toEqual([FAV_USER]);
    expect(h.state().recents).toEqual([RECENT]);
  });

  it("a star is a server write, then the stored list is re-read (star on screen = stored state)", async () => {
    const h = await boot();
    const stored = serverFavorites(h);
    expect(await h.w.DT.actions.toggleFavorite("user", 31)).toBe(true);
    const post = h.reqs.find((r) => r.method === "POST" && r.path === "/api/directory/favorites");
    expect(post!.body).toEqual({ targetKind: "user", targetId: "31" });
    expect(stored).toHaveLength(1);
    expect(h.state().favorites.map((f: any) => f.targetId)).toEqual(["31"]);
    // Toggling again removes it on the server (DELETE with the role key encoded).
    expect(await h.w.DT.actions.toggleFavorite("user", "31")).toBe(true);
    expect(h.reqs.some((r) => r.method === "DELETE" && r.path === "/api/directory/favorites/user/31")).toBe(true);
    expect(h.state().favorites).toEqual([]);
    await h.w.DT.actions.toggleFavorite("role", "schedule:Cardiology call");
    expect(h.reqs.some((r) => r.method === "POST" && r.body && r.body.targetId === "schedule:Cardiology call")).toBe(true);
    await h.w.DT.actions.toggleFavorite("role", "schedule:Cardiology call");
    expect(h.reqs.some((r) => r.method === "DELETE" && r.path === "/api/directory/favorites/role/" + encodeURIComponent("schedule:Cardiology call"))).toBe(true);
  });

  it("a refused star says why, keeps the server's state, and a module refusal re-reads the switches", async () => {
    const h = await boot();
    serverFavorites(h);
    // Refusals answer before the scripted store (routes are tried in order).
    h.routes = { refuse: (r) => (r.method === "POST" && r.path === "/api/directory/favorites" ? { status: 404, body: { error: "role_not_found" } } : undefined), ...h.routes };
    expect(await h.w.DT.actions.toggleFavorite("role", "schedule:Gone")).toBe(false);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Couldn't add favorite", msg: "Nobody reachable holds that role right now." });
    expect(h.state().favorites).toEqual([]);

    const before = count(h, "GET", "/api/modules");
    h.modules = { "directory.favorites": false };
    h.routes.refuse = (r) => (r.method === "POST" && r.path === "/api/directory/favorites" ? { status: 404, body: { error: "module_disabled", module: "directory.favorites" } } : undefined);
    expect(await h.w.DT.actions.toggleFavorite("user", 31)).toBe(false);
    expect(h.state().__toast.msg).toBe("Favorites are switched off for your organization.");
    await until(() => count(h, "GET", "/api/modules") > before);
    await until(() => h.w.DT.moduleOn("directory.favorites") === false);
    // …and with the module off the lists are not read at all.
    const reads = count(h, "GET", /^\/api\/directory\//);
    await h.w.DT.actions.loadDirectoryLists();
    expect(count(h, "GET", /^\/api\/directory\//)).toBe(reads);
    expect(h.state().favorites).toEqual([]);
    expect(h.state().recents).toEqual([]);
  });

  it("Message on a favorite / recent person opens a direct thread by user id (not by name match)", async () => {
    const h = await boot();
    h.routes.post = (r) => (r.path === "/api/messaging/conversations" && r.method === "POST"
      ? { status: 201, body: { id: 78, type: "direct", name: null, participantIds: [ME.id, 32], patientId: null } } : undefined);
    h.routes.one = (r) => (r.path === "/api/messaging/conversations/78" ? { status: 200, body: { id: 78, type: "direct", name: null, participantIds: [ME.id, 32] } } : undefined);
    await h.w.DT.actions.startConversation({ userId: 32, name: "Dr. Bo Reed" });
    const post = h.reqs.find((r) => r.method === "POST" && r.path === "/api/messaging/conversations");
    expect(post!.body).toEqual({ type: "direct", participantIds: [32] });
  });

  it("sign-out empties favorites and recents", async () => {
    const h = await boot();
    serverFavorites(h).push(FAV_USER);
    await h.w.DT.actions.loadDirectoryLists();
    await h.w.DT.actions.logout();
    await sleep(30);
    expect(h.state().favorites).toEqual([]);
    expect(h.state().recents).toEqual([]);
  });
});
