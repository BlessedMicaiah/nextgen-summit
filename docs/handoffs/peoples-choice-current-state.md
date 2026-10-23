# People's Choice Award — current state

**Checked 2026-10-23, in the minutes around midnight Eastern as the voting day turned from
the 22nd to the 23rd. Voting closes 2026-10-28, 11:59 PM Eastern — five voting days left,
counting today. The event is 2026-10-30.**

Everything in this document was checked against the repository, the deployed staging site and
the staging database at that moment. Where something is reported rather than verified, it
says so. The database figures in section G were read while the Eastern day was still the 22nd,
so they describe that day; the allowance has since reset. `docs/handoffs/peoples-choice-twilio-handoff.md` is the earlier handoff: still the
best reference for Twilio internals, but it predates email verification, the Eventbrite bonus
and the gallery fix, so **where the two disagree, this one is current.**

---

## 0. The one thing blocking launch

**The +2 Eventbrite bonus has never completed, end to end, for anybody.** `pc_attendee` holds
zero bindings. Every part of it is built and deployed; no real voter has yet travelled the
whole path. Until one has, the bonus is unproven, not working.

The immediate cause is small and identifiable: `eventbrite-emails.json`, the hashed-email →
attendee-id index, **does not exist in the staging data directory.** It is built on demand by
`pc_eb_email_index()`, which is only reached from the bonus check, which needs a verified
voting session. Nobody with a verified session has reached it since the code deployed.

Nothing suggests it is broken. Eventbrite is reachable from staging and the token is valid —
`api/attendee-count.php` returned 185 attendees when checked, and the count cache was rewritten
hours earlier. The index should build on the first real bonus check, in roughly two API pages.
**That first check is the test.** It needs a verified voter, so it needs the user.

---

## A. Where everything is

### Repository

`nextgen-summit`, GitHub `oasislifesprings-cloud/nextgen-summit`. Static HTML and PHP 8 on
Hostinger shared hosting, SQLite over PDO. No build step, no framework, no package manager for
the site itself.

```
public/                        the web root; release.py archives THIS and nothing else
  index.html, about/, experience/, pitch/, scholarship/, tickets/ ...
  pitch/peoples-choice/        the voting page (index.html + the 15-step vote dialog)
  pitch/peoples-choice/admin/  the dashboard, password gated
  pitch/finalists/             Top 10 page, behind an admin-PIN preview gate
  api/                         every endpoint; private ones denied by api/.htaccess
  assets/css, assets/js        site.css, peoples-choice.js, announce.js ...
docs/                          this file, the Twilio handoff, the rules note
tools/                         release.py, deploy.mjs, test-labelvote.js, make-config.mjs
release/                       built archives, not committed
```

### The data directory — outside the web root

Production `nextgen-data/`, staging `nextgen-data-staging/`, both siblings of `public_html`.
`release.py` points staging at its own directory, so staging can never touch production data.
It holds the SQLite database, the Eventbrite caches, and the configuration files below.

**A deploy replaces the web root. It does not touch the data directory.** That separation is
why credentials and votes survive every deploy, and it must stay that way.

### Configuration — locations only, never values

| File (in the data directory) | What it holds |
|---|---|
| `config.admin.php` | the dashboard PIN hash and its revocation epoch |
| `config.twilio.php` | Twilio API key/secret, Verify SID, allowlist, live SMS ceiling |
| `config.smtp.php` | the Gmail SMTP sender and its app password |
| `public/api/config.php` | site secret and the Eventbrite token (private, never committed) |

These are **read as text, never `require()`d** by tooling. An earlier bug came from exactly
that: `require_once` plus `const` inside a function meant the constants never landed, the PIN
override was silently ignored, and five rejected attempts caused a lockout.

Nothing in this document, and nothing in any commit, contains a credential value.

---

## B. Branches, commits, deployment

| | branch | commit | state |
|---|---|---|---|
| Production | `origin/main` | `01f0112` | **People's Choice is NOT deployed here** |
| Staging | `monday-launch` | `6b99c7a` | current, deployed, verified byte-identical |

