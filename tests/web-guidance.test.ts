/**
 * Web-platform hardening:
 *   - the live connection refuses a page on another origin
 *   - the public website is served under a policy with no inline script
 */
import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import supertest from "supertest";
import { createTestApp } from "./helpers.js";
import { originAllowed } from "../server/ws/index.js";

const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;

describe("live connection origin", () => {
  it("admits the app's own page and clients that are not browsers", () => {
    expect(originAllowed(req({ host: "docturn.example" }))).toBe(true);
    expect(originAllowed(req({ host: "docturn.example", origin: "https://docturn.example" }))).toBe(true);
    expect(originAllowed(req({ host: "127.0.0.1:5000", origin: "http://127.0.0.1:5000" }))).toBe(true);
    expect(originAllowed(req({ host: "10.0.0.4:10000", "x-forwarded-host": "docturn.example", origin: "https://docturn.example" }))).toBe(true);
  });

  it("refuses another site, a look-alike host and a malformed origin", () => {
    expect(originAllowed(req({ host: "docturn.example", origin: "https://evil.example" }))).toBe(false);
    expect(originAllowed(req({ host: "docturn.example", origin: "https://docturn.example.evil.test" }))).toBe(false);
    expect(originAllowed(req({ host: "docturn.example", origin: "https://docturn.example:8443" }))).toBe(false);
    expect(originAllowed(req({ host: "docturn.example", origin: "null" }))).toBe(false);
    expect(originAllowed(req({ host: "docturn.example", origin: "not a url" }))).toBe(false);
  });

  it("admits an extra host only when it is listed", () => {
    const r = req({ host: "internal:10000", origin: "https://app.hospital.example" });
    expect(originAllowed(r)).toBe(false);
    process.env.WS_ALLOWED_ORIGINS = "other.example, app.hospital.example";
    try {
      expect(originAllowed(r)).toBe(true);
    } finally {
      delete process.env.WS_ALLOWED_ORIGINS;
    }
  });
});

describe("page policies", () => {
  it("serves the website with no inline script allowed, and its script as a file", async () => {
    const ctx = await createTestApp();
    const app = ctx.app;
    try {
    const home = await supertest(app).get("/home");
    expect(home.status).toBe(200);
    const csp = String(home.headers["content-security-policy"]);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("base-uri 'self'");
    expect(home.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(home.text).not.toMatch(/\son[a-z]+="/i);
    expect(home.text).toContain('<script src="/site/site.js" defer></script>');
    const js = await supertest(app).get("/site/site.js");
    expect(js.status).toBe(200);
    expect(String(js.headers["content-type"])).toMatch(/javascript/);
    } finally {
      await ctx.handle.close();
    }
  });
});
