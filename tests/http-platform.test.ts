import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatWithOptions } from "node:util";
import type { Request } from "express";
import { sql } from "drizzle-orm";
import { createTestApp, login, type TestContext, DEV_PASSWORD } from "./helpers.js";
import { createApp } from "../server/app.js";
import { createDb } from "../server/db.js";
import {
  ACCOUNT_RATE_LIMIT,
  AUTH_RATE_LIMIT,
  PERMISSIONS_POLICY,
  clientIpKey,
  getSessionStoreState,
  resolveTrustProxy,
} from "../server/config.js";
import { parseId } from "../server/params.js";
import { createSessionStore } from "../server/session-store.js";
import { probeSecurityHeaders } from "../server/compliance/checks.js";
import { CONTROLS } from "../server/compliance/controls.js";
import { installLogScrubber, loggableError } from "../server/log-safe.js";

/**
 * HTTP platform behaviour (server/app.ts, config.ts, index.ts, health.ts):
 *
 *  SHO-19  a rejected promise in an async handler → 500 JSON, never a hang
 *  SHO-24  body-parser 4xx honoured (400 malformed JSON / 413 too large)
 *  SHO-35  …and the request body is never logged
 *  SHO-34  every numeric :id param validated once → 404 JSON, never a hang
 *  MIN-5   unknown /api/* and /ws → JSON 404
 *  SHO-36  Content-Security-Policy + Permissions-Policy emitted
 *  SHO-13  rate limiter keys on the REAL client IP: X-Forwarded-For is only
 *          believed from the trusted proxy peer, one hop; per-account budget
 *  SHO-17  session store: connect-pg-simple with DATABASE_URL, memory otherwise
 *  MIN-2   production login over non-HTTPS → 400 insecure_transport
 *  SHO-6   /api/health and the encryption-at-rest control describe the store
 */

const RESPOND = { response: 5000, deadline: 8000 };
const PHI_MARKER = "PHI-MARKER-JOHN-DOE-MRN-123456";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await ctx.handle.close();
});

/**
 * Every console.* call, rendered exactly the way Node's console renders it
 * (util.format → util.inspect: message, stack, own properties AND the `cause`
 * chain), only deeper and with no string truncation — so a value hiding
 * anywhere in a logged error is found.
 */
function loggedText(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls
    .map((args) => formatWithOptions({ depth: 20, maxStringLength: Infinity, maxArrayLength: Infinity }, ...args))
    .join("\n");
}

describe("SHO-19 async handler rejections reach the JSON error middleware", () => {
  it("a rejected promise in a real route answers 500 {error:internal_error} and the app keeps serving", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // GET /api/hospitalists is a plain `async (req, res) => res.json(await …)`
    // handler with no try/catch — exactly the shape the audit counted 133 of.
    const original = ctx.storage.listHospitalists.bind(ctx.storage);
    ctx.storage.listHospitalists = async () => {
      throw new Error("simulated database failure");
    };
    try {
      const res = await agent.get("/api/hospitalists").timeout(RESPOND);
      expect(res.status).toBe(500);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: "internal_error" });
      // …and it was logged as a server fault, not swallowed.
      expect(loggedText(errorSpy)).toContain("simulated database failure");
    } finally {
      ctx.storage.listHospitalists = original;
    }

    // The process (and this app) is still up and serving.
    const ok = await agent.get("/api/hospitalists").timeout(RESPOND);
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body)).toBe(true);
  });

  it("a rejection with a non-Error value is still answered", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const original = ctx.storage.listHospitalists.bind(ctx.storage);
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    ctx.storage.listHospitalists = async () => Promise.reject("plain string rejection");
    try {
      const res = await agent.get("/api/hospitalists").timeout(RESPOND);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "internal_error" });
    } finally {
      ctx.storage.listHospitalists = original;
    }
  });
});

describe("SHO-24 / SHO-35 body-parser errors are 4xx and never logged with the body", () => {
  it("malformed JSON → 400 invalid_json, logs the classification only", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await supertest(ctx.app)
      .post("/api/login")
      .set("content-type", "application/json")
      .send(`{"orgCode":"ISPN","username":"${PHI_MARKER}", nope`)
      .timeout(RESPOND);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_json" });
    // Logged as a client warning (no error-level line), with status + type and
    // NOTHING from the request body — neither err.body nor JSON.parse's quoted
    // excerpt may reach the log.
    expect(errorSpy).not.toHaveBeenCalled();
    const text = loggedText(warnSpy);
    expect(text).toContain("entity.parse.failed");
    expect(text).toContain("400");
    expect(text).not.toContain(PHI_MARKER);
    expect(text).not.toContain("nope");
  });

  it("over-limit body on an ordinary route → 413 payload_too_large (global 1 MB parser)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await supertest(ctx.app)
      .post("/api/login")
      .set("content-type", "application/json")
      .send({ orgCode: "ISPN", username: "chen", password: "x".repeat(1_100_000) })
      .timeout(RESPOND);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "payload_too_large" });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("over-limit attachment upload → 413 payload_too_large (route-level 12 MB parser)", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await agent
      .post("/api/messaging/attachments")
      .set("content-type", "application/json")
      .send({ fileName: "big.bin", mimeType: "application/octet-stream", dataBase64: "A".repeat(13 * 1024 * 1024) })
      .timeout({ response: 15000, deadline: 20000 });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "payload_too_large" });
  });

  it("other http-errors statuses are honoured (bad percent-encoding in a path → 400)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await supertest(ctx.app).get("/api/cms/%E0%A4%A").timeout(RESPOND);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "bad_request" });
  });
});

