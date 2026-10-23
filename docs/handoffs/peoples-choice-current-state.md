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

## 0. Root cause of the bonus failure — TWO faults, both fixed 2026-10-23

### Fault 2, the one that kept it broken: an undefined function below the 401 gate

`pc-bonus.php` called `pc_canonical()` and `pc_flag()` without requiring `pc-identity.php`,
which defines both. Undefined function, PHP 8, fatal `Error`, HTTP 500 with an HTML body. The
browser's `r.json()` threw, `bpost`'s catch reported `{ok:false, reason:'network'}`, and the
screen said "we could not reach the registration system".

**Why it survived three passes of looking directly at it:** the `pc_canonical()` call is the
line immediately below the 401 session gate. An unauthenticated request — every probe — returns
at the gate and never reaches it, so the endpoint answered 401 cleanly and looked healthy.
Only a genuinely verified voter got far enough to hit the fatal.

`pc-otp.php` and `pc-vote.php` call the same function and both worked throughout, which is what
made the frontend look like the suspect. They reach it through `pc-email-otp.php`, **and both
guard the call with `function_exists()` anyway.** `pc-bonus.php` did neither, on a line whose
comment read "as the vote path does".

`pc_flag()` matters as much: it is called on the **success** path
(`pc_flag($voter, 'attendee_auto_matched')`). A voter whose registration actually matched would
have fataled at the moment of success, after the lookup had done its work. Fixing only
`pc_canonical` would have moved the failure later and made it stranger.

**Proved before and after** with a temporary staging-gated probe that loaded `pc-bonus.php`'s
old include line: `missing_with_old_includes: ["pc_canonical", "pc_flag"]`,
`missing_after_fix: []`, lookup runs, `eb_note: "ok:156"`. Probe deleted, confirmed 404.

**The check that would have caught it, and should be re-run after any include change:** for each
entry point in `public/api`, walk its `require __DIR__ . '/...'` closure and confirm every
`pc_*`/`ngs_*` call is defined in that closure or guarded by `function_exists()`. SQL table
names inside `CREATE TABLE pc_votes (` are false positives. Running it now leaves one genuine
hit outside this feature: `resume.php` calls `ngs_resume_path()`, defined nowhere. It is 403 on
both hosts, so latent rather than active.

### Why the diagnostics did not diagnose it

Both were my errors and both are fixed:

- A non-JSON body was reported as `network`. It is almost always a fatal, so the status now
  comes through as `http_500`; a genuinely rejected fetch keeps `network`. The outer `.catch`
  was also missing, so a real network failure left the spinner turning forever.
- The staging diagnostic read `d.eb`, which the server only sends on a **successful** lookup —
  so the line could not describe the one failure it was added for. It reads `d.eb || d.reason`
  now and would have printed `http_500` on the first attempt.

Verified against the deployed build, every failure mode now distinguishable on screen:
`http_500`, `verify_required`, `csrf`, `network`, `ok:156` (list read, address not in it),
`http_401` (Eventbrite rejected us).

### Fault 1: the event ID constant — fixed earlier the same day

This one was real too, and had to be fixed before the second could even be reached.
`NGS_EB_EVENT_ID` was defined in `attendee-count.php`, a standalone endpoint nothing includes,
and used in `pc-attendee.php`, which the bonus path loads instead. Undefined constant, PHP 8,
**fatal Error**, thrown the first time the attendee index tried to build its URL. The request
died with no JSON, the browser's catch produced `{ok:false}`, and the screen said "we couldn't
reach the registration system" — a true description of the symptom and a wrong one of the
cause. Eventbrite was never contacted, which is also why `eventbrite-emails.json` never
appeared.

The evidence fit exactly: `attendee-count.php` kept working throughout, because it is the file
that holds the definition.

The constant now lives in `_lib.php`, which both chains already require, and the duplicate is
gone. **Verified on staging: the index builds, 156 entries, cache written, `attendee-count.php`
still returns 185.** The gap is people holding several tickets — 157 distinct names — not
dropped records, because the map is keyed by hashed email so one address is one entry.

Because this host keeps no error log, which is what made the fault invisible, the builder now
records why it ended as it did: `no_token`, `no_curl`, `http_<status>`, `transport_failed`,
`bad_json`, `ok:<n>`, `ok_nocache:<n>`, `cache_fresh:<n>`. `pc-bonus.php` returns it as `eb`
on the `auto` response, **staging and localhost only**, for both the `unavailable` and
`not_registered` cases — so a genuine "not on the list" can be told apart from a list that was
never read. A short code and nothing else: no token, no address, no attendee.

### Failures now name themselves on staging

`pc-bonus.php` returns an `eb` reason code with the `auto` response on staging and localhost
only, and the dialog prints it under the message: `Staging diagnostic: http_401`, `no_token`,
`ok:156`, `cache_fresh:156`. Production is sent no code and the line stays hidden. This exists
because a fatal error passed for a network outage for days, on a host with no error log.

---

## 0c. Eventbrite token rotation

**The token was exposed in a Claude Code transcript on 2026-10-23** — a `grep` for the
constant name printed the assignment line, value included. It must be rotated. Audit findings:

- **Never in git.** `public/api/config.php` is in `.gitignore`, is untracked, appears in no
  commit, and a `git log -S` for the value across all branches returns nothing.
