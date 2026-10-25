# Production deploy — proposed 25 October 2026

**Status: waiting for approval. Nothing below has been deployed to production.**

Everything here is live and tested on `staging.nextgensummit.us`. Production is still running
`main` @ `0bc483d`, unchanged.

The competition closes **23:59:59 ET on 28 October**, three days from now, with ~1,790 votes cast.
That shapes every judgement in this document: the bar for touching production is high, and the
two changes that clear it are the two that protect something.

---

## 1. What is being proposed, and what is not

There are three separable pieces. They can be approved independently, and I would recommend
exactly that.

| # | Change | Why now | Risk if deployed | Risk if NOT deployed |
|---|---|---|---|---|
| **A** | Fail-closed guard on "Clear all votes" / "Add test votes" | One click currently destroys the competition | Very low — adds a refusal, changes no counting | **Every vote, permanently, from one mis-click** |
| **B** | Restore the attendee opt-in check | 210 people's names are public without consent | Low — removes a list; count unaffected | Continued disclosure, and it grows with registrations |
| **C** | NextGen Data dashboard + collector | Leadership wants live analytics | Low, but it is new code on a live site | None. It works on staging against live data today |

**My recommendation: approve A and B now. Hold C until after the competition closes on 28 Oct.**

A and B each fix something that is wrong *right now*. C is an improvement that already works
without being on production at all — the staging dashboard reads the live ballot read-only, which
is the whole point of how it was built. There is no reason to add new code to a live voting site
in its final three days for a benefit you already have.

---

## 2. Change A — the destructive controls

### What is wrong today

`public/pitch/peoples-choice/admin/index.php` renders two buttons under this heading:

> *"Staging only. These write to the staging data directory, which is a different file from the live one."*

Nothing checks. `pc_reset()` runs `DELETE FROM pc_votes WHERE competition = ?` against whatever
`pc_db()` resolves to — on production, the live ballot. The confirmation message then reads
*"All People's Choice votes cleared from the staging store."*

So: one click, every vote gone, and a message saying it did not happen.

### Exact changes

**`public/api/pc-lib.php`**
- `+ pc_store_is_review(): bool` — positively identifies the review store by directory name.
  Not "is not production": one specific name, and everything else, *including an exception while
  working it out*, is a refusal.
- `+ pc_destructive_note(): string` — the sentence the dashboard prints in place of the old,
  false one.
- `pc_reset()` — signature `void` → `bool`. Refuses and logs off the review store.
- `+ pc_seed(): int` — the seeding loop moved out of the dashboard so it sits behind the same
  guard. Refuses and logs off the review store.

**`public/pitch/peoples-choice/admin/index.php`**
- The `seed` / `reset` POST branch answers **403** and states plainly that nothing changed.
- The Test data section renders its buttons only when `pc_store_is_review()`, and confirms
  before clearing where it does.

Three layers. Only the innermost is a guarantee — a crafted POST that never loads the page still
meets `pc_reset()` and is refused there.

### What does not change

No counting rule. No vote row. No schema. No other admin function. `pc_invalidate()` (flagging a
vote invalid, which is reversible) is untouched.

### Evidence

`tools/test-pc-destructive-guard.php` runs both cases in **separate processes**, because
`ngs_data_dir()` caches for the life of a request and one process cannot honestly pretend to be
two deployments. Against a store named `nextgen-data`: both operations refuse, and all 25 fixture
votes are still present afterwards. 19 assertions, all passing.

---

## 3. Change B — attendee names

### What is wrong today

The opt-in check in `public/api/attendee-count.php` was commented out on 2026-10-09 and marked
`TEMPORARY`. For the sixteen days since, the endpoint has published the first name and last
initial of **every attending person**, regardless of what they agreed to.

Measured just now, unauthenticated:

```
https://nextgensummit.us/api/attendee-count.php   ->  244 attendees, 210 names published
https://staging.nextgensummit.us/... (patched)    ->  244 attendees, no "names" key at all
```

### Exact changes

**`public/api/attendee-count.php`**
- `ngs_eb_attendee_opted_in()` restored from its commented-out state and hardened so that
  *absence reads as refusal*: no answers, no matching question, a blank answer, a lookalike
  question, an unconfigured question id with nothing on the form to match — every one is a no.
- `+ ngs_eb_names_allowed()` — `NGS_EB_PUBLIC_NAMES = false` in config.php turns the list off
  outright, independently of opt-ins.
- The collection loop consults both before adding a name.
- An empty list now sends **no `names` key at all** rather than `"names": []`.
- The private snapshot records `names_considered` / `names_agreed` so the owner can see whether
  the order form is actually asking — without that gap being published.

### The consequence you need to decide about

**The "who's coming" list will go empty**, because the Eventbrite order form has no consent
question, so nobody has ever opted in. Staging proves this against real Eventbrite data: 244
attendees, 0 agreed.

Three options:

1. **Deploy as-is.** The names disappear. Privacy-correct immediately. *(My recommendation.)*
2. **Deploy, then add the question** to the Eventbrite order form. New registrants can opt in and
   names return gradually. Existing registrants stay unlisted, which is the correct outcome —
   they were never asked.
