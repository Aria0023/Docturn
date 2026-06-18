# 09 — Function List

Functional decomposition: **17 areas (F1–F17) → ~96 leaf functions.** Each leaf names the owning
module and its **phase**:

- **Core** — the foundational build (milestones M0–M8 in `14_BUILD_PLAN.md`).
- **Platform** — full-platform features (MFA, live integrations, dev/CMS, resources, mobile, compliance).
- **Config** — the configurability layer (C1–C3).

Modules: `auth`, `rbac`, `storage`, `rotation`, `expiry`, `notifications`, `ws`, `ai-intake`,
`sms`, `push`, `scheduler`, `cms`, `config`, `analytics`, `web`, `mobile`, `audit`, `server`, `infra`.

| Fn | Function | Module | Phase |
|---|---|---|---|
| **F1** | **Authentication & Identity** | | |
| F1.1 | Register account (pending, org-scoped) | auth | Platform |
| F1.2 | Authenticate credentials (scrypt/bcrypt, org-scoped) | auth | Core |
| F1.3 | Enroll TOTP (speakeasy secret + QR) | auth | Platform |
| F1.4 | Verify MFA (TOTP / SMS OTP / backup code) | auth | Platform |
| F1.5 | Generate & consume backup codes (10, single-use) | auth | Platform |
| F1.6 | Manage session (15-min rolling, logout) | auth | Core |
| F1.7 | Sanitize identity (strip password_hash) | auth | Core |
| **F2** | **Authorization & Tenancy** | | |
| F2.1 | Enforce role (requireRole) | rbac | Core |
| F2.2 | Assert tenant (assertSameOrg) | rbac | Core |
| F2.3 | Scope storage (organizationId first-arg) | storage | Core |
| F2.4 | Developer cross-tenant bypass (audited) | rbac | Platform |
| **F3** | **Provider Management** | | |
| F3.1 | Create provider (user + profile) | storage | Core |
| F3.2 | List providers (all / working) | storage | Core |
| F3.3 | Toggle working status | storage | Core |
| F3.4 | Set capacity (patient cap) | storage | Core |
| F3.5 | Delete provider (409 guard) | storage | Core |
| F3.6 | Reorder rotation (drag, director-only) | web | Platform |
| F3.7 | Serve directory (HIPAA-safe, searchable) | storage | Core |
| F3.8 | Maintain on-call schedule | scheduler | Platform |
| **F4** | **Patient Intake** | | |
| F4.1 | Extract structured fields (deterministic) | ai-intake | Core |
| F4.2 | Live AI extraction (OpenAI, PHI-stripped, mock fallback) | ai-intake | Platform |
| F4.3 | Process NL command (gpt-4o-mini) | ai-intake | Platform |
| F4.4 | Persist patient (initials only, org-scoped) | storage | Core |
| **F5** | **Assignment & Routing (core)** | | |
| F5.1 | Select next provider (lowest-census, org-scoped) | rotation | Core |
| F5.2 | Apply cap relief | rotation | Core |
| F5.3 | Advance rotation cursor | rotation | Core |
| F5.4 | Create assignment (round-robin / manual) | storage | Core |
| F5.5 | Accept (census++, patient assigned) | storage | Core |
| F5.6 | Reject (resolve + immediate reroute) | storage | Core |
| F5.7 | Expire & reroute (tick, capped 50) | expiry | Core |
| F5.8 | Reassign / override | storage | Core |
| F5.9 | Cancel (census-- if accepted) | storage | Core |
| F5.10 | Emit unrouted (keep waiting) | expiry | Core |
| **F6** | **Secure Messaging** | | |
| F6.1 | Create conversation (direct/group/emergency) | storage | Core |
| F6.2 | Send message (+ per-recipient delivery rows) | storage | Core |
| F6.3 | Mark read (emit delivery update) | storage | Core |
| F6.4 | Relay typing (typing_start/stop → user_typing) | ws | Core |
| F6.5 | Delete message (soft-delete + audit) | storage | Core |
| F6.6 | Enforce participant access (403) | rbac | Core |
| **F7** | **Realtime & Presence** | | |
| F7.1 | Authenticate socket (cookie→session, close 1008) | ws | Core |
| F7.2 | Broadcast org-scoped (broadcast / sendToUsers) | ws | Core |
| F7.3 | Track presence (20s heartbeat) | ws | Core |
| F7.4 | Emit entity events | ws | Core |
| F7.5 | Reconcile on reconnect (backoff + invalidation) | web | Core |
| **F8** | **Notifications** | | |
| F8.1 | Cascade delivery (WS→push→SMS, graceful) | notifications | Core |
| F8.2 | Send SMS (Twilio + sms_history) | sms | Platform |
| F8.3 | Send push (FCM, device-token registry) | push | Platform |
| F8.4 | Enforce PHI-free payloads | notifications | Core |
| **F9** | **Administration & Configuration** | | |
| F9.1 | Get/patch org config (timeout, shift types) | storage | Core |
| F9.2 | Reset rotation (clear cursor) | storage | Core |
| F9.3 | Approve registration (director gate) | storage | Platform |
| F9.4 | Review incidents (surface open) | web | Platform |
| **F10** | **Developer / Platform Tooling** | | |
| F10.1 | Administer organizations (cross-tenant) | storage | Platform |
| F10.2 | Impersonate (audited session swap) | auth | Platform |
| F10.3 | Run AI diagnostics | ai-intake | Platform |
| **F11** | **Mobile Application** | | |
| F11.1 | Onboard via QR (org lookup, safe fields) | mobile | Platform |
| F11.2 | Register device token (FCM, dedupe, deregister) | mobile | Platform |
| F11.3 | Stream realtime (native WS client) | mobile | Platform |
| F11.4 | Serve compact payloads (initials/room/specialty) | storage | Platform |
| **F12** | **Security & Compliance** | | |
| F12.1 | Audit sensitive actions | audit | Core |
| F12.2 | Log PHI access (every /patients + /assignments) | audit | Platform |
| F12.3 | Record security incidents | audit | Platform |
| F12.4 | Harden HTTP (Helmet, rate limits, generic errors) | server | Core |
| F12.5 | Terminate TLS (reverse-proxy HTTPS) | infra | Platform |
| **F13** | **External Integrations** | | |
| F13.1 | Select implementation (env-gated factory) | services | Core |
| F13.2 | Integrate OpenAI | ai-intake | Platform |
| F13.3 | Integrate Twilio | sms | Platform |
| F13.4 | Integrate Firebase FCM | push | Platform |
| F13.5 | Integrate Amion (shift sync) | scheduler | Platform |
| **F14** | **Resources & Scheduling** | | |
| F14.1 | Manage departments / beds / equipment | storage | Platform |
| F14.2 | Surface resource alerts & metrics | web | Platform |
| **F15** | **Emergency Broadcast** | | |
| F15.1 | Create broadcast (director-only, org-scoped) | storage | Platform |
| F15.2 | Track acknowledgments (per-recipient) | storage | Platform |
| **F16** | **Content Management (CMS)** | | |
| F16.1 | Edit landing page settings (developer-only) | cms | Platform |
| F16.2 | Edit contact page settings | cms | Platform |
| **F17** | **Configuration & Personalization** | | |
| F17.1 | Manage org settings (director policy, validated, audited) | storage | Config |
| F17.2 | Manage user preferences (self-service) | storage | Config |
| F17.3 | Resolve config at runtime (cached, no redeploy) | config | Config |
| F17.4 | Evaluate feature flags (dark-ship + rollback) | config | Config |
| F17.5 | Generate adaptive suggestions (heuristics + evidence) | analytics | Config |
| F17.6 | Apply / dismiss suggestion (human-confirmed, audited) | storage | Config |
