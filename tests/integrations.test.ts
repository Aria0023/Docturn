import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import webpush from "web-push";
import { eq } from "drizzle-orm";
import { orgIntegrationCredentials } from "@shared/schema";
import { createTestApp, login, DEV_PASSWORD, type TestContext } from "./helpers.js";
import { hashPassword } from "../server/auth.js";
import { getModules, invalidateModules, setModule } from "../server/modules.js";
import { setExtractor, type AIExtractor } from "../server/services/ai-intake.js";
import { LivePushTransport } from "../server/services/push.js";
import {
  amionFeedFor,
  runScheduledAmionSyncAll,
  syncAmion,
} from "../server/services/amion.js";
import { epicConfigFor, syncEpic } from "../server/services/schedule-sources/epic-fhir.js";
import { configureIntegrations, resetIntegrationDeps } from "../server/integrations/http.js";
import { credentialKeyState, decryptCredentialRow } from "../server/integrations/crypto.js";
import { INTEGRATION_IDS } from "../server/integrations/registry.js";

/**
 * The director's Integrations panel used to be a mock: "Connect" flipped a
 * browser boolean and toasted "Connected" while nothing reached the server.
 * These tests pin the REAL system (server/integrations/):
 *
 *   - status is computed from live configuration (env for platform-scope
 *     integrations, encrypted per-hospital credentials for Amion / Epic) and
 *     names missing settings, never their values;
 *   - the on/off switch is the org's gating module, flipped server-side,
 *     refused (409) when the integration is not configured or lacks a BAA,
 *     limited to integration modules of the caller's own org;
 *   - hospital credentials are write-only, AES-256-GCM at rest, need
 *     INTEGRATION_KEY, never come back in any response, and leave with the org;
 *   - "Test connection" makes a real but harmless call through an injectable
 *     fetch (no network in CI), times out, and is audited without secrets;
 *   - Amion / Epic read a hospital's own credentials before the legacy env.
 */

const AMION_HTML = readFileSync(new URL("./fixtures/amion-ocs.html", import.meta.url), "utf8");
const EPIC_BUNDLE = JSON.parse(
  readFileSync(new URL("./fixtures/epic-practitionerrole.json", import.meta.url), "utf8"),
);

const ENV_KEYS = [
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER",
  "OPENAI_API_KEY", "AI_EXTERNAL_PHI_OK", "USE_STUB_AI",
  "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT",
  "AMION_OCS_URL", "AMION_ORG_CODE", "AMION_SYNC_INTERVAL_MIN",
  "EPIC_FHIR_BASE_URL", "EPIC_CLIENT_ID", "EPIC_PRIVATE_KEY_PEM", "EPIC_TOKEN_URL", "EPIC_ORG_CODE",
  "INTEGRATION_KEY",
] as const;

const TWILIO = {
  TWILIO_ACCOUNT_SID: "AC" + "0123456789abcdef".repeat(2), // assembled at runtime: a SID-shaped literal trips GitHub push protection
  TWILIO_AUTH_TOKEN: "twilio-auth-token-SECRET-9f8e7d",
  TWILIO_FROM_NUMBER: "+15551230000",
};
const OPENAI_KEY = "sk-test-SECRET-openai-key-4b3a";
const KEY_HEX = "a".repeat(64);
const AMION_LOGIN = "SECRET-LOGIN-123";
const AMION_ORG_URL = `https://www.amion.com/cgi-bin/ocs?Lo=${AMION_LOGIN}`;

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
/** A line of the key material itself (the PEM header is not secret — placeholders show it). */
const KEY_BODY = PRIVATE_PEM.split("\n")[3]!;
const EPIC_CREDS = {
  baseUrl: "https://fhir.hospital-one.test/interconnect-fhir-oauth/api/FHIR/R4",
  clientId: "hospital-one-SECRET-client",
  privateKeyPem: PRIVATE_PEM,
  tokenUrl: "https://fhir.hospital-one.test/interconnect-fhir-oauth/oauth2/token",
};

const saved: Record<string, string | undefined> = {};
let ctx: TestContext;

/** A public address for every hostname — the SSRF guard's DNS check passes. */
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

type Call = { url: string; init?: RequestInit };
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
/** Scripted outbound fetch: answers by URL, records every call. */
function scripted(handler: (url: string, init?: RequestInit) => Response | Promise<Response>, calls: Call[] = []) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
}

beforeEach(async () => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  invalidateModules();
  resetIntegrationDeps();
  configureIntegrations({ lookup: publicLookup });
  ctx = await createTestApp();
});
afterEach(async () => {
  resetIntegrationDeps();
  invalidateModules();
  setExtractor(null as unknown as AIExtractor);
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await ctx.handle.close();
});

const director = () => login(ctx.app, { username: "director" }).then((r) => r.agent);
const devAgent = () => login(ctx.app, { orgCode: "DOCTURN", username: "dev" }).then((r) => r.agent);
const card = (body: any, id: string) => (body.integrations as any[]).find((c) => c.id === id);
const audit = (orgId: number) => ctx.storage.listAuditLogs(orgId, 500);

