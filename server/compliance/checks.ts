/**
 * DocTurn continuous-control monitor — the AUTOMATED CHECKS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE IN THIS FILE
 *
 * No check may return "pass" that it did not compute from live system state —
 * a real database query, the running middleware's real configuration, or a real
 * environment variable read at call time. There is no cached status, no seeded
 * result and no default-to-green anywhere below. Every `pass` in this file is
 * guarded by a comparison against a measured value.
 *
 * When a check cannot reach a defensible conclusion it returns "unknown" with a
 * detail string naming what a human has to confirm instead. When a safeguard is
 * genuinely a property of the hosting environment rather than the application,
 * the check returns "manual" and says so. A green dashboard that an auditor
 * cannot trust is worse than no dashboard.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { isValidPasswordHashFormat, PASSWORD_HASH_FORMAT } from "../auth.js";
import {
  AUTH_RATE_LIMIT,
  SESSION_POLICY,
  getRateLimitState,
  securityHeaders,
  sessionCookieOptions,
} from "../config.js";
import { getHandle } from "../db.js";
import { MFA_REQUIRED_MODULE } from "../auth.js";
import { getModules } from "../modules.js";
import { attachmentStoreConfig } from "../services/attachment-store.js";
import type { DatabaseStorage } from "../storage.js";
import type { ComplianceAttestation } from "@shared/schema";
import type { ControlStatus } from "./controls.js";

export interface CheckResult {
  status: ControlStatus;
  /** One honest sentence containing the MEASURED value(s). */
  detail: string;
  /** Machine-readable measurements backing `detail`. Never PHI, never secrets. */
  evidence: Record<string, unknown>;
}

export interface CheckContext {
  organizationId: number;
  store: DatabaseStorage;
  /** Manual attestations for this org, keyed by control id. */
  attestations: Map<string, ComplianceAttestation>;
}

export type CheckFn = (ctx: CheckContext) => Promise<CheckResult>;

const DAY_MS = 86_400_000;
const STALE_WINDOW_DAYS = 90;
const SIX_YEARS_DAYS = 6 * 365;
const MAX_SESSION_IDLE_MS = 15 * 60 * 1000;
const PRIVILEGED_ROLES = new Set(["developer", "director", "er_director"]);
/** Above this share of privileged accounts we flag least-privilege drift. */
const PRIVILEGED_SHARE_LIMIT = 0.25;

function ageDays(from: Date | null | undefined): number | null {
  if (!from) return null;
  return Math.floor((Date.now() - from.getTime()) / DAY_MS);
}