- **Exactly one file on disk holds it**: `public/api/config.php`, one line.
- **Two readers**, both with the same `defined() ?: getenv('EVENTBRITE_TOKEN')` fallback:
  `attendee-count.php` and `pc-attendee.php`.
- **`release.py` puts `api/config.php` into every archive**, despite it being git-ignored. So
  the local file is the source of truth and deploys carry it to the host.
- **Production uses the same token** and is live: `nextgensummit.us/api/attendee-count.php`
  serves the homepage registration counter and returned 185. Rotating without updating
  production breaks that counter — with roughly a day of grace, since `NGS_EB_KEEP` lets the
  last good count stand in for 86400 seconds.

Rotation order:

1. Create a new private token in Eventbrite. Do not revoke the old one yet.
2. Edit the one line in local `public/api/config.php`.
3. Staging: `python -I tools/release.py staging` then `node tools/deploy.mjs ...`. Confirm
   with `api/attendee-count.php` and a bonus check.
4. **Production: do NOT run a full production deploy for this.** It would replace the web root
   and delete the untracked sponsor logos (section I). Edit `api/config.php` in place through
   Hostinger's File Manager — one line, no deploy, no drift risk. Confirm the live counter
   still returns a count.
5. Only then revoke the old token in Eventbrite.

---

## 0d. The +3 claim, audited against live data (2026-10-23)

The first real bonus claim succeeded. It was audited from the database and the Eventbrite
index rather than from the confirmation screen, with a temporary staging-gated probe that
compared on the server because the comparison needs the site secret. Probe deleted, 404
confirmed.

**The bonus was legitimately earned.**

| Question | Answer |
|---|---|
| Is the proven address a registered attendee? | **yes** — it is a key in the eligible index |
| Is the bound attendee the record that address owns? | **yes** — HMAC match, not an arbitrary key |
| Does the bound attendee exist in the eligible index? | **yes** |
| Two points, to the right founder, on the right day? | **yes** — rows 8 and 9, `entrant-01`, `2026-10-23`, slots 2 and 3, both `06:01:52Z` |
| Binding written before the points? | **yes** — `06:01:47Z`, five seconds earlier |
| Can a code alone earn the bonus? | **no** — see below |

**A code can never be enough.** `pc_email_code_send()` is reached only after `pc_eb_lookup()`
reports `found`, and it stores the attendee key discovered at that moment. `check` binds that
stored key. So no pending code can exist for an address that is not registered, and there is
nothing for a correct code to bind to. Entering a valid code for an unregistered address
fails at `lookup` with `not_found`, before any code is sent.

**The second code should not have been needed.** The voting identity is itself in the index —
the registration is under the very address already proven to vote — so the automatic path
should have matched silently. It did not because it was fataling on the undefined
`pc_canonical` at that moment, so the manual path was the only one that worked. Re-running the
real `pc_eb_lookup_keys()` against that identity now returns found, and the same attendee.

**Eligibility filter, walked live:** 185 attending, 0 cancelled, 0 refunded, 0 without an
address, 156 distinct emails, 4 pages. The 185/156 gap is people holding several tickets.
Note honestly: with no cancelled or refunded records present, that branch is correct by
inspection and **has not been exercised against real data**.

**Leaderboard:** `entrant-01` 4 valid (1 on the 22nd, 3 on the 23rd), `entrant-07` 1 valid,
9 rows total, 4 invalidated, 2 distinct voters, 1 binding, 0 identity links.

### Residual risks — real, and none of them cosmetic

1. **A refund after binding keeps the entitlement.** `claim` re-reads the binding table but
   does not re-check Eventbrite. Someone could register, bind, refund, and still hold the +2.
   The window to Oct 28 is small and no refunds exist today, but it is a genuine gap.
2. **One person with two addresses and two tickets can reach six points a day.** The UNIQUE
   index stops one registration funding two voters. It does not stop one human holding two of
   each. This is the identity limitation stated plainly, with its arithmetic.
3. The cancelled/refunded branch is untested against real data.
4. The Eventbrite token rotation is outstanding (section 0c).

---

## 0e. Interface corrections (2026-10-23)

- The three-point screen said **"+3 points for"** with no name. The founder was written by the
  vote flow, and a returning voter reaches that screen without casting a vote in the session.
  It now comes from the claim response, `d.entrant`, the row the server read.
- It offered **"Get your NextGen ticket"** directly under the line confirming the registration
  that earned the bonus. Reaching that screen requires a verified registration, so the link is
  gone from it, and the two that remain are hidden whenever the server reports a verified
  attendee.
- **`hidden` was not hiding a styled element.** The ticket link reported `hidden=true` and
  rendered anyway: `.btn` sets `display:inline-flex`, an author rule, which beats the
  browser's `[hidden]{display:none}`. The stylesheet compensated component by component, which
  works until someone hides an element nobody wrote a rule for. `[hidden]{display:none
  !important}` is now a base rule. A sweep of the rendered page found exactly one element in
  that state; the phone button, which must stay hidden, was unaffected.

### State matrix, verified against the deployed build

| State | Screen | Ticket offer |
|---|---|---|
| registered, +2 waiting | `bonus-ready` | no |
| registered, all three given | `all-done` | no |
| not registered, +1 cast | "Want to give 2 more points?" | yes (Eventbrite) |
| not registered, allowance spent | `all-done` | yes |
| no proven address (phone voter) | "Which email did you register with?" | secondary |
| registration already used | "Registration already used" | no |
| Eventbrite unreachable | "We couldn't check just now" + `http_500` | no |
| server fatal | same, diagnostic names it | no |
| no vote today yet | `confirm` | no |

