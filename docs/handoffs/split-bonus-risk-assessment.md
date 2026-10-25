# Letting attendees split their three daily points — risk assessment

Written 2026-10-24, against live production. **Investigation only: nothing was changed, no
vote was cast, no record was read that contains personal data, and no SMS was sent.**

**Recommendation: DEFER UNTIL AFTER OCTOBER 28.** Not because the change is dangerous —
it is markedly safer than it looks — but because the benefit is small, the work is in the
riskiest part of the UI, and staging cannot validate it.

---

## 1. The finding that changes the question

**The data model already supports split votes. There is nothing to migrate.**

The brief anticipates "mixing old weighted bonus records with new individual vote records".
That risk does not exist, because **there is no such thing as a weighted bonus record.**
Every point is, and always has been, one row:

```sql
pc_votes (competition, voter_key, vote_day, slot, entrant_id, created_at, valid, simulated, …)
CREATE UNIQUE INDEX pc_votes_one ON pc_votes (competition, voter_key, vote_day, slot)
```

Three things follow, and they are the whole assessment:

| | |
|---|---|
| **entrant_id is not in the unique index** | Three rows for one voter on one day, each naming a *different* founder, already fit. The database would accept split votes today. |
| **The tally is `COUNT(*) GROUP BY entrant_id`** | No weighting, no bonus concept. Three rows on three founders already count as one point each. ([pc-lib.php:292](../../public/api/pc-lib.php), [pc-rank.php:66](../../public/api/pc-rank.php)) |
| **`pc_cast()` is already founder-agnostic** | It takes `$entrantId` as a parameter and the slot loop simply finds the next free slot. Nothing in the storage layer ties the bonus to a founder. |

The "+2 goes to the same founder" rule exists in **two lines**, in the claim handler:

```php
$entrant = pcb_today_entrant($voter);          // the founder today's +1 went to
…
$r = pc_cast($voter, $entrant, false, true);   // twice
```

That is the entire backend scope of the change.

### Two safety properties that fall out of this for free

