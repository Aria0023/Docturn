import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { invalidateModules, setModule } from "../server/modules.js";
import { parseAdt } from "../server/services/adt-feed.js";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  invalidateModules();
  await ctx.handle.close();
});
const orgId = () => ctx.seedResult.orgId;

const adt = (event: string, o: { mrn?: string; family?: string; given?: string; dob?: string; loc?: string; reason?: string } = {}) =>
  [
    `MSH|^~\\&|EPIC|HOSP|DOCTURN|HOSP|20260903120000||ADT^${event}|MSG${event}1|P|2.5`,
    `EVN|${event}|20260903120000`,
    `PID|1||${o.mrn ?? "E100200"}^^^HOSP^MR~999-00-1111^^^SSA^SS||${o.family ?? "Okafor"}^${o.given ?? "Ruth"}^A||${o.dob ?? "19501001"}|F`,
    `PV1|1|I|${o.loc ?? "5W^512^A"}||||1234^Rao^Priya`,
    `PV2|||^${o.reason ?? "Sepsis"}`,
  ].join("\r");

describe("patient name, date of birth and MRN", () => {
  it("are stored and shown to staff, validated, and never leave in a realtime frame or a push", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const made = await er.post("/api/patients").send({ initials: "RO", roomNumber: "ED 4", issueSummary: "sepsis", fullName: "Ruth Okafor", dateOfBirth: "1950-10-01", mrn: "E100200" });
    expect(made.status).toBe(201);
    expect((await er.post("/api/patients").send({ initials: "XX", dateOfBirth: "10/01/1950" })).status).toBe(400);
    expect((await er.post("/api/patients").send({ initials: "XX", mrn: "has space" })).status).toBe(400);

    const row = (await er.get("/api/patient-board")).body.find((r: { patient: { id: number } }) => r.patient.id === made.body.id);
    expect(row.patient).toMatchObject({ fullName: "Ruth Okafor", dateOfBirth: "1950-10-01", mrn: "E100200", source: "manual" });

    await er.post("/api/assignments").send({ patientId: made.body.id, mode: "round_robin" });
    const everything = JSON.stringify([ctx.ws.delivered, ctx.ws.broadcasts, ctx.push.sent, ctx.sms.sent]);
    expect(everything).not.toMatch(/Okafor|E100200|1950-10-01/);
    // …nor in the audit trail.
    expect(JSON.stringify(await ctx.storage.listAuditLogs(orgId(), 200))).not.toMatch(/Okafor|E100200|1950-10-01/);

    // A director corrects the name; the audit names the field, not the value.
    const { agent: director } = await login(ctx.app, { username: "director" });
    expect((await director.patch(`/api/patients/${made.body.id}`).send({ fullName: "Ruth A. Okafor" })).status).toBe(200);
    const audit = (await ctx.storage.listAuditLogs(orgId(), 50)).find((r) => r.action === "patient.update")!;
    expect(audit.details).toEqual({ fields: ["fullName"] });
  });

  it("with the module off the server stores and returns initials only", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const made = await er.post("/api/patients").send({ initials: "RO", fullName: "Ruth Okafor", mrn: "E100200" });
    await setModule(orgId(), "patients.identity", false);
    expect((await er.post("/api/patients").send({ initials: "AB", fullName: "A B" })).status).toBe(404);
    expect((await er.post("/api/patients").send({ initials: "AB" })).status).toBe(201);
    const listed = (await er.get("/api/patients")).body.find((p: { id: number }) => p.id === made.body.id);
    expect(listed).toMatchObject({ initials: "RO", fullName: null, mrn: null, dateOfBirth: null });
    const row = (await er.get("/api/patient-board")).body.find((r: { patient: { id: number } }) => r.patient.id === made.body.id);
    expect(row.patient).toMatchObject({ fullName: null, mrn: null });
  });
});

describe("bed ready", () => {
  it("a charge nurse marks a bed ready and the board shows who and where; a hospitalist cannot", async () => {
    await ctx.storage.createUser({
      organizationId: orgId(), username: "rn", passwordHash: (await ctx.storage.getUserByUsername(orgId(), "chen"))!.passwordHash,
      role: "staff", displayName: "Kay Rivers", credential: "RN", jobTitle: "Charge nurse", phone: null, twoFactorEnabled: false,
    });
    const { agent: nurse } = await login(ctx.app, { username: "rn" });
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const pid = ctx.seedResult.patientIds[Object.keys(ctx.seedResult.patientIds)[0]!]!;
    expect((await chen.post(`/api/patients/${pid}/bed`).send({ ready: true, unit: "5W" })).status).toBe(403);
    expect((await nurse.post(`/api/patients/${pid}/bed`).send({ ready: "yes" })).status).toBe(400);
    expect((await nurse.post(`/api/patients/999999/bed`).send({ ready: true })).status).toBe(404);
    const done = await nurse.post(`/api/patients/${pid}/bed`).send({ ready: true, unit: "5 West 512" });
    expect(done.status).toBe(200);
    let row = (await chen.get("/api/patient-board")).body.find((r: { patient: { id: number } }) => r.patient.id === pid);
    expect(row.patient).toMatchObject({ bedUnit: "5 West 512", bedReadyBy: "Kay Rivers" });
    expect(row.patient.bedReadyAt).toBeTruthy();
    expect((await ctx.storage.listAuditLogs(orgId(), 20)).some((r) => r.action === "patient.bed_ready")).toBe(true);
    await nurse.post(`/api/patients/${pid}/bed`).send({ ready: false });
    row = (await chen.get("/api/patient-board")).body.find((r: { patient: { id: number } }) => r.patient.id === pid);
    expect(row.patient).toMatchObject({ bedReadyAt: null, bedReadyBy: null });
  });
});

