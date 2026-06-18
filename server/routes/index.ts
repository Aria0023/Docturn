import type { Express } from "express";
import { registerAuthRoutes } from "../auth.js";
import { registerAssignmentRoutes } from "./assignments.js";
import { registerHealthRoutes } from "./health.js";
import { registerMessagingRoutes } from "./messaging.js";
import { registerOrgRoutes } from "./org.js";
import { registerPatientRoutes } from "./patients.js";
import { registerProviderRoutes } from "./providers.js";
import { registerSettingsRoutes } from "./settings.js";

/** Mount every REST route onto the app. */
export function registerRoutes(app: Express) {
  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerProviderRoutes(app);
  registerPatientRoutes(app);
  registerAssignmentRoutes(app);
  registerMessagingRoutes(app);
  registerOrgRoutes(app);
  registerSettingsRoutes(app);
}
