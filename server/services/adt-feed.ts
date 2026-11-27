import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseStorage } from "../storage.js";

/**
 * EHR admission feed (module ehr.adtFeed): HL7 v2 ADT messages posted by the
 * hospital's interface engine over HTTPS.
 *
 *   A01 admit, A04 register, A05 pre-admit  → add the patient (or update by MRN)
 *   A02 transfer, A06/A07 class change, A08 update → update the patient
 *   A03 discharge, A11 cancel admit        → mark the patient discharged
 *
 * A patient is matched by MRN (PID-3) within the organization. A patient the
 * feed added stays in DocTurn until the EHR discharges them — the hourly
 * auto-clean leaves them alone — so the census is the hospital's, not a
 * 24-hour window. Messages are never stored and never logged: only counts
 * and the time of the last message are kept.
 *
 * Authentication is a per-hospital token a director generates once
 * (Settings → Integrations); only its SHA-256 is stored. This has been tested
 * against generated HL7, not against a live interface engine: field
 * positions vary by site and are confirmed during onboarding.
 */
export const ADT_SETTING_KEY = "adtFeed";
export const ADT_MODULE = "ehr.adtFeed";

export interface AdtState {
  tokenHash: string | null;
  createdAt: string | null;
  lastMessageAt: string | null;
  lastEvent: string | null;
  received: number;
  rejected: number;
}
const EMPTY: AdtState = { tokenHash: null, createdAt: null, lastMessageAt: null, lastEvent: null, received: 0, rejected: 0 };
const hash = (token: string) => createHash("sha256").update("docturn.adt-token:" + token).digest("hex");

export async function readAdtState(db: DatabaseStorage, orgId: number): Promise<AdtState> {
  const raw = (await db.getOrgSetting(orgId, ADT_SETTING_KEY)) as Partial<AdtState> | null;
  return raw && typeof raw === "object" ? { ...EMPTY, ...raw } : { ...EMPTY };
}

/** A new token (replacing any earlier one). Returned ONCE; only its hash is kept. */
export async function issueAdtToken(db: DatabaseStorage, orgId: number, actorUserId: number): Promise<string> {
  const token = `adt_${orgId}_${randomBytes(24).toString("base64url")}`;
  const prev = await readAdtState(db, orgId);
  await db.setOrgSetting(orgId, ADT_SETTING_KEY, { ...prev, tokenHash: hash(token), createdAt: new Date().toISOString() }, actorUserId);
  return token;
}
export async function revokeAdtToken(db: DatabaseStorage, orgId: number, actorUserId: number) {
  const prev = await readAdtState(db, orgId);
  await db.setOrgSetting(orgId, ADT_SETTING_KEY, { ...prev, tokenHash: null, createdAt: null }, actorUserId);
}

