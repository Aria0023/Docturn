/**
 * Billing hooks. Usage events are emitted after every metered action; a
 * provider adapter forwards them (Stripe metered billing, Chargebee, an
 * internal ledger). Default: log-only. Events contain no PHI.
 */
export interface BillingEvent {
  orgId: number;
  userId: number;
  action: "generate" | "export";
  plan: "trial" | "seat" | "usage";
  billingRef: string | null;
  at: Date;
}

export interface BillingHook {
  readonly name: string;
  onUsage(event: BillingEvent): Promise<void> | void;
}

export class LogBillingHook implements BillingHook {
  readonly name = "log";
  onUsage(e: BillingEvent) {
    if (process.env.NODE_ENV !== "test") console.log(`[billing] org=${e.orgId} user=${e.userId} ${e.action} plan=${e.plan}`);
  }
}

/** Stripe metered usage (usage records on a subscription item). Env-gated. */
export class StripeBillingHook implements BillingHook {
  readonly name = "stripe";
  constructor(private secretKey: string) {}
  async onUsage(e: BillingEvent) {
    if (!e.billingRef) return; // billingRef = subscription item id (si_...)
    try {
      await fetch(`https://api.stripe.com/v1/subscription_items/${e.billingRef}/usage_records`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ quantity: "1", timestamp: String(Math.floor(e.at.getTime() / 1000)), action: "increment" }),
      });
    } catch (err) {
      console.error("[billing] stripe usage record failed", err);
    }
  }
}

const hooks: BillingHook[] = [];
export function configureBilling(list: BillingHook[]) {
  hooks.splice(0, hooks.length, ...list);
}
export function getBillingHooks(): BillingHook[] {
  if (!hooks.length) {
    hooks.push(process.env.STRIPE_SECRET_KEY ? new StripeBillingHook(process.env.STRIPE_SECRET_KEY) : new LogBillingHook());
  }
  return hooks;
}
export function emitBillingEvent(e: BillingEvent) {
  for (const h of getBillingHooks()) {
    try {
      void h.onUsage(e);
    } catch (err) {
      console.error(`[billing] hook ${h.name} failed`, err);
    }
  }
}
