# People's Choice — going live

Written 2026-10-23, against `monday-launch`. Voting closes **28 October, 11:59 PM ET**.

Production is untouched and stays untouched until the owner authorises the deploy.

---

## 1. The blockers, in the order they have to be cleared

### B1 — Production holds 442 lines and a whole feature that no commit contains

**This is the one that stops everything else**, and it is larger than the previous
handoff recorded. Checked live against `origin/main`, which is the comparison that
matters:

| | lines live that `origin/main` lacks |
|---|---|
| `/` | 126 |
| `/about/` | 91 |
| `/pitch/` | 225 |
| `/experience/`, `/tickets/`, `/scholarship/`, `/thanks/`, `/registration-received/` | 0 — identical |

Plus two files serving 200 on production that exist in **no branch and no commit**:

- `assets/css/film.css` — 22 KB
- `assets/js/film.js` — 26 KB

And the homepage runs a **six-logo** sponsor marquee where the repository has four.
Zation and Simms Media exist only on the server, in the homepage and in the About
directory.

A Hostinger deploy **replaces the web root**. Deploying any branch today would take
the film feature off the live site, drop two sponsors from two pages, and revert 225
lines on the pitch page.

**Done already:** everything production serves and git does not is saved under
`backups/production-2026-10-23/`, each file with its sha256 in `manifest.json`, and
the two sponsor logos are in `public/assets/img/sponsors/` so the next archive carries
them. Nothing on production was changed.

**Still needed — a decision, not a keystroke.** Reconciling 442 lines of unknown
provenance, including a feature whose source nobody here has seen, is not something to
do quietly. Three ways out:

1. **Reconcile into the repository** (recommended). Bring the film feature, the
   six-logo marquee and the pitch-page changes into `monday-launch`, verify the three
   pages render identically to the backup, then deploy. Roughly half a day, and it ends
   the drift permanently.
2. **Deploy only the People's Choice subtree.** Not possible with this deploy model —
   the archive is the whole web root.
3. **Accept the loss.** Only if leadership confirms the film section and the two
   sponsors are meant to go.

Whoever made those changes on the server should be asked first. Until then, every
other blocker below is downstream of this one.

---

### B2 — The Eventbrite token has not been rotated

It was exposed in a development transcript on 2026-10-23. Production and staging share
it, and it serves the live homepage counter.

Rotation workflow, in this order — **the old token is not revoked until the new one is
proven in both places**:

1. Owner creates a new private token in the Eventbrite account (Account settings →
   Developer links → API keys). It is never pasted into chat, a commit, a log or a
   report.
2. Owner writes it into the staging config file on the server
   (`api/config.eventbrite.php`, outside the web root — see the main handoff §A for the
   path). One line, value only.
3. Verify staging: the bonus flow reaches a real Eventbrite lookup and the attendee
   index rebuilds. `pc-bonus.php` names its own failures now, so a bad key says so.
4. Repeat step 2 on production, verify the homepage registration counter still moves.
5. **Only then** revoke the old token in the Eventbrite account.
6. Re-verify both hosts once more after revocation.

Rolling back is step 2 in reverse; keep the old value until step 6 passes.

---

### B3 — People's Choice has never been deployed to production

`https://nextgensummit.us/pitch/peoples-choice/` and `/api/pc-rank.php` both answer
404 today. Going live is a **first** deploy of the whole subsystem, not an update.

What has to be true on the production host before the page is reachable:

- [ ] The data directory exists **outside** the web root and is writable by PHP.
      Staging uses `nextgen-data-staging`; production must use `nextgen-data` and must
      **not** be handed a copy of the staging database — those rows are test data.
- [ ] `api/config.php` present (private settings; never committed, so never in the
      archive) with the production data directory and the production keys.
- [ ] `api/config.eventbrite.php` present, with the **new** token from B2.
- [ ] `api/config.twilio.php` present and left in MOCK: phone verification stays
      hidden, so nothing should be able to send an SMS.
- [ ] Mail relay settings present, and a single test message confirmed to arrive.
- [ ] The database is created empty on first request and the tables migrate cleanly
      (`pc_votes` with the unique index `pc_votes_one`, `pc_meta`).
- [ ] The data directory is not reachable over HTTP. Check directly:
      `curl -I https://nextgensummit.us/nextgen-data/` must not return 200.

**And one that is easy to miss:** `pc_mode()` falls back to `single` — one vote for the
whole competition — unless an administrator sets the mode. The daily +1/+2 rule
leadership has described **will not be in force on a fresh production database until
someone sets it on the dashboard.** Set it, then confirm the page reads "Voting open"
and the vote dialog offers +1 and +2.

---

### B4 — One person, several email addresses

Email verification proves control of an inbox. It does not establish a person, and
nothing in this system claims otherwise. Demonstrated earlier in development: four
identities put eight points on a single founder in one day, entirely within the rules
as written.

What the current safeguards genuinely do:

