# DocTurn — AWS Deployment Runbook (lean pilot, real PHI)

This is the ordered, click-by-click path from a fresh AWS account to a running,
BAA-covered DocTurn that a few real users can sign into. It is written for the
app **as it exists in this repo** — every environment variable below is one the
server actually reads (`grep process.env server/`), and every gate is one the
code actually enforces.

**What this deploys**

```
  Internet ──HTTPS──▶ EC2 t4g.small ─── Caddy (Let's Encrypt TLS, :443)
                        │                    └─▶ DocTurn (Node 20, 127.0.0.1:3000 — loopback only)
                        │                              │
                        ├── encrypted EBS: /var/lib/docturn/attachments (AES-256-GCM files)
                        │
                        └──:5432 (private, security-group only)──▶ RDS Postgres 16 (encrypted, backups 7d)

  Secrets: AWS SSM Parameter Store (SecureString, KMS)  ·  Access: SSM Session Manager (no SSH)
```

**What it costs:** ≈ $35–45/month steady state; ≈ $5–20/month in year one on the
AWS Free Tier. No load balancer (TLS terminates on the instance), no Twilio
(without credentials SMS is **unavailable** under `NODE_ENV=production`: SMS one-time
codes and `/api/sms/send` answer `503 sms_unavailable`, assignment/STAT SMS escalation
is skipped with a log line — nothing is faked as sent), no SOC 2 spend.

**What is deliberately deferred** (see §15): Postgres row-level security,
S3 attachment storage, CloudWatch alarms, multi-instance scaling.

---

## 0. Before you start — the one rule

**Do not put real patient data anywhere until §12 (go-live checklist) is all
green.** In particular the existing Render demo (`docturn.onrender.com`) has
**no BAA** — it stays synthetic-data only, forever.

You will need: a domain name you control (~$12–15/yr), a credit card for AWS,
and an authenticator app on your phone (for AWS root MFA *and* for your DocTurn
developer account).

---

## 1. AWS account + BAA (≈ 20 min, free)

1. **Create the account** at aws.amazon.com → *Create an AWS Account*. The email
   you use becomes the **root** user.
2. **MFA on root, immediately.** Console → IAM → *Add MFA* for the root user →
   authenticator app. Then **stop using root** for daily work.
3. **Create an IAM admin user** (IAM → Users → *Create user* → attach
   `AdministratorAccess` → enable console access + MFA). Log in as this user
   from now on.
4. **Accept the BAA** — this is the HIPAA gate:
   Console → **AWS Artifact** → *Agreements* → *AWS Business Associate
   Addendum* → review → **Accept**. Free, ~5 minutes. Until this is accepted,
   no PHI may touch the account.
5. **Pick one US region** (e.g. `us-east-1` / `us-east-2` / `us-west-2`) and do
   *everything* below in that region. Every service used here is on the
   [HIPAA-eligible services list].

[HIPAA-eligible services list]: https://aws.amazon.com/compliance/hipaa-eligible-services-reference/

---

## 2. Network — two security groups, no SSH

Use the **default VPC** (fine for a pilot). Create two security groups
(EC2 → Security Groups → *Create*):