describe("SHO-35 a 5xx log line carries no request value", () => {
  const MRN = "MRN-PHIMARKER7";

  it("a database failure on a PHI-bearing write → 500, and neither the bound params nor the Postgres detail reach the log", async () => {
    const { agent } = await login(ctx.app, { username: "er.doc" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Force a REAL foreign-key violation on the patient insert. Drizzle's
    // DrizzleQueryError message is "Failed query: …\nparams: <every bound
    // value>", and the Postgres error's `detail` quotes the offending key.
    const original = ctx.storage.createPatient.bind(ctx.storage);
    ctx.storage.createPatient = (p) => original({ ...p, organizationId: 2_000_000_000 });
    try {
      const res = await agent
        .post("/api/patients")
        .send({ initials: "JS", issueSummary: `${PHI_MARKER} John Smith chest pain`, ehrId: MRN })
        .timeout(RESPOND);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "internal_error" });
    } finally {
      ctx.storage.createPatient = original;
    }
    const text = loggedText(errorSpy) + loggedText(warnSpy);
    expect(text).not.toContain(PHI_MARKER);
    expect(text).not.toContain("John Smith");
    expect(text).not.toContain(MRN);
    expect(text).not.toContain("2000000000");
    expect(text).not.toMatch(/params:\s*\S/);
    // …but what is needed to debug it survives: the kind of failure, the
    // SQLSTATE, the table/constraint, the parameterised SQL and the frames.
    expect(text).toContain("DrizzleQueryError");
    expect(text).toContain("23503");
    expect(text).toContain("foreign_key_violation");
    expect(text).toContain("patients_organization_id");
    expect(text).toMatch(/insert into "patients"/);
    expect(text).toMatch(/\n\s+at .+/);
  });

  it("a Postgres message that quotes the offending value is logged with the value redacted", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = ctx.storage.listHospitalists.bind(ctx.storage);
    // `invalid input syntax for type integer: "<value>"` (SQLSTATE 22P02).
    ctx.storage.listHospitalists = async () => {
      await ctx.handle.db.execute(sql`select ${PHI_MARKER}::integer`);
      return [];
    };
    try {
      const res = await agent.get("/api/hospitalists").timeout(RESPOND);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "internal_error" });
    } finally {
      ctx.storage.listHospitalists = original;
    }
    const text = loggedText(errorSpy);
    expect(text).not.toContain(PHI_MARKER);
    expect(text).toContain("22P02");
    expect(text).toContain("invalid input syntax for type integer");
  });

  it("loggableError keeps the debugging facts and drops every value-bearing field", () => {
    const pg = Object.assign(new Error(`duplicate key value violates unique constraint "patients_ehr_id_key"`), {
      name: "error",
      severity: "ERROR",
      code: "23505",
      detail: `Key (ehr_id)=(${MRN}) already exists.`,
      where: `unnamed portal parameter $1 = '${MRN}'`,
      hint: MRN,
      internalQuery: `select '${MRN}'`,
      table: "patients",
      constraint: "patients_ehr_id_key",
      routine: "_bt_check_unique",
    });
    const drizzle = Object.assign(
      new Error(`Failed query: insert into "patients" ("ehr_id") values ($1)\nparams: ${MRN},${PHI_MARKER}`),
      { query: `insert into "patients" ("ehr_id", "note") values ($1, '${PHI_MARKER}')`, params: [MRN, PHI_MARKER], cause: pg },
    );
    const body = Object.assign(new Error("Unexpected token"), { body: `{"note":"${PHI_MARKER}"}`, status: 500 });
    // A quoted value that itself contains quotes and a fake stack frame line.
    const tricky = Object.assign(
      new Error(`invalid input syntax for type integer: "a"b\n    at ${PHI_MARKER} (x.ts:1:1)\n"c"`),
      { code: "22P02", severity: "ERROR" },
    );
    for (const err of [drizzle, pg, body, tricky, new Error("wrapped", { cause: drizzle }), `${PHI_MARKER} as a bare string`]) {
      const text = formatWithOptions({ depth: 20, maxStringLength: Infinity }, loggableError(err));
      expect(text).not.toContain(PHI_MARKER);
      expect(text).not.toContain(MRN);
    }
    const text = formatWithOptions({ depth: 20 }, loggableError(drizzle));
    expect(text).toContain("23505");
    expect(text).toContain("unique_violation");
    expect(text).toContain("patients_ehr_id_key");
    expect(text).toContain(`insert into "patients" ("ehr_id", "note") values ($1, '…')`);
    expect(text).toContain("paramCount: 2");
    // An ordinary programming error keeps its message and frames.
    const plain = formatWithOptions({}, loggableError(new TypeError("Cannot read properties of undefined (reading 'id')")));
    expect(plain).toContain("TypeError: Cannot read properties of undefined (reading 'id')");
    expect(plain).toMatch(/\n\s+at .+/);
  });

  it("the process-wide scrubber sanitises errors logged by ANY module (background sweeps, route catches)", () => {
    const sink: unknown[][] = [];
    const fake = {
      error: (...a: unknown[]) => sink.push(a),
      warn: (...a: unknown[]) => sink.push(a),
      log: (...a: unknown[]) => sink.push(a),
      info: (...a: unknown[]) => sink.push(a),
      debug: (...a: unknown[]) => sink.push(a),
    } as unknown as Console;
    const uninstall = installLogScrubber(fake);
    try {
      installLogScrubber(fake); // idempotent
      const err = Object.assign(new Error(`Failed query: insert into "messages" ("body") values ($1)\nparams: ${PHI_MARKER}`), {
        query: `insert into "messages" ("body") values ($1)`,
        params: [PHI_MARKER],
      });
      fake.error("[escalation] sweep failed", err);
      fake.warn("[x]", { status: 400 });
      const text = sink.map((a) => formatWithOptions({ depth: 20 }, ...a)).join("\n");
      expect(text).toContain("[escalation] sweep failed");
      expect(text).toContain(`insert into "messages"`);
      expect(text).not.toContain(PHI_MARKER);
      // Non-error arguments pass through untouched.
      expect(sink[1]).toEqual(["[x]", { status: 400 }]);
      expect(sink).toHaveLength(2);
    } finally {
      uninstall();
    }
  });
});