---

## 0f. Two screenshots, two voters (2026-10-23)

A voter was shown "get your NextGen ticket" while the diagnostic read `ok:156`, after a `+3`
had succeeded earlier the same day. Those are **two different voting identities**, and each
screen was correct for the voter looking at it.

| | V6 | V7 |
|---|---|---|
| first seen | 02:32:59Z | 06:29:25Z |
| valid votes today | 3 | 1 |
| identity in the attendee index | **yes** | **no** |
| auto check finds a registration | **yes** | **no** |
| attendee binding | **yes** | no |

`ok:156` is the honest answer in both cases: the list was read, and V7's address is not in it.
A genuine non-match, not a matching bug, and "Registered with a different email?" is the
right door for it. Verified per identity with a temporary staging-gated probe that reported
booleans only, no addresses. Probe deleted, 404 confirmed.

**This demonstrated residual risk 2 live.** `entrant-01` now holds **four valid points on one
day** — three from V6, one from V7, one person with two addresses. The daily maximum of three
is enforced **per identity, and an email address is the identity**. The UNIQUE index stops one
registration funding two voters; nothing stops one human holding two addresses. Phone↔email
linking exists (`pc_identity_link`) but only fires when someone verifies both channels in one
session, so two email identities never converge. **This is the single largest integrity
exposure before launch** and leadership should hear it in those terms.

### Contradictions corrected on the post-vote screen

- **"That is your allowance for today. Come back after midnight Eastern to vote again"** sat
  directly above an offer of two more points. A spent allowance at the +1 tier is not a spent
  allowance. It now reads "Your next daily vote unlocks after midnight Eastern" — about the
  regular vote only — and the bonus speaks for itself.
- **Two "Get your NextGen ticket" buttons on one screen.** The generic one in the action row
  is gone; the contextual one inside the bonus block stays, shown only to an unregistered
  voter and pointed straight at the event.
- Heading now names what was counted; the invitation states the opportunity instead of asking
  a question, and no longer repeats itself.

Verified on the deployed build by driving the real vote flow with the network stubbed, so
nothing was recorded: unregistered voter → one ticket CTA, correct heading, non-contradictory
midnight line; registered voter → zero ticket CTAs, "You're registered for NextGen!", "Give
my +2 points".

---

## 0g. The Founder Feed, and the real Top 20 (2026-10-23)

The gallery is now a dark cinematic feed carrying the twenty approved founders. It is a layer
**over** the voting code: every `[data-pc-*]` hook is the one the vote flow already binds to,
`.pce` stays on each card because `labelVoteButton()` asks `closest('.pce')` how to word
itself, and the vote dialog's 15 steps are untouched. Nothing added can cast, count or change
a vote — verified by clicking a live Vote button and watching it call only
`pc-otp.php?action=status` and route to `verify`.

### What the media survey actually found

The source sheet's column labels are not reliable, and a HEAD request lies: Typeform rejects
HEAD with 404 and serves GET with 200. Surveyed properly with ranged GETs and content
sniffing:

| | result |
|---|---|
| Images | **16 of 20** usable. 2 are PDFs (PathBridge, K8Culture), 1 missing (Credible blossom), 1 URL 404s (The Luminous Lab) |
| Playable pitches | **16 of 20** — 11 direct mp4/mov, 3 YouTube, 2 public Google Drive |
| Recovered | 2 YouTube ids were encoded in a PDF's **filename**; 1 was inside a `.docx` |
| No playable pitch | Credible blossom (image), Rest, PathBridge, K8Culture (PDF decks) |

Those four get an editorial story card naming the business — not a broken player and not a
fake one. `tools/build-founders.py` re-runs the whole survey and prints the issue list.

**A performance flag:** the direct videos are hot-linked from Typeform and at least one is
3840×2160. They are not transcoded or self-hosted. Before real traffic they should be, or a
phone on mobile data will struggle.

### The contestant mapping is NOT decided

`tools/founder-map.json`, `reviewed: false`. While false the page shows a staging strip saying
the assignment is provisional. Vote rows reference `entrant-NN` and nothing else, so changing
that file changes a name on a card and **moves no vote**. Under the current proposal
`entrant-01` is Haptol Labs and `entrant-07` is BeforeKeys LLC — both inheriting staging test
votes. The file records those counts where a reviewer will see them.

---

## 0h. The identity exposure, now demonstrated at scale

By the end of 2026-10-23, `entrant-01` held **8 valid points in a single day** from **four
distinct email identities** (3 + 1 + 3 + 1), and `pc_attendee` held **two** bindings. One
person, four addresses. The daily maximum of three is enforced **per identity, and an email
address is the identity.**

The UNIQUE index does its job: no registration funded two voters. It was never designed to
stop one human holding several addresses, and it does not.

This is no longer a theoretical residual risk — it is the observed behaviour of the system
under a few minutes of ordinary testing. **It is the single thing most likely to decide the
competition incorrectly**, and it needs a decision before voting opens to the public:

1. Add a second factor per vote — device or IP clustering alongside identity — accepting the
   false positives that brings on shared networks.
2. Require a verified NextGen registration to vote at all, not merely for the bonus.
3. Accept it, publish the rule honestly, and have the dashboard flag same-day multi-identity
   clusters for human review before a winner is certified.

