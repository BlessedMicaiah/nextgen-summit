# People's Choice is on production — what is live, and what still needs you

Deployed 2026-10-23 from `main @ 7af5396`. Live at
<https://nextgensummit.us/pitch/peoples-choice/>.

---

## Three things only you can do — the dashboard is PIN-gated and I will not enter credentials

All three are on <https://nextgensummit.us/pitch/peoples-choice/admin/> and none needs a
deploy. Do them in this order, because opening voting before the first one works gives
visitors a Vote button that cannot do anything.

### 1. No verification channel exists on production, so nobody can vote

`/api/pc-otp.php?action=status` reports `email_ready: false`, `sms: "mock"`,
`channel: ""`. Email has no relay configured and Twilio is in MOCK. A visitor can browse
every founder, but the moment they try to verify there is nothing to verify *with*.

**This is the launch blocker.** Nothing in the deploy could fix it: the settings live in
`nextgen-data/config.smtp.php` on the server, outside the web root, where an archive
cannot reach — which is exactly why they survive deploys.

Fix it from the dashboard, no deploy needed:
<https://nextgensummit.us/pitch/peoples-choice/admin/> → the email relay section. All four
of host, username, app password and From address must be filled; leave one blank and email
verification stays off. Use a Google Workspace **app password**, not an account password.

Then re-check that `email_ready` has flipped to `true` before announcing anything.

### 2. Set the deadline before you open — otherwise voting never closes

`deadline: null`. `pc_voting_open()` reads both the state *and* the deadline, and a null
deadline means **it returns true forever**:

```php
$t = pc_deadline_ts();
if ($t === null) { return true; }
return time() < $t;        // exclusive: at the cutoff instant, voting is shut
```

So if voting is opened with the field blank, it stays open past the 28th until somebody
remembers to click "closed" by hand. The page already tells visitors voting closes on
October 28, so the site would be contradicting itself.

Dashboard → **Voting** → *Deadline (ISO 8601)*:

```
2026-10-29T00:00:00-04:00
```

That is midnight Eastern at the end of the 28th, which is the rule as stated, and because
the cutoff is exclusive it makes "11:59 PM on the 28th" the last minute anyone can vote.
`-04:00` is correct: US daylight saving does not end until 1 November 2026.

### 3. Then open voting

Dashboard → **Voting** → the four buttons `coming-soon` / `open` / `closed` / `results`.
Click **open**. The current one is highlighted.

Confirm it took by loading
<https://nextgensummit.us/api/pc-otp.php?action=status> — you want `"state":"open"`,
`"open":true`, `"mode":"daily"` and a non-null `"deadline"`.

The founder cards will change from **SOON** to **Vote** within seconds, no deploy and no
cache wait.

---

## What is correct and verified on the live site

| | |
|---|---|
| Voting mode | **`daily`** — the +1/+2 daily rule, *not* single-vote. Verified on the live endpoint. |
| Database | fresh and empty. 20 founders, every total zero. No staging test rows carried over. |
| Unauthenticated voting | `POST /api/pc-vote.php` and `/api/pc-bonus.php` both answer `401 verify_required`, including with a valid CSRF token and a real entrant id. Probing recorded nothing. |
| Private paths | `/nextgen-data/` 404. `api/config.php`, `api/pc-lib.php`, `api/_lib.php` all 403. |
| Founder cards | all 21 panels render, 20 portraits, 12 company logos, 14 videos. No console errors. |
| Contestant numbers | gone. |
| Duplicate "EVERY FOUNDER" gallery | gone. |
| Search | on the main surface. |
| Standings | public, in points, with voters shown separately (`by_votes: true`). No medals yet because everyone is on zero. |
| Mobile | 375px: no horizontal overflow, "TAP TO EXPLORE THIS FOUNDER". |
| Desktop | 1280px: "CLICK TO EXPLORE THIS FOUNDER", rail arrows, keyboard nav. |

### Nothing production had was lost

The archive was built as a **superset** of the live site, not a replacement for it, because
a Hostinger deploy replaces the whole web root. Confirmed still serving after the deploy:

```
/                 film section present, six sponsor logos
/about/           film section present, six sponsor logos
/pitch/           production's own version, unchanged apart from the nav link
assets/css/film.css, assets/js/film.js        both still live
assets/img/sponsors/zation.png, simms-media.png   both still live
```

`api/config.php` is byte-identical to the one in every production archive since
2026-09-30, so no secret rotated and no existing session or stored hash was invalidated.

Pre-deploy copy of production: `backups/production-2026-10-23-evening/`, nine files, each
with its sha256. Verified unchanged immediately before deploying.

---

## One bug found and fixed during verification

The reel rail's compact vote label treated "closed" and "not open yet" as the same thing,
so with production sitting in `coming-soon` **all twenty founder cards told visitors the
vote was over**, five days before it starts. The banner, the dialog and the gallery button
all had it right; only the rail — the part people actually look at — was wrong.

Fixed in `7af5396`: the rail now says **Soon** before voting opens and **Closed** after.
The label test grew from 13 cases to 20; two of the new ones are this bug.

---

## Still outstanding

- **Eventbrite token rotation is unconfirmed.** It was exposed in a development transcript
  on 2026-10-23 and cannot be checked from outside — the only honest test is whether a new
  token works, and the value sits in `config.php` on the server. Treat it as unrotated.
  Procedure in `peoples-choice-launch-plan.md` §B2; the old token is not revoked until the
  new one is proven on both hosts.
- **SMS for real voters is not ready.** Twilio is in MOCK, which is the intended launch
  state, but if you want phone verification there is an account upgrade, an allowlist and
  a spend ceiling to settle first.
- **The attendee +2 flow has not been exercised end to end against a real registration.**
  The code binds a registration once and makes the bonus follow that day's chosen founder,
  but no live claim has been made.
- **Production is still deployed from a second source outside this repository.** On
  2026-10-23 the live asset stamp moved while `origin/main` did not. The superset archive
  works around it; it does not resolve it. Whoever deploys from that other copy needs to
  know this repository is now the source, or the drift starts again.
- **No founder biographies**, so "The founder" stays shut on every card.
- **Eight companies have no logo** (ApplyTrack, Jay's Watermelonade, Melavyr, Offguardz,
  PathBridge, Rest, The Luminous Lab, iBraid); their card backs show the founder's photo.
- **The Luminous Lab's own copy begins "Kainema is…"** — their words, their call.

---

## Rolling back

- **The site:** rebuild from the previous `main` commit and deploy that. The previous good
  production archive is `release/nextgensummit.us-42c5075.zip`; the one before People's
  Choice existed is `release/nextgensummit.us-74fb0c2.zip` (2026-10-17).
- **If a deploy damages live content:** restore from
  `backups/production-2026-10-23-evening/`.
- **Standings visibility, voting mode, voting open/closed:** all dashboard toggles. No deploy.
- **Votes:** never deleted. Invalidation sets `valid = 0` and keeps the row; the dashboard
  restores it. Copy the database beside itself before any bulk change.
