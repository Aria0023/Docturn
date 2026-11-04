import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createTestApp, type TestContext } from "./helpers.js";

/**
 * Universal links (iOS) and App Links (Android) for the native shell
 * (mobile-app/): the two association files the platforms fetch from the web
 * host. Both are built from the environment at request time and answer 404
 * when it is not set — never a placeholder, because Apple's CDN and Android's
 * verifier cache what they fetch and a wrong team id or fingerprint silently
 * breaks every /messages/* link on a phone that has the app installed.
 */
const ENV = ["APPLE_TEAM_ID", "IOS_BUNDLE_ID", "ANDROID_PACKAGE", "ANDROID_SHA256_CERT_FINGERPRINTS"] as const;
const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};
const FP1 = Array.from({ length: 32 }, (_, i) => (i * 7 + 3).toString(16).padStart(2, "0")).join(":");
const FP2 = Array.from({ length: 32 }, (_, i) => (255 - i * 5).toString(16).padStart(2, "0")).join(":");

describe("/.well-known association files for the native shell", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
    ctx = await createTestApp();
  });
  afterEach(() => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  it("answers 404 JSON (not the SPA shell, never a placeholder) while the environment is unset", async () => {
    for (const path of ["/.well-known/apple-app-site-association", "/.well-known/assetlinks.json"]) {
      const res = await supertest(ctx.app).get(path);
      expect(res.status, path).toBe(404);
      expect(res.headers["content-type"], path).toMatch(/application\/json/);
      expect(res.body, path).toEqual({ error: "not_configured" });
      expect(res.text, path).not.toMatch(/<html|<!doctype/i);
      expect(res.text, path).not.toMatch(/TEAMID|REPLACE|example/i);
    }
  });

  it("serves the AASA as application/json on the extensionless path once the team id and bundle id are set", async () => {
    process.env.APPLE_TEAM_ID = "ABCDE12345";
    process.env.IOS_BUNDLE_ID = "com.docturn.app";
    const res = await supertest(ctx.app).get("/.well-known/apple-app-site-association");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.body).toEqual({
      applinks: {
        details: [{
          appIDs: ["ABCDE12345.com.docturn.app"],
          components: [
            { "/": "/messages/*", comment: "A thread (the shell opens it after sign-in)" },
            { "/": "/", "?": { open: "*" }, comment: "Open the app on a section (e.g. ?open=messages)" },
          ],
        }],
      },
      webcredentials: { apps: ["ABCDE12345.com.docturn.app"] },
    });
    // Android stays unconfigured — the two files are independent.
    expect((await supertest(ctx.app).get("/.well-known/assetlinks.json")).status).toBe(404);
  });

  it("a half-set iOS pair is still 404 (no partial file)", async () => {
    process.env.APPLE_TEAM_ID = "ABCDE12345";
    expect((await supertest(ctx.app).get("/.well-known/apple-app-site-association")).status).toBe(404);
    delete process.env.APPLE_TEAM_ID;
    process.env.IOS_BUNDLE_ID = "com.docturn.app";
    expect((await supertest(ctx.app).get("/.well-known/apple-app-site-association")).status).toBe(404);
  });

  it("serves assetlinks.json with every fingerprint normalised, and refuses a malformed one", async () => {
    process.env.ANDROID_PACKAGE = "com.docturn.app";
    process.env.ANDROID_SHA256_CERT_FINGERPRINTS = ` ${FP1} ,${FP2.toLowerCase()}`;
    const res = await supertest(ctx.app).get("/.well-known/assetlinks.json");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.body).toEqual([{
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.docturn.app",
        sha256_cert_fingerprints: [FP1.toUpperCase(), FP2.toUpperCase()],
      },
    }]);
    expect((await supertest(ctx.app).get("/.well-known/apple-app-site-association")).status).toBe(404);

    process.env.ANDROID_SHA256_CERT_FINGERPRINTS = "not-a-fingerprint";
    expect((await supertest(ctx.app).get("/.well-known/assetlinks.json")).status).toBe(404);
    process.env.ANDROID_SHA256_CERT_FINGERPRINTS = FP1;
    delete process.env.ANDROID_PACKAGE;
    expect((await supertest(ctx.app).get("/.well-known/assetlinks.json")).status).toBe(404);
  });

  it("is public (no session) and cacheable for a short time, like any other well-known file", async () => {
    process.env.APPLE_TEAM_ID = "ABCDE12345";
    process.env.IOS_BUNDLE_ID = "com.docturn.app";
    const res = await supertest(ctx.app).get("/.well-known/apple-app-site-association");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toMatch(/max-age=\d+/);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});