| Name | Inbound rules | Purpose |
|---|---|---|
| `docturn-web` | TCP **443** from `0.0.0.0/0` and `::/0`; TCP **80** from `0.0.0.0/0` (Let's Encrypt ACME + redirect) | the app instance |
| `docturn-db`  | TCP **5432** from **source = security group `docturn-web`** (not an IP) | the database |

**Do not open port 22.** You will administer the instance with **SSM Session
Manager** (browser shell, IAM-authenticated, audited) — no key pairs, no open
SSH port.

---

## 3. Encryption keys

For the pilot, use the **AWS-managed keys** (`aws/rds`, `aws/ebs`, `aws/ssm`).
They cost nothing and are automatically selected when you tick "Encrypt". A
customer-managed KMS key (~$1/month) only matters when you need key rotation
policies or cross-account access — add later if a customer asks.

---

## 4. RDS Postgres (≈ $15/month)

RDS → *Create database* → **Standard create** → **PostgreSQL 16**:

| Setting | Value |
|---|---|
| Template | **Free tier** (year one) or **Dev/Test** |
| DB instance identifier | `docturn-db` |
| Master username | `docturn` |
| Master password | generate 32+ chars — you will store it in SSM in §7, **not** in a file |
| Instance class | `db.t4g.micro` |
| Storage | **20 GB gp3**, autoscaling on, max 100 GB |
| Availability | **Single-AZ** (Multi-AZ doubles the cost; add when uptime matters) |
| Connectivity | same VPC as the instance; **Public access: No**; security group **`docturn-db`** |
| Database authentication | password |
| Additional config → Initial database name | `docturn` |
| **Encryption** | **Enabled** (default key `aws/rds`) |
| Backup | **Automated backups on, 7 days retention**, a backup window off-hours |
| Deletion protection | **On** |

When it is *Available*, copy the **Endpoint** (e.g.
`docturn-db.abc123.us-east-1.rds.amazonaws.com`). Your connection string is:

```
postgresql://docturn:<MASTER_PASSWORD>@<ENDPOINT>:5432/docturn?sslmode=require
```

The app applies its own schema on first connect (`server/db.ts` runs the
idempotent `SCHEMA_SQL`), so there is **nothing to migrate by hand**.

---

## 5. EC2 instance (≈ $12/month)

First, an **IAM role** for the instance (IAM → Roles → *Create role* →
*AWS service → EC2*):

- attach **`AmazonSSMManagedInstanceCore`** (this is what gives you the
  browser shell with no SSH), and
- attach an inline policy that can read this app's secrets and nothing else:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Action": ["ssm:GetParametersByPath", "ssm:GetParameter"],
      "Resource": "arn:aws:ssm:*:*:parameter/docturn/prod/*" },
    { "Effect": "Allow",
      "Action": ["kms:Decrypt"],
      "Resource": "*",
      "Condition": { "StringEquals": { "kms:ViaService": "ssm.*.amazonaws.com" } } }
  ]
}
```

Name it `docturn-instance-role`.

Then EC2 → *Launch instance*:

| Setting | Value |
|---|---|
| Name | `docturn-app` |
| AMI | **Ubuntu Server 24.04 LTS, 64-bit (Arm)** |
| Instance type | **`t4g.small`** (2 vCPU, 2 GB) — Free-tier eligible in year one |
| Key pair | **Proceed without a key pair** (SSM only) |
| Network | default VPC, a public subnet, **Auto-assign public IP: Enable**, security group **`docturn-web`** |
| Storage | **20 GB gp3, Encrypted** (default key `aws/ebs`) |
| Advanced → IAM instance profile | **`docturn-instance-role`** |

After launch: EC2 → *Elastic IPs* → *Allocate* → *Associate* with
`docturn-app`. (An Elastic IP is free while attached to a running instance and
keeps your DNS stable across reboots.)

**Verify SSM works:** EC2 → select instance → *Connect* → **Session Manager**
tab → *Connect*. You should get a shell as `ssm-user`. (If the tab is greyed
out, wait ~2 minutes for the SSM agent to register, and re-check the IAM role.)

---

## 6. DNS + TLS

Point your domain at the Elastic IP:

- **Route 53** (≈ $0.50/month): *Hosted zones* → create one for your domain →
  add an **A record** `app.yourdomain.com → <Elastic IP>`. Update your
  registrar's nameservers to the four Route 53 gives you. **Or** just add the
  A record at your existing registrar — either is fine.

TLS is automatic: Caddy (installed in §8) obtains and renews a **Let's Encrypt**
certificate for that hostname on first start, and redirects HTTP → HTTPS. No
certificate to buy or upload. (DNS must resolve to the instance *before* Caddy
starts, or the ACME challenge fails — check with `dig app.yourdomain.com`.)

---

## 7. Secrets → SSM Parameter Store (free)

Generate the secrets on your **own machine** (never paste them into chat or
commit them), then store each as a **SecureString** under the path
`/docturn/prod/`. Run these in a terminal with the AWS CLI configured as your
IAM admin user:

```bash
REGION=us-east-1   # your region

