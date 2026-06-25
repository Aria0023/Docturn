import type { Assignment, Hospitalist } from "@shared/schema";
import type { DatabaseStorage } from "../storage.js";
import { appendAudit } from "../audit.js";
import { broadcastAssignmentChange, notifyAssignment } from "./notifications.js";
import { selectNext } from "./rotation.js";

// Assignment routing always uses the full storage surface (unit fan-out etc.).
type IStorage = DatabaseStorage;

/**
 * The assignment state machine. Census moves ONLY on accept (++) and
 * cancel-of-accepted (−−) — never on create/reject/expire. Reject and expire
 * always reroute to exactly one new pending assignment when an eligible provider
 * exists, and to none when none do (the patient stays `waiting`).
 */

export class AssignmentError extends Error {
  constructor(
    public code: "not_found" | "conflict" | "no_provider" | "forbidden",
    message: string,
  ) {
    super(message);
  }
}

async function targetUserIds(
  storage: IStorage,
  orgId: number,
  hospitalist: Hospitalist,
): Promise<number[]> {
  // v2 fan-out: the attending AND every on-call unit member.
  return storage.unitUserIds(orgId, hospitalist.userId);
}

/** Create the patient's first routing request. */
export async function createAssignment(
  storage: IStorage,
  params: {
    orgId: number;
    patientId: number;
    erDoctorId: number;
    mode: "round_robin" | "manual";
    hospitalistId?: number;
  },
): Promise<Assignment> {
  const { orgId, patientId, erDoctorId, mode } = params;
  const patient = await storage.getPatient(orgId, patientId);
  if (!patient) throw new AssignmentError("not_found", "patient not found");

  let hospitalist: Hospitalist | null = null;
  if (mode === "manual") {
    if (!params.hospitalistId) {
      throw new AssignmentError("conflict", "hospitalistId required for manual");
    }
    hospitalist =
      (await storage.getHospitalist(orgId, params.hospitalistId)) ?? null;
    if (!hospitalist) {
      throw new AssignmentError("not_found", "hospitalist not found");
    }
  } else {
    hospitalist = await selectNext(storage, orgId, {
      specialty: patient.specialty ?? undefined,
    });
    if (!hospitalist) {
      throw new AssignmentError("no_provider", "no eligible provider");
    }
  }

  const org = await storage.getOrganization(orgId);
  const timeoutMin = org?.assignmentTimeoutMin ?? 10;
  const expiresAt = new Date(Date.now() + timeoutMin * 60_000);

  const assignment = await storage.createAssignment({
    organizationId: orgId,
    patientId,
    hospitalistId: hospitalist.id,
    erDoctorId,
    status: "pending",
    via: mode,
    acceptedByUserId: null,
    expiresAt,
  });

  await appendAudit({
    organizationId: orgId,
    userId: erDoctorId,
    action: "assignment.create",
    resourceType: "assignment",
    resourceId: assignment.id,
    details: { via: mode, hospitalistId: hospitalist.id },
    riskLevel: "low",
  });

  await notifyAssignment(
    assignment,
    await targetUserIds(storage, orgId, hospitalist),
  );
  broadcastAssignmentChange(orgId);
  return assignment;
}

/** Provider accepts → accepted; census++, patient assigned. First accept wins. */
export async function acceptAssignment(
  storage: IStorage,
  orgId: number,
  assignmentId: number,
  acceptingUserId: number,
): Promise<Assignment> {
  const a = await storage.getAssignment(orgId, assignmentId);
  if (!a) throw new AssignmentError("not_found", "assignment not found");
  if (a.status !== "pending") {
    throw new AssignmentError("conflict", "assignment is not pending");
  }

  const hospitalist = await storage.getHospitalist(orgId, a.hospitalistId);
  if (!hospitalist) throw new AssignmentError("not_found", "provider not found");

  const updated = await storage.updateAssignment(orgId, assignmentId, {
    status: "accepted",
    acceptedByUserId: acceptingUserId,
    resolvedAt: new Date(),
  });

  await storage.updateHospitalist(orgId, hospitalist.id, {
    currentPatientCount: hospitalist.currentPatientCount + 1,
  });
  await storage.updatePatient(orgId, a.patientId, {
    status: "assigned",
    assignedHospitalistId: hospitalist.id,
  });

  await appendAudit({
    organizationId: orgId,
    userId: acceptingUserId,
    action: "assignment.accept",
    resourceType: "assignment",
    resourceId: assignmentId,
    details: {},
    riskLevel: "low",
  });
  broadcastAssignmentChange(orgId);
  return updated!;
}

/**
 * Provider rejects → rejected. By default the patient is left UNROUTED so the ER
 * physician / hospitalist director decides where it goes (manual reassignment).
 * If the org has opted into auto-reassign-on-decline, it reroutes to the next
 * eligible provider as before.
 */
