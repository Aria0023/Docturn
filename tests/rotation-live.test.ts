import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { selectNext } from "../server/services/rotation.js";

/**
 * "Next up" has to stay true in every OPEN session, not only in the one that
 * changed something (A.CON-SHO-29, live half):
 *
 *  - Every write that changes who the next round-robin patient goes to — the
 *    sequential cursor reset, on/off shift (single, self, bulk), cap (single,
 *    bulk), census override, rotation order, joining/leaving rotation, shift
 *    type, provider create/delete, the org's rotation config, deactivating a
 *    provider — tells every signed-in session of THAT org (and no other) with
 *    one ROTATION_UPDATED event, so their Director card / ER Quick hint /
 *    hospitalist chip re-read GET /api/rotation/next instead of naming the
 *    pre-change provider.
 *  - The Director's "Rotation / Off" toggle and shift selector are real server
 *    state (they used to be local-only): a provider taken off rotation while
 *    on shift, or moved to a non-round-robin shift, is never previewed and
 *    never picked; both writes are director-only, org-scoped and audited.
 *  - The sequential cursor reset is audited.
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

const orgId = () => ctx.seedResult.orgId;
const hid = (key: string) => ctx.seedResult.hospitalistIds[key]!;
const rotationEvents = () =>
  ctx.ws.broadcasts.filter((b) => (b.message as { type?: string })?.type === "ROTATION_UPDATED");
async function audits(action: string) {
  return (await ctx.storage.listAuditLogs(orgId(), 500)).filter((r) => r.action === action);
}
async function otherTenant() {
  const other = await ctx.storage.createOrganization({
    name: "Other Hospital",
    code: "OTHR",
    city: null,
    state: null,
    timezone: "America/New_York",
    assignmentTimeoutMin: 10,
    roundRobinShiftTypes: ["day", "night"],
    rotationMode: "lowest_census",
    rotationIndex: 0,
  });
  const u = await ctx.storage.createUser({
    organizationId: other.id,
    username: "o.doc",
    passwordHash: "x",
    role: "hospitalist",
    displayName: "Other Doc",
    credential: "MD",
    phone: null,
    twoFactorEnabled: false,
  });
  const h = await ctx.storage.createHospitalist({
    organizationId: other.id,
    userId: u.id,
    specialty: "Hospital Medicine",
    currentPatientCount: 0,
    patientCap: 12,
    rotationOrder: 0,
    working: true,
    shiftType: "day",
  });
  return { org: other, hospitalist: h };
}

type Preview = { next: { hospitalistId: number } | null; order: number[] };

describe("POST /api/round-robin/reset (A.CON-SHO-29)", () => {
  it("zeroes the cursor, is audited, and tells every open session of the org to re-read Next up", async () => {
    await ctx.storage.updateOrganization(orgId(), { rotationMode: "sequential", rotationIndex: 2 });
    const { agent: director } = await login(ctx.app, { username: "director" });
    const before = (await director.get("/api/rotation/next").expect(200)).body as Preview;
    expect(before.next?.hospitalistId).toBe(before.order[0]);

    ctx.ws.broadcasts.length = 0;
    await director.post("/api/round-robin/reset").expect(200);

    expect((await ctx.storage.getOrganization(orgId()))!.rotationIndex).toBe(0);
    const after = (await director.get("/api/rotation/next").expect(200)).body as Preview;
    expect(after.next?.hospitalistId).not.toBe(before.next?.hospitalistId);
    // Index 0 → the first eligible provider in rotation order is next, and the
    // live pick agrees.
    expect((await selectNext(ctx.storage, orgId(), {}))?.id).toBe(after.next?.hospitalistId);

    const ev = rotationEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]!.orgId).toBe(orgId());

    const rows = await audits("rotation.reset");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ctx.seedResult.userIds.director, resourceType: "organization", resourceId: orgId() });
    expect(rows[0]!.details).toMatchObject({ fromIndex: 2 });
  });

  it("is director-only", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    ctx.ws.broadcasts.length = 0;
    await er.post("/api/round-robin/reset").expect(403);
    expect(rotationEvents()).toHaveLength(0);
  });
});

describe("every rotation-input write announces ROTATION_UPDATED to its own org only", () => {
  it("covers working status, caps, census, order, rotation membership, shift, roster and config", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const cases: Array<[string, () => Promise<unknown>]> = [
      ["working-status (director)", () => director.patch(`/api/hospitalists/${hid("patel")}/working-status`).send({ working: false }).expect(200)],
      ["working-status (self)", () => chen.patch(`/api/hospitalists/${hid("chen")}/working-status`).send({ working: false }).expect(200)],
      ["working-status (bulk)", () => director.patch(`/api/hospitalists/working-status`).send({ all: true }).expect(200)],
      ["capacity", () => director.patch(`/api/physicians/${hid("lopez")}/capacity`).send({ patientCap: 9 }).expect(200)],
      ["capacity (bulk)", () => director.patch(`/api/physicians/capacity`).send({ patientCap: 10 }).expect(200)],
      ["census override", () => director.patch(`/api/hospitalists/${hid("lopez")}/census`).send({ currentPatientCount: 3, reason: "manual adjustment" }).expect(200)],
      ["rotation order", () => director.patch(`/api/hospitalists/rotation-order`).send({ order: [hid("lopez"), hid("chen"), hid("patel")] }).expect(200)],
      ["rotation membership", () => director.patch(`/api/hospitalists/${hid("liu")}/rotation`).send({ inRotation: false }).expect(200)],
      ["shift type", () => director.patch(`/api/hospitalists/${hid("gopal")}/shift`).send({ shiftType: "night" }).expect(200)],
      ["org rotation config", () => director.patch(`/api/org/config`).send({ rotationMode: "sequential" }).expect(200)],
      ["provider create", () => director.post(`/api/director/hospitalists`).send({ username: "new.doc", displayName: "Dr. New Doc", working: true }).expect(201)],
      ["become hospitalist", () => director.post(`/api/director/become-hospitalist`).expect(201)],
      ["provider delete", async () => {
        const rows = (await director.get("/api/hospitalists").expect(200)).body as Array<{ id: number; userId: number }>;
        const fresh = rows.find((r) => r.userId !== ctx.seedResult.userIds.director && !Object.values(ctx.seedResult.hospitalistIds).includes(r.id))!;
        await director.delete(`/api/physicians/${fresh.id}`).expect(204);
      }],
      ["deactivate a working provider", () => director.post(`/api/accounts/${ctx.seedResult.userIds.kohan}/deactivate`).expect(200)],
    ];
    for (const [name, run] of cases) {
      ctx.ws.broadcasts.length = 0;
      await run();
      const ev = rotationEvents();
      expect(ev.length, name).toBeGreaterThanOrEqual(1);
      expect(ev.every((e) => e.orgId === orgId()), name).toBe(true);
    }
  });

  it("a refused or cross-tenant write announces nothing", async () => {
    const { hospitalist: foreign } = await otherTenant();
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    ctx.ws.broadcasts.length = 0;
    await director.patch(`/api/hospitalists/${foreign.id}/working-status`).send({ working: false }).expect(404);
    await director.patch(`/api/hospitalists/${foreign.id}/rotation`).send({ inRotation: false }).expect(404);
    await director.patch(`/api/hospitalists/${foreign.id}/shift`).send({ shiftType: "swing" }).expect(404);
    await director.patch(`/api/physicians/${foreign.id}/capacity`).send({ patientCap: 3 }).expect(404);
    await er.patch(`/api/hospitalists/${hid("chen")}/rotation`).send({ inRotation: false }).expect(403);
    await er.patch(`/api/hospitalists/${hid("chen")}/shift`).send({ shiftType: "swing" }).expect(403);
    await er.patch(`/api/physicians/capacity`).send({ patientCap: 3 }).expect(403);
    await er.patch(`/api/hospitalists/working-status`).send({ all: false }).expect(403);
    expect(rotationEvents()).toHaveLength(0);
    // The foreign provider is untouched.
    const still = (await ctx.storage.getHospitalist(foreign.organizationId, foreign.id))!;
    expect(still).toMatchObject({ working: true, inRotation: true, shiftType: "day", patientCap: 12 });
  });
});

describe("PATCH /api/hospitalists/:id/rotation — off rotation while on shift", () => {
  it("is never previewed or picked while out, comes back when put back, and is audited", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const before = (await director.get("/api/rotation/next").expect(200)).body as Preview;
    expect(before.next?.hospitalistId).toBe(hid("chen")); // census 0

    const res = await director.patch(`/api/hospitalists/${hid("chen")}/rotation`).send({ inRotation: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: hid("chen"), working: true, inRotation: false });

    const listed = ((await director.get("/api/hospitalists").expect(200)).body as Array<{ id: number; inRotation: boolean }>).find((h) => h.id === hid("chen"));
    expect(listed?.inRotation).toBe(false);
    const out = (await director.get("/api/rotation/next").expect(200)).body as Preview;
    expect(out.order).not.toContain(hid("chen"));
    expect(out.next?.hospitalistId).not.toBe(hid("chen"));
    for (let i = 0; i < 3; i++) {
      const pick = await selectNext(ctx.storage, orgId(), {});
      expect(pick?.id).not.toBe(hid("chen"));
    }

    await director.patch(`/api/hospitalists/${hid("chen")}/rotation`).send({ inRotation: true }).expect(200);
    const back = (await director.get("/api/rotation/next").expect(200)).body as Preview;
    expect(back.order).toContain(hid("chen"));

    const rows = (await audits("hospitalist.rotation_membership")).sort((a, b) => a.id - b.id);
    expect(rows.map((r) => (r.details as { inRotation: boolean }).inRotation)).toEqual([false, true]);
    expect(rows[0]).toMatchObject({ resourceType: "hospitalist", resourceId: hid("chen"), userId: ctx.seedResult.userIds.director });
  });

  it("off-rotation providers are outside cap relief too", async () => {
    // Everyone routable at cap except nobody → relief; chen is out of rotation.
    for (const h of await ctx.storage.listWorkingHospitalists(orgId())) {
      await ctx.storage.updateHospitalist(orgId(), h.id, { currentPatientCount: h.patientCap });
    }
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.patch(`/api/hospitalists/${hid("chen")}/rotation`).send({ inRotation: false }).expect(200);
    const capBefore = (await ctx.storage.getHospitalist(orgId(), hid("chen")))!.patientCap;
    const pick = await selectNext(ctx.storage, orgId(), {});
    expect(pick?.id).not.toBe(hid("chen"));
    expect((await ctx.storage.getHospitalist(orgId(), hid("chen")))!.patientCap).toBe(capBefore);
  });

  it("validates the body and refuses a hospitalist changing it", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.patch(`/api/hospitalists/${hid("chen")}/rotation`).send({ inRotation: "no" }).expect(400);
    await director.patch(`/api/hospitalists/${hid("chen")}/rotation`).send({}).expect(400);
    await director.patch(`/api/hospitalists/abc/rotation`).send({ inRotation: false }).expect(404);
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.patch(`/api/hospitalists/${hid("chen")}/rotation`).send({ inRotation: false }).expect(403);
  });
});

describe("PATCH /api/hospitalists/:id/shift — the Director's shift selector", () => {
  it("moves a provider out of (and back into) the round-robin shifts, audited", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const res = await director.patch(`/api/hospitalists/${hid("chen")}/shift`).send({ shiftType: "swing" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: hid("chen"), shiftType: "swing" });
    const out = (await director.get("/api/rotation/next").expect(200)).body as Preview;
    expect(out.order).not.toContain(hid("chen"));
    expect((await selectNext(ctx.storage, orgId(), {}))?.id).not.toBe(hid("chen"));

    await director.patch(`/api/hospitalists/${hid("manukian")}/shift`).send({ shiftType: "day" }).expect(200);
    const dir = (await director.get("/api/physicians/directory").expect(200)).body as Array<{ id: number; shiftType: string }>;
    expect(dir.find((d) => d.id === hid("manukian"))?.shiftType).toBe("day");
    const back = (await director.get("/api/rotation/next").expect(200)).body as Preview;
    expect(back.order).toContain(hid("manukian"));

    const rows = await audits("hospitalist.shift_change");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.resourceId === hid("chen"))!.details).toMatchObject({ from: "day", to: "swing" });
  });

  it("rejects an unknown shift", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.patch(`/api/hospitalists/${hid("chen")}/shift`).send({ shiftType: "graveyard" }).expect(400);
  });
});

describe("PATCH /api/physicians/capacity — the Director's 'Apply to all'", () => {
  it("sets every provider's cap in the org (never another org's), audited", async () => {
    const { hospitalist: foreign } = await otherTenant();
    const { agent: director } = await login(ctx.app, { username: "director" });
    const res = await director.patch(`/api/physicians/capacity`).send({ patientCap: 7 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, bulk: true, patientCap: 7 });
    for (const h of await ctx.storage.listHospitalists(orgId())) expect(h.patientCap).toBe(7);
    expect((await ctx.storage.getHospitalist(foreign.organizationId, foreign.id))!.patientCap).toBe(12);
    // lopez (census 7) is now at cap and leaves the eligible set.
    const p = (await director.get("/api/rotation/next").expect(200)).body as Preview;
    expect(p.order).not.toContain(hid("lopez"));
    const rows = await audits("hospitalist.cap_bulk");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.details).toMatchObject({ patientCap: 7 });
  });
});