/** The organization a presented token belongs to, or null. */
export async function orgForAdtToken(db: DatabaseStorage, token: string): Promise<number | null> {
  const m = /^adt_(\d{1,9})_[A-Za-z0-9_-]{20,}$/.exec(token);
  if (!m) return null;
  const orgId = Number(m[1]);
  const state = await readAdtState(db, orgId);
  if (!state.tokenHash) return null;
  const a = Buffer.from(state.tokenHash, "hex"), b = Buffer.from(hash(token), "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? orgId : null;
}

// ── HL7 v2 ───────────────────────────────────────────────────────────────────
export interface AdtMessage {
  event: string; // A01, A03, …
  controlId: string;
  mrn: string;
  fullName: string | null;
  initials: string;
  dateOfBirth: string | null;
  patientClass: string | null;
  unit: string | null;
  room: string | null;
  reason: string | null;
}
export class AdtParseError extends Error {}

const clean = (s: string | undefined, max: number) => (s ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, max);

export function parseAdt(raw: string): AdtMessage {
  const segments = raw.replace(/\r\n|\n/g, "\r").split("\r").map((s) => s.trim()).filter(Boolean);
  const msh = segments.find((s) => s.startsWith("MSH"));
  if (!msh || msh.length < 8) throw new AdtParseError("no_msh");
  const fs = msh[3]!, cs = msh[4]!, rs = msh[5] ?? "~";
  // MSH-1 is the field separator itself, so MSH fields are offset by one.
  const mshF = msh.split(fs);
  const type = (mshF[8] ?? "").split(cs);
  if (type[0] !== "ADT") throw new AdtParseError("not_adt");
  const event = clean(type[1], 3).toUpperCase();
  const seg = (name: string) => segments.find((s) => s.startsWith(name + fs))?.split(fs);
  const pid = seg("PID");
  if (!pid) throw new AdtParseError("no_pid");
  // PID-3: one or more identifiers; prefer the one typed MR, else the first.
  const ids = (pid[3] ?? "").split(rs).map((r) => r.split(cs));
  const mrn = clean((ids.find((c) => (c[4] ?? "").toUpperCase() === "MR") ?? ids[0] ?? [])[0], 32).replace(/[^A-Za-z0-9._:-]/g, "");
  if (!mrn) throw new AdtParseError("no_mrn");
  const name = ((pid[5] ?? "").split(rs)[0] ?? "").split(cs);
  const family = clean(name[0], 40), given = clean(name[1], 40);
  const fullName = [given, family].filter(Boolean).join(" ") || null;
  const dobRaw = clean(pid[7], 8);
  const dateOfBirth = /^(19|20)\d{6}$/.test(dobRaw) ? `${dobRaw.slice(0, 4)}-${dobRaw.slice(4, 6)}-${dobRaw.slice(6, 8)}` : null;
  const pv1 = seg("PV1");
  const loc = (pv1?.[3] ?? "").split(cs);
  const pv2 = seg("PV2");
  const dg1 = seg("DG1");
  const reason = clean((pv2?.[3] ?? "").split(cs)[1] || (pv2?.[3] ?? "").split(cs)[0] || (dg1?.[3] ?? "").split(cs)[1] || dg1?.[4], 300) || null;
  return {
    event,
    controlId: clean(mshF[9], 40),
    mrn,
    fullName,
    initials: (((given[0] ?? "") + (family[0] ?? "")).toUpperCase() || "??").slice(0, 8),
    dateOfBirth,
    patientClass: clean(pv1?.[2], 2).toUpperCase() || null,
    unit: clean(loc[0], 20) || null,
    room: [clean(loc[1], 20), clean(loc[2], 10)].filter(Boolean).join("-") || null,
    reason,
  };
}

/** The HL7 acknowledgement the interface engine expects back. */
export function adtAck(raw: string, code: "AA" | "AE" | "AR", text = ""): string {
  const msh = raw.replace(/\r\n|\n/g, "\r").split("\r").find((s) => s.startsWith("MSH")) ?? "MSH|^~\\&";
  const fs = msh[3] ?? "|";
  const f = msh.split(fs);
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const id = (f[9] ?? "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40);
  return [
    ["MSH", f[1] ?? "^~\\&", "DOCTURN", "", f[2] ?? "", f[3] ?? "", ts, "", "ACK", "ACK" + ts, f[10] ?? "P", f[11] ?? "2.5"].join(fs),
    ["MSA", code, id, text.replace(/[|\r\n]/g, " ").slice(0, 80)].join(fs),
  ].join("\r") + "\r";
}

const ADD = new Set(["A01", "A04", "A05"]);
const UPDATE = new Set(["A02", "A06", "A07", "A08"]);
const DISCHARGE = new Set(["A03", "A11"]);

export type AdtOutcome = "added" | "updated" | "discharged" | "ignored";

/** Apply one message to the organization's patients. Idempotent by MRN. */
export async function applyAdt(db: DatabaseStorage, orgId: number, msg: AdtMessage, identityOn: boolean): Promise<AdtOutcome> {
  const existing = await db.findPatientByMrn(orgId, msg.mrn);
  if (DISCHARGE.has(msg.event)) {
    if (!existing || existing.status === "discharged") return "ignored";
    await db.updatePatient(orgId, existing.id, { status: "discharged" });
    return "discharged";
  }
  if (!ADD.has(msg.event) && !UPDATE.has(msg.event)) return "ignored";
  const fields = {
    roomNumber: msg.room ?? undefined,
    department: msg.unit ?? undefined,
    // With identity switched off DocTurn keeps initials only — and the MRN
    // it needs to match the next message for this patient.
    fullName: identityOn ? msg.fullName ?? undefined : undefined,
    dateOfBirth: identityOn ? msg.dateOfBirth ?? undefined : undefined,
  };
  if (existing) {
    const patch = Object.fromEntries(Object.entries({ ...fields, initials: msg.initials !== "??" ? msg.initials : undefined, issueSummary: msg.reason ?? undefined }).filter(([, v]) => v !== undefined));
    // A re-admission of someone discharged earlier comes back as waiting.
    if (existing.status === "discharged" && ADD.has(msg.event)) Object.assign(patch, { status: "waiting", assignedHospitalistId: null, source: "adt" });
    if (Object.keys(patch).length) await db.updatePatient(orgId, existing.id, patch);
    return "updated";
  }
  // An update for a patient DocTurn never heard of is added too: the feed may
  // have been connected after they were admitted.
  await db.createPatient({
    organizationId: orgId,
    initials: msg.initials,
    roomNumber: msg.room,
    issueSummary: msg.reason ?? "",
    specialty: null,
    department: msg.unit,
    acuity: null,
    status: "waiting",
    erDoctorId: null,
    assignedHospitalistId: null,
    mrn: msg.mrn,
    fullName: fields.fullName ?? null,
    dateOfBirth: fields.dateOfBirth ?? null,
    source: "adt",
  });
  return "added";
}

export async function recordAdt(db: DatabaseStorage, orgId: number, ok: boolean, event: string | null) {
  const prev = await readAdtState(db, orgId);
  await db.setOrgSetting(
    orgId,
    ADT_SETTING_KEY,
    ok
      ? { ...prev, received: prev.received + 1, lastMessageAt: new Date().toISOString(), lastEvent: event }
      : { ...prev, rejected: prev.rejected + 1 },
    null as unknown as number,
  );
}
