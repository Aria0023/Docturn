import { createHmac, randomBytes } from "node:crypto";
import type { Organization } from "@shared/schema";
import { MODULES } from "@shared/modules";
import { getNotificationProfile } from "../config.js";
import { isModuleEnabled } from "../modules.js";
import type { DatabaseStorage } from "../storage.js";
import { aiIntakeEnv } from "../services/ai-intake.js";
import { resolveSmsCarrier } from "../services/sms.js";
import {
  amionConfig,
  amionFeedFor,
  parseAmionBody,
  SYNC_SETTING_KEY,
  toDisplayName,
  type AmionSyncState,
} from "../services/amion.js";
import {
  EPIC_SETTING_KEY,
  epicConfig,
  epicConfigFor,
  epicConfigured,
  getAccessToken,
  type EpicSyncState,
} from "../services/schedule-sources/epic-fhir.js";
import { getSelectedSource } from "../services/schedule-sources/index.js";
import type { ScheduleSourceId } from "../services/schedule-sources/types.js";
import { credentialKeyState } from "./crypto.js";
import { CREDENTIAL_FIELDS, readOrgCredentials, type CredentialField, type StoredCredentials } from "./credentials.js";
import { INTEGRATION_MODULES } from "./gates.js";
import { guardedFetch, integrationDeps, integrationFetch, IntegrationCallError } from "./http.js";

/**
 * The integration registry — the ONE place that knows what DocTurn connects
 * to, what each connection needs, and whether it works for an organization
 * right now. Every answer is computed from LIVE configuration:
 *
 *   platform-scope      credentials belong to the DocTurn operator and live in
 *                       env (Render dashboard / AWS SSM): Twilio, push, OpenAI.
 *   organization-scope  credentials belong to each hospital, saved encrypted
 *                       through Settings → Integrations (credentials.ts):
 *                       Amion, Epic. The legacy one-org env still works.
 *
 * Status (per org):
 *   not_configured  required settings missing/invalid (names listed, never values)
 *   needs_baa       the vendor would receive PHI and the operator has not
 *                   attested a signed BAA (OpenAI without AI_EXTERNAL_PHI_OK)
 *   off             configured, but the org's gating module is switched off
 *   error           configured + on, but the most recent test/sync failed
 *   active          configured + on, and nothing has failed since
 *
 * The on/off switch IS the org's gating module (shared/modules.ts): the HTTP
 * gate and the background paths (gates.ts) enforce it, so the card can never
 * claim an effect the server does not have.
 */

export const INTEGRATION_IDS = ["twilio-sms", "push", "openai-intake", "amion", "epic-fhir"] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];
export type IntegrationStatus = "active" | "off" | "not_configured" | "needs_baa" | "error";
export type IntegrationScope = "platform" | "organization";

export interface EnvVarSpec {
  name: string;
  required: boolean;
  secret: boolean;
  /** What it is, in plain language. */
  description: string;
  /** Placeholder for the value in the AWS command (shown as <placeholder>). */
  placeholder: string;
  /** The placeholder IS the value to type (e.g. "true"): shown without <>. */
  literal?: boolean;
  /** Shown as a warning beside the variable. */
  caution?: string;
}

/** Where the org's on-call board really reads from (Amion / Epic cards). */
export interface BoardSourceView {
  selected: ScheduleSourceId;
  /** A director chose it (vs. the default resolution). */
  explicit: boolean;
  /** The org's oncall.board module is on (the board is shown at all). */
  boardEnabled: boolean;
}

interface ConfigEval {
  configured: boolean;
  needsBaa?: boolean;
  missing: string[];
  invalid: string[];
  source: "env" | "organization" | "generated" | null;
  note: string | null;
  /** Replaces the generic "not connected" sentence when set. */
  blockedText?: string;
  /** Identifies the configuration a test result belongs to (never a secret). */
  fingerprint: string;
}

export interface TestOutcome {
  ok: boolean;
  code: string;
  message: string;
  detail?: string;
}

export interface LastCheck {
  kind: "test" | "sync";
  ok: boolean;
  at: string;
  reason: string | null;
}

interface IntegrationDef {
  id: IntegrationId;
  name: string;
  vendor: string;
  icon: string;
  purpose: string;
  scope: IntegrationScope;
  module: string;
  phi: boolean;
  baaRequired: boolean;
  phiNote: string;
  /** What switching it off does for the org. */
  offEffect: string;
  activeText: string;
  /** Replaces activeText when what "active" means depends on the org (e.g. which source the on-call board reads). */
  activeTextFor?(ctx: { board: BoardSourceView | null; env: NodeJS.ProcessEnv }): string;
  needsBaaText?: string;
  envVars: EnvVarSpec[];
  evaluate(db: DatabaseStorage, org: Organization, env: NodeJS.ProcessEnv): Promise<ConfigEval>;
  test(db: DatabaseStorage, org: Organization, env: NodeJS.ProcessEnv): Promise<TestOutcome>;
  lastSync?(db: DatabaseStorage, org: Organization): Promise<LastCheck | null>;
}

// ── helpers ─────────────────────────────────────────────────────────────────
// Test results are tied to the configuration they ran against through an HMAC
// keyed with a per-process random nonce: no secret (or hash of one) is ever
// stored, and since env changes only take effect on a restart, a result from
// before the restart no longer claims to describe the running server.
const BOOT_NONCE = randomBytes(32);
function fingerprint(parts: Array<string | undefined | null>): string {
  return createHmac("sha256", BOOT_NONCE).update(parts.map((p) => p ?? "").join("\u0000")).digest("hex").slice(0, 16);
}

