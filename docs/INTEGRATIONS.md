# Connecting DocTurn's integrations

This is the plain-language guide for connecting the services DocTurn talks to.
Everything here is **real**: each card in **Settings → Integrations** shows what
the server reports right now, the on/off switch is enforced by the server, and
**Test connection** makes an actual (harmless) call from the server.

## The two kinds of integration

| Kind | Whose account | Where the keys go | Who does it |
|---|---|---|---|
| **Platform** — Twilio SMS, Push notifications, OpenAI | yours (the DocTurn operator) — one account for every hospital | the server's settings: **Render → Environment**, or **AWS SSM Parameter Store** | you, once |
| **Per hospital** — Amion, Epic | each hospital's own | **Settings → Integrations → Set up** in DocTurn (stored encrypted) | that hospital's director (or you, as developer, from Organization config → Integrations) |

Platform keys are **never** typed into the DocTurn screens: the Set up sheet for
those cards only lists which variables to add and where, and ticks each one off
once the server has it **and accepts it**. A variable that is present but
rejected (for example `AI_EXTERNAL_PHI_OK` set to anything but `true`, or a
`TWILIO_FROM_NUMBER` without the leading `+`) shows a warning — "set but not
accepted" — instead of a tick.

**Who can change them:** a **director** (and you, as developer). An **ER
director** sees every card and its status but cannot switch, test or set up an
integration — the same rule as every other organization-wide setting (STAT SMS
fallback, assignment timeout, on-call source). The server refuses those
requests (403); the screen shows the controls greyed out with "A director
manages this."

Each organization has an **on/off switch** per integration. It only does
something once the integration is set up — the server refuses to switch on
something that is not configured (or, for OpenAI, has no BAA). Switching off
stops that organization's use immediately (no texts, no pushes, no AI, no
schedule pulls) without touching other organizations.

### What the status badges mean

| Badge | Meaning | What to do |
|---|---|---|
| **Active** | configured, switched on, and the last test/sync worked | nothing |
| **Off** | configured, but switched off for this organization | flip the switch if you want it |
| **Not set up** | something is missing — the card names it (e.g. `TWILIO_AUTH_TOKEN`) | follow **Set up** |
| **Needs BAA** | the vendor would receive patient data and no BAA has been confirmed | sign the BAA first, then set `AI_EXTERNAL_PHI_OK=true` |
| **Error** | the last Test connection or scheduled sync failed — the card says why | fix the cause, press **Test connection** again |

---

## First: the integration key (needed for Amion and Epic)

Hospital credentials (Amion feed links, Epic keys) are encrypted on the server
with **`INTEGRATION_KEY`**. Without it, DocTurn refuses to save them (it never
stores them in plain text) and the Set up sheet says so.

- **Render:** nothing to do — `render.yaml` generates it automatically
  (Environment → `INTEGRATION_KEY`). Don't change it later: saved hospital
  credentials would then need re-entering.
- **AWS:**
  ```bash
  aws ssm put-parameter --region <region> --type SecureString \
    --name /docturn/prod/INTEGRATION_KEY --value "$(openssl rand -hex 32)"
  # on the server (Session Manager, sudo -i):
  REGION=<region> bash /opt/docturn/deploy/aws/fetch-env-from-ssm.sh && systemctl restart docturn
  ```
  Keep a copy somewhere safe (password manager). Losing it is not a disaster —
  directors just re-enter their Amion/Epic details — but it is annoying.

---

## Twilio SMS — texts and SMS sign-in codes (platform)

**What it does:** sends text messages as a last resort — a nudge when a STAT
message stays unacknowledged, assignment escalation texts, and one-time sign-in
codes for two-factor authentication.

**PHI / BAA:** texts never contain patient information (only "open DocTurn"
nudges and codes), so Twilio receives **no PHI** and a BAA is not required for
this use. Your compliance officer may still choose to sign Twilio's.

**You need from Twilio:** Account SID (starts with `AC`), Auth Token, and a
Twilio phone number (Twilio console → Account Info / Phone Numbers).

**On Render:** Dashboard → your DocTurn service → **Environment** → add
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (e.g.
`+15551234567`) → **Save, rebuild, and deploy**.

