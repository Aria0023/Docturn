/**
 * The local Stripe-shaped stub as a standalone server, for
 * scripts/billing-check.mjs (the vitest suite uses the same fixture
 * in-process). There is NO Stripe key in this repository: the stub's secrets
 * are assembled from fragments at runtime by tests/fixtures/stripe-stub.ts, and
 * the only thing it ever does is answer the four endpoints DocTurn calls and
 * record what was sent.
 *
 *   PORT=9312 npx tsx scripts/stripe-stub-server.ts
 *
 * Then start the server under test with
 *   STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET  (printed below)
 *   STRIPE_API_BASE=http://127.0.0.1:9312
 * and run the check with STRIPE_STUB_URL=http://127.0.0.1:9312.
 */
import { fakeStripeSecretKey, fakeStripeWebhookSecret, startStripeStub } from "../tests/fixtures/stripe-stub.js";

const port = Number(process.env.PORT || 9312);
const stub = await startStripeStub(port);
// Printed so a local run can export them; neither is a real credential.
console.log("STRIPE_API_BASE=" + stub.baseUrl);
console.log("STRIPE_SECRET_KEY=" + fakeStripeSecretKey());
console.log("STRIPE_WEBHOOK_SECRET=" + fakeStripeWebhookSecret());
console.log("ready");