function fail(code: string, message: string): TestOutcome {
  return { ok: false, code, message };
}

function httpFailure(res: Response, who: string): TestOutcome {
  if (res.status === 401 || res.status === 403) {
    return fail(`http_${res.status}`, `${who} rejected the credentials (HTTP ${res.status}).`);
  }
  if (res.status === 404) return fail("http_404", `${who} answered "not found" (HTTP 404) — check the account / URL.`);
  if (res.status === 429) return fail("http_429", `${who} is rate-limiting or the account has no credit (HTTP 429).`);
  return fail(`http_${res.status}`, `${who} answered HTTP ${res.status}.`);
}

function callFailure(err: unknown): TestOutcome {
  if (err instanceof IntegrationCallError) return fail(err.code, err.message);
  return fail("error", "The request failed.");
}

function present(env: NodeJS.ProcessEnv, names: string[]): string[] {
  return names.filter((n) => !(env[n] ?? "").trim());
}

const DECRYPT_BLOCKED =
  "This hospital's saved credentials can't be decrypted — INTEGRATION_KEY is missing on the server or was changed. " +
  "Ask the DocTurn operator to restore INTEGRATION_KEY, or clear the credentials and enter them again.";

/** Truthful note for an organization-scope card running on the operator's env fallback. */
function envFallbackNote(unreadable: boolean, setting: string): string {
  return (
    (unreadable
      ? `This hospital's saved credentials can't be decrypted (INTEGRATION_KEY missing or changed), so the DocTurn operator's server setting (${setting}) is used.`
      : `Connected through the DocTurn operator's server setting (${setting}).`) +
    " Saving this hospital's own credentials under Set up replaces it for this organization."
  );
}

function credentialFingerprint(c: StoredCredentials): string {
  return c.state === "none" ? "" : fingerprint(["org", c.row.integrationId, c.row.updatedAt.toISOString()]);
}

// VAPID keys are base64url: public = 65-byte uncompressed P-256 point, private = 32 bytes.
function b64url(s: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(s)) return null;
  try {
    return Buffer.from(s, "base64url");
  } catch {
    return null;
  }
}
export function vapidPublicKeyValid(k: string): boolean {
  const b = b64url(k);
  return !!b && b.length === 65 && b[0] === 0x04;
}
export function vapidPrivateKeyValid(k: string): boolean {
  const b = b64url(k);
  return !!b && b.length === 32;
}

async function platformOrgId(db: DatabaseStorage): Promise<number | null> {
  return (await db.getOrganizationByCode("DOCTURN"))?.id ?? null;
}

async function syncCheck(db: DatabaseStorage, orgId: number, key: string): Promise<LastCheck | null> {
  const s = (await db.getOrgSetting(orgId, key)) as Partial<AmionSyncState & EpicSyncState> | null;
  if (!s || typeof s !== "object" || !s.lastSyncAt) return null;
  return { kind: "sync", ok: s.lastStatus !== "error", at: s.lastSyncAt, reason: s.lastStatus === "error" ? s.lastError ?? "sync failed" : null };
}

function everyMinutes(min: number): string {
  return min >= 120 && min % 60 === 0 ? `every ${min / 60} h` : `every ${min} min`;
}
function boardLabel(id: ScheduleSourceId): string {
  return id === "manual" ? "the manual list" : id === "amion" ? "Amion" : "Epic";
}
const PICK_SOURCE_HINT = (name: string) =>
  `a director picks ${name} as the on-call source (Settings → On-call schedule sync → Source, or the On-call board) to show it there.`;

const SCHEDULE_SOURCE_OF: Partial<Record<IntegrationId, ScheduleSourceId>> = { amion: "amion", "epic-fhir": "epic" };

async function boardSourceFor(db: DatabaseStorage, def: IntegrationDef, org: Organization): Promise<BoardSourceView | null> {
  if (!SCHEDULE_SOURCE_OF[def.id]) return null;
  const sel = await getSelectedSource(db, org.id);
  return { selected: sel.id, explicit: sel.explicit, boardEnabled: await isModuleEnabled(org.id, "oncall.board") };
}

// ── the five integrations ───────────────────────────────────────────────────
const TWILIO_VARS: EnvVarSpec[] = [
  { name: "TWILIO_ACCOUNT_SID", required: true, secret: true, placeholder: "AC… from the Twilio console", description: "Twilio Account SID (Twilio console → Account Info; starts with AC)." },
  { name: "TWILIO_AUTH_TOKEN", required: true, secret: true, placeholder: "auth token from the Twilio console", description: "Twilio Auth Token (Twilio console → Account Info). Secret." },
  { name: "TWILIO_FROM_NUMBER", required: true, secret: false, placeholder: "+15551234567", description: "The Twilio phone number texts are sent from, in E.164 form (+15551234567)." },
];

