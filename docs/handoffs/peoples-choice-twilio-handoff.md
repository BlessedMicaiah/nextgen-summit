# People's Choice Award + Twilio Verify — development handoff

**Written 21 October 2026.** Source of truth is the repository state, not conversation memory.
Verified against `monday-launch @ f084d08`, working tree clean.

**Contains no secrets.** No credentials, no complete phone numbers, no OTP codes. Do not add
any. The one phone number in play is referred to only as "the test number ending 4916".

---

## 0. Read this first — the live blocker

**The Twilio credentials on staging are fake.**

During testing on 21 October, a configuration save posted throwaway test values
(`ACtest…`, `SKtest…`, a dummy secret, `VAtest…`) into the live settings file at the same
moment the user was entering the real ones. The test values won.

The dashboard reports `account sid: ok`, `api key: ok`, `api secret: present`,
`verify sid: ok`, `configured: yes`. **All of that is true of the format and false of the
substance.** Those checks only inspect prefixes and lengths.

> **A passing format check is not a working credential.** The only proof that authentication
> works is a successful call to Twilio. There has never been one.

**Do not overwrite the configuration file with test values again.** If a write path needs
testing, test it on the local harness, or test only the non-secret fields (allowlist, budget).

What survived: the allowlist (the test number ending 4916), the budget (3), `enabled = false`.

---

## A. Architecture

**Static site + small PHP backend on Hostinger shared hosting.** No framework, no build step,
no Node runtime in production.

| Layer | What it is |
|---|---|
| Frontend | Hand-written HTML, CSS, vanilla JS (ES5-flavoured, IIFE modules, no bundler) |
| Backend | PHP 8, plain files under `public/api/` |
| Database | SQLite via PDO, **outside the web root** |
| Hosting | Hostinger, username `u382065856` |

### Environments

| | Branch | Document root | Data directory |
|---|---|---|---|
| Production | `main` | `public_html` | `nextgen-data` |
| Staging | `monday-launch` | `public_html/staging` | `nextgen-data-staging` |

Feature work happens on `feature/peoples-choice-staging`, merges to `monday-launch`, deploys to
staging. **It has never been merged to `main`.** Production is `74fb0c2`.

### Deployment

```bash
python -I tools/release.py staging          # refuses unless monday-launch is checked out,
                                            # clean, and identical to origin
node tools/deploy.mjs staging.nextgensummit.us release/staging-<sha>.zip
```

`tools/deploy.mjs` uploads via Hostinger's TUS endpoint then triggers a deploy. The TUS create
needs **both** `X-Auth` and `X-Auth-Rest`; with only one the edge returns a bare HTML 403.

**Two deployment facts that cost us real time:**

1. **A deploy REPLACES the web root.** It does not merge. Anything in the web root that is not
   in the archive is deleted. This destroyed a credentials file that lived in `api/`.
2. **The data directory is untouched by deploys.** The vote database has survived every
   release. That is why the credentials now live there.

### Asset cache stamp

Every asset URL carries `?v=YYYYMMDD-NN`, currently `v=20261021-01`, across ~86 references.
**Bump it whenever CSS or JS changes.** Forgetting it means the CDN serves the copy it cached
first — this has bitten twice, once leaving a page with new CSS and an older script.

---

## B. People's Choice Award

**Public page:** `/pitch/peoples-choice/` — hero with live Eastern countdown, prize cards,
six-step instructions with a tutorial-video placeholder, a 20-contestant gallery, profile
dialogs, a share sheet, and the vote flow.

**Per-contestant pages:** `/pitch/peoples-choice/<slug>/` via `.htaccess` rewrite →
`entrant.php`. Each emits its own Open Graph tags so a shared link produces a preview card with
that founder's name. Visits are logged for attribution.

**Admin dashboard:** `/pitch/peoples-choice/admin/` — PIN-protected. Live leaderboard, full
20-row standings, vote review with invalidation, contestant traffic, voting-rule controls,
Twilio configuration and health.

### Files