`https://nextgensummit.us/pitch/peoples-choice/` returns **404**, as does `api/pc-vote.php`.
The production launch is a **first deploy of the whole subsystem**, not an update. Plan for it
as such: the data directory, the config files and the database do not exist there yet.

**Local `main` is two commits behind `origin/main`** (local `74fb0c2`). Pull before any
production work, or you will deploy an older site.

### Deploying to staging

```bash
python -I tools/release.py staging
node tools/deploy.mjs staging.nextgensummit.us release/staging-<sha>.zip
```

`release.py` refuses unless the branch is checked out, the tree is clean, and the commit is
identical to GitHub. That guard exists deliberately: **never deploy anything that is not pushed
first.** `deploy.mjs` needs `HOSTINGER_API_TOKEN`; the upload requires both `X-Auth` and
`X-Auth-Rest` headers or the edge returns 403.

### The asset cache stamp

Every CSS and JS reference carries `?v=YYYYMMDD-NN` — currently **`20261022-26`**, across 86
references. **Bump it in the same commit as any CSS or JS change**, or browsers serve the old
file against the new markup. This has caused a visible bug before (a restyled page rendered
unstyled because the stamp was not bumped).

```bash
grep -rl "v=20261022-26" --include=*.html --include=*.php --include=*.css --include=*.js public \
  | while read f; do sed -i 's/v=20261022-26/v=20261022-27/g' "$f"; done
```

---

## C. Voting rules, and where they are enforced

The rules, unchanged:

- A verified voter gets **+1 per day**.
- A verified NextGen attendee gets **+2 additional per day**, maximum **3 per day**.
- **The bonus must go to the founder that day's regular vote went to.** It cannot be moved or
  split.
- The day resets at **midnight `America/New_York`**.
- Voting closes **2026-10-28, 11:59 PM Eastern**. Verified: the stored deadline resolves to
  `2026-10-29T00:00:00-04:00`, which is that instant, and the page label agrees.
- **Explicit confirmation is always required.** Nothing is ever cast by arriving, looking or
  verifying.

### The invariants — all server-side, none negotiable

1. **A vote slot is claimed by INSERT inside a transaction against a UNIQUE index.** Never
   check-then-insert. A double submission loses the race rather than being counted twice. The
   two bonus points are two ordinary rows taking the same path.
2. **The entrant for the bonus is read from the database, never from the request.**
   `pcb_today_entrant()` queries the day's first valid row.
3. **Identity comes from the server session, never from the request body.**
4. **The attendee entitlement is read from the `pc_attendee` binding table.** The browser flag
   that used to grant it was removed — a client-controlled value must never decide how many
   points someone gets.
5. **Verification is required to vote** (`phone_required`, default `'1'`). There is no
   `phone_required` row in `pc_meta`, so the default applies: closed. The old simulated path
   identified a voter by an HMAC of a browser-supplied string — change the string, become a new
   voter — so leaving it open was a real bypass.
6. **`pc_canonical()` is resolved on every read**, not frozen at verification, so a session
   predating an identity merge cannot vote again.
7. **The public endpoint reports no totals, ranks or leaders** while voting is open. Those
   belong to the dashboard alone.

---

## D. What is built, and what is proven

### Deployed and verified working

- **The gallery and profiles** — 20 cards, deep links, share sheet, video facade, four voting
  states.
- **Email OTP verification** — the live route. Gmail SMTP via `stream_socket_client` with
  STARTTLS. Authentication returns 235. A genuine email-verified vote is recorded.
- **The +1 vote** — recorded, server-limited, audited.
- **Cross-channel identity linking** — `pc_identity_link()` moves votes to the surviving key.
- **Server-driven dialog routing** — `routeFor()` decides which of the 15 steps a returning
  voter sees, from the server's account of them. 9/9 cases pass.
