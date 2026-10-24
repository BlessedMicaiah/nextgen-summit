# Production deployment — the plan, and the one thing blocking it

Written 2026-10-23 evening, against `monday-launch @ 5ae6192`. **Nothing has been
deployed to production.** Production is `nextgensummit.us`; People's Choice is not on it.

---

## The finding that changes the plan

**Production is not deployed from this repository.**

That was a suspicion this afternoon. It is now measured. At 15:57 I took a byte-for-byte
copy of what production served. Re-reading the same URLs this evening, three pages had
changed:

```
/          site.css?v=20261021-10  ->  site.css?v=20261023-50
/about/    site.js?v=20261021-10   ->  site.js?v=20261023-50
/pitch/    (same pair)
```

Somebody deployed to the live site today. In the same window `origin/main` did not move
— it is still `01f0112`, exactly where it was. And the deploy did **not** reconcile
anything: measured again just now, production still carries **442 lines** that
`origin/main` does not have, and `assets/css/film.css` and `assets/js/film.js` are still
live, still in no branch and no commit.

So there is a second working copy somewhere that is the real source of the live site,
and it is in active use. Everything below follows from that.

**A deploy from this repository today would revert both the 442 lines and whatever
changed this afternoon.** Not "might" — the Hostinger deploy replaces the web root.

Current copy of production: `backups/production-2026-10-23-evening/`, nine files, each
with its sha256 in `manifest.json`. The afternoon copy is kept beside it.

---

## Blockers, in the order they have to clear

### B1 — Reconcile the two sources *(owner's call, and it is the gate)*

Find who deployed today and from where. Then one of:

1. **Bring that working copy into git** (recommended). Commit the film feature, the
   six-logo marquee and the pitch-page changes on `monday-launch`, verify the three
   pages render identically to the evening backup, and deploy once from a single source.
   Half a day, and it ends the divergence permanently.
2. **Have them deploy People's Choice** from their copy, taking the subsystem from here.
   Works, but the two sources stay split and this happens again.
3. **Accept the loss** — only with explicit confirmation that the film section and the
   two sponsors are meant to go.

Until this clears, nothing else below can be safely run.

### B2 — Eventbrite token rotation: **status unknown from here, and I cannot establish it**

I exposed the token in a transcript this morning. Whether it has been rotated cannot be
determined from outside: the only honest test is whether a *new* token works, and the
value lives in `config.php` on the server, which is correctly out of reach.

**It must be treated as unrotated.** The procedure is in the launch plan §B2 — new token
in staging config, verify, then production, verify, and only then revoke the old one.

### B3 — Production would run the wrong voting rule

`PC_MODE_DEFAULT` is `'single'`, and `pc_mode()` reads `pc_meta('mode', PC_MODE_DEFAULT)`.
On a fresh production database that key does not exist, so **production would open in
single-vote mode: one vote per person for the entire competition, no daily reset and no
attendee bonus.**

This is not a bug — it is the approved default, and a deploy deliberately cannot change
the rules of a live competition. But it means **an administrator must set the mode to
`daily` on the dashboard immediately after the first deploy**, before announcing voting.
Verify by loading `/api/pc-otp.php?action=status` and confirming `"mode":"daily"`.

### B4 — Identity amplification *(policy, not code)*

Email verification proves control of an inbox, not that two inboxes are two people.
Demonstrated earlier: four identities put eight points on one founder in a day, entirely
within the rules.

Recommendation, unchanged: **leave the rule as it stands for the remaining five days**
and say plainly on the page what verification does and does not prove. Changing
eligibility with votes already cast is worse than the exposure. The alternatives and
their costs are in the launch plan §B4.

Do not claim anywhere that this guarantees one vote per human.

---

## Verified, and not blocking

| | |
|---|---|
| Public points and rankings | **on**, as asked. `by_votes: true` |
| Founder search | filters the rail, Enter opens the first match, accent-folding, clear restores order |
| Desktop rail arrows | fine-pointer only, with an instant fallback when smooth scrolling does not run |
| Video presentation | framed rather than dimmed; highlight trim too small to change a face |
| Contestant numbers | gone from markup and stylesheet, not hidden |
| Duplicate gallery | removed; page 19,977px → 4,501px on a phone |
| Sponsor logos | now in the repository, so a deploy preserves them |
| Vote endpoints | `401 verify_required` unauthenticated; totals unchanged by probing |
| Staging data directory | not reachable over HTTP |

---

## The deployment, once B1 clears

Nothing here runs without explicit go-live authorisation.

1. Reconcile B1 and merge to `monday-launch`. Confirm `/`, `/about/` and `/pitch/`
   render identically to `backups/production-2026-10-23-evening/`.
2. Clear B2 through "new token proven on both hosts, old one still alive".
3. Decide B4. Confirm B5 (points public) is still wanted.
4. Push, merge `monday-launch` → `main`, push. `release.py` refuses to build unless the
   branch is checked out, clean and identical to GitHub, and now also refuses if the
   assets changed without the cache stamp moving.
5. **Re-take the production backup immediately before deploying** — today proved it goes
   stale in hours.
6. Back up the production data directory if one exists.
7. Put these on the production server, outside the web root, in `nextgen-data/`:
   `config.php` (site secret + the **new** Eventbrite token), `config.twilio.php` left in
   MOCK, `config.smtp.php`, `config.admin.php`. None are in the archive; all four must be
   placed by hand.
8. `python -I tools/release.py production` then
   `node tools/deploy.mjs nextgensummit.us release/nextgensummit.us-<sha>.zip`
9. **Set the voting mode to `daily` on the dashboard.** (B3 — easy to forget, changes the
   rules if missed.)
10. Run the smoke list below.
11. Complete B2: revoke the old Eventbrite token, re-verify both hosts.

### Smoke list, against the live host

```
/                                   200, film section present, six sponsor logos
/about/                             200, six sponsor logos
/pitch/                             200
/pitch/peoples-choice/              200
/api/pc-rank.php                    200, ok:true
/api/pc-otp.php?action=status       200, "mode":"daily", "state" as intended
POST /api/pc-vote.php  (no session) 401 verify_required
POST /api/pc-bonus.php (no session) 401 verify_required
/nextgen-data/                      NOT 200
```

Then by hand: one reel plays; the vote dialog opens on Verify & vote; one real vote end
to end; the +2 claim from a registered attendee lands on the same founder; the dashboard
shows both.

---

## Rolling back

- **The site:** rebuild from the previous `main` commit and deploy that. A rollback is
  just the previous release — *provided B1 cleared first*, otherwise rolling back
  reintroduces the same loss.
- **If the deploy damages live content:** restore from
  `backups/production-2026-10-23-evening/` — three HTML pages and six assets, each with
  its sha256.
- **The ranked feed / public points:** dashboard toggle. No deploy.
- **The voting mode:** dashboard. No deploy.
- **Votes:** never deleted. Invalidation sets `valid = 0`, keeps the row and its note,
  and the dashboard restores it. Take a dated copy of the database beside itself before
  any bulk change.
- **The Eventbrite token:** keep the previous value until the new one is proven on both
  hosts.

---

## Still outstanding, not blocking launch

- No company logo for ApplyTrack, Jay's Watermelonade, Melavyr, Offguardz, PathBridge,
  Rest, The Luminous Lab or iBraid. Their card backs show the founder's photograph.
- No founder biographies, so "The founder" stays shut on every card.
- The Luminous Lab's own copy begins "Kainema is…".
- Real iPhone Safari and Android Chrome have not been used; sizes were emulated.
