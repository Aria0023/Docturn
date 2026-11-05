import type { Server as HttpServer } from "node:http";

/**
 * Graceful shutdown (E1): on SIGTERM / SIGINT the instance
 *   1. stops its background timers (no new sweeps start),
 *   2. stops accepting connections and closes idle keep-alive sockets
 *      (/api/health answers 503 from here on, so a load balancer drains it),
 *   3. closes every WebSocket with 1012 "service restart" — a reconnect-class
 *      close the web client already treats as "retry with backoff" (never
 *      "sign in again": only 1008 and 4423 mean that — webapp/api-bridge.js),
 *   4. waits for in-flight HTTP requests to finish, up to `timeoutMs`, then
 *      cuts whatever is left,
 *   5. gives its job leases back (a sibling takes over at its next tick),
 *      closes the realtime bus and the database pool, and exits —
 *      0 when everything drained, 1 when the deadline forced it.
 * A second signal while draining exits at once.
 */
export interface ShutdownDeps {
  server: HttpServer;
  /** Close every live socket with 1012; returns how many. */
  closeSockets?: () => number;
  stopTimers?: () => void;
  releaseLeases?: () => Promise<number>;
  closeBus?: () => Promise<void>;
  closeDb?: () => Promise<void>;
  /** Deadline for in-flight requests (default SHUTDOWN_TIMEOUT_MS or 10 s). */
  timeoutMs?: number;
  exit?: (code: number) => void;
  log?: (line: string) => void;
}

let shuttingDown = false;

/** True once a shutdown signal was received in this process. */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Tests only. */
export function _resetShutdownState(): void {
  shuttingDown = false;
}

export interface ShutdownHandle {
  /** Run the sequence (idempotent); resolves with the exit code it chose. */
  shutdown(signal: string): Promise<number>;
  uninstall(): void;
}

export function installGracefulShutdown(deps: ShutdownDeps): ShutdownHandle {
  const log = deps.log ?? ((line: string) => console.log(line));
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const timeoutMs = deps.timeoutMs ?? Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000);
  let inFlight: Promise<number> | null = null;

  const run = async (signal: string): Promise<number> => {
    shuttingDown = true;
    log(`[shutdown] ${signal}: draining (in-flight requests get up to ${timeoutMs} ms)`);
    try {
      deps.stopTimers?.();
    } catch (err) {
      console.error("[shutdown] stopping timers failed", err);
    }

    // Stop accepting. The close callback fires once every connection has
    // ended; idle keep-alive sockets are cut now so only real requests hold
    // it open.
    const drained = new Promise<boolean>((resolve) => {
      deps.server.close(() => resolve(true));
    });
    try {
      deps.server.closeIdleConnections();
    } catch {
      /* older Node without closeIdleConnections: the deadline below covers it */
    }

    let sockets = 0;
    try {
      sockets = deps.closeSockets?.() ?? 0;
    } catch (err) {
      console.error("[shutdown] closing websockets failed", err);
    }
    log(`[shutdown] closed ${sockets} websocket(s) with 1012 (clients reconnect)`);

    let forced = false;
    const deadline = new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), timeoutMs);
      t.unref?.();
    });
    const ok = await Promise.race([drained, deadline]);
    if (!ok) {
      forced = true;
      log(`[shutdown] deadline reached; closing remaining connections`);
      try {
        deps.server.closeAllConnections();
      } catch {
        /* nothing else to do */
      }
    } else {
      log("[shutdown] in-flight requests finished");
    }

    try {
      const released = (await deps.releaseLeases?.()) ?? 0;
      log(`[shutdown] released ${released} job lease(s)`);
    } catch (err) {
      console.error("[shutdown] releasing leases failed", err);
    }
    try {
      await deps.closeBus?.();
    } catch (err) {
      console.error("[shutdown] closing the realtime bus failed", err);
    }
    try {
      await deps.closeDb?.();
    } catch (err) {
      console.error("[shutdown] closing the database failed", err);
    }
    const code = forced ? 1 : 0;
    log(`[shutdown] done (exit ${code})`);
    exit(code);
    return code;
  };

  const shutdown = (signal: string): Promise<number> => {
    if (inFlight) return inFlight;
    inFlight = run(signal);
    return inFlight;
  };

  const onSignal = (signal: NodeJS.Signals) => {
    if (inFlight) {
      log(`[shutdown] second ${signal} while draining: exiting now`);
      exit(1);
      return;
    }
    void shutdown(signal);
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  return {
    shutdown,
    uninstall() {
      process.off("SIGTERM", onSignal);
      process.off("SIGINT", onSignal);
    },
  };
}