- **The gallery card fix** (`b7db166`, `aa39402`, `6b99c7a`) — described in section E.
- **Endpoint exposure** — verified live: `pc-lib`, `pc-twilio`, `pc-attendee`, `pc-mailer`,
  `pc-identity`, `pc-email-otp`, `pc-admin-pin`, `finalists`, `config` all return **403**.
  `pc-bonus.php` returns **401** without a verified session. The admin dashboard is password
  gated.
- **Staging is noindex** three ways: `X-Robots-Tag: noindex, nofollow, noarchive`, a `robots`
  meta tag, and `robots.txt` `Disallow: /`. No visitor passcode, no test banner — deliberately,
  so staging behaves like the real thing.

### Built but NOT proven

- **The +2 Eventbrite bonus, end to end.** Zero bindings. See section 0.
- **The automatic registration match.** `pc-bonus.php?action=auto` matches the address the
  voter already proved against the attendee list, with no second code. Never exercised against
  a real registration.
- **The `eventbrite-emails.json` index build.** Never run.
- **Deliverability across providers.** Gmail, Outlook and Yahoo/iCloud are untested.
- **A returning authenticated voter reopening the bonus.** The reason this handoff exists.

### Hidden, not deleted

**Phone/SMS verification.** The Twilio Verify integration is intact and the button carries
`hidden` while A2P carrier approval is pending. Do not delete it.

---

## E. The gallery card fix — what it was, so it is not reintroduced

**Reported:** after casting the daily +1, every one of the 20 cards read "YOU HAVE ALREADY
VOTED" and was disabled — including the founder the vote had just gone to. For an attendee that
was the only route to two more points, and it was shut.

**Cause:** `repaintAfterVote()` disabled every `[data-pc-vote]` button from a `sessionStorage`
ballot key rather than from server state. The dialog had already been taught to route on the
server; the gallery standing in front of it had not.

**Fix:** the `sessionStorage` key and its writer were deleted outright. A note the page writes
to itself said *less* than the truth (a new tab and the page believed nobody had voted) and was
read as though it said *more* ("a ballot exists" → "nothing further to do"). Enforcement was
always the unique index on the server.

Labels now come from `pc-otp.php`'s answer, via `labelVoteButton()`:

| Situation | Card label |
|---|---|
| the founder you backed, bonus still available | **View my vote & +2 bonus** (solid) |
| the founder you backed, nothing left | **View my N points** (`N` from `used`) |
| every other founder | **Today's vote is used** (outlined, still clickable) |
| nobody backed yet | **Vote** |
| voting not open | that state's own copy, disabled |

Other founders' cards stay live on purpose. A disabled button says no and nothing else; this
one opens the screen explaining where today's points went, which carries a **Go to my vote &
+2 bonus** button — shown only when something is actually there to claim. Opening any of it
records nothing. The profile dialog shares the labeller, so a card and the profile it opens
cannot disagree.

**Tested:** `node tools/test-labelvote.js public/assets/js/peoples-choice.js` — 13 cases, all
passing. It lifts the functions out of the shipped file rather than copying them, so it cannot
drift from what deploys. Also verified in a browser against the deployed file, desktop and
375px mobile, with no console errors.

**Not tested:** the same thing from a real authenticated returning session.

---

## F. Eventbrite integration

Event `1999190304016`. Attendees are counted with `status=attending`, skipping cancelled and
refunded records — `pc-attendee.php` uses the same eligibility test as `attendee-count.php`
rather than a second opinion.

**The intended path**, which is what is built:

1. The voter verifies their email to cast +1. The site keeps secure proof of that address.
2. They cast the vote.
3. The server checks the address they already proved against the attendee index.
4. A match binds the entitlement — **no second code**, because that inbox is already proven.
5. A registration under a *different* address requires a code to that address, because
   ownership of it has not been proven. That distinction is the whole security argument.
6. The voter presses **GIVE MY +2 POINTS**. Confirming a registration is not the same as
   asking for points.
7. Two rows are written, to the founder backed that day.

**Rules that must hold:**

- `pc_attendee` has a UNIQUE index on the attendee key: **one registration cannot fund two
  voters' bonuses.**