async function otherOrgWithDirector(code = "OTHR") {
  const org = await ctx.storage.createOrganization({
    name: code + " Medical Center",
    code,
    city: null,
    state: null,
    timezone: "America/New_York",
    assignmentTimeoutMin: 10,
    roundRobinShiftTypes: ["day", "night"],
    rotationMode: "lowest_census",
    rotationIndex: 0,
  });
  await ctx.storage.createUser({
    organizationId: org.id,
    username: "otherdirector",
    passwordHash: await hashPassword(DEV_PASSWORD),
    role: "director",
    displayName: "Dr. Other Director",
    credential: null,
    phone: null,
    twoFactorEnabled: false,
  });
  const { agent } = await login(ctx.app, { orgCode: code, username: "otherdirector" });
  return { org, agent };
}

// ── registry status from live configuration ─────────────────────────────────
describe("integration registry — status from live config", () => {
  it("lists the five real integrations; nothing configured → not_configured with missing NAMES", async () => {
    const res = await (await director()).get("/api/integrations").expect(200);
    expect(res.body.orgId).toBe(ctx.seedResult.orgId);
    expect((res.body.integrations as any[]).map((c) => c.id)).toEqual([...INTEGRATION_IDS]);
    expect([...INTEGRATION_IDS]).toEqual(["twilio-sms", "push", "openai-intake", "amion", "epic-fhir"]);
    // Push is Web Push + Expo — never "Firebase".
    expect(JSON.stringify(res.body)).not.toMatch(/firebase|FCM/i);

    const tw = card(res.body, "twilio-sms");
    expect(tw).toMatchObject({ scope: "platform", module: "integration.sms", status: "not_configured", phi: false });
    expect(tw.missing).toEqual(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]);
    expect(tw.canEnable).toBe(false);

    const ai = card(res.body, "openai-intake");
    expect(ai).toMatchObject({ scope: "platform", module: "integration.aiIntake", phi: true, baaRequired: true, status: "not_configured" });
    expect(ai.missing).toContain("OPENAI_API_KEY");

    const amion = card(res.body, "amion");
    expect(amion).toMatchObject({ scope: "organization", module: "schedule.amion", status: "not_configured" });
    expect(amion.setup.kind).toBe("credentials");
    const epic = card(res.body, "epic-fhir");
    expect(epic).toMatchObject({ scope: "organization", module: "schedule.epic", status: "not_configured", enabled: false });

    const push = card(res.body, "push");
    expect(push).toMatchObject({ scope: "platform", module: "integration.push", status: "not_configured" });
    expect(push.missing).toEqual(["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]);

    // Platform-scope cards tell the operator exactly where to set each variable.
    const steps = JSON.stringify(tw.setup.steps);
    expect(steps).toContain("Environment");
    expect(steps).toContain("/docturn/prod/TWILIO_AUTH_TOKEN");
    expect(steps).toContain("fetch-env-from-ssm.sh");
  });

  it("Twilio env present → active, and the response carries names, never values", async () => {
    Object.assign(process.env, TWILIO);
    const res = await (await director()).get("/api/integrations").expect(200);
    expect(card(res.body, "twilio-sms")).toMatchObject({ status: "active", enabled: true, missing: [] });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(TWILIO.TWILIO_AUTH_TOKEN);
    expect(body).not.toContain(TWILIO.TWILIO_ACCOUNT_SID);
    expect(body).not.toContain(TWILIO.TWILIO_FROM_NUMBER);
  });

  it("OpenAI: key without AI_EXTERNAL_PHI_OK → needs_baa; with it → active; USE_STUB_AI=true → not_configured", async () => {
    const agent = await director();
    process.env.OPENAI_API_KEY = OPENAI_KEY;
    let ai = card((await agent.get("/api/integrations")).body, "openai-intake");
    expect(ai.status).toBe("needs_baa");
    expect(ai.missing).toEqual(["AI_EXTERNAL_PHI_OK"]);
    expect(ai.statusText).toMatch(/BAA/);
    process.env.AI_EXTERNAL_PHI_OK = "true";
    ai = card((await agent.get("/api/integrations")).body, "openai-intake");
    expect(ai.status).toBe("active");
    process.env.USE_STUB_AI = "true";
    ai = card((await agent.get("/api/integrations")).body, "openai-intake");
    expect(ai.status).toBe("not_configured");
    expect(ai.invalid).toContain("USE_STUB_AI");
    expect(JSON.stringify(ai)).not.toContain(OPENAI_KEY);
  });

  it("push: valid VAPID env → active; malformed → not_configured naming the bad variable", async () => {
    const keys = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    const agent = await director();
    let push = card((await agent.get("/api/integrations")).body, "push");
    expect(push).toMatchObject({ status: "active", configSource: "env" });
    expect(JSON.stringify(push)).not.toContain(keys.privateKey);
    process.env.VAPID_PRIVATE_KEY = "not-a-key";
    push = card((await agent.get("/api/integrations")).body, "push");
    expect(push.status).toBe("not_configured");
    expect(push.invalid).toEqual(["VAPID_PRIVATE_KEY"]);
  });

  it("Amion env applies only to AMION_ORG_CODE's tenant", async () => {
    process.env.AMION_OCS_URL = "https://www.amion.com/cgi-bin/ocs?Lo=ENV-LOGIN";
    process.env.AMION_ORG_CODE = "ISPN";
    const mine = card((await (await director()).get("/api/integrations")).body, "amion");
    expect(mine).toMatchObject({ status: "active", configSource: "env" });
    expect(JSON.stringify(mine)).not.toContain("ENV-LOGIN");
    const { agent } = await otherOrgWithDirector();
    const theirs = card((await agent.get("/api/integrations")).body, "amion");
    expect(theirs.status).toBe("not_configured");
  });
});

// ── access control ──────────────────────────────────────────────────────────
describe("integrations — roles and tenancy", () => {
  it("hospitalists are refused every route (403); anonymous 401", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.get("/api/integrations").expect(403);
    await chen.patch("/api/integrations/twilio-sms").send({ enabled: false }).expect(403);
    await chen.post("/api/integrations/twilio-sms/test").expect(403);
    await chen.put("/api/integrations/amion/credentials").send({ ocsUrl: AMION_ORG_URL }).expect(403);
    await chen.delete("/api/integrations/amion/credentials").expect(403);
    await supertest(ctx.app).get("/api/integrations").expect(401);
  });

  it("a director cannot read or touch another org (404), and only integration ids exist (404)", async () => {
    const { org } = await otherOrgWithDirector();
    const agent = await director();
    await agent.get(`/api/integrations?orgId=${org.id}`).expect(404);
    await agent.patch(`/api/integrations/twilio-sms?orgId=${org.id}`).send({ enabled: false }).expect(404);
    await agent.post(`/api/integrations/twilio-sms/test?orgId=${org.id}`).expect(404);
    await agent.put(`/api/integrations/amion/credentials?orgId=${org.id}`).send({ ocsUrl: AMION_ORG_URL }).expect(404);
    expect((await getModules(org.id))["integration.sms"]).toBe(true);
    // The allowlist: only the five integrations' gating modules are reachable.
    for (const id of ["broadcasts", "security.mfaRequired", "integration.sms", "ops.analytics"]) {
      await agent.patch(`/api/integrations/${id}`).send({ enabled: false }).expect(404);
    }
    expect((await getModules(ctx.seedResult.orgId)).broadcasts).toBe(true);
    // The developer module console is still developer-only.
    await agent.patch(`/api/dev/modules/${ctx.seedResult.orgId}`).send({ id: "integration.sms", enabled: false }).expect(403);
  });

  it("a developer may act on any org via ?orgId; the read is audited in that tenant's trail", async () => {
    const dev = await devAgent();
    const orgId = ctx.seedResult.orgId;
    const before = (await audit(orgId)).length;
    const res = await dev.get(`/api/integrations?orgId=${orgId}`).expect(200);
    expect(res.body.orgId).toBe(orgId);
    const rows = await audit(orgId);
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ action: "dev.integrations_read", userId: ctx.seedResult.userIds.dev });
    await dev.patch(`/api/integrations/twilio-sms?orgId=${orgId}`).send({ enabled: false }).expect(200);
    expect((await getModules(orgId))["integration.sms"]).toBe(false);
    await dev.get("/api/integrations?orgId=99999").expect(404);
  });
});

