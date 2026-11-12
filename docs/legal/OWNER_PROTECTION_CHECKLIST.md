# Owner Protection Checklist

[NOT LEGAL ADVICE. A working list for you and your attorney. The documents in
this folder protect you only if the steps below are done first.]

## 1. Form the company — before signing anything

* Form an LLC (or a Delaware C-corporation if you intend to raise investment)
  in your home state. Every document here names the company, never you
  personally; sign as "[Name], [Title], for [Company]".
* Keep company money and personal money strictly separate (company bank
  account, company card). Mixing them is how courts "pierce the veil" and reach
  personal assets.
* Get an EIN; keep the company in good standing (annual reports, registered
  agent).

## 2. Put the software in the company's name

* Sign an **IP assignment** transferring DocTurn's code, designs, name and
  domain from you to the company.
* **Check your employment contract** for an inventions-assignment clause, a
  moonlighting/conflict policy and a non-compete. If your hospital could claim
  DocTurn, resolve it in writing before forming or selling anything.
* Anyone else who contributes (contractors, friends, designers) signs a
  contractor agreement with IP assignment and confidentiality **before**
  starting work.
* Keep the GitHub repository and the Render/AWS/Apple/Google accounts in the
  company's name, with your personal accounts as administrators.

## 3. Insurance — what actually pays if something goes wrong

* **Technology errors and omissions (tech E&O)** — covers claims that the
  software failed (for example, a message not delivered).
* **Cyber liability**, including breach-response costs (notification,
  forensics, credit monitoring, regulatory defence).
* **General liability** — often required by hospital vendor onboarding.
* Hospitals usually ask for a certificate showing US $1–5 million per claim.
  Set the MSA "super cap" at or below your cyber limit.
* Your personal malpractice policy does **not** cover DocTurn the business.

## 4. HIPAA as a business associate

* Accept your cloud provider's BAA (AWS: AWS Artifact → Agreements) before any
  real patient data.
* Complete the risk analysis and the policy templates in the app (Compliance
  monitor → Policies); name yourself Privacy Officer and Security Officer in
  writing.
* Rotate the Amion credential that is still visible in git history.
* Keep the demo site synthetic-only; the app enforces this.

## 5. If you offer DocTurn to your own employer or a hospital you refer to

Discuss with a healthcare attorney before the pilot. A physician who owns a
company that sells to — or gives something of value to — a hospital he or
she refers patients to can implicate the federal **Anti-Kickback Statute** and
the **Stark Law**. The usual protections: a written agreement, no free services
beyond a defined evaluation period, fair-market-value pricing set without
regard to referrals, and disclosure under the hospital's conflict-of-interest
policy.

## 6. Regulatory position

* DocTurn routes and records communication; it does not diagnose or recommend
  treatment, so it is designed to stay outside FDA medical-device regulation.
  The note-extraction and suggested-triage features are presented as aids a
  clinician confirms. **Do not add features that predict outcomes or
  recommend treatment** (for example the parked "predictive layer") without a
  regulatory review against the FDA's January 2026 Clinical Decision Support
  guidance.
* The FTC Health Breach Notification Rule generally does not apply to a HIPAA
  business associate's PHI, but would apply if DocTurn ever offered a
  consumer-facing health app; get advice before doing so.

## 7. Name and brand

* Run a trademark clearance search for "DocTurn" before investing in the
  brand. A preliminary search found an unrelated "DocTurn" document-management
  app and a registered "DOCTURNAL HEALTH" mark in the software class. File in
  classes 9 and 42 once cleared.

## 8. Keep the documents true

* Every claim in the Privacy Policy, Security Overview and Subprocessor List
  must match the deployed software. Update them in the same change that alters
  data flows, hosting or vendors.
* Version every signed agreement; keep signed copies for at least six years.
