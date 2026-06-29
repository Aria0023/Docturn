import {
  assignmentStore,
  hospitalistStore,
  patientStore,
  orgStore,
  auditStore,
} from '../storage.js';
import { rotation } from './rotation.js';
import { notifications } from './notifications.js';
import type { Assignment } from '../../shared/schema.js';

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export interface CreateAssignmentInput {
  orgId: number;
  patientId: number;
  assignedByUserId?: number;
  /** When set, manual assignment to a specific hospitalist. */
  hospitalistId?: number;
  capRelief?: boolean;
  exclude?: number[];
}

export const assignmentService = {
  /**
   * Create an assignment. If hospitalistId is provided it's a manual assignment,
   * otherwise round-robin selects the next provider.
   */
  async create(input: CreateAssignmentInput): Promise<{ assignment: Assignment | null; reason: string }> {
    const org = await orgStore.getById(input.orgId);
    if (!org) return { assignment: null, reason: 'org_not_found' };
    const patient = await patientStore.getById(input.patientId);
    if (!patient || patient.orgId !== input.orgId) return { assignment: null, reason: 'patient_not_found' };

    let hospitalistId = input.hospitalistId;
    let via: 'manual' | 'round_robin' = 'manual';

    if (!hospitalistId) {
      via = 'round_robin';
      const sel = await rotation.selectNext(input.orgId, {
        capRelief: input.capRelief,
        exclude: input.exclude,
      });
      if (!sel.hospitalist) return { assignment: null, reason: sel.reason };
      hospitalistId = sel.hospitalist.id;
    } else {
      const h = await hospitalistStore.getById(hospitalistId);
      if (!h || h.orgId !== input.orgId) return { assignment: null, reason: 'hospitalist_not_in_org' };
    }

    const expiresAt = nowSec() + org.assignmentTimeoutMin * 60;
    const assignment = await assignmentStore.create({
      orgId: input.orgId,
      patientId: input.patientId,
      hospitalistId,
      assignedByUserId: input.assignedByUserId,
      status: 'pending',
      via,
      expiresAt,
    });

    await patientStore.update(input.patientId, { status: 'assigned' });

    const h = await hospitalistStore.getById(hospitalistId);
    if (h) {
      await notifications.cascade({
        orgId: input.orgId,
        userIds: [h.userId],
        event: 'assignment.created',
        title: 'New patient assignment',
        body: `Patient ${patient.initials} (room ${patient.room ?? '?'}) needs admission`,
        data: { assignmentId: assignment.id },
      });
    }

    await auditStore.log({
      orgId: input.orgId,
      userId: input.assignedByUserId,
      action: 'assignment_created',
      targetType: 'assignment',
      targetId: assignment.id,
      detail: `via=${via} hospitalist=${hospitalistId}`,
    });

    return { assignment, reason: via };
  },

  async accept(assignmentId: number, actingUserId: number): Promise<{ assignment?: Assignment; error?: string }> {
    const a = await assignmentStore.getById(assignmentId);
    if (!a) return { error: 'not_found' };
    if (a.status !== 'pending') return { error: 'not_pending' };

    const updated = await assignmentStore.update(assignmentId, { status: 'accepted', respondedAt: nowSec() });
    await hospitalistStore.incrementCensus(a.hospitalistId, 1);
    await patientStore.update(a.patientId, { status: 'admitted' });

    const patient = await patientStore.getById(a.patientId);
    await notifications.cascade({
      orgId: a.orgId,
      userIds: [actingUserId],
      event: 'assignment.accepted',
      title: 'Assignment accepted',
      body: `Patient ${patient?.initials ?? '??'} accepted`,
      data: { assignmentId },
    });
    await auditStore.log({
      orgId: a.orgId,
      userId: actingUserId,
      action: 'assignment_accepted',
      targetType: 'assignment',
      targetId: assignmentId,
    });
    return { assignment: updated };
  },

  async reject(
    assignmentId: number,
    actingUserId: number,
    reason?: string,
  ): Promise<{ assignment?: Assignment; reassigned?: Assignment | null; error?: string }> {
    const a = await assignmentStore.getById(assignmentId);
    if (!a) return { error: 'not_found' };
    if (a.status !== 'pending') return { error: 'not_pending' };

    const updated = await assignmentStore.update(assignmentId, {
      status: 'rejected',
      respondedAt: nowSec(),
      rejectionReason: reason,
    });
    await auditStore.log({
      orgId: a.orgId,
      userId: actingUserId,
      action: 'assignment_rejected',
      targetType: 'assignment',
      targetId: assignmentId,
      detail: reason,
    });

    // Reroute, excluding the provider who just rejected.
    const next = await assignmentService.create({
      orgId: a.orgId,
      patientId: a.patientId,
      assignedByUserId: actingUserId,
      exclude: [a.hospitalistId],
      capRelief: true,
    });
    return { assignment: updated, reassigned: next.assignment };
  },

  async cancel(assignmentId: number, actingUserId: number): Promise<{ assignment?: Assignment; error?: string }> {
    const a = await assignmentStore.getById(assignmentId);
    if (!a) return { error: 'not_found' };
    if (a.status === 'cancelled') return { error: 'already_cancelled' };

    const wasAccepted = a.status === 'accepted';
    const updated = await assignmentStore.update(assignmentId, { status: 'cancelled', respondedAt: nowSec() });
    if (wasAccepted) {
      await hospitalistStore.incrementCensus(a.hospitalistId, -1);
    }
    await patientStore.update(a.patientId, { status: 'waiting' });
    await auditStore.log({
      orgId: a.orgId,
      userId: actingUserId,
      action: 'assignment_cancelled',
      targetType: 'assignment',
      targetId: assignmentId,
    });
    return { assignment: updated };
  },

  async reassign(
    assignmentId: number,
    actingUserId: number,
    targetHospitalistId?: number,
  ): Promise<{ assignment?: Assignment; reassigned?: Assignment | null; error?: string }> {
    const a = await assignmentStore.getById(assignmentId);
    if (!a) return { error: 'not_found' };

    if (a.status === 'accepted') {
      await hospitalistStore.incrementCensus(a.hospitalistId, -1);
    }
    await assignmentStore.update(assignmentId, { status: 'cancelled', respondedAt: nowSec() });

    const next = await assignmentService.create({
      orgId: a.orgId,
      patientId: a.patientId,
      assignedByUserId: actingUserId,
      hospitalistId: targetHospitalistId,
      exclude: targetHospitalistId ? undefined : [a.hospitalistId],
      capRelief: true,
    });
    await auditStore.log({
      orgId: a.orgId,
      userId: actingUserId,
      action: 'assignment_reassigned',
      targetType: 'assignment',
      targetId: assignmentId,
      detail: `target=${targetHospitalistId ?? 'round_robin'}`,
    });
    return { assignment: a, reassigned: next.assignment };
  },

  /** Expire one pending assignment and reroute it. Used by the expiry sweeper. */
  async expireAndReroute(assignmentId: number): Promise<Assignment | null> {
    const a = await assignmentStore.getById(assignmentId);
    if (!a || a.status !== 'pending') return null;
    await assignmentStore.update(assignmentId, { status: 'expired', respondedAt: nowSec() });
    await auditStore.log({
      orgId: a.orgId,
      action: 'assignment_expired',
      targetType: 'assignment',
      targetId: assignmentId,
    });
    const next = await assignmentService.create({
      orgId: a.orgId,
      patientId: a.patientId,
      exclude: [a.hospitalistId],
      capRelief: true,
    });
    return next.assignment;
  },
};