**On AWS:**
```bash
aws ssm put-parameter --region <region> --type SecureString --name /docturn/prod/TWILIO_ACCOUNT_SID --value "AC…" --overwrite
aws ssm put-parameter --region <region> --type SecureString --name /docturn/prod/TWILIO_AUTH_TOKEN  --value "<token>" --overwrite
aws ssm put-parameter --region <region> --type String       --name /docturn/prod/TWILIO_FROM_NUMBER --value "+15551234567" --overwrite
REGION=<region> bash /opt/docturn/deploy/aws/fetch-env-from-ssm.sh && systemctl restart docturn   # on the server
```
(`--overwrite` lets you run the same line again later to replace a key; AWS
refuses to update an existing parameter without it.)

**Test:** Settings → Integrations → Twilio SMS → **Test connection**. DocTurn
reads your Twilio account (it does **not** send a text) and reports whether the
SID/token pair works and the account is active.

---

## Push notifications — lock-screen alerts (platform)

This was mislabelled "Firebase" before. DocTurn does **not** use Firebase: the
web app and the iPhone home-screen app use standard **Web Push** signed with
DocTurn's own **VAPID keys**, and the native app uses **Expo's** push relay
(which needs no key).

**PHI / BAA:** alerts are content-free ("New secure message"); the message is
fetched inside the app. Apple, Google and Expo receive **no PHI**.

**Keys:** on first start the server generates a key pair and stores it in the
database, so push already works. To keep the private key out of the database
(recommended for production), generate a pair once and set it:
```bash
npx web-push generate-vapid-keys      # prints a public and a private key
```

**On Render:** Environment → add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and
`VAPID_SUBJECT` = `mailto:you@yourhospital.org` → Save and deploy.

**On AWS:**
```bash
aws ssm put-parameter --region <region> --type String       --name /docturn/prod/VAPID_PUBLIC_KEY  --value "<public>" --overwrite
aws ssm put-parameter --region <region> --type SecureString --name /docturn/prod/VAPID_PRIVATE_KEY --value "<private>" --overwrite
aws ssm put-parameter --region <region> --type String       --name /docturn/prod/VAPID_SUBJECT     --value "mailto:you@yourhospital.org" --overwrite
REGION=<region> bash /opt/docturn/deploy/aws/fetch-env-from-ssm.sh && systemctl restart docturn
```
Changing keys invalidates the browser subscriptions made with the old ones, so
set them once, early — before clinicians turn alerts on.

**Test:** **Test connection** checks the keys are well-formed and that the
running server is actually signing with them (it says "restart" if not).

---

## OpenAI — AI intake extraction (platform, **PHI — BAA required**)

**What it does:** reads the ER physician's free-text intake note and pre-fills
initials, room, a one-line summary and the likely specialty. When it is off,
DocTurn's built-in local extractor fills the form instead (nothing leaves
DocTurn).

**PHI / BAA:** intake notes **are** protected health information. They may only
go to OpenAI after **OpenAI has signed a Business Associate Agreement with
you**. DocTurn enforces this: with a key but without `AI_EXTERNAL_PHI_OK=true`
the card shows **Needs BAA** and every note stays on the local extractor.

**On Render** (only after the BAA): Environment → add `OPENAI_API_KEY` and
`AI_EXTERNAL_PHI_OK` = `true` → Save and deploy. (The Render demo holds
synthetic data only — keep it that way.)

**On AWS** (only after the BAA):
```bash
aws ssm put-parameter --region <region> --type SecureString --name /docturn/prod/OPENAI_API_KEY     --value "sk-…" --overwrite
aws ssm put-parameter --region <region> --type String       --name /docturn/prod/AI_EXTERNAL_PHI_OK --value "true" --overwrite
REGION=<region> bash /opt/docturn/deploy/aws/fetch-env-from-ssm.sh && systemctl restart docturn
```
Leave `USE_STUB_AI` unset (`true` forces the local extractor everywhere).

**Test:** **Test connection** lists OpenAI's models with your key — no patient
data is sent. A working key still shows **Needs BAA** until
`AI_EXTERNAL_PHI_OK=true` is set.

---

## Amion — on-call schedule (per hospital)

**What it does:** pulls the hospital's on-call grid from Amion every 4 hours
(`AMION_SYNC_INTERVAL_MIN`), so the on-call board and the admission rotation
know who is working.

**PHI / BAA:** DocTurn only reads clinicians' schedules (workforce data); it
sends nothing to Amion. No PHI.

**You need from the hospital:** its Amion **OCS feed link**
(`https://www.amion.com/cgi-bin/ocs?Lo=…`) — or just the schedule's Amion login
(the `Lo=` value). Ask the hospital's Amion schedule administrator or Amion
support. Treat it like a password.

