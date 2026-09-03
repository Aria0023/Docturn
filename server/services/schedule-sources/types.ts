/**
 * Schedule-source abstraction for the "who's on call" board.
 *
 * Every source (Amion grid, Epic FHIR, director-maintained manual list) reduces
 * to the same OnCallSlot shape, so the board, the source picker and the tests
 * never care where a slot came from. Sources are per-organization: an org picks
 * ONE active source (org setting "scheduleSource"); the board merges its slots
 * with the consult-service holders and the rotation's next hospitalist.
 */

export type ScheduleSourceId = "amion" | "epic" | "manual";

export const SCHEDULE_SOURCE_IDS: readonly ScheduleSourceId[] = ["amion", "epic", "manual"];

export type ShiftType = "day" | "swing" | "night";

export interface OnCallSlot {
  /** Slot / assignment name as published, e.g. "Tarzana 1", "North Triage". */
  slot: string;
  /** Service / role the slot belongs to, e.g. "Hospital Medicine", "Cardiology". */
  service: string;
  /** Raw hours token, e.g. "7a-7p"; "" when the source has no hours. */
  hours: string;
  shift: ShiftType;
  /** Provider display name as published ("First Last"). */
  providerName: string;
  /** Resolved DocTurn user in the SAME org, or null when nobody matches. */
  providerUserId: number | null;
  /** Group / division / department label; "" when unknown. */
  group: string;
  /** Secure-messaging readiness (Amion's onboarding flag; true for app users). */
  secure: boolean;
  source: ScheduleSourceId;
  /** ISO timestamp of the snapshot these slots came from. */
  asOf: string | null;
}

export interface ScheduleSourceStatus {
  id: ScheduleSourceId;
  /** Credentials / data present for THIS org. Never fake data when false. */
  configured: boolean;
  lastSyncAt: string | null;
  lastStatus: "ok" | "error" | "never";
  error: string | null;
  rowCount: number;
  /** Human hint shown in the UI when not configured (e.g. what Epic needs). */
  message: string | null;
}

export interface ScheduleSource {
  id: ScheduleSourceId;
  /** Current slots for the org (from the last good snapshot; never fabricated). */
  fetch(orgId: number): Promise<OnCallSlot[]>;
  /** Configuration + last-sync state for the org. */
  status(orgId: number): Promise<ScheduleSourceStatus>;
}
