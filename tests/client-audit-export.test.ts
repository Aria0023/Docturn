import { afterEach, describe, expect, it } from "vitest";
import { boot, closeAll, type Harness } from "./client-parity-harness.js";

/**
 * Audit export, client half (E2, module `enterprise.auditExport`) — the real
 * store.js + api-bridge.js in jsdom.
 *
 * What the client must do, and nothing more:
 *   • a date range / a format is sent to the SERVER as query parameters
 *     (`from`, `to`, `format`) — the client never filters or re-formats rows
 *     it downloaded;
 *   • a streamed export has no row count in its headers, so the count in the
 *     toast comes from the file itself (JSON `rowCount`, CSV data lines) —
 *     never a guess;
 *   • the legacy (no-range) export is unchanged, so an org without the
 *     module keeps its Export CSV button;
 *   • 404 module_disabled says the range export is not switched on, and
 *     nothing is downloaded.
 *
 * The Compliance screen's own date-range controls are measured in Chromium on
 * iPhones by scripts/audit-export-check.mjs.
 *
 * CLIENT_SRC_ROOT=<dir> runs these against another copy of webapp/ (used to
 * show they fail on the previous client).
 */
afterEach(closeAll);

const CSV = 'occurred_at_utc,action\r\n"2026-02-01T00:00:00.000Z","auth.login"\r\n"2026-02-02T00:00:00.000Z","auth.logout"\r\n';

function exportRoute(h: Harness, reply: (q: URLSearchParams) => any) {
  h.routes.export = (r) => {
    const [path, qs] = r.path.split("?");
    if (path !== "/api/audit/export" || r.method !== "GET") return undefined;
    return reply(new URLSearchParams(qs ?? ""));
  };
}

describe("audit export (client)", () => {
  it("sends the range and the format to the server, and counts the rows of the streamed CSV", async () => {
    const h = await boot({ modules: { "enterprise.auditExport": true } });
    exportRoute(h, () => ({
      status: 200,
      text: CSV,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="docturn-audit-ISPN-2026-03-01.csv"',
        "x-export-streamed": "1",
      },
    }));
    const out = await h.w.DT.actions.exportAuditTrail("audit", "org", { from: "2026-02-01", to: "2026-02-28", format: "csv" });
    const req = h.reqs.filter((r) => r.path.startsWith("/api/audit/export")).pop()!;
    const q = new URLSearchParams(req.path.split("?")[1]);
    expect(q.get("trail")).toBe("audit");
    expect(q.get("from")).toBe("2026-02-01");
    expect(q.get("to")).toBe("2026-02-28");
    expect(q.get("format")).toBe("csv");
    expect(h.downloads).toEqual(["docturn-audit-ISPN-2026-03-01.csv"]);
    expect(out).toMatchObject({ rows: 2, streamed: true });
    expect(h.state().__toast).toMatchObject({ tone: "accepted", title: "Exported 2 rows" });
    expect(h.state().__toast.msg).toMatch(/times in UTC/);
    expect(h.state().__toast.msg).toMatch(/Feb|2026-02-01/);
  });

  it("a JSON export reports the server's own rowCount", async () => {
    const h = await boot({ modules: { "enterprise.auditExport": true } });
    const body = { generatedAt: "x", organization: { id: 1, code: "ISPN" }, trail: "audit", columns: [], rows: [{ action: "a" }], rowCount: 1 };
    exportRoute(h, () => ({
      status: 200,
      text: JSON.stringify(body),
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": 'attachment; filename="docturn-audit-ISPN-2026-03-01.json"',
        "x-export-streamed": "1",
      },
    }));
    const out = await h.w.DT.actions.exportAuditTrail("audit", "org", { format: "json" });
    expect(new URLSearchParams(h.reqs.filter((r) => r.path.startsWith("/api/audit/export")).pop()!.path.split("?")[1]).get("format")).toBe("json");
    expect(out).toMatchObject({ rows: 1 });
    expect(h.downloads).toEqual(["docturn-audit-ISPN-2026-03-01.json"]);
  });

  it("without a range or a format it is the LEGACY export, with the server's row headers", async () => {
    const h = await boot({ modules: { "enterprise.auditExport": false } });
    exportRoute(h, (q) => {
      expect(q.get("from")).toBeNull();
      expect(q.get("format")).toBeNull();
      return {
        status: 200,
        text: CSV,
        headers: {
          "content-type": "text/csv",
          "content-disposition": 'attachment; filename="docturn-audit-ISPN-2026-03-01.csv"',
          "x-export-rows": "4321",
          "x-export-total": "4321",
          "x-export-truncated": "0",
        },
      };
    });
    const out = await h.w.DT.actions.exportAuditTrail("audit", "org");
    expect(h.reqs.some((r) => r.path === "/api/audit/export?trail=audit&scope=org")).toBe(true);
    expect(out).toMatchObject({ rows: 4321 });
    expect(h.state().__toast).toMatchObject({ title: "Exported 4,321 rows" });
  });

  it("404 module_disabled says the range export is not switched on; nothing is downloaded", async () => {
    const h = await boot({ modules: { "enterprise.auditExport": true } });
    exportRoute(h, () => ({ status: 404, body: { error: "module_disabled", module: "enterprise.auditExport" } }));
    expect(await h.w.DT.actions.exportAuditTrail("audit", "org", { from: "2026-02-01" })).toBeNull();
    expect(h.downloads).toEqual([]);
    expect(h.state().__toast).toMatchObject({ tone: "rejected" });
    expect(h.state().__toast.msg).toMatch(/aren't switched on/i);
  });

  it("a refused range (400) says so and downloads nothing", async () => {
    const h = await boot({ modules: { "enterprise.auditExport": true } });
    exportRoute(h, () => ({ status: 400, body: { error: "validation_error" } }));
    expect(await h.w.DT.actions.exportAuditTrail("audit", "org", { from: "2026-03-02", to: "2026-03-01" })).toBeNull();
    expect(h.downloads).toEqual([]);
    expect(h.state().__toast.msg).toMatch(/date range/i);
  });
});