# 1. Session-cookie signing key (any 64 hex chars)
aws ssm put-parameter --region $REGION --type SecureString --name /docturn/prod/SESSION_SECRET \
  --value "$(openssl rand -hex 32)"

# 2. Developer-console password (the cross-tenant operator account `dev`).
#    MUST be 12+ chars or the app refuses to create the account. Pick it yourself.
aws ssm put-parameter --region $REGION --type SecureString --name /docturn/prod/PLATFORM_ADMIN_PASSWORD \
  --value "<choose a long passphrase, 20+ chars>"

# 3. Attachment encryption key (AES-256-GCM, 32 bytes as 64 hex chars).
#    LOSE THIS AND EVERY ATTACHMENT IS UNRECOVERABLE — see §11.
aws ssm put-parameter --region $REGION --type SecureString --name /docturn/prod/ATTACHMENT_KEY \
  --value "$(openssl rand -hex 32)"

# 4. Database connection string from §4
aws ssm put-parameter --region $REGION --type SecureString --name /docturn/prod/DATABASE_URL \
  --value "postgresql://docturn:<MASTER_PASSWORD>@<ENDPOINT>:5432/docturn?sslmode=require"

# 5. Web-push (VAPID) keys so the PWA can receive content-free push notifications.
npx web-push generate-vapid-keys      # prints a public + private key
aws ssm put-parameter --region $REGION --type SecureString --name /docturn/prod/VAPID_PUBLIC_KEY  --value "<public>"
aws ssm put-parameter --region $REGION --type SecureString --name /docturn/prod/VAPID_PRIVATE_KEY --value "<private>"
aws ssm put-parameter --region $REGION --type String       --name /docturn/prod/VAPID_SUBJECT     --value "mailto:you@yourdomain.com"