3. **Hold the fix** and accept the disclosure. I would not recommend this; it has already run
   sixteen days past "temporary".

The attendee **count** and the per-state totals are unaffected in all three cases. They are
totals over people and name nobody.

### Evidence

`tools/test-attendee-privacy.php` — 49 cases through the real functions, including the exact
shape that caused this: an order form with no consent question, where the answer must be that
nobody is listed.

---

## 4. Change C — the dashboard (recommend holding)

Adds `public/insights/`, `public/api/ngd-*.php`, `assets/css/ngd.css`, `assets/js/ngd.js`,
`assets/js/ngd-track.js`, one guarded line inside each of the two existing `track()` functions,
and two new call sites in `tickets.js`.

It is already delivering its value from staging, reading the live ballot read-only. Deploying it
to production would add: the dashboard being reachable at `nextgensummit.us/insights/`, and the
collector being *present but inert* (`collect` defaults **off** on the live site).

**Held because:** it is new code touching three public pages during the last three days of a live
competition, for a benefit that already exists. After 28 October this becomes an easy yes.

If you want it sooner, the safest subset is everything *except* the three `<script>` tags and the
two `track()` edits — that gives the dashboard on production with zero change to any page a voter
touches.

---

## 5. Pre-flight

Already verified today:

- [x] Production is **byte-identical to `main`** on `/`, `/pitch/peoples-choice/`, `/tickets/`,
      `/about/` — no untracked drift to preserve. This is the cleanest window the project has had.
- [x] Every asset the live homepage references exists in the repo.
- [x] `release/nextgensummit.us-0bc483d.zip` is **byte-identical to what is live** — a true
      rollback artifact, already built.
- [x] All suites green: 167 + 19 + 49 + 6 + 43 assertions.

To run again at deploy time:

```bash
cd "nextgen-summit" && git fetch origin && git status --short
```

---

## 6. Deploy procedure

Production builds come from `main`. The changes are on `monday-launch`, so A and B must be
brought across **without** dragging C with them.

```bash
# 1. a release branch off the current production commit
git checkout main && git pull
git checkout -b hotfix/protect-votes-and-names

# 2. take only the two security fixes
git checkout monday-launch -- public/api/pc-lib.php \
                              public/pitch/peoples-choice/admin/index.php \
                              public/api/attendee-count.php \
                              tools/test-pc-destructive-guard.php \
                              tools/test-attendee-privacy.php

# 3. prove them against this branch, not the one they were written on
php tools/test-pc-destructive-guard.php
php tools/test-attendee-privacy.php

# 4. the cache stamp must move, because assets changed
#    (release.py now refuses the build if it did not — that guard was inert until today)

# 5. push, then build and deploy
git push -u origin hotfix/protect-votes-and-names
# merge to main via PR, then:
git checkout main && git pull
python -I tools/release.py production
node tools/deploy.mjs nextgensummit.us release/nextgensummit.us-<sha>.zip
```

`release.py` refuses to build unless the branch is clean and identical to GitHub, so step 5
cannot ship anything that is not on origin.

---

## 7. Rollback

**The rollback artifact already exists and has been verified byte-identical to the live site.**

```bash
node tools/deploy.mjs nextgensummit.us release/nextgensummit.us-0bc483d.zip
```

One command, roughly two minutes, and production is exactly what it is now.

What rollback does **not** undo, because nothing here touches it:

- No vote is created, deleted or altered by any of these changes.
- No database schema changes. The `pc_votes` table is untouched.
- No `pc_meta` rule is written.
- The analytics store lives outside the web root and is not part of any archive, so neither
  deploying nor rolling back affects it.

The one thing to know: a deploy replaces the web root, and `public_html/staging` sits **inside**
production's web root. If a production deploy ever removes it, the staging site is restored by
redeploying it — nothing is lost but time, and staging holds no competition data.

---

## 8. Post-deploy verification

```bash
# voting still answers, and the rules are unchanged
curl -sS -H 'Cache-Control: no-cache' "https://nextgensummit.us/api/pc-vote.php?cb=$RANDOM"
# the totals have not moved
curl -sS -H 'Cache-Control: no-cache' "https://nextgensummit.us/api/pc-rank.php?cb=$RANDOM"
# names are gone, the count survives
curl -sS -H 'Cache-Control: no-cache' "https://nextgensummit.us/api/attendee-count.php?cb=$RANDOM"
```

Then, signed in to `/pitch/peoples-choice/admin/`: the Test data section should show the refusal
sentence and **no buttons**.

Abort and roll back if: the vote total drops, `pc-vote.php` stops answering `state: open`, or the
admin dashboard fails to render.

---

## 9. Still open

- **The Eventbrite token** was exposed in a development transcript on 2026-10-23 and its rotation
  is unconfirmed. Worth settling regardless of this deploy.
- **The opt-in question** does not exist on the Eventbrite order form. Adding it is what makes a
  "who's coming" list possible again, honestly.
- **The shared admin PIN** opens `/admin/`, the People's Choice admin, and (today) the dashboard.
  Named leadership accounts now exist; setting `NGD_DISABLE_OWNER_PIN = true` in config.php ends
  the PIN's access to the dashboard once those accounts are in use.
