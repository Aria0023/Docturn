# 06 — Integrations

Every external service is a **TypeScript interface** with two implementations: a **stub** (used
when the relevant env vars are absent — i.e. always, in dev/test) and a **live** one (production).
This keeps the app runnable with zero secrets and makes tests deterministic. A small factory picks
the implementation at startup.

```ts
// server/services/sms.ts
export interface SmsService { send(to: string, body: string): Promise<{ sid: string }>; }

export class ConsoleSms implements SmsService {
  async send(to: string, body: string) {
    console.log(`[sms:stub] → ${to}: ${body}`);
    return { sid: `stub_${Date.now()}` };
  }
}
// One adapter per carrier — all behind the same interface.
export class TwilioSms     implements SmsService { /* real Twilio */ }
export class SnsSms        implements SmsService { /* AWS SNS */ }
export class PinpointSms   implements SmsService { /* AWS Pinpoint */ }
export class MessageBirdSms implements SmsService { /* MessageBird */ }
export class VonageSms     implements SmsService { /* Vonage */ }

// Registry: org.notification_profile.smsCarrier → adapter (falls back to stub when no creds).
export function smsFor(carrier: string): SmsService {
  switch (carrier) {
    case 'twilio':      return new TwilioSms();
    case 'sns':         return new SnsSms();
    case 'pinpoint':    return new PinpointSms();
    case 'messagebird': return new MessageBirdSms();
    case 'vonage':      return new VonageSms();
    default:            return new ConsoleSms();
  }
}
```

**Adding a carrier = one adapter + one `switch` arm; no workflow changes.** Recommended default is
**Amazon SNS / Pinpoint** (free BAA, lower per-message cost); **Twilio** is the reference adapter.
All listed carriers offer a HIPAA BAA.

Apply the same shape to all four:

| Service | Interface | Stub (default / CI) | Live (production) | Env to go live |
|---|---|---|---|---|
| **SMS / MFA** | `SmsService.send()` (per-carrier adapter) | `ConsoleSms` logs | `SnsSms`/`PinpointSms` (default) · `TwilioSms` · `MessageBirdSms` · `VonageSms` + `sms_history` | carrier creds (e.g. `TWILIO_*`, or AWS keys) — selected per org via `notification_profile.smsCarrier` |
| **AI intake** | `AIExtractor.extract(note)` | `MockAIExtractor` (deterministic) | `OpenAIExtractor` (`gpt-4o` / `gpt-4o-mini`) | `OPENAI_API_KEY` |
| **Push** | `PushService.send(user, payload)` | `NoopPush` logs | `FirebasePush` (FCM, per-org) | `FIREBASE_SERVICE_ACCOUNT_JSON` |
| **Scheduling** | `Scheduler.syncShifts(orgId)` | `LocalScheduler` (uses `hospitalists.working`) | `AmionScheduler` | `amionFacilityId`, `amionApiKey` (per-org) |

## Mock AI extractor (deterministic — default)

The intake "AI" must be deterministic so the UI demo and tests are stable. Parse the note with
simple heuristics; fall back to safe defaults.

```ts
export class MockAIExtractor implements AIExtractor {
  async extract(note: string) {
    const initials = (note.match(/\b([A-Z])[a-z]+\s+([A-Z])[a-z]+/)?.slice(1,3).join('')) ?? 'XX';
    const roomNumber = note.match(/\b(?:room|rm)\s*#?\s*(\d{2,4})/i)?.[1] ?? '';
    const specialty =
      /chest pain|cardiac|\bSOB\b/i.test(note) ? 'Cardiology' :
      /\bDKA\b|diabet|glucose/i.test(note)     ? 'Endocrinology' :
      /breath|pneumonia|asthma/i.test(note)    ? 'Pulmonology' :
      'General Medicine';
    const issueSummary = note.trim().split('\n')[0].slice(0, 80) || 'See intake note';
    return { initials, roomNumber, issueSummary, specialty };
  }
}
```

> When `OPENAI_API_KEY` is set, `OpenAIExtractor` uses `gpt-4o` to extract structured fields and
> `gpt-4o-mini` for natural-language commands. **PHI is stripped/truncated in prompts**; on failure
> it falls back to the raw note as the chief complaint. **Do not** call OpenAI in tests
> (`USE_STUB_AI=true` forces the mock).

## Notification delivery uses these

`notifications.notifyAssignment` (see `05_WORKFLOWS.md §4`) is **push-first with timeout-gated SMS
escalation**: `ws.sendToUsers` (real) → content-free `push.send` → after `ackTimeoutSec` re-push/
fan-out → after `escalationTimeoutSec`, only if the org's `mode` includes SMS, `smsFor(carrier).send`
→ optional voice. Steps are skipped per the org delivery profile; stub/transport errors are swallowed
and logged so the workflow always continues.

### Per-org delivery profile (Developer console only)

Stored on `org_settings.notification_profile`; editable **only** in the Developer console (carrier
credentials, enabled carriers, default + per-org override, 10DLC status). Directors and other roles
do not see these controls.

```ts
// org_settings.notification_profile
{
  mode: 'push' | 'push_sms' | 'push_sms_voice',   // 'push' = zero carrier cost
  smsCarrier: 'twilio' | 'sns' | 'pinpoint' | 'messagebird' | 'vonage',
  ackTimeoutSec: 90,
  escalationTimeoutSec: 180
}
```

**Cost note:** push-first keeps a hospital that looked like tens of thousands of SMS/month
($300–2,000/mo) under roughly $100–300/mo, since only unacknowledged escalations + MFA OTPs hit SMS.
The one-time US 10DLC brand/campaign registration is required for A2P SMS regardless of volume.

## Live smoke tests

Provide **env-gated** live smoke tests for each integration (run only when real credentials are
present). Default CI never exercises live calls.

## Secrets policy

- **No secret is required to run or test.** Stubs activate automatically when env vars are missing.
- Real SDK calls are **server-side only**; clients never receive integration credentials.
- `.env.example` ships only `SESSION_SECRET` and `DATABASE_URL`. Add live-integration rows only when
  enabling them; in production, store them in a secrets manager.