| Path | Role |
|---|---|
| `public/pitch/peoples-choice/index.html` | the public page |
| `public/pitch/peoples-choice/entrant.php` | per-contestant page + OG tags + visit logging |
| `public/pitch/peoples-choice/.htaccess` | slug rewrite |
| `public/pitch/peoples-choice/admin/index.php` | dashboard, live feed (`?data=1`), controls |
| `public/api/pc-lib.php` | vote store: rows, tallies, standings, invalidation (21 functions) |
| `public/api/pc-rules.php` | voting rule, allowances, attribution (12 functions) |
| `public/api/pc-twilio.php` | Twilio Verify, rate limits, allowlist, budget (22 functions) |
| `public/api/pc-twilio-write.php` | writes settings from the dashboard (3 functions) |
| `public/api/pc-otp.php` | OTP endpoint + voter session (5 functions) |
| `public/api/pc-vote.php` | casting a vote; says no numbers back |
| `public/assets/js/peoples-choice.js` | gallery, profiles, share, vote + OTP flow |
| `public/assets/js/pc-admin.js` | dashboard live updates |
| `public/assets/css/peoples-choice.css`, `pc-admin.css` | styling |
| `docs/peoples-choice-verification-and-rules.md` | SMS cost comparison, schema, edge cases |

### Database (SQLite, in the data directory)

```
pc_votes    id, competition, voter_key, vote_day, slot, entrant_id,
            created_at, valid, simulated, ip_hash, note
            UNIQUE (competition, voter_key, vote_day, slot)
pc_meta     k, v                 -- state, deadline, mode, allowances, phone_required
pc_visits   entrant_id, source, day, visitor, created_at
pc_otp_log  phone_key, ip_hash, action, ok, live, created_at, ts
```

**Nothing increments a counter.** Every total is `COUNT(*)` over rows still `valid = 1`,
computed when asked. That is the only way invalidating a vote removes it from a total correctly.

**The unique index is the one-vote rule.** Under the approved rule every row is
`vote_day = 'all'`, `slot = 1`, so the index means one row per voter, full stop. A vote *claims
a slot by inserting* inside a transaction — never check-then-insert, which two simultaneous
requests would both pass.

### Entrant data — all placeholders

`pc_entrants()` in `pc-lib.php` generates 20 slots: "Semifinalist 01".."20", company "Company to
be confirmed", no portraits, no videos. **No name, company, biography or achievement belongs to
a real person**, and every card is flagged "Placeholder slot" on its face. The real 20 have
never been supplied.

---

## C. Voting rules — what is approved versus proposed

| Rule | Status |
|---|---|
| **One vote per verified voter, whole competition** | **APPROVED — and currently active** (`PC_MODE_DEFAULT = 'single'`) |
| Daily allowance: 1/day public, 2/day ticket holder | **PROPOSED — built, tested, NOT enabled** |
| Three total daily points for fully verified attendees | **PROPOSED — not built** (needs Eventbrite) |
| Voting closes 28 Oct 2026, 11:59 PM Eastern | Implemented; server cutoff is 29 Oct 00:00 ET, **exclusive** |
| Daily reset at midnight Eastern | Implemented, tested |

Both models run on one table. The mode is a stored setting an administrator changes
deliberately on the dashboard — **a deploy cannot change the rules of a running competition.**

**Open decision:** under the daily rule, both of a voter's daily votes may currently go to the
**same** contestant. Leadership asked for this to be clarified before implementation; it has
not been answered.

**Eventbrite registration verification is NOT built.** Phase two, not started. On staging the
ticket flag is taken from the request — a claim, not a fact — purely so the model can be
demonstrated, and every such vote is marked `ticket_claimed_unverified`. It must never be read
as a verified attendee.

---

## D. Twilio Verify integration

### Where the credentials live

```
nextgen-data-staging/config.twilio.php      <- correct: outside the web root, survives deploys
public_html/staging/api/config.twilio.php   <- legacy: still read if present, WIPED by deploys
```

Constants: `PC_TWILIO_ENABLED`, `PC_TWILIO_ACCOUNT_SID`, `PC_TWILIO_API_KEY`,
`PC_TWILIO_API_SECRET`, `PC_TWILIO_VERIFY_SID`, `PC_SMS_LIVE_ALLOWLIST`,
`PC_SMS_LIVE_MAX_TOTAL`, `PC_SMS_ALLOWED_COUNTRIES`, and three rate-limit constants.
Template: `public/api/config.twilio.example.php` (placeholders only).

**Entry route:** the PIN-protected dashboard → *Twilio configuration* → *Enter or update the
credentials*. Values are written and never rendered back, so the boxes always start blank —
deliberate, not a bug. An empty box keeps what is stored. Nothing is logged on success or
failure. Written to a neighbouring file and renamed into place, `0600` where the host allows.

### Two modes, chosen by the server, never by the request

