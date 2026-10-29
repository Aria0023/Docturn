import { randomBytes } from "node:crypto";
import type { User } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { hashPassword } from "../auth.js";
import { isModuleEnabled } from "../modules.js";
import { storage, type DatabaseStorage } from "../storage.js";
import { amionUrlFromCredentials, feedVersionOf, readOrgCredentials, syncBelongsTo } from "../integrations/credentials.js";
import { guardedFetch, integrationFetch, IntegrationCallError } from "../integrations/http.js";
import { skipWhileRunning } from "../integrations/single-flight.js";
import { broadcastRotationChange } from "./notifications.js";
import { SCHEDULE_SOURCE_IDS, SOURCE_SETTING_KEY } from "./schedule-sources/types.js";

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
  /**
   * Whether this pull changed the rotation (put the grid's providers on
   * shift). False when the pull only refreshed the snapshot because Amion
   * does not drive this org's rotation (see amionRotationGate), or failed.
   * Absent on snapshots stored before this was recorded.
   */
  rotationApplied?: boolean;
  /** Why it did not (null when it did, or when the pull failed). */
  rotationSkipped?: Exclude<AmionRotationGate, "applies"> | null;
  /**
   * Which feed this pull read (AmionFeed.version — never the URL). Readers
   * ignore a state from another version: the credentials were replaced or
   * removed since. Absent on states stored before this was recorded.
   */
  feedVersion?: string;
}

/**
 * May an Amion pull change this org's rotation (who is on shift, and on which
 * shift)? Only while ALL of these hold — the same things the director's
 * dashboard states (A.CON schedule #1):
 *   - schedule.amion is on ("module_off" otherwise);
 *   - the on-call board is on ("board_off": the dashboard says no schedule
 *     source is read);
 *   - Amion is the org's schedule source: the director picked it, or picked
 *     nothing and the org has a connected feed (the board's own default,
 *     schedule-sources/index.ts defaultSourceFor). A director who picked the
 *     Manual list or Epic gets "not_selected": the dashboard says no feed
 *     changes who is on shift, and none does.
 */
export type AmionRotationGate = "applies" | "module_off" | "board_off" | "not_selected";
export async function amionRotationGate(db: DatabaseStorage, orgId: number): Promise<AmionRotationGate> {
  if (!(await isModuleEnabled(orgId, "schedule.amion"))) return "module_off";
  if (!(await isModuleEnabled(orgId, "oncall.board"))) return "board_off";
  const chosen = await db.getOrgSetting(orgId, SOURCE_SETTING_KEY);
  if (typeof chosen === "string" && (SCHEDULE_SOURCE_IDS as readonly string[]).includes(chosen) && chosen !== "amion") {
    return "not_selected";
  }
  return "applies";
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
  /** Non-secret id of this connection (feedVersionOf) — stored with each sync. */
  version: string;
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
    if (url) return { orgId, url, source: "organization", version: feedVersionOf("organization", creds.row) };
  }
  const cfg = amionConfig();
  if (!cfg.url) return null;
  const org = await db.getOrganization(orgId);
  if (org && org.code === cfg.orgCode) return { orgId, url: cfg.url, source: "env", version: feedVersionOf("env") };
  return null;
}

/**
 * The org's stored sync state — only when it was made with the org's CURRENT
 * feed. Null when there is no feed, no sync yet, or the stored one came from
 * credentials that were replaced or removed since.
 */
