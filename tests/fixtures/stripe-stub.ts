/**
 * A LOCAL STRIPE-SHAPED STUB for the tests and the Playwright check — the same
 * approach as tests/fixtures/oidc-issuer.ts.
 *
 * There is no Stripe key in this repository and there never will be. This stub
 * answers the four endpoints the collection rail uses, in Stripe's shapes, over
 * plain HTTP on 127.0.0.1, and it RECORDS every request body so a test can
 * assert exactly what was sent — which is how "nothing but billing data goes to
 * Stripe" is proved end to end rather than only at the payload builder.
 *
 * The secrets it checks are built AT RUNTIME from fragments, so no string in
 * this repository looks like a credential to a secret scanner or to GitHub's
 * push protection.
 */
import { createServer, type Server } from "node:http";
import { stripeSignatureHeaderFor } from "../../server/billing/stripe-webhook-verify.js";

/** Built at runtime so this file contains no credential-shaped literal. */
export function fakeStripeSecretKey(): string {
  return ["sk", "test", "docturnlocalstub0000"].join("_");
}
export function fakeStripeWebhookSecret(): string {
  return ["whsec", "docturnlocalstub0000"].join("_");
}

export interface StubRequest {
  method: string;
  path: string;
  auth: string | undefined;
  /** The form body, flattened exactly as it arrived (metadata[x] stays as such). */
  form: Record<string, string>;
}

export interface StripeStub {
  baseUrl: string;
  requests: StubRequest[];
  /** Stripe object ids the stub handed out, newest last. */
  customers: string[];
  invoices: string[];
  /** POST a signed event at a DocTurn server, as Stripe would. */
  deliver(
    docturnBase: string,
    event: Record<string, unknown>,
    opts?: { secret?: string; timestamp?: number; signature?: string | null },
  ): Promise<{ status: number; body: unknown }>;
  close(): Promise<void>;
}

function parseForm(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}

export async function startStripeStub(port: number): Promise<StripeStub> {
  const requests: StubRequest[] = [];
  const customers: string[] = [];
  const invoices: string[] = [];
  let n = 0;

  // Declared before the handler so the /__deliver control endpoint can use the
  // same signing path the returned `deliver` exposes.
  let deliverFn: (
    base: string,
    event: Record<string, unknown>,
    opts?: { secret?: string; timestamp?: number; signature?: string | null },
  ) => Promise<{ status: number; body: unknown }> = async () => ({ status: 0, body: null });

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const path = (req.url ?? "").split("?")[0]!;
      requests.push({
        method: req.method ?? "GET",
        path,
        auth: req.headers.authorization,
        form: parseForm(text),
      });
      const json = (status: number, body: unknown) => {
        const s = JSON.stringify(body);
        res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
        res.end(s);
      };
      // Control endpoints, for the Playwright check (scripts/billing-check.mjs)
      // which cannot reach into this process. They carry no Stripe semantics
      // and are answered before the API-key check, since they are not Stripe.
      if (path === "/__requests" && req.method === "GET") return json(200, { requests });
      if (path === "/__requests" && req.method === "DELETE") {
        requests.length = 0;
        return json(200, { cleared: true });
      }
      if (path === "/__deliver" && req.method === "POST") {
        // Sign the event the way Stripe would and POST it at the DocTurn
        // server — so the signature is produced OUTSIDE the server under test.
        let parsed: { target?: string; event?: Record<string, unknown> } = {};
        try {
          parsed = JSON.parse(text);
        } catch {
          return json(400, { error: "bad control body" });
        }
        const base = String(parsed.target ?? "").replace(/\/webhooks\/stripe$/, "");
        deliverFn(base, parsed.event ?? {}).then(
          (out) => json(200, out),
          (err) => json(502, { error: String((err as Error)?.message ?? err) }),
        );
        return;
      }
      // A missing / wrong key answers the way Stripe does, so the "Test
      // connection" error path is exercised for real.
      if (req.headers.authorization !== "Bearer " + fakeStripeSecretKey()) {
        return json(401, { error: { code: "api_key_invalid", message: "Invalid API Key provided." } });
      }
      // The test-connection read, inside the same permission scope the
      // operator's key needs for everything else.
      if (path === "/v1/customers" && req.method === "GET") {
        return json(200, { object: "list", data: customers.map((id) => ({ id, object: "customer" })) });
      }
      if (path === "/v1/customers") {
        const id = "cus_stub" + ++n;
        customers.push(id);
        return json(200, { id, object: "customer" });
      }
      if (path === "/v1/invoiceitems") return json(200, { id: "ii_stub" + ++n, object: "invoiceitem" });
      if (path === "/v1/invoices") {
        const id = "in_stub" + ++n;
        invoices.push(id);
        return json(200, { id, object: "invoice", status: "draft" });
      }
      if (/^\/v1\/invoices\/[^/]+\/finalize$/.test(path)) {
        return json(200, { id: path.split("/")[3], object: "invoice", status: "open" });
      }
      // The ONE call that makes Stripe email the hospital.
      if (/^\/v1\/invoices\/[^/]+\/send$/.test(path)) {
        return json(200, { id: path.split("/")[3], object: "invoice", status: "open" });
      }
      return json(404, { error: { code: "resource_missing", message: "No such endpoint." } });
    });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  const api: StripeStub = {
    baseUrl: "http://127.0.0.1:" + port,
    requests,
    customers,
    invoices,
    async deliver(docturnBase, event, opts = {}) {
      const raw = JSON.stringify(event);
      const secret = opts.secret ?? fakeStripeWebhookSecret();
      const header =
        opts.signature !== undefined
          ? opts.signature
          : stripeSignatureHeaderFor(raw, secret, opts.timestamp ?? Math.floor(Date.now() / 1000));
      const res = await fetch(docturnBase + "/webhooks/stripe", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(header ? { "stripe-signature": header } : {}),
        },
        body: raw,
      });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: res.status, body };
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  deliverFn = (base, event, opts) => api.deliver(base, event, opts);
  return api;
}