export async function rejectAssignment(
  storage: IStorage,
  orgId: number,
  assignmentId: number,
  rejectingUserId: number,
): Promise<{ rejected: Assignment; reroute: Assignment | null }> {
  const a = await storage.getAssignment(orgId, assignmentId);
  if (!a) throw new AssignmentError("not_found", "assignment not found");
  if (a.status !== "pending") {
    throw new AssignmentError("conflict", "assignment is not pending");
  }

  const rejected = await storage.updateAssignment(orgId, assignmentId, {
    status: "rejected",
    resolvedAt: new Date(),
  });
  await appendAudit({
    organizationId: orgId,
    userId: rejectingUserId,
    action: "assignment.reject",
    resourceType: "assignment",
    resourceId: assignmentId,
    details: {},
    riskLevel: "low",
  });

  const autoReassign = (await storage.getOrgSetting(orgId, "autoReassignOnDecline")) === true;
  let next: Assignment | null = null;
  if (autoReassign) {
    next = await rerouteToNext(storage, orgId, a);
  } else {
    // Leave the patient waiting; the ER / director will reassign manually.
    await storage.updatePatient(orgId, a.patientId, {
      status: "waiting",
      assignedHospitalistId: null,
    });
  }
  broadcastAssignmentChange(orgId);
  return { rejected: rejected!, reroute: next };
}

/** Director cancels → cancelled; decrement census if it had been accepted. */
export async function cancelAssignment(
  storage: IStorage,
  orgId: number,
  assignmentId: number,
  cancellingUserId: number,
): Promise<Assignment> {
  const a = await storage.getAssignment(orgId, assignmentId);
  if (!a) throw new AssignmentError("not_found", "assignment not found");

  const wasAccepted = a.status === "accepted";
  const updated = await storage.updateAssignment(orgId, assignmentId, {
    status: "cancelled",
    resolvedAt: new Date(),
  });

  if (wasAccepted) {
    const h = await storage.getHospitalist(orgId, a.hospitalistId);
    if (h) {
      await storage.updateHospitalist(orgId, h.id, {
        currentPatientCount: Math.max(0, h.currentPatientCount - 1),
      });
    }
    await storage.updatePatient(orgId, a.patientId, {
      status: "waiting",
      assignedHospitalistId: null,
    });
  }

  await appendAudit({
    organizationId: orgId,
    userId: cancellingUserId,
    action: "assignment.cancel",
    resourceType: "assignment",
    resourceId: assignmentId,
    details: { wasAccepted },
    riskLevel: "medium",
  });
  broadcastAssignmentChange(orgId);
  return updated!;
}

/**
 * Director / ER reassign. Works whether the patient is still routing (pending),
 * already accepted, OR was declined and left unrouted:
 *   • pending  → release it and re-offer to the named provider (they accept) or
 *     the next eligible provider.
 *   • accepted → release the current attending (census −−) and, when a provider
 *     is named, hand the patient straight to them (census ++, already accepted);
 *     with no name, send the patient back into routing.
 *   • declined/expired (resolved, unrouted) → no release needed; route the
 *     patient afresh to the named provider (or the next eligible one). Refuses
 *     if the patient already has another active assignment.
 */
export async function reassignAssignment(
  storage: IStorage,
  orgId: number,
  assignmentId: number,
  actingUserId: number,
  toHospitalistId?: number,
): Promise<{ previous: Assignment; reroute: Assignment | null }> {
  const a = await storage.getAssignment(orgId, assignmentId);
  if (!a) throw new AssignmentError("not_found", "assignment not found");
  const wasAccepted = a.status === "accepted";
  const wasActive = a.status === "pending" || a.status === "accepted";

  // Re-routing from a resolved (declined/expired) record: only if the patient
  // isn't already being handled by a newer assignment.
  if (!wasActive) {
    const latest = await storage.latestAssignmentByPatient(orgId);
    const cur = latest.get(a.patientId);
    if (cur && (cur.status === "pending" || cur.status === "accepted") && cur.id !== a.id) {
      throw new AssignmentError("conflict", "patient already has an active assignment");
    }
  }

  // Release the current assignment; an accepted one frees the old attending's census.
  let previous = a;
  if (wasActive) {
    previous = (await storage.updateAssignment(orgId, assignmentId, {
      status: wasAccepted ? "cancelled" : "expired",
      resolvedAt: new Date(),
    }))!;
    if (wasAccepted) {
      const oldH = await storage.getHospitalist(orgId, a.hospitalistId);
      if (oldH) {
        await storage.updateHospitalist(orgId, oldH.id, {
          currentPatientCount: Math.max(0, oldH.currentPatientCount - 1),
        });
      }
    }
  }

  let next: Assignment | null = null;
  if (toHospitalistId) {
    const target = await storage.getHospitalist(orgId, toHospitalistId);
    if (!target) throw new AssignmentError("not_found", "target not found");
    next = wasAccepted
      ? await transferTo(storage, orgId, a, target, actingUserId) // direct handoff
      : await createReroute(storage, orgId, a, target, "manual"); // re-offer
  } else {
    if (wasAccepted) {
      await storage.updatePatient(orgId, a.patientId, {
        status: "waiting",
        assignedHospitalistId: null,
      });
    }
    next = await rerouteToNext(storage, orgId, a);
  }

  await appendAudit({
    organizationId: orgId,
    userId: actingUserId,
    action: "assignment.reassign",
    resourceType: "assignment",
    resourceId: assignmentId,
    details: { toHospitalistId: next?.hospitalistId ?? null, fromAccepted: wasAccepted },
    riskLevel: "medium",
  });
  broadcastAssignmentChange(orgId);
  return { previous: previous!, reroute: next };
}

