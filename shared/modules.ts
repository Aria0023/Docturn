/**
 * Feature-module registry — the single list of switchable product functions.
 *
 * Every module can be turned on/off PER ORGANIZATION from the developer console
 * with one click. The server is the source of truth: a disabled module's routes
 * answer 404 { error: "module_disabled" } (see server/modules.ts), and the UI
 * hides the corresponding navigation and controls. Defaults apply when an org has
 * no explicit setting, so adding a module here is enough to ship it enabled.
 *
 * Add a module = add a row here + wrap its routes with requireModule(id) + gate
 * its UI on DT.getState().modules[id]. Remove a module = delete the row (its
 * routes then fall back to enabled-by-default unless you delete them too).
 */
export type ModuleGroup =
  | "Messaging"
  | "Routing"
  | "Schedule"
  | "EHR"
  | "Operations"
  | "Security"
  | "Platform";

export interface ModuleDef {
  id: string;
  label: string;
  group: ModuleGroup;
  /** Enabled for an org that has never touched the switch. */
  default: boolean;
  /** One line shown in the console so an operator knows what flipping it does. */
  blurb: string;
  /** Modules that must be on for this one to work; enforced server-side. */
  requires?: string[];
}

export const MODULES: readonly ModuleDef[] = [
  // ---- Messaging
  { id: "messaging.priority",     label: "Priority & STAT messaging",      group: "Messaging", default: true,  blurb: "Routine / urgent / STAT levels with acknowledgement." },
  { id: "messaging.escalation",   label: "STAT escalation engine",         group: "Messaging", default: true,  blurb: "Unacknowledged STAT re-alerts, then escalates to the covering provider.", requires: ["messaging.priority"] },
  { id: "messaging.forwarding",   label: "Message forwarding",             group: "Messaging", default: true,  blurb: "Forward a message or thread to a person, role or group with provenance." },
  { id: "messaging.templates",    label: "Message templates",              group: "Messaging", default: true,  blurb: "Org and personal canned messages in the composer." },
  { id: "messaging.attachments",  label: "Attachments",                    group: "Messaging", default: true,  blurb: "Images and documents in messages (type allow-list, participant-only access)." },
  { id: "messaging.patientThreads", label: "Patient-linked threads",       group: "Messaging", default: true,  blurb: "A care-team conversation bound to a patient." },
  { id: "messaging.dnd",          label: "Do-not-disturb & covering",      group: "Messaging", default: true,  blurb: "DND with a covering provider; senders see an availability message." },
  { id: "messaging.recall",       label: "Message recall",                 group: "Messaging", default: true,  blurb: "Sender can recall an unread message (audited)." },
  { id: "broadcasts",             label: "Emergency broadcasts",           group: "Messaging", default: true,  blurb: "Org-wide broadcast with per-recipient acknowledgement." },

  // ---- Routing
  { id: "routing.assignments",    label: "Admission routing",              group: "Routing",   default: true,  blurb: "ER → hospitalist assignment with round-robin, caps, expiry re-route." },
  { id: "routing.consults",       label: "Consult services",               group: "Routing",   default: true,  blurb: "Specialty consult fan-out to the on-call team." },
  { id: "routing.roleMessaging",  label: "Message the on-call role",       group: "Routing",   default: true,  blurb: "Address a role/service; resolves to whoever is on now." },

  // ---- Schedule
  { id: "oncall.board",           label: "Who's on call board",            group: "Schedule",  default: true,  blurb: "Every role/service and its current holder, from the configured schedule source." },
  { id: "schedule.amion",         label: "Amion schedule sync",            group: "Schedule",  default: true,  blurb: "Automated pull of the Amion on-call grid (needs AMION_OCS_URL)." },
  { id: "schedule.epic",          label: "Epic on-call (FHIR)",            group: "Schedule",  default: false, blurb: "On-call from Epic via FHIR R4 (needs Epic app credentials)." },

  // ---- EHR
  { id: "ehr.deepLinks",          label: "Open in EHR",                    group: "EHR",       default: false, blurb: "Deep-link a patient into Epic Haiku/Canto or Cerner from any patient row." },

  // ---- Operations
  { id: "ops.analytics",          label: "Director analytics",             group: "Operations", default: true, blurb: "Response/acceptance latency, volumes, KPIs (director roles only)." },
  { id: "ops.resources",          label: "Beds & resources",               group: "Operations", default: true,  blurb: "Beds/equipment/department tracking and /api/resources metrics (legacy surface — switch off to retire it per org)." },
  { id: "ops.retention",          label: "Message retention purge",        group: "Operations", default: true, blurb: "Per-org retention window with audited purge." },

  // ---- Security
  { id: "security.mfaRequired",   label: "Require MFA for privileged roles", group: "Security", default: false, blurb: "Directors / ER directors / developers must enrol MFA before privileged access." },

  // ---- Platform
  { id: "platform.appearance",    label: "Appearance / theming",           group: "Platform",  default: true,  blurb: "Per-org colours and branding." },
  { id: "platform.cms",           label: "Landing / contact pages",        group: "Platform",  default: false, blurb: "Public landing and contact page content." },
] as const;

export type ModuleId = (typeof MODULES)[number]["id"];

export const MODULE_IDS: readonly string[] = MODULES.map((m) => m.id);

export function moduleDefaults(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const m of MODULES) out[m.id] = m.default;
  return out;
}

/**
 * Resolve the effective map for an org from its stored overrides, honouring
 * `requires` (a module whose prerequisite is off is reported off).
 */
export function resolveModules(overrides: Record<string, unknown> | null | undefined): Record<string, boolean> {
  const eff = moduleDefaults();
  if (overrides && typeof overrides === "object") {
    for (const [k, v] of Object.entries(overrides)) {
      if (k in eff && typeof v === "boolean") eff[k] = v;
    }
  }
  // Two passes are enough for the shallow dependency graph declared above.
  for (let pass = 0; pass < 2; pass++) {
    for (const m of MODULES) {
      if (m.requires?.some((r) => eff[r] === false)) eff[m.id] = false;
    }
  }
  return eff;
}
