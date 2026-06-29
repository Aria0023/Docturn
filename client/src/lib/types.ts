export type Role =
  | 'director'
  | 'er_director'
  | 'er_doctor'
  | 'hospitalist'
  | 'developer';

export type AssignmentStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export type PatientStatus = 'waiting' | 'assigned' | 'admitted' | 'discharged';
export type ConversationType = 'direct' | 'group' | 'emergency';
export type ShiftType = 'day' | 'night' | 'swing';
export type RiskLevel = 'low' | 'medium' | 'high';
export type Severity = 'low' | 'medium' | 'high';

export interface User {
  id: number;
  orgId: number;
  role: Role;
  username: string;
  fullName: string;
}

export interface HospitalistUser {
  id: number;
  fullName: string;
  username: string;
  role: Role;
}

export interface Hospitalist {
  id: number;
  orgId: number;
  userId: number;
  specialty: string | null;
  capacity: number;
  census: number;
  isWorking: boolean;
  shiftType: ShiftType;
  rotationOrder: number;
  user: HospitalistUser;
}

export interface Patient {
  id: number;
  initials: string;
  fullName?: string | null;
  room: string | null;
  chiefComplaint: string | null;
  diagnosis?: string | null;
  riskLevel: RiskLevel;
  status: PatientStatus;
}

export interface ExtractResult {
  initials: string;
  room: string;
  chiefComplaint: string;
  diagnosis: string;
  riskLevel: RiskLevel;
  structured: Record<string, unknown>;
}

export interface Assignment {
  id: number;
  patientId: number;
  hospitalistId: number | null;
  status: AssignmentStatus;
  via: string;
  expiresAt: string | null;
}

export interface Conversation {
  id: number;
  type: ConversationType;
  title: string | null;
  participantIds: string;
}

export interface Message {
  id: number;
  senderId: number;
  body: string;
  createdAt: string;
  deleted: boolean;
}

export interface DirectoryUser {
  id: number;
  fullName: string;
  username: string;
  role: Role;
}

export interface Presence {
  online: number[];
}

export interface Broadcast {
  id: number;
  title: string;
  body: string;
  severity: Severity;
}