describe("SHO-35 a NUL byte in input is a 400, never a 500", () => {
  it("anywhere in a JSON body or the query string → 400 validation_error before any handler runs", async () => {
    const { agent } = await login(ctx.app, { username: "er.doc" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = (await agent.get("/api/patients").timeout(RESPOND)).body.length;
    for (const body of [
      { initials: "JS", issueSummary: `${PHI_MARKER} John Smith chest pain\u0000`, ehrId: "MRN-PHIMARKER7" },
      { initials: "JS", nested: { tags: ["ok", `x\u0000${PHI_MARKER}`] } },
      { initials: "JS", [`k\u0000${PHI_MARKER}`]: 1 },
    ]) {
      const res = await agent.post("/api/patients").send(body).timeout(RESPOND);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "validation_error" });
    }
    const q = await agent.get(`/api/patients?search=${encodeURIComponent(`${PHI_MARKER}\u0000`)}`).timeout(RESPOND);
    expect(q.status).toBe(400);
    expect(q.body).toEqual({ error: "validation_error" });
    // Nothing was written, nothing logged at error level, no value in the log.
    expect((await agent.get("/api/patients").timeout(RESPOND)).body.length).toBe(before);
    expect(errorSpy).not.toHaveBeenCalled();
    const text = loggedText(warnSpy);
    expect(text).toContain("input.nul_byte");
    expect(text).not.toContain(PHI_MARKER);
  });

  it("a NUL that reaches Postgres by another path (route-level parser, path param) is a 400 too", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // NUL in the path: refused up front, before the router decodes it into a lookup.
    const org = await supertest(ctx.app).get("/api/mobile/org/IS%00PN").timeout(RESPOND);
    expect(org.status).toBe(400);
    expect(org.body).toEqual({ error: "validation_error" });
    // The attachment upload mounts its own 12 MB parser, after the global guard.
    const { agent } = await login(ctx.app, { username: "chen" });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ).toString("base64");
    const up = await agent
      .post("/api/messaging/attachments")
      .send({ fileName: `scan\u0000${PHI_MARKER}.png`, mimeType: "image/png", dataBase64: png })
      .timeout(RESPOND);
    expect(up.status).toBe(400);
    expect(up.body).toEqual({ error: "validation_error" });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("SHO-34 numeric :id params are validated once, before any route", () => {
  const BAD = ["abc", "1.5", "-1", "0", "1e3", "99999999999", "%20", "1abc"];
  const ROUTES: Array<[method: "get" | "post" | "patch" | "delete", path: (id: string) => string]> = [
    ["get", (id) => `/api/patients/${id}/consults`],
    ["delete", (id) => `/api/messaging/messages/${id}`],
    ["post", (id) => `/api/assignments/${id}/accept`],
    ["get", (id) => `/api/dev/organizations/${id}/settings`],
    ["patch", (id) => `/api/consults/${id}`],
    ["post", (id) => `/api/broadcasts/${id}/ack`],
    ["get", (id) => `/api/messaging/messages/7/attachments/${id}`],
    ["get", (id) => `/api/care-team/of/${id}`],
    ["get", (id) => `/api/dev/modules/${id}`],
  ];

  it("parseId accepts only plain positive integers that fit a Postgres integer", () => {
    expect(parseId("1")).toBe(1);
    expect(parseId("2147483647")).toBe(2147483647);
    expect(parseId(42)).toBe(42);
    for (const bad of [...BAD, "2147483648", " 7", "7 ", "", "+1", "0x10", undefined, null, 1.5, -2, NaN]) {
      expect(parseId(bad), `parseId(${JSON.stringify(bad)})`).toBeNull();
    }
  });

  it("every malformed id answers 404 {error:not_found} promptly, authenticated or not", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    for (const [method, path] of ROUTES) {
      for (const id of BAD) {
        const anon = await supertest(ctx.app)[method](path(id)).timeout(RESPOND);
        expect(anon.status, `anon ${method.toUpperCase()} ${path(id)}`).toBe(404);
        expect(anon.body).toEqual({ error: "not_found" });
        const authed = await agent[method](path(id)).send({}).timeout(RESPOND);
        expect(authed.status, `director ${method.toUpperCase()} ${path(id)}`).toBe(404);
        expect(authed.body).toEqual({ error: "not_found" });
      }
    }
  }, 60_000);

  it("string params are untouched by the guard", async () => {
    const org = await supertest(ctx.app).get("/api/mobile/org/ISPN").timeout(RESPOND);
    expect(org.status).toBe(200);
    expect(org.body.code).toBe("ISPN");
    // The guard runs BEFORE requireAuth, so if it intercepted a string param
    // an anonymous request would get its 404; an untouched route answers 401.
    for (const [m, p] of [
      ["get", "/api/compliance/policies/no-such-policy"],
      ["delete", "/api/mobile/device-tokens/not-a-number"],
      ["get", "/api/cms/landing"],
      // `:id` here is a generated STRING slot id (exempted in STRING_ID_PATHS).
      ["patch", "/api/oncall/manual/nope"],
      ["delete", "/api/oncall/manual/slot-abc"],
    ] as const) {
      const res = await supertest(ctx.app)[m](p).timeout(RESPOND);
      expect(res.body.error, `${m} ${p}`).not.toBe("not_found");
      expect([401, 404]).toContain(res.status); // 401 unauthorized or 404 module_disabled (module gate)
    }
    // …and a non-director reaching the manual-slot route gets the ROUTE's 403.
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const slot = await chen.patch("/api/oncall/manual/nope").send({ hours: "7a-7p" }).timeout(RESPOND);
    expect(slot.status).toBe(403);
    expect(slot.body).toEqual({ error: "forbidden" });
  });

  it("ids taken from a request BODY (dev impersonate / manage-org) are validated too: malformed → 400, unknown → 404", async () => {
    const { agent, res: signedIn } = await login(ctx.app, { orgCode: "DOCTURN", username: "dev" });
    expect(signedIn.status).toBe(200);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const BAD_BODY_IDS: unknown[] = ["abc", "", 1.5, -1, 0, 99999999999, "1e3", " 7", null, true, [], {}, "2147483648"];
    for (const [path, field] of [
      ["/api/dev/impersonate", "userId"],
      ["/api/dev/manage-org", "orgId"],
    ] as const) {
      for (const bad of BAD_BODY_IDS) {
        const res = await agent.post(path).send({ [field]: bad }).timeout(RESPOND);
        expect(res.status, `${path} ${field}=${JSON.stringify(bad)}`).toBe(400);
        expect(res.body).toEqual({ error: "validation_error" });
      }
      const missing = await agent.post(path).send({}).timeout(RESPOND);
      expect(missing.status, `${path} {}`).toBe(400);
      expect(missing.body).toEqual({ error: "validation_error" });
      // Well-formed but nonexistent: the route's own 404.
      const unknown = await agent.post(path).send({ [field]: 2147483647 }).timeout(RESPOND);
      expect(unknown.status, `${path} unknown`).toBe(404);
      expect(unknown.body).toEqual({ error: "not_found" });
    }
    // The developer's create-user body names its org by id too.
    for (const organizationId of [99999999999, 2147483648]) {
      const res = await agent
        .post("/api/dev/users")
        .send({ organizationId, role: "hospitalist", displayName: "Dr. Range", username: "range.check" })
        .timeout(RESPOND);
      expect(res.status, `create-user organizationId=${organizationId}`).toBe(400);
      expect(res.body).toEqual({ error: "validation_error" });
    }
    // No request reached the database with NaN / an out-of-range integer.
    expect(errorSpy).not.toHaveBeenCalled();
    // The session is still the developer's (nothing was swapped).
    expect((await agent.get("/api/user").timeout(RESPOND)).body.username).toBe("dev");
  });

  it("a well-formed id still flows through to the route", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    // Nonexistent-but-valid id: the ROUTE answers, not the guard.
    const res = await agent.delete("/api/messaging/messages/2147483647").timeout(RESPOND);
    expect([403, 404]).toContain(res.status);
    expect(res.body.error).toBeDefined();
  });
});