export async function readAmionSync(
  db: DatabaseStorage,
  orgId: number,
  feed?: AmionFeed | null,
): Promise<Partial<AmionSyncState> | null> {
  const current = feed === undefined ? await amionFeedFor(db, orgId) : feed;
  const raw = (await db.getOrgSetting(orgId, SYNC_SETTING_KEY)) as Partial<AmionSyncState> | null;
  return current && syncBelongsTo(raw, current.version) ? raw : null;
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
 * Bounded end to end — one ≤ 10 s deadline over headers AND body, body
 * ≤ 5 MB, already read into memory when it returns — and injectable
 * (server/integrations/http.ts). A URL a hospital typed in (`guarded`) may
 * only reach a public https host.
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
  // A pull only changes the rotation while Amion drives it; otherwise (an
  // explicit Sync now with another source selected, or the board off) it
  // refreshes the snapshot and touches nobody's shift.
  const gate = await amionRotationGate(db, org.id);
  const applies = gate === "applies";

  let rows: AmionRow[];
  try {
    rows = await fetchAmionGrid(feed.url, { guarded: feed.source === "organization" });
  } catch (err) {
    // Record the failure but keep the last good snapshot for the UI — only
    // this feed's: another feed's grid is not this one's.
    const prev = (await readAmionSync(db, org.id, feed)) ?? {};
    const state: AmionSyncState = {
      lastSyncAt: new Date().toISOString(),
      lastStatus: "error",
      lastError: sanitizeError(err, cfg.url),
      rowCount: prev.rowCount ?? 0,
      providers: prev.providers ?? [],
      rotationApplied: false,
      rotationSkipped: null,
      feedVersion: feed.version,
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
  let rotationChanged = false; // a shift / on-shift change or a new provider
  for (const [key, row] of applies ? unique : new Map<string, AmionRow>()) {
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
        rotationChanged = true;
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
      rotationChanged = true;
    }
  }

  const state: AmionSyncState = {
    lastSyncAt: new Date().toISOString(),
    lastStatus: "ok",
    lastError: null,
    rowCount: rows.length,
    providers: rows,
    rotationApplied: applies,
    rotationSkipped: applies ? null : gate,
    feedVersion: feed.version,
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
      rotationApplied: applies,
      ...(applies ? {} : { rotationSkipped: gate }),
      trigger: opts.actorUserId ? "manual" : "scheduled",
    },
    riskLevel: "low",
  });
  // The synced grid moved someone on shift / to another shift: every open
  // session's "Next up" must re-read the planner (A.CON-SHO-29).
  if (rotationChanged) broadcastRotationChange(org.id);
  return state;
}

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

/**
 * The feed (and so the tenant) a caller's status read is about: the
 * amionTargetOrgId org while it has a feed, else null (no feed, or the env
 * AMION_ORG_CODE names no org). The one place status reads and their
 * developer audit resolve "which tenant is this" — GET /api/amion/status
 * audits a developer whose feed.orgId is not their own org before reading.
 */
export async function amionStatusFeed(
  db: DatabaseStorage,
  me: { organizationId: number; role: string },
): Promise<AmionFeed | null> {
  return amionFeedFor(db, await amionTargetOrgId(db, me));
}

/**
 * Status for the UI. Tenant-scoped: each caller sees their own org's feed
 * (its saved credentials, or the env feed when it is AMION_ORG_CODE) — a
 * caller whose org has none gets `configured: false`. A developer with no
 * feed of their own sees the env org's feed; from outside that org this is a
 * CROSS-TENANT read (the tenant's provider schedule): GET /api/amion/status
 * audits it as dev.amion_status_read in that org before calling this.
 * The feed URL (and its token) never appears here.
 */
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
  const feed = await amionStatusFeed(db, me);
  if (!feed) return { configured: false, ...empty };
  // A pull made with replaced or removed credentials is not this feed's status.
  const state = (await readAmionSync(db, feed.orgId, feed)) ?? empty;
  const { feedVersion: _v, ...shown } = state;
  return { configured: true, ...empty, ...shown };
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
  | "skipped_board_off"
  | "skipped_not_selected"
  | "failed";

const GATE_OUTCOME: Record<Exclude<AmionRotationGate, "applies">, ScheduledAmionSyncOutcome> = {
  module_off: "skipped_module_off",
  board_off: "skipped_board_off",
  not_selected: "skipped_not_selected",
};

