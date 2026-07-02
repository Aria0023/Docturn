import { randomBytes } from "node:crypto";
import type { User } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { hashPassword } from "../auth.js";
import { storage, type DatabaseStorage } from "../storage.js";

/**
 * Amion on-call schedule sync.
 *
 * The org's live Amion feed is an OCS URL of the form
 * `https://www.amion.com/cgi-bin/ocs?Lo=<token>...`. The token is a secret and
 * lives ONLY in the AMION_OCS_URL env var — it is never stored in the database,
 * never written to a log line, and never returned by any API response.
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

const SYNC_SETTING_KEY = "amionSync";

/** Env-driven configuration. The URL (with its Lo= token) is env-only. */
export function amionConfig() {
  return {
    url: process.env.AMION_OCS_URL ?? "",
    orgCode: process.env.AMION_ORG_CODE ?? "ISPN",
    intervalMin: Number(process.env.AMION_SYNC_INTERVAL_MIN ?? "") || 240,
  };
}

export function amionConfigured(): boolean {
  return !!amionConfig().url;
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

/** GET the Amion OCS URL and parse the on-call grid out of the response. */
export async function fetchAmionGrid(url: string): Promise<AmionRow[]> {
  const res = await fetch(url, { redirect: "follow" });
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
// or casing (the seeded roster stores e.g. "Dr. Nathan Alyesh").
function normalizeName(name: string): string {
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
  if (url) msg = msg.split(url).join("<AMION_OCS_URL>");
  return msg.replace(/([?&]Lo=)[^&\s]+/gi, "$1<redacted>").slice(0, 300);
}

/**
 * Pull the live grid and reconcile it into the org's roster. Additive + update
 * only: providers on the grid are created (user + hospitalist profile) or
 * updated (shiftType, working=true); providers absent from the grid are left
 * untouched so manually-managed rosters survive every sync.
 */
export async function syncAmion(
  db: DatabaseStorage,
  opts: { actorUserId?: number } = {},
): Promise<AmionSyncState> {
  const cfg = amionConfig();
  if (!cfg.url) throw new Error("amion_not_configured");
  const org = await db.getOrganizationByCode(cfg.orgCode);
  if (!org) throw new Error("amion_org_not_found");
  // The org-settings row is nullable on updated_by; scheduled syncs have no actor.
  const updatedBy = (opts.actorUserId ?? null) as unknown as number;

  let rows: AmionRow[];
  try {
    rows = await fetchAmionGrid(cfg.url);
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
  const cfg = amionConfig();
  if (!cfg.url) return { configured: false, ...empty };
  const org = await db.getOrganizationByCode(cfg.orgCode);
  if (!org || (me.role !== "developer" && me.organizationId !== org.id)) {
    return { configured: false, ...empty };
  }
  const state = ((await db.getOrgSetting(org.id, SYNC_SETTING_KEY)) ?? empty) as AmionSyncState;
  return { configured: true, ...empty, ...state };
}

// ── boot loop ─────────────────────────────────────────────────────────────────
// One sync shortly after boot (never blocking startup), then on the configured
// interval. Both timers are unref'd so they never keep the process alive.
let bootTimer: NodeJS.Timeout | null = null;
let loopTimer: NodeJS.Timeout | null = null;

export function startAmionSyncLoop() {
  const cfg = amionConfig();
  if (!cfg.url || loopTimer) return;
  const run = () => {
    syncAmion(storage()).catch((err) =>
      console.error("[amion] sync failed:", sanitizeError(err, cfg.url)),
    );
  };
  bootTimer = setTimeout(run, 5_000);
  bootTimer.unref?.();
  loopTimer = setInterval(run, cfg.intervalMin * 60_000);
  loopTimer.unref?.();
  console.log(
    `[amion] schedule sync enabled — org ${cfg.orgCode}, every ${cfg.intervalMin} min`,
  );
}

export function stopAmionSyncLoop() {
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
}