# 6. Non-secret settings (plain String is fine)
aws ssm put-parameter --region $REGION --type String --name /docturn/prod/APP_NAME       --value "DocTurn"
aws ssm put-parameter --region $REGION --type String --name /docturn/prod/SYNTHETIC_DATA --value "false"
```

`deploy/aws/fetch-env-from-ssm.sh` (run on the instance in §8) turns this whole
path into `/etc/docturn/docturn.env`, readable only by root and the `docturn`
service user. Secrets never sit in git, in the AMI, or in a shell history on the
box.

**What each variable does** (all read by the server — see
`deploy/aws/docturn.env.example` for the complete annotated list):

| Variable | Required | Effect |
|---|---|---|
| `NODE_ENV=production` | yes | marks the session cookie `Secure`; serves the precompiled client bundle (built by `npm run build`); binds `127.0.0.1` unless `HOST` is set |
| `DATABASE_URL` | yes | switches from the in-process PGlite to RDS; the app becomes **persistent**, and sessions are stored in Postgres (table `session`, created automatically) so a restart or deploy does not sign anyone out |
| `SESSION_SECRET` | yes | signs session cookies (without it a random one is generated per boot → everyone logged out on restart) |
| `SYNTHETIC_DATA=false` | yes (real PHI) | **real-PHI mode**: refuses to seed the shared demo org/accounts; stub AI only |
| `PLATFORM_ADMIN_PASSWORD` | yes | provisions/rotates the `dev` operator account (≥ 12 chars); it is the only way that account exists |
| `ATTACHMENT_STORE=fs-encrypted` + `ATTACHMENT_DIR` + `ATTACHMENT_KEY` | yes (real PHI) | attachments (incl. voice messages) stored as AES-256-GCM files, never plaintext, never inline in the DB |
| `HOST` | leave unset | production default `127.0.0.1`: the Node port answers only on loopback, so the only thing that can reach it is Caddy on this host (which also makes forwarded headers trustworthy). Set `HOST=0.0.0.0` only for a platform that connects to the process over the network (e.g. Render) — never here |
| `TRUST_PROXY` | leave unset | default `loopback`: `X-Forwarded-For` / `-Proto` are believed only from a peer on this host (Caddy), one hop — that is what gives correct client IPs (rate limiting, audit rows) and lets the `Secure` cookie be set. Other accepted values: `0`/`false` (trust nothing — sign-in then fails with `insecure_transport` behind Caddy), or a comma list of IPs / CIDRs / `loopback`, `linklocal`, `uniquelocal` for a proxy on another host. A bare hop count ≥ 2 still works but is logged as spoofable |
| `RATE_LIMIT` | leave unset | defaults **on**; never set `off` in production (the compliance monitor flags it) |
| `VAPID_*` | recommended | the web-push key pair. Without them the server generates a pair on first boot and stores it in the database (platform org settings), so push still works; setting them in SSM keeps the private key out of the database and under your control |
| `TWILIO_*` | **leave unset** | no Twilio → SMS is unavailable in production: MFA SMS codes and `/api/sms/send` return `503 sms_unavailable`, SMS escalation is skipped (logged, content-free). Nothing is sent, nothing costs money, and nothing is reported as sent. Clinicians use TOTP / backup codes for MFA. The console stub that records messages exists only outside `NODE_ENV=production` and never logs numbers or bodies |
| `OPENAI_API_KEY`, `AI_EXTERNAL_PHI_OK`, `USE_STUB_AI` | **leave unset** | AI intake stays on the deterministic local extractor; no PHI leaves the box |
| `PORT` | leave unset | 3000 (Caddy proxies to `127.0.0.1:3000`) |
| `AMION_*` / Epic vars | optional | only if you have those integrations; modules default appropriately |

---

## 8. Install the app on the instance (≈ 15 min)

Open **Session Manager** (§5) and become root: `sudo -i`.

**8a. Give the instance read access to the repo.** The repo is private, so
create a **read-only deploy key**:

```bash
ssh-keygen -t ed25519 -N "" -f /root/.ssh/docturn_deploy -C "docturn-app deploy key"
cat /root/.ssh/docturn_deploy.pub
```

Paste that public key into GitHub → the `Docturn` repo → *Settings* →
*Deploy keys* → *Add deploy key* (**read-only**, do not tick "allow write").
Then tell git to use it:

```bash
cat >> /root/.ssh/config <<'EOF'
Host github.com
  IdentityFile /root/.ssh/docturn_deploy
  IdentitiesOnly yes
EOF
ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null
```

**8b. Run the bootstrap.** It installs Node 20 + Caddy, creates the `docturn`
service user and the encrypted attachment directory, clones and builds the app,
installs the systemd unit and the Caddy config, and starts both:

```bash
curl -fsSLo /root/bootstrap.sh \
  https://raw.githubusercontent.com/Aria0023/Docturn/claude/sleepy-davinci-kmin7n/deploy/aws/bootstrap.sh
# (if the raw URL 403s because the repo is private, clone first and run
#  deploy/aws/bootstrap.sh from the checkout — the script is idempotent)

bash /root/bootstrap.sh app.yourdomain.com git@github.com:Aria0023/Docturn.git claude/sleepy-davinci-kmin7n
```

**8c. Render the environment from SSM** (this is what makes the secrets from
§7 available to the service):

```bash
REGION=us-east-1 bash /opt/docturn/deploy/aws/fetch-env-from-ssm.sh
systemctl restart docturn
```

The script writes `/etc/docturn/docturn.env` with mode `0640 root:docturn` and
adds the fixed values (`NODE_ENV`, `ATTACHMENT_STORE`, `ATTACHMENT_DIR`). Re-run
it any time you change a parameter, then `systemctl restart docturn`.

---

## 9. First-boot verification

```bash
systemctl status docturn caddy --no-pager
journalctl -u docturn -n 50 --no-pager
curl -s https://app.yourdomain.com/api/health
```

You want to see:

- `docturn` **active (running)**, and in its log:
  `DocTurn API + WebSocket listening on 127.0.0.1:3000 — db: PostgreSQL (DATABASE_URL)`
  (not "PGlite"), followed by
  `↳ sessions: Postgres \`session\` table (survive restarts, shared across instances)`,
  `↳ proxy trust: X-Forwarded-* honoured only from a loopback peer (reverse proxy on this host), one hop (default)`,
  `↳ bound to loopback: reachable only through the reverse proxy on this host …`
  and `[webapp] serving precompiled bundle <version>` (if it says it is falling
  back to the dev kit, the build is missing or stale — re-run the update).
