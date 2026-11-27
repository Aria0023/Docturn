/**
 * A background-loop tick that never overlaps itself: while the previous run
 * is still in flight, a new tick is skipped (returns null) instead of starting
 * a second, parallel run. Used by the Amion and Epic scheduled sync loops, so
 * a slow tick can never pile up concurrent runs against the same hospitals.
 * A run that rejects still frees the slot (the rejection is swallowed — the
 * task records its own outcome).
 */
export function skipWhileRunning(task: () => Promise<unknown>): () => Promise<void> | null {
  let running = false;
  return () => {
    if (running) return null;
    running = true;
    let p: Promise<unknown>;
    try {
      p = task();
    } catch (err) {
      p = Promise.reject(err);
    }
    return p.then(
      () => {},
      () => {},
    ).finally(() => {
      running = false;
    });
  };
}
