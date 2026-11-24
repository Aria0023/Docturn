import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appendAudit } from "../audit.js";
import { isModuleEnabled } from "../modules.js";
import { buildOnCallBoard, onCallSourceRegistry } from "../routes/oncall.js";
import { storage, type DatabaseStorage } from "../storage.js";
import type {
  CodeActivation,
  CodeActivationMember,
  CodeActivationStep,
  CodeProtocol,
  CodeTeamSlot,
  User,
} from "../../shared/schema.js";
import { isDnd, resolveCovering } from "./escalation.js";
import { notificationDeps } from "./notifications.js";

/**
 * Code protocols: Code Stroke, Code STEMI and whatever else a hospital runs
 * as a standing emergency plan.
 *
 * A protocol names a TEAM and timed STEPS. A team slot is either an on-call
 * role from the "Who's on call" board (resolved, when the code is called, to
 * whoever holds it at that moment — or their covering provider when they are
 * on Do Not Disturb) or a named person. Activating a protocol freezes that
 * team, alerts each person live and by push, and re-alerts anyone who has not
 * acknowledged. Members acknowledge and mark themselves arrived; steps are
 * ticked off against their targets; the code is completed or stood down.
 *
 * Only people with a DocTurn account can be alerted. A slot nobody on DocTurn
 * holds is shown as NOT ALERTED, with the name the schedule gives, so the
 * team can see who still has to be called — it is never shown as notified.
 *
 * Alerts carry the protocol name and the location only. The linked patient
 * (optional) is read from the server by the screen; it is never in a push.
 */

export const MODULE = "codes.protocols";
/** Roles that may call a code and take part in one. */
export const CODE_ROLES = ["hospitalist", "er_doctor", "er_director", "director", "developer"] as const;
export const canManageCodes = (u: Pick<User, "role">) => u.role === "director" || u.role === "er_director" || u.role === "developer";

const text = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\u0000-\u001f\u007f-\u009f]*$/);
export const protocolInputSchema = z.object({
  name: text(60),
  description: z.string().trim().max(300).regex(/^[^\u0000-\u001f\u007f-\u009f]*$/).default(""),
  team: z
    .array(z.object({ id: z.string().max(40).optional(), label: text(60), kind: z.enum(["oncall", "user"]), ref: z.string().trim().max(160) }))
    .min(1)
    .max(20),
  steps: z
    .array(z.object({ id: z.string().max(40).optional(), label: text(80), targetMin: z.number().int().min(1).max(1440).nullable() }))
    .max(15),
  enabled: z.boolean().default(true),
});
export const activateSchema = z.object({
  protocolId: z.number().int().positive(),
  location: text(80),
  note: z.string().trim().max(300).regex(/^[^\u0000-\u001f\u007f-\u009f]*$/).default(""),
  patientId: z.number().int().positive().nullable().default(null),
});

/**
 * Starting points a director edits to match the hospital's own protocol. The
 * team slots arrive unassigned: the director points each one at an on-call
 * role or a person. The targets are commonly used ones and are the
 * hospital's to confirm.
 */
export const CODE_TEMPLATES = [
  {
    key: "stroke",
    name: "Code Stroke",
    description: "Suspected acute stroke.",
    team: ["ED physician", "Neurologist on call", "Charge nurse", "CT / Radiology", "Pharmacy"],
    steps: [
      ["ED physician at bedside", 10],
      ["CT head started", 25],
      ["CT read", 45],
      ["Thrombolysis decision", 45],
      ["Thrombolytic given, if indicated", 60],
    ],
  },
  {
    key: "stemi",
    name: "Code STEMI",
    description: "ST-elevation myocardial infarction.",
    team: ["ED physician", "Interventional cardiologist on call", "Cath lab team", "Charge nurse"],
    steps: [
      ["ECG done and read", 10],
      ["Cath lab activated", 20],
      ["Patient in cath lab", 60],
      ["Device crossed (door to balloon)", 90],
    ],
  },
  {
    key: "sepsis",
    name: "Code Sepsis",
    description: "Suspected sepsis or septic shock.",
    team: ["ED physician", "Hospitalist", "Charge nurse", "Pharmacy"],
    steps: [
      ["Lactate drawn", 60],
      ["Blood cultures drawn", 60],
      ["Antibiotics started", 60],
      ["Fluids started, if indicated", 60],
    ],
  },
  {
    key: "rapid",
    name: "Rapid Response",
    description: "A patient deteriorating outside the ICU.",
    team: ["Hospitalist", "ICU physician on call", "Charge nurse", "Respiratory therapy"],
    steps: [["Team at bedside", 10], ["Disposition decided", 30]],
  },
] as const;