- Health **through the domain** →
  `{"ok":true,"db":"up","persistent":true,"storage":"postgres","durable":true,"secure":true}`.
  **`persistent:true` is the proof you are on RDS**, not an in-process
  database; **`secure:true` is the proof Caddy's `X-Forwarded-Proto` is
  trusted** — if it says `false`, sign-in will be refused with
  `insecure_transport` (check `TRUST_PROXY`). (A `curl` straight to
  `http://127.0.0.1:3000/api/health` on the box rightly says `secure:false`.)
- `https://app.yourdomain.com` loads with a valid padlock (Caddy fetched the
  certificate). If it does not, `journalctl -u caddy -n 50` — almost always DNS
  not yet pointing at the Elastic IP.

---

## 10. First real accounts (real-PHI mode)

With `SYNTHETIC_DATA=false` there are **no demo logins** — no `chen`, no
`er.doc`, no password `docturn`. The only account is the operator you created
in §7:

1. Sign in as **`dev`**, org code **`DOCTURN`**, password = your
   `PLATFORM_ADMIN_PASSWORD`.
2. **Enrol MFA on `dev` right now** (it reads every tenant): Settings → Security
   → enrol with your authenticator app, save the backup codes offline.
3. **Create your organization**: Developer console → Organizations → *New*
   (`POST /api/dev/organizations`).
4. **Create the first director** in that org (Developer console → People →
   *Add*, i.e. `POST /api/dev/users`). The server mints a **one-time password**
   and shows it to you **once** in a modal — hand it over in person or by
   phone, never by chat/email. At their first sign-in the app holds them on a
   **Set your password** screen until they choose their own (the demo password
   and anything under 8 characters are refused everywhere). From then on the
   director provisions clinicians the same way (Directory → People → *Add*),
   or people **self-register** from the sign-in screen (`POST /api/register`)
   and the director **approves** them (`/api/registrations/:id/approve`) —
   nobody gets in without an approval.
   **Account lifecycle** (Directory → People, or Developer console → People):
   *Reset password* issues a fresh one-time password; *Remove access*
   deactivates the account — sign-in refused **and** open sessions end on
   their next request (HIPAA workforce termination); *Restore access* reverses
   it; *Reset two-factor* clears a locked-out clinician's authenticator. Every
   one of these is audited at high risk.
5. In Developer console → **Modules**, turn **`security.mfaRequired` ON** for
   the org, so directors/ER directors must enrol MFA before they get privileged
   access. Leave `messaging.voice`, `messaging.attachments` etc. as you like —
   each is a per-org switch enforced server-side.
6. Open Developer console → **Compliance** — every automated control should be
   green on this deployment (session secret, rate limit, HTTPS/cookie flags,
   persistent DB, root account, encryption at rest for attachments). Anything
   red is a real gap, not a warning to dismiss.

---

## 11. Attachments & voice messages — what "encrypted" means here

`ATTACHMENT_STORE=fs-encrypted` writes each upload as a file under
`/var/lib/docturn/attachments/` containing **AES-256-GCM ciphertext**; the
database row stores only an opaque ref (`fsenc:<id>`). Plaintext is never
written to disk. The instance's EBS volume is *also* encrypted (§5), so the
files are encrypted at rest twice — once by the app with a key AWS never sees,
once by EBS.

**Consequences you must plan for:**

