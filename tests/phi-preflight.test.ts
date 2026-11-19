import { describe, expect, it } from "vitest";
import { moduleDefaults } from "@shared/modules";
import { enforceRealPhiPreflight, phiPreflightOverridden, realPhiPreflight } from "../server/phi-preflight.js";

/**
 * Real-PHI preflight (HIPAA audit, 2026-11). SYNTHETIC_DATA=false declares
 * real patient data; the server must not start in that mode on the
 * unencrypted demo database, without Secure cookies, with a throwaway session
 * secret, with login rate limiting off or with no credential-vault key.
 */

const GOOD = {
  SYNTHETIC_DATA: "false",
  DATABASE_URL: "postgres://u:p@db.internal:5432/docturn",
  NODE_ENV: "production",
  SESSION_SECRET: "x".repeat(48),
  INTEGRATION_KEY: "a".repeat(64),
};

describe("real-PHI preflight", () => {
  it("synthetic mode (the default and the demo) is never held up", () => {
    expect(realPhiPreflight({})).toEqual([]);
    expect(realPhiPreflight({ SYNTHETIC_DATA: "true", RATE_LIMIT: "off" })).toEqual([]);
  });

  it("a complete real-PHI configuration passes", () => {
    expect(realPhiPreflight(GOOD)).toEqual([]);
  });

  it("names every missing safeguard, each with its rule", () => {
    const problems = realPhiPreflight({ SYNTHETIC_DATA: "false", RATE_LIMIT: "off", SESSION_SECRET: "short" });
    expect(problems.map((p) => p.id).sort()).toEqual(["database", "integration-key", "rate-limit", "session-secret", "transport"]);
    for (const p of problems) expect(p.rule).toMatch(/45 CFR §164\./);
  });

  it.each([
    ["database", { DATABASE_URL: undefined }],
    ["transport", { NODE_ENV: "development" }],
    ["session-secret", { SESSION_SECRET: "y".repeat(31) }],
    ["rate-limit", { RATE_LIMIT: "off" }],
    ["integration-key", { INTEGRATION_KEY: "  " }],
  ])("one gap is one problem: %s", (id, patch) => {
    expect(realPhiPreflight({ ...GOOD, ...patch }).map((p) => p.id)).toEqual([id]);
  });

  it("refuses to start, printing the problems — and never a secret's value", () => {
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errors.push(a.join(" ")); };
    let code: number | null = null;
    try {
      enforceRealPhiPreflight({ ...GOOD, SESSION_SECRET: "hunter2-hunter2", DATABASE_URL: undefined }, ((c: number) => { code = c; }) as never);
    } finally {
      console.error = orig;
    }
    expect(code).toBe(1);
    const out = errors.join("\n");
    expect(out).toContain("REFUSING TO START");
    expect(out).toContain("database");
    expect(out).toContain("session-secret");
    expect(out).not.toContain("hunter2");
  });

  it("the lab hatch starts with a warning, and is ignored in production", () => {
    const lab = { SYNTHETIC_DATA: "false", PHI_PREFLIGHT_OVERRIDE: "not-compliant" };
    expect(phiPreflightOverridden(lab)).toBe(true);
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => { warns.push(a.join(" ")); };
    let code: number | null = null;
    try {
      enforceRealPhiPreflight(lab, ((c: number) => { code = c; }) as never);
    } finally {
      console.warn = orig;
    }
    expect(code).toBeNull();
    expect(warns.join("\n")).toContain("NOT fit for real PHI");

    const prod = { ...lab, NODE_ENV: "production" };
    expect(phiPreflightOverridden(prod)).toBe(false);
    let prodCode: number | null = null;
    const origErr = console.error;
    console.error = () => {};
    try {
      enforceRealPhiPreflight(prod, ((c: number) => { prodCode = c; }) as never);
    } finally {
      console.error = origErr;
    }
    expect(prodCode).toBe(1);
    // Any other value of the hatch is not the hatch.
    expect(phiPreflightOverridden({ SYNTHETIC_DATA: "false", PHI_PREFLIGHT_OVERRIDE: "1" })).toBe(false);
  });
});

describe("MFA for privileged roles follows the data the instance carries", () => {
  const withEnv = <T>(patch: Record<string, string | undefined>, fn: () => T): T => {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(patch)) { saved[k] = process.env[k]; if (patch[k] === undefined) delete process.env[k]; else process.env[k] = patch[k]; }
    try { return fn(); } finally {
      for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  };

  it("is off by default on a synthetic instance and ON by default in real-PHI mode", () => {
    expect(withEnv({ SYNTHETIC_DATA: undefined, PHI_PREFLIGHT_OVERRIDE: undefined }, () => moduleDefaults()["security.mfaRequired"])).toBe(false);
    expect(withEnv({ SYNTHETIC_DATA: "false", PHI_PREFLIGHT_OVERRIDE: undefined }, () => moduleDefaults()["security.mfaRequired"])).toBe(true);
  });

  it("the lab hatch keeps the synthetic default", () => {
    expect(
      withEnv({ SYNTHETIC_DATA: "false", PHI_PREFLIGHT_OVERRIDE: "not-compliant", NODE_ENV: "test" }, () => moduleDefaults()["security.mfaRequired"]),
    ).toBe(false);
  });
});
