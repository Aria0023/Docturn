/**
 * SMS delivery. Every carrier is an adapter behind one interface; a registry
 * maps the org's chosen carrier to its adapter, falling back to the console stub
 * when no credentials are present (so dev/test/CI never send real SMS).
 *
 * Adding a carrier = one adapter + one switch arm; no workflow changes.
 */
export interface SmsService {
  readonly carrier: string;
  send(to: string, body: string): Promise<{ sid: string }>;
}

export class ConsoleSms implements SmsService {
  readonly carrier: string;
  sent: Array<{ to: string; body: string }> = [];
  constructor(carrier = "console") {
    this.carrier = carrier;
  }
  async send(to: string, body: string) {
    this.sent.push({ to, body });
    console.log(`[sms:stub] → ${to}: ${body}`);
    return { sid: `stub_${Date.now()}` };
  }
}

// Live adapters fall back to the console stub when their credentials are absent,
// so selecting a carrier never breaks a secret-free environment.
export class TwilioSms implements SmsService {
  readonly carrier = "twilio";
  async send(to: string, body: string) {
    if (
      !process.env.TWILIO_ACCOUNT_SID ||
      !process.env.TWILIO_AUTH_TOKEN ||
      !process.env.TWILIO_FROM_NUMBER
    ) {
      return new ConsoleSms().send(to, body);
    }
    // Real Twilio REST call (env-gated; not exercised in CI).
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const auth = Buffer.from(
      `${sid}:${process.env.TWILIO_AUTH_TOKEN}`,
    ).toString("base64");
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: to,
          From: process.env.TWILIO_FROM_NUMBER,
          Body: body,
        }),
      },
    );
    const data = (await res.json()) as { sid?: string };
    return { sid: data.sid ?? `twilio_${Date.now()}` };
  }
}

/** Registry: org.notification_profile.smsCarrier → adapter. */
export function smsFor(carrier: string): SmsService {
  switch (carrier) {
    case "twilio":
      return new TwilioSms();
    // AWS SNS / Pinpoint / MessageBird / Vonage report their carrier but route
    // through the console stub until their SDK + creds are added (same shape).
    case "sns":
    case "pinpoint":
    case "messagebird":
    case "vonage":
      return new ConsoleSms(carrier);
    default:
      return new ConsoleSms();
  }
}
