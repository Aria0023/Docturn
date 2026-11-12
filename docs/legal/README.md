# DocTurn legal document set

**Status: DRAFTS FOR ATTORNEY REVIEW — not legal advice, not yet in force.**
Every document uses `[BRACKETED]` placeholders for facts only you can supply
(legal entity name, state, address, effective date, dollar amounts). Do not
publish or sign any of these until a licensed attorney in your state has
reviewed them. They were written to match what the DocTurn software actually
does today; if the product changes, the documents must change with it.

## What each document is, who it binds, and when you need it

| # | Document | Binds | You need it | Public? |
|---|---|---|---|---|
| 1 | [Privacy Policy](PRIVACY_POLICY.md) | DocTurn ↔ everyone who uses the site or app | Before any app-store submission, and before the first real user | Yes — `/privacy` |
| 2 | [Terms of Use](TERMS_OF_USE.md) | DocTurn ↔ each individual clinician user | Before the first real user | Yes — `/terms` |
| 3 | [Clinical Safety Notice](CLINICAL_SAFETY_NOTICE.md) | Shown to every user; incorporated into 2 and 4 | Before the first real user | Yes — `/clinical-safety` |
| 4 | [Master Subscription Agreement](MASTER_SUBSCRIPTION_AGREEMENT.md) | DocTurn ↔ the hospital (paying customer) | Before the first PAID customer | No — signed per customer |
| 5 | [Business Associate Agreement](BUSINESS_ASSOCIATE_AGREEMENT.md) | DocTurn ↔ the hospital (HIPAA) | Before ANY real patient information enters DocTurn | No — signed per customer |
| 6 | [Pilot / Evaluation Agreement](PILOT_EVALUATION_AGREEMENT.md) | DocTurn ↔ a pilot hospital | Before the first pilot — **this is the one you need first** | No — signed per pilot |
| 7 | [Acceptable Use Policy](ACCEPTABLE_USE_POLICY.md) | Every user; incorporated into 2 and 4 | With 2 | Yes — `/acceptable-use` |
| 8 | [Service Level Agreement](SERVICE_LEVEL_AGREEMENT.md) | DocTurn ↔ paying hospital (exhibit to 4) | Before the first paid customer on production hosting | No |
| 9 | [Subprocessor List](SUBPROCESSORS.md) | Disclosure referenced by 1, 4 and 5 | With 1 and 5 | Yes — `/subprocessors` |
| 10 | [Owner Protection Checklist](OWNER_PROTECTION_CHECKLIST.md) | You — entity, insurance, IP, conflicts | Now | No |

Internal HIPAA policies (risk analysis, incident response, contingency plan,
workforce training, sanctions, access review and seven more) already exist as
editable templates in the app: **Compliance monitor → Policies**. They are
not repeated here.

## The order to put them in place

1. **Now:** form the entity and do the checklist in document 10 — it decides
   whose name goes on every other document.
2. **First pilot (synthetic data):** document 6, with 2, 3 and 7 shown to users
   at sign-in.
3. **Before any real patient data:** document 5 signed, AWS BAA accepted, the
   app's real-PHI preflight passing (`docs/HIPAA_AUDIT_2026-11.md`).
4. **First paid customer:** documents 4 and 8.
5. **App Store / Google Play submission:** document 1 at a public URL (the app
   serves it at `/privacy`) and 2 at `/terms`.

## How these were drafted — and what an attorney must still decide

The structure follows public sources rather than any one company's text (the
wording is original; copying another company's contract is a copyright problem
and imports terms written for their product, not yours):

* **BAA:** the HHS Office for Civil Rights *Sample Business Associate Agreement
  Provisions* (January 2013, post-Omnibus) and the required elements of
  45 CFR §164.504(e); breach reporting follows §164.410.
* **Clinical-messaging terms:** the public TigerConnect Terms of Service, EULA
  and Acceptable Use Policy (liability routed to the BAA for PHI claims; a
  separate dollar cap for those; a 12-month-fees general cap), and the common
  industry practice of stating that a messaging tool is not an emergency
  system.
* **Liability structure:** published SaaS and health-technology contracting
  guidance — a general cap of 12 months' fees, a higher "super cap" for data
  and HIPAA claims, mutual exclusion of indirect damages, and gross negligence
  / wilful misconduct carved out of every cap.
* **App-store privacy:** Apple App Review Guidelines 5.1.1 (privacy policy link
  in App Store Connect and in the app) and 5.1.3 (health data never used for
  advertising or data mining, never sold).
* **State privacy law:** Washington's My Health My Data Act and California's
  CCPA both exempt HIPAA PHI held by a business associate; DocTurn's non-PHI
  account data is addressed in the Privacy Policy regardless.

Decisions left for your attorney (each is marked `[ATTORNEY]` in the text):

1. Governing law and venue (default drafted: your home state).
2. Whether to include arbitration with a class-action waiver for individual
   users (drafted as optional, off).
3. The dollar amounts of both liability caps and the cyber-insurance limit
   that backs them.
4. The BAA breach-reporting window (drafted: 5 business days for a breach,
   60 calendar days outer limit; hospitals often ask for 24–72 hours).
5. Whether the pilot is offered to your own employer, which raises
   Anti-Kickback and Stark questions (document 10, item 5).

## Sources consulted

* HHS OCR, Sample Business Associate Agreement Provisions —
  https://www.hhs.gov/hipaa/for-professionals/covered-entities/sample-business-associate-agreement-provisions/
* 45 CFR §164.410 (business associate breach notification) —
  https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D/section-164.410
* TigerConnect Terms of Service — https://tigerconnect.com/legal/terms-of-service-agreement/ ;
  End-User License — https://tigerconnect.com/terms/end-user-terms-use-license-agreement/ ;
  Acceptable Use Policy — https://tigerconnect.com/legal/acceptable-use-policy/
* HunterMaclean, 14 Cybersecurity Clauses for Healthcare Technology Contracts —
  https://www.huntermaclean.com/2020/02/14-cybersecurity-clauses-to-know-for-healthcare-technology-contracts/
* SaaS liability-cap guidance — https://www.cloudnuro.ai/blog/saas-liability-cap ;
  sample health MSA super cap — https://www.wellness360.co/master-services-agreement-msa/
* Apple App Review Guidelines 5.1.1 / 5.1.3 (summaries) —
  https://www.iubenda.com/en/help/401 ; https://ptkd.com/journal/app-store-health-medical-data-rules-5-1-3
* Washington My Health My Data Act exemptions —
  https://connectontech.bakermckenzie.com/my-health-my-data-exceptions-and-exemptions-examined/
* FDA Clinical Decision Support Software guidance (January 2026) —
  https://www.fda.gov/media/109618/download
