/**
 * Is Stripe really usable for this organization right now?
 *
 * Kept apart from the Stripe client and the integration card so the HOSPITAL's
 * billing screen can answer the one question it needs — "does a human issue my
 * invoices, or does Stripe?" — without importing the collection rail.
 *
 * Both halves must hold:
 *   • the operator has configured Stripe at all (platform-scope secret, and
 *     a webhook secret, in env — never in the database, never committed), and
 *   • this organization's `billing.stripe` module is on.
 *
 * Until then the screen says, in plain words, that the DocTurn operator issues
 * invoices and marks them paid by hand — because that is what happens.
 */
import { isModuleEnabled } from "../modules.js";
import type { DatabaseStorage } from "../storage.js";

export const STRIPE_SECRET_ENV = "STRIPE_SECRET_KEY";
export const STRIPE_WEBHOOK_SECRET_ENV = "STRIPE_WEBHOOK_SECRET";
/** Test-only: point the client at a local Stripe-shaped stub. */
export const STRIPE_API_BASE_ENV = "STRIPE_API_BASE";

export interface StripePlatformConfig {
  secretKey: string;
  webhookSecret: string;
  apiBase: string;
}

/** The operator's Stripe configuration, or the names of what is missing. */
export function stripePlatformConfig(env: NodeJS.ProcessEnv = process.env): {
  config: StripePlatformConfig | null;
  missing: string[];
} {
  const secretKey = (env[STRIPE_SECRET_ENV] ?? "").trim();
  const webhookSecret = (env[STRIPE_WEBHOOK_SECRET_ENV] ?? "").trim();
  const missing: string[] = [];
  if (!secretKey) missing.push(STRIPE_SECRET_ENV);
  if (!webhookSecret) missing.push(STRIPE_WEBHOOK_SECRET_ENV);
  if (missing.length) return { config: null, missing };
  return {
    config: {
      secretKey,
      webhookSecret,
      apiBase: (env[STRIPE_API_BASE_ENV] ?? "https://api.stripe.com").trim().replace(/\/+$/, ""),
    },
    missing: [],
  };
}

export interface StripeOrgState {
  configured: boolean;
  /** The platform settings the operator still has to supply. */
  missing: string[];
  /** This organization's billing.stripe switch. */
  moduleOn: boolean;
}

export async function stripeConfiguredForOrg(
  db: DatabaseStorage,
  orgId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StripeOrgState> {
  void db;
  const { config, missing } = stripePlatformConfig(env);
  const moduleOn = await isModuleEnabled(orgId, "billing.stripe");
  return { configured: !!config && moduleOn, missing, moduleOn };
}