- one allowance per verified identity per day, counted server-side from the vote rows
- the attendee +2 is bound to a real Eventbrite registration and follows that day's
  chosen founder
- a registration can be bound once, so one ticket cannot unlock several identities
- rate limits per address and per connection on code requests

What they cannot do: tell two inboxes belonging to one person from two people.

Proportionate options, for leadership to choose between — **none implemented, because
changing eligibility policy mid-competition is the owner's call:**

| option | effect | cost |
|---|---|---|
| Leave as is, say so publicly | honest; a determined voter can still stack | none |
| Require the attendee +2 for any vote | ties every point to a paid registration | excludes the public entirely |
| Phone verification as well as email | much harder to repeat; still not a person | reinstates SMS cost, and the hidden flow would come back |
| Cap points per founder per day per connection | blunts the obvious case | punishes shared networks — a school, a library |
| Publish the margin, not the totals, at the end | shifts the problem to transparency | no technical change |

Recommendation: leave the rule as it stands for the remaining five days, and say
plainly on the page what verification does and does not prove. Changing the rule with
votes already cast is worse than the exposure.

**Do not claim, anywhere, that this guarantees one vote per human.**

---

### B5 — Ranking the feed publishes the standings

Built as asked, and now switchable without a deploy.

- `pc-rank.php` publishes the **order** and withholds the **totals**.
- A stored setting, `rank_public`, decides whether the order reflects votes. The
  dashboard has the control: *The public founder feed → Hide the standings*. Off puts
  the feed back into contestant order within the endpoint's 30-second cache.
- The response states which it is doing (`by_votes`).
- Ties share a rank; the tiebreak is contestant id ascending, applied only inside a
  tie.
- **Medals appear only when the standings actually differ.** Every founder is on zero
  today, so `ranked` is false and the feed shows no 1st/2nd/3rd at all.

What leadership is deciding, stated plainly: ordering the feed by votes tells every
visitor who is ahead of whom, even though no number is shown. A visible leader attracts
votes a hidden one would not. That is a competition-policy choice. The default is **on**
for the release candidate because that is what was asked for; one click makes it off,
and it can be set either way before the production deploy.

---

## 2. The deployment sequence

Nothing here runs without the owner's explicit go-live authorisation.

1. Clear **B1**. Nothing else matters until the live content is either in the repository
   or formally written off.
2. Clear **B2** through step 4 (new token working in both places, old one still alive).
3. Decide **B4** and **B5**. Both are settings or statements, not code.
4. `git push origin monday-launch`, then merge to `main` and push. `release.py` refuses
   to build unless the branch is checked out, clean, and identical to GitHub.
5. Back up production again, immediately before the deploy — the copy in
   `backups/production-2026-10-23/` is only as fresh as its timestamp.
6. Back up the production data directory if one already exists.
7. `python -I tools/release.py production` then
   `node tools/deploy.mjs nextgensummit.us release/production-<sha>.zip`.
8. Immediately after: the smoke list in §3.
9. Complete **B2** steps 5 and 6 (revoke the old token).

---

## 3. Smoke list, run against the live host

```
/                                   200, film section present, six sponsor logos
/about/                             200, six sponsor logos in the directory
/pitch/                             200
/pitch/peoples-choice/              200
/api/pc-rank.php                    200, ok:true
/api/pc-otp.php?action=status       200, state matches what the dashboard says
POST /api/pc-vote.php  (no session) 401 verify_required
POST /api/pc-bonus.php (no session) 401 verify_required
/nextgen-data/                      NOT 200
```

Then, by hand: one founder reel plays; the vote dialog opens on Verify & vote; one real
vote end to end from a verified address; the +2 claim from a registered attendee lands
on the same founder; the dashboard shows both.

---

## 4. Rolling back

- **The site:** rebuild the archive from the previous `main` commit and deploy that.
  The deploy replaces the web root, so a rollback is simply the previous release —
  provided B1 is cleared first, or the rollback reintroduces the same loss.
- **The ranked feed:** the dashboard toggle. No deploy.
- **The voting mode:** the dashboard. No deploy.
- **Votes:** never deleted. Invalidation sets `valid = 0`, keeps the row and its note,
  and the dashboard can restore it. Take a dated copy of the database beside itself
  before any bulk change.
- **The Eventbrite token:** keep the previous value until the new one is proven on both
  hosts.

---

## 5. Approvals still outstanding

1. What happens to the 442 lines and the film feature on production. **(B1)**
2. Rotate the Eventbrite token, and who does it. **(B2)**
3. Whether the founder feed runs in vote order in public. **(B5)**
4. Whether anything changes about identity policy before the 28th. **(B4)**
5. Founder biographies — twenty are missing, so "The founder" stays shut on every card.
6. Portraits for Credible blossom and K8Culture Productions.
7. The Luminous Lab, whose own description begins "Kainema is…". Their copy, their
   decision.
8. Go-live itself.
