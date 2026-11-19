/**
 * Real-PHI preflight — fail closed.
 *
 * `SYNTHETIC_DATA=false` is the operator's statement that this instance will
 * carry real patient data. Until now that switch only stopped demo seeding;
 * the process would still start on the unencrypted on-disk PGlite store, with
 * a per-process session secret, non-Secure cookies or login rate limiting
 * switched off — each one a missing Security Rule safeguard, visible only if
 * someone opened the compliance monitor afterwards. A deployment that has
 * declared real PHI must not come up without them.
 *
 * So in real-PHI mode the server REFUSES TO START unless every item below
 * holds, and says exactly which do not. Synthetic mode (the default, and the
 * Render demo) is untouched.
 *
 *   database           DATABASE_URL is set — a managed Postgres with
 *                      encryption at rest and backups, never ./.pglite
 *                      (§164.312(a)(2)(iv), §164.308(a)(7))
 *   transport          NODE_ENV=production, which is what turns the session
 *                      cookie Secure and refuses sign-in over plain HTTP
 *                      (§164.312(e)(1))
 *   session secret     SESSION_SECRET is set, 32+ characters — otherwise
 *                      every restart silently changes the signing key
 *                      (§164.312(d))
 *   brute force        RATE_LIMIT is not "off" (§164.308(a)(5)(ii)(D))
 *   credential vault   INTEGRATION_KEY is set — hospitals' integration
 *                      credentials are AES-256-GCM encrypted under it, and a
 *                      missing key leaves them unusable or, worse, tempts a
 *                      plaintext workaround (§164.312(a)(2)(iv))
 *
 * What code cannot establish — a signed BAA with the host, the risk analysis,
 * tested backups — stays a named-owner attestation in the compliance monitor.
 *
 * LAB HATCH. `PHI_PREFLIGHT_OVERRIDE=not-compliant` starts anyway. It exists
 * for the verification scripts, which boot a real-PHI-mode server on a
 * throwaway database to prove that mode shows no demo data. It is refused
 * when NODE_ENV=production, logs a warning on every boot, and is reported by
 * the compliance monitor — it can never be the quiet state of a live system.
 */

export interface PreflightProblem {
  id: "database" | "transport" | "session-secret" | "rate-limit" | "integration-key";
  rule: string;
  message: string;
}

export const PHI_PREFLIGHT_OVERRIDE_VALUE = "not-compliant";

type Env = Record<string, string | undefined>;

export function isRealPhiMode(env: Env = process.env): boolean {
  return env.SYNTHETIC_DATA === "false";
}

/** The lab hatch: honoured only outside production. */
export function phiPreflightOverridden(env: Env = process.env): boolean {
  return env.PHI_PREFLIGHT_OVERRIDE === PHI_PREFLIGHT_OVERRIDE_VALUE && env.NODE_ENV !== "production";
}

/** Every missing safeguard, or [] when the instance may carry real PHI (or is synthetic). */
export function realPhiPreflight(env: Env = process.env): PreflightProblem[] {
  if (!isRealPhiMode(env)) return [];
  const problems: PreflightProblem[] = [];
  if (!env.DATABASE_URL?.trim()) {
    problems.push({
      id: "database",
      rule: "45 CFR §164.312(a)(2)(iv), §164.308(a)(7)",
      message:
        "DATABASE_URL is not set, so data would live in the on-disk PGlite store: unencrypted, single-process and not backed up. Point DATABASE_URL at a managed Postgres with encryption at rest.",
    });
  }
  if (env.NODE_ENV !== "production") {
    problems.push({
      id: "transport",
      rule: "45 CFR §164.312(e)(1)",
      message:
        'NODE_ENV is not "production", so the session cookie is not Secure and sign-in over plain HTTP is not refused. Set NODE_ENV=production behind TLS.',
    });
  }
  if ((env.SESSION_SECRET ?? "").length < 32) {
    problems.push({
      id: "session-secret",
      rule: "45 CFR §164.312(d)",
      message:
        "SESSION_SECRET is missing or shorter than 32 characters, so sessions would be signed with a key that changes on every restart. Set a 32+ character secret from your secrets manager.",
    });
  }
  if ((env.RATE_LIMIT ?? "").toLowerCase() === "off") {
    problems.push({
      id: "rate-limit",
      rule: "45 CFR §164.308(a)(5)(ii)(D)",
      message: 'RATE_LIMIT="off" disables login brute-force protection. Remove it.',
    });
  }
  if (!env.INTEGRATION_KEY?.trim()) {
    problems.push({
      id: "integration-key",
      rule: "45 CFR §164.312(a)(2)(iv)",
      message:
        "INTEGRATION_KEY is not set, so hospitals' integration credentials cannot be encrypted at rest. Set a 32-byte key (openssl rand -hex 32).",
    });
  }
  return problems;
}

/**
 * Run at boot, before the database is opened. Returns normally when the
 * instance may start; otherwise prints every problem and exits non-zero.
 */
export function enforceRealPhiPreflight(env: Env = process.env, exit: (code: number) => never = process.exit): void {
  const problems = realPhiPreflight(env);
  if (problems.length === 0) return;
  const lines = problems.map((p) => `  ✗ ${p.id} (${p.rule}) — ${p.message}`);
  if (phiPreflightOverridden(env)) {
    console.warn(
      "[preflight] SYNTHETIC_DATA=false but this instance is NOT fit for real PHI, and PHI_PREFLIGHT_OVERRIDE is set. " +
        "Starting anyway for lab use only — do not enter real patient data:\n" + lines.join("\n"),
    );
    return;
  }
  console.error(
    "[preflight] REFUSING TO START. SYNTHETIC_DATA=false declares real patient data, but required safeguards are missing:\n" +
      lines.join("\n") +
      "\nFix each item and restart. To run on synthetic data instead, remove SYNTHETIC_DATA=false.",
  );
  exit(1);
}