- **MOCK** — config absent or `PC_TWILIO_ENABLED` false. No network call, nothing billed. A
  real code is generated, held in the session, and returned in the response **on staging and
  localhost only** so the flow can be walked end to end.
- **LIVE** — enabled and all four credentials present. Twilio sends and checks; we never see
  the code.

### Endpoints

- `POST /api/pc-otp.php` — `action=start|check|status|signout`. CSRF required on everything
  that changes state. Same-origin enforced.
- `POST /api/pc-vote.php` — casting. Prefers the verified session and **ignores the request's
  claim about identity**. Returns no totals, ranks or leader. A `GET` returns only whether
  voting is open.

### The voter session — the point of the whole exercise

After verification the server sets `ngs_pc_voter`, httpOnly, Secure, **SameSite=Lax**, **path
`/`**. A returning voter is recognised with **no second SMS** — one message per *voter*, not
per *vote*.

Two deliberate choices, both learned the hard way:

- **Path `/`**, because the page is under `/pitch/peoples-choice/` and the endpoints are under
  `/api/`. A cookie scoped to the page is never sent to the endpoints: the session existed and
  could not be read.
- **SameSite=Lax, not Strict**, because a voter arriving from a contestant's WhatsApp link is a
  cross-site navigation and Strict would drop the cookie and demand re-verification.

### Phone handling

Normalised to **E.164** before anything keys on it, so `(410) 555-0199` and its `+1` E.164 form are
one voter. 10 digits assumed North American, 11 starting `1` likewise, `+` form kept, anything
else refused rather than guessed. **Only the HMAC and the last four digits are stored** — never
the number. `voter_key = 'tel:' . hash_hmac(E.164, NGS_SECRET)`.

### Fraud controls, all server-side

| Control | Value |
|---|---|
| Resend cooldown | 60s per number |
| Codes per number | 5 per day |
| Codes per IP | 20 per hour |
| Wrong-code attempts | 5, then the attempt is destroyed |
| Code lifetime | 10 minutes |
| Countries | US, CA only — refused before Twilio is called |
| **Allowlist** | only listed numbers may receive a real message |
| **Hard budget** | ceiling on real sends ever, counted from `pc_otp_log` |

**Both the allowlist and the budget fail closed.** Enabling Twilio with an empty allowlist
sends nothing to anybody. Arming is refused unless all four credentials are present **and** the
allowlist is non-empty.

**Twilio has no enforceable hard spending cap on standard accounts** — "usage triggers" are
alerts that fire after spend. The only enforceable stop is ours.

Refusals that never reach Twilio are logged as `blocked`, not `start`, so they do not consume
the cooldown — otherwise one mistyped digit locks the test handset out mid-test.

### Staging status

Deployed and working in MOCK. Tested: normalisation, non-US refusal, wrong code, 5-try lockout,
no-pending, cooldown, verified vote recorded as `phone_verified`, duplicate refusal, daily rule
with a phone identity, the phone-required gate, and **a returning voter going straight to
confirm without a new code**. **No real SMS has ever been sent.**

---

## E. Security

| Control | State |
|---|---|
| `.gitignore` | `public/api/config.php` **and** `public/api/config.*.php`, with example templates allowed back |
| Apache | `api/.htaccess` denies `^config(\..+)?\.php$` and `^(_lib\|pc-lib\|pc-rules\|pc-twilio)\.php$` |
| Release | `release.py` refuses to package `config.twilio.php` |
| Secrets in git | none — `config.php` has never been committed |
| Admin auth | same PIN as `/admin/`: `NGS_ADMIN_HASH` + `NGS_ADMIN_SALT`, constant-time compare, CSRF, 5-try lockout, own session path |
| Admin feed | `?data=1` returns **401** without a session |
| Public endpoints | never return a total, rank or leader |
| Staging | `X-Robots-Tag: noindex`, `robots.txt` disallow all, no sitemap |

### Bugs found and fixed (each was real, each verified after)

1. **`.gitignore` named `config.php` exactly** — a `config.twilio.php` would have been
   committed to GitHub. Now `config.*.php`.
2. **`.htaccess` matched `^(_lib|config)\.php$`** — which covers `config.php` and **not**
   `config.twilio.php`. Secrets would have been downloadable. Now `config(\..+)?\.php`.
3. **`pc-twilio.php` was web-servable (200)** — leaked nothing because PHP executed it, but if
   an edit ever left it unparseable the raw source, including the credential handling, would
   have been served. Now denied.
