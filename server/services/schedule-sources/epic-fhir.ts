import { createSign, randomUUID } from "node:crypto";
import { appendAudit } from "../../audit.js";
import { isModuleEnabled } from "../../modules.js";
import { storage, type DatabaseStorage } from "../../storage.js";
import { deriveEpicTokenUrl, readOrgCredentials } from "../../integrations/credentials.js";
import { guardedFetch, integrationFetch, IntegrationCallError } from "../../integrations/http.js";
import { skipWhileRunning } from "../../integrations/single-flight.js";
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
 * Per hospital: each org can instead save ITS OWN Epic app (base URL, client
 * id, private key, token URL) in Settings → Integrations → Epic; those are
 * read FIRST (epicConfigFor) and the env above is the fallback for the one
 * EPIC_ORG_CODE org. Saved credentials are AES-256-GCM ciphertext in the
 * database (server/integrations/crypto.ts); env ones live only in env. Either
 * way the private key and client id are never logged and never returned by
 * any API response, and a hospital-supplied URL can only reach a public https
 * host. The client is fully testable offline: `fetchImpl` is injectable and
 * tests feed it a fixture bundle.
 */

export const EPIC_SETTING_KEY = "epicSync";
const ASSERTION_TTL_S = 4 * 60; // Epic caps JWT exp at 5 minutes from now
/**
 * One sync (token + every PractitionerRole and Slot page) must finish within
 * this, on top of each request's own ≤ 10 s deadline (headers AND body,
 * server/integrations/http.ts). A slow or hostile Epic host can therefore hold
 * one hospital's sync for at most this long, and never another hospital's.
 */
export const EPIC_SYNC_DEADLINE_MS = 60_000;

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
  const derivedToken = deriveEpicTokenUrl(baseUrl);
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
  "a director connects this hospital's Epic backend app in Settings → Integrations → Epic " +
  "(FHIR base URL, client ID, RS384 private key), or the operator sets EPIC_FHIR_BASE_URL, " +
  "EPIC_CLIENT_ID, EPIC_PRIVATE_KEY_PEM and EPIC_TOKEN_URL on the server.";

export type EpicSourcedConfig = EpicConfig & { source: "organization" | "env" };

/**
 * One org's Epic connection: its OWN saved credentials first, else the env
 * app when this org is EPIC_ORG_CODE. Null = not connected. SECRET fields
 * (clientId, privateKeyPem) — never log or return the result.
 */
export async function epicConfigFor(
  db: DatabaseStorage,
  orgId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<EpicSourcedConfig | null> {
  const base = epicConfig(env);
  const creds = await readOrgCredentials(db, orgId, "epic-fhir");
  if (creds.state === "ok" && creds.values.baseUrl && creds.values.clientId && creds.values.privateKeyPem) {
    const org = await db.getOrganization(orgId);
    const baseUrl = creds.values.baseUrl.replace(/\/+$/, "");
    return {
      baseUrl,
      clientId: creds.values.clientId,
      privateKeyPem: creds.values.privateKeyPem,
      tokenUrl: creds.values.tokenUrl || deriveEpicTokenUrl(baseUrl),
      orgCode: org?.code ?? "",
      intervalMin: base.intervalMin,
      source: "organization",
    };
  }
  if (!epicConfigured(env)) return null;
  const org = await db.getOrganization(orgId);
  return org && org.code === base.orgCode ? { ...base, source: "env" } : null;
}

/**
 * Every Epic request goes through the integrations seam: bounded end to end
 * (≤ 10 s per request, body included, ≤ 5 MB) and, when `outer` is given,
 * cut off when that overall deadline fires. Hospital-supplied URLs may only
 * reach a public https host (SSRF guard); the operator's env URLs are trusted.
 * `fetchImpl` (tests) replaces only the transport underneath.
 */
function fetchFor(cfg: EpicSourcedConfig, fetchImpl?: typeof fetch, outer?: AbortSignal): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    return cfg.source === "organization"
      ? guardedFetch(url, init ?? {}, fetchImpl, outer)
      : integrationFetch(url, init ?? {}, fetchImpl, outer);
  }) as typeof fetch;
}

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
  /**
   * The transport. syncEpic wraps it in the bounded, SSRF-guarded seam;
   * getAccessToken calls it as given (callers pass a bounded one — without
   * one it uses integrationFetch).
   */
  fetchImpl?: typeof fetch;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

const boundedFetch = ((input: string | URL | Request, init?: RequestInit) =>
  integrationFetch(String(input instanceof Request ? input.url : input), init ?? {})) as typeof fetch;