const twilio: IntegrationDef = {
  id: "twilio-sms",
  name: "Twilio SMS",
  vendor: "Twilio",
  icon: "message-circle",
  purpose:
    "Text messages as a last resort: STAT nudges when an urgent message stays unacknowledged, assignment escalation texts, and SMS sign-in codes for two-factor authentication.",
  scope: "platform",
  module: INTEGRATION_MODULES.sms,
  phi: false,
  baaRequired: false,
  phiNote:
    "Texts never contain patient information — only \"open DocTurn\" nudges and one-time sign-in codes go to clinicians' phones — so Twilio receives no PHI. Your compliance officer may still choose to sign Twilio's BAA.",
  offEffect: "No texts go to this organization's clinicians: no STAT nudges, no escalation texts, no SMS sign-in codes (authenticator-app codes keep working).",
  activeText: "Connected — this organization's texts go out through the platform's Twilio account.",
  envVars: TWILIO_VARS,
  async evaluate(_db, org, env) {
    const missing = present(env, TWILIO_VARS.map((v) => v.name));
    const invalid: string[] = [];
    if (env.TWILIO_ACCOUNT_SID && !/^AC[0-9a-fA-F]{32}$/.test(env.TWILIO_ACCOUNT_SID.trim())) invalid.push("TWILIO_ACCOUNT_SID");
    if (env.TWILIO_FROM_NUMBER && !/^\+[1-9]\d{6,14}$/.test(env.TWILIO_FROM_NUMBER.trim())) invalid.push("TWILIO_FROM_NUMBER");
    const fp = fingerprint(["twilio", env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM_NUMBER]);
    if (missing.length || invalid.length) {
      return { configured: false, missing, invalid, source: null, note: null, fingerprint: fp };
    }
    // The carrier this org's texts REALLY use (services/sms.ts resolveSmsCarrier).
    const carrier = resolveSmsCarrier((await getNotificationProfile(org.id)).smsCarrier, env);
    if (carrier !== "twilio") {
      return {
        configured: false,
        missing: [],
        invalid: ["notification_profile.smsCarrier"],
        source: "env",
        note: null,
        blockedText: `This organization's notification profile names the carrier "${carrier}", which DocTurn cannot send through yet — its texts would not be delivered by Twilio.`,
        fingerprint: fp,
      };
    }
    return { configured: true, missing: [], invalid: [], source: "env", note: null, fingerprint: fp };
  },
  async test(_db, _org, env) {
    const sid = (env.TWILIO_ACCOUNT_SID ?? "").trim();
    const auth = Buffer.from(`${sid}:${(env.TWILIO_AUTH_TOKEN ?? "").trim()}`).toString("base64");
    let res: Response;
    try {
      // Read the account resource — proves the SID/token pair without sending a text.
      res = await integrationFetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, {
        method: "GET",
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      });
    } catch (err) {
      return callFailure(err);
    }
    if (!res.ok) return httpFailure(res, "Twilio");
    const body = (await res.json().catch(() => ({}))) as { status?: string };
    if (body.status && body.status !== "active") {
      return fail(`account_${body.status}`.slice(0, 40), `Twilio says the account is ${body.status}; texts will not be delivered.`);
    }
    return { ok: true, code: "ok", message: "Twilio accepted the Account SID and Auth Token; the account is active.", detail: "No text was sent." };
  },
};

const PUSH_VARS: EnvVarSpec[] = [
  // Placeholders go inside "…" in a shell command: no backticks or $ (they would run on paste).
  { name: "VAPID_PUBLIC_KEY", required: true, secret: false, placeholder: "public key printed by npx web-push generate-vapid-keys", description: "Web Push public key (generate the pair once with `npx web-push generate-vapid-keys`)." },
  { name: "VAPID_PRIVATE_KEY", required: true, secret: true, placeholder: "private key from the same command", description: "Web Push private key from the same pair. Secret." },
  { name: "VAPID_SUBJECT", required: false, secret: false, placeholder: "mailto:you@yourhospital.org", description: "A contact address for the push services (mailto:… or https://…). Recommended — Apple may refuse pushes without a real one." },
];

