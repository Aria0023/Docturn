import { afterEach, describe, expect, it } from "vitest";
import { boot, closeAll, count } from "./client-parity-harness.js";

/**
 * SCIM provisioning, client half (E2.2, module `enterprise.scim`) — the real
 * store.js + api-bridge.js in jsdom.
 *
 * The one thing that matters here: the token is a SECRET the server shows
 * once. The client must hand it to the screen and keep it NOWHERE — not in
 * the store, not in localStorage, not in a toast — and it must send nothing
 * at all while the module is off.
 *
 * The card itself (the base URL, the list, create / revoke, the shown-once
 * panel) is measured in Chromium on iPhones by scripts/scim-check.mjs.
 *
 * CLIENT_SRC_ROOT=<dir> runs these against another copy of webapp/.
 */
afterEach(closeAll);

const on = { "enterprise.scim": true };
const TOKEN = "dts_vERySecRetToKeNvalue_do_not_store_0123456789";
const LIST = {
  baseUrl: "https://app.test/scim/v2",
  assignableRoles: ["hospitalist", "er_doctor"],
  tokens: [{ id: 7, label: "Okta production", createdAt: "2026-02-01T00:00:00.000Z", createdBy: 2, lastUsedAt: null, revokedAt: null, active: true }],
};

describe("SCIM provisioning (client)", () => {
  it("sends nothing while the module is off; reads the server's list when on", async () => {
    const off = await boot({ modules: { "enterprise.scim": false } });
    off.w.DT.set((s: any) => { s.scim = LIST; return s; });
    expect(await off.w.DT.actions.loadScimTokens()).toBeNull();
    expect(count(off, "GET", "/api/org/scim-tokens")).toBe(0);
    expect(off.state().scim).toBeNull();

    const h = await boot({ modules: on });
    h.routes.scim = (r) => (r.path === "/api/org/scim-tokens" && r.method === "GET" ? { status: 200, body: LIST } : undefined);
    await h.w.DT.actions.loadScimTokens();
    expect(h.state().scim).toEqual(LIST);
  });

  it("a created token is returned to the caller and stored NOWHERE", async () => {
    const h = await boot({ modules: on });
    h.routes.scim = (r) => {
      if (r.path !== "/api/org/scim-tokens") return undefined;
      if (r.method === "POST") return { status: 201, body: { token: TOKEN, id: 8, label: r.body.label, createdAt: "2026-03-01T00:00:00.000Z", baseUrl: LIST.baseUrl } };
      return { status: 200, body: { ...LIST, tokens: LIST.tokens.concat([{ id: 8, label: "Entra", createdAt: "2026-03-01T00:00:00.000Z", createdBy: 2, lastUsedAt: null, revokedAt: null, active: true }]) } };
    };
    const made = await h.w.DT.actions.createScimToken("  Entra  ");
    const posts = h.reqs.filter((r) => r.method === "POST" && r.path === "/api/org/scim-tokens");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ label: "Entra" });
    expect(made.token).toBe(TOKEN);
    // The list was re-read from the server…
    expect(count(h, "GET", "/api/org/scim-tokens")).toBeGreaterThan(0);
    expect(h.state().scim.tokens.map((t: any) => t.id)).toEqual([7, 8]);
    // …and the secret is in no state the app keeps.
    expect(JSON.stringify(h.state())).not.toContain(TOKEN);
    expect(JSON.stringify(Object.entries(h.w.localStorage))).not.toContain(TOKEN);
    expect(h.state().__toast.msg).not.toContain(TOKEN);
    expect(h.state().__toast).toMatchObject({ tone: "accepted", title: "Token created" });
    expect(h.state().__toast.msg).toMatch(/only a hash/i);
  });

  it("revoking re-reads the list and says what it means", async () => {
    const h = await boot({ modules: on });
    h.routes.scim = (r) => {
      if (!r.path.startsWith("/api/org/scim-tokens")) return undefined;
      if (r.method === "DELETE") return { status: 200, body: { ok: true, id: 7 } };
      return { status: 200, body: { ...LIST, tokens: [{ ...LIST.tokens[0]!, active: false, revokedAt: "2026-03-02T00:00:00.000Z" }] } };
    };
    await h.w.DT.actions.revokeScimToken(7);
    expect(count(h, "DELETE", "/api/org/scim-tokens/7")).toBe(1);
    expect(h.state().scim.tokens[0]).toMatchObject({ active: false });
    expect(h.state().__toast).toMatchObject({ tone: "accepted", title: "Token revoked" });
    expect(h.state().__toast.msg).toMatch(/refused from now on/);
  });

  it("every refusal says why and changes nothing", async () => {
    const h = await boot({ modules: on });
    h.w.DT.set((s: any) => { s.scim = LIST; return s; });
    let reply: any = { status: 404, body: { error: "module_disabled", module: "enterprise.scim" } };
    h.routes.scim = (r) => (r.path.startsWith("/api/org/scim-tokens") ? reply : undefined);
    expect(await h.w.DT.actions.createScimToken("x")).toBeNull();
    expect(h.state().__toast.msg).toMatch(/switched off/i);

    reply = { status: 409, body: { error: "too_many_tokens" } };
    expect(await h.w.DT.actions.createScimToken("x")).toBeNull();
    expect(h.state().__toast.msg).toMatch(/five active tokens/i);

    reply = { status: 403, body: { error: "forbidden" } };
    expect(await h.w.DT.actions.revokeScimToken(7)).toBeNull();
    expect(h.state().__toast.msg).toMatch(/hospitalist director/i);
    expect(h.state().scim).toEqual(LIST);
  });
});
