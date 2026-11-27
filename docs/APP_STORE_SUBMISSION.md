# DocTurn for iPhone — App Store submission pack

Everything Apple asks for, ready to paste. The app itself is `mobile-app/`
(a native shell around the DocTurn web app: push notifications, camera and
microphone for messages, deep links). Background and device checks are in
`docs/MOBILE.md`.

**What cannot be done from the repository:** the installable file must be
signed with *your* Apple Developer account, so the build is three commands you
run (below). Expo's cloud service does the build; no Mac is needed.

## 1. One-time setup (you)

1. **Apple Developer Program**, enrolled as an organization ($99/year; needs
   your company's D-U-N-S number). https://developer.apple.com/programs/
2. **Expo account** (free tier is enough to start). https://expo.dev
3. In **App Store Connect** → My Apps → "+" → New App: platform iOS, name
   **DocTurn**, bundle ID **com.docturn.app**, SKU `docturn-ios`.

## 2. Build and upload (three commands)

```bash
npm install -g eas-cli
cd mobile-app && npm ci
eas login
eas init                                   # links the project; prints a project id
eas build --platform ios --profile production   # signs with your Apple account, ~15 min
eas submit --platform ios --latest              # uploads the build to App Store Connect
```

- `eas init` prints a project id: add it to `eas.json` under each profile's
  `env` as `EAS_PROJECT_ID` (push notifications need it), then build.
- The first `eas build` asks to sign in to your Apple account and creates the
  signing certificate, provisioning profile and push key for you.
- After `eas submit`, the build appears in App Store Connect → **TestFlight**
  within about 15 minutes. That is the "ready to download" stage: add yourself
  and pilot users as testers and install through the TestFlight app.
- When you are ready for the public store: App Store Connect → the app →
  add the build to version 1.0 → **Submit for Review**.

## 3. Server settings for links (Render environment)

`APPLE_TEAM_ID=<your team id>` and `IOS_BUNDLE_ID=com.docturn.app`, so
`https://docturn.onrender.com/.well-known/apple-app-site-association` answers
200 and message links open the app.

## 4. Store listing (paste into App Store Connect)

| Field | Text |
| --- | --- |
| Name | DocTurn |
| Subtitle (30) | Clinical messaging & admissions |
| Category | Medical (secondary: Business) |
| Age rating | 17+ is not required; answer "None" to all content questions → 4+ |
| Price | Free (hospitals are billed under contract, outside the app) |
| Privacy Policy URL | https://docturn.onrender.com/privacy |
| Support URL | https://docturn.onrender.com/home |
| Marketing URL | https://docturn.onrender.com/home |
| Copyright | © 2026 [YOUR LEGAL ENTITY NAME] |

**Promotional text (170):**
Secure messaging, STAT alerts, admissions and consults for hospital medicine
teams, in one place.

**Description:**

DocTurn is the all-in-one, HIPAA-compliant messaging platform for acute care
hospitals. It connects the emergency department, hospitalists, consultants and
directors in one secure place.

• Secure messaging: direct, group and patient-linked conversations with
routine, urgent and STAT priorities.
• STAT alerts: urgent messages ask for an acknowledgement and escalate to the
covering provider when nobody responds.
• Admissions: the ER sends a request, the next hospitalist gets it with a
response clock, and one tap accepts it.
• Consults: ask a service's on-call physician or a specific physician by name
and see the answer as soon as it is given.
• On-call and directory: who is covering each service right now.
• Private by design: notifications never show patient details, and patients
appear by initials and room.

DocTurn is for clinicians at hospitals that use DocTurn. Your hospital's
administrator creates your account; there is no sign-up in the app.

DocTurn is a communication tool. It is not an emergency system and does not
provide medical advice.

**Keywords (100):**
hospitalist,clinical messaging,HIPAA,secure texting,on call,admissions,consult,STAT,hospital,pager

**Screenshots (6.9" iPhone, 1320×2868):** `mobile-app/store/screenshots/`
(five images, in order). They show demo data only.

## 5. App Privacy answers (must match the app's privacy manifest)

"Do you collect data from this app?" **Yes.** None of it is used for tracking.

| Data type | Collected | Linked to the user | Purpose |
| --- | --- | --- | --- |
| Contact Info → Name | Yes | Yes | App Functionality |
| Identifiers → User ID | Yes | Yes | App Functionality |
| Identifiers → Device ID (push token) | Yes | Yes | App Functionality |
| Health & Fitness → Health | Yes | Yes | App Functionality |
| User Content → Other User Content (messages, attachments) | Yes | Yes | App Functionality |

Export compliance: the app uses only standard HTTPS encryption
(`ITSAppUsesNonExemptEncryption` is already set to No).

## 6. Notes for the App Review team (paste into "App Review Information")

> DocTurn is a clinical communication app for hospital staff. Accounts are
> created by each hospital's administrator, so the app has no sign-up.
>
> Demo account (synthetic test data only, no real patients):
> Organization code: ISPN — Username: chen — Password: [DEMO PASSWORD]
> A second account to see messages arrive: Username: er.doc, same password.
>
> What is native: push notifications for STAT, urgent and routine messages
> (content-free, three channels), camera and microphone access for image and
> voice messages, universal links that open a conversation, an offline screen
> with automatic retry, and a status bar that follows the app's theme.
> The clinical screens are served from our server so that every clinician,
> on every device, always runs the same reviewed version, which matters for
> patient safety.
>
> The app is a tool for licensed clinicians at contracted hospitals. It does
> not provide medical advice or diagnosis.

Sign-in required: **Yes**. Contact: [YOUR NAME], [PHONE], [EMAIL].

## 7. Before you press Submit

- Replace the bracketed items above (legal entity, contact, demo password).
  Set a dedicated demo password for the review account rather than the
  default one.
- Install the TestFlight build on a real iPhone and run the device checklist
  in `docs/MOBILE.md` (push arrives, links open, voice message records).
- **Review risk:** Apple sometimes rejects apps that mostly show a website
  (guideline 4.2). The native features and the review note above are the
  case for approval; if it is rejected, reply through Resolution Center with
  the same points. TestFlight distribution to pilot hospitals works
  regardless of that review outcome for internal testers.
- The reviewer's demo server must be up and on test data when you submit.