const push: IntegrationDef = {
  id: "push",
  name: "Push notifications",
  vendor: "Web Push (VAPID) + Expo",
  icon: "bell",
  purpose:
    "Lock-screen alerts when DocTurn is closed: Web Push for the web app and the iPhone home-screen app (signed with DocTurn's VAPID keys, delivered by Apple/Google/Mozilla), and Expo's push relay for the native app.",
  scope: "platform",
  module: INTEGRATION_MODULES.push,
  phi: false,
  baaRequired: false,
  phiNote:
    "Alerts are content-free (\"New secure message\") — the message itself is fetched inside the app over TLS — so Apple, Google and Expo, who do not sign BAAs for push, never receive PHI.",
  offEffect: "No lock-screen alerts reach this organization's devices and devices cannot register; in-app (open app) delivery is unchanged.",
  activeText: "Connected — web and iPhone alerts are signed with DocTurn's VAPID keys; the native app's alerts go through Expo (no key needed).",
  envVars: PUSH_VARS,
  async evaluate(db, _org, env) {
    const pub = (env.VAPID_PUBLIC_KEY ?? "").trim();
    const priv = (env.VAPID_PRIVATE_KEY ?? "").trim();
    const subj = (env.VAPID_SUBJECT ?? "").trim();
    const invalid: string[] = [];
    if (subj && !/^(mailto:|https:\/\/)/i.test(subj)) invalid.push("VAPID_SUBJECT");
    const subjectNote = subj ? null : "VAPID_SUBJECT is not set — pushes carry a placeholder contact address; set a real one.";
    if (pub && priv) {
      if (!vapidPublicKeyValid(pub)) invalid.push("VAPID_PUBLIC_KEY");
      if (!vapidPrivateKeyValid(priv)) invalid.push("VAPID_PRIVATE_KEY");
      return { configured: !invalid.length, missing: [], invalid, source: "env", note: subjectNote, fingerprint: fingerprint(["push", pub, priv, subj]) };
    }
    const half = pub || priv ? "Only one of VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY is set; the server ignores half a pair. " : "";
    const pid = await platformOrgId(db);
    const stored = pid ? ((await db.getOrgSetting(pid, "vapidKeys")) as { publicKey?: string; privateKey?: string } | null) : null;
    if (stored?.publicKey && stored.privateKey && vapidPublicKeyValid(stored.publicKey) && vapidPrivateKeyValid(stored.privateKey)) {
      return {
        configured: !invalid.length,
        missing: [],
        invalid,
        source: "generated",
        note:
          half +
          "Using the key pair the server generated on its first start (stored in the database). Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to keep the private key in env/SSM instead." +
          (subjectNote ? " " + subjectNote : ""),
        fingerprint: fingerprint(["push-generated", stored.publicKey, subj]),
      };
    }
    return {
      configured: false,
      missing: [!pub ? "VAPID_PUBLIC_KEY" : "", !priv ? "VAPID_PRIVATE_KEY" : ""].filter(Boolean),
      invalid,
      source: null,
      note: half + "Without them the server generates and stores a pair on its next start.",
      fingerprint: fingerprint(["push-none"]),
    };
  },
  async test(db, org, env) {
    const ev = await this.evaluate(db, org, env);
    if (!ev.configured) return fail("invalid_keys", `Not usable: ${[...ev.missing, ...ev.invalid].join(", ")}.`);
    let expected = (env.VAPID_PUBLIC_KEY ?? "").trim();
    if (ev.source === "generated") {
      const pid = await platformOrgId(db);
      expected = ((pid ? await db.getOrgSetting(pid, "vapidKeys") : null) as { publicKey?: string } | null)?.publicKey ?? "";
    }
    const running = integrationDeps().runningVapidKey();
    if (!running) return fail("push_not_running", "Web Push is not running in this server process — restart DocTurn after setting the keys.");
    if (running !== expected) return fail("push_restart_needed", "The server is signing with a different key than the one configured — restart DocTurn to load it.");
    return { ok: true, code: "ok", message: "The VAPID key pair is well-formed and loaded; web and iPhone alerts can be signed.", detail: "The native app uses Expo's relay, which needs no key." };
  },
};

const OPENAI_VARS: EnvVarSpec[] = [
  { name: "OPENAI_API_KEY", required: true, secret: true, placeholder: "sk-… from platform.openai.com", description: "An OpenAI API key (platform.openai.com → API keys), ideally from an organization covered by OpenAI's BAA / zero-data-retention terms." },
  {
    name: "AI_EXTERNAL_PHI_OK",
    required: true,
    secret: false,
    placeholder: "true",
    literal: true,
    description: "Set to true to allow intake notes (PHI) to be sent to OpenAI.",
    caution: "Only after OpenAI has signed a Business Associate Agreement with you. Without a BAA, sending intake notes is a HIPAA violation.",
  },
];

