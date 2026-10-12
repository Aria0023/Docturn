import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";

/** Patient-linked care-team threads: one conversation per patient, auto-membered. */
describe("patient-linked threads", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  async function admitAndAccept() {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const chenHospId = ctx.seedResult.hospitalistIds.chen!;
    const p = (
      await er
        .post("/api/patients")
        .send({ initials: "PT", roomNumber: "9", issueSummary: "obs", acuity: 2 })
    ).body;
    const a = (
      await er
        .post("/api/assignments")
        .send({ patientId: p.id, mode: "manual", hospitalistId: chenHospId })
    ).body;
    await chen.patch(`/api/assignments/${a.id}/accept`).expect(200);
    return { er, chen, patient: p };
  }

  it("creates ONE care-team thread per patient with attending + ER auto-membered", async () => {
    const { er, patient } = await admitAndAccept();
    const chenUserId = ctx.seedResult.userIds.chen!;
    const erUserId = ctx.seedResult.userIds["er.doc"]!;

    const res = await er
      .post("/api/messaging/patient-thread")
      .send({ patientId: patient.id });
    expect(res.status).toBe(201);
    expect(res.body.patientId).toBe(patient.id);
    expect(res.body.name).toContain("PT");
    expect(res.body.name).toContain("9");
    expect(res.body.participantIds).toContain(chenUserId);
    expect(res.body.participantIds).toContain(erUserId);

    // Idempotent: a second call reopens the SAME conversation.
    const again = await er
      .post("/api/messaging/patient-thread")
      .send({ patientId: patient.id });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(res.body.id);
  });

  it("membership follows the care team: a later caller is added, not duplicated", async () => {
    const { er, patient } = await admitAndAccept();
    const first = await er
      .post("/api/messaging/patient-thread")
      .send({ patientId: patient.id });

    const { agent: director } = await login(ctx.app, { username: "director" });
    const directorId = ctx.seedResult.userIds.director!;
    const joined = await director
      .post("/api/messaging/patient-thread")
      .send({ patientId: patient.id });
    expect(joined.body.id).toBe(first.body.id);
    expect(joined.body.participantIds).toContain(directorId);
    // no duplicate ids
    const ids = joined.body.participantIds as number[];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects unknown patients (404) and bad ids (400)", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    await er.post("/api/messaging/patient-thread").send({ patientId: 99999 }).expect(404);
    await er.post("/api/messaging/patient-thread").send({ patientId: "x" }).expect(400);
  });

  it("messages in the patient thread reach the whole care team", async () => {
    const { er, chen, patient } = await admitAndAccept();
    const convo = (
      await er.post("/api/messaging/patient-thread").send({ patientId: patient.id })
    ).body;
    await er
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "Plan: obs overnight" })
      .expect(201);
    const msgs = (
      await chen.get(`/api/messaging/conversations/${convo.id}/messages`)
    ).body;
    expect(msgs.some((m: { content: string }) => /obs overnight/.test(m.content))).toBe(true);
  });
});