/** Hand an already-accepted patient directly to a new attending (no re-accept). */
async function transferTo(
  storage: IStorage,
  orgId: number,
  previous: Assignment,
  target: Hospitalist,
  actingUserId: number,
): Promise<Assignment> {
  const org = await storage.getOrganization(orgId);
  const timeoutMin = org?.assignmentTimeoutMin ?? 10;
  const created = await storage.createAssignment({
    organizationId: orgId,
    patientId: previous.patientId,
    hospitalistId: target.id,
    erDoctorId: previous.erDoctorId,
    status: "accepted",
    via: "manual",
    acceptedByUserId: actingUserId,
    expiresAt: new Date(Date.now() + timeoutMin * 60_000),
  });
  await storage.updateAssignment(orgId, created.id, { resolvedAt: new Date() });
  await storage.updateHospitalist(orgId, target.id, {
    currentPatientCount: target.currentPatientCount + 1,
  });
  await storage.updatePatient(orgId, previous.patientId, {
    status: "assigned",
    assignedHospitalistId: target.id,
  });
  // Inform the new attending's unit (shows up in their census on rehydrate).
  await notifyAssignment(created, await targetUserIds(storage, orgId, target));
  return created;
}

/** Mark expired pending assignments and reroute each. Capped per tick. */
export async function runExpirySweep(
  storage: IStorage,
  now: Date = new Date(),
  limit = 50,
): Promise<{ expired: number; rerouted: number }> {
  const due = await storage.listPendingExpired(now, limit);
  let rerouted = 0;
  for (const a of due) {
    await storage.updateAssignment(a.organizationId, a.id, {
      status: "expired",
      resolvedAt: now,
    });
    await appendAudit({
      organizationId: a.organizationId,
      userId: null,
      action: "assignment.expire",
      resourceType: "assignment",
      resourceId: a.id,
      details: {},
      riskLevel: "low",
    });
    const next = await rerouteToNext(storage, a.organizationId, a);
    if (next) rerouted++;
    broadcastAssignmentChange(a.organizationId);
  }
  return { expired: due.length, rerouted };
}

// ── reroute helpers ────────────────────────────────────────────────────────────

async function rerouteToNext(
  storage: IStorage,
  orgId: number,
  previous: Assignment,
): Promise<Assignment | null> {
  const patient = await storage.getPatient(orgId, previous.patientId);
  const next = await selectNext(storage, orgId, {
    specialty: patient?.specialty ?? undefined,
    excludeHospitalistId: previous.hospitalistId,
  });
  if (!next) {
    // No eligible provider even after cap relief — leave patient waiting.
    await appendAudit({
      organizationId: orgId,
      userId: null,
      action: "assignment.unrouted",
      resourceType: "patient",
      resourceId: previous.patientId,
      details: {},
      riskLevel: "medium",
    });
    return null;
  }
  return createReroute(storage, orgId, previous, next, "round_robin");
}

async function createReroute(
  storage: IStorage,
  orgId: number,
  previous: Assignment,
  target: Hospitalist,
  via: "round_robin" | "manual",
): Promise<Assignment> {
  const org = await storage.getOrganization(orgId);
  const timeoutMin = org?.assignmentTimeoutMin ?? 10;
  const created = await storage.createAssignment({
    organizationId: orgId,
    patientId: previous.patientId,
    hospitalistId: target.id,
    erDoctorId: previous.erDoctorId,
    status: "pending",
    via,
    acceptedByUserId: null,
    expiresAt: new Date(Date.now() + timeoutMin * 60_000),
  });
  await notifyAssignment(created, await targetUserIds(storage, orgId, target));
  return created;
}