Option 3 preserves the current design and is the cheapest; it also means the published total
is not a count of people. Whichever is chosen, the result should not be described as "one
person, one vote" unless option 1 or 2 is implemented.

---

## 0i. Media retrieval and the presentation pass (2026-10-23)

`tools/fetch-top20-media.py` downloads, verifies, organises and archives every submission to
`~/Downloads/NextGen_Top20_Media`. Local only: no upload, no site change, no Sheet edit, no
credential handling. It reads the public manifest rather than re-reading the Sheet, because
the manifest already carries the resolved hyperlink targets and omits the applicants' email
and phone columns by construction — so no private field can reach a filename, a ZIP or the
report. Re-run it any time; validated files are kept and not fetched again.

**Result: 532 MB, 20 folders, 21 verified ZIPs, `download_report.csv`, `download_summary.txt`.**

| | |
|---|---|
| Images downloaded and read | 17 |
| Playable videos verified | 13 direct files |
| Supporting documents | 8 |
| Images missing | 2 (Credible blossom none submitted; The Luminous Lab URL 404s) |

**Two pitches were recovered by reading inside the PDFs**, which a scan of filenames alone
never sees: Rest and K8Culture Productions both put a working YouTube link in the document
body. With those, **18 of 20 founders have a playable pitch** (11 direct files, 5 YouTube,
2 Google Drive). The two without are Credible blossom, who submitted a photograph where a
video was expected, and PathBridge, whose PDFs point at Drive *folders* a human must open.

Validation is real, not assumed: content sniffing by magic bytes rather than by column label
or extension, HTML login/error pages rejected, images opened and verified with PIL, and MP4
duration and pixel size read from the container's `mvhd`/`tkhd` atoms — **ffprobe and ffmpeg
are not installed on this machine**, so codec inspection, any re-encoding and poster-frame
generation remain outstanding.

### Presentation

- **Focal points.** A 4:3 card centred at 50% 50% takes the top off a tall headshot. Each
  image now carries its own `object-position`, derived from its shape (22% down for tall
  portraits, 35% square, 45% landscape), overridable per founder under `"focal"` in
  `tools/founder-map.json`. Cards, story bubbles, the viewer avatar and the profile portrait
  all read the same value.
- **Logos are not cropped like people.** `contain`, on a rounded plate inside the dark card.
- **One player, three shapes.** The story stage holds a steady 9:16; the player is pinned to
  that box and `object-fit: contain` letterboxes it, with the founder's photograph blurred
  behind to fill the rest. Verified at 3840×2160 landscape, 1080×1920 and 480×854 portrait,
  and YouTube: **every one renders 460×662 inside a 460×662 stage.** The profile dialog uses
  the same principle at 16:9.
- Two sizing bugs were found and fixed by measuring, not by eye: intrinsic sizing let a
  portrait pitch overflow 818px into a 662px stage, and a centred grid item's `height:100%`
  had nothing definite to resolve against.
- **The staging note is removed from the page.** The mapping it warned about is still
  unreviewed; `founder-map.json` keeps `reviewed:false` and records which founder inherits
  which staging test votes.

### Still outstanding

Videos are hot-linked from Typeform and not transcoded — at least one is 4K. Install ffmpeg
to produce web-ready H.264/AAC copies and poster frames, then self-host them; until then a
paused pitch shows black rather than a thumbnail, and a phone on mobile data will struggle.

---

## 0j. Media inventory and deployment (2026-10-23)

### Mapping: reviewed and confirmed

`tools/founder-map.json` now carries `reviewed: true`. The audit found the manifest, the map
and the database agreeing: twenty unique ids, no duplicates, no vote row on an id no founder
holds, no name or slug drift, no image filename mismatched to its founder. **What it cannot
establish is whether a photograph actually depicts the founder named beside it, or whether a
pitch is that founder speaking.** Those are editorial checks, not machine ones.

On approval, the ten staging test votes on `entrant-01` and `entrant-07` were set to
`valid = 0`. **All 14 rows remain** - nothing deleted, each carrying a note explaining why it
was set aside, and the dashboard's invalidate control restores any of them. A dated backup was
uploaded beside the live database first, and the result read back from the server. Real
founders now start at zero.

### Video: self-hosted

| | |
|---|---|
| Playable pitches | **18 of 20** |
| Self-hosted on our server | **13** |
| YouTube embeds (not ours to download) | 5 |
| No pitch at all | 2 - Credible blossom, PathBridge |
| Total size | **149.4 MB to 86.6 MB, 42% smaller** |
| Poster frames | 13, taken 15% in |

Every source was **already** H.264/AAC, so nothing had to be converted to play at all. What
justified a pass was delivery size against the ~460px the player actually draws. A first run
made three files *larger* - they were already efficiently encoded, and CRF alone will spend
more bits than the source did - so `tools/optimize-pitch-videos.py` now carries a bitrate cap
and **a guard that discards any re-encode bigger than its source**, falling back to a lossless
container copy. Six re-encoded, two remuxed from `.mov`, five copied untouched. Nothing
upscaled, no aspect ratio altered. The worst offender was a 720p pitch carrying 9.56 Mbps:
71.1 MB to 14.2 MB on its own.

**Serving:** `/assets/video/<slug>.mp4` and `<slug>-poster.jpg`, confirmed on staging as
`206 Partial Content`, `video/mp4`, byte-range enabled, seven-day cache.

