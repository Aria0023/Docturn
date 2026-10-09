import { randomBytes } from "node:crypto";
import type { User } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { hashPassword } from "../auth.js";
import { isModuleEnabled } from "../modules.js";
import { storage, type DatabaseStorage } from "../storage.js";
import { amionUrlFromCredentials, readOrgCredentials } from "../integrations/credentials.js";
import { guardedFetch, integrationFetch, IntegrationCallError } from "../integrations/http.js";

/**
 * Amion on-call schedule sync — per hospital.
 *
 * A hospital's live Amion feed is an OCS URL of the form
 * `https://www.amion.com/cgi-bin/ocs?Lo=<token>...`. The token is a secret.
 * Each hospital can connect its OWN feed (Settings → Integrations → Amion),
 * stored encrypted (server/integrations/credentials.ts); the legacy
 * operator-level AMION_OCS_URL + AMION_ORG_CODE env still works for that one
 * org and is the fallback when the org has saved nothing. The URL/token is
 * never stored in plaintext, never written to a log line, and never returned
 * by any API response.
 *
 * The feed is either the classic HTML on-call day view (old-school table
 * markup) or, for report URLs (&Rpt= params), a plain-text delimited body.
 * Both are parsed by the same tolerant cell classifier below.
 */

export interface AmionRow {
  /** Slot / service name, e.g. "Tarzana 1", "North Triage". */
  slot: string;
  /** Raw hours token, e.g. "7a-7p", "2p-10p", "7p-7a". */
  hrs: string;
  /** Provider as published: "Last, First". */
  name: string;
  /** Group / division, e.g. "ISP North", "Lead Hospitalist", "Moonlighter". */
  group: string;
  /** True when the row says "Secure message to Amion app" (app-onboarded). */
  secure: boolean;
  /** DocTurn shift type derived from the hours token. */
  shift: "day" | "swing" | "night";
}

export interface AmionSyncState {
  lastSyncAt: string | null;
  lastStatus: "ok" | "error";
  lastError: string | null;
  rowCount: number;
  providers: AmionRow[];
}

export const SYNC_SETTING_KEY = "amionSync";

/** Env-driven configuration. The URL (with its Lo= token) is env-only. */
export function amionConfig() {
  return {
    url: process.env.AMION_OCS_URL ?? "",
    orgCode: process.env.AMION_ORG_CODE ?? "ISPN",
    intervalMin: Number(process.env.AMION_SYNC_INTERVAL_MIN ?? "") || 240,
  };
}

/** True when the legacy operator-level env feed is set (one org: AMION_ORG_CODE). */
export function amionConfigured(): boolean {
  return !!amionConfig().url;
}

/** Where an org's Amion feed comes from. `url` is SECRET — never log or return it. */
export interface AmionFeed {
  orgId: number;
  url: string;
  source: "organization" | "env";
}

/**
 * The org's feed: its own saved credentials FIRST, else the operator's env
 * feed when this org is AMION_ORG_CODE. Saved credentials that cannot be
 * decrypted (INTEGRATION_KEY missing or changed) count as absent.
 */
export async function amionFeedFor(db: DatabaseStorage, orgId: number): Promise<AmionFeed | null> {
  const creds = await readOrgCredentials(db, orgId, "amion");
  if (creds.state === "ok") {
    const url = amionUrlFromCredentials(creds.values);
    if (url) return { orgId, url, source: "organization" };
  }
  const cfg = amionConfig();
  if (!cfg.url) return null;
  const org = await db.getOrganization(orgId);
  if (org && org.code === cfg.orgCode) return { orgId, url: cfg.url, source: "env" };
  return null;
}

/** Every org with a feed: each one with saved credentials + the env org. */
export async function amionFeeds(db: DatabaseStorage): Promise<AmionFeed[]> {
  const ids = new Set<number>((await db.listIntegrationCredentials("amion")).map((r) => r.organizationId));
  const cfg = amionConfig();
  if (cfg.url) {
    const envOrg = await db.getOrganizationByCode(cfg.orgCode);
    if (envOrg) ids.add(envOrg.id);
  }
  const out: AmionFeed[] = [];
  for (const id of [...ids].sort((a, b) => a - b)) {
    const feed = await amionFeedFor(db, id);
    if (feed) out.push(feed);
  }
  return out;
}