const openai: IntegrationDef = {
  id: "openai-intake",
  name: "OpenAI intake extraction",
  vendor: "OpenAI",
  icon: "sparkles",
  purpose:
    "Reads the ER physician's free-text intake note and pre-fills initials, room, a one-line summary and the likely specialty. When it is off, DocTurn's built-in local extractor fills the form instead.",
  scope: "platform",
  module: INTEGRATION_MODULES.aiIntake,
  phi: true,
  baaRequired: true,
  phiNote:
    "Intake notes ARE protected health information. They go to OpenAI only when the operator has a signed BAA with OpenAI and has set AI_EXTERNAL_PHI_OK=true; otherwise every note stays inside DocTurn.",
  offEffect: "This organization's intake notes never leave DocTurn — the built-in local extractor fills the form.",
  activeText: "Connected — this organization's intake notes are extracted by OpenAI under the operator's BAA.",
  needsBaaText:
    "OPENAI_API_KEY is set, but AI_EXTERNAL_PHI_OK is not \"true\". Intake notes are PHI, so they may only go to OpenAI after OpenAI signs a BAA and the operator sets AI_EXTERNAL_PHI_OK=true. Until then the local extractor is used.",
  envVars: OPENAI_VARS,
  async evaluate(_db, _org, env) {
    const a = aiIntakeEnv(env);
    const fp = fingerprint(["openai", env.OPENAI_API_KEY, env.AI_EXTERNAL_PHI_OK, env.USE_STUB_AI]);
    if (a.stubForced) {
      return {
        configured: false,
        missing: [],
        invalid: ["USE_STUB_AI"],
        source: null,
        note: null,
        blockedText: "USE_STUB_AI=true forces the local extractor for every organization — remove it on the server to use OpenAI.",
        fingerprint: fp,
      };
    }
    if (!a.hasKey) {
      return { configured: false, missing: a.phiOk ? ["OPENAI_API_KEY"] : ["OPENAI_API_KEY", "AI_EXTERNAL_PHI_OK"], invalid: [], source: null, note: null, fingerprint: fp };
    }
    if (!a.phiOk) {
      return { configured: false, needsBaa: true, missing: ["AI_EXTERNAL_PHI_OK"], invalid: [], source: "env", note: null, fingerprint: fp };
    }
    return { configured: true, missing: [], invalid: [], source: "env", note: null, fingerprint: fp };
  },
  async test(_db, _org, env) {
    let res: Response;
    try {
      // Lists models: proves the key without sending any note anywhere.
      res = await integrationFetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${(env.OPENAI_API_KEY ?? "").trim()}`, Accept: "application/json" },
      });
    } catch (err) {
      return callFailure(err);
    }
    if (!res.ok) return httpFailure(res, "OpenAI");
    return { ok: true, code: "ok", message: "OpenAI accepted the API key.", detail: "No patient data was sent." };
  },
};

const AMION_ENV: EnvVarSpec[] = [
  { name: "AMION_OCS_URL", required: false, secret: true, placeholder: "https://www.amion.com/cgi-bin/ocs?Lo=…", description: "Operator fallback: ONE organization's Amion OCS feed URL (contains its login)." },
  { name: "AMION_ORG_CODE", required: false, secret: false, placeholder: "ISPN", description: "Which organization AMION_OCS_URL belongs to (its DocTurn org code)." },
];

const amion: IntegrationDef = {
  id: "amion",
  name: "Amion",
  vendor: "Amion (Spok)",
  icon: "calendar-clock",
  purpose:
    "Pulls your hospital's on-call schedule from Amion every few hours, so the on-call board and the admission rotation know who is working — no retyping.",
  scope: "organization",
  module: "schedule.amion",
  phi: false,
  baaRequired: false,
  phiNote:
    "DocTurn only READS your clinicians' schedule from Amion (names, shifts) — workforce data, not patient data. Nothing is sent to Amion.",
  offEffect: "Scheduled pulls stop and the on-call board stops showing Amion's holders (it falls back to the manual list); the last snapshot is kept.",
  activeText: "Connected — your Amion on-call grid is pulled automatically.",
  // syncAmion runs for every connected org with schedule.amion on, whatever
  // the board shows; the BOARD only shows Amion when it is the selected source.
  activeTextFor({ board }) {
    const base = `Connected — your Amion on-call grid is pulled ${everyMinutes(amionConfig().intervalMin)} and keeps the rotation roster's shifts current`;
    if (!board || board.selected === "amion") return `${base}.`;
    if (!board.boardEnabled) return `${base}; the on-call board is switched off for this organization.`;
    return `${base}, but the on-call board reads ${boardLabel(board.selected)}; ${PICK_SOURCE_HINT("Amion")}`;
  },
  envVars: AMION_ENV,
  async evaluate(db, org) {
    const creds = await readOrgCredentials(db, org.id, "amion");
    if (creds.state === "ok") {
      return { configured: true, missing: [], invalid: [], source: "organization", note: null, fingerprint: credentialFingerprint(creds) };
    }
    const feed = await amionFeedFor(db, org.id);
    if (feed) {
      const cfg = amionConfig();
      return {
        configured: true,
        missing: [],
        invalid: [],
        source: "env",
        note: envFallbackNote(creds.state === "unreadable", `AMION_OCS_URL for ${cfg.orgCode}`),
        fingerprint: fingerprint(["amion-env", cfg.url]),
      };
    }
    if (creds.state === "unreadable") {
      return { configured: false, missing: ["INTEGRATION_KEY"], invalid: [], source: "organization", note: null, blockedText: DECRYPT_BLOCKED, fingerprint: credentialFingerprint(creds) };
    }
    return { configured: false, missing: ["Amion OCS feed URL"], invalid: [], source: null, note: null, fingerprint: fingerprint(["amion-none"]) };
  },
  async test(db, org) {
    const feed = await amionFeedFor(db, org.id);
    if (!feed) return fail("not_configured", "No Amion feed is connected.");
    let res: Response;
    try {
      res = feed.source === "organization" ? await guardedFetch(feed.url) : await integrationFetch(feed.url, { redirect: "follow" });
    } catch (err) {
      return callFailure(err);
    }
    if (!res.ok) return httpFailure(res, "Amion");
    const rows = parseAmionBody(await res.text(), res.headers.get("content-type") ?? "");
    if (!rows.length) {
      return fail("empty_grid", "Amion answered, but no on-call rows could be read — check that the link is the schedule's OCS (on-call) view.");
    }
    const people = new Set(rows.map((r) => toDisplayName(r.name).toLowerCase())).size;
    return { ok: true, code: "ok", message: "Reached Amion and read the on-call grid.", detail: `${rows.length} on-call rows, ${people} people. The roster was not changed — the scheduled sync does that.` };
  },
  lastSync: (db, org) => syncCheck(db, org.id, SYNC_SETTING_KEY),
};

const EPIC_ENV: EnvVarSpec[] = [
  { name: "EPIC_FHIR_BASE_URL", required: false, secret: false, placeholder: "https://<epic-host>/interconnect-fhir-oauth/api/FHIR/R4", description: "Operator fallback for ONE organization: its Epic FHIR R4 base URL." },
  { name: "EPIC_CLIENT_ID", required: false, secret: true, placeholder: "backend app client id", description: "That organization's Epic backend-app client ID." },
  { name: "EPIC_PRIVATE_KEY_PEM", required: false, secret: true, placeholder: "-----BEGIN PRIVATE KEY-----\\n…", description: "The app's RSA private key (PEM; \\n for line breaks)." },
  { name: "EPIC_TOKEN_URL", required: false, secret: false, placeholder: "https://<epic-host>/interconnect-fhir-oauth/oauth2/token", description: "Token endpoint (derived from the base URL when omitted)." },
  { name: "EPIC_ORG_CODE", required: false, secret: false, placeholder: "ISPN", description: "Which organization the EPIC_* app belongs to." },
];

const epic: IntegrationDef = {
  id: "epic-fhir",
  name: "Epic on-call (FHIR)",
  vendor: "Epic",
  icon: "activity",
  purpose:
    "Reads who is on call straight from your Epic system (PractitionerRole and Schedule/Slot over FHIR R4), using a backend app your Epic team registers for DocTurn.",
  scope: "organization",
  module: "schedule.epic",
  phi: false,
  baaRequired: false,
  phiNote:
    "DocTurn requests only clinician scheduling resources (PractitionerRole, Practitioner, Schedule, Slot) — no patient records. Your Epic team approves exactly those read scopes.",
  offEffect: "Epic is not offered as the on-call source and is not pulled; the board reads the manual list. The last snapshot is kept.",
  activeText: "Connected — on-call is read from your Epic system.",
  // The scheduled pull (runScheduledEpicSyncAll) runs for every connected org
  // with schedule.epic on; the BOARD reads Epic only once it is the selected
  // source (getSelectedSource never defaults to Epic). Say which is true.
  activeTextFor({ board, env }) {
    const every = everyMinutes(epicConfig(env).intervalMin);
    if (board && board.selected === "epic" && board.boardEnabled) return `Connected — on-call is read from your Epic system (pulled ${every}).`;
    if (board && !board.boardEnabled) return `Connected — Epic is pulled ${every}; the on-call board is switched off for this organization.`;
    return `Connected — Epic is pulled ${every}, but the on-call board reads ${boardLabel(board?.selected ?? "manual")}; ${PICK_SOURCE_HINT("Epic")}`;
  },
  envVars: EPIC_ENV,
  async evaluate(db, org, env) {
    const creds = await readOrgCredentials(db, org.id, "epic-fhir");
    if (creds.state === "ok") {
      return { configured: true, missing: [], invalid: [], source: "organization", note: null, fingerprint: credentialFingerprint(creds) };
    }
    const cfg = await epicConfigFor(db, org.id, env);
    if (cfg) {
      return {
        configured: true,
        missing: [],
        invalid: [],
        source: "env",
        note: envFallbackNote(creds.state === "unreadable", `EPIC_* for ${epicConfig(env).orgCode}`),
        fingerprint: fingerprint(["epic-env", cfg.baseUrl, cfg.clientId, cfg.tokenUrl]),
      };
    }
    if (creds.state === "unreadable") {
      return { configured: false, missing: ["INTEGRATION_KEY"], invalid: [], source: "organization", note: null, blockedText: DECRYPT_BLOCKED, fingerprint: credentialFingerprint(creds) };
    }
    return {
      configured: false,
      missing: ["FHIR R4 base URL", "Backend app client ID", "Private key (PEM, RS384)"],
      invalid: [],
      source: null,
      note: epicConfigured(env) ? `The operator's EPIC_* app belongs to another organization (${epicConfig(env).orgCode}).` : null,
      fingerprint: fingerprint(["epic-none"]),
    };
  },
  async test(db, org, env) {
    const cfg = await epicConfigFor(db, org.id, env);
    if (!cfg) return fail("not_configured", "No Epic app is connected.");
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      return cfg.source === "organization" ? guardedFetch(url, init ?? {}) : integrationFetch(url, init ?? {});
    }) as typeof fetch;
    try {
      await getAccessToken(cfg, { fetchImpl, now: () => integrationDeps().now() });
    } catch (err) {
      if (err instanceof IntegrationCallError) return callFailure(err);
      const m = err instanceof Error ? err.message : "";
      const http = m.match(/^epic_token_http_(\d{3})$/);
      if (http) {
        const code = Number(http[1]);
        return fail(`http_${code}`, code === 400 || code === 401
          ? `Epic refused the token request (HTTP ${code}) — check the client ID, that the public key is registered for it, and the token URL.`
          : `Epic's token endpoint answered HTTP ${code}.`);
      }
      if (m === "epic_token_missing") return fail("no_token", "Epic answered without an access token.");
      if (/key|sign|PEM|asn1/i.test(m)) return fail("bad_key", "The private key could not sign the request.");
      return fail("error", "The token request failed.");
    }
    return { ok: true, code: "ok", message: "Epic issued an access token for DocTurn's backend app.", detail: "No schedule data was changed — the sync does that." };
  },
  lastSync: (db, org) => syncCheck(db, org.id, EPIC_SETTING_KEY),
};