- Eventbrite being unavailable must **never** be reported as "not registered". A registered
  attendee told they are not registered will not come back. The code distinguishes
  `unavailable` from `not_registered`, and the copy must keep doing so.
- Someone not registered sees an encouraging ticket invitation and a way to recheck — not an
  error. Explicit instruction: no wording like "No matching Eventbrite record found."
- The lookup is **not public**. "Is this address registered?" is a question about someone
  else's life, and answering it for anyone who asks is a way to test an address list against an
  attendee roster. It needs a verified session.

Index TTL 900s; code TTL 900s; 5 tries per code; 5 lookups per voter per day.

---

## G. Staging data, as checked on 2026-10-22

| | |
|---|---|
| Valid votes | **2** — `entrant-01` ×1 (email channel), `entrant-07` ×1 (phone channel) |
| Simulated among them | 0 |
| Rows total / invalidated | 6 / 4 (invalidated, **not deleted**) |
| Distinct voters | 2 |
| Vote days present | `2026-10-22`, `all` — the 22nd has since closed; the allowance reset at midnight Eastern |
| `pc_attendee` bindings | **0** |
| `pc_identity` rows | 0 |
| `pc_flag` rows | 1 (`email_verified`) |
| `pc_meta` | `state=open`, `mode=daily`, `deadline=2026-10-29 00:00:00` |

Live SMS: three sends succeeded, three later attempts failed, one mock start, nine blocked.
**The configured ceiling could not be read** — it lives in `config.twilio.php` and is only
displayed on the PIN-protected dashboard, whose field caps at 50. It is certainly above 3,
since live attempts continued after the third send. Read the exact figure from the dashboard.

A pre-clear database backup sits beside the live file. **Do not reset, delete, merge or
invalidate any record without explicit authorization.**

---

## H. Known limitations — state these plainly, never soften them

- **Email ownership proves control of an inbox, not a unique person.** Someone with several
  addresses can be several voters.
- **A phone and an email verified in separate sessions remain two identities**, each with its
  own +1, unless something links them. `pc_identity_link()` merges them when it can see both.
- **The +2 cannot be doubled** — the UNIQUE index on the attendee binding prevents it. That is
  the one strong guarantee here.
- Email-channel votes are separately auditable by key prefix (`eml:`, `tel:`, `sim:`, `att:`)
  and are flagged.
- **Do not describe any of this as fraud-proof, or as guaranteeing one unique human.** Keep the
  audit trail, review flagged patterns before certifying a winner.
- `api/attendee-count.php` publicly returns 185 first-names-and-initials. Probably intentional
  for a "who's coming" display — worth a decision before launch, not a blocker.

---

## I. Production launch checklist

Nothing below has been done. Production has none of this subsystem.

1. `git checkout main && git pull` — local main is two commits behind.
2. **Resolve the production drift first.** Sponsor logos (`zation.png`, `simms-media.png`) exist
   on the live server and **in no commit**. A deploy replaces the web root and will delete
   them. Download them, commit them, then deploy.
3. Merge `monday-launch` into `main` by review, not by force.
4. Create `nextgen-data/` beside `public_html` on production, with its own `.htaccess` and a
   zero-byte `index.html`.
5. Place `config.php`, `config.smtp.php`, `config.admin.php` and `config.twilio.php` there —
   production values, a **fresh admin PIN**, and a deliberate SMS ceiling.
6. Deploy, then verify before announcing: private endpoints 403, `pc-bonus.php` 401, the admin
   gate present, `state`, `mode` and `deadline` correct, and **production NOT noindex** (the
   staging `X-Robots-Tag`, meta tag and `robots.txt` must not travel with it).
7. Cast one real test vote and claim one real bonus before any traffic arrives.
8. Confirm the deadline reads `-04:00` Eastern on production too.

---

## J. Priorities

| | What | Who |
|---|---|---|
| **A** | Complete one real +2 claim on the current voting day: cast +1, let the automatic Eventbrite check run, confirm, verify the two rows | the user, then Claude |
| **B** | Confirm the returning-voter gallery afterwards — the backed founder actionable, the rest outlined | the user |
| **C** | Launch readiness — section I, plus correct contestant content | Claude |
| **D** | Deliverability across Gmail, Outlook, iCloud/Yahoo, with authorization for each send | the user |
| **E** | Founder Feed design work — **only after the voting experience works** | later |