// Amion hours token → DocTurn shift type. Unknown intervals default to day.
const HOURS_TO_SHIFT: Record<string, AmionRow["shift"]> = {
  "7a-7p": "day",
  "2p-10p": "swing",
  "4p-12a": "swing",
  "7p-7a": "night",
  "11p-7a": "night",
};
const HOURS_RE = /\b\d{1,2}[ap]\s*-\s*\d{1,2}[ap]\b/i;

export function mapHoursToShift(hrs: string): AmionRow["shift"] {
  return HOURS_TO_SHIFT[hrs.toLowerCase().replace(/\s+/g, "")] ?? "day";
}

const SECURE_READY = /secure message to amion app/i;
const SECURE_NOT_READY = /not ready to receive secure messages/i;
// "Last, First" (allowing hyphens/apostrophes/middle initials) — slot and group
// names never contain a comma, so this reliably picks the provider cell.
const PROVIDER_RE = /^[A-Za-z][A-Za-z'.\- ]*,\s+[A-Za-z][A-Za-z'.\- ]*$/;

/** Minimal HTML entity decode for the handful Amion pages actually use. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Strip tags from an HTML fragment and collapse whitespace. */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Classify one row's cells (already tag-stripped) into an AmionRow.
 * Tolerant of column order and extra cells: the hours cell is found by its
 * time-token shape, the provider by its "Last, First" shape, the
 * secure-messaging flag by its phrase; the slot is the first remaining cell
 * and the group the next. Returns null for header/blank/non-provider rows.
 */
function classifyCells(cells: string[]): AmionRow | null {
  const text = cells.join(" ");
  const provIdx = cells.findIndex((c) => PROVIDER_RE.test(c));
  if (provIdx < 0) return null; // header, separator, or footnote row

  const hrsIdx = cells.findIndex((c, i) => i !== provIdx && HOURS_RE.test(c));
  const hrsMatch = (hrsIdx >= 0 ? cells[hrsIdx]! : text).match(HOURS_RE);
  const hrs = hrsMatch ? hrsMatch[0].toLowerCase().replace(/\s+/g, "") : "";

  const isSecureCell = (c: string) => SECURE_READY.test(c) || SECURE_NOT_READY.test(c);
  const rest = cells
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => i !== provIdx && i !== hrsIdx && c && !isSecureCell(c));
  const slot = rest[0]?.c ?? "";
  const group = rest[1]?.c ?? "";
  if (!slot) return null;

  return {
    slot,
    hrs,
    name: cells[provIdx]!,
    group,
    secure: SECURE_READY.test(text),
    shift: mapHoursToShift(hrs),
  };
}

function parseHtmlGrid(html: string): AmionRow[] {
  const rows: AmionRow[] = [];
  // Old-school Amion table markup: walk each <tr>, split its cells, strip tags.
  const trs = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const tr of trs) {
    const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?(?:<\/t[dh]>|(?=<t[dh][^>]*>)|$)/gi) ?? [])
      .map(stripTags);
    const row = classifyCells(cells);
    if (row) rows.push(row);
  }
  return rows;
}

function parseTextGrid(body: string): AmionRow[] {
  const rows: AmionRow[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Tab-separated is the native report format; also accept " | " delimiters.
    const cells = (line.includes("\t") ? line.split("\t") : line.split(/\s*\|\s*/))
      .map((c) => decodeEntities(c).trim());
    const row = classifyCells(cells);
    if (row) rows.push(row);
  }
  return rows;
}

/** Parse either body shape (HTML table page or delimited report text). */
export function parseAmionBody(body: string, contentType = ""): AmionRow[] {
  const looksHtml = /<tr[\s>]/i.test(body) || /text\/html/i.test(contentType);
  return looksHtml ? parseHtmlGrid(body) : parseTextGrid(body);
}

/**
 * GET the Amion OCS URL and parse the on-call grid out of the response.
 * Bounded (10 s) and injectable (server/integrations/http.ts). A URL a
 * hospital typed in (`guarded`) may only reach a public https host.
 */
