# People's Choice — verification options, costs, and the proposed daily rule

Written for leadership, October 2026. Nothing in here is switched on. No billable service has
been enabled, no provider account has been created, and no credentials exist in this project.

---

## 1. What is actually running today

| | Status |
|---|---|
| Vote records | **Real.** Rows in SQLite, in the staging data directory, counted on every read. |
| One-vote enforcement | **Real.** A unique database index refuses the second row. Not a browser rule. |
| Deadline and open/closed | **Real.** Decided on the server, in `America/New_York`, on every vote. |
| Who the voter is | **Simulated.** Any email, any six digits. This is the gap. |

The honest sentence today is *"one verified account, one vote"* — and the account is not yet
verified. Everything below is about closing that.

---

## 2. Verification options compared

### A. Email OTP (code to an inbox)

- **Cost:** effectively £0 via the existing PHP mail path, or a few pounds a month for a
  transactional sender (Postmark/SES) if deliverability matters.
- **Stops:** casual double-voting, bots that cannot read mail.
- **Does not stop:** anyone with a second mailbox. A new Gmail address takes two minutes and
  costs nothing. **This is the weak point and it is not fixable with email.**

### B. Google sign-in

- **Cost:** £0.
- **Stops:** the same as email, slightly better — a throwaway Google account takes longer.
- **Does not stop:** multiple Google accounts, which most people already have.

### C. SMS OTP (Twilio Verify)

- **Stops:** the cheap attacks. A phone number costs real money and effort to duplicate.
- **Does not stop:** someone determined with several SIMs, or VoIP numbers unless screened.
- **Cost:** see the table. US SMS via Twilio Verify is about **$0.05 per verification
  attempt**, charged per attempt, not per success.

#### Estimated SMS cost (US numbers, Twilio Verify)

Assumes 1.25 attempts per successful voter — people mistype, and some ask for a resend.

| Verified voters | Attempts (≈1.25×) | Verify @ $0.05 | + Lookup @ $0.005 | Total |
|---|---|---|---|---|
| 500 | 625 | $31 | $3 | **≈ $34** |
| 1,000 | 1,250 | $63 | $5 | **≈ $68** |
| 2,500 | 3,125 | $156 | $13 | **≈ $169** |
| 5,000 | 6,250 | $313 | $25 | **≈ $338** |

Add to that:

- **No setup or monthly fee** for Verify itself; it is usage-priced.
- **Carrier fees** in the US are generally folded into the per-message price; some countries
  add surcharges. International numbers can be several times the US rate.
- **Fraud exposure:** SMS pumping — someone scripting thousands of requests to premium
  international ranges to earn a share of the carrier fee. This is the real financial risk, and
  it is why the controls below are not optional.

Rule of thumb: **budget about $70 per thousand voters**, and cap it.

### Recommended controls if SMS is approved

- A hard **spending cap** on the Twilio account, plus a balance alert at 50% and 80%.
- **Restrict to US and Canada** unless there is a reason not to. This alone removes most of the
  pumping risk.
- **Rate limits:** 1 code per number per minute, 5 per number per day, 20 per IP per hour.
- **Twilio Lookup** to reject VoIP and disposable numbers *before* sending.
- **Cloudflare Turnstile** in front of the request-a-code endpoint.
- Start with the cap set to **$50**. That covers roughly 700 voters and fails safe.

### Recommendation

**Email or Google for the public, with the fraud-review screen doing the real work.** Move to
SMS only if the People's Choice winner takes a finalist slot — if a vote decides who stands on
the stage, the bar is higher and the cost is justified.

**Nothing verifies one human being.** Email, Google and SMS all verify *control of an account*.
The defence that actually holds is the admin review: totals stay private while voting is open,
and the result is approved by a person before it is published. That is already built.

---

## 3. The proposed daily rule

### Current (approved)

One vote per verified voter, for the whole competition.

### Proposed (not approved)

- General public: 1 vote per day
- Verified ticket holder: 2 votes per day
- Allowance refills at midnight Eastern
- Voting closes October 28, 11:59 PM Eastern

### How it is already built

Both rules run on one table, and the database enforces whichever is selected:

```sql
pc_votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  competition TEXT NOT NULL,
  voter_key   TEXT NOT NULL,
  vote_day    TEXT NOT NULL DEFAULT 'all',   -- 'all' (single rule) or '2026-10-21' (daily)
  slot        INTEGER NOT NULL DEFAULT 1,    -- 1..allowance
  entrant_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  valid       INTEGER NOT NULL DEFAULT 1,
  simulated   INTEGER NOT NULL DEFAULT 1,
  ip_hash     TEXT
);
CREATE UNIQUE INDEX pc_votes_one ON pc_votes (competition, voter_key, vote_day, slot);
```

Under the approved rule every row is `vote_day = 'all'`, `slot = 1`, so the index means **one
row per voter, full stop**. Under the daily rule `vote_day` is the Eastern date and `slot` runs
1..allowance, so the same index means **no more than the allowance per voter per day**.

A vote **claims a slot by inserting**. It is never "check, then insert" — two requests arriving
together would both pass that check. The insert either succeeds or the unique index refuses it,
inside a transaction. That is what makes the limit safe under load.

Switching rules is an administrator's deliberate act on the dashboard. A deploy cannot do it.

### Decisions still needed

1. **Approve or reject the daily model.** Currently set to the approved single-vote rule.
2. **May both daily votes go to the same contestant?** As built, **yes**. If they should be
   spread across different contestants, that is a one-line change — but say so first.
3. **Does the People's Choice winner take a finalist slot?** The public pitch page already
   says yes. This decides how hard the verification needs to be.
4. **Daily voting and fairness.** A daily allowance rewards whoever can mobilise a group most
   days, which is a popularity contest more than a pitch contest. Worth a conscious choice.

---

## 4. Ticket-holder verification — unresolved

The extra vote must never rest on someone *claiming* a ticket. On staging the ticket flag is
taken from the request purely so the model can be demonstrated, and every such vote is marked
`ticket_claimed_unverified`. It is worthless as evidence.

For it to be real the server must establish ticket ownership itself:

1. The voter authenticates.
2. The server looks the person up in Eventbrite (or the site's own registrations) **by the
   authenticated identity**, not by a typed-in address.
3. The ticket is bound to exactly one voting identity, permanently.
4. The registration is checked as live, not cancelled or refunded.

### Edge cases that need rules before this can ship

- **Group tickets.** One buyer, six attendees. Does the buyer get one extra vote or six?
- **Transferred tickets.** If a ticket moves to another person, does the extra vote move too?
  If it does, a ticket could be passed round to farm votes.
- **Duplicate attendee records.** The same person registered twice gets two identities unless
  they are merged.
- **Cancellations and refunds.** A vote already cast on a since-refunded ticket — does it stand?
- **Fairness and legality.** Extra votes for paying customers ties the outcome of a public
  contest to a purchase. That deserves a deliberate decision, and possibly a legal view, before
  it is enabled. It is not a technical question.

**Recommendation: do not enable the ticket incentive for this competition.** Promote tickets on
the confirmation screen without attaching voting benefits. That is how the page is built today.