- **The key is in SSM, not on the disk.** A disk snapshot alone is useless;
  the key alone is useless. That is the point. Keep the SSM parameter and never
  delete it; consider printing it to paper and storing it with your other
  recovery material.
- **Rotating the key is not supported in place** — existing files would become
  unreadable. If you ever must rotate, that is a re-encryption job, not an env
  change.
- Uploads are capped at 8 MB (5 MB / 3 minutes for voice clips) by the server;
  the `fs-encrypted` store has no size ceiling of its own beyond the disk.
  20 GB is plenty for a pilot; watch `df -h /var/lib/docturn`.
- The retention purge (module `ops.retention`) deletes the encrypted file when
  it purges a message, so storage does not grow forever.

---

## 12. Backups & recovery (do this before real users, test it once)

| What | How | Where it is set |
|---|---|---|
| Database | RDS automated backups, 7-day point-in-time | §4 (already on) |
| Attachment files | **AWS Backup** → *Create backup plan* → daily, retain 35 days → assign the `docturn-app` EBS volume | AWS Backup console |
| Secrets | SSM parameters are durable; additionally keep an **offline copy of `ATTACHMENT_KEY` and the RDS master password** | your own safe |
| Code | git | — |

**Test a restore once** (30 minutes, worth it): restore the RDS snapshot to a
temporary instance, point a second `docturn.env` at it, confirm `/api/health`
says `persistent:true` and messages load, then delete the temporary instance.
A backup you have never restored is a hope, not a backup.

---

## 13. Monitoring (minimum viable, PHI-free)

- **Uptime:** Route 53 → *Health checks* → HTTPS check on
  `/api/health` (≈ $0.50/month), alarm → SNS → your email. Or any free external
  pinger. This is your "is it down" signal.
- **Logs:** `journalctl -u docturn` on the box. The app logs are designed to be
  PHI-free (ids, actions, no clinical content). **If you later ship logs to
  any vendor (Better Stack, Datadog, Sentry…), that vendor must sign a BAA or
  the logs must be provably PHI-free** — the app's audit trail is in the
  database, not in these logs, so shipping them is optional.
- **Disk:** a cron `df` alert, or CloudWatch agent (optional).
- **CloudWatch alarms** on CPU/RDS storage: deferred (§14) — add when you have
  more than a handful of users.

---

## 14. Go-live checklist — every box, no exceptions

```
[ ] AWS BAA accepted in AWS Artifact                                   (§1)
[ ] Root user has MFA; daily work uses an IAM user, not root            (§1)
[ ] RDS: encrypted, NOT publicly accessible, backups 7d, deletion protection (§4)
[ ] EC2: encrypted EBS, no port 22, SSM Session Manager works           (§5)
[ ] HTTPS live with a valid certificate; HTTP redirects                  (§6/§9)
[ ] /api/health returns persistent:true (RDS, not PGlite) and,
    through the domain, secure:true                                     (§9)
[ ] NODE_ENV=production, SYNTHETIC_DATA=false                            (§7)
[ ] PLATFORM_ADMIN_PASSWORD ≥ 12 chars; `dev` account has MFA enrolled   (§7/§10)
[ ] ATTACHMENT_STORE=fs-encrypted with key in SSM + offline copy         (§7/§11)
[ ] RATE_LIMIT not "off"; TRUST_PROXY unset (loopback); HOST unset       (§7)
[ ] TWILIO_* unset (no SMS spend); OPENAI/AI_EXTERNAL_PHI_OK unset       (§7)
[ ] security.mfaRequired ON for the org                                  (§10)
[ ] Developer → Compliance monitor: all automated controls green          (§10)
[ ] Backup plan exists for the EBS volume; one restore test done          (§12)
[ ] Uptime check + email alert configured                                 (§13)
[ ] The Render demo instance never receives real PHI (synthetic only)     (§0)
```

---

## 15. Known gaps to close before or shortly after go-live (honest list)

These are real, findable-in-the-code limitations — not polish:

