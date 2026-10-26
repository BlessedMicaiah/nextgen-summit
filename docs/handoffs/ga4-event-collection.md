# Turning on event collection — the GTM route

**No code deploy. No site release. Nothing that touches the voting path.**

Your pages are already announcing everything. This is a configuration change in Google Tag
Manager that tells GA4 to listen.

---

## What is already true on production, verified 25 October

| | |
|---|---|
| GTM container `GTM-PRVSWFBN` | loaded |
| GA4 `G-3M5BCK61VB` | loaded, present in `window.google_tag_manager` |
| `ngs_pc_page_view` in the dataLayer | **yes, on page load** |
| Pages carrying the tag | homepage, People's Choice, **every contestant page**, tickets |
| NextGen Data's own collector | **not present** (`NGD_BEACON` undefined, `/api/ngd-collect.php` → 404) |

Contestant pages are covered because `entrant.php:57` serves `index.html`'s markup, so they
inherit its tags. *(I previously said twice that they had no GA4. That was wrong.)*

**40 events already fire into the dataLayer** — 36 from `peoples-choice.js`, 4 from
`pc-stage.js`. They have been firing throughout the competition. Whether GA4 has been
*recording* them depends on one GTM trigger, which I cannot see from outside.

### Check that first — it takes a minute

GA4 → **Reports → Realtime → Event count by Event name**, with the People's Choice page open
in another tab. If you see `ngs_pc_page_view`, collection is already on and you have the whole
competition's history. If you only see `page_view`, `scroll` and `session_start`, the steps
below switch it on.

---

## The change: one trigger, one tag

### 1. Trigger

| Field | Value |
|---|---|
| Type | **Custom Event** |
| Event name | `^ngs_pc_` |
| Use regex matching | **ticked** |
| Name it | `NGS – all People's Choice events` |

One trigger catches all 40, and every future one, without another visit to GTM.

### 2. Data Layer Variables

Create one per parameter. Type **Data Layer Variable**, Version 2, name matching the key:

```
entrant_id      which founder            state       the competition state
entrant_slot    01..20                   method      email or phone
from            where a ticket click came from       kind    video type
slot            bubble position          on          sound on/off
mock            test-mode OTP flag       founders    the five on the homepage
reason          why a vote was refused   entrants    how many contestants
```

### 3. Tag

| Field | Value |
|---|---|
| Type | **GA4 Event** |
| Measurement ID | `G-3M5BCK61VB` |
| Event Name | `{{Event}}` |
| Event Parameters | one row per variable above, parameter name = variable name |
| Trigger | the one from step 1 |

`{{Event}}` passes the dataLayer name straight through, so GA4 receives `ngs_pc_vote_success`,
`ngs_pc_tickets_click` and so on. All are valid GA4 event names: under 40 characters, letters
and underscores, starting with a letter.

### 4. Register the parameters as custom dimensions

**Do not skip this.** Without it GA4 collects the parameters and shows them nowhere.

GA4 → **Admin → Custom definitions → Create custom dimension**, scope **Event**, one per
parameter you want to report on. `entrant_id` is the important one — it is what lets you say
"which founder did this traffic come for".

### 5. Preview, then publish

GTM **Preview** against `nextgensummit.us`, load the People's Choice page, confirm the tag
fires on `ngs_pc_page_view`. Then Publish.

**Rollback:** GTM → Versions → publish the previous version. Seconds, no deploy.

---

## What you get, and what you do not

**Immediately:** page views and founder engagement per contestant, the whole vote funnel
(`vote_open` → `verify_start` → `otp_verified` → `vote_success`, plus `vote_failed` with a
reason), ticket CTA clicks, share actions, and the homepage cinematic section's four events.

**Not retroactive.** Custom events start the moment you publish. Standard GA4 page views and
traffic sources, however, have been collecting since the tag went live — that history is
already in the property.

**Not purchases.** `tickets_click` is a click. A confirmed order needs Eventbrite order data,
which no click count can substitute for.

---

## No personal data reaches GA4

Checked parameter by parameter. The events carry a contestant id, a competition state, a
verification method (`email`/`phone`, never an address), a slot number, and booleans.

`peoples-choice.js:149-151` states the rule the site already follows: *"No event carries a
name, an email or who was voted for: the entrant id on a vote event is the pitch, and the
voter is never in the payload."* Nothing in this configuration changes that, and nothing here
sends an address, a voter key or a phone number to Google.

---

## Why not the custom collector instead

It is written, tested and hardened, and it is **off everywhere** on purpose. An adversarial
review found that its folder shares a filesystem and an account quota with the live ballot,
so a flood of unauthenticated analytics could fill the disk the voting database needs to
commit a write — and a failed vote INSERT reaches the voter as *"you have used your
allowance."* That is fixed (per-address rate limit, hard row and disk ceilings, one
transaction per request, WAL, separate throttle store), but it still needs a **production
deploy** and your approval.

GTM needs neither, starts today, and cannot affect voting at all. Use it now; the collector
remains available afterwards for the founder-level detail GA4 cannot easily give.