export const INTEGRATIONS: readonly IntegrationDef[] = [twilio, push, openai, amion, epic];

export function integrationDef(id: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((d) => d.id === id);
}

/** The integration a gating module belongs to (null for every other module). */
export function integrationForModule(moduleId: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((d) => d.module === moduleId);
}

// ── stored test results ─────────────────────────────────────────────────────
const CHECKS_KEY = "integrationChecks";
interface StoredCheck { ok: boolean; code: string; message: string; at: string; fp: string }

/** Platform-scope results live with the platform org (one Twilio for everyone). */
async function checksOrgId(db: DatabaseStorage, def: IntegrationDef, org: Organization): Promise<number> {
  return def.scope === "platform" ? (await platformOrgId(db)) ?? org.id : org.id;
}

async function readCheck(db: DatabaseStorage, def: IntegrationDef, org: Organization, fp: string): Promise<StoredCheck | null> {
  const all = (await db.getOrgSetting(await checksOrgId(db, def, org), CHECKS_KEY)) as Record<string, StoredCheck> | null;
  const c = all && typeof all === "object" ? all[def.id] : undefined;
  return c && c.fp === fp ? c : null;
}

async function writeCheck(db: DatabaseStorage, def: IntegrationDef, org: Organization, check: StoredCheck, actorId: number): Promise<void> {
  const where = await checksOrgId(db, def, org);
  const all = ((await db.getOrgSetting(where, CHECKS_KEY)) as Record<string, StoredCheck> | null) ?? {};
  // A tenant's director testing a platform-scope integration writes into the
  // PLATFORM org's row: never point that row's updated_by (FK → users) at a
  // tenant user, or deleting that tenant would fail on the foreign key. The
  // audit row (integration.test, in the tenant's trail) records who ran it.
  await db.setOrgSetting(where, CHECKS_KEY, { ...all, [def.id]: check }, where === org.id ? actorId : null);
}

