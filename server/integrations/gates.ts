import { isModuleEnabled } from "../modules.js";

/**
 * The per-org switches of the platform-scope integrations (shared/modules.ts,
 * group "Integrations"). The HTTP module gate (server/modules.ts GATE_TABLE)
 * covers their API routes; these helpers are for the code paths no route
 * passes through — background SMS escalation, MFA codes, push delivery, the
 * intake extractor — so a switched-off integration is off EVERYWHERE.
 */
export const INTEGRATION_MODULES = {
  sms: "integration.sms",
  push: "integration.push",
  aiIntake: "integration.aiIntake",
} as const;

export function smsAllowedForOrg(orgId: number): Promise<boolean> {
  return isModuleEnabled(orgId, INTEGRATION_MODULES.sms);
}
export function pushAllowedForOrg(orgId: number): Promise<boolean> {
  return isModuleEnabled(orgId, INTEGRATION_MODULES.push);
}
export function aiIntakeAllowedForOrg(orgId: number): Promise<boolean> {
  return isModuleEnabled(orgId, INTEGRATION_MODULES.aiIntake);
}