// ── PATCH: the switch is the org's gating module ────────────────────────────
describe("PATCH /api/integrations/:id — real switch, refused when not ready", () => {
  it("refuses to enable a not_configured integration (409) and leaves the module alone", async () => {
    const agent = await director();
    const orgId = ctx.seedResult.orgId;
    // Disabling is always allowed.
    const off = await agent.patch("/api/integrations/twilio-sms").send({ enabled: false }).expect(200);
    expect(off.body.integration).toMatchObject({ id: "twilio-sms", enabled: false });
    expect((await getModules(orgId))["integration.sms"]).toBe(false);
    const refused = await agent.patch("/api/integrations/twilio-sms").send({ enabled: true }).expect(409);
    expect(refused.body).toMatchObject({ error: "integration_not_ready", status: "not_configured" });
    expect(refused.body.missing).toEqual(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]);
    expect(refused.body.reason).toBeTruthy();
    expect((await getModules(orgId))["integration.sms"]).toBe(false);
    await agent.patch("/api/integrations/twilio-sms").send({ enabled: "yes" }).expect(400);
  });

  it("flips the module when configured, reflects it everywhere, and audits enable/disable", async () => {
    Object.assign(process.env, TWILIO);
    const agent = await director();
    const orgId = ctx.seedResult.orgId;
    const off = await agent.patch("/api/integrations/twilio-sms").send({ enabled: false }).expect(200);
    expect(off.body.integration.status).toBe("off");
    // The org's module map (what every gate reads) says off too.
    const mods = await agent.get("/api/modules").expect(200);
    expect(mods.body.modules["integration.sms"]).toBe(false);
    const on = await agent.patch("/api/integrations/twilio-sms").send({ enabled: true }).expect(200);
    expect(on.body.integration).toMatchObject({ status: "active", enabled: true });
    const rows = (await audit(orgId)).filter((r) => r.action.startsWith("integration."));
    expect(rows.map((r) => r.action)).toEqual(["integration.enable", "integration.disable"]);
    expect(rows[0]!.details).toEqual({ integration: "twilio-sms", module: "integration.sms" });
  });

  it("refuses to enable OpenAI without the BAA attestation (needs_baa)", async () => {
    process.env.OPENAI_API_KEY = OPENAI_KEY;
    const agent = await director();
    await agent.patch("/api/integrations/openai-intake").send({ enabled: false }).expect(200);
    const refused = await agent.patch("/api/integrations/openai-intake").send({ enabled: true }).expect(409);
    expect(refused.body.status).toBe("needs_baa");
    process.env.AI_EXTERNAL_PHI_OK = "true";
    await agent.patch("/api/integrations/openai-intake").send({ enabled: true }).expect(200);
  });

  it("the developer module console applies the same readiness rule to integration modules", async () => {
    const dev = await devAgent();
    const orgId = ctx.seedResult.orgId;
    await dev.patch(`/api/dev/modules/${orgId}`).send({ id: "integration.sms", enabled: false }).expect(200);
    const refused = await dev.patch(`/api/dev/modules/${orgId}`).send({ id: "integration.sms", enabled: true }).expect(409);
    expect(refused.body.error).toBe("integration_not_ready");
    // Non-integration modules are unaffected.
    await dev.patch(`/api/dev/modules/${orgId}`).send({ id: "broadcasts", enabled: false }).expect(200);
  });
});