// ── cards ───────────────────────────────────────────────────────────────────
export interface CredentialFieldView {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
  multiline: boolean;
  placeholder: string;
  help: string;
}

export interface IntegrationCard {
  id: IntegrationId;
  name: string;
  vendor: string;
  icon: string;
  purpose: string;
  scope: IntegrationScope;
  module: string;
  moduleLabel: string;
  phi: boolean;
  baaRequired: boolean;
  phiNote: string;
  offEffect: string;
  status: IntegrationStatus;
  statusText: string;
  missing: string[];
  invalid: string[];
  note: string | null;
  /** The org's gating module (the switch). */
  enabled: boolean;
  /** The server would accept { enabled: true } right now. */
  canEnable: boolean;
  configSource: "env" | "organization" | "generated" | null;
  lastCheck: LastCheck | null;
  /** Amion / Epic only: where the on-call board really reads from. */
  boardSource: BoardSourceView | null;
  setup:
    | {
        kind: "env";
        /**
         * state: "set" = present AND accepted by the server; "invalid" =
         * present but rejected (the card names it); "missing" = not set.
         * `set` is state === "set" (never mere presence).
         */
        variables: Array<Pick<EnvVarSpec, "name" | "required" | "secret" | "description" | "caution"> & { state: "set" | "invalid" | "missing"; set: boolean }>;
        steps: { render: string[]; aws: string[] };
      }
    | {
        kind: "credentials";
        fields: CredentialFieldView[];
        storage: { available: boolean; message: string | null };
        /** fieldsSet: the NAMES of the saved fields (never a value); empty when they can't be decrypted. */
        current: { set: boolean; readable: boolean; updatedAt: string | null; updatedByName: string | null; summary: Record<string, string>; fieldsSet: string[] } | null;
        operatorFallback: Array<Pick<EnvVarSpec, "name" | "description">>;
      };
}

const RENDER_SERVICE = "your DocTurn web service (docturn-demo in render.yaml)";

function envSteps(def: IntegrationDef): { render: string[]; aws: string[] } {
  const vars = def.envVars;
  return {
    render: [
      `Open dashboard.render.com → ${RENDER_SERVICE} → Environment.`,
      ...vars.map((v) => `Add ${v.name}${v.required ? "" : " (recommended)"} — ${v.description}${v.caution ? " " + v.caution : ""}`),
      "Press \"Save, rebuild, and deploy\" (or \"Save and deploy\"): Render restarts DocTurn with the new values.",
      "Come back to Settings → Integrations and press Test connection.",
    ],
    aws: [
      "On your own computer, with the AWS CLI signed in as your admin user, store each value in SSM Parameter Store (secrets as SecureString; --overwrite lets the same command replace a value later):",
      ...vars.map(
        (v) =>
          `aws ssm put-parameter --region <your-region> --type ${v.secret ? "SecureString" : "String"} --name /docturn/prod/${v.name} --value "${v.literal ? v.placeholder : `<${v.placeholder}>`}" --overwrite${v.caution ? "   # " + v.caution : ""}`,
      ),
      "Then on the server (AWS console → Systems Manager → Session Manager → Start session, then sudo -i) run:",
      "REGION=<your-region> bash /opt/docturn/deploy/aws/fetch-env-from-ssm.sh && systemctl restart docturn",
      "Come back to Settings → Integrations and press Test connection.",
    ],
  };
}