/**
 * One scheduled tick over EVERY org with a feed (its own saved credentials, or
 * the env org). Each org is pulled ONLY while Amion drives its rotation
 * (amionRotationGate): schedule.amion on, the on-call board on, and Amion its
 * schedule source. Anything else — the module off, the board off, the Manual
 * list or Epic picked — skips the org entirely (nothing fetched, nobody's
 * shift touched), without touching the stored snapshot, so turning it back
 * on resumes seamlessly. Before, the pull ran whatever the director had
 * picked and put people back on shift behind a dashboard that said "Manual
 * list … no feed updates it" (A.CON schedule #1). The orgs sync
 * CONCURRENTLY, each under its own fetch deadline, so one hospital's slow
 * feed never delays another's; one org's failure never stops the others.
 */
export async function runScheduledAmionSyncAll(
  db: DatabaseStorage = storage(),
): Promise<Array<{ orgId: number; outcome: ScheduledAmionSyncOutcome }>> {
  const feeds = await amionFeeds(db);
  const settled = await Promise.allSettled(
    feeds.map(async (feed): Promise<ScheduledAmionSyncOutcome> => {
      const gate = await amionRotationGate(db, feed.orgId);
      if (gate !== "applies") return GATE_OUTCOME[gate];
      await syncAmion(db, { orgId: feed.orgId });
      return "synced";
    }),
  );
  return settled.map((r, i) => {
    const feed = feeds[i]!;
    if (r.status === "fulfilled") return { orgId: feed.orgId, outcome: r.value };
    console.error(`[amion] sync failed for org ${feed.orgId}:`, sanitizeError(r.reason, feed.url));
    return { orgId: feed.orgId, outcome: "failed" as const };
  });
}

/**
 * Aggregate of one tick (kept for callers that want a single word): "synced"
 * when any org synced; "failed" when an attempted sync threw; when every
 * connected org was skipped, the first reason in the order module off →
 * board off → another source selected; "skipped_org_missing" when only the
 * env feed exists and its AMION_ORG_CODE matches no org; else
 * "skipped_not_configured".
 */
export async function runScheduledAmionSync(
  db: DatabaseStorage = storage(),
): Promise<ScheduledAmionSyncOutcome> {
  const results = await runScheduledAmionSyncAll(db);
  if (results.some((r) => r.outcome === "synced")) return "synced";
  if (results.some((r) => r.outcome === "failed")) return "failed";
  for (const o of ["skipped_module_off", "skipped_board_off", "skipped_not_selected"] as const) {
    if (results.some((r) => r.outcome === o)) return o;
  }
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
  // Log each org's skip once per paused period, not on every tick.
  const announcedOff = new Map<number, ScheduledAmionSyncOutcome>();
  const WHY: Partial<Record<ScheduledAmionSyncOutcome, string>> = {
    skipped_module_off: "schedule.amion is switched off",
    skipped_board_off: "the on-call board is switched off",
    skipped_not_selected: "another schedule source is selected",
  };
  // A tick is skipped while the previous one is still running (never two
  // overlapping runs against the same hospitals).
  const run = skipWhileRunning(() =>
    runScheduledAmionSyncAll()
      .then((results) => {
        for (const r of results) {
          const why = WHY[r.outcome];
          if (why) {
            if (announcedOff.get(r.orgId) !== r.outcome) {
              console.log(`[amion] scheduled sync paused for org ${r.orgId} — ${why}; resumes when Amion drives its rotation again`);
              announcedOff.set(r.orgId, r.outcome);
            }
          } else if (announcedOff.delete(r.orgId) && r.outcome === "synced") {
            console.log(`[amion] scheduled sync resumed for org ${r.orgId}`);
          }
        }
      })
      .catch((err) => console.error("[amion] scheduled sync tick failed:", err instanceof Error ? err.name : "error")),
  );
  bootTimer = setTimeout(run, 5_000);
  bootTimer.unref?.();
  loopTimer = setInterval(run, intervalMin * 60_000);
  loopTimer.unref?.();
  console.log(`[amion] schedule sync loop — every ${intervalMin} min for each org with a connected feed, schedule.amion and the on-call board on, and Amion as its schedule source`);
}

export function stopAmionSyncLoop() {
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
}
