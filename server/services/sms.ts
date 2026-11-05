/**
 * SMS delivery. Every carrier is an adapter behind one interface; a registry
 * maps the org's chosen carrier to its adapter.
 *
 * Without carrier credentials the registry hands out:
 *   - outside production: the console stub, which RECORDS the message in memory
 *     (tests inspect `sent`) and logs one content-free line — never the
 *     recipient's number and never the body (MFA one-time codes travel here);
 *   - in production (NODE_ENV=production): an adapter that fails closed with a
 *     typed `sms_unavailable` error, so no caller can report "sent" for a text
 *     that no carrier ever delivered.
 *
 * Adding a carrier = one adapter + one switch arm; no workflow changes.
 */
import { integrationFetch } from "../integrations/http.js";

export interface SmsService {
  readonly carrier: string;
  send(to: string, body: string): Promise<{ sid: string }>;
}

/** Thrown when the selected carrier cannot deliver (no implementation / no credentials in production). */
export class SmsUnavailableError extends Error {
  readonly code = "sms_unavailable" as const;
  constructor(
    readonly carrier: string,
    readonly reason:
      | "no_credentials"
      | "not_implemented"
      | "console_in_production"
      | "switched_off"
      | "carrier_rejected"
      | "carrier_unreachable",
  ) {
    // Content-free on purpose: this message reaches server logs.
    super(`sms_unavailable: carrier "${carrier}" cannot deliver (${reason})`);
    this.name = "SmsUnavailableError";
  }
}

export function isSmsUnavailable(err: unknown): err is SmsUnavailableError {
  return err instanceof SmsUnavailableError || (err as { code?: unknown } | null)?.code === "sms_unavailable";
}

export class ConsoleSms implements SmsService {
  readonly carrier: string;
  sent: Array<{ to: string; body: string }> = [];
  constructor(carrier = "console") {
    this.carrier = carrier;
  }
  async send(to: string, body: string) {
    this.sent.push({ to, body });
    // Content-free line: no digits of the number, nothing of the body. Logs
    // (stdout → journald) must never carry a phone number or an OTP.
    console.log(
      `[sms:stub] recorded, not delivered (carrier=${this.carrier}, ${body.length} chars) — no SMS credentials`,
    );
    return { sid: `stub_${Date.now()}` };
  }
}

/** Fail-closed adapter: every send rejects with a typed sms_unavailable error. */
export class UnavailableSms implements SmsService {
  constructor(
    readonly carrier: string,
    private readonly reason: SmsUnavailableError["reason"],
  ) {}
  async send(_to: string, _body: string): Promise<{ sid: string }> {
    throw new SmsUnavailableError(this.carrier, this.reason);
  }
}

export function twilioConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER);
}

export class TwilioSms implements SmsService {
  readonly carrier = "twilio";
  async send(to: string, body: string) {
    // The registry only hands this adapter out when configured; guard anyway so
    // a credential removed at runtime fails closed instead of pretending.
    if (!twilioConfigured()) throw new SmsUnavailableError("twilio", "no_credentials");
    // Real Twilio REST call (env-gated; not exercised in CI).
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const auth = Buffer.from(
      `${sid}:${process.env.TWILIO_AUTH_TOKEN}`,
    ).toString("base64");
    // Bounded and injectable like every integration call (one ≤ 10 s deadline
    // over headers AND body, body ≤ 5 MB and already buffered, so res.json()
    // below cannot block); a carrier rejection or an unreachable / stalled
    // carrier is a typed failure, never a "sent".
    let res: Response;
    try {
      res = await integrationFetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: to,
            From: process.env.TWILIO_FROM_NUMBER!,
            Body: body,
          }),
        },
      );
    } catch {
      throw new SmsUnavailableError("twilio", "carrier_unreachable");
    }
    if (!res.ok) throw new SmsUnavailableError("twilio", "carrier_rejected");
    const data = (await res.json().catch(() => ({}))) as { sid?: string };
    return { sid: data.sid ?? `twilio_${Date.now()}` };
  }
}

/** The console stub stands in for a real carrier only outside production. */
export function smsStubAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production";
}

/**
 * The carrier an org's texts actually use. An org that never chose one (the
 * notification profile's default "console") uses Twilio as soon as the
 * operator has configured it — so "Twilio: Connected" in Settings →
 * Integrations is what really happens. An org that explicitly names another
 * carrier keeps it.
 */
export function resolveSmsCarrier(carrier: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const c = carrier || "console";
  return c === "console" && twilioConfigured(env) ? "twilio" : c;
}

/**
 * Registry: org.notification_profile.smsCarrier → adapter (via resolveSmsCarrier).
 * `env` is injectable so tests can exercise the production posture without
 * mutating process.env.
 */
export function smsFor(carrier: string, env: NodeJS.ProcessEnv = process.env): SmsService {
  const fallback = (id: string, reason: SmsUnavailableError["reason"]): SmsService =>
    smsStubAllowed(env) ? new ConsoleSms(id) : new UnavailableSms(id, reason);
  switch (resolveSmsCarrier(carrier, env)) {
    case "twilio":
      return twilioConfigured(env) ? new TwilioSms() : fallback("twilio", "no_credentials");
    // AWS SNS / Pinpoint / MessageBird / Vonage report their carrier but have no
    // implementation yet: the stub records them in dev/test; production refuses.
    case "sns":
    case "pinpoint":
    case "messagebird":
    case "vonage":
      return fallback(carrier, "not_implemented");
    default:
      return fallback("console", "console_in_production");
  }
}