export async function fetchAmionGrid(url: string, opts: { guarded?: boolean } = {}): Promise<AmionRow[]> {
  let res: Response;
  try {
    res = opts.guarded ? await guardedFetch(url) : await integrationFetch(url, { redirect: "follow" });
  } catch (err) {
    if (err instanceof IntegrationCallError) throw new Error(`amion_${err.code}`);
    throw err;
  }
  if (!res.ok) throw new Error(`amion_http_${res.status}`);
  const body = await res.text();
  const rows = parseAmionBody(body, res.headers.get("content-type") ?? "");
  if (!rows.length) throw new Error("amion_empty_grid");
  return rows;
}

/** "Last, First" → "First Last" (pass through anything already plain). */
export function toDisplayName(published: string): string {
  const m = published.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]!.trim()} ${m[1]!.trim()}` : published.trim();
}

// Match Amion names against existing accounts regardless of the "Dr." prefix
// or casing (the seeded roster stores e.g. "Dr. Nathan Alyesh"). Shared with
// the schedule-source adapters so every source resolves names the same way.
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/^dr\.?\s+/, "").replace(/\s+/g, " ").trim();
}

function usernameFor(name: string): string {
  return (
    name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 24) ||
    `amion${Date.now()}`
  );
}

// A secret's fingerprint must never leak via error messages (fetch errors can
// embed the request URL). Mask the token and the whole URL before persisting.
function sanitizeError(err: unknown, url: string): string {
  let msg = err instanceof Error ? err.message : String(err);
  if (url) {
    msg = msg.split(url).join("<AMION_OCS_URL>");
    // The login alone (credentials saved as "login") must not survive either.
    const lo = url.match(/[?&]Lo=([^&]+)/i)?.[1];
    if (lo) {
      for (const form of new Set([lo, safeDecode(lo)])) if (form.length >= 3) msg = msg.split(form).join("<redacted>");
    }
  }
  return msg.replace(/([?&]Lo=)[^&\s]+/gi, "$1<redacted>").slice(0, 300);
}
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Pull the live grid and reconcile it into the org's roster. Additive + update
 * only: providers on the grid are created (user + hospitalist profile) or
 * updated (shiftType, working=true); providers absent from the grid are left
 * untouched so manually-managed rosters survive every sync.
 */
export async function syncAmion(
  db: DatabaseStorage,
  opts: { actorUserId?: number; orgId?: number } = {},
): Promise<AmionSyncState> {
  // Which org: the one asked for, else (legacy callers) the env AMION_ORG_CODE org.
  let orgId = opts.orgId;
  if (orgId == null) {
    const cfg = amionConfig();
    if (!cfg.url) throw new Error("amion_not_configured");
    const envOrg = await db.getOrganizationByCode(cfg.orgCode);
    if (!envOrg) throw new Error("amion_org_not_found");
    orgId = envOrg.id;
  }
  const org = await db.getOrganization(orgId);
  if (!org) throw new Error("amion_org_not_found");
  // The org's OWN saved feed first, the operator's env feed as the fallback.
  const feed = await amionFeedFor(db, org.id);
  if (!feed) throw new Error("amion_not_configured");
  const cfg = { url: feed.url };
  // The org-settings row is nullable on updated_by; scheduled syncs have no actor.
  const updatedBy = (opts.actorUserId ?? null) as unknown as number;

  let rows: AmionRow[];
  try {
    rows = await fetchAmionGrid(feed.url, { guarded: feed.source === "organization" });
  } catch (err) {
    // Record the failure but keep the last good snapshot for the UI.
    const prev = ((await db.getOrgSetting(org.id, SYNC_SETTING_KEY)) ?? {}) as Partial<AmionSyncState>;
    const state: AmionSyncState = {
      lastSyncAt: new Date().toISOString(),
      lastStatus: "error",
      lastError: sanitizeError(err, cfg.url),
      rowCount: prev.rowCount ?? 0,
      providers: prev.providers ?? [],
    };
    await db.setOrgSetting(org.id, SYNC_SETTING_KEY, state, updatedBy);
    await appendAudit({
      organizationId: org.id,
      userId: opts.actorUserId ?? null,
      action: "amion.sync",
      resourceType: "org_settings",
      resourceId: null,
      details: { status: "error", error: state.lastError },
      riskLevel: "low",
    });
    return state;
  }

  // Dedupe by person — the same provider may hold two slots (e.g. a triage
  // slot on top of a numbered one); they are ONE user in DocTurn.
  const unique = new Map<string, AmionRow>();
  for (const row of rows) {
    const key = normalizeName(toDisplayName(row.name));
    if (!unique.has(key)) unique.set(key, row);
  }

  const users = await db.listUsers(org.id);
  const byName = new Map<string, User>();
  for (const u of users) {
    const key = normalizeName(u.displayName);
    if (!byName.has(key)) byName.set(key, u);
  }

  let created = 0;
  let updated = 0;
  for (const [key, row] of unique) {
    const displayName = toDisplayName(row.name);
    let user = byName.get(key);
    if (!user) {
      // New provider from the grid: real hospitalist account. The password is
      // random and discarded — sign-in is provisioned separately by the org.
      let username = usernameFor(displayName);
      for (let i = 2; await db.getUserByUsername(org.id, username); i++) {
        username = `${usernameFor(displayName)}${i}`;
      }
      user = await db.createUser({
        organizationId: org.id,
        username,
        passwordHash: await hashPassword(randomBytes(32).toString("hex")),
        role: "hospitalist",
        displayName,
        credential: null,
        phone: null,
        twoFactorEnabled: false,
        // Unusable until a director issues a one-time password
        // (POST /api/accounts/:id/reset-password), which then must be changed.
        mustChangePassword: true,
      });
      byName.set(key, user);
    }
    const profile = await db.getHospitalistByUser(org.id, user.id);
    if (profile) {
      if (profile.shiftType !== row.shift || !profile.working) {
        await db.updateHospitalist(org.id, profile.id, { shiftType: row.shift, working: true });
      }
      updated++;
    } else {
      const existing = await db.listHospitalists(org.id);
      await db.createHospitalist({
        organizationId: org.id,
        userId: user.id,
        specialty: row.group || "Hospital Medicine",
        currentPatientCount: 0,
        patientCap: 12,
        rotationOrder: existing.length,
        working: true,
        shiftType: row.shift,
      });
      created++;
    }
  }

  const state: AmionSyncState = {
    lastSyncAt: new Date().toISOString(),
    lastStatus: "ok",
    lastError: null,
    rowCount: rows.length,
    providers: rows,
  };
  await db.setOrgSetting(org.id, SYNC_SETTING_KEY, state, updatedBy);
  await appendAudit({
    organizationId: org.id,
    userId: opts.actorUserId ?? null,
    action: "amion.sync",
    resourceType: "org_settings",
    resourceId: null,
    details: {
      status: "ok",
      rowCount: rows.length,
      uniqueProviders: unique.size,
      created,
      updated,
      trigger: opts.actorUserId ? "manual" : "scheduled",
    },
    riskLevel: "low",
  });
  return state;
}

/**
 * Status for the UI. Tenant-scoped: only users of the Amion-configured org
 * (or a developer) see the feed — everyone else gets `configured: false`.
 * The AMION_OCS_URL (and its token) never appears here.
 */
/**
 * The org whose feed a caller acts on: their own. A developer without a feed
 * in the platform org acts on the legacy env org (the console's old view).
 */
export async function amionTargetOrgId(
  db: DatabaseStorage,
  me: { organizationId: number; role: string },
): Promise<number> {
  if (me.role !== "developer" || (await amionFeedFor(db, me.organizationId))) return me.organizationId;
  const cfg = amionConfig();
  const envOrg = cfg.url ? await db.getOrganizationByCode(cfg.orgCode) : undefined;
  return envOrg?.id ?? me.organizationId;
}

export async function getAmionStatus(
  db: DatabaseStorage,
  me: { organizationId: number; role: string },
): Promise<{ configured: boolean } & AmionSyncState> {
  const empty: AmionSyncState = {
    lastSyncAt: null,
    lastStatus: "ok",
    lastError: null,
    rowCount: 0,
    providers: [],
  };
  const orgId = await amionTargetOrgId(db, me);
  const feed = await amionFeedFor(db, orgId);
  if (!feed) return { configured: false, ...empty };
  const state = ((await db.getOrgSetting(orgId, SYNC_SETTING_KEY)) ?? empty) as AmionSyncState;
  return { configured: true, ...empty, ...state };
}

// ── boot loop ─────────────────────────────────────────────────────────────────
// One sync shortly after boot (never blocking startup), then on the configured
// interval. Both timers are unref'd so they never keep the process alive.
let bootTimer: NodeJS.Timeout | null = null;
let loopTimer: NodeJS.Timeout | null = null;

export type ScheduledAmionSyncOutcome =
  | "synced"
  | "skipped_not_configured"
  | "skipped_org_missing"
  | "skipped_module_off"
  | "failed";

/**
 * One scheduled tick over EVERY org with a feed (its own saved credentials, or
 * the env org). Each org syncs ONLY while its `schedule.amion` module is on —
 * switching it off (Settings → Integrations, or the developer console) stops
 * that org's pulls (and the board stops serving Amion slots, see
 * schedule-sources/index.ts) without touching the stored snapshot, so
 * switching it back on resumes seamlessly. One org's failure never stops the
 * others.
 */
export async function runScheduledAmionSyncAll(
  db: DatabaseStorage = storage(),
): Promise<Array<{ orgId: number; outcome: ScheduledAmionSyncOutcome }>> {
  const out: Array<{ orgId: number; outcome: ScheduledAmionSyncOutcome }> = [];
  for (const feed of await amionFeeds(db)) {
    if (!(await isModuleEnabled(feed.orgId, "schedule.amion"))) {
      out.push({ orgId: feed.orgId, outcome: "skipped_module_off" });
      continue;
    }
    try {
      await syncAmion(db, { orgId: feed.orgId });
      out.push({ orgId: feed.orgId, outcome: "synced" });
    } catch (err) {
      console.error(`[amion] sync failed for org ${feed.orgId}:`, sanitizeError(err, feed.url));
      out.push({ orgId: feed.orgId, outcome: "failed" });
    }
  }
  return out;
}

/**
 * Aggregate of one tick (kept for callers that want a single word): "synced"
 * when any org synced; "failed" when an attempted sync threw;
 * "skipped_module_off" when every connected org has the module off;
 * "skipped_org_missing" when only the env feed exists and its AMION_ORG_CODE
 * matches no org; else "skipped_not_configured".
 */
export async function runScheduledAmionSync(
  db: DatabaseStorage = storage(),
): Promise<ScheduledAmionSyncOutcome> {
  const results = await runScheduledAmionSyncAll(db);
  if (results.some((r) => r.outcome === "synced")) return "synced";
  if (results.some((r) => r.outcome === "failed")) return "failed";
  if (results.length) return "skipped_module_off";
  const cfg = amionConfig();
  if (cfg.url && !(await db.getOrganizationByCode(cfg.orgCode))) return "skipped_org_missing";
  return "skipped_not_configured";
}

/**
 * Start the background loop. It always runs (cheap when nothing is
 * connected), so a hospital that saves its Amion credentials at runtime is
 * picked up on the next tick without a restart.
 */
export function startAmionSyncLoop() {
  if (loopTimer) return;
  const intervalMin = amionConfig().intervalMin;
  // Log each org's module-off skip once per off-period, not on every tick.
  const announcedOff = new Set<number>();
  const run = () => {
    runScheduledAmionSyncAll()
      .then((results) => {
        for (const r of results) {
          if (r.outcome === "skipped_module_off") {
            if (!announcedOff.has(r.orgId)) {
              console.log(`[amion] scheduled sync paused for org ${r.orgId} — schedule.amion is switched off; resumes when switched back on`);
              announcedOff.add(r.orgId);
            }
          } else if (announcedOff.delete(r.orgId) && r.outcome === "synced") {
            console.log(`[amion] scheduled sync resumed for org ${r.orgId}`);
          }
        }
      })
      .catch((err) => console.error("[amion] scheduled sync tick failed:", err instanceof Error ? err.name : "error"));
  };
  bootTimer = setTimeout(run, 5_000);
  bootTimer.unref?.();
  loopTimer = setInterval(run, intervalMin * 60_000);
  loopTimer.unref?.();
  console.log(`[amion] schedule sync loop — every ${intervalMin} min for each org with a connected feed and schedule.amion on`);
}

export function stopAmionSyncLoop() {
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
}
