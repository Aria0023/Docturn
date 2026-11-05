import type { Express, RequestHandler } from "express";
import { registerAuthRoutes } from "../auth.js";
import { registerAmionRoutes } from "./amion.js";
import { registerAssignmentRoutes } from "./assignments.js";
import { registerBillingRoutes } from "./billing.js";
import { registerDevBillingRoutes } from "./dev-billing.js";
import { registerStripeWebhookRoutes } from "./stripe-webhook.js";
import { registerBoardRoutes } from "./board.js";
import { registerBroadcastRoutes } from "./broadcasts.js";
import { registerCareTeamRoutes } from "./careteam.js";
import { registerCmsRoutes } from "./cms.js";
import { registerComplianceRoutes } from "./compliance.js";
import { registerConfigRoutes } from "./config.js";
import { registerConsultServiceRoutes } from "./consult-services.js";
import { registerDevRoutes } from "./dev.js";
import { registerDirectoryRoutes } from "./directory.js";
import { registerErRoutes } from "./er.js";
import { registerHealthRoutes } from "./health.js";
import { registerIntegrationRoutes } from "./integrations.js";
import { registerMessagingRoutes } from "./messaging.js";
import { registerMetricsRoutes } from "./metrics.js";
import { registerReportsRoutes } from "./reports.js";
import { registerMfaRoutes } from "./mfa.js";
import { registerMobileRoutes } from "./mobile.js";
import { registerModuleRoutes } from "./modules.js";
import { registerOnCallRoutes } from "./oncall.js";
import { registerAccountRoutes } from "./accounts.js";
import { registerAdmissionsRoutes } from "./admissions.js";
import { registerOrgRoutes } from "./org.js";
import { registerPatientRoutes } from "./patients.js";
import { registerProviderRoutes } from "./providers.js";
import { registerReminderRoutes } from "./reminders.js";
import { registerPinRoutes } from "./pin.js";
import { registerAlertSoundRoutes } from "./alert-sounds.js";
import { registerThemeRoutes } from "./themes.js";
import { registerResourceRoutes } from "./resources.js";
import { registerScimRoutes } from "../scim/users.js";
import { registerScimTokenRoutes } from "./scim-tokens.js";
import { registerSessionPolicyRoutes } from "./session-policy.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerShiftRoutes } from "./shift.js";
import { registerSmsRoutes } from "./sms.js";
import { registerSsoRoutes } from "./sso.js";
import { registerWellKnownRoutes } from "./well-known.js";

/** Mount every REST route onto the app. */
export function registerRoutes(app: Express) {
  registerHealthRoutes(app);
  registerWellKnownRoutes(app);
  registerAuthRoutes(app);
  registerMfaRoutes(app);
  registerProviderRoutes(app);
  registerPatientRoutes(app);
  registerAssignmentRoutes(app);
  registerAdmissionsRoutes(app);
  registerMessagingRoutes(app);
  registerDirectoryRoutes(app);
  registerReminderRoutes(app);
  registerPinRoutes(app);
  registerAlertSoundRoutes(app);
  registerThemeRoutes(app);
  registerMetricsRoutes(app);
  registerReportsRoutes(app);
  registerOrgRoutes(app);
  registerConsultServiceRoutes(app);
  registerSettingsRoutes(app);
  registerSessionPolicyRoutes(app);
  registerScimTokenRoutes(app);
  registerSsoRoutes(app);
  // SCIM 2.0 at /scim/v2 (E2.2): outside /api, authenticated by a per-org
  // bearer token, with its own body parser for application/scim+json.
  registerScimRoutes(app, (app.locals.scimJson as RequestHandler | undefined) ?? ((_q, _s, n) => n()));
  registerShiftRoutes(app);
  registerConfigRoutes(app);
  registerComplianceRoutes(app);
  registerCareTeamRoutes(app);
  registerBoardRoutes(app);
  registerBroadcastRoutes(app);
  registerErRoutes(app);
  registerResourceRoutes(app);
  registerSmsRoutes(app);
  registerDevRoutes(app);
  // Organization billing (docs/BILLING.md): the hospital's own screen (module
  // `billing`, default off) and the operator's console (developer only, never
  // module-gated — the console has to work in order to switch billing on).
  registerBillingRoutes(app);
  registerDevBillingRoutes(app);
  // Stripe's webhook, OUTSIDE /api: unauthenticated (the signature IS the
  // authentication), with its own raw-body parser and its own rate-limit
  // budget, so a retrying Stripe can never spend a clinician's.
  registerStripeWebhookRoutes(app);
  registerCmsRoutes(app);
  registerMobileRoutes(app);
  registerAmionRoutes(app);
  registerModuleRoutes(app);
  registerIntegrationRoutes(app);
  registerOnCallRoutes(app);
  registerAccountRoutes(app);
}
