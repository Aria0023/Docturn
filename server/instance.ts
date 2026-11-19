import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

/**
 * This process's instance id (E1 multi-instance safety). It names the holder
 * of a job lease (job_leases.holder), the origin of a realtime-bus frame (so
 * an instance never re-delivers its own frame) and the instance in the
 * developer console's cluster view. Never a secret, never PHI: the hosting
 * platform's instance id when it provides one (Render: RENDER_INSTANCE_ID;
 * anything else: INSTANCE_ID), else host + pid + 8 random hex characters so
 * two processes on one host never collide.
 */
export const INSTANCE_ID: string = instanceIdFrom(process.env);

export function instanceIdFrom(env: NodeJS.ProcessEnv): string {
  const given = (env.INSTANCE_ID ?? env.RENDER_INSTANCE_ID ?? "").trim();
  // Printable, no whitespace, bounded — it lands in log lines and a table.
  if (given && /^[A-Za-z0-9._:-]{1,120}$/.test(given)) return given;
  return `${hostname().slice(0, 40)}-${process.pid}-${randomUUID().slice(0, 8)}`;
}
