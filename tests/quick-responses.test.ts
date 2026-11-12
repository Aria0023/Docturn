import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDemoTenants } from "../server/seed.js";
import { setModule } from "../server/modules.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * Quick responses (PerfectServe parity #6) are the EXISTING message templates
 * (module messaging.templates) — no second store, no new route. This pins the
 * server rules the phone chips and Settings → Quick responses rely on: a
 * personal template is the owner's alone (same org or not), another tenant's
 * id answers 404 like an unknown one, and the audit trail carries ids and
 * scope only — never the title or text a clinician typed.
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

describe("quick responses = personal message templates", () => {
  it("a personal one is the owner's alone; another tenant's caller gets 404 on every verb", async () => {
    await ensureDemoTenants(ctx.storage);
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const mine = await chen.post("/api/messaging/templates").send({ title: "On my way", body: "On my way — 5 minutes.", priority: "routine" });
    expect(mine.status).toBe(201);
    expect(mine.body).toMatchObject({ scope: "mine", canEdit: true });

    // Same org, other person: not listed, cannot edit or delete (403 — it exists in their org).
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    expect((await patel.get("/api/messaging/templates")).body.some((t: { id: number }) => t.id === mine.body.id)).toBe(false);
    expect((await patel.patch(`/api/messaging/templates/${mine.body.id}`).send({ title: "x" })).status).toBe(403);
    expect((await patel.delete(`/api/messaging/templates/${mine.body.id}`)).status).toBe(403);

    // Another tenant: indistinguishable from an id that does not exist.
    const { agent: voss, res } = await login(ctx.app, { orgCode: "HOSP", username: "voss" });
    expect(res.status).toBe(200);
    expect((await voss.get("/api/messaging/templates")).body.some((t: { id: number }) => t.id === mine.body.id)).toBe(false);
    const p = await voss.patch(`/api/messaging/templates/${mine.body.id}`).send({ title: "x" });
    const d = await voss.delete(`/api/messaging/templates/${mine.body.id}`);
    const unknown = await voss.delete(`/api/messaging/templates/999999`);
    expect([p.status, d.status, unknown.status]).toEqual([404, 404, 404]);
    expect(p.body).toEqual(unknown.body);

    // The owner still has it, unchanged.
    const list = (await chen.get("/api/messaging/templates")).body;
    expect(list.find((t: { id: number }) => t.id === mine.body.id)).toMatchObject({ title: "On my way", body: "On my way — 5 minutes." });
  });

  it("create / update / delete are audited with the id and scope only — never the typed text", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const t = await chen.post("/api/messaging/templates").send({ title: "Bed 12 callback", body: "Call me about the patient in bed 12", priority: "urgent" });
    await chen.patch(`/api/messaging/templates/${t.body.id}`).send({ body: "Call me about bed 14" });
    await chen.delete(`/api/messaging/templates/${t.body.id}`);
    const rows = (await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 500)).filter((r) => r.action.startsWith("message.template_"));
    expect(rows.map((r) => r.action).sort()).toEqual(["message.template_create", "message.template_delete", "message.template_update"]);
    for (const r of rows) {
      expect(r.resourceId).toBe(t.body.id);
      expect(r.details).toEqual({ scope: "mine" });
      expect(JSON.stringify(r)).not.toMatch(/bed 1[24]|callback|Call me/i);
    }
  });

  it("module off: every verb answers 404 module_disabled and nothing is written", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const t = await chen.post("/api/messaging/templates").send({ title: "Keep", body: "Kept while off" });
    await setModule(ctx.seedResult.orgId, "messaging.templates", false);
    for (const r of [
      await chen.get("/api/messaging/templates"),
      await chen.post("/api/messaging/templates").send({ title: "New", body: "x" }),
      await chen.patch(`/api/messaging/templates/${t.body.id}`).send({ title: "Changed" }),
      await chen.delete(`/api/messaging/templates/${t.body.id}`),
    ]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: "module_disabled", module: "messaging.templates" });
    }
    await setModule(ctx.seedResult.orgId, "messaging.templates", true);
    const list = (await chen.get("/api/messaging/templates")).body.filter((x: { scope: string }) => x.scope === "mine");
    expect(list.map((x: { title: string }) => x.title)).toEqual(["Keep"]);
  });
});