export function normalizeProtocol(input: z.infer<typeof protocolInputSchema>) {
  return {
    name: input.name,
    description: input.description,
    enabled: input.enabled,
    team: input.team.map((t) => ({ id: t.id || randomUUID().slice(0, 8), label: t.label, kind: t.kind, ref: t.ref })) as CodeTeamSlot[],
    steps: input.steps.map((s) => ({ id: s.id || randomUUID().slice(0, 8), label: s.label, targetMin: s.targetMin })),
  };
}

// ── who holds each team slot right now ───────────────────────────────────────
export interface ResolvedMember {
  label: string;
  userId: number | null;
  name: string | null;
  holderName: string | null;
  coveringFor: string | null;
  /** Why nobody can be alerted, when userId is null. */
  problem: "not_assigned" | "nobody_on_call" | "no_account" | null;
}

/** The on-call roles and people a director can put on a team. */
export async function teamOptions(db: DatabaseStorage, me: User) {
  const [board, users] = await Promise.all([buildOnCallBoard(db, me, onCallSourceRegistry()), db.listUsers(me.organizationId)]);
  const roles = [...new Set(board.rows.filter((r) => r.kind !== "next_hospitalist").map((r) => r.label))].sort((a, b) => a.localeCompare(b));
  return {
    roles,
    people: users
      .filter((u) => !u.disabledAt && u.role !== "developer")
      .map((u) => ({ id: u.id, name: u.displayName, role: u.role }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function resolveTeam(db: DatabaseStorage, me: User, team: CodeTeamSlot[]): Promise<ResolvedMember[]> {
  const orgId = me.organizationId;
  const [board, users] = await Promise.all([buildOnCallBoard(db, me, onCallSourceRegistry()), db.listUsers(orgId)]);
  const active = new Map(users.filter((u) => !u.disabledAt).map((u) => [u.id, u]));
  const out: ResolvedMember[] = [];
  for (const slot of team) {
    let holderId: number | null = null;
    let holderName: string | null = null;
    let problem: ResolvedMember["problem"] = null;
    if (!slot.ref) {
      problem = "not_assigned";
    } else if (slot.kind === "user") {
      const id = /^\d{1,9}$/.test(slot.ref) ? Number(slot.ref) : NaN;
      if (active.has(id)) holderId = id;
      else problem = "no_account";
    } else {
      const rows = board.rows.filter((r) => r.label.trim().toLowerCase() === slot.ref.trim().toLowerCase());
      const withUser = rows.find((r) => r.holderUserId != null && active.has(r.holderUserId));
      if (withUser) holderId = withUser.holderUserId;
      else {
        holderName = rows.find((r) => r.holderName)?.holderName ?? null;
        problem = holderName ? "no_account" : "nobody_on_call";
      }
    }
    if (holderId == null) {
      out.push({ label: slot.label, userId: null, name: null, holderName, coveringFor: null, problem });
      continue;
    }
    // Do Not Disturb hands the alert to the covering provider, when there is one.
    let userId = holderId;
    let coveringFor: string | null = null;
    if (await isDnd(db, holderId)) {
      const cov = await resolveCovering(db, orgId, holderId);
      if (cov != null && active.has(cov) && cov !== holderId) {
        userId = cov;
        coveringFor = active.get(holderId)!.displayName;
      }
    }
    out.push({ label: slot.label, userId, name: active.get(userId)!.displayName, holderName: null, coveringFor, problem: null });
  }
  return out;
}

// ── alerts ───────────────────────────────────────────────────────────────────
async function alertUsers(userIds: number[], act: Pick<CodeActivation, "id" | "protocolName" | "location">, again: boolean) {
  if (!userIds.length) return;
  const { ws, push } = notificationDeps();
  try {
    ws.sendToUsers(userIds, { type: "CODE_ALERT", activationId: act.id, protocolName: act.protocolName, location: act.location, again });
  } catch (err) {
    console.error("[codes] ws alert failed", err);
  }
  for (const userId of userIds) {
    try {
      // The protocol's name only — never the patient.
      await push.send(userId, { title: `${act.protocolName} activated` });
    } catch (err) {
      console.error("[codes] push failed", err);
    }
  }
}

/** Tell every open screen in the org to re-read the codes (ids only). */
export function broadcastCodeChange(orgId: number, activationId: number) {
  try {
    notificationDeps().ws.broadcast(orgId, { type: "CODE_CHANGED", activationId });
  } catch (err) {
    console.error("[codes] ws change failed", err);
  }
}

export class CodeError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

export async function activateCode(db: DatabaseStorage, me: User, input: z.infer<typeof activateSchema>, now = new Date()) {
  const orgId = me.organizationId;
  const protocol = await db.getCodeProtocol(orgId, input.protocolId);
  if (!protocol || !protocol.enabled) throw new CodeError("not_found", 404);
  if (input.patientId != null && !(await db.getPatient(orgId, input.patientId))) throw new CodeError("patient_not_found", 404);
  const team = await resolveTeam(db, me, protocol.team);
  const act = await db.createCodeActivation(
    {
      organizationId: orgId,
      protocolId: protocol.id,
      protocolName: protocol.name,
      location: input.location,
      note: input.note,
      patientId: input.patientId,
      status: "active",
      activatedBy: me.id,
      activatedAt: now,
    },
    team.map((m) => ({
      label: m.label,
      userId: m.userId,
      holderName: m.holderName,
      coveringFor: m.coveringFor,
      // The person calling the code already knows about it.
      alertCount: m.userId != null && m.userId !== me.id ? 1 : 0,
      lastAlertAt: m.userId != null && m.userId !== me.id ? now : null,
      acknowledgedAt: m.userId === me.id ? now : null,
    })),
    protocol.steps.map((s, i) => ({ position: i, label: s.label, targetMin: s.targetMin })),
  );
  const alerted = [...new Set(team.map((m) => m.userId).filter((id): id is number => id != null && id !== me.id))];
  await alertUsers(alerted, act, false);
  broadcastCodeChange(orgId, act.id);
  await appendAudit({
    organizationId: orgId,
    userId: me.id,
    action: "code.activate",
    resourceType: "code_activation",
    resourceId: act.id,
    details: { protocol: protocol.name, protocolId: protocol.id, alerted: alerted.length, notAlerted: team.filter((m) => m.userId == null).length, patientLinked: input.patientId != null },
    riskLevel: "high",
  });
  return act;
}

// ── the status board ─────────────────────────────────────────────────────────
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const minutesBetween = (a: Date | string, b: Date | string) => Math.round(((new Date(b).getTime() - new Date(a).getTime()) / 60_000) * 10) / 10;

export function mayActOn(me: User, act: CodeActivation, members: CodeActivationMember[]) {
  return act.activatedBy === me.id || canManageCodes(me) || members.some((m) => m.userId === me.id);
}

export async function codeViews(db: DatabaseStorage, me: User) {
  const orgId = me.organizationId;
  const acts = await db.listCodeActivations(orgId);
  const ids = acts.map((a) => a.id);
  const [members, steps, users, patients] = await Promise.all([
    db.listCodeMembers(orgId, ids),
    db.listCodeSteps(orgId, ids),
    db.listUsers(orgId),
    acts.some((a) => a.patientId != null) ? db.listPatients(orgId) : Promise.resolve([]),
  ]);
  const name = new Map(users.map((u) => [u.id, u.displayName]));
  const patient = new Map(patients.map((p) => [p.id, p]));
  return acts.map((a) => {
    const mine = members.filter((m) => m.activationId === a.id);
    const p = a.patientId != null ? patient.get(a.patientId) : undefined;
    return {
      id: a.id,
      protocolName: a.protocolName,
      location: a.location,
      note: a.note,
      // A patient removed since (auto-clean) is simply no longer linked.
      patient: p ? { id: p.id, initials: p.initials, room: p.roomNumber } : null,
      status: a.status,
      activatedAt: iso(a.activatedAt)!,
      activatedByName: name.get(a.activatedBy) ?? null,
      closedAt: iso(a.closedAt),
      closedByName: a.closedBy != null ? name.get(a.closedBy) ?? null : null,
      durationMin: a.closedAt ? minutesBetween(a.activatedAt, a.closedAt) : null,
      onTeam: mine.some((m) => m.userId === me.id),
      canAct: a.status === "active" && mayActOn(me, a, mine),
      members: mine.map((m) => ({
        id: m.id,
        label: m.label,
        userId: m.userId,
        name: m.userId != null ? name.get(m.userId) ?? null : null,
        holderName: m.holderName,
        coveringFor: m.coveringFor,
        me: m.userId === me.id,
        alerted: m.userId != null,
        alertCount: m.alertCount,
        acknowledgedAt: iso(m.acknowledgedAt),
        arrivedAt: iso(m.arrivedAt),
        ackMin: m.acknowledgedAt ? minutesBetween(a.activatedAt, m.acknowledgedAt) : null,
      })),
      steps: steps
        .filter((s) => s.activationId === a.id)
        .map((s: CodeActivationStep) => ({
          id: s.id,
          label: s.label,
          targetMin: s.targetMin,
          doneAt: iso(s.doneAt),
          doneByName: s.doneBy != null ? name.get(s.doneBy) ?? null : null,
          doneMin: s.doneAt ? minutesBetween(a.activatedAt, s.doneAt) : null,
        })),
    };
  });
}

export function publicProtocol(p: CodeProtocol) {
  return { id: p.id, name: p.name, description: p.description, team: p.team, steps: p.steps, enabled: p.enabled, updatedAt: iso(p.updatedAt) };
}

// ── re-alert anyone who has not acknowledged ─────────────────────────────────
/** Seconds between alerts, and how many alerts one person gets in total. */
export const REALERT_AFTER_MS = 60_000;
export const MAX_ALERTS = 4;

export async function runCodeRealertSweep(now = new Date(), afterMs = REALERT_AFTER_MS): Promise<number> {
  const db = storage();
  const due = await db.listCodeMembersDueRealert(new Date(now.getTime() - afterMs), MAX_ALERTS);
  let sent = 0;
  for (const { member, protocolName } of due) {
    try {
      if (!(await isModuleEnabled(member.organizationId, MODULE))) continue;
      // Two servers running this sweep must not both alert the same person.
      if (!(await db.claimCodeRealert(member.id, member.alertCount, now))) continue;
      const act = await db.getCodeActivation(member.organizationId, member.activationId);
      if (!act || act.status !== "active") continue;
      await alertUsers([member.userId!], { id: act.id, protocolName, location: act.location }, true);
      broadcastCodeChange(member.organizationId, act.id);
      sent++;
    } catch (err) {
      console.error("[codes] re-alert failed", err);
    }
  }
  return sent;
}

let timer: NodeJS.Timeout | null = null;
export function startCodeRealertLoop(intervalMs = 15_000) {
  if (timer) return;
  timer = setInterval(() => void runCodeRealertSweep().catch((e) => console.error("[codes] sweep failed", e)), intervalMs);
  timer.unref?.();
}
export function stopCodeRealertLoop() {
  if (timer) clearInterval(timer);
  timer = null;
}