function mb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(2)} MB`;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Run the security-header middleware the app ACTUALLY mounted against a stub
 * request/response and read back the headers it sets. This is a measurement of
 * the live middleware, not an assumption about helmet's defaults.
 */
export function probeSecurityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: unknown) {
      headers[String(name).toLowerCase()] = String(value);
    },
    getHeader(name: string) {
      return headers[String(name).toLowerCase()];
    },
    removeHeader(name: string) {
      delete headers[String(name).toLowerCase()];
    },
  };
  const req = { secure: true, method: "GET", url: "/", headers: {} };
  (securityHeaders as unknown as (q: unknown, s: unknown, n: () => void) => void)(
    req,
    res,
    () => {},
  );
  return headers;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The checks
 * ──────────────────────────────────────────────────────────────────────────── */

const checks: Record<string, CheckFn> = {
  /** Inspect every credential's FORMAT. Never derives or logs the secret. */
  "pwd-hashing": async ({ organizationId, store }) => {
    const users = await store.listUsers(organizationId);
    if (users.length === 0) {
      return {
        status: "unknown",
        detail:
          "This organization has no user rows, so there is nothing to inspect.",
        evidence: { users: 0 },
      };
    }
    const bad = users.filter((u) => !isValidPasswordHashFormat(u.passwordHash));
    return {
      status: bad.length === 0 ? "pass" : "fail",
      detail:
        bad.length === 0
          ? `All ${users.length} credentials are stored in the expected format (${PASSWORD_HASH_FORMAT}).`
          : `${bad.length} of ${users.length} credentials are NOT in the expected hash format and may be plaintext or legacy values.`,
      evidence: {
        users: users.length,
        conforming: users.length - bad.length,
        nonConforming: bad.length,
        // User ids only — never usernames, never any part of the credential.
        nonConformingUserIds: bad.map((u) => u.id),
        expectedFormat: PASSWORD_HASH_FORMAT,
      },
    };
  },

  /** Policy threshold: EVERY privileged account carries a second factor. */
  "mfa-enrollment": async ({ organizationId, store }) => {
    const users = await store.listUsers(organizationId);
    if (users.length === 0) {
      return {
        status: "unknown",
        detail: "This organization has no user rows to measure enrolment against.",
        evidence: { users: 0 },
      };
    }
    const enrolled = users.filter((u) => u.twoFactorEnabled);
    const privileged = users.filter((u) => PRIVILEGED_ROLES.has(u.role));
    const privilegedEnrolled = privileged.filter((u) => u.twoFactorEnabled);
    const policyMet =
      privileged.length > 0 && privilegedEnrolled.length === privileged.length;
    // Is the org ENFORCING enrolment? Read from the live module map: with
    // security.mfaRequired on, an un-enrolled privileged user can sign in but
    // reaches nothing except the enrolment routes (server/auth.ts gate).
    const modules = await getModules(organizationId);
    const enforced = modules[MFA_REQUIRED_MODULE] === true;
    return {
      status: policyMet ? "pass" : "warn",
      detail:
        `${enrolled.length} of ${users.length} users have MFA enabled; ` +
        `${privilegedEnrolled.length} of ${privileged.length} privileged accounts (director / ER director / developer) are enrolled. ` +
        (policyMet
          ? "Policy threshold met: every privileged account has a second factor. "
          : "Policy threshold NOT met: every privileged account must have a second factor. ") +
        (enforced
          ? `Enforcement is ON (module ${MFA_REQUIRED_MODULE}): un-enrolled privileged users are blocked from every route except enrolment until they enrol.`
          : `Enforcement is OFF (module ${MFA_REQUIRED_MODULE}): enrolment is voluntary and an un-enrolled director keeps full access.`),
      evidence: {
        totalUsers: users.length,
        enrolled: enrolled.length,
        privileged: privileged.length,
        privilegedEnrolled: privilegedEnrolled.length,
        policy: "all privileged accounts enrolled",
        enforcement: enforced ? "on" : "off",
        enforcementModule: MFA_REQUIRED_MODULE,
      },
    };
  },

  /** Reads the SAME policy object server/app.ts builds the session from. */
  "session-timeout": async () => {
    const cookie = sessionCookieOptions();
    const maxAgeMs = Number(cookie.maxAge ?? 0);
    const minutes = Math.round((maxAgeMs / 60_000) * 10) / 10;
    const withinLimit = maxAgeMs > 0 && maxAgeMs <= MAX_SESSION_IDLE_MS;
    const status: ControlStatus = !withinLimit
      ? "fail"
      : SESSION_POLICY.rolling
        ? "pass"
        : "warn";
    return {
      status,
      detail:
        `Session cookie maxAge is ${minutes} minute(s) with rolling renewal ` +
        `${SESSION_POLICY.rolling ? "ON" : "OFF"}. ` +
        (status === "pass"
          ? "That is an inactivity timeout of 15 minutes or less."
          : status === "warn"
            ? "Without rolling renewal this is an ABSOLUTE lifetime, not an inactivity timeout."
            : "The configured window exceeds the 15-minute inactivity limit."),
      evidence: {
        maxAgeMs,
        maxAgeMinutes: minutes,
        rolling: SESSION_POLICY.rolling,
        thresholdMinutes: MAX_SESSION_IDLE_MS / 60_000,
        source: "server/config.ts SESSION_POLICY (the object app.ts builds the session from)",
      },
    };
  },

  "session-cookie-flags": async () => {
    const cookie = sessionCookieOptions();
    const prod = isProduction();
    const httpOnly = cookie.httpOnly === true;
    const sameSite = String(cookie.sameSite);
    const secure = cookie.secure === true;
    const sameSiteOk = sameSite === "lax" || sameSite === "strict";
    let status: ControlStatus;
    let detail: string;
    if (!httpOnly || !sameSiteOk) {
      status = "fail";
      detail = `Session cookie flags are httpOnly=${httpOnly}, sameSite=${sameSite}, secure=${secure} — httpOnly must be true and sameSite must be lax or strict.`;
    } else if (prod && !secure) {
      status = "fail";
      detail = `NODE_ENV is production but the session cookie is NOT marked Secure (httpOnly=${httpOnly}, sameSite=${sameSite}).`;
    } else if (prod) {
      status = "pass";
      detail = `Session cookie is httpOnly, sameSite=${sameSite}, and Secure under NODE_ENV=production.`;
    } else {
      status = "warn";
      detail =
        `Session cookie is httpOnly and sameSite=${sameSite}, but Secure is OFF because NODE_ENV is "${process.env.NODE_ENV ?? "development"}", not production. ` +
        "This process is not a production deployment; re-run this check on the production instance.";
    }
    return {
      status,
      detail,
      evidence: {
        httpOnly,
        sameSite,
        secure,
        nodeEnv: process.env.NODE_ENV ?? null,
        source: "server/config.ts sessionCookieOptions()",
      },
    };
  },

  /** Presence and length only — the secret's value is never read or exported. */
  "session-secret": async () => {
    const raw = process.env.SESSION_SECRET;
    const present = typeof raw === "string" && raw.length > 0;
    const length = present ? raw.length : 0;
    if (!present) {
      return {
        status: "fail",
        detail:
          "SESSION_SECRET is not set in the environment, so the app is signing sessions with a per-process random fallback: every restart invalidates all sessions and multiple instances cannot share them.",
        evidence: { set: false, length: 0, minimumLength: 32 },
      };
    }
    if (length < 32) {
      return {
        status: "fail",
        detail: `SESSION_SECRET is set but is only ${length} characters; at least 32 are required.`,
        evidence: { set: true, length, minimumLength: 32 },
      };
    }
    return {
      status: "pass",
      detail: `SESSION_SECRET is supplied by the environment and is ${length} characters long.`,
      evidence: { set: true, length, minimumLength: 32 },
    };
  },

  /** Reads what createApp() actually mounted, not what an env var implies. */
  "auth-rate-limit": async () => {
    const state = getRateLimitState();
    const because: Record<string, string> = {
      enabled: "the login/register/2FA limiters are mounted",
      no_app_created:
        "no Express app has been created in this process, so no limiter is mounted",
      disabled_by_env:
        'RATE_LIMIT="off" is set in the environment, so the limiters were skipped at boot',
      disabled_by_app_option:
        "the app was constructed with rateLimiting:false (test/dev harness), so the limiters were skipped",
    };
    return {
      status: state.enabled ? "pass" : "fail",
      detail: state.enabled
        ? `Login brute-force protection is active: ${AUTH_RATE_LIMIT.max} auth requests per ${AUTH_RATE_LIMIT.windowMs / 60_000} minutes per IP.`
        : `Login brute-force protection is NOT active — ${because[state.reason] ?? state.reason}.`,
      evidence: {
        enabled: state.enabled,
        reason: state.reason,
        authWindowMs: AUTH_RATE_LIMIT.windowMs,
        authMaxRequests: AUTH_RATE_LIMIT.max,
        rateLimitEnv: process.env.RATE_LIMIT ?? null,
      },
    };
  },

  /**
   * Deliberately never "pass": the application can see WHICH database it is
   * talking to, but disk encryption and the BAA live in the hosting tier.
   */
  "encryption-at-rest": async () => {
    const ephemeral = getHandle().ephemeral;
    return {
      status: "manual",
      detail: ephemeral
        ? "The database is the EPHEMERAL in-process store (PGlite) — data does not survive a restart and no encryption-at-rest claim can be made. A human must move this instance onto a managed Postgres with encryption at rest under a signed BAA and confirm it."
        : "The database is a persistent external Postgres (DATABASE_URL is set). Code inside the application cannot observe disk-level encryption or backup encryption — a human must confirm the storage tier's encryption-at-rest setting and the signed BAA with the provider.",
      evidence: {
        persistent: !ephemeral,
        driver: ephemeral ? "pglite (in-process)" : "postgres (external)",
        whatCodeCannotSee: [
          "disk / volume encryption setting",
          "backup encryption and retention",
          "signed BAA with the database provider",
        ],
      },
    };
  },

  "transmission-security": async () => {
    const headers = probeSecurityHeaders();
    const hsts = headers["strict-transport-security"] ?? null;
    const cookie = sessionCookieOptions();
    const prod = isProduction();
    const secureCookie = cookie.secure === true;
    let status: ControlStatus;
    let detail: string;
    if (prod && secureCookie && hsts) {
      status = "pass";
      detail = `NODE_ENV=production, the session cookie is Secure, and the app emits Strict-Transport-Security: ${hsts}. TLS termination itself happens upstream and must be confirmed at the hosting layer.`;
    } else if (prod && (!secureCookie || !hsts)) {
      status = "fail";
      detail = `Running in production but ${!secureCookie ? "the session cookie is not Secure" : "no Strict-Transport-Security header is emitted"}${!secureCookie && !hsts ? " and no HSTS header is emitted" : ""}.`;
    } else {
      status = "warn";
      detail =
        `This process is not running as production (NODE_ENV="${process.env.NODE_ENV ?? "development"}"), so the Secure cookie flag is off. ` +
        `The app does emit Strict-Transport-Security: ${hsts ?? "(none)"}. Re-run this check against the production instance and confirm HTTPS redirection at the load balancer.`;
    }
    return {
      status,
      detail,
      evidence: {
        nodeEnv: process.env.NODE_ENV ?? null,
        secureCookie,
        hsts,
        headersEmitted: Object.keys(headers).sort(),
        whatCodeCannotSee: ["TLS termination, cipher suites and HTTP→HTTPS redirection at the proxy"],
      },
    };
  },

  "audit-logging-active": async ({ organizationId, store }) => {
    const s = await store.auditStats(organizationId);
    const oldest = ageDays(s.oldestAt);
    const highRisk = Number(s.byRisk["high"] ?? 0);
    const broken = s.total === 0 || s.last30d === 0;
    return {
      status: broken ? "fail" : "pass",
      detail: broken
        ? `No audit events recorded in the last 30 days (${s.total} total for this organization) — audit logging appears to be silently broken.`
        : `${s.last24h} audit event(s) in the last 24h, ${s.last30d} in the last 30 days, ${s.total} total; oldest retained event is ${oldest ?? 0} day(s) old; ${highRisk} high-risk event(s) recorded.`,
      evidence: {
        total: s.total,
        last24h: s.last24h,
        last30d: s.last30d,
        oldestEventAgeDays: oldest,
        oldestAt: s.oldestAt?.toISOString() ?? null,
        newestAt: s.newestAt?.toISOString() ?? null,
        byRisk: s.byRisk,
        distinctActions: Object.keys(s.byAction).length,
      },
    };
  },

  "audit-retention": async ({ organizationId, store }) => {
    const s = await store.auditStats(organizationId);
    const oldest = ageDays(s.oldestAt);
    if (s.total === 0 || oldest === null) {
      return {
        status: "unknown",
        detail:
          "There are no audit records for this organization, so retention cannot be measured. Fix audit-logging-active first.",
        evidence: { total: 0, requiredDays: SIX_YEARS_DAYS },
      };
    }
    const met = oldest >= SIX_YEARS_DAYS;
    return {
      status: met ? "pass" : "warn",
      detail: met
        ? `The oldest audit record is ${oldest} days old, covering the six-year retention window required by §164.316(b)(2)(i).`
        : `The oldest audit record is ${oldest} days old — this system has simply not been running for six years (${SIX_YEARS_DAYS} days), so the retention window cannot yet be demonstrated from its own data. No code path deletes audit rows except a full tenant deletion; backup retention over six years must be confirmed with the hosting provider.`,
      evidence: {
        oldestEventAgeDays: oldest,
        requiredDays: SIX_YEARS_DAYS,
        totalEvents: s.total,
        deletionPaths: [
          "DatabaseStorage.deleteOrganization() — full tenant deletion only",
        ],
        whatCodeCannotSee: ["backup retention period at the hosting provider"],
      },
    };
  },

  "phi-access-logging": async ({ organizationId, store }) => {
    const s = await store.phiAccessStats(organizationId);
    const patients = await store.listPatients(organizationId);
    if (s.total === 0 && patients.length === 0) {
      return {
        status: "unknown",
        detail:
          "This organization holds no patient records and has recorded no PHI access, so read-logging cannot be observed yet.",
        evidence: { phiAccessRows: 0, patients: 0 },
      };
    }
    if (s.reads === 0) {
      return {
        status: "fail",
        detail:
          s.total === 0
            ? `This organization holds ${patients.length} patient record(s) but has recorded ZERO PHI access events — reads are not being audited.`
            : `${s.total} PHI access event(s) recorded but NONE are reads (${s.writes} writes) — read access to PHI is not being audited.`,
        evidence: {
          phiAccessRows: s.total,
          reads: 0,
          writes: s.writes,
          patients: patients.length,
        },
      };
    }
    return {
      status: "pass",
      detail: `${s.reads} PHI read(s) and ${s.writes} PHI write(s) audited for this organization; oldest ${ageDays(s.oldestAt) ?? 0} day(s) ago.`,
      evidence: {
        phiAccessRows: s.total,
        reads: s.reads,
        writes: s.writes,
        patients: patients.length,
        oldestAt: s.oldestAt?.toISOString() ?? null,
        newestAt: s.newestAt?.toISOString() ?? null,
      },
    };
  },

  /**
   * Scoped to the CALLER'S organization only — reporting another tenant's
   * settings from a tenant-scoped endpoint would itself be a boundary breach.
   */
  "msg-retention-policy": async ({ organizationId, store }) => {
    const raw = await store.getOrgSetting(organizationId, "messageRetentionDays");
    const days = typeof raw === "number" ? raw : Number(raw);
    const configured = Number.isFinite(days) && days > 0;
    return {
      status: configured ? "pass" : "warn",
      detail: configured
        ? `This organization purges clinical messages older than ${days} day(s); each sweep is audited as messages.retention_purged.`
        : "This organization has no messageRetentionDays setting, so clinical messages are retained indefinitely. That is permitted, but it must be a documented decision rather than an oversight.",
      evidence: {
        organizationId,
        messageRetentionDays: configured ? days : null,
        enforcedBy: "server/services/retention.ts (hourly sweep)",
        scope: "caller's organization only — this endpoint never reads another tenant's settings",
      },
    };
  },

  /**
   * A live probe. Runs org-scoped storage queries and verifies every returned
   * row carries the caller's organizationId, cross-checked against cross-tenant
   * ROW COUNTS (integers only) so the probe is meaningful rather than vacuous.
   */
  "tenant-isolation": async ({ organizationId, store }) => {
    const counts = await store.globalRowCounts();
    if (counts.organizations < 2) {
      return {
        status: "unknown",
        detail: `This database holds ${counts.organizations} organization(s). With no second tenant present, a scoped query returning only this org's rows proves nothing — isolation cannot be probed here.`,
        evidence: { organizations: counts.organizations, probed: false },
      };
    }
    const [users, patients, assignments, audit] = await Promise.all([
      store.listUsers(organizationId),
      store.listPatients(organizationId),
      store.listAssignments(organizationId),
      store.listAuditLogs(organizationId, 500),
    ]);
    const probes = [
      { query: "listUsers", rows: users as Array<{ organizationId: number | null }>, globalRows: counts.users },
      { query: "listPatients", rows: patients as Array<{ organizationId: number | null }>, globalRows: counts.patients },
      { query: "listAssignments", rows: assignments as Array<{ organizationId: number | null }>, globalRows: counts.assignments },
      { query: "listAuditLogs", rows: audit as Array<{ organizationId: number | null }>, globalRows: counts.auditLogs },
    ];
    let scopedRows = 0;
    let leaked = 0;
    const perQuery = probes.map((p) => {
      const bad = p.rows.filter((r) => r.organizationId !== organizationId).length;
      scopedRows += p.rows.length;
      leaked += bad;
      return {
        query: p.query,
        returned: p.rows.length,
        foreignRows: bad,
        rowsInDatabaseAcrossAllTenants: p.globalRows,
        withheldFromThisTenant: Math.max(0, p.globalRows - p.rows.length),
      };
    });
    const withheld = perQuery.reduce((a, p) => a + p.withheldFromThisTenant, 0);
    if (leaked > 0) {
      return {
        status: "fail",
        detail: `TENANT ISOLATION BREACH: ${leaked} of ${scopedRows} rows returned by org-scoped queries carry a different organizationId. Treat this as a potential reportable breach and investigate immediately.`,
        evidence: { organizationId, scopedRows, leaked, perQuery },
      };
    }
    if (withheld === 0) {
      return {
        status: "unknown",
        detail: `${scopedRows} rows were returned and all carry organizationId=${organizationId}, but no other tenant currently holds rows in these tables, so nothing could have leaked. The probe is inconclusive.`,
        evidence: { organizationId, scopedRows, leaked: 0, withheld: 0, perQuery },
      };
    }
    return {
      status: "pass",
      detail: `${probes.length} org-scoped queries returned ${scopedRows} row(s), every one carrying organizationId=${organizationId}; ${withheld} row(s) belonging to the other ${counts.organizations - 1} tenant(s) in the same tables were correctly withheld.`,
      evidence: {
        organizationId,
        organizationsInDatabase: counts.organizations,
        scopedRows,
        leaked: 0,
        withheldFromThisTenant: withheld,
        perQuery,
      },
    };
  },

  "phi-mode": async ({ attestations }) => {
    const synthetic = process.env.SYNTHETIC_DATA !== "false";
    if (synthetic) {
      return {
        status: "pass",
        detail:
          'This instance is in SYNTHETIC-DATA mode (SYNTHETIC_DATA is not "false"). No real patient data should be present, and the synthetic banner is shown to every user.',
        evidence: { mode: "synthetic", syntheticDataEnv: process.env.SYNTHETIC_DATA ?? null },
      };
    }
    const required = ["baa-hosting", "baa-database"];
    const missing = required.filter(
      (id) => attestations.get(id)?.status !== "met",
    );
    if (missing.length > 0) {
      return {
        status: "fail",
        detail: `This instance is in REAL-PHI mode (SYNTHETIC_DATA=false) but the required BAA attestation(s) are not recorded as met: ${missing.join(", ")}. Real patient data must not be entered until those contracts are in place.`,
        evidence: { mode: "real-phi", missingAttestations: missing },
      };
    }
    return {
      status: "warn",
      detail:
        "This instance is in REAL-PHI mode (SYNTHETIC_DATA=false). The hosting and database BAAs are attested, but every failing or warning control on this page now carries real patient risk and its severity is escalated accordingly.",
      evidence: { mode: "real-phi", missingAttestations: [] },
    };
  },

  "privileged-accounts": async ({ organizationId, store }) => {
    const users = await store.listUsers(organizationId);
    if (users.length === 0) {
      return {
        status: "unknown",
        detail: "This organization has no user rows, so privilege distribution cannot be measured.",
        evidence: { users: 0 },
      };
    }
    const byRole: Record<string, number> = {};
    for (const u of users) byRole[u.role] = (byRole[u.role] ?? 0) + 1;
    const root = byRole["developer"] ?? 0;
    const directors = (byRole["director"] ?? 0) + (byRole["er_director"] ?? 0);
    const privileged = root + directors;
    const share = privileged / users.length;
    if (privileged === 0) {
      return {
        status: "warn",
        detail: `None of this organization's ${users.length} account(s) hold a director or developer role — there is no accountable administrator for access reviews.`,
        evidence: { users: users.length, privileged: 0, byRole },
      };
    }
    const overLimit = share > PRIVILEGED_SHARE_LIMIT;
    return {
      status: overLimit ? "warn" : "pass",
      detail:
        `${privileged} of ${users.length} account(s) are privileged (${root} developer/root, ${directors} director-level) — ${(share * 100).toFixed(0)}% of the roster. ` +
        (overLimit
          ? `That exceeds the ${PRIVILEGED_SHARE_LIMIT * 100}% least-privilege guideline; review whether each still needs administrative rights.`
          : `That is within the ${PRIVILEGED_SHARE_LIMIT * 100}% least-privilege guideline.`),
      evidence: {
        users: users.length,
        privileged,
        rootAccounts: root,
        directorAccounts: directors,
        sharePct: Math.round(share * 1000) / 10,
        guidelinePct: PRIVILEGED_SHARE_LIMIT * 100,
        byRole,
      },
    };
  },

  "stale-accounts": async ({ organizationId, store }) => {
    const [users, lastActivity, audit] = await Promise.all([
      store.listUsers(organizationId),
      store.lastAuditActivityByUser(organizationId),
      store.auditStats(organizationId),
    ]);
    if (users.length === 0) {
      return {
        status: "unknown",
        detail: "This organization has no user rows to evaluate.",
        evidence: { users: 0 },
      };
    }
    const cutoff = Date.now() - STALE_WINDOW_DAYS * DAY_MS;
    const olderThanWindow = users.filter(
      (u) => new Date(u.createdAt).getTime() < cutoff,
    );
    const derivation =
      "There is no last_login column on users, so activity is derived from the audit trail — the only genuine signal this schema provides.";
    if (olderThanWindow.length === 0) {
      return {
        status: "pass",
        detail: `No account in this organization is older than ${STALE_WINDOW_DAYS} days (${users.length} account(s) total), so none can be dormant by that definition. ${derivation} Adding explicit last-login tracking would make this a first-class measurement.`,
        evidence: {
          users: users.length,
          accountsOlderThanWindow: 0,
          windowDays: STALE_WINDOW_DAYS,
          signal: "audit trail (no last_login column exists)",
          recommendation: "add last_login tracking to the users table",
        },
      };
    }
    const trailAgeDays = ageDays(audit.oldestAt) ?? 0;
    if (trailAgeDays < STALE_WINDOW_DAYS) {
      return {
        status: "unknown",
        detail: `${olderThanWindow.length} account(s) are older than ${STALE_WINDOW_DAYS} days, but the audit trail only reaches back ${trailAgeDays} day(s), so dormancy over that window cannot be established. ${derivation} A human must review the roster manually until last-login tracking is added.`,
        evidence: {
          users: users.length,
          accountsOlderThanWindow: olderThanWindow.length,
          auditTrailAgeDays: trailAgeDays,
          windowDays: STALE_WINDOW_DAYS,
          recommendation: "add last_login tracking to the users table",
        },
      };
    }
    const stale = olderThanWindow.filter((u) => {
      const last = lastActivity.get(u.id);
      return !last || last.getTime() < cutoff;
    });
    return {
      status: stale.length === 0 ? "pass" : "warn",
      detail:
        stale.length === 0
          ? `All ${olderThanWindow.length} account(s) older than ${STALE_WINDOW_DAYS} days show audited activity inside that window. ${derivation}`
          : `${stale.length} of ${olderThanWindow.length} account(s) older than ${STALE_WINDOW_DAYS} days show no audited activity in that window. ${derivation}`,
      evidence: {
        users: users.length,
        accountsOlderThanWindow: olderThanWindow.length,
        dormant: stale.length,
        dormantUserIds: stale.map((u) => u.id),
        windowDays: STALE_WINDOW_DAYS,
        auditTrailAgeDays: trailAgeDays,
        recommendation: "add last_login tracking to the users table",
      },
    };
  },

  /**
   * Reads the attachment store configuration this process is ACTUALLY using
   * (server/services/attachment-store.ts, resolved from env at call time).
   * Passes only when new uploads are written as AES-256-GCM ciphertext
   * (ATTACHMENT_STORE=fs-encrypted with a valid 32-byte ATTACHMENT_KEY). The
   * default base64-in-database store warns regardless of how many rows exist.
   * The row counts and bytes are real. Never reveals the key.
   */
  "attachment-storage": async ({ organizationId, store }) => {
    const s = await store.attachmentStats(organizationId);
    const cfg = attachmentStoreConfig();
    const encrypted = cfg.mode === "fs-encrypted" && cfg.ready;
    const volume =
      s.count === 0
        ? "No attachments are stored for this organization yet."
        : `${s.count} attachment(s) totalling ${mb(s.totalBytes)} are stored for this organization.`;
    const detail = encrypted
      ? `${volume} New uploads are written as AES-256-GCM ciphertext (random IV and auth tag per file) under the configured attachment directory; plaintext never reaches disk. Object storage under a BAA, antivirus scanning and signed-URL delivery remain the next step for real ePHI.`
      : cfg.mode === "fs-encrypted"
        ? `${volume} ATTACHMENT_STORE=fs-encrypted is requested but unusable (${cfg.problem}); uploads are refused rather than stored in plaintext. Set a valid 32-byte ATTACHMENT_KEY.`
        : `${volume} The upload path writes file bytes as base64 directly into the database row (ATTACHMENT_STORE=db). Real ePHI requires encrypted storage: set ATTACHMENT_STORE=fs-encrypted with ATTACHMENT_KEY, then move to object storage under a BAA with antivirus scanning and signed-URL delivery.`;
    return {
      status: encrypted ? "pass" : "warn",
      detail,
      evidence: {
        attachments: s.count,
        totalBytes: s.totalBytes,
        storeMode: cfg.mode,
        storeReady: cfg.ready,
        keyConfigured: cfg.keyConfigured,
        keyValid: cfg.keyValid,
        storage: encrypted
          ? "AES-256-GCM files under ATTACHMENT_DIR; row holds the fsenc: ref"
          : "base64 inline in message_attachments.data_base64",
        missingForRealPhi: encrypted
          ? [
              "encrypted object storage (S3/GCS) under a BAA",
              "server-side antivirus scanning on upload",
              "short-lived signed-URL delivery",
            ]
          : [
              "encrypted attachment store (ATTACHMENT_STORE=fs-encrypted + ATTACHMENT_KEY)",
              "encrypted object storage (S3/GCS) under a BAA",
              "server-side antivirus scanning on upload",
              "short-lived signed-URL delivery",
            ],
      },
    };
  },
};

export const AUTO_CHECKS: Readonly<Record<string, CheckFn>> = checks;

/**
 * Evaluate every automated control. A check that throws yields "unknown" with
 * the error text — never a pass, and never a silent omission.
 */
export async function runAutoChecks(
  ctx: CheckContext,
): Promise<Record<string, CheckResult>> {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([id, fn]) => {
      try {
        return [id, await fn(ctx)] as const;
      } catch (err) {
        return [
          id,
          {
            status: "unknown" as ControlStatus,
            detail: `This check could not be completed: ${(err as Error)?.message ?? "unknown error"}. A human must verify this control manually.`,
            evidence: { error: true },
          },
        ] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}
