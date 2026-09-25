# DocTurn — hospital trial runbook

A practical guide to running a real (not demo) pilot: durable Postgres database,
real staff accounts via self-registration + director approval, and in-app
password changes.

> ## ⚠️ Read first — real patients vs. test patients
>
> **Pilot with SYNTHETIC (fake) patients until the security items below are done.**
> The app's clinical workflow is ready to trial, but it is **not yet cleared for
> real patient data (PHI)**. Running real PHI now would risk a HIPAA breach.
>
> Safe to do today (fake data only): register staff, route admissions, message,
> consults, dashboards — using made-up patient names/initials.
>
> Required **before any real PHI** (see `SECURITY.md` plan):
> 1. A HIPAA-eligible AWS setup with TLS (https) and encryption at rest.
> 2. Signed **BAAs** (see glossary below) with AWS and any AI/LLM vendor.
> 3. MFA enforced; no shared/default passwords; rate limiting ON.
> 4. The external AI feature stays OFF (it's off by default now).
>
> **Glossary in plain English**
> - **PHI** = Protected Health Information = anything that identifies a patient
>   (name, room tied to a person, diagnosis, etc.).
> - **BAA** (Business Associate Agreement) = a signed contract where a vendor
>   (AWS, an AI provider, a tunnel provider) legally agrees to protect PHI on
>   your behalf. **No BAA = you may not send them real PHI.** AWS and Azure offer
>   one; the public OpenAI API and Cloudflare "quick tunnels" do not.
> - **TLS / "https"** = the lock-icon encryption that protects data while it
>   travels over the network. Plain `http://` is not acceptable for PHI.
> - **Encryption at rest** = the database/disk is stored scrambled, so a stolen
>   drive or backup is useless without the key.
>
> **Synthetic-data mode (on by default).** Every screen — including login — shows
> a yellow **"SYNTHETIC DATA — testing only"** banner. It stays on unless someone
> deliberately starts the server with `SYNTHETIC_DATA=false` (only do that for a
> fully compliant real-PHI deployment). Leave it on for the pilot; it's your
> visible proof to clinicians that no real patient data should be entered.

## 1. Database — real Postgres (durable, never auto-wiped)

The app uses an in-process PGlite database by default (the `./.pglite` folder).
That's fine for demos, **but a hard kill or power loss can corrupt it and trigger
an auto-wipe — do not use it for real patient data.** For the trial, point the app
at a real Postgres so data is durable and backed up.

1. Provision a Postgres database (local install, or a hosted one). You need a
   connection string, e.g. `postgres://USER:PASSWORD@HOST:5432/docturn`.
2. Set it in the environment (PowerShell):
   ```powershell
   $env:DATABASE_URL="postgres://USER:PASSWORD@HOST:5432/docturn"
   ```
3. Create the schema (all tables/columns) in that database:
   ```powershell
   npm run db:push
   ```
4. Seed the starting organization + accounts:
   ```powershell
   npm run seed
   ```
   This creates org **ISPN** ("Cedars-Sinai (ISP North)") plus demo accounts
   (director / er.director / etc., password `docturn`) and the developer account.

When `DATABASE_URL` is set the server uses that Postgres and **never auto-wipes**
it. Take regular `pg_dump` backups during the trial.

> Quick pilot without Postgres? You can run on `./.pglite` instead — skip
> `DATABASE_URL`/`db:push` and just `npm run seed`. Then: always stop with
> **Ctrl+C** (never a hard kill), and copy the `.pglite` folder for backups.

## 2. Start the server

```powershell
npx tsx server/index.ts
```

> **Do NOT set `RATE_LIMIT=off` for a real trial** — that disables brute-force
> protection on login. Leave rate limiting ON. (Earlier notes suggested turning
> it off behind a tunnel; that was wrong for anything but local throwaway tests.)

For off-site **testing with fake data only**, a quick tunnel is fine:

```powershell
cloudflared tunnel --url http://localhost:3000
```

For real PHI you need a proper https front door (AWS ALB/CloudFront with a
managed certificate), not a quick tunnel — see `SECURITY.md`.

## 3. Clear the demo data in ISPN (optional but recommended)

The seed adds demo patients and a sample roster. To start clean for real use:

- Log in as **director** (`director` / `docturn`, org `ISPN`).
- Patient board → **Clear all** (or **Clear 24h+**) to remove demo patients.
  (Old patients also auto-clean on the per-org retention window in
  Enterprise/Org config.)
- The provider roster can be edited under Dashboard → Rotation & roster.

## 4. Create real accounts (self-registration → approval)

1. Staff open the app and click **Register** on the login screen. They enter:
   org code **ISPN**, a username, their **own password**, display name, and the
   role they want (Hospitalist / ER physician).
2. A **director** or **ER director** logs in → **Approvals** → approves them.
   - Approving a hospitalist automatically gives them a rotation profile.
3. The staff member now logs in with **their own credentials** (org `ISPN` +
   username + the password they chose).

## 5. Secure the accounts — change passwords

The seeded admin accounts share the known password `docturn`. On first login,
**every user (including the director) should change their password**:

- Bottom-left of the sidebar → the **key** icon → enter current + new password
  (min 8 characters).

Do this for the director/ER-director accounts immediately so the approver
accounts aren't using the public demo password.

## 6. Roles, by quick reference

- **ER physician** — admits patients, routes to hospitalists, can add consults.
- **Hospitalist** — accepts admissions, carries a census, requests consults.
- **Hospitalist director** — runs rotation/roster, approves registrations, can
  also take patients; manage consult services, roles, compliance, appearance.
- **ER director** — ER operations, approvals, board.
- **Developer** — cross-tenant platform admin (organizations, enterprise
  defaults incl. mobile/platform controls, cross-org compliance, users-by-org
  support directory). Use **Manage** on an org to work inside that tenant.

## 7. Daily operations

- **Backups:** `pg_dump` the Postgres DB (or copy `.pglite/`) regularly.
- **Shutdown:** stop the server with **Ctrl+C** (clean), not a force-kill.
- **Restart:** just start the server again — Postgres/`.pglite` data persists.
  (Do **not** delete `.pglite` once the trial has real data.)
