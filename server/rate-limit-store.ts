import type { IncrementResponse, Options, Store } from "express-rate-limit";
import { storage } from "./storage.js";

/**
 * Shared rate-limit counters (E1 multi-instance safety): an express-rate-limit
 * `Store` backed by the `rate_limit_hits` table, so the login / account /
 * registration budgets are ONE budget across every instance behind the load
 * balancer instead of one per process. Selected by server/app.ts when
 * DATABASE_URL is set (the memory store stays for the single-process PGlite
 * run, and the compliance monitor says which one is active).
 *
 * One store instance per limiter, each with its own `prefix`, because the
 * library refuses a store shared between limiters (double counting). Every
 * operation is one statement (storage.incrementRateLimitHit is an upsert that
 * restarts a lapsed window), so two instances counting the same client at
 * once cannot lose a hit. Keys are client addresses / "acct:org:user" —
 * never PHI. Expired rows are pruned opportunistically.
 */
export class DatabaseRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 60_000;
  private sinceLastPrune = 0;

  constructor(prefix: string) {
    this.prefix = prefix.endsWith(":") ? prefix : prefix + ":";
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const { count, windowStart } = await storage().incrementRateLimitHit(this.prefix + key, this.windowMs);
    if (++this.sinceLastPrune >= 500) {
      this.sinceLastPrune = 0;
      // Any window older than this one's length has lapsed for every limiter
      // that shares the table; a failed prune is a nuisance, not an error.
      void storage().pruneRateLimitHits(Math.max(this.windowMs, 60 * 60 * 1000)).catch(() => {});
    }
    return { totalHits: count, resetTime: new Date(windowStart.getTime() + this.windowMs) };
  }

  async decrement(key: string): Promise<void> {
    await storage().decrementRateLimitHit(this.prefix + key);
  }

  async resetKey(key: string): Promise<void> {
    await storage().resetRateLimitKey(this.prefix + key);
  }

  async resetAll(): Promise<void> {
    await storage().resetRateLimitPrefix(this.prefix);
  }
}