4. **Credentials in the web root were deleted by a deploy.** Moved to the data directory.
5. **Voter cookie scoped to the page, endpoints under `/api/`** — session unreadable. Path `/`.
6. **Origin check compared `HTTP_HOST` (with port) to an Origin host (without)** — every vote
   from a browser on a non-default port was refused 403.
7. **A successful save gave no feedback** — it redirected and discarded its own notice, so it
   looked identical to nothing happening.
8. **The allowlist textarea rendered a placeholder, not the stored value** — it looked
   pre-filled when empty, and saving silently cleared the list.

### Known outstanding security items

- Twilio Console settings — **Fraud Guard, geographic permissions, spending alert** — have
  never been verified from here. No Twilio API access. **Must be confirmed by a human.**
- The admin PIN has appeared repeatedly in conversation transcripts. **Should be rotated.**
- Michael Ley's speaker credential on the production site remains unverified (separate issue,
  but still live).

---

## F. Outstanding work

### 1. Immediate blockers

- **The real Twilio credentials must be re-entered** (see §0). Nothing else can proceed.
- Twilio Console: confirm Fraud Guard, US/CA geography, spending alert.

### 2. Incomplete

- The real 20 entrants: names, companies, biographies, portraits, pitch video links.
- Tutorial video for "How voting works" — placeholder in place.
- Eventbrite registration verification — not started.

### 3. Pending leadership approval

- The daily points model (currently off; single-vote rule active).
- The ticket-holder bonus — plus the fairness/legal question of tying extra votes to a purchase.
- Whether both daily votes may back the same contestant.
- Whether the People's Choice winner takes a Top 10 finalist slot. **The public pitch page
  already says yes**, which contradicts the "separate competitions" framing.

### 4. Required staging tests, once real credentials are in

1. One real SMS to the allowlisted test number — **one only, no retries**.
2. Code validated through Twilio Verify.
3. Verified session created.
4. Returning voter needs no second SMS.
5. Vote recorded as `phone_verified`.
6. Duplicate vote refused.
7. A non-allowlisted number refused **before** any Twilio call.
8. Mobile Safari.
9. **Disable real SMS again afterwards.**

### 5. Safe next actions

- Re-enter credentials via the dashboard; confirm the green confirmation line appears.
- Verify the armed state and the allowlist refusal **before** triggering the single SMS.
- Leave production alone.

---

## G. Recent changes

Working tree **clean**. Nothing uncommitted. `monday-launch @ f084d08`, pushed.

Last twelve commits on the staging branch, newest first:

```
f084d08  A save that worked looked exactly like nothing happening
588e742  Put the Twilio setup on the dashboard instead of in File Manager
0341496  The credentials cannot live in the web root
0b963dc  Two hard stops in front of the first real SMS
4ea19b6  Deny pc-twilio.php to the web as well
cc9ad6a  Phone verification: built, wired, and still not sending anything
c8c3c7d  Seal the place the Twilio credentials will live, before they exist
be359ff  Bump the asset stamp so the People's Choice scripts actually ship
0a8e5bc  People's Choice V2 onto the review branch (staging only)
fc0d782  People's Choice V2: prizes, countdown, instructions, per-contestant links
4d93b4f  People's Choice: real vote records, and a live results dashboard
70568c9  Bring the People's Choice staging pass onto the review branch
```

**Staging:** deployed, working, MOCK mode, 4 test vote records, voting state `open`, deadline
set, approved single-vote rule active.

**Production:** `main @ 74fb0c2`, **unchanged throughout**. `/pitch/peoples-choice/` returns
404 on the live site.

---

## H. Working notes for whoever picks this up

- **The local WASM PHP harness is unreliable for this feature.** It has no outbound HTTPS (so
  the Twilio call cannot be exercised) and its PHP instance persists between requests, which
  produces spurious "Cannot redeclare" fatals. **Staging is the real test environment.** When
  local and staging disagree, believe staging.
- **Heredocs in this shell strip backslashes.** Writing PHP via `<<'EOF'` has silently corrupted
  `\'` escapes and regex classes more than once. Prefer the Write tool, or double-quoted PHP
  strings that need no escaping.
- Probe scripts live in the session scratchpad and are **not** in the repo. Rebuild as needed.
- **Measure, don't eyeball.** Several "bugs" turned out to be faulty probes — an isolated JS
  world that cannot see `window.dataLayer`, rotated bounding boxes mistaken for element widths,
  a stale CDN copy. Verify the instrument before believing the reading.