describe("MIN-5 unknown API / WS paths answer JSON 404", () => {
  it("GET /api/nope/here → 404 {error:not_found} as JSON", async () => {
    const res = await supertest(ctx.app).get("/api/nope/here").timeout(RESPOND);
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: "not_found" });
  });
  it("other methods and /ws over plain HTTP too", async () => {
    for (const [m, p] of [
      ["post", "/api/does-not-exist"],
      ["put", "/api"],
      ["get", "/ws"],
      ["get", "/ws/anything"],
      ["get", "/api/"],
    ] as const) {
      const res = await supertest(ctx.app)[m](p).timeout(RESPOND);
      expect(res.status, `${m} ${p}`).toBe(404);
      expect(res.body, `${m} ${p}`).toEqual({ error: "not_found" });
    }
    // Known routes are unaffected (the catch-all is registered AFTER them).
    expect((await supertest(ctx.app).get("/api/config")).status).toBe(200);
    // Non-API paths still fall back to the SPA shell, not the JSON 404.
    const spa = await supertest(ctx.app).get("/some/client/route");
    expect(spa.status).toBe(200);
    expect(spa.headers["content-type"]).toMatch(/text\/html/);
  });
});

describe("SHO-36 Content-Security-Policy and Permissions-Policy", () => {
  it("the SPA shell and API responses carry the policy the client runs under", async () => {
    for (const path of ["/", "/api/config", "/sw.js"]) {
      const res = await supertest(ctx.app).get(path);
      const csp = res.headers["content-security-policy"];
      expect(csp, path).toBeDefined();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self' 'unsafe-inline'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'self'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("media-src 'self' blob:");
      expect(csp).toContain("img-src 'self' data: blob:");
      expect(csp).toContain("worker-src 'self'");
      // Same-origin WebSocket only, derived from the request's own Host.
      expect(csp).toMatch(/connect-src 'self' ws:\/\/127\.0\.0\.1:\d+ wss:\/\/127\.0\.0\.1:\d+/);
      // Would break plain-http dev/trial access from a phone or tunnel.
      expect(csp).not.toContain("upgrade-insecure-requests");
      expect(res.headers["permissions-policy"]).toBe(PERMISSIONS_POLICY);
      expect(res.headers["permissions-policy"]).toContain("microphone=(self)");
      expect(res.headers["permissions-policy"]).toContain("camera=()");
    }
  });

  it("the compliance probe sees the SAME middleware emit both headers", async () => {
    const probed = probeSecurityHeaders();
    expect(probed["content-security-policy"]).toContain("default-src 'self'");
    expect(probed["permissions-policy"]).toBe(PERMISSIONS_POLICY);
    expect(probed["strict-transport-security"]).toBeDefined();
    const { agent } = await login(ctx.app, { username: "director" });
    const status = await agent.get("/api/compliance/status");
    expect(status.status).toBe(200);
    const tx = (status.body.controls as Array<{ id: string; evidence: { headersEmitted: string[] } }>).find(
      (c) => c.id === "transmission-security",
    );
    expect(tx?.evidence.headersEmitted).toContain("content-security-policy");
    expect(tx?.evidence.headersEmitted).toContain("permissions-policy");
  });
});