**The deploy constraint, which matters:** a Hostinger deploy replaces the web root, so
anything not in the archive is removed. The videos therefore live in the repository and ship
in the release zip, which is now **117.5 MB**, about twelve upload chunks. That is the price
of self-hosting under this deploy model; uploading videos separately does not survive the
next deploy.

### Player

Posters before playback; autoplay only where a play control was pressed (`autoplay=0` on
embeds opened from a story); one video at a time, enforced in the capture phase; playback
stops on *any* close path. The last one needed a MutationObserver on the dialog's `open`
attribute, because in this Chromium build a programmatic `.close()` fires neither `close` nor
`cancel`. The X button and Escape were always fine, but the gap was real.

Verified on the deployed build: landscape 1280x720 and portrait 1080x1920 both fit the stage
exactly (375x666 inside 375x666 on a 375px phone), posters present, paused before play, plays
on demand, no page overflow, no console errors, all 20 vote buttons wired to their own id.

### Local media

`~/Downloads/NextGen_Top20_Media` - 790 MB: 20 contestant folders with source files,
`optimized/pitch.mp4`, `optimized/poster.jpg` and `info.json`; 20 per-contestant ZIPs;
`NextGen_Top20_Media_ALL.zip` (262.8 MB, verified); `download_report.csv`;
`media_manifest.csv`. Re-runnable: validated files are kept, not re-fetched.

### Still outstanding

- **Credible blossom** submitted a photograph where a video was expected, and no image at all.
- **PathBridge** submitted PDFs pointing at Google Drive *folders* a human must open.
- **The Luminous Lab**'s image URL returns 404; the card shows a monogram.
- A smaller mobile rendition is possible but not built; the single tier is sized for the
  460px player.

---

## 0k. Leadership feedback pass (2026-10-23)

### Media recovered: 19 of 20 pitches now play

| Founder | Outcome |
|---|---|
| **Credible blossom** / Annrita Karu | **Recovered.** The forwarded YouTube Short is hers - confirmed by the video's own title, "Elevator pitch for credible blossom", not by who sent it |
| **PathBridge** / Benedicta Dankwa | **Recovered 2026-10-23.** A direct file link succeeded where the folders failed. The folders in her PDFs genuinely required sign-in; the single file is public, and the only obstacle was Google's large-file interstitial - a confirmation form whose parameters sit in hidden inputs, not a permission wall. Source was **HEVC 4K, 344.5 MB for 60 seconds**; transcoded to H.264 720p, **14.0 MB**. Her card portrait is a frame from the same pitch, labelled as such, since her image submission is a PDF |
| **The Luminous Lab** / Ariel Laura Métayer | **Image recovered** from a frame of her own pitch, recorded in the data as `shotFrom` so nobody mistakes it for a submitted headshot |

**All 20 founders now have a playable pitch.** Images 18 of 20 - only Credible blossom and
K8Culture Productions still show a monogram, and K8Culture's pitch is on YouTube so there is
no local frame to borrow for them.

Media library after Benedicta's: **493.9 MB of originals to 100.6 MB served, 80% smaller.**
Her file alone accounts for 330.6 MB of that saving.

### Poster frames: the real cause of the framing complaints

It was never CSS, aspect ratio or player positioning - those were measured correct. The first
version took a frame **15% into every video**, which is a guess, and on these pitches it
guessed badly. `tools/pick-posters.py` now samples candidates across each pitch and scores
them on detail, edge energy, exposure and a centre bias, with ffmpeg's own `thumbnail` filter
offered as an extra candidate.

- **Melavyr, BeforeKeys, The Luminous Lab** - transformed. Each opens on the founder's face
  instead of a wall, ceiling lights, or a dark frame.
- **Exam.Me** - better, and still limited. Her footage places her small in the lower third
  under a large expanse of wall. **No choice of frame fixes the composition of a recording**,
  and a flattering thumbnail would be a claim about the footage that is not true.

A subject-aware crop tightens a poster when the person is small in frame. It finds people by
**skin tone, not edges** - an edge detector was tried first and was beaten by exactly what it
needed to ignore, since a suspended ceiling is a grid of hard lines that outscores the speaker
beneath it. **Posters only; the video is never cropped.**

### Profile content

"The founder" and "The project" were printing the same paragraph - my doing, from assigning
the same blurb to both fields. The submissions describe the **business** and say nothing about
the person, so the founder block is now hidden until leadership supplies copy, rather than
padded with a duplicate. No biography was invented.

**The Luminous Lab / Kainema is not a mapping error.** Row 5 of the sheet carries business
name "The Luminous Lab" and an about-text that begins "Kainema is...". Both came from the same
submission. It is the founder's own copy naming a different product, and it needs an editorial
decision, not a code fix.

### Copy applied

Intro line; one "Verify & vote" in the opening popup (the three-panel chooser read as a third
voting option beside the +1 and +2); the email step; celebratory +1 and +3 headings; the +3
body. The unregistered bonus area is **one offer again** - a single ticket CTA with the
"already have a ticket" route demoted to a quiet text link. Dropping the big Check Again
button loses nothing: the server forces a fresh attendee index whenever a lookup misses, so
verifying an address **is** the recheck.

---

## 0l. Navigation and the Reels pass (2026-10-23)

### Navigation

People's Choice is now in the utility bar on seven pages and the menu drawer on all eight.
On the page itself the bar marks it as current and restores Pitch Competition as the link
back up. Before this the only way in was a link inside the Pitch Competition page or the URL.

