import { assignmentStore } from '../storage.js';
import { assignmentService } from './assignments.js';

let timer: ReturnType<typeof setInterval> | null = null;

async function sweep() {
  const nowSec = Math.floor(Date.now() / 1000);
  const expired = await assignmentStore.listExpiredCandidates(nowSec);
  for (const a of expired) {
    await assignmentService.expireAndReroute(a.id);
  }
  return expired.length;
}

export const expiry = {
  sweep,
  start(intervalMs = 15_000) {
    if (timer) return;
    timer = setInterval(() => {
      sweep().catch((err) => console.error('[expiry] sweep error', err));
    }, intervalMs);
    // Don't keep the event loop alive solely for the sweeper (important for tests).
    if (typeof timer.unref === 'function') timer.unref();
  },
  stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  },
};
