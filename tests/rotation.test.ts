import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { previewNext, selectNext } from "../server/services/rotation.js";
import { runExpirySweep } from "../server/services/assignments.js";

/**
 * Rotation invariants that the routing surfaces (assignment create / reroute,
 * on-call board "Next up", messaging "Next hospitalist") all depend on:
 *
 *  - A reroute with a single eligible provider re-offers them WITHOUT cap
 *    relief (A.CON-SHO-28).
 *  - Cap relief only ever raises caps inside the routable pool — providers
 *    whose shift is outside org.roundRobinShiftTypes are untouched (A.CON-MIN-4).
 *  - previewNext applies the same eligibility (shift + census < cap) as
 *    selectNext, so "Next up" is the provider who actually gets the next
 *    patient (A.CON-SHO-29).
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

async function hosp(id: number) {
  return (await ctx.storage.getHospitalist(orgId(), id))!;
}
async function setHosp(id: number, patch: Record<string, unknown>) {
  await ctx.storage.updateHospitalist(orgId(), id, patch);
}
/** Leave only `keys` working. */
async function onlyWorking(...keys: string[]) {
  const keep = new Set(keys.map(hid));
  for (const h of await ctx.storage.listHospitalists(orgId())) {
    await setHosp(h.id, { working: keep.has(h.id) });
  }
}
async function capReliefAudits() {
  return (await ctx.storage.listAuditLogs(orgId(), 500)).filter((r) => r.action === "rotation.cap_relief");
}

async function createPatient(initials = "RT") {
  const { agent } = await login(ctx.app, { username: "er.doc" });
  const res = await agent.post("/api/patients").send({ initials, roomNumber: "7", issueSummary: "rotation test" });
  expect(res.status).toBe(201);
  return { agent, patient: res.body as { id: number } };
}

describe("selectNext — reroute with a single eligible provider (A.CON-SHO-28)", () => {
  it("re-offers the excluded provider instead of raising caps", async () => {
    await onlyWorking("chen");
    const before = await hosp(hid("chen"));

    const pick = await selectNext(ctx.storage, orgId(), { excludeHospitalistId: hid("chen") });
    expect(pick?.id).toBe(hid("chen"));

    const after = await hosp(hid("chen"));
    expect(after.patientCap).toBe(before.patientCap); // not inflated
    expect(await capReliefAudits()).toHaveLength(0);
  });

  it("keeps the cap stable across repeated decline → reroute and expiry → reroute cycles", async () => {
    await onlyWorking("chen");
    await ctx.storage.setOrgSetting(orgId(), "autoReassignOnDecline", true, 1);
    const cap0 = (await hosp(hid("chen"))).patientCap;

    const { agent: er, patient } = await createPatient();
    const created = await er.post("/api/assignments").send({ patientId: patient.id, mode: "round_robin" });
    expect(created.status).toBe(201);
    expect(created.body.hospitalistId).toBe(hid("chen"));

    // Three declines in a row, each rerouting back to the only provider.
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    let current = created.body as { id: number; hospitalistId: number };
    for (let i = 0; i < 3; i++) {
      const rej = await chen.patch(`/api/assignments/${current.id}/reject`);
      expect(rej.status).toBe(200);
      expect(rej.body.reroute).toBeTruthy();
      expect(rej.body.reroute.hospitalistId).toBe(hid("chen"));
      current = rej.body.reroute;
      expect((await hosp(hid("chen"))).patientCap).toBe(cap0);
    }

    // Then an expiry → reroute, same story.
    await ctx.storage.updateAssignment(orgId(), current.id, { expiresAt: new Date(Date.now() - 60_000) });
    const sweep = await runExpirySweep(ctx.storage, new Date());
    expect(sweep).toEqual({ expired: 1, rerouted: 1 });
    expect((await hosp(hid("chen"))).patientCap).toBe(cap0);
    expect(await capReliefAudits()).toHaveLength(0);
  });

  it("still prefers an alternative with capacity over the excluded provider", async () => {
    await onlyWorking("chen", "liu");
    const pick = await selectNext(ctx.storage, orgId(), { excludeHospitalistId: hid("chen") });
    expect(pick?.id).toBe(hid("liu"));
  });

  it("applies cap relief only when nobody routable has capacity even without the exclusion", async () => {
    await onlyWorking("chen", "liu");
    await setHosp(hid("chen"), { currentPatientCount: 12, patientCap: 12 });
    await setHosp(hid("liu"), { currentPatientCount: 12, patientCap: 12 });

    const pick = await selectNext(ctx.storage, orgId(), { excludeHospitalistId: hid("chen") });
    // Relief raised both caps; the alternative to the declined provider wins.
    expect(pick?.id).toBe(hid("liu"));
    expect((await hosp(hid("chen"))).patientCap).toBe(13);
    expect((await hosp(hid("liu"))).patientCap).toBe(13);
    const audits = await capReliefAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.details).toMatchObject({ raisedBy: 1, excludedHospitalistId: hid("chen") });
    expect((audits[0]!.details as { hospitalistIds: number[] }).hospitalistIds.sort()).toEqual([hid("chen"), hid("liu")].sort());
  });
});