Two DNS items remain outstanding and are the user's: moving the sender to a
`@nextgensummit.us` Workspace mailbox, and merging the duplicate SPF records into a single
record. Neither explains authentication for the current Gmail sender, which passes SPF, DKIM
and DMARC — the spam placement seen is sender reputation, not authentication, and switching to
`hello@nextgensummit.us` is not a guaranteed fix either: a promotional message from that
address has landed in spam before.

---

## K. The exact next action

**First, a correction that changes what this action is.** The gallery fix landed roughly an
hour before midnight Eastern on 2026-10-22. The voting day has since turned over. Because the
bonus must follow *that day's* vote, and the 22nd is over, **the chance to claim a +2 against
the Semifinalist 01 vote has expired.** Not a bug — the rule working as designed. The vote
itself stands and still counts.

So the test is now the ordinary flow, from the top, on the current day:

1. The user opens `https://staging.nextgensummit.us/pitch/peoples-choice/` in the browser
   holding the verified session. Every card should read **VOTE** — the allowance has reset, so
   there is no "today's founder" yet and nothing should look used.
2. They cast their +1 for today, for whichever founder they choose. This is a real vote they
   are entitled to, not a vote spent on a test.
3. The confirmation screen should run the Eventbrite check **by itself**, with no second code,
   against the address already proven. This is the moment `eventbrite-emails.json` is built
   for the first time — the step that has never run.
4. If a registration matches, they press **GIVE MY +2 POINTS** and the two rows are written to
   that same founder.
5. They report what each screen actually said, including any wording that reads as an error.

Then reload the gallery: that founder's card should read **VIEW MY 3 POINTS**, and every other
card **TODAY'S VOTE IS USED**, outlined. That is the returning-voter path the fix was for, and
confirming it needs no extra vote.

**If it fails at step 3**, the useful detail is whether the screen said the registration was
not found, or that the check was unavailable. Those are different faults and the copy
distinguishes them deliberately. Nothing is recorded by a failed check.

---

## L. Resuming in a fresh conversation

Read this file first, then verify rather than trust it:

```bash
git rev-parse --abbrev-ref HEAD && git log --oneline -3 && git status --short
curl -s https://staging.nextgensummit.us/api/pc-vote.php | head -c 300
curl -s https://staging.nextgensummit.us/pitch/peoples-choice/ | grep -o "v=20261022-[0-9]*" | sort -u
node tools/test-labelvote.js public/assets/js/peoples-choice.js
```

To read staging data without changing it, write a throwaway script following the same shape
`tools/deploy.mjs` uses for authentication: POST to the Hostinger
`/api/hosting/v1/files/upload-urls` endpoint with the hosting username and domain, take
`auth_key` and `rest_auth_key` from the reply and send them as `X-Auth` and `X-Auth-Rest`,
then `GET /api/resources/nextgen-data-staging` to list and `/api/raw/...` to download the
SQLite file. Open the copy read-only, report **aggregates only**, delete the copy. Never print
voter keys, email keys, attendee keys, IP hashes or codes — they are one-way HMACs and there
is still no reason to show them. Do not read the `config.*.php` files at all.

**Standing constraints, all still in force:**

- Staging only. Do not change production, DNS, or deployment configuration.
- Do not expose, overwrite or reveal credentials.
- Do not send SMS or email automatically, and do not change the SMS ceiling.
- Do not cast votes or award bonus points on anyone's behalf.
- Do not reset, delete or invalidate existing vote records.
- Do not reintroduce the staging passcode or the test banner; keep staging noindex.
- Do not delete the hidden phone verification.
- Do not weaken a server-side safeguard to make a flow easier to demonstrate.
- Heredocs in this environment strip backslashes — edit PHP and JS with the file tools, and
  verify with `node --check` or a brace/paren balance check before deploying.
