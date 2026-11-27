import type { RequestHandler } from "express";

/**
 * Measured API latency for the developer console's System health card
 * (A.CON developer #16). Every /api request this process answers is timed
 * from arrival to the response being flushed; the card shows percentiles over
 * the last WINDOW_MS of those real requests — never a constant.
 *
 * Scope: THIS server instance. A multi-instance deployment has one window per
 * instance; the card says so.
 *
 * Kept in a fixed ring (CAPACITY samples) so memory stays bounded under load:
 * at very high request rates the window holds the most recent CAPACITY
 * requests, which is what a percentile over "recent traffic" needs.
 */
export const WINDOW_MS = 5 * 60 * 1000;
const CAPACITY = 4096;

const atRing = new Float64Array(CAPACITY);
const msRing = new Float64Array(CAPACITY);
const statusRing = new Uint16Array(CAPACITY);
let next = 0;
let filled = 0;

/** Record one answered API request (exported for tests). */
export function recordApiRequest(ms: number, status: number, at: number = Date.now()): void {
  atRing[next] = at;
  msRing[next] = ms;
  statusRing[next] = status;
  next = (next + 1) % CAPACITY;
  if (filled < CAPACITY) filled++;
}

/** Tests: forget every sample. */
export function _resetRequestMetrics(): void {
  next = 0;
  filled = 0;
}

export interface ApiLatencySummary {
  windowSec: number;
  /** Requests answered in the window. */
  requests: number;
  /** Median / 95th-percentile response time in ms (null with no requests). */
  p50Ms: number | null;
  p95Ms: number | null;
  /** Requests answered with a 5xx status in the window. */
  serverErrors: number;
}

/** Nearest-rank percentile of an ascending array. */
function percentile(sorted: number[], p: number): number {
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function apiLatencySummary(now: number = Date.now()): ApiLatencySummary {
  const since = now - WINDOW_MS;
  const durations: number[] = [];
  let serverErrors = 0;
  for (let i = 0; i < filled; i++) {
    if (atRing[i]! < since || atRing[i]! > now) continue;
    durations.push(msRing[i]!);
    if (statusRing[i]! >= 500) serverErrors++;
  }
  durations.sort((a, b) => a - b);
  return {
    windowSec: WINDOW_MS / 1000,
    requests: durations.length,
    p50Ms: durations.length ? round1(percentile(durations, 50)) : null,
    p95Ms: durations.length ? round1(percentile(durations, 95)) : null,
    serverErrors,
  };
}

export interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
  max: number;
}

/**
 * Overall status from measured facts only. "degraded" names each reason; the
 * route answers at all only while the process is up, so there is no "down".
 */
export function assessHealth(input: { dbOk: boolean; api: ApiLatencySummary; pool: PoolStats | null }): {
  status: "operational" | "degraded";
  issues: string[];
} {
  const issues: string[] = [];
  if (!input.dbOk) issues.push("database unreachable");
  const { requests, serverErrors } = input.api;
  if (requests >= 20 && serverErrors / requests > 0.05) {
    issues.push(`${serverErrors} of ${requests} API requests failed with a server error in the last ${Math.round(input.api.windowSec / 60)} min`);
  }
  if (input.pool && input.pool.waiting > 0) {
    issues.push(`${input.pool.waiting} quer${input.pool.waiting === 1 ? "y" : "ies"} waiting for a database connection`);
  }
  return { status: issues.length ? "degraded" : "operational", issues };
}

/** Times every /api request (mounted once, early, in createApp). */
export function requestMetricsMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (!req.path.startsWith("/api/")) return next();
    const start = process.hrtime.bigint();
    res.once("finish", () => {
      recordApiRequest(Number(process.hrtime.bigint() - start) / 1e6, res.statusCode);
    });
    next();
  };
}

/** When this process started serving (for the instance-uptime tile). */
export const PROCESS_STARTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000));