/** Exchange the signed assertion for a bearer token. */
export async function getAccessToken(cfg: EpicConfig, deps: EpicClientDeps = {}): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? boundedFetch;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: buildClientAssertion(cfg, deps.now?.() ?? new Date()),
  });
  const res = await fetchImpl(cfg.tokenUrl, {
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

/**
 * Fetch every page of a FHIR search (follows Bundle.link[relation=next], at
 * most 20 pages). `fetchImpl` is the bounded seam from fetchFor, so each page
 * is ≤ 10 s / ≤ 5 MB and all pages share the sync's overall deadline.
 */
async function fetchAllPages(url: string, token: string, fetchImpl: typeof fetch): Promise<FhirBundle> {
  const out: FhirBundle = { resourceType: "Bundle", entry: [] };
  let next: string | null = url;
  for (let page = 0; next && page < 20; page++) {
    const res: Response = await fetchImpl(next, {
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
  if (err instanceof IntegrationCallError) return `epic_${err.code}`;
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
  opts: { actorUserId?: number; orgId?: number } & EpicClientDeps = {},
): Promise<EpicSyncState> {
  // Which org: the one asked for, else (legacy callers) the env EPIC_ORG_CODE org.
  let orgId = opts.orgId;
  if (orgId == null) {
    if (!epicConfigured(opts.env)) throw new Error("epic_not_configured");
    const envOrg = await db.getOrganizationByCode(epicConfig(opts.env).orgCode);
    if (!envOrg) throw new Error("epic_org_not_found");
    orgId = envOrg.id;
  }
  const org = await db.getOrganization(orgId);
  if (!org) throw new Error("epic_org_not_found");
  // The org's OWN saved Epic app first, the env app as the fallback.
  const cfg = await epicConfigFor(db, org.id, opts.env);
  if (!cfg) throw new Error("epic_not_configured");
  // One overall deadline for the whole sync (token + every page).
  const fetchImpl = fetchFor(cfg, opts.fetchImpl, AbortSignal.timeout(EPIC_SYNC_DEADLINE_MS));
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
  // One in-flight background refresh per org; never block a board read.
  const inflight = new Map<number, Promise<unknown>>();

  async function orgMatches(orgId: number): Promise<boolean> {
    return !!(await epicConfigFor(db, orgId, env()));
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
      if (ageMs > epicConfig(env()).intervalMin * 60_000 && !inflight.has(orgId)) {
        inflight.set(orgId, syncEpic(db, { ...deps, orgId }).catch(() => {}).finally(() => { inflight.delete(orgId); }));
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
            ? "Epic credentials are registered for a different organization (EPIC_ORG_CODE) — connect this hospital's own Epic app in Settings → Integrations → Epic."
            : EPIC_NOT_CONFIGURED_MESSAGE,
      };
    },
  };
}

// ── background loop ──────────────────────────────────────────────────────────
/**
 * One scheduled tick over EVERY org with an Epic connection (its own saved
 * app, or the env EPIC_ORG_CODE org) whose schedule.epic module is on. The
 * orgs sync CONCURRENTLY, each under its own deadlines, so one hospital's
 * slow or stalled Epic host can never delay another hospital's pull; one
 * org's failure never stops the others (syncEpic records errors in the org's
 * epicSync state).
 */
export async function runScheduledEpicSyncAll(
  db: DatabaseStorage = storage(),
  deps: EpicClientDeps = {},
): Promise<Array<{ orgId: number; outcome: "synced" | "skipped_module_off" | "failed" }>> {
  type Outcome = { orgId: number; outcome: "synced" | "skipped_module_off" | "failed" };
  const ids = new Set<number>((await db.listIntegrationCredentials("epic-fhir")).map((r) => r.organizationId));
  if (epicConfigured(deps.env)) {
    const envOrg = await db.getOrganizationByCode(epicConfig(deps.env).orgCode);
    if (envOrg) ids.add(envOrg.id);
  }
  const ordered = [...ids].sort((a, b) => a - b);
  const settled = await Promise.allSettled(
    ordered.map(async (orgId): Promise<Outcome | null> => {
      if (!(await epicConfigFor(db, orgId, deps.env))) return null;
      if (!(await isModuleEnabled(orgId, "schedule.epic"))) return { orgId, outcome: "skipped_module_off" };
      await syncEpic(db, { ...deps, orgId });
      return { orgId, outcome: "synced" };
    }),
  );
  const out: Outcome[] = [];
  settled.forEach((r, i) => {
    if (r.status === "rejected") out.push({ orgId: ordered[i]!, outcome: "failed" });
    else if (r.value) out.push(r.value);
  });
  return out;
}

let epicBootTimer: NodeJS.Timeout | null = null;
let epicLoopTimer: NodeJS.Timeout | null = null;

/** Background Epic pulls every EPIC_SYNC_INTERVAL_MIN (default 60) minutes; timers unref'd. */
export function startEpicSyncLoop() {
  if (epicLoopTimer) return;
  const intervalMin = epicConfig().intervalMin;
  // A tick is skipped while the previous one is still running (never two
  // overlapping runs against the same hospitals).
  const run = skipWhileRunning(() =>
    runScheduledEpicSyncAll().catch((err) => console.error("[epic] scheduled sync tick failed:", err instanceof Error ? err.name : "error")),
  );
  epicBootTimer = setTimeout(run, 8_000);
  epicBootTimer.unref?.();
  epicLoopTimer = setInterval(run, intervalMin * 60_000);
  epicLoopTimer.unref?.();
  console.log(`[epic] on-call sync loop — every ${intervalMin} min for each org with a connected Epic app and schedule.epic on`);
}

export function stopEpicSyncLoop() {
  if (epicBootTimer) { clearTimeout(epicBootTimer); epicBootTimer = null; }
  if (epicLoopTimer) { clearInterval(epicLoopTimer); epicLoopTimer = null; }
}
