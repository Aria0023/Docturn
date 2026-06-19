import type { Express } from "express";
import { registerAuthRoutes } from "../auth.js";
import { registerAssignmentRoutes } from "./assignments.js";
import { registerBoardRoutes } from "./board.js";
import { registerBroadcastRoutes } from "./broadcasts.js";
import { registerCareTeamRoutes } from "./careteam.js";
import { registerCmsRoutes } from "./cms.js";
import { registerComplianceRoutes } from "./compliance.js";
import { registerConfigRoutes } from "./config.js";
import { registerDevRoutes } from "./dev.js";
import { registerHealthRoutes } from "./health.js";
import { registerMessagingRoutes } from "./messaging.js";
import { registerMfaRoutes } from "./mfa.js";
import { registerMobileRoutes } from "./mobile.js";
import { registerOrgRoutes } from "./org.js";
import { registerPatientRoutes } from "./patients.js";
import { registerProviderRoutes } from "./providers.js";
import { registerResourceRoutes } from "./resources.js";
import { registerSettingsRoutes } from "./settings.js";

/** Mount every REST route onto the app. */
export function registerRoutes(app: Express) {
  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerMfaRoutes(app);
  registerProviderRoutes(app);
  registerPatientRoutes(app);
  registerAssignmentRoutes(app);
  registerMessagingRoutes(app);
  registerOrgRoutes(app);
  registerSettingsRoutes(app);
  registerConfigRoutes(app);
  registerComplianceRoutes(app);
  registerCareTeamRoutes(app);
  registerBoardRoutes(app);
  registerBroadcastRoutes(app);
  registerResourceRoutes(app);
  registerDevRoutes(app);
  registerCmsRoutes(app);
  registerMobileRoutes(app);
}
