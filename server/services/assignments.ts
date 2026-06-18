import type { Assignment, Hospitalist } from "@shared/schema";
import type { IStorage } from "../storage.js";
import { appendAudit } from "../audit.js";
import { notifyAssignment } from "./notifications.js";
import { selectNext } from "./rotation.js";

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
  // v1: the attending only. (v2 care-team fan-out extends this set.)
  return [hospitalist.userId];
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
  return updated!;
}

/** Provider rejects → rejected; immediate reroute to the next eligible provider. */
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

  const next = await rerouteToNext(storage, orgId, a);
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
  return updated!;
}

/** Director/ER-director reassign → reroute to next eligible or a named provider. */
export async function reassignAssignment(
  storage: IStorage,
  orgId: number,
  assignmentId: number,
  actingUserId: number,
  toHospitalistId?: number,
): Promise<{ previous: Assignment; reroute: Assignment | null }> {
  const a = await storage.getAssignment(orgId, assignmentId);
  if (!a) throw new AssignmentError("not_found", "assignment not found");
  if (a.status !== "pending") {
    throw new AssignmentError("conflict", "only pending can be reassigned");
  }

  const previous = await storage.updateAssignment(orgId, assignmentId, {
    status: "expired",
    resolvedAt: new Date(),
  });

  let next: Assignment | null = null;
  if (toHospitalistId) {
    const target = await storage.getHospitalist(orgId, toHospitalistId);
    if (!target) throw new AssignmentError("not_found", "target not found");
    next = await createReroute(storage, orgId, a, target, "manual");
  } else {
    next = await rerouteToNext(storage, orgId, a);
  }

  await appendAudit({
    organizationId: orgId,
    userId: actingUserId,
    action: "assignment.reassign",
    resourceType: "assignment",
    resourceId: assignmentId,
    details: { toHospitalistId: next?.hospitalistId ?? null },
    riskLevel: "medium",
  });
  return { previous: previous!, reroute: next };
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