// ── the switch is enforced where the integration is used ────────────────────
describe("integration switches are enforced server-side", () => {
  it("SMS off → /api/sms/send refused, no text recorded", async () => {
    const agent = await director();
    await agent.patch("/api/integrations/twilio-sms").send({ enabled: false }).expect(200);
    const res = await agent.post("/api/sms/send").send({ to: "+15550001111", body: "hello" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "module_disabled", module: "integration.sms" });
    expect(await ctx.storage.listSmsHistory(ctx.seedResult.orgId)).toHaveLength(0);
  });

  it("Twilio configured → the org's texts really go through Twilio; a carrier rejection is never 'sent'", async () => {
    Object.assign(process.env, TWILIO);
    const calls: Call[] = [];
    let status = 201;
    configureIntegrations({ fetch: scripted(() => json({ sid: "SM123" }, status), calls) });
    const agent = await director();
    const ok = await agent.post("/api/sms/send").send({ to: "+15550001111", body: "hello" });
    expect(ok.status).toBe(201);
    expect(calls[0]!.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO.TWILIO_ACCOUNT_SID}/Messages.json`);
    status = 401;
    const bad = await agent.post("/api/sms/send").send({ to: "+15550001111", body: "hello again" });
    expect(bad.status).toBe(503);
    expect(bad.body.error).toBe("sms_unavailable");
    expect(await ctx.storage.listSmsHistory(ctx.seedResult.orgId)).toHaveLength(1);
  });

  it("push off → no VAPID key, no device registration, and no delivery to that org's devices", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const sub = { endpoint: "https://push.example/e1", keys: { p256dh: "k", auth: "a" } };
    await chen.post("/api/mobile/device-tokens").send({ token: JSON.stringify(sub), platform: "webpush" }).expect(201);
    await (await director()).patch("/api/integrations/push").send({ enabled: false }).expect(200);
    expect((await chen.get("/api/push/vapid-key")).body).toEqual({ error: "module_disabled", module: "integration.push" });
    await chen.post("/api/mobile/device-tokens").send({ token: "ExponentPushToken[x]", platform: "expo" }).expect(404);
    const sent: string[] = [];
    const transport = new LivePushTransport({ webPushSend: async (_s, p) => { sent.push(p); }, expoSend: async () => {} });
    await transport.send(chenId, { title: "New secure message" });
    expect(sent).toHaveLength(0);
    // Sign-out can still remove the device's subscription.
    await chen.delete("/api/mobile/device-tokens/" + encodeURIComponent(JSON.stringify(sub))).expect(204);
  });

  it("AI intake off → the local extractor, even when the external one is configured", async () => {
    const calls: string[] = [];
    setExtractor({ async extract(note: string) { calls.push(note); return { initials: "ZZ", roomNumber: "1", issueSummary: "external", specialty: "General" }; } });
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const on = await er.post("/api/patients/extract").send({ note: "Patient J.D. in room 204 with chest pain" }).expect(200);
    expect(on.body.issueSummary).toBe("external");
    await (await director()).patch("/api/integrations/openai-intake").send({ enabled: false }).expect(200);
    const off = await er.post("/api/patients/extract").send({ note: "Patient J.D. in room 204 with chest pain" }).expect(200);
    expect(off.body).toMatchObject({ initials: "JD", roomNumber: "204", specialty: "Cardiology" });
    expect(calls).toHaveLength(1);
  });
});

// ── per-hospital credentials ────────────────────────────────────────────────
describe("per-hospital credentials — write-only, encrypted at rest", () => {
  it("without INTEGRATION_KEY storage is disabled with a clear message, and nothing is stored", async () => {
    const agent = await director();
    const res = await agent.get("/api/integrations").expect(200);
    expect(res.body.credentialStorage).toMatchObject({ available: false });
    expect(res.body.credentialStorage.message).toMatch(/INTEGRATION_KEY/);
    const put = await agent.put("/api/integrations/amion/credentials").send({ ocsUrl: AMION_ORG_URL }).expect(503);
    expect(put.body.error).toBe("credential_storage_disabled");
    expect(await ctx.handle.db.select().from(orgIntegrationCredentials)).toHaveLength(0);
    // A short secret is not a key either.
    process.env.INTEGRATION_KEY = "too-short";
    expect(credentialKeyState()).toMatchObject({ ok: false });
  });

  it("stores ciphertext (not the secret), never returns it, decrypts correctly, and audits ids only", async () => {
    process.env.INTEGRATION_KEY = KEY_HEX;
    const agent = await director();
    const put = await agent.put("/api/integrations/amion/credentials").send({ ocsUrl: AMION_ORG_URL }).expect(200);
    expect(JSON.stringify(put.body)).not.toContain(AMION_LOGIN);
    const c = put.body.integration;
    expect(c.setup.current).toMatchObject({ set: true, updatedByName: "Dr. Dana Director" });
    expect(c.setup.current.summary).toEqual({ host: "www.amion.com" });
    expect(c.configSource).toBe("organization");

    const rows = await ctx.handle.db.select().from(orgIntegrationCredentials);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ organizationId: ctx.seedResult.orgId, integrationId: "amion", keyVersion: 1 });
    expect(JSON.stringify(row)).not.toContain(AMION_LOGIN);
    expect(JSON.stringify(row)).not.toContain("amion.com/cgi-bin");
    expect(decryptCredentialRow(row)).toEqual({ ocsUrl: AMION_ORG_URL });

    const get = await agent.get("/api/integrations").expect(200);
    expect(JSON.stringify(get.body)).not.toContain(AMION_LOGIN);
    const auditRows = (await audit(ctx.seedResult.orgId)).filter((r) => r.action === "integration.credentials_set");
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.details).toEqual({ integration: "amion" });
    expect(JSON.stringify(await audit(ctx.seedResult.orgId))).not.toContain(AMION_LOGIN);
  });

  it("accepts a passphrase key (HKDF) and the Amion login alone; a changed key reads as unreadable, never as plaintext", async () => {
    process.env.INTEGRATION_KEY = "correct horse battery staple, but longer";
    expect(credentialKeyState()).toMatchObject({ ok: true, source: "hkdf" });
    const agent = await director();
    await agent.put("/api/integrations/amion/credentials").send({ login: AMION_LOGIN }).expect(200);
    const feed = await amionFeedFor(ctx.storage, ctx.seedResult.orgId);
    expect(feed).toMatchObject({ source: "organization" });
    expect(feed!.url).toBe(`https://www.amion.com/cgi-bin/ocs?Lo=${AMION_LOGIN}`);

    process.env.INTEGRATION_KEY = "b".repeat(64);
    expect(await amionFeedFor(ctx.storage, ctx.seedResult.orgId)).toBeNull();
    const amion = card((await agent.get("/api/integrations")).body, "amion");
    expect(amion.status).toBe("not_configured");
    expect(amion.statusText).toMatch(/INTEGRATION_KEY/);
  });

  it("validates fields: https Amion host only, no private hosts, Epic key must parse", async () => {
    process.env.INTEGRATION_KEY = KEY_HEX;
    const agent = await director();
    for (const ocsUrl of [
      "http://www.amion.com/cgi-bin/ocs?Lo=x",
      "https://evil.example.com/ocs?Lo=x",
      "https://localhost/ocs?Lo=x",
    ]) {
      const r = await agent.put("/api/integrations/amion/credentials").send({ ocsUrl }).expect(400);
      expect(r.body.error).toBe("validation_error");
    }
    await agent.put("/api/integrations/amion/credentials").send({}).expect(400);
    const badKey = await agent.put("/api/integrations/epic-fhir/credentials").send({ ...EPIC_CREDS, privateKeyPem: "nope" }).expect(400);
    expect(badKey.body.field).toBe("privateKeyPem");
    for (const baseUrl of ["https://10.0.0.5/fhir", "https://169.254.169.254/latest", "http://fhir.hospital-one.test/R4"]) {
      await agent.put("/api/integrations/epic-fhir/credentials").send({ ...EPIC_CREDS, baseUrl }).expect(400);
    }
    // Platform-scope credentials stay in env/SSM — never stored through the UI.
    const plat = await agent.put("/api/integrations/twilio-sms/credentials").send({ authToken: "x" }).expect(400);
    expect(plat.body.error).toBe("platform_scope");
  });

  it("Epic credentials: off until switched on, then active; DELETE clears them (audited)", async () => {
    process.env.INTEGRATION_KEY = KEY_HEX;
    const agent = await director();
    const put = await agent.put("/api/integrations/epic-fhir/credentials").send(EPIC_CREDS).expect(200);
    expect(put.body.integration.status).toBe("off"); // schedule.epic defaults off
    expect(put.body.integration.setup.current.summary).toEqual({
      baseUrlHost: "fhir.hospital-one.test",
      tokenUrlHost: "fhir.hospital-one.test",
    });
    expect(JSON.stringify(put.body)).not.toContain(KEY_BODY);
    expect(JSON.stringify(put.body)).not.toContain(EPIC_CREDS.clientId);
    const on = await agent.patch("/api/integrations/epic-fhir").send({ enabled: true }).expect(200);
    expect(on.body.integration.status).toBe("active");

    // A partial update keeps the stored secrets it does not name.
    await agent.put("/api/integrations/epic-fhir/credentials").send({ tokenUrl: "" , baseUrl: EPIC_CREDS.baseUrl }).expect(200);
    const cfg = await epicConfigFor(ctx.storage, ctx.seedResult.orgId);
    expect(cfg).toMatchObject({ source: "organization", clientId: EPIC_CREDS.clientId });

    const del = await agent.delete("/api/integrations/epic-fhir/credentials").expect(200);
    expect(del.body.integration.status).toBe("not_configured");
    expect(await ctx.handle.db.select().from(orgIntegrationCredentials)).toHaveLength(0);
    const actions = (await audit(ctx.seedResult.orgId)).map((r) => r.action);
    expect(actions).toContain("integration.credentials_cleared");
    expect(JSON.stringify(await audit(ctx.seedResult.orgId))).not.toContain(KEY_BODY);
  });

  it("credentials leave with the organization — and nothing the panel wrote blocks the delete", async () => {
    process.env.INTEGRATION_KEY = KEY_HEX;
    Object.assign(process.env, TWILIO);
    configureIntegrations({ fetch: scripted(() => json({ status: "active" })) });
    const { org, agent } = await otherOrgWithDirector("GONE");
    await agent.put("/api/integrations/amion/credentials").send({ ocsUrl: AMION_ORG_URL }).expect(200);
    // A platform-scope test result is stored with the PLATFORM org; the tenant's
    // director running it must not leave an FK to their user there.
    await agent.post("/api/integrations/twilio-sms/test").expect(200);
    await agent.patch("/api/integrations/twilio-sms").send({ enabled: false }).expect(200);
    const of = () => ctx.handle.db.select().from(orgIntegrationCredentials).where(eq(orgIntegrationCredentials.organizationId, org.id));
    expect(await of()).toHaveLength(1);
    await ctx.storage.deleteOrganization(org.id);
    expect(await of()).toHaveLength(0);
    expect(await ctx.storage.getOrganization(org.id)).toBeUndefined();
  });
});

