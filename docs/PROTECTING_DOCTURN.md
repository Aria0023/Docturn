# Protecting DocTurn from being copied

No web app can be made impossible to copy: whoever can open a screen can
describe it. What can be controlled is who gets in, what code they can read,
and what they agreed to. This is what is in place and what is still yours to do.

## 1. The demo is by invitation

On a demo instance with `DEMO_ACCESS_KEY` set (24 characters or more), nothing
of the app is served to a browser without an invitation: not a screen, not an
API answer, not a line of code. The public website (`/home`), pricing and the
purchase form stay open. Everything else redirects to the website with a note
that the demo is by invitation.

- **Your own way in:** `https://<your host>/demo-access/<DEMO_ACCESS_KEY>`. It
  lasts 30 days on that browser; open it again to renew.
- **Inviting someone:** sign in as the operator → Demo access → say who it is
  for and how long it lasts (1 to 30 days, 7 by default) → copy the link. It is
  shown once; DocTurn keeps only a hash.
- **Seeing who looked:** the same screen lists each invitation with when it was
  first opened, when it was last seen and how many times the link was opened.
- **Revoking:** one click; the link and anyone already using it stop within 20
  seconds.
- **Scraping:** one invitation making more than 1,500 requests in five minutes
  is slowed down and noted in the server log. Guessing links is limited to 10
  tries a minute per address.

Give each person their own link. A shared link cannot tell you who looked.

### On a host without a permanent database

The current Render demo has no database attached, so it starts empty at every
restart, and a free Render service restarts after it has been idle. A link's
end date is signed into the link itself, so links keep working through a
restart. What a restart loses is the record around them: who each link was
for, when it was used, and any revocation. A link used after a restart is
listed again as "made before the last restart", and you can revoke it again.

Until a database is attached, treat revocation as temporary: to end every
link for certain, change `DEMO_ACCESS_KEY`. Attaching the Postgres database
that `render.yaml` describes makes invitations, revocations and everything
else in the demo permanent.

The gate is off when the key is not set, and it never applies to an instance
holding real patient data: there people have their own accounts.

To turn it off, remove `DEMO_ACCESS_KEY`. To change the key (it also signs the
cookies), set a new one: every existing invitation cookie stops working and
people open their links again.

## 2. The code that reaches a browser

- The built app serves only its compiled bundle. The readable source files
  (`*.jsx`, `store.js`, `api-bridge.js`) answer "not found".
- The bundle is minified: no file names, no comments, local names shortened.
  The page and its stylesheet carry no notes.
- No source maps are produced.
- `robots.txt` lets search engines index the website and nothing else.

This slows a reader down. It does not stop a determined one, and it does not
hide what the screens do.

## 3. What never leaves the server

Routing rules, escalation, billing, the EHR connections and every permission
check run on the server and are not sent to browsers. They are protected by
keeping the repository private.

## 4. Yours to do

- **Make the GitHub repository private** and review who has access. The
  repository includes product documents (competitive analysis, blueprints).
- **Terms for demo viewers.** Have invitees accept terms that forbid copying
  and reverse engineering, and use an NDA for detailed walkthroughs. This is
  the protection that addresses someone imitating what they saw.
- **Trademark** the DocTurn name and mark.
- **Ask your attorney** whether the admission-routing method is worth a
  provisional patent before it is shown widely.
- **Rotate the Amion login** that is still in the git history.

Copyright covers the code automatically. Your durable advantages are
execution, hospital relationships, integrations and the compliance record.
