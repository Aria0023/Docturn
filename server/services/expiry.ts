import { storage } from "../storage.js";
import { runExpirySweep } from "./assignments.js";

/**
 * Background sweep that expires overdue pending assignments and reroutes them.
 * Server-authoritative: the client never computes the next provider.
 */
let timer: NodeJS.Timeout | null = null;

export function startExpiryLoop(intervalMs = 15_000) {
  if (timer) return;
  timer = setInterval(() => {
    runExpirySweep(storage()).catch((err) =>
      console.error("[expiry] sweep failed", err),
    );
  }, intervalMs);
  // Don't keep the process alive solely for the sweep.
  timer.unref?.();
}

export function stopExpiryLoop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
