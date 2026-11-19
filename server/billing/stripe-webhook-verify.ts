/**
 * Stripe webhook SIGNATURE VERIFICATION (docs/BILLING.md, feature 6).
 *
 * A webhook is an unauthenticated POST from the public internet that can mark
 * a hospital's invoice PAID. The only thing that makes it trustworthy is the
 * signature, so it is verified here, on the RAW body, before anything is
 * parsed or written:
 *
 *   Stripe-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>
 *   signed payload   = `${t}.${rawBody}`
 *   key              = STRIPE_WEBHOOK_SECRET
 *
 * Checked with a TIMING-SAFE comparison, against EVERY v1 scheme in the header
 * (Stripe sends two during a secret rotation), and with a 300-second timestamp
 * tolerance so a captured delivery cannot be replayed later. A request with no
 * signature, a bad signature, a stale timestamp or a body that was re-parsed
 * before it got here is refused — and refused the same way, so the endpoint is
 * not an oracle for which of those it was.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const STRIPE_SIGNATURE_HEADER = "stripe-signature";
/** How old a delivery may be. Stripe's own default. */
export const STRIPE_TOLERANCE_SECONDS = 300;

export type StripeVerifyFailure =
  | "no_signature"
  | "malformed_signature"
  | "timestamp_out_of_tolerance"
  | "bad_signature";

export type StripeVerifyResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: StripeVerifyFailure };

interface ParsedHeader {
  timestamp: number | null;
  v1: string[];
}

export function parseStripeSignatureHeader(header: string): ParsedHeader {
  const out: ParsedHeader = { timestamp: null, v1: [] };
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      const n = Number(value);
      if (Number.isFinite(n)) out.timestamp = n;
    } else if (key === "v1" && /^[0-9a-f]+$/i.test(value)) {
      out.v1.push(value.toLowerCase());
    }
  }
  return out;
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function verifyStripeSignature(
  rawBody: Buffer | string,
  header: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = STRIPE_TOLERANCE_SECONDS,
): StripeVerifyResult {
  if (!header || !header.trim()) return { ok: false, reason: "no_signature" };
  const parsed = parseStripeSignatureHeader(header);
  if (parsed.timestamp == null || parsed.v1.length === 0) {
    return { ok: false, reason: "malformed_signature" };
  }
  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }
  const payload = Buffer.concat([
    Buffer.from(String(parsed.timestamp) + ".", "utf8"),
    typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody,
  ]);
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  // Every v1 in the header: Stripe sends two while a secret is being rotated.
  for (const candidate of parsed.v1) if (sameHex(expected, candidate)) return { ok: true, timestamp: parsed.timestamp };
  return { ok: false, reason: "bad_signature" };
}

/** Build the header a sender would send. Used by the local stub and the tests. */
export function stripeSignatureHeaderFor(
  rawBody: string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): string {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}
