# DocTurn Subprocessors

**Last updated:** [DATE]

[DRAFT FOR ATTORNEY REVIEW — NOT IN FORCE. Keep this list accurate: a
subprocessor that can encounter PHI must have signed a business associate
agreement with DocTurn before it does.]

DocTurn uses the following service providers to operate the Service. Where a
provider could encounter patient information (PHI), DocTurn has a business
associate agreement with it. DocTurn gives Customers at least **[thirty (30)]
days'** notice before adding a provider that could encounter PHI.

| Provider | Purpose | Data it receives | Location | PHI? | BAA |
|---|---|---|---|---|---|
| [Amazon Web Services, Inc.] | Production hosting, database, storage, backups | All Service data | United States | Yes | [Required before go-live] |
| Apple Inc. (Apple Push Notification service) | Delivering notifications to iPhones | A device token and a content-free alert ("New STAT message") | Global | **No** — notifications carry no patient details | Not required |
| Google LLC (Firebase Cloud Messaging) | Delivering notifications to Android phones | A device token and a content-free alert | Global | **No** | Not required |
| [Expo / 650 Industries, Inc.] | Push-notification relay for the DocTurn mobile apps | A device token and a content-free alert | United States | **No** | Not required |
| Browser push services (Apple, Google, Mozilla, Microsoft) | Delivering notifications to the installed web app | A push endpoint and an encrypted, content-free alert | Global | **No** | Not required |
| Stripe, Inc. *(only if the Customer is invoiced through Stripe)* | Invoicing and payment collection | Organization name, billing contact, PO number, seat counts, invoice lines | United States | **No** — the software refuses any field outside a billing allow-list | Not required |
| Twilio Inc. *(only if the Customer enables SMS)* | Text-message alerts | Phone number and a content-free alert | United States | **No** by design | [Sign before enabling] |
| OpenAI, L.L.C. *(only if the Customer enables external AI intake)* | Extracting fields from an admission note | The admission note text | United States | **Yes** | **Required — the feature is disabled without one** |

**Not subprocessors:** systems a Customer connects to DocTurn on its own
authority — its electronic health record (for example Epic), its scheduling
system (for example Amion) and its identity provider (for example Okta or
Microsoft Entra ID) — act for the Customer under the Customer's own contracts.

**Demonstration site.** DocTurn's public demonstration site
(docturn.onrender.com) is hosted by Render Services, Inc. and holds **synthetic
data only**. No real patient information may be entered there.