### The feed

One panel per founder, snapped against the **page** rather than a scroller of its own, with
`proximity` not `mandatory`. That is the whole difference between a feed and a trap: a nested
scroller holds the visitor until it runs out, and proximity means a deliberate flick carries
straight through into the rest of the page. Panels sit a little under the viewport so the
next shows at the edge.

Footage is never cropped to fit. Video is contained; the founder's own poster sits blurred
behind. Only the panel holding the viewport centre plays, muted; only its neighbours are
given a `src` at all, and panels well out of reach release theirs.

The bubbles are now shortcuts **into** the feed rather than a second way to browse the same
twenty founders, and a shared link lands on that founder in the feed before opening their
profile.

### Four bugs found here, in order, each hiding the next

1. **IntersectionObserver delivers nothing** for a page that is not frontmost. A freshly
   created observer saw nothing either, so it was the API and not the wiring.
2. **Scroll events never reach `window`** — `site.css` sets `overflow-x` on the body, which
   makes the body the scrolling box. Measured: the page moved 13,448px, the handler ran zero
   times. Scroll does not bubble but it does capture.
3. **A pending `requestAnimationFrame` locked the feed shut.** `reelQueue` refused a new
   check while one was pending, and rAF does not run for an occluded page, so the first call
   latched a handle that never resolved and every later request returned immediately. **This
   one is a real user-facing bug, not a test artefact**: anyone changing tab mid-feed would
   return to a reel that had silently stopped. Cancel the outstanding frame rather than
   refusing the new one.
4. **`labelVoteButton` wiped the reel's vote icon**, dropping "Vote for this pitch" across a
   founder's face, because it writes with `textContent` and the rail reuses the same hook.
   The rail has its own labeller now, same server state, said in the space it has.

A quarter-second heartbeat calls the work directly so activation never depends on an event
arriving. Twenty rectangles four times a second, stopped while the tab is hidden.

**Verified on staging:** one video at a time (`melavyr.mp4` then `light.mp4`, never both),
lazy loading at 2 of 14, silence at the end card and on leaving the feed, sound toggle,
reaction sheet, the back chip, and the icon rail intact.

### Reactions are a prototype and say so on screen

Public comments need moderation, reporting, rate limiting and an answer for impersonation
before one is shown to a stranger. None exists, so nothing is published, sent or counted: a
reaction is kept in that browser alone and the panel states it in a yellow note. Production
would need a store, a moderation queue, per-IP rate limits, a report route and a display-name
policy. **Not built, deliberately.**

### What this environment could not verify

Smooth `scrollIntoView` and CSS opacity transitions both depend on the compositor, which is
frozen for an occluded pane, so the bubble-to-feed *animation* and the back chip's fade could
not be exercised here. The underlying state was verified directly instead: the chip's rule
applies (`pointer-events` from it takes effect) and jumps land correctly with instant
scrolling. A real browser runs both.

---

## 0m. Vote-ordered reels, the reaction sheet, and launch readiness (2026-10-23)

### Ranking

`public/api/pc-rank.php` orders the feed by valid points, leader first, counting +1s and
attendee +2s alike and excluding invalidated and simulated rows. It publishes the **order**
and withholds the **totals** -- ordering already discloses relative standing, and returning
counts would hand the whole leaderboard to anyone opening developer tools.

Ties share a rank and the next rank skips. Within a tie: contestant id ascending -- arbitrary,
but stable, documented and identical for every visitor. The order is fetched **once per page
load**; re-sorting mid-watch would move a founder out from under someone because a stranger
voted.

**Right now `ranked` is false and no medals render, because every founder has zero valid
points** after the approved invalidation. "1st - currently leading" over a field of zeroes
would be a plain lie. Verified with a stubbed standing: the feed reorders, medals appear on
the top three only, all 20 remain, vote buttons stay bound to their own founder.

**This needs an explicit decision.** Ordering the feed by votes *publishes the leaderboard
implicitly* and reverses the earlier deliberate choice that totals and ranks stay private
while voting is open. It can also drive bandwagon voting. Leadership asked for it; they
should know they are reversing that.

### The reaction sheet

Rebuilt as a bottom sheet with six ways out, all verified: X button, scrim tap, grip, Escape,
Done button, swipe down past 90px. Scroll position preserved in every case and the reel keeps
playing underneath. Still device-only, stated in one line rather than a warning block.

### Public staging strings removed

`Staging diagnostic: http_500` no longer reaches the page (the code rides on a data attribute
for support); the tutorial panel no longer says "Staging placeholder"; dead code for the
removed provisional strip is gone. Everything still matching /staging/i is a source comment.

---

## 0n. Launch readiness

**BLOCKING**

1. **Eventbrite token not rotated.** I exposed it in a transcript on 2026-10-23. Rotation plan
   is in section 0c; production shares the token and serves the live homepage counter.
2. **Production deploy would delete untracked sponsor assets.** `zation.png`, `simms-media.png`
   exist on the live server and in no commit; a deploy replaces the web root.
3. **People's Choice is not on production at all** - the page and API 404 there. Going live is
   a first deploy of the whole subsystem: data directory, config files and database included.
4. **Identity amplification.** One person with several email addresses gets a full allowance
   each. Demonstrated: four identities put 8 points on one founder in a day. Needs a decision,
   not a code fix (options in section 0h).
