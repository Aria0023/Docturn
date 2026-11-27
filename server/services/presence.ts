import { INSTANCE_ID } from "../instance.js";
import { storage } from "../storage.js";

/**
 * Who is online ACROSS servers.
 *
 * Each server knows only its own sockets. With more than one server behind
 * the load balancer, "who is online" asked of one server used to leave out
 * everyone connected to the others. Each server now writes the people it
 * holds a live socket for into `user_presence` (one row per server and
 * person) and refreshes them on a heartbeat; a server that dies stops
 * refreshing and its rows stop counting after PRESENCE_TTL_MS.
 *
 * Ids only. With one server (the PGlite demo) the table simply mirrors it.
 */
export const PRESENCE_HEARTBEAT_MS = 20_000;
export const PRESENCE_TTL_MS = 60_000;

export interface PresenceEntry { userId: number; organizationId: number }

/** Replace this server's rows with who it holds a socket for right now. */
export async function publishPresence(entries: PresenceEntry[], instanceId = INSTANCE_ID, now = new Date()): Promise<void> {
  // Also clears rows of servers that are long gone.
  await storage().replacePresence(instanceId, entries, now, new Date(now.getTime() - 10 * PRESENCE_TTL_MS));
}

/** People in `orgId` another server holds a live socket for. */
export async function onlineElsewhere(orgId: number, instanceId = INSTANCE_ID, now = new Date()): Promise<number[]> {
  return storage().listPresenceElsewhere(orgId, instanceId, new Date(now.getTime() - PRESENCE_TTL_MS));
}

let timer: NodeJS.Timeout | null = null;
let source: (() => PresenceEntry[]) | null = null;
let pending: NodeJS.Timeout | null = null;

function publishNow() {
  if (!source) return;
  void publishPresence(source()).catch((err) => console.error("[presence] publish failed", err instanceof Error ? err.message : err));
}
/** Someone connected or left: write soon (bursts collapse into one write). */
export function presenceChanged() {
  if (!source || pending) return;
  pending = setTimeout(() => {
    pending = null;
    publishNow();
  }, 250);
  pending.unref?.();
}
export function startPresenceLoop(read: () => PresenceEntry[]) {
  source = read;
  if (timer) clearInterval(timer);
  publishNow();
  timer = setInterval(publishNow, PRESENCE_HEARTBEAT_MS);
  timer.unref?.();
}
/** Stop, and take this server's people off the shared list. */
export async function stopPresenceLoop() {
  if (timer) clearInterval(timer);
  if (pending) clearTimeout(pending);
  timer = null;
  pending = null;
  const had = source;
  source = null;
  if (had) await publishPresence([]).catch(() => {});
}