**Steps (same on Render and AWS — nothing to set on the server):**
1. Director: **Settings → Integrations → Amion → Set up**.
2. Paste the OCS link (or the login) → **Save encrypted**. The sheet then shows
   only "Saved · updated by <name> · <time> · host: www.amion.com" — the link is
   never shown again.
3. **Test connection** — DocTurn fetches the feed and reads the grid with the
   same parser the sync uses ("13 on-call rows, 12 people"). The roster is not
   changed by a test.
4. Turn the switch **on** (it is on by default). The next scheduled pull (or
   **Sync now** in the schedule panel) imports the grid: everyone on it is
   marked working with their shift, and anyone new gets a hospitalist account
   (locked until a director issues a one-time password).
5. The **On-call schedule sync** panel above the cards then shows the last
   pulled grid. The on-call **board** shows Amion when Amion is its source
   (the default once a feed is connected); if a director picked another
   source, the Amion card says which one the board reads.

The schedule panel only offers real connectors: Amion, Epic and the Manual
list — the sources the server has (`PATCH /api/oncall/source`). QGenda,
Tangier, ShiftAdmin, documents and web pages are named as information only:
DocTurn has **no connector** for them, so they are not a choice and nothing is
kept for them in the browser. The Director dashboard's schedule panel reads the
same server answer (`GET /api/oncall/sources`: selected source, configured,
last sync), never a fixed "synced" label.

Older setups that use `AMION_OCS_URL` + `AMION_ORG_CODE` on the server keep
working for that one organization; a hospital's own saved link always wins.

---

## Epic — on-call from Epic over FHIR (per hospital)

**What it does:** reads who is on call straight from the hospital's Epic
(PractitionerRole / Schedule / Slot over FHIR R4, every 60 minutes).

**PHI / BAA:** only clinician scheduling resources are requested — no patient
records. The hospital's Epic team approves exactly those read scopes.

**You need from the hospital's Epic team:** a **backend-services app**
registered for DocTurn (Epic on FHIR / Vendor Services), its **client ID**, the
**RSA private key** whose public half they registered (RS384), and the
hospital's **FHIR R4 base URL** (token URL optional — derived when blank).

**Steps (same on Render and AWS — nothing to set on the server):**
1. Director: **Settings → Integrations → Epic on-call (FHIR) → Set up**.
2. Enter base URL, client ID, private key (and token URL if different) →
   **Save encrypted**.
3. **Test connection** — DocTurn signs a JWT and asks Epic for an access token.
4. Switch it **on** (Epic is off by default). DocTurn then pulls Epic every
   60 minutes (`EPIC_SYNC_INTERVAL_MIN`).
5. Pick **Epic** as the source in the On-call schedule panel (or on the
   On-call board) — only then does the board show Epic's holders. Until you
   do, the Epic card says "Epic is pulled … but the on-call board reads the
   manual list", never that on-call comes from Epic.

Hospital URLs must be public `https://` hosts. DocTurn refuses private,
loopback, link-local, cloud-metadata and internal addresses in every spelling
(including IPv6 forms such as `[::ffff:127.0.0.1]` or NAT64 `[64:ff9b::…]`) —
when the URL is saved, when its host name is resolved, on every redirect, and
again at the moment it connects.

### Time limits

Every outbound call — tests, Amion pulls, each Epic request, Twilio, OpenAI —
has **one 10-second limit that covers the whole answer** (headers and body),
and answers larger than 5 MB are refused. One Epic sync (token plus every
page) must finish within 60 seconds. Hospitals are synced side by side, so a
slow or broken system at one hospital never delays another hospital's pull,
and a scheduled run is skipped while the previous one is still going.

---

## For you as developer

- **Platform → Integrations** shows every organization × integration
  status, plus which platform variables are missing. The header badge of a
  platform integration says **Set on server** (keys present and no failed
  test), **Error** (the last test of those keys failed), **Not set up** or
  **Needs BAA** — whether it is *Active* is per organization, in its row.
- **Organization config → Integrations** shows one organization's real cards —
  you can switch, test and set up on its behalf (audited in its trail).
- The **Modules** console applies the same rule: an integration's module cannot
  be switched on while it is not set up.

Every switch, test and credential change is in the audit trail
(`integration.enable` / `integration.disable` / `integration.test` /
`integration.credentials_set` / `integration.credentials_cleared`) with ids and
outcomes only — never a key, link or token.