describe("SHO-13 rate limiter keys on the real client address", () => {
  // A validation-error login (empty body) is a FAILED auth attempt the auth
  // limiter counts, without the scrypt cost of a wrong password.
  async function failedLogins(
    app: ReturnType<typeof createApp>,
    n: number,
    xff: (i: number) => string | undefined,
  ) {
    const statuses: number[] = [];
    for (let i = 0; i < n; i++) {
      let req = supertest(app).post("/api/login").set("content-type", "application/json");
      const header = xff(i);
      if (header) req = req.set("X-Forwarded-For", header);
      const res = await req.send({}).timeout(RESPOND);
      statuses.push(res.status);
    }
    return statuses;
  }

  it("resolveTrustProxy maps the env var to an address list, never a bare hop count by default", () => {
    expect(resolveTrustProxy(undefined)).toMatchObject({ value: "loopback", source: "default", spoofable: false });
    expect(resolveTrustProxy("")).toMatchObject({ value: "loopback", source: "default" });
    expect(resolveTrustProxy("1")).toMatchObject({ value: "loopback", spoofable: false });
    expect(resolveTrustProxy("true")).toMatchObject({ value: "loopback" });
    expect(resolveTrustProxy("0")).toMatchObject({ value: false });
    expect(resolveTrustProxy("off")).toMatchObject({ value: false });
    expect(resolveTrustProxy("2")).toMatchObject({ value: 2, spoofable: true });
    expect(resolveTrustProxy("10.0.0.0/8, uniquelocal")).toMatchObject({ value: "10.0.0.0/8,uniquelocal", spoofable: false });
    expect(resolveTrustProxy("172.16.0.5")).toMatchObject({ value: "172.16.0.5" });
    // A typo must not widen trust to "everything".
    expect(resolveTrustProxy("everything-please")).toMatchObject({ value: false });
    expect(resolveTrustProxy("10.0.0.0/99")).toMatchObject({ value: false });
  });

  it("clientIpKey normalises IPv4-mapped addresses and buckets IPv6 by /64", () => {
    const req = (ip: string | undefined, remote?: string) =>
      ({ ip, socket: { remoteAddress: remote } }) as unknown as Request;
    expect(clientIpKey(req("::ffff:10.1.2.3"))).toBe("10.1.2.3");
    expect(clientIpKey(req("203.0.113.9"))).toBe("203.0.113.9");
    expect(clientIpKey(req("2001:db8:abcd:12:1:2:3:4"))).toBe("2001:0db8:abcd:0012::/64");
    expect(clientIpKey(req("2001:db8:abcd:12:ffff:ffff:ffff:ffff"))).toBe("2001:0db8:abcd:0012::/64");
    expect(clientIpKey(req("::1"))).toBe("0000:0000:0000:0000::/64");
    expect(clientIpKey(req("fe80::1%eth0"))).toBe("fe80:0000:0000:0000::/64");
    expect(clientIpKey(req(undefined, "1.2.3.4"))).toBe("1.2.3.4");
    expect(clientIpKey(req(""))).toBe("unknown");
    expect(clientIpKey(req("not an ip"))).toMatch(/^invalid:/);
  });

  it("an untrusted peer cannot evade the auth limiter by rotating X-Forwarded-For", async () => {
    // Trusted proxies are 10.0.0.0/8; Supertest connects from 127.0.0.1, so
    // its X-Forwarded-For must be ignored and every request keyed on the
    // socket address.
    const app = createApp({ sessionSecret: "x".repeat(40), trustProxy: "10.0.0.0/8" });
    const statuses = await failedLogins(app, AUTH_RATE_LIMIT.max + 1, (i) => `198.51.100.${i % 250}`);
    expect(statuses.slice(0, AUTH_RATE_LIMIT.max).every((s) => s === 400)).toBe(true);
    expect(statuses[AUTH_RATE_LIMIT.max]).toBe(429);
    const limited = await supertest(app)
      .post("/api/login")
      .set("X-Forwarded-For", "8.8.8.8")
      .send({})
      .timeout(RESPOND);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "rate_limited" });
    expect(limited.headers["ratelimit-limit"] ?? limited.headers["ratelimit"]).toBeDefined();
  }, 60_000);

  it("behind the trusted (loopback) proxy the forwarded client address IS the key — but only one hop", async () => {
    const app = createApp({ sessionSecret: "x".repeat(40), trustProxy: true });
    // Distinct real clients through the proxy each get their own budget.
    const distinct = await failedLogins(app, AUTH_RATE_LIMIT.max + 5, (i) => `198.51.100.${i % 250}`);
    expect(distinct.every((s) => s === 400)).toBe(true);
    // A client that PREPENDS fake addresses (attacker, real) still keys on the
    // address the proxy appended (the rightmost one) — rotating the left part
    // changes nothing.
    const chained = await failedLogins(app, AUTH_RATE_LIMIT.max + 1, (i) => `203.0.113.${i % 250}, 192.0.2.77`);
    expect(chained.slice(0, AUTH_RATE_LIMIT.max).every((s) => s === 400)).toBe(true);
    expect(chained[AUTH_RATE_LIMIT.max]).toBe(429);
  }, 60_000);

  it("with no trusted proxy, X-Forwarded-For is ignored entirely", async () => {
    const app = createApp({ sessionSecret: "x".repeat(40), trustProxy: false });
    const statuses = await failedLogins(app, AUTH_RATE_LIMIT.max + 1, (i) => `198.51.100.${i % 250}`);
    expect(statuses[AUTH_RATE_LIMIT.max]).toBe(429);
  }, 60_000);

  it("a targeted account is protected even from a distributed guesser (per-account failure budget)", async () => {
    const app = createApp({ sessionSecret: "x".repeat(40), trustProxy: true });
    const guess = (i: number, username: string, password: string) =>
      supertest(app)
        .post("/api/login")
        .set("X-Forwarded-For", `198.51.100.${i}`) // a different source each time
        .send({ orgCode: "ISPN", username, password })
        .timeout(RESPOND);
    for (let i = 0; i < ACCOUNT_RATE_LIMIT.max; i++) {
      const res = await guess(i, "chen", `wrong-${i}`);
      expect(res.status, `attempt ${i}`).toBe(401);
    }
    // The 11th guess at the SAME account is refused regardless of its address…
    const blocked = await guess(ACCOUNT_RATE_LIMIT.max, "CHEN", DEV_PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: "rate_limited" });
    // …while another account from the same addresses is unaffected, and a
    // nonexistent account is budgeted identically (no existence oracle).
    const other = await guess(3, "patel", DEV_PASSWORD);
    expect(other.status).toBe(200);
    for (let i = 0; i < ACCOUNT_RATE_LIMIT.max; i++) {
      expect((await guess(i, "no-such-user", "nope")).status).toBe(401);
    }
    expect((await guess(0, "no-such-user", "nope")).status).toBe(429);
  }, 60_000);
});