5. **Ranked feed sign-off** - see above.

**NON-BLOCKING**

- Headshots missing for Credible blossom and K8Culture Productions (monograms shown).
- No founder biographies, so "The founder" stays hidden.
- The Luminous Lab / Kainema naming.
- A refund after binding keeps the +2 entitlement.

**NOT BUILT from the master brief**, and not claimed: the cinematic photo intro, the
three-deck ending, true full-viewport reels, and the speaker-card flip on the expanded
profile. The feed is panel-based, not edge-to-edge.

---

## 0o. The launch pass (2026-10-23, later)

Launch mechanics, the blockers and the deployment sequence now live in their own
document: **`docs/handoffs/peoples-choice-launch-plan.md`**. Read that before any
production work. What follows is only what changed in the product.

### The experience

- **Immersive mode.** The feed becomes a fixed full-viewport scroller when a visitor
  asks for it: one founder per screen, mandatory snapping, `scroll-snap-stop: always`
  so one swipe moves one founder. The in-page feed underneath is unchanged -- nobody is
  dropped into a scroller they did not choose, which was the original objection and
  still is. Out: the exit button, Escape, and the browser's Back button, which is a
  pushed history entry rather than a trick.
- **Meet the Founders** is a door now, not a scroll cue. The bubbles fly in from
  alternating sides, staggered, once, and latch -- the brief was explicit that drifting
  up and down the page must not set them flying again.
- **The introduction.** Four scenes built at runtime from the founders' own submitted
  images and frames of their own pitches. No stock photography, no invented event
  picture. Around six seconds, skippable from the first frame, once a session, and a
  single held frame under reduced motion. Choosing a founder never replays it.
- **The founder card** is the speaker card from the main microsite, carrying founders:
  the same morph out of whatever was tapped, the same turn, the same way out. The turn
  control is the only thing that flips it, so reaching for Vote cannot spin the card
  away. Watch the pitch returns to the feed rather than opening a second player, so
  there is exactly one place a pitch can be playing.
- **The ending** is twenty cards sweeping into three decks of 6/6/8, cut from the same
  order the feed runs in. Every founder appears exactly once -- asserted in the code,
  not assumed. Open a deck, pick anyone, and their pitch plays.
- Tap to hold, a spinner only when the footage actually makes someone wait, a progress
  bar, and a one-time swipe hint.

### Found by measuring, and fixed

1. **The founder card could not be closed** when the page was not being composited: the
   close waited on an animation's `onfinish`, and animations do not finish for a page
   that is hidden or throttled. A card whose only exit depends on an animation is a card
   that can trap someone. There is a hard backstop now.
2. **Three entrances hid their own content.** The deck, the opened deck and the
   introduction all start at `opacity: 0` and are carried to 1 by a keyframe animation
   with `fill-mode: both`. When the animation does not run, the content stays at the
   first frame forever. Measured: the deck arrived with its title, its labels and all
   twenty cards invisible and only the two buttons showing. Each has a backstop now --
   and the backstop had to out-rank the animation's own selector, because a stalled
   animation beats a plain declaration. The introduction showed its kicker and swallowed
   its title for exactly that reason, which is how the pattern was caught twice.
3. **The deck ran to 1174px in an 812px panel** on a phone, putting the title above the
   screen and both buttons below it. Three stacks side by side now, smaller.
4. **The swipe hint landed on the founder's own name.**
5. **`fromManifest` copied the business blurb into the biography**, so "The founder" and
   "The project" printed the same paragraph. That was the duplication the previous pass
   thought it had fixed in `paintProfile`; the data was overwriting it upstream. The
   biography is now only ever the manifest's own, and the manifest has none for any of
   the twenty, so the block stays shut.
6. **Two founders got a broken-image icon.** Credible blossom and K8Culture submitted no
   portrait and their pitches are embeds, so there is no frame of their own to borrow;
   the panel asked for `<img src="">`, which a browser resolves to the page itself. They
   get their initials on a plate.
7. **A tablet was being treated as a big phone** -- the caption ran 685px across at
   768 wide. The centred stage starts at 700px now, not 900.
8. **The build can no longer ship changed assets under an unchanged cache stamp.** I made
   that mistake during this pass and spent a round trip finding it: a breakpoint change
   that was demonstrably on the server would not apply in the browser. `release.py` now
   hashes `public/assets`, keeps the hash beside the stamp, and refuses the build if the
   hash moved and the stamp did not. Proven by test.

### Tested, and what was not

Twenty-one steps of the founder journey were exercised against the deployed staging
build, not against a local copy: the bubbles, the introduction and skipping it,
full-screen entry, swiping, playback and sound, the reaction sheet opening and closing
six ways, founder-specific sharing, the card and its turn, returning to the same reel at
the same scroll position, the deck arriving, all three decks opening, picking a founder
and landing on them, and leaving. Layout was measured at 360x740, 375x812, 768x1024 and
1440x900 -- no horizontal scroll, no overlap, the deck fits at every one.

The vote path was opened and closed but **nothing was cast and no code was sent**.
Endpoint gates were probed unauthenticated instead: `pc-vote.php` and `pc-bonus.php`
both answer `401 verify_required`, and the standings were identical before and after.

**Not verified here:** the animations themselves. This pane freezes the compositor, so
smooth scrolling, the card's rotation and the scene transitions could not be watched --
their DOM state was checked instead, and the backstops above exist precisely because of
it. Real iPhone Safari and real Android Chrome have not been used; the sizes above are
emulated. A real device pass before launch is worth the hour.

