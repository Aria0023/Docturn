import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestContext } from "./helpers.js";
import { renameLegacyDemoNames } from "../server/seed.js";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

describe("demo roster rename for databases seeded earlier", () => {
  it("changes nothing on a current seed and leaves an edited name alone", async () => {
    const orgId = ctx.seedResult.orgId;
    expect(await renameLegacyDemoNames(ctx.storage, orgId)).toBe(0);

    // A name someone typed themselves is not one of the earlier seeded names.
    await ctx.storage.updateUser(ctx.seedResult.userIds.chen!, { displayName: "Dr. Edited By Hand" });
    await ctx.storage.updateOrganization(orgId, { name: "My Own Hospital" });
    expect(await renameLegacyDemoNames(ctx.storage, orgId)).toBe(0);
    expect((await ctx.storage.getUserByUsername(orgId, "chen"))!.displayName).toBe("Dr. Edited By Hand");
    expect((await ctx.storage.getOrganization(orgId))!.name).toBe("My Own Hospital");
  });
});