describe("SHO-17 session store selection", () => {
  it("without DATABASE_URL the app uses the in-memory store and says so", () => {
    expect(getSessionStoreState()).toMatchObject({ kind: "memory" });
    const sel = createSessionStore({ databaseUrl: undefined });
    expect(sel.kind).toBe("memory");
    expect(sel.store.constructor.name).toBe("MemoryStore");
  });

  it("with DATABASE_URL it is connect-pg-simple on the app's pool, table `session`", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const fakePool = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (/to_regclass/.test(sql)) return { rows: [{ to_regclass: "session" }] };
        return { rows: [] };
      },
    } as unknown as import("pg").Pool;
    const sel = createSessionStore({
      databaseUrl: "postgres://user:secret@db.example/docturn",
      pool: fakePool,
      pruneSessionInterval: false,
    });
    try {
      expect(sel.kind).toBe("postgres");
      expect(sel.store.constructor.name).toBe("PGStore");
      expect(getSessionStoreState()).toMatchObject({ kind: "postgres" });
      // The reason never echoes the connection string.
      expect(getSessionStoreState().reason).not.toContain("secret");
      // A read goes to OUR pool (not a second connection) against "session".
      const got = await new Promise<unknown>((resolve, reject) =>
        sel.store.get("some-sid", (err, s) => (err ? reject(err) : resolve(s))),
      );
      expect(got).toBeFalsy();
      expect(queries.some((q) => /"session"/.test(q.sql) && /SELECT/i.test(q.sql))).toBe(true);
      expect(queries.some((q) => q.params.includes("some-sid"))).toBe(true);
    } finally {
      (sel.store as unknown as { close: () => void }).close();
      // Restore the recorded state for the rest of this file.
      createSessionStore({ databaseUrl: undefined });
    }
  });

  it("the session-secret control reports the store that is actually mounted", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const status = await agent.get("/api/compliance/status");
    const ctl = (status.body.controls as Array<{ id: string; detail: string; evidence: Record<string, unknown> }>).find(
      (c) => c.id === "session-secret",
    );
    expect(ctl?.evidence.sessionStore).toBe("memory");
    expect(ctl?.detail).toMatch(/held in this process's memory/);
  });
});