**Nobody can double-dip.** The allowance is derived from rows, never from a "has claimed"
flag: `pc_used()` counts the voter's valid rows for the day and `remaining = allowance −
used`. Anyone who spent all three under the old rule has `used = 3`, `remaining = 0`, and
still has `remaining = 0` the instant the new rule ships. **The transition cannot hand
anyone an extra vote.**

**Rollback is lossless.** Rows written under the new rule are ordinary rows with an
`entrant_id`. Reverting the code does not orphan or miscount them, because the tally is the
same `COUNT(*)` either way. A rollback loses the *ability to split*, not a single point.

Both of these are properties of the existing design, not of anything that would be built.

---

## 2. The live system, audited read-only

| | |
|---|---|
| Mode | `daily` |
| State | `open` |
| Deadline | `2026-10-29T00:00:00-04:00` |
| Total valid public points | **49** |
| Distinct voter–founder pairs | 40 |
| Ranked | yes |
| Eastern days elapsed | 2 (`2026-10-23`, `2026-10-24`) |

**Has anyone already taken the +2? Yes — at least one person.** `entrant-01` holds
**3 points from 1 voter**. Only two Eastern days exist, so the most a voter can hold on one
founder without a bonus is 2. That pair must therefore include bonus points. The exact
number of bonus claims is only visible on the dashboard (the Day by day table's **Bonus**
column); it cannot be read from the public endpoint, and I did not open the dashboard.

**Daily allowances have been consumed**, necessarily — 49 points exist and the allowance is
the only way to cast one.

---

## 3. Where the actual work is: the frontend, not the backend

This is the part the brief underestimates, and it is the reason for the recommendation.

`labelVoteButton()` keys entirely on `today_entrant`. For **every founder that is not the
one the voter already backed**, it renders:

> Today's vote is used

For an attendee holding two unspent points under the new rule, that label is **false**, and
it is false on nineteen of twenty cards. The same assumption is baked into
`labelReelVote()`. So the change requires reworking the voting-state logic that sits on
every card, every reel panel and the profile dialog — the single most load-bearing UI on
the site — and the 20 label tests in `tools/test-labelvote.js` encode the current rule and
would have to be rewritten alongside it.

The published copy also says the rule in at least five places, e.g.:

- "**+2** For registered NextGen attendees, **on the same founder**."
- "Want to make your vote count **triple**?"

All of it would have to change, or the page contradicts itself.

**Rough effort:** backend ~1 hour. Frontend, copy and tests ~3–4 hours. Validation is the
problem, not the typing.

---

## 4. Why staging cannot clear this

| | production | staging |
|---|---|---|
| Total points | **49** | **0** |
| Ranked | yes | **no** |
| SMS mode | `mock` | **`live`** |

Staging has **no votes at all**, so none of the conditions that matter — a voter mid-
allowance, an already-claimed bonus, a ranked board, a day boundary crossing under load —
exist there to be tested. A green run on staging would mean very little.

And staging is in **live SMS mode** while production is in mock. Exercising the verification
path there can send real messages and spend real budget. That is a trap worth knowing about
before anyone "just tests it on staging".

**Conclusively testable:** the schema accepts split rows; the tally counts them correctly;
the allowance arithmetic; double-submission (the unique index decides the race, exactly as
it does now); rollback arithmetic.

**Not conclusively testable before shipping:** behaviour of real concurrent voters at the
Eastern midnight boundary, cache behaviour on the live edge, and how real attendees who
already claimed under the old rule experience the new UI.

---

## 5. Fairness

Changing the rule four days from the close is a **leadership decision, not a technical
one**, and it cuts both ways:

- *For:* nobody loses a point. The change only widens choice.
- *Against:* voters who have already concentrated three points on one founder did so
  without the option to split. Voters after the change have an option the earlier ones
  never had. With 49 points cast the asymmetry is small — but it is real, and it is exactly
  the kind of thing a losing founder can point at afterwards.
- The page currently **promises** the old rule in writing. Changing it means changing a
  published rule mid-competition, which should be said out loud rather than quietly shipped.

---

## 6. The cutoff, confirmed

```php
$t = pc_deadline_ts();
if ($t === null) { return true; }
return time() < $t;        // exclusive
```

Deadline `2026-10-29T00:00:00-04:00`, compared with `<`. So the last instant a vote is
accepted is **23:59:59 Eastern on 28 October 2026**, and 00:00:00 on the 29th is shut.
That is exactly the intended rule. Production and staging agree. **Not modified.**

---

## 7. Options

### Option A — change it now
Technically low risk, for the reasons in §1. The cost is a rewrite of the voting-state UI
and its tests, shipped into a live competition, validated against a staging environment that
cannot reproduce the conditions. Realistically half a day to a day before it is trustworthy.

### Option B — keep the current rules until 28 October *(recommended)*
Costs nothing that exists today: every attendee still gets their three points, and the only
thing they cannot do is spread them. No voter is blocked, no points are lost, no ranking is
affected. Build the flexible version properly afterwards, when a mistake costs nothing.

### A feature flag?
**Adds complexity rather than reducing risk here.** A flag protects you when the risk is in
the *data* — it lets you switch back without a deploy. The data risk is already near zero.
The risk is in the UI, and a flag means shipping *both* label states and testing both, which
is more surface, not less, in the week it matters.

---

## 8. If it proceeds anyway — the strict conditions

1. Take a dated copy of the production database beside itself first.
2. Backend change only in the claim handler: accept an `entrant`, validate it against
   `array_column(pc_entrants(), 'id')`, cast **one** point per call. Do not touch
   `pc_cast`, the index, the tally or the allowance.
3. Seed a staging database with realistic rows — mid-allowance voters, an already-claimed
   bonus, votes on both Eastern days — before testing anything.
4. Put staging back into `mock` SMS before exercising any verification path.
5. Rewrite `labelVoteButton`, `labelReelVote` and the 20 tests in the same change, not after.
6. Update every piece of copy that says "same founder" in the same deploy, so the page never
   contradicts the rule it is enforcing.
7. Deploy, then verify on production that total points are **unchanged** immediately before
   and after — the change must not move a single existing number.
8. Say publicly that the rule changed and when.

If any of 3, 5 or 6 cannot be completed in the same deploy, that is a blocker: a page whose
copy and behaviour disagree during a live vote is worse than the limitation it fixes.

---

## 9. Answers to the questions asked

| question | answer |
|---|---|
| How risky now that voting is live? | **Low technically, moderate operationally.** No migration, no data risk. The risk is a UI rewrite shipped mid-competition. |
| What could break? | Vote-button labelling across all twenty cards; copy contradicting behaviour; a partially-awarded claim leaving confusing state. Not the vote data. |
| Compatible with existing votes and allowances? | **Yes, completely.** Same row shape, same index, same tally, same allowance arithmetic. |
| Fairness issue? | **Yes, a modest one**, plus a published rule changing mid-competition. Leadership's call. |
| Time required? | ~1h backend, ~3–4h frontend and tests, plus seeding staging to make testing meaningful. Half a day to a day. |
| Safest course with the 28th approaching? | **Defer.** |

**DEFER UNTIL AFTER OCTOBER 28.**

The deciding factor is not danger — it is that the change buys very little (a handful of
attendees allocating points differently) at the cost of reworking the most load-bearing UI
on the site, four days from the close, with no environment that can prove it works. Mean-
while a larger gap is still open: **phone verification still cannot serve the public**, and
that affects every prospective voter rather than a few attendees.
