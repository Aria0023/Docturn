import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * A.CON-SHO-68 (server half). A device's Web Push subscription is ONE row keyed
 * by its token. Signing out removes it (DELETE by the owner), and when the same
 * subscription is registered again by another account — e.g. a clinician of a
 * different organization signs in on the shared device after the previous
 * session merely expired — the row moves to that account AND its organization,
 * never keeping the previous tenant's organizationId.
 */

const sub = (n: string) =>
  JSON.stringify({ endpoint: "https://push.example/send/" + n, expirationTime: null, keys: { p256dh: "BKey" + n, auth: "auth" + n } });

describe("device tokens (web push)", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it("re-registering a token from another tenant's account moves userId AND organizationId", async () => {
    const token = sub("shared-device");
    const { agent: dev } = await login(ctx.app, { username: "dev", orgCode: "DOCTURN" });
    expect((await dev.post("/api/mobile/device-tokens").send({ token, platform: "webpush" })).status).toBe(201);
    const devId = ctx.seedResult.userIds.dev!;
    const before = await ctx.storage.listDeviceTokens(devId);
    expect(before).toHaveLength(1);
    const platformOrg = before[0]!.organizationId;

    const { agent: chen } = await login(ctx.app, { username: "chen" });
    expect((await chen.post("/api/mobile/device-tokens").send({ token, platform: "webpush" })).status).toBe(201);
    const chenId = ctx.seedResult.userIds.chen!;
    const rows = await ctx.storage.listDeviceTokens(chenId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organizationId).toBe(ctx.seedResult.orgId);
    expect(rows[0]!.organizationId).not.toBe(platformOrg);
    expect(await ctx.storage.listDeviceTokens(devId)).toHaveLength(0);
  });

  it("sign-out removal: the owner deletes its token; another account cannot", async () => {
    const token = sub("phone-1");
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.post("/api/mobile/device-tokens").send({ token, platform: "webpush" });
    const chenId = ctx.seedResult.userIds.chen!;

    const { agent: patel } = await login(ctx.app, { username: "patel" });
    expect((await patel.delete("/api/mobile/device-tokens/" + encodeURIComponent(token))).status).toBe(204);
    expect(await ctx.storage.listDeviceTokens(chenId)).toHaveLength(1);

    // The exact call the web client makes on sign-out (JSON subscription, URI-encoded).
    expect((await chen.delete("/api/mobile/device-tokens/" + encodeURIComponent(token))).status).toBe(204);
    expect(await ctx.storage.listDeviceTokens(chenId)).toHaveLength(0);
  });
});