describe("MIN-2 production login over a non-HTTPS request fails clearly", () => {
  const prevEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
  });

  it("Secure cookie + request not seen as HTTPS → 400 insecure_transport; trusted X-Forwarded-Proto makes it work", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.NODE_ENV = "production";
    const app = createApp({ sessionSecret: "x".repeat(40), rateLimiting: false, trustProxy: true });
    const creds = { orgCode: "ISPN", username: "chen", password: DEV_PASSWORD };

    const plain = await supertest(app).post("/api/login").send(creds).timeout(RESPOND);
    expect(plain.status).toBe(400);
    expect(plain.body).toEqual({ error: "insecure_transport" });
    expect(plain.headers["set-cookie"]).toBeUndefined();

    // Through the trusted proxy with TLS terminated upstream.
    const viaProxy = await supertest(app)
      .post("/api/login")
      .set("X-Forwarded-Proto", "https")
      .send(creds)
      .timeout(RESPOND);
    expect(viaProxy.status).toBe(200);
    expect(viaProxy.body.username).toBe("chen");
    expect(String(viaProxy.headers["set-cookie"])).toMatch(/docturn\.sid=.*Secure/);

    // The same header from an UNTRUSTED peer is not believed.
    const untrusted = createApp({ sessionSecret: "x".repeat(40), rateLimiting: false, trustProxy: false });
    const spoofed = await supertest(untrusted)
      .post("/api/login")
      .set("X-Forwarded-Proto", "https")
      .send(creds)
      .timeout(RESPOND);
    expect(spoofed.status).toBe(400);
    expect(spoofed.body).toEqual({ error: "insecure_transport" });

    // The MFA completion step (which also needs the session cookie) is gated too.
    const mfa = await supertest(app).post("/api/2fa/complete-login").send({ code: "000000" }).timeout(RESPOND);
    expect(mfa.status).toBe(400);
    expect(mfa.body).toEqual({ error: "insecure_transport" });

    // /api/health tells the operator what the server sees.
    expect((await supertest(app).get("/api/health")).body.secure).toBe(false);
    expect((await supertest(app).get("/api/health").set("X-Forwarded-Proto", "https")).body.secure).toBe(true);
  });

  it("outside production (cookie not Secure) plain-http login keeps working", async () => {
    const { res } = await login(ctx.app, { username: "chen" });
    expect(res.status).toBe(200);
  });
});