---

## 0p. Leadership, 2026-10-23 evening

Three asks from the Next Gen Website Devs thread, all applied and on staging.

### The corner badge now carries a position, not a contestant number

Leadership circled the `01` badge and asked what its utility was. It had none -- a
visitor has no use for "entrant 01". It carries the founder's **position** now:

| standing | reel panel | founder card |
|---|---|---|
| 1st, 2nd, 3rd | the gold / silver / bronze medal, as before | `Position - 1st` |
| 4th and below | a plain badge: `4th`, `11th`, `20th` | `Position - 4th` |
| no standings yet | **nothing at all** | `Contestant - 02` |
| tied | both founders show the same ordinal | same |

The top three never show both a medal and a badge. Ordinals handle the teens.

**While every founder is on zero the reel badge does not render.** That is the point:
a position nobody has earned is not a position. The card keeps its contestant number in
that state because there it carries a label and identifies a founder in a field of
twenty -- it is not the bare, unexplained badge that was queried. Say the word and it
goes too.

Verified against the **deployed** script, not a reimplementation: the shipped `ordinal`
and `reelPanelHtml` were lifted out of the file served by staging and run over ranks 1
to 20 with a tie on sixth. Correct at every one.

### React is gone

> "Please remove the REACT feature. Over complication."

Removed: the rail button, the bottom sheet, **both** stylesheet blocks -- the rebuilt
one and the original that had been superseded but never deleted -- the per-device store,
the open/close/swipe/Escape handlers, and the speech-bubble icon. Nothing anywhere
references it; the rail is Vote, Share, Sound.

It was never public: nothing was posted, counted or sent, and the sheet said so. That
honesty was the problem -- a control that saves a thought to one browser and shows it to
nobody is a button that explains itself and then does nothing, standing beside two that
do exactly what they say. It is in git if it ever comes back with a real store, a
moderation queue and a report route behind it.

### The hero line is leadership's wording

"One verified vote a day — NextGen **ticket holders get 2 extra**", in place of "NextGen
attendees give three".

### Credible Blossom has artwork

The brand sheet carries a reversed lockup on their teal; that crop is the card now.
`tools/build-founders.py` treats a supplied `<slug>.logo.<ext>` as a wordmark rather
than a face, because covering it to fill a 5:7 card cut the company name off at both
ends. **Images: 19 of 20. Only K8Culture Productions is still without one** -- their
submission is a PDF and their pitch is on YouTube, so there is no frame of their own to
borrow either.

---

## 0b. What is still unproven

**The +2 Eventbrite bonus has still never completed, end to end.** `pc_attendee` holds zero
bindings. The two faults that stopped it are fixed and the pieces are verified individually —
the index builds, the routing reaches the automatic check, all six outcomes render — but no
real voter has yet travelled the whole path and claimed two points. Until one has, treat the
bonus as unproven rather than working.

What remains untested is the join between the parts: whether a verified voter's stored email
hash actually matches an entry in the index, and whether `claim` writes the two rows. That
needs a verified session, so it needs the user.

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

### The returning voter was sent to a form — fixed 2026-10-23

Reopening the bonus after voting earlier showed a field asking for an email address and a
**Send my code** button, for an inbox already proven. The automatic check was real but
unreachable from that screen: the `voted-bonus` step's button ran `step('bonus-email')`, and
`paintBonus()` — the automatic check — only ran on the screen shown straight after a vote.

The check now starts the moment that step opens. The form survives only behind **Registered
with a different email?**, the one case where ownership of *that* address has not been proven.

Two further defects found in the same code, both real and both shipped for some time:

- `bonusText()` had `return` alone on a line above its ternary. Automatic semicolon insertion
  made it `return;`, so **every bonus error rendered the word "undefined"**. Any failure on
  this path was silent. If a future edit touches that function, keep the expression on the
  same line as the `return`.
- `paintBonus()` and `bonusErr()` used `$()`. With the result blocks now on two screens only
  the first was painted. Both walk every instance.

Also fixed: the +1 row said "Phone vote" to everyone including email voters, and the server's
`no_email` status (a voter with no proven address, so nothing to search with) was being shown
as "not registered" — the same error as reporting an outage as a failed lookup.

Verified against the deployed build, all six outcomes, zero email inputs on each: registered,
not registered, no address on file, Eventbrite unreachable, registration already used, all
three points given.

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

## G2. Baseline immediately before the +2 test (2026-10-23)

Recorded so the bonus test can be judged against something exact rather than remembered.

| | before | expected after a successful claim |
|---|---|---|
| `entrant-01` valid votes | 2 (one 2026-10-22, one 2026-10-23) | 4 |
| `entrant-01` valid *today* | 1 | 3 |
| `entrant-07` valid votes | 1 | 1, unchanged |
| rows total / invalidated | 7 / 4 | 9 / 4 |
| distinct voters | 2 | 2 |
| `pc_attendee` bindings | 0 | 1 |
| `pc_flag` rows | 1 (`email_verified`) | 2 (`+ attendee_auto_matched`) |
| `eventbrite-emails.json` | 8293 bytes, 156 entries | unchanged or refreshed |

A second claim must add no rows: `remaining` is 0 afterwards, so `claim` returns `spent`, and
the UNIQUE index on the attendee key blocks a second binding regardless.

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
