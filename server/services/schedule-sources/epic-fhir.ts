import { createSign, randomUUID } from "node:crypto";
import { appendAudit } from "../../audit.js";
import type { DatabaseStorage } from "../../storage.js";
import { mapHoursToShift, normalizeName } from "../amion.js";
import type { OnCallSlot, ScheduleSource, ScheduleSourceStatus, ShiftType } from "./types.js";

/**
 * Epic on-call via FHIR R4 — SMART Backend Services (system-level OAuth 2.0
 * with a client_credentials grant authenticated by a signed JWT assertion).
 *
 * What Epic needs before this goes live (all obtained from the health system's
 * Epic team / Epic's vendor programme — nothing here fakes it):
 *   1. A registered backend-services app (Epic "App Orchard" / Vendor Services
 *      registration, now "Epic on FHIR"), with the app's PUBLIC key uploaded
 *      (or a JWKS URL) and the PractitionerRole / Practitioner / Schedule /
 *      Slot read scopes approved (system/PractitionerRole.read etc.).
 *   2. The Client ID Epic issues for that app (non-production and production
 *      IDs differ) → EPIC_CLIENT_ID.
 *   3. The matching PRIVATE key (RSA, PEM) → EPIC_PRIVATE_KEY_PEM. Epic requires
 *      RS384 signatures.
 *   4. The health system's FHIR base URL, e.g.
 *      https://<epic-host>/interconnect-fhir-oauth/api/FHIR/R4 → EPIC_FHIR_BASE_URL,
 *      and its token endpoint (…/oauth2/token) → EPIC_TOKEN_URL (derived from
 *      the base URL when omitted).
 *   5. The organization the credentials belong to → EPIC_ORG_CODE (default ISPN,
 *      mirroring AMION_ORG_CODE) so tenants never share a feed.
 *
 * The private key and client id live ONLY in env: never in the database, never
 * logged, never returned by any API response. The client is fully testable
 * offline: `fetchImpl` is injectable and tests feed it a fixture bundle.
 */

export const EPIC_SETTING_KEY = "epicSync";
const ASSERTION_TTL_S = 4 * 60; // Epic caps JWT exp at 5 minutes from now
const FETCH_TIMEOUT_MS = 15_000;

export interface EpicConfig {
  baseUrl: string;
  clientId: string;
  privateKeyPem: string;
  tokenUrl: string;
  orgCode: string;
  intervalMin: number;
}

export function epicConfig(env: NodeJS.ProcessEnv = process.env): EpicConfig {
  const baseUrl = (env.EPIC_FHIR_BASE_URL ?? "").replace(/\/+$/, "");
  // Epic's token endpoint sits beside the FHIR base: …/interconnect-fhir-oauth/oauth2/token
  const derivedToken = baseUrl ? baseUrl.replace(/\/api\/FHIR\/R4$/i, "") + "/oauth2/token" : "";
  return {
    baseUrl,
    clientId: env.EPIC_CLIENT_ID ?? "",
    privateKeyPem: (env.EPIC_PRIVATE_KEY_PEM ?? "").replace(/\\n/g, "\n"),
    tokenUrl: env.EPIC_TOKEN_URL ?? derivedToken,
    orgCode: env.EPIC_ORG_CODE ?? "ISPN",
    intervalMin: Number(env.EPIC_SYNC_INTERVAL_MIN ?? "") || 60,
  };
}

export function epicConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const c = epicConfig(env);
  return !!(c.baseUrl && c.clientId && c.privateKeyPem && c.tokenUrl);
}

export const EPIC_NOT_CONFIGURED_MESSAGE =
  "Epic on-call needs Epic app credentials (App Orchard/Vendor Services registration): " +
  "set EPIC_FHIR_BASE_URL, EPIC_CLIENT_ID, EPIC_PRIVATE_KEY_PEM (RS384 private key) and EPIC_TOKEN_URL on the server.";