1. **No Postgres row-level security yet.** Tenant isolation is enforced in the
   application (`organizationId` on every query, `assertSameOrg` → 404). RLS
   would add a database-level second wall. Planned; not required for a pilot.
2. **One instance only.** Sessions are in Postgres (with `DATABASE_URL` the
   store is `connect-pg-simple`, table `session`), so restarts no longer sign
   anyone out — but rate-limit counters, WebSocket fan-out and the background
   loops (expiry, STAT escalation, retention, Amion sync) live in the process.
   A second instance would split the limits, miss realtime events from the
   other instance and run every loop twice. Scaling out needs a shared
   limiter store, a pub/sub for `/ws`, and a single loop runner.
3. **Attachments are on the instance disk, not S3.** Real and encrypted, but
   tied to one instance and its snapshots. `attachment-store.ts` documents the
   S3 implementation as the next step; the routes need no change. No antivirus
   scanning of uploads yet.
4. **No CloudWatch alarms**; monitoring is the §13 minimum.
5. **Epic write-back** (assigning admits into Epic) is designed but not built;
   the Epic connector is read-only today.
6. **Realtime needs the socket.** While a device's WebSocket is down (no
   network, or iOS has suspended the backgrounded app) nothing new appears on
   it; push is the only wake-up. When the socket comes back the client runs one
   catch-up (`GET /api/messaging/sync` — new messages, receipts and recalls
   since its cursor, no thread re-read — plus dashboard data and broadcasts),
   so nothing is lost — but there is no delivery-latency measurement on
   physical phones yet (docs/MOBILE.md).
7. **Compression on this path.** Node serves the precompiled client
   brotli/gzip-compressed (~270 KB for the shell) and deliberately does not
   compress API responses; Caddy's `encode zstd gzip` (deploy/aws/Caddyfile)
   passes the already-compressed static files through and compresses the JSON
   API responses itself. Remove `encode` from the Caddyfile if your security
   review rules out compressing authenticated responses (BREACH-style length
   attacks; the session cookie is `SameSite=Lax`, which blocks the usual
   cross-site request vector).

---

## 16. Updating the app (routine)

One command, from Session Manager as root. It pulls the branch (root holds the
deploy key), rebuilds as the unprivileged `docturn` user (`npm run build`:
server, and the precompiled web client), restarts the service only if the
build succeeded, and verifies `http://127.0.0.1:3000/api/health` answers
`"ok":true` with `"persistent":true` and `"storage":"postgres"`:

```bash
sudo bash /opt/docturn/deploy/aws/update.sh            # current branch
sudo bash /opt/docturn/deploy/aws/update.sh main       # or a specific branch
```

Sessions are stored in Postgres, so a restart does **not** sign anyone out.
For the few seconds the service restarts, requests fail and open WebSockets
drop; clients reconnect with backoff and run their catch-up (§15.6). Installed
phones pick up the new client on their next launch (the service worker
precaches the new version before switching). If the build fails the old
version keeps running untouched.

Schema changes are applied automatically on start (`SCHEMA_SQL` is idempotent
and additive). If a release ever needs a destructive migration, this runbook
will say so explicitly.

---

## 17. Cost recap

| Item | Monthly | Notes |
|---|---|---|
| EC2 `t4g.small` | ~$12 | free-tier eligible year one |
| RDS `db.t4g.micro` + 20 GB | ~$15 | free-tier eligible year one |
| EBS 20 GB + snapshots | ~$2–3 | |
| Elastic IP | $0 | while attached |
| Route 53 zone + health check | ~$1 | optional |
| SSM Parameter Store, KMS (AWS-managed), AWS Artifact BAA, Let's Encrypt | **$0** | |
| Data transfer | ~$1–3 | pilot volume |
| **Total** | **≈ $35–45** | **≈ $5–20 in year one on Free Tier** |
| Domain | ~$12–15 / **year** | |

Not in this bill, by decision: SOC 2 (deferred), Twilio (TOTP MFA instead),
a load balancer (add with a second instance), Multi-AZ RDS (add when uptime
matters more than $15/month).
