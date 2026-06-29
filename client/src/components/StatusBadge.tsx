import { Badge } from '@/components/ui/Badge';
import type { BadgeTone } from '@/components/ui/Badge';
import type { AssignmentStatus, PatientStatus, RiskLevel } from '@/lib/types';

const ASSIGNMENT_TONE: Record<AssignmentStatus, BadgeTone> = {
  pending: 'pending',
  accepted: 'accepted',
  rejected: 'rejected',
  expired: 'offline',
  cancelled: 'offline',
};

export function AssignmentBadge({ status }: { status: AssignmentStatus }) {
  return <Badge tone={ASSIGNMENT_TONE[status]}>{status}</Badge>;
}

const PATIENT_TONE: Record<PatientStatus, BadgeTone> = {
  waiting: 'pending',
  assigned: 'info',
  admitted: 'accepted',
  discharged: 'offline',
};

export function PatientStatusBadge({ status }: { status: PatientStatus }) {
  return <Badge tone={PATIENT_TONE[status]}>{status}</Badge>;
}

const RISK_TONE: Record<RiskLevel, BadgeTone> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return <Badge tone={RISK_TONE[level]}>{level} risk</Badge>;
}