function list(names: string[]): string {
  return names.length <= 1 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

function statusTextFor(
  def: IntegrationDef,
  org: Organization,
  ev: ConfigEval,
  status: IntegrationStatus,
  last: LastCheck | null,
  ctx: { board: BoardSourceView | null; env: NodeJS.ProcessEnv },
): string {
  switch (status) {
    case "active":
      return def.activeTextFor ? def.activeTextFor(ctx) : def.activeText;
    case "off":
      return `Configured, but switched off for ${org.name}. ${def.offEffect}`;
    case "needs_baa":
      return def.needsBaaText ?? "The vendor would receive PHI and no BAA has been attested.";
    case "error":
      return `The last ${last?.kind ?? "check"} failed: ${last?.reason ?? "unknown error"}`;
    case "not_configured": {
      if (ev.blockedText) return ev.blockedText;
      const parts: string[] = [];
      if (ev.missing.length) {
        parts.push(def.scope === "platform" ? `Not connected — the DocTurn operator must set ${list(ev.missing)} on the server.` : `Not connected — enter ${list(ev.missing)} under Set up.`);
      }
      if (ev.invalid.length) parts.push(`${list(ev.invalid)} ${ev.invalid.length > 1 ? "are" : "is"} set but not valid.`);
      return parts.join(" ") || "Not connected.";
    }
  }
}

export async function buildCard(
  db: DatabaseStorage,
  def: IntegrationDef,
  org: Organization,
  env: NodeJS.ProcessEnv = process.env,
): Promise<IntegrationCard> {
  const ev = await def.evaluate(db, org, env);
  const enabled = await isModuleEnabled(org.id, def.module);
  const stored = await readCheck(db, def, org, ev.fingerprint);
  const test: LastCheck | null = stored ? { kind: "test", ok: stored.ok, at: stored.at, reason: stored.ok ? null : stored.message } : null;
  const sync = def.lastSync && ev.configured ? await def.lastSync(db, org) : null;
  const lastCheck = [test, sync].filter((c): c is LastCheck => !!c).sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? null;

  let status: IntegrationStatus;
  if (!ev.configured) status = ev.needsBaa ? "needs_baa" : "not_configured";
  else if (!enabled) status = "off";
  else if (lastCheck && !lastCheck.ok) status = "error";
  else status = "active";
  const board = await boardSourceFor(db, def, org);

  let setup: IntegrationCard["setup"];
  if (def.scope === "platform") {
    setup = {
      kind: "env",
      variables: def.envVars.map((v) => {
        // Presence is not acceptance: a value the evaluation rejected (e.g.
        // AI_EXTERNAL_PHI_OK="<true>", a FROM number without +) is "invalid".
        const present = !!(env[v.name] ?? "").trim();
        const rejected = ev.missing.includes(v.name) || ev.invalid.includes(v.name);
        const state = !present ? ("missing" as const) : rejected ? ("invalid" as const) : ("set" as const);
        return { name: v.name, required: v.required, secret: v.secret, description: v.description, caution: v.caution, state, set: state === "set" };
      }),
      steps: envSteps(def),
    };
  } else {
    const key = credentialKeyState(env);
    const row = await db.getIntegrationCredential(org.id, def.id);
    let current: Extract<IntegrationCard["setup"], { kind: "credentials" }>["current"] = null;
    if (row) {
      const by = row.updatedBy != null ? await db.getUserById(row.updatedBy) : undefined;
      const stored = ev.source === "organization" ? await readOrgCredentials(db, org.id, def.id) : null;
      current = {
        set: true,
        readable: ev.source === "organization" && ev.configured,
        updatedAt: row.updatedAt.toISOString(),
        updatedByName: by ? by.displayName : row.updatedBy != null ? "a former user" : null,
        summary: (row.summary ?? {}) as Record<string, string>,
        // Field NAMES only, so the sheet marks exactly the saved fields.
        fieldsSet: stored && stored.state === "ok" ? Object.keys(stored.values).filter((k) => !!stored.values[k]) : [],
      };
    }
    const fields: CredentialField[] = CREDENTIAL_FIELDS[def.id as "amion" | "epic-fhir"];
    setup = {
      kind: "credentials",
      fields: fields.map((f) => ({ name: f.name, label: f.label, secret: f.secret, required: f.required, multiline: !!f.multiline, placeholder: f.placeholder ?? "", help: f.help })),
      storage: { available: key.ok, message: key.ok ? null : key.message },
      current,
      operatorFallback: def.envVars.map((v) => ({ name: v.name, description: v.description })),
    };
  }

  return {
    id: def.id,
    name: def.name,
    vendor: def.vendor,
    icon: def.icon,
    purpose: def.purpose,
    scope: def.scope,
    module: def.module,
    moduleLabel: MODULES.find((m) => m.id === def.module)?.label ?? def.module,
    phi: def.phi,
    baaRequired: def.baaRequired,
    phiNote: def.phiNote,
    offEffect: def.offEffect,
    status,
    statusText: statusTextFor(def, org, ev, status, lastCheck, { board, env }),
    missing: ev.missing,
    invalid: ev.invalid,
    note: ev.note,
    enabled,
    canEnable: ev.configured,
    configSource: ev.source,
    lastCheck,
    boardSource: board,
    setup,
  };
}

export async function buildCards(db: DatabaseStorage, org: Organization): Promise<IntegrationCard[]> {
  const out: IntegrationCard[] = [];
  for (const def of INTEGRATIONS) out.push(await buildCard(db, def, org));
  return out;
}

/** Status only (cheap enough for the cross-org overview). */
export async function integrationStatus(db: DatabaseStorage, def: IntegrationDef, org: Organization): Promise<{ status: IntegrationStatus; enabled: boolean }> {
  const c = await buildCard(db, def, org);
  return { status: c.status, enabled: c.enabled };
}

/**
 * Run the real, harmless connectivity test and remember the result (for the
 * status). Returns null when there is nothing to test (not configured and,
 * for OpenAI, no key at all).
 */
export async function runIntegrationTest(
  db: DatabaseStorage,
  def: IntegrationDef,
  org: Organization,
  actorId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<(TestOutcome & { at: string }) | null> {
  const ev = await def.evaluate(db, org, env);
  if (!ev.configured && !ev.needsBaa) return null;
  let outcome: TestOutcome;
  try {
    outcome = await def.test(db, org, env);
  } catch (err) {
    outcome = callFailure(err);
  }
  const at = integrationDeps().now().toISOString();
  await writeCheck(db, def, org, { ok: outcome.ok, code: outcome.code, message: outcome.message, at, fp: ev.fingerprint }, actorId);
  return { ...outcome, at };
}
