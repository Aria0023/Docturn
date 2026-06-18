// Shapes returned by the API, mirroring shared/schema.ts on the server.

export type Role =
  | "director"
  | "er_director"
  | "er_doctor"
  | "hospitalist"
  | "developer";

export interface User {
  id: number;
  username: string;
  role: Role;
  displayName: string;
  organizationId: number;
  credential: string | null;
}

export interface Hospitalist {
  id: number;
  organizationId: number;
  userId: number;
  specialty: string;
  currentPatientCount: number;
  patientCap: number;
  rotationOrder: number;
  working: boolean;
  shiftType: "day" | "night" | "swing";
}

export interface Patient {
  id: number;
  initials: string;
  roomNumber: string | null;
  issueSummary: string;
  specialty: string | null;
  department: string | null;
  status: "waiting" | "assigned" | "admitted" | "discharged";
  assignedHospitalistId: number | null;
  createdAt: string;
}

export interface Assignment {
  id: number;
  organizationId: number;
  patientId: number;
  hospitalistId: number;
  erDoctorId: number | null;
  status: "pending" | "accepted" | "rejected" | "expired" | "cancelled";
  via: "round_robin" | "manual";
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface DirectoryEntry {
  id: number;
  userId: number;
  displayName: string;
  credential: string | null;
  specialty: string;
  working: boolean;
  shiftType: string;
}

export interface Conversation {
  id: number;
  type: "direct" | "group" | "emergency";
  name: string | null;
  participantIds: number[];
  lastMessage: Message | null;
  unreadCount: number;
}

export interface Message {
  id: number;
  conversationId: number;
  senderId: number;
  content: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface BoardRow {
  patient: {
    id: number;
    initials: string;
    room: string | null;
    department: string | null;
    issue: string;
    status: string;
  };
  responsible: {
    attending: { userId: number; displayName: string } | null;
    unit: Array<{ userId: number; credential: string | null; displayName: string }>;
  } | null;
  consultants: string[];
  admittedBy: { userId: number; displayName: string } | null;
  status: string;
}

export interface CareTeam {
  owner: { userId: number; displayName: string };
  members: Array<{
    userId: number;
    displayName: string;
    credential: string | null;
    onCall: boolean;
  }>;
}

export interface Candidate {
  userId: number;
  displayName: string;
  credential: string | null;
  role: string;
}

export interface Suggestion {
  id: number;
  key: string;
  proposedValue: unknown;
  evidence: string | null;
  status: string;
}

export interface FeatureFlag {
  id: number;
  flag: string;
  enabled: boolean;
  variant: string | null;
}

export interface Broadcast {
  id: number;
  message: string;
  severity: "info" | "urgent" | "critical";
  createdAt: string;
}