describe("selectNext — cap relief stays inside the routable pool (A.CON-MIN-4)", () => {
  it("raises day/night caps but leaves the swing-shift provider's cap alone", async () => {
    // Seed: roundRobinShiftTypes = [day, night]; Manukian works the swing shift.
    const working = await ctx.storage.listWorkingHospitalists(orgId());
    for (const h of working) await setHosp(h.id, { currentPatientCount: h.patientCap });
    const swing = working.filter((h) => h.shiftType === "swing");
    expect(swing.map((h) => h.id)).toEqual([hid("manukian")]);

    const { agent, patient } = await createPatient();
    const res = await agent.post("/api/assignments").send({ patientId: patient.id, mode: "round_robin" });
    expect(res.status).toBe(201);
    const picked = await hosp(res.body.hospitalistId);
    expect(["day", "night"]).toContain(picked.shiftType);

    const after = await ctx.storage.listWorkingHospitalists(orgId());
    for (const h of after) {
      const was = working.find((w) => w.id === h.id)!;
      if (h.shiftType === "swing") expect(h.patientCap).toBe(was.patientCap); // untouched
      else expect(h.patientCap).toBe(was.patientCap + 1);
    }
    const audits = await capReliefAudits();
    expect(audits).toHaveLength(1);
    expect((audits[0]!.details as { hospitalistIds: number[] }).hospitalistIds).not.toContain(hid("manukian"));
  });

  it("returns null (no relief, no writes) when nobody is working a routable shift", async () => {
    await onlyWorking("manukian"); // swing only
    const caps = (await hosp(hid("manukian"))).patientCap;
    expect(await selectNext(ctx.storage, orgId(), {})).toBeNull();
    expect((await hosp(hid("manukian"))).patientCap).toBe(caps);
    expect(await capReliefAudits()).toHaveLength(0);
  });
});

describe("previewNext — same eligibility as selectNext (A.CON-SHO-29)", () => {
  it("skips an at-cap provider even when they have the lowest census", async () => {
    // Chen: census 0 but cap 0 → ineligible. Old preview named him anyway.
    await setHosp(hid("chen"), { patientCap: 0 });
    const preview = await previewNext(ctx.storage, orgId());
    expect(preview?.id).not.toBe(hid("chen"));
    // Kohan (night, census 1, lowest routable order) is who selectNext picks.
    expect(preview?.id).toBe(hid("kohan"));
    const live = await selectNext(ctx.storage, orgId(), {});
    expect(live?.id).toBe(preview?.id);
  });

  it("never previews an off-shift provider: falls back to the routable pool's relief outcome, else null", async () => {
    await ctx.storage.updateOrganization(orgId(), { roundRobinShiftTypes: ["night"] });
    // Both night providers at cap → preview = who relief would pick (a night provider), never a day one.
    for (const key of ["kohan", "niculescu"]) await setHosp(hid(key), { currentPatientCount: 12, patientCap: 12 });
    const preview = await previewNext(ctx.storage, orgId());
    expect(preview).toBeTruthy();
    expect(preview!.shiftType).toBe("night");
    const live = await selectNext(ctx.storage, orgId(), {});
    expect(live?.id).toBe(preview!.id);

    // Nobody working a routable shift → both answer "no provider".
    await onlyWorking("chen", "manukian");
    expect(await previewNext(ctx.storage, orgId())).toBeNull();
    expect(await selectNext(ctx.storage, orgId(), {})).toBeNull();
  });

  it("uses the same eligible set (same modulus) in sequential mode", async () => {
    await ctx.storage.updateOrganization(orgId(), { rotationMode: "sequential", rotationIndex: 0 });
    // Chen (rotationOrder 0) is at cap; sequential must step over him.
    await setHosp(hid("chen"), { currentPatientCount: 12, patientCap: 12 });
    for (let i = 0; i < 4; i++) {
      const preview = await previewNext(ctx.storage, orgId());
      const live = await selectNext(ctx.storage, orgId(), {});
      expect(live?.id).toBe(preview?.id);
      expect(live?.id).not.toBe(hid("chen"));
    }
  });

  it("is honoured by the board 'Next up' row and the messaging picker", async () => {
    await setHosp(hid("chen"), { patientCap: 0 });
    const { agent: director } = await login(ctx.app, { username: "director" });
    const board = await director.get("/api/oncall/board");
    expect(board.status).toBe(200);
    const next = (board.body.rows as Array<{ kind: string; holderUserId: number }>).find((r) => r.kind === "next_hospitalist");
    expect(next?.holderUserId).toBe(ctx.seedResult.userIds.kohan);

    const targets = await director.get("/api/messaging/on-call-targets");
    expect(targets.status).toBe(200);
    const target = (targets.body as Array<{ kind: string; userId: number }>).find((t) => t.kind === "next_hospitalist");
    expect(target?.userId).toBe(ctx.seedResult.userIds.kohan);

    // And the next round-robin patient really does go there.
    const { agent: er, patient } = await createPatient();
    const res = await er.post("/api/assignments").send({ patientId: patient.id, mode: "round_robin" });
    expect(res.status).toBe(201);
    expect(res.body.hospitalistId).toBe(hid("kohan"));
  });
});