// ── SMART Backend Services JWT assertion ─────────────────────────────────────
function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** RS384-signed client assertion (Epic rejects RS256). */
export function buildClientAssertion(cfg: Pick<EpicConfig, "clientId" | "privateKeyPem" | "tokenUrl">, now = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = { alg: "RS384", typ: "JWT" };
  const claims = {
    iss: cfg.clientId,
    sub: cfg.clientId,
    aud: cfg.tokenUrl,
    jti: randomUUID(),
    iat,
    nbf: iat,
    exp: iat + ASSERTION_TTL_S,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA384");
  signer.update(signingInput);
  const signature = signer.sign(cfg.privateKeyPem);
  return `${signingInput}.${b64url(signature)}`;
}

export interface EpicClientDeps {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Exchange the signed assertion for a bearer token. */
export async function getAccessToken(cfg: EpicConfig, deps: EpicClientDeps = {}): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: buildClientAssertion(cfg, deps.now?.() ?? new Date()),
  });
  const res = await fetchWithTimeout(fetchImpl, cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`epic_token_http_${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("epic_token_missing");
  return json.access_token;
}

// ── FHIR bundle → OnCallSlot ──────────────────────────────────────────────────
type Json = Record<string, unknown>;
interface FhirBundle { resourceType?: string; entry?: Array<{ resource?: Json }> }

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function codeableText(cc: unknown): string {
  if (!cc || typeof cc !== "object") return "";
  const c = cc as { text?: unknown; coding?: Array<{ display?: unknown; code?: unknown }> };
  if (typeof c.text === "string" && c.text) return c.text;
  const first = Array.isArray(c.coding) ? c.coding[0] : undefined;
  return str(first?.display) || str(first?.code);
}
function refId(ref: unknown): string {
  // "Practitioner/abc" or a full URL ending in /Practitioner/abc → "Practitioner/abc"
  const r = str(ref);
  const m = r.match(/([A-Za-z]+\/[A-Za-z0-9\-.]+)$/);
  return m ? m[1]! : r;
}

/** HumanName → "First Last" (prefers the official/usual name). */
export function practitionerDisplayName(p: Json | undefined): string {
  if (!p) return "";
  const names = Array.isArray(p.name) ? (p.name as Array<Json>) : [];
  const pick = names.find((n) => n.use === "official") ?? names.find((n) => n.use === "usual") ?? names[0];
  if (!pick) return "";
  if (typeof pick.text === "string" && pick.text) return pick.text.trim();
  const given = Array.isArray(pick.given) ? (pick.given as unknown[]).map(str).filter(Boolean) : [];
  const family = str(pick.family);
  return [given[0] ?? "", family].filter(Boolean).join(" ").trim();
}

/** "07:00:00" → "7a", "19:00:00" → "7p" — Amion-style token so shifts map the same way. */
function toHourToken(t: string): string {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${h < 12 ? "a" : "p"}`;
}
function hoursFromAvailableTime(role: Json): string {
  const at = Array.isArray(role.availableTime) ? (role.availableTime as Json[]) : [];
  const first = at.find((a) => a.availableStartTime && a.availableEndTime);
  if (!first) return "";
  const s = toHourToken(str(first.availableStartTime));
  const e = toHourToken(str(first.availableEndTime));
  return s && e ? `${s}-${e}` : "";
}
function hoursFromSlot(slot: Json): string {
  const s = new Date(str(slot.start));
  const e = new Date(str(slot.end));
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "";
  const tok = (d: Date) => {
    const h = d.getUTCHours();
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${h < 12 ? "a" : "p"}`;
  };
  return `${tok(s)}-${tok(e)}`;
}
function shiftFor(hours: string, slotStart?: string): ShiftType {
  if (hours) return mapHoursToShift(hours);
  const d = slotStart ? new Date(slotStart) : null;
  if (d && !Number.isNaN(d.getTime())) {
    const h = d.getUTCHours();
    return h >= 19 || h < 7 ? "night" : h >= 14 ? "swing" : "day";
  }
  return "day";
}

export interface ParsedEpicSlot {
  slot: string;
  service: string;
  hours: string;
  shift: ShiftType;
  providerName: string;
  group: string;
  /** Practitioner reference id, e.g. "Practitioner/abc" (for dedupe). */
  practitionerRef: string;
}

/**
 * Map a searchset bundle of PractitionerRole (+ _include Practitioner, and
 * optionally Schedule/Slot) into on-call rows for the window around `now`.
 *
 *  - PractitionerRole: one row per active role. Slot = role code display,
 *    service = specialty (or healthcareService/organization), hours from
 *    availableTime, group = organization display.
 *  - Slot (status busy/busy-unavailable, i.e. booked on-call) whose [start,end)
 *    contains `now` → row named after the Schedule's serviceType, holder = the
 *    Schedule's Practitioner actor. Slots outside the window are ignored.
 */
export function parseEpicBundle(bundle: FhirBundle, now = new Date()): ParsedEpicSlot[] {
  const entries = Array.isArray(bundle.entry) ? bundle.entry : [];
  const byRef = new Map<string, Json>();
  for (const e of entries) {
    const r = e.resource;
    if (!r || typeof r.resourceType !== "string" || typeof r.id !== "string") continue;
    byRef.set(`${r.resourceType}/${r.id}`, r);
  }
  const rows: ParsedEpicSlot[] = [];

  for (const r of byRef.values()) {
    if (r.resourceType !== "PractitionerRole") continue;
    if (r.active === false) continue;
    const period = r.period as Json | undefined;
    if (period) {
      const start = period.start ? new Date(str(period.start)) : null;
      const end = period.end ? new Date(str(period.end)) : null;
      if (start && !Number.isNaN(start.getTime()) && start > now) continue;
      if (end && !Number.isNaN(end.getTime()) && end <= now) continue;
    }
    const pracRef = refId((r.practitioner as Json | undefined)?.reference);
    const prac = byRef.get(pracRef);
    const providerName = practitionerDisplayName(prac) || str((r.practitioner as Json | undefined)?.display);
    if (!providerName) continue; // never invent a holder
    const codes = Array.isArray(r.code) ? (r.code as unknown[]) : [];
    const specialties = Array.isArray(r.specialty) ? (r.specialty as unknown[]) : [];
    const org = r.organization as Json | undefined;
    const hcs = Array.isArray(r.healthcareService) ? (r.healthcareService as Json[]) : [];
    const slot = codeableText(codes[0]) || codeableText(specialties[0]) || "On call";
    const service = codeableText(specialties[0]) || str(hcs[0]?.display) || str(org?.display) || "Hospital Medicine";
    const hours = hoursFromAvailableTime(r);
    rows.push({
      slot,
      service,
      hours,
      shift: shiftFor(hours),
      providerName,
      group: str(org?.display),
      practitionerRef: pracRef,
    });
  }

  for (const r of byRef.values()) {
    if (r.resourceType !== "Slot") continue;
    const status = str(r.status);
    if (status !== "busy" && status !== "busy-unavailable" && status !== "busy-tentative") continue;
    const start = new Date(str(r.start));
    const end = new Date(str(r.end));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (!(start <= now && now < end)) continue;
    const schedule = byRef.get(refId((r.schedule as Json | undefined)?.reference));
    if (!schedule) continue;
    const actors = Array.isArray(schedule.actor) ? (schedule.actor as Json[]) : [];
    const pracActor = actors.find((a) => refId(a.reference).startsWith("Practitioner/"));
    if (!pracActor) continue;
    const pracRef = refId(pracActor.reference);
    const providerName = practitionerDisplayName(byRef.get(pracRef)) || str(pracActor.display);
    if (!providerName) continue;
    const svcTypes = Array.isArray(schedule.serviceType) ? (schedule.serviceType as unknown[]) : [];
    const specialties = Array.isArray(schedule.specialty) ? (schedule.specialty as unknown[]) : [];
    const slotName = codeableText(svcTypes[0]) || str(schedule.comment) || "On call";
    const hours = hoursFromSlot(r);
    const orgActor = actors.find((a) => refId(a.reference).startsWith("Organization/"));
    rows.push({
      slot: slotName,
      service: codeableText(specialties[0]) || codeableText(svcTypes[0]) || "Hospital Medicine",
      hours,
      shift: shiftFor(hours, str(r.start)),
      providerName,
      group: str(orgActor?.display),
      practitionerRef: pracRef,
    });
  }

  // Dedupe identical (slot, provider) pairs — the same role can arrive both as a
  // PractitionerRole and a booked Slot.
  const seen = new Set<string>();
  return rows.filter((row) => {
    const k = `${row.slot.toLowerCase()}|${row.practitionerRef || row.providerName.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── sync state ───────────────────────────────────────────────────────────────
export interface EpicSyncState {
  lastSyncAt: string | null;
  lastStatus: "ok" | "error";
  lastError: string | null;
  rowCount: number;
  slots: ParsedEpicSlot[];
}

/** Fetch every page of a FHIR search (follows Bundle.link[relation=next]). */
async function fetchAllPages(url: string, token: string, fetchImpl: typeof fetch): Promise<FhirBundle> {
  const out: FhirBundle = { resourceType: "Bundle", entry: [] };
  let next: string | null = url;
  for (let page = 0; next && page < 20; page++) {
    const res: Response = await fetchWithTimeout(fetchImpl, next, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/fhir+json" },
    });
    if (!res.ok) throw new Error(`epic_fhir_http_${res.status}`);
    const b = (await res.json()) as FhirBundle & { link?: Array<{ relation?: string; url?: string }> };
    out.entry!.push(...(b.entry ?? []));
    next = b.link?.find((l) => l.relation === "next")?.url ?? null;
  }
  return out;
}

// Secrets must never leak through error text.
function sanitizeError(err: unknown, cfg: EpicConfig): string {
  let msg = err instanceof Error ? (err.name === "AbortError" ? "epic_timeout" : err.message) : String(err);
  for (const s of [cfg.privateKeyPem, cfg.clientId]) if (s) msg = msg.split(s).join("<redacted>");
  return msg.slice(0, 300);
}

/**
 * Pull the current on-call from Epic and store the snapshot in the org's
 * "epicSync" setting (last good snapshot survives a failed pull, like Amion).
 */
export async function syncEpic(
  db: DatabaseStorage,
  opts: { actorUserId?: number } & EpicClientDeps = {},
): Promise<EpicSyncState> {
  const cfg = epicConfig(opts.env);
  if (!epicConfigured(opts.env)) throw new Error("epic_not_configured");
  const org = await db.getOrganizationByCode(cfg.orgCode);
  if (!org) throw new Error("epic_org_not_found");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now?.() ?? new Date();
  const updatedBy = (opts.actorUserId ?? null) as unknown as number;

  let slots: ParsedEpicSlot[];
  try {
    const token = await getAccessToken(cfg, { fetchImpl, now: () => now });
    // Active roles + the practitioners they point at, in one round trip.
    const roles = await fetchAllPages(
      `${cfg.baseUrl}/PractitionerRole?active=true&_include=PractitionerRole:practitioner&_count=200`,
      token,
      fetchImpl,
    );
    // Booked on-call slots for the current window (where the site models
    // on-call as Schedule/Slot). A site without Slot support answers an empty
    // bundle or 404 — either way we keep the PractitionerRole rows.
    const from = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const to = new Date(now.getTime() + 24 * 3600_000).toISOString();
    let slotBundle: FhirBundle = { entry: [] };
    try {
      slotBundle = await fetchAllPages(
        `${cfg.baseUrl}/Slot?status=busy&start=ge${encodeURIComponent(from)}&start=le${encodeURIComponent(to)}&_include=Slot:schedule&_include:iterate=Schedule:actor&_count=200`,
        token,
        fetchImpl,
      );
    } catch (err) {
      if (!(err instanceof Error && /epic_fhir_http_(404|400)/.test(err.message))) throw err;
    }
    slots = parseEpicBundle({ entry: [...(roles.entry ?? []), ...(slotBundle.entry ?? [])] }, now);
  } catch (err) {
    const prev = ((await db.getOrgSetting(org.id, EPIC_SETTING_KEY)) ?? {}) as Partial<EpicSyncState>;
    const state: EpicSyncState = {
      lastSyncAt: now.toISOString(),
      lastStatus: "error",
      lastError: sanitizeError(err, cfg),
      rowCount: prev.rowCount ?? 0,
      slots: prev.slots ?? [],
    };
    await db.setOrgSetting(org.id, EPIC_SETTING_KEY, state, updatedBy);
    await appendAudit({
      organizationId: org.id,
      userId: opts.actorUserId ?? null,
      action: "epic.sync",
      resourceType: "org_settings",
      resourceId: null,
      details: { status: "error", error: state.lastError },
      riskLevel: "low",
    });
    return state;
  }

  const state: EpicSyncState = {
    lastSyncAt: now.toISOString(),
    lastStatus: "ok",
    lastError: null,
    rowCount: slots.length,
    slots,
  };
  await db.setOrgSetting(org.id, EPIC_SETTING_KEY, state, updatedBy);
  await appendAudit({
    organizationId: org.id,
    userId: opts.actorUserId ?? null,
    action: "epic.sync",
    resourceType: "org_settings",
    resourceId: null,
    details: { status: "ok", rowCount: slots.length, trigger: opts.actorUserId ? "manual" : "scheduled" },
    riskLevel: "low",
  });
  return state;
}

export function createEpicSource(db: DatabaseStorage, deps: EpicClientDeps = {}): ScheduleSource {
  const env = () => deps.env ?? process.env;
  // One in-flight background refresh per process; never block a board read.
  let inflight: Promise<unknown> | null = null;

  async function orgMatches(orgId: number): Promise<boolean> {
    if (!epicConfigured(env())) return false;
    const org = await db.getOrganizationByCode(epicConfig(env()).orgCode);
    return !!org && org.id === orgId;
  }
  async function state(orgId: number): Promise<EpicSyncState | null> {
    const raw = (await db.getOrgSetting(orgId, EPIC_SETTING_KEY)) as Partial<EpicSyncState> | null;
    if (!raw || typeof raw !== "object") return null;
    return {
      lastSyncAt: raw.lastSyncAt ?? null,
      lastStatus: raw.lastStatus ?? "ok",
      lastError: raw.lastError ?? null,
      rowCount: raw.rowCount ?? 0,
      slots: Array.isArray(raw.slots) ? raw.slots : [],
    };
  }

  return {
    id: "epic",
    async fetch(orgId) {
      if (!(await orgMatches(orgId))) return [];
      const s = await state(orgId);
      // Stale (or never synced) → refresh in the background; serve what we have.
      const ageMs = s?.lastSyncAt ? Date.now() - new Date(s.lastSyncAt).getTime() : Infinity;
      if (ageMs > epicConfig(env()).intervalMin * 60_000 && !inflight) {
        inflight = syncEpic(db, deps).catch(() => {}).finally(() => { inflight = null; });
      }
      if (!s || !s.slots.length) return [];
      const users = await db.listUsers(orgId);
      const byName = new Map(users.map((u) => [normalizeName(u.displayName), u.id]));
      return s.slots.map<OnCallSlot>((row) => ({
        slot: row.slot,
        service: row.service,
        hours: row.hours,
        shift: row.shift,
        providerName: row.providerName,
        providerUserId: byName.get(normalizeName(row.providerName)) ?? null,
        group: row.group,
        secure: true,
        source: "epic",
        asOf: s.lastSyncAt,
      }));
    },
    async status(orgId): Promise<ScheduleSourceStatus> {
      const configured = await orgMatches(orgId);
      const s = configured ? await state(orgId) : null;
      return {
        id: "epic",
        configured,
        lastSyncAt: s?.lastSyncAt ?? null,
        lastStatus: s ? s.lastStatus : "never",
        error: s?.lastError ?? null,
        rowCount: s?.rowCount ?? 0,
        message: configured
          ? null
          : epicConfigured(env())
            ? "Epic credentials are registered for a different organization (EPIC_ORG_CODE)."
            : EPIC_NOT_CONFIGURED_MESSAGE,
      };
    },
  };
}