describe("SHO-6 the store is described truthfully", () => {
  it("/api/health distinguishes persistent (Postgres) from durable (on-disk PGlite) from in-memory", async () => {
    const res = await supertest(ctx.app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      db: "up",
      persistent: false,
      storage: "pglite-memory",
      durable: false,
      secure: false,
    });
    // Never a filesystem path on the unauthenticated endpoint.
    expect(JSON.stringify(res.body)).not.toMatch(/dataDir|\/tmp|\.pglite/);
  });

  it("an on-disk PGlite handle is durable, unencrypted, and not 'persistent' (Postgres)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "docturn-pglite-"));
    const h = createDb({ databaseUrl: "", pgliteDir: dir });
    try {
      expect(h.storage).toBe("pglite-disk");
      expect(h.durable).toBe(true);
      expect(h.ephemeral).toBe(true);
      expect(h.dataDir).toBe(dir);
      expect(h.pool).toBeUndefined();
    } finally {
      await h.close();
      await rm(dir, { recursive: true, force: true });
    }
    expect(ctx.handle).toMatchObject({ storage: "pglite-memory", durable: false });
    expect(ctx.handle.dataDir).toBeUndefined();
  });

  it("encryption-at-rest never claims encryption for PGlite and says what the store is", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const status = await agent.get("/api/compliance/status");
    const ctl = (status.body.controls as Array<{ id: string; status: string; detail: string; evidence: Record<string, unknown> }>).find(
      (c) => c.id === "encryption-at-rest",
    );
    expect(ctl?.status).toBe("manual");
    expect(ctl?.evidence).toMatchObject({
      persistent: false,
      storage: "pglite-memory",
      durable: false,
      applicationEncryptsDatabaseFiles: false,
    });
    expect(ctl?.detail).toMatch(/in-memory PGlite/);
    expect(ctl?.detail).not.toMatch(/encrypted at rest/i);
  });

  it("the control's static description (status + auditor export) agrees with its detail: on-disk PGlite persists, unencrypted", async () => {
    const def = CONTROLS.find((c) => c.id === "encryption-at-rest");
    expect(def).toBeDefined();
    const d = def!.description;
    // Never calls the PGlite store as a whole "ephemeral" — only the in-memory variant resets.
    expect(d).not.toMatch(/ephemeral/i);
    expect(d).toMatch(/on-disk PGlite/);
    expect(d).toMatch(/persists across restarts/);
    expect(d).toMatch(/not encrypt/i);
    expect(d).toMatch(/in-memory/);

    const { agent } = await login(ctx.app, { username: "director" });
    const status = await agent.get("/api/compliance/status");
    const ctl = (status.body.controls as Array<{ id: string; description: string }>).find((c) => c.id === "encryption-at-rest");
    expect(ctl?.description).toBe(d);
    const exp = await agent.get("/api/compliance/evidence");
    expect(exp.status).toBe(200);
    const pack = exp.body as { system: { database: Record<string, unknown> }; controls: Array<{ id: string; description: string }> };
    expect(pack.controls.find((c) => c.id === "encryption-at-rest")?.description).toBe(d);
    // The export's system block names the store kind instead of a bare "pglite (in-process)".
    expect(pack.system.database).toMatchObject({
      persistent: false,
      storage: "pglite-memory",
      durable: false,
      encryptedByApplication: false,
    });
  });
});