describe("EHR admission feed (HL7 ADT)", () => {
  it("reads the MRN, name, birth date, location and reason from a message", () => {
    expect(parseAdt(adt("A01"))).toEqual({
      event: "A01", controlId: "MSGA011", mrn: "E100200", fullName: "Ruth Okafor", initials: "RO", dateOfBirth: "1950-10-01",
      patientClass: "I", unit: "5W", room: "512-A", reason: "Sepsis",
    });
    expect(() => parseAdt("MSH|^~\\&|A|B|C|D|2026||ORU^R01|1|P|2.5\rPID|1||1")).toThrow("not_adt");
    expect(() => parseAdt("hello")).toThrow();
  });

  it("is off until switched on and a director generates the token; the token is shown once", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    expect((await director.get("/api/ehr/adt/token")).status).toBe(404); // module off by default
    await setModule(orgId(), "ehr.adtFeed", true);
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    expect((await chen.post("/api/ehr/adt/token")).status).toBe(403);
    expect((await director.get("/api/ehr/adt/token")).body).toMatchObject({ connected: false, received: 0 });
    const token = (await director.post("/api/ehr/adt/token")).body.token as string;
    expect(token).toMatch(/^adt_\d+_/);
    expect(JSON.stringify(await ctx.storage.getOrgSetting(orgId(), "adtFeed"))).not.toContain(token);
    expect((await director.get("/api/ehr/adt/token")).body.connected).toBe(true);

    const post = (body: string, t = token) => supertest(ctx.app).post("/api/ehr/adt").set("Authorization", "Bearer " + t).set("Content-Type", "x-application/hl7-v2+er7").send(body);
    expect((await post(adt("A01"), "adt_" + orgId() + "_wrongwrongwrongwrongwrong")).status).toBe(401);
    expect((await supertest(ctx.app).post("/api/ehr/adt").send(adt("A01"))).status).toBe(401);

    // Admit: the patient appears, waiting for a hospitalist, with identity.
    const admit = await post(adt("A01"));
    expect(admit.status).toBe(200);
    expect(admit.text).toMatch(/^MSH\|.*\|ACK\|/);
    expect(admit.text).toContain("MSA|AA|MSGA011|added");
    let p = (await ctx.storage.findPatientByMrn(orgId(), "E100200"))!;
    expect(p).toMatchObject({ initials: "RO", fullName: "Ruth Okafor", dateOfBirth: "1950-10-01", roomNumber: "512-A", department: "5W", issueSummary: "Sepsis", status: "waiting", source: "adt" });
    // The same admit again does not add a second patient.
    expect((await post(adt("A01"))).text).toContain("|updated");
    expect((await ctx.storage.listPatients(orgId())).filter((x) => x.mrn === "E100200")).toHaveLength(1);
    // Transfer moves them; discharge closes them.
    await post(adt("A02", { loc: "ICU^3^B" }));
    p = (await ctx.storage.findPatientByMrn(orgId(), "E100200"))!;
    expect(p).toMatchObject({ roomNumber: "3-B", department: "ICU" });
    expect((await post(adt("A03"))).text).toContain("|discharged");
    expect((await ctx.storage.findPatientByMrn(orgId(), "E100200"))!.status).toBe("discharged");
    // Garbage is refused with an HL7 error and counted.
    const bad = await post("not hl7");
    expect(bad.status).toBe(400);
    expect(bad.text).toContain("MSA|AE");
    expect((await director.get("/api/ehr/adt/token")).body).toMatchObject({ received: 4, rejected: 1, lastEvent: "A03" });
    // Every open board was told to re-read; the frames carry no patient.
    expect(JSON.stringify(ctx.ws.broadcasts)).not.toMatch(/Okafor|E100200/);

    // Revoked: the old token stops working.
    expect((await director.delete("/api/ehr/adt/token")).status).toBe(204);
    expect((await post(adt("A01", { mrn: "E2" }))).status).toBe(401);
  });

  it("a patient from the feed outlives auto-clean until the EHR discharges them", async () => {
    await setModule(orgId(), "ehr.adtFeed", true);
    const { agent: director } = await login(ctx.app, { username: "director" });
    const token = (await director.post("/api/ehr/adt/token")).body.token as string;
    const post = (body: string) => supertest(ctx.app).post("/api/ehr/adt").set("Authorization", "Bearer " + token).set("Content-Type", "text/plain").send(body);
    await post(adt("A01"));
    const p = (await ctx.storage.findPatientByMrn(orgId(), "E100200"))!;
    // Older than any window: still here.
    await ctx.storage.purgeOldPatients(orgId(), 1);
    await new Promise((r) => setTimeout(r, 15));
    await ctx.storage.purgeOldPatients(orgId(), 1);
    expect(await ctx.storage.getPatient(orgId(), p.id)).toBeTruthy();
    await post(adt("A03"));
    await ctx.storage.purgeOldPatients(orgId(), 1);
    expect(await ctx.storage.getPatient(orgId(), p.id)).toBeUndefined();
  });

  it("with identity off the feed keeps initials and the MRN it needs to match, and no name", async () => {
    await setModule(orgId(), "ehr.adtFeed", true);
    await setModule(orgId(), "patients.identity", false);
    const { agent: director } = await login(ctx.app, { username: "director" });
    const token = (await director.post("/api/ehr/adt/token")).body.token as string;
    await supertest(ctx.app).post("/api/ehr/adt").set("Authorization", "Bearer " + token).set("Content-Type", "text/plain").send(adt("A01"));
    expect(await ctx.storage.findPatientByMrn(orgId(), "E100200")).toMatchObject({ initials: "RO", fullName: null, dateOfBirth: null });
  });
});