// ── test connection ─────────────────────────────────────────────────────────
describe("POST /api/integrations/:id/test — real, harmless, audited", () => {
  it("Twilio: GETs the account with basic auth (never sends a text); success + failure", async () => {
    Object.assign(process.env, TWILIO);
    const calls: Call[] = [];
    let status = 200;
    configureIntegrations({
      fetch: scripted((url) => (status === 200 ? json({ sid: TWILIO.TWILIO_ACCOUNT_SID, status: "active" }) : json({ code: 20003 }, status)), calls),
    });
    const agent = await director();
    const ok = await agent.post("/api/integrations/twilio-sms/test").expect(200);
    expect(ok.body).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO.TWILIO_ACCOUNT_SID}.json`);
    expect(calls[0]!.init?.method ?? "GET").toBe("GET");
    const auth = (calls[0]!.init?.headers as Record<string, string>).Authorization;
    expect(auth).toBe("Basic " + Buffer.from(`${TWILIO.TWILIO_ACCOUNT_SID}:${TWILIO.TWILIO_AUTH_TOKEN}`).toString("base64"));
    expect(calls.some((c) => c.url.includes("Messages"))).toBe(false);
    expect(JSON.stringify(ok.body)).not.toContain(TWILIO.TWILIO_AUTH_TOKEN);

    status = 401;
    const bad = await agent.post("/api/integrations/twilio-sms/test").expect(200);
    expect(bad.body).toMatchObject({ ok: false, code: "http_401" });
    expect(bad.body.integration.status).toBe("error");
    expect(bad.body.integration.lastCheck).toMatchObject({ kind: "test", ok: false });

    const rows = (await audit(ctx.seedResult.orgId)).filter((r) => r.action === "integration.test");
    expect(rows.map((r) => r.details)).toEqual([
      { integration: "twilio-sms", ok: false, code: "http_401" },
      { integration: "twilio-sms", ok: true, code: "ok" },
    ]);
    expect(JSON.stringify(rows)).not.toContain(TWILIO.TWILIO_AUTH_TOKEN);
  });

  it("times out (bounded) instead of hanging", async () => {
    Object.assign(process.env, TWILIO);
    configureIntegrations({
      timeoutMs: 50,
      fetch: ((_u: unknown, init?: RequestInit) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
        })) as typeof fetch,
    });
    const started = Date.now();
    const res = await (await director()).post("/api/integrations/twilio-sms/test").expect(200);
    expect(res.body).toMatchObject({ ok: false, code: "timeout" });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("refuses to 'test' something with no credentials (409), never pretending", async () => {
    const res = await (await director()).post("/api/integrations/twilio-sms/test").expect(409);
    expect(res.body).toMatchObject({ error: "integration_not_configured" });
  });

  it("OpenAI: GET /v1/models with the key; a needs_baa key may still be verified; 401 fails", async () => {
    process.env.OPENAI_API_KEY = OPENAI_KEY;
    const calls: Call[] = [];
    let status = 200;
    configureIntegrations({ fetch: scripted(() => (status === 200 ? json({ data: [{ id: "gpt-4o-mini" }] }) : json({}, status)), calls) });
    const agent = await director();
    const ok = await agent.post("/api/integrations/openai-intake/test").expect(200);
    expect(ok.body.ok).toBe(true);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/models");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(ok.body.integration.status).toBe("needs_baa"); // a working key is still not a BAA
    status = 401;
    const bad = await agent.post("/api/integrations/openai-intake/test").expect(200);
    expect(bad.body).toMatchObject({ ok: false, code: "http_401" });
    expect(JSON.stringify(await audit(ctx.seedResult.orgId))).not.toContain(OPENAI_KEY);
  });

  it("push: well-formed VAPID keys pass, a malformed pair fails", async () => {
    const keys = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    configureIntegrations({ runningVapidKey: () => keys.publicKey });
    const agent = await director();
    const ok = await agent.post("/api/integrations/push/test").expect(200);
    expect(ok.body.ok).toBe(true);
    // The server process is running with a different key → say so.
    configureIntegrations({ runningVapidKey: () => null });
    const notRunning = await agent.post("/api/integrations/push/test").expect(200);
    expect(notRunning.body).toMatchObject({ ok: false, code: "push_not_running" });
  });

  it("Amion: fetches the hospital's OCS URL and parses it with the real parser; failure + private-address block", async () => {
    process.env.INTEGRATION_KEY = KEY_HEX;
    const agent = await director();
    await agent.put("/api/integrations/amion/credentials").send({ ocsUrl: AMION_ORG_URL }).expect(200);
    const calls: Call[] = [];
    let mode: "ok" | "404" = "ok";
    configureIntegrations({
      fetch: scripted(() => (mode === "ok" ? new Response(AMION_HTML, { status: 200, headers: { "Content-Type": "text/html" } }) : new Response("gone", { status: 404 })), calls),
    });
    const ok = await agent.post("/api/integrations/amion/test").expect(200);
    expect(ok.body).toMatchObject({ ok: true });
    expect(ok.body.detail).toMatch(/13/);
    expect(calls[0]!.url).toBe(AMION_ORG_URL);
    expect(JSON.stringify(ok.body)).not.toContain(AMION_LOGIN);
    // A test never touches the roster.
    expect(await ctx.storage.getOrgSetting(ctx.seedResult.orgId, "amionSync")).toBeFalsy();

    mode = "404";
    const bad = await agent.post("/api/integrations/amion/test").expect(200);
    expect(bad.body).toMatchObject({ ok: false, code: "http_404" });

    // DNS that points a hospital's host at a private address is refused before any request.
    calls.length = 0;
    configureIntegrations({ lookup: async () => [{ address: "10.1.2.3", family: 4 }] });
    const blocked = await agent.post("/api/integrations/amion/test").expect(200);
    expect(blocked.body).toMatchObject({ ok: false, code: "blocked_address" });
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(await audit(ctx.seedResult.orgId))).not.toContain(AMION_LOGIN);
  });

  it("Epic: obtains an access token with the signed JWT client", async () => {
    process.env.INTEGRATION_KEY = KEY_HEX;
    const agent = await director();
    await agent.put("/api/integrations/epic-fhir/credentials").send(EPIC_CREDS).expect(200);
    const calls: Call[] = [];
    let status = 200;
    configureIntegrations({ fetch: scripted(() => (status === 200 ? json({ access_token: "tok", expires_in: 300 }) : json({}, status)), calls) });
    const ok = await agent.post("/api/integrations/epic-fhir/test").expect(200);
    expect(ok.body.ok).toBe(true);
    expect(calls[0]!.url).toBe(EPIC_CREDS.tokenUrl);
    expect(String(calls[0]!.init?.body)).toContain("client_assertion=");
    status = 400;
    const bad = await agent.post("/api/integrations/epic-fhir/test").expect(200);
    expect(bad.body).toMatchObject({ ok: false });
    expect(JSON.stringify(await audit(ctx.seedResult.orgId))).not.toContain(EPIC_CREDS.clientId);
  });
});

// ── Amion / Epic read per-org credentials before env ────────────────────────
describe("Amion / Epic — each hospital's own credentials first, env as fallback", () => {
  it("Amion: org credentials beat AMION_OCS_URL for the same org, and the loop syncs every connected org", async () => {
    process.env.INTEGRATION_KEY = KEY_HEX;
    process.env.AMION_OCS_URL = "https://www.amion.com/cgi-bin/ocs?Lo=ENV-LOGIN";
    process.env.AMION_ORG_CODE = "ISPN";
    const calls: Call[] = [];
    configureIntegrations({ fetch: scripted(() => new Response(AMION_HTML, { status: 200, headers: { "Content-Type": "text/html" } }), calls) });

    // Env only → env feed.
    expect(await amionFeedFor(ctx.storage, ctx.seedResult.orgId)).toMatchObject({ source: "env" });
    await (await director()).put("/api/integrations/amion/credentials").send({ ocsUrl: AMION_ORG_URL }).expect(200);
    expect(await amionFeedFor(ctx.storage, ctx.seedResult.orgId)).toMatchObject({ source: "organization", url: AMION_ORG_URL });

    const state = await syncAmion(ctx.storage, { orgId: ctx.seedResult.orgId });
    expect(state.lastStatus).toBe("ok");
    expect(calls.map((c) => c.url)).toEqual([AMION_ORG_URL]);

    // A second hospital connects its own feed; the scheduled loop pulls both.
    const { org, agent } = await otherOrgWithDirector();
    const otherUrl = "https://www.amion.com/cgi-bin/ocs?Lo=OTHER-LOGIN";
    await agent.put("/api/integrations/amion/credentials").send({ ocsUrl: otherUrl }).expect(200);
    calls.length = 0;
    const outcomes = await runScheduledAmionSyncAll(ctx.storage);
    expect(outcomes).toEqual(
      expect.arrayContaining([
        { orgId: ctx.seedResult.orgId, outcome: "synced" },
        { orgId: org.id, outcome: "synced" },
      ]),
    );
    expect(calls.map((c) => c.url).sort()).toEqual([AMION_ORG_URL, otherUrl].sort());
    expect(((await ctx.storage.getOrgSetting(org.id, "amionSync")) as { rowCount: number }).rowCount).toBe(13);

    // Switched off for one org → that org is skipped, the other still syncs.
    await setModule(org.id, "schedule.amion", false);
    const again = await runScheduledAmionSyncAll(ctx.storage);
    expect(again).toEqual(expect.arrayContaining([{ orgId: org.id, outcome: "skipped_module_off" }]));
  });

  it("Epic: org credentials beat EPIC_* env for the same org and drive the sync", async () => {
    process.env.INTEGRATION_KEY = KEY_HEX;
    const envFor = {
      EPIC_FHIR_BASE_URL: "https://env-epic.test/api/FHIR/R4",
      EPIC_CLIENT_ID: "env-client",
      EPIC_PRIVATE_KEY_PEM: PRIVATE_PEM,
      EPIC_TOKEN_URL: "https://env-epic.test/oauth2/token",
      EPIC_ORG_CODE: "ISPN",
    } as NodeJS.ProcessEnv;
    expect(await epicConfigFor(ctx.storage, ctx.seedResult.orgId, envFor)).toMatchObject({ source: "env", clientId: "env-client" });
    await (await director()).put("/api/integrations/epic-fhir/credentials").send(EPIC_CREDS).expect(200);
    expect(await epicConfigFor(ctx.storage, ctx.seedResult.orgId, envFor)).toMatchObject({
      source: "organization",
      clientId: EPIC_CREDS.clientId,
      tokenUrl: EPIC_CREDS.tokenUrl,
    });

    const calls: Call[] = [];
    const fetchImpl = scripted((url) => {
      if (url === EPIC_CREDS.tokenUrl) return json({ access_token: "tok-1" });
      if (url.includes("/PractitionerRole?")) return json(EPIC_BUNDLE);
      return json({}, 404);
    }, calls);
    const state = await syncEpic(ctx.storage, { orgId: ctx.seedResult.orgId, fetchImpl, env: envFor, now: () => new Date("2026-09-03T12:00:00Z") });
    expect(state.lastStatus).toBe("ok");
    expect(state.rowCount).toBe(3);
    expect(calls[0]!.url).toBe(EPIC_CREDS.tokenUrl);
    expect(calls.every((c) => !c.url.includes("env-epic.test"))).toBe(true);
    expect(JSON.stringify(await ctx.storage.getOrgSetting(ctx.seedResult.orgId, "epicSync"))).not.toContain(EPIC_CREDS.clientId);
  });
});

// ── developer overview ──────────────────────────────────────────────────────
describe("GET /api/dev/integrations — the same truth across orgs", () => {
  it("developer sees every org's status per integration (audited); directors are refused", async () => {
    Object.assign(process.env, TWILIO);
    const dev = await devAgent();
    const platformId = ctx.seedResult.platformOrgId;
    const before = (await audit(platformId)).length;
    const res = await dev.get("/api/dev/integrations").expect(200);
    expect((res.body.integrations as any[]).map((i) => i.id)).toEqual([...INTEGRATION_IDS]);
    const ispn = (res.body.orgs as any[]).find((o) => o.orgId === ctx.seedResult.orgId);
    expect(ispn.statuses["twilio-sms"]).toBe("active");
    expect(ispn.statuses["amion"]).toBe("not_configured");
    expect(JSON.stringify(res.body)).not.toContain(TWILIO.TWILIO_AUTH_TOKEN);
    expect((await audit(platformId)).length).toBe(before + 1);
    expect((await audit(platformId))[0]!.action).toBe("dev.integrations_overview");
    await (await director()).get("/api/dev/integrations").expect(403);
  });
});
