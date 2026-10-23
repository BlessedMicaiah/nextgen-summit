/* NextGen Summit — People's Choice Award.

   This file used to say that none of it was real -- no server, no account, and a one-vote
   guard that was a sessionStorage key. That is no longer true and the note is worth keeping
   as history, because every line of it has since been replaced by something that is.

   The vote is real: cast by pc-vote.php, stored, and limited by a unique index in the
   database. Verification is real: a code by SMS or email, checked on the server. The daily
   allowance, who the voter backed today, and whether a bonus is waiting are all answered by
   pc-otp.php and never by this file. What remains a facade is the lineup -- ENTRANTS below is
   placeholder until the approved finalists land.

   The rule this file must not break: the page may ask the server what is true, and may draw
   it. It may not decide it. Anything it believes about a voter that the server did not just
   tell it is a bug, and the last one cost a voter the only route to two of their points.

   Everything a visitor sees is driven by the two blocks at the top: STATE decides which of the
   four voting states the page is in, and ENTRANTS is the lineup. Both are meant to be replaced
   -- STATE by a value the backend serves, ENTRANTS by the approved twenty -- without touching
   anything below them. */
(function () {
  'use strict';

  if (window.__ngsPeoplesChoice) return;
  window.__ngsPeoplesChoice = true;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- 1. the voting state ----------
     Four states, and the page reads the same in all of them. The real page will take this from
     the server on every load, because a deadline the browser can argue with is not a deadline.
     ?pc=open etc. overrides it here so leadership can walk through each state in review. */
  var STATES = ['coming-soon', 'open', 'closed', 'results'];
  var STATE = 'coming-soon';                 // <-- the staging default
  var MODE = 'daily';                        // the rule in force; the server is the authority
  var DEADLINE = null;                       // <-- an ISO date once leadership sets one; null hides the clock

  var q = (location.search.match(/[?&]pc=([a-z-]+)/) || [])[1];
  if (q && STATES.indexOf(q) >= 0) STATE = q;
  var FORCED = !!q;          // ?pc= is for walking through the states in review
  var API = '/api/pc-vote.php';
  var OTP = '/api/pc-otp.php';
  var me = { verified: false, csrf: '', sms: 'mock' };   // what the SERVER says about this visitor
  var qd = (location.search.match(/[?&]pcdeadline=([0-9T:+-]+)/) || [])[1];
  if (qd) DEADLINE = qd;

  var COPY = {
    'coming-soon': { pill: 'Voting opens soon', vote: 'Voting opens soon',
      note: 'Voting has not opened. The date will be announced once leadership confirms it.' },
    'open':        { pill: 'Voting open', vote: 'Vote for this pitch',
      note: 'One verified person, one vote a day, until October 28.' },
    'closed':      { pill: 'Voting closed', vote: 'Voting closed',
      note: 'Voting has closed. The result is with the NextGen team.' },
    'results':     { pill: 'Results published', vote: 'Voting closed',
      note: 'Voting has closed and the result has been published.' }
  };

  /* ---------- 2. the lineup ----------
     Twenty placeholders. No name, company, biography or achievement here belongs to a real
     person, and every card says so on its face. Replace an entry with approved copy and a
     portrait in assets/img/pitch/ and the card fills itself in -- `draft: false` takes the
     placeholder flag off. `video` stays null until a real link exists; the profile shows the
     poster and says the pitch is to come rather than embedding nothing. */
  function slot(n) {
    var id = n < 10 ? '0' + n : '' + n;
    return {
      id: 'entrant-' + id,
      n: id,
      draft: true,
      name: 'Semifinalist ' + id,
      company: 'Company to be confirmed',
      blurb: 'A one-line description of the venture appears here once the semifinalist is approved.',
      bio: 'Founder biography to be supplied by the NextGen Summit team. Nothing in this slot describes a real person.',
      summary: 'Project summary to be supplied by the NextGen Summit team.',
      shot: null,            // '/assets/img/pitch/entrant-01.jpg'
      video: null,           // { type: 'youtube' | 'vimeo', id: '...' }
      videoUrl: null         // the plain link, used when the embed cannot load
    };
  }
  var ENTRANTS = [];
  for (var i = 1; i <= 20; i++) ENTRANTS.push(slot(i));

  var byId = {};
  ENTRANTS.forEach(function (e) { byId[e.id] = e; });

  /* ---------- 3. analytics ----------
     Google Tag Manager is already on the page, so events go to the same dataLayer everything
     else uses. No event carries a name, an email or who was voted for: the entrant id on a
     vote event is the pitch, and the voter is never in the payload. */
  function track(name, params) {
    var d = { event: 'ngs_pc_' + name };
    if (params) for (var k in params) if (params.hasOwnProperty(k)) d[k] = params[k];
    try { (window.dataLayer = window.dataLayer || []).push(d); } catch (e) {}
  }

  /* ---------- 4. no local ballot ----------
     There was a sessionStorage key here, written on a successful vote and read to decide what
     the page should show. It is gone, and its absence is the fix.

     A note the page writes to itself is not evidence. It said less than the truth -- a new
     tab, a private window or a cleared session and the page believed nobody had voted -- and,
     worse, it was read as though it said MORE: "a ballot exists" was turned into "there is
     nothing further to do", which disabled every card including the one with two bonus points
     waiting behind it. Enforcement was always the unique index on the server; the only thing
     this key ever added was a second, wrong opinion.

     Everything the interface now shows about this voter comes from refreshMe(). */

  /* Who the voter is, as far as this prototype can tell. The email path uses what was typed;
     the Google path mints a pseudo-identity and keeps it, so at least the same browser is the
     same "person" twice. Neither is verification, and the server knows it: every row it writes
     is marked simulated. Real auth replaces this function and the endpoint stops trusting the
     request body at all. */
  function voterClaim() {
    if (method === 'email') {
      var f = $('[data-pc-email]', vDlg);
      if (f && f.value) return f.value.trim().toLowerCase();
    }
    var k = 'ngs-pc-simulated-identity', v = null;
    try { v = localStorage.getItem(k); } catch (e) {}
    if (!v) {
      v = 'google-sim-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem(k, v); } catch (e) {}
    }
    return v;
  }

  /* ---------- 5. the gallery ---------- */
  var grid = $('[data-pc-grid]');
  if (!grid) return;

  function initials(e) {
    return e.draft ? e.n : e.name.split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('');
  }

  function cardHtml(e) {
    var shot = e.shot
      ? '<img src="' + e.shot + '" alt="' + e.name + '" loading="lazy" decoding="async" width="640" height="480">'
      : '<span class="pce__await"><span class="pce__await-n">' + initials(e) + '</span>' +
        '<span class="pce__await-k">Portrait to come</span></span>';
    var voteLabel = COPY[STATE].vote;
    var canVote = STATE === 'open';
    return '' +
      '<li class="pce' + (e.draft ? ' pce--draft' : '') + '" data-pc-card="' + e.id + '">' +
        '<button class="pce__open" type="button" data-pc-open="' + e.id + '">' +
          'Open ' + e.name + '</button>' +
        '<span class="pce__num">' + e.n + '</span>' +
        '<button class="pce__share" type="button" data-pc-share="' + e.id + '" ' +
          'aria-label="Share ' + e.name + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">' +
          '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/>' +
          '<path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3"/></svg></button>' +
        '<span class="pce__shot">' + shot + '</span>' +
        '<span class="pce__body">' +
          (e.draft ? '<span class="pce__flag">Placeholder slot</span>' : '') +
          '<span class="pce__co">' + e.company + '</span>' +
          '<span class="pce__name">' + e.name + '</span>' +
          '<span class="pce__blurb">' + e.blurb + '</span>' +
          '<span class="pce__acts">' +
            '<button class="btn btn--ghost" type="button" data-pc-watch="' + e.id + '">Watch pitch</button>' +
            '<button class="btn" type="button" data-pc-vote="' + e.id + '"' +
              (canVote ? '' : ' disabled') + '>' + (canVote ? 'Vote' : voteLabel) + '</button>' +
          '</span>' +
        '</span>' +
      '</li>';
  }

  grid.innerHTML = ENTRANTS.map(cardHtml).join('');
  $$('[data-pc-count]').forEach(function (n) { n.textContent = ENTRANTS.length; });

  /* ---------- 6. the profile ---------- */
  var pDlg = $('[data-pc-profile]');
  var opener = null;

  function videoHtml(e) {
    if (!e.video) {
      return '<button class="pcp__poster" type="button" data-pc-play disabled>' +
        '<span class="pcp__play" aria-hidden="true">' + playIcon() + '</span>' +
        '<span class="pcp__posterk">Pitch video to come</span></button>';
    }
    return '<button class="pcp__poster" type="button" data-pc-play="' + e.id + '">' +
      '<span class="pcp__play" aria-hidden="true">' + playIcon() + '</span>' +
      '<span class="pcp__posterk">Play the pitch</span></button>';
  }
  function playIcon() {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
  }
  /* Built only when someone asks for it, so twenty profiles cost no third-party request until
     a pitch is actually watched. youtube-nocookie and vimeo's dnt flag keep the player from
     profiling the viewer for us. */
  function embedSrc(v) {
    if (v.type === 'youtube') return 'https://www.youtube-nocookie.com/embed/' + v.id + '?autoplay=1&rel=0';
    if (v.type === 'vimeo') return 'https://player.vimeo.com/video/' + v.id + '?autoplay=1&dnt=1';
    return null;
  }

  /* Each contestant has a page of their own, so a shared link lands on them rather than on a
     fragment of the gallery -- which also means the preview card a messaging app draws is
     theirs. ?s= records which platform sent the visit; it carries no person in it. */
  function slugOf(e) {
    return e.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function shareUrl(e, via) {
    var u = location.origin + '/pitch/peoples-choice/' + slugOf(e) + '/';
    return via ? u + '?s=' + via : u;
  }

  function paintProfile(e) {
    $('[data-pc-p-video]', pDlg).innerHTML = videoHtml(e);
    $('[data-pc-p-name]', pDlg).textContent = e.name;
    $('[data-pc-p-co]', pDlg).textContent = e.company;
    $('[data-pc-p-bio]', pDlg).textContent = e.bio;
    $('[data-pc-p-sum]', pDlg).textContent = e.summary;
    var flag = $('[data-pc-p-flag]', pDlg);
    flag.hidden = !e.draft;
    /* Attribute first, then label: the labeller compares this id against the founder the
       server says today's vote went to, so it has to be set before it reads it. */
    var vb = $('[data-pc-p-vote]', pDlg);
    vb.setAttribute('data-pc-vote', e.id);
    labelVoteButton(vb, me);
    var ext = $('[data-pc-p-ext]', pDlg);
    ext.hidden = !e.videoUrl;
    if (e.videoUrl) $('a', ext).href = e.videoUrl;
    $('[data-pc-p-share]', pDlg).setAttribute('data-pc-share', e.id);
    pDlg.setAttribute('data-entrant', e.id);
  }

  function openProfile(id, viaHash) {
    var e = byId[id];
    if (!e) return;
    paintProfile(e);
    if (!pDlg.open) {
      if (typeof pDlg.showModal === 'function') pDlg.showModal();
      else pDlg.setAttribute('open', '');
    }
    if (!viaHash && location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    track('profile_view', { entrant_id: id, entrant_slot: e.n });
  }

  function closeProfile() {
    if (pDlg.open) pDlg.close();
  }

  pDlg.addEventListener('close', function () {
    $('[data-pc-p-video]', pDlg).innerHTML = '';        // stop any player that is running
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  });

  /* ---------- 7. the vote flow ---------- */
  var vDlg = $('[data-pc-vote-dialog]');
  var pending = null;      // the entrant being voted for
  var method = null;       // how this attempt 'verified'

  function step(name) {
    $$('[data-pc-step]', vDlg).forEach(function (s) {
      s.hidden = s.getAttribute('data-pc-step') !== name;
    });
    var err = $('[data-pc-error]', vDlg);
    if (err) err.hidden = true;
  }

  /* Everything about the voter comes from this call, never from storage: whether they are
     verified, how many votes they have left, when the allowance refills. A browser that lies
     about any of it is simply ignored by the server. */
  function refreshMe() {
    return fetch(OTP + '?action=status', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) me = d; return me; })
      .catch(function () { return me; });
  }

  function post(action, body) {
    return fetch(OTP, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action, csrf: me.csrf }, body || {}))
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, reason: 'network' }; });
    });
  }

  /* Which screen this voter should be looking at, decided by the SERVER's account of them.

     The old version asked sessionStorage whether this browser had voted and routed on that.
     It was wrong twice over: a note the page wrote to itself is not evidence (clearing a tab
     erased it, and the real enforcement was server-side all along), and the screen it routed
     to was a dead end. Somebody who had cast their phone point and had two bonus points
     waiting was told they had already voted and shown the way out. */

  /* The visible step, so an error lands where the voter is rather than inside a hidden one. */
  function liveStep() {
    var found = null;
    $$('[data-pc-step]', vDlg).forEach(function (n) { if (!n.hidden) found = n; });
    return found || vDlg;
  }


  var lastEmail = '';
  var emailResendTimer = null;

  function holdEmailResend(n) {
    var rb = $('[data-pc-vemail-resend]', vDlg);
    if (!rb) return;
    if (emailResendTimer) { clearInterval(emailResendTimer); emailResendTimer = null; }
    var left = Math.ceil(n);
    rb.disabled = true;
    var tick = function () {
      if (left <= 0) {
        clearInterval(emailResendTimer); emailResendTimer = null;
        rb.disabled = false; rb.textContent = 'Resend code';
        return;
      }
      rb.textContent = 'Resend in ' + left + 's';
      left--;
    };
    tick();
    emailResendTimer = setInterval(tick, 1000);
  }

  /* Deliberately vague about whether an address has been seen before: a refusal that said
     "already voted" would turn this into a way of testing whether somebody is on our list. */
  function emailMsg(d) {
    return d.reason === 'email' ? 'That does not look like an email address.' :
      d.reason === 'disposable' ? 'Please use a permanent email address rather than a temporary one.' :
      d.reason === 'cooldown' ? 'Please wait ' + (d.wait || 60) + ' seconds before asking for another code.' :
      d.reason === 'addr_daily' ? 'That address has asked for too many codes today.' :
      d.reason === 'ip_hourly' ? 'Too many codes requested from this connection. Try again later.' :
      d.reason === 'mail_not_configured' ? 'Email verification is not switched on yet. Please try the phone option.' :
      d.reason === 'mail' ? 'We could not send the email just now. Please try again in a moment.' :
      d.reason === 'expired' ? 'That code has expired. Send a new one.' :
      d.reason === 'attempts' ? 'Too many attempts. Start again with your email address.' :
      d.reason === 'no_pending' ? 'Ask for a code first.' :
      d.reason === 'code' ? ('That code did not match.' + (d.tries_left ? ' ' + d.tries_left + ' tries left.' : '')) :
      d.reason === 'csrf' ? 'Your session expired. Close this and try again.' :
      d.reason === 'network' ? 'We could not reach the server. Check your connection and try again.' :
      'Something went wrong. Please try again.';
  }

  /* The phone option is only offered when SMS can actually deliver. Hiding the fact that it is
     unavailable would send voters into a flow that cannot finish. */
  /* The phone route is hidden in the markup while carrier approval is pending. This no longer
     reveals it; it only keeps the wording honest if it is ever shown again. */
  function paintChannels() {
    var smsWay = $('[data-pc-sms-way]', vDlg);
    if (!smsWay || smsWay.hidden) return;
    var live = me.sms === 'live';
    smsWay.disabled = !live;
    smsWay.classList.toggle('is-off', !live);
    var sub = $('[data-pc-sms-sub]', vDlg);
    if (sub) {
      sub.textContent = live ? 'Receive a code by text message'
        : 'Text messages are paused while we complete carrier approval';
    }
  }


  function routeFor(d, entrantId) {
    if (!d || !d.ok || !d.verified) return 'verify';
    var today = d.today_entrant || null;
    if (today && today !== entrantId) return 'other';
    if (!today) return (d.remaining > 0) ? 'confirm' : 'all-done';
    if (d.bonus_claimable) return 'bonus-ready';   // attendee verified, points still to give
    if (d.bonus_eligible) return 'voted-bonus';    // a registration check would unlock two
    return 'all-done';
  }

  /* The "you backed someone else today" screen, including the way out of it.

     The onward button appears only when something is actually waiting on their own founder.
     Offering it otherwise would be a promise the next screen breaks, and that is worse than
     not offering it at all. */
  function paintOther(d) {
    var who = d ? byId[d.today_entrant] : null;
    $$('[data-pc-other-for]', vDlg).forEach(function (n) {
      n.textContent = who ? who.name : 'another founder';
    });
    var go = $('[data-pc-other-go]', vDlg);
    if (!go) return;
    var waiting = !!(d && (d.bonus_claimable || d.bonus_eligible));
    go.hidden = !who || !waiting;
    go.textContent = 'Go to my vote & +2 bonus';
    go.setAttribute('data-pc-other-go', who ? who.id : '');
  }

  /* The summary on the completion screen reports what was actually given, not a fixed three. */
  function paintSummary(d) {
    var used = (d && typeof d.used === 'number') ? d.used : 0;
    var bonus = Math.max(0, used - 1);
    $$('[data-pc-sum-total]', vDlg).forEach(function (n) { n.textContent = String(used); });
    $$('[data-pc-sum-bonus-row]', vDlg).forEach(function (n) { n.hidden = bonus <= 0; });
    $$('[data-pc-sum-bonus]', vDlg).forEach(function (n) { n.textContent = '+' + bonus; });
    $$('[data-pc-done-title]', vDlg).forEach(function (n) {
      n.textContent = used >= 3 ? 'you gave 3 points today!'
        : (used === 1 ? 'your vote is counted!' : 'you gave ' + used + ' points today!');
    });
  }

  function openVote(id) {
    var e = byId[id];
    if (!e) return;
    if (STATE !== 'open') return;
    pending = e; method = null;
    $$('[data-pc-who-n]', vDlg).forEach(function (n) { n.textContent = e.name; });
    $$('[data-pc-who-c]', vDlg).forEach(function (n) { n.textContent = e.company; });

    /* Open on the invitation rather than a spinner; the server's answer arrives in a moment
       and moves them on. Nothing is recorded by looking. */
    step('verify');
    if (!vDlg.open) {
      if (typeof vDlg.showModal === 'function') vDlg.showModal();
      else vDlg.setAttribute('open', '');
    }

    refreshMe().then(function (d) {
      paintChannels();
      var to = routeFor(d, id);
      if (to === 'other') paintOther(d);
      if (to === 'all-done') paintSummary(d);
      if (to === 'confirm') { method = 'phone'; confirmStep(); return; }
      step(to);
      if (to === 'voted-bonus') paintVotedBonus(d);
      track('vote_open', { entrant_id: id, state: to });
    });
  }



  /* A provider refusal is the expensive one: the message was not sent and a slot was spent
     anyway. On a preview host the server hands back Twilio's HTTP status and numeric code, so
     say them -- the next attempt costs another of three, and guessing is not affordable. */

  var lastPhone = '';
  var resendTimer = null;

  /* Hold the resend control for n seconds, counting down, so the wait is visible rather than
     discovered by pressing it again and being refused. */
  function holdResend(n) {
    var rb = $('[data-pc-resend]', vDlg);
    if (!rb) return;
    if (resendTimer) { clearInterval(resendTimer); resendTimer = null; }
    var left = Math.ceil(n);
    rb.disabled = true;
    var tick = function () {
      if (left <= 0) {
        clearInterval(resendTimer); resendTimer = null;
        rb.disabled = false; rb.textContent = 'Resend code';
        return;
      }
      rb.textContent = 'Resend in ' + left + 's';
      left--;
    };
    tick();
    resendTimer = setInterval(tick, 1000);
  }


  /* What to tell someone when a code could not be sent. One copy, because the resend and the
     first attempt fail for exactly the same reasons and should say the same things. */
  function otpStartMsg(d) {
    return d.reason === 'cooldown' ? 'Please wait ' + (d.wait || 60) + ' seconds before asking for another code.' :
      d.reason === 'number_daily' ? 'That number has asked for too many codes today.' :
      d.reason === 'ip_hourly' ? 'Too many codes requested from this connection. Try again later.' :
      d.reason === 'country' ? 'We can only text US and Canada numbers at the moment.' :
      d.reason === 'not_allowlisted' ? 'This number is not approved for text messages on this preview.' :
      d.reason === 'budget' ? 'The test message allowance for this preview has been used up.' :
      d.reason === 'phone' ? 'That does not look like a mobile number.' :
      d.reason === 'csrf' ? 'Your session expired. Close this and try again.' :
      d.reason === 'network' ? 'We could not reach the server. Check your connection and try again.' :
      d.reason === 'provider' ? providerMsg(d) :
      'We could not send a code just now. Please try again.';
  }

  function providerMsg(d) {
    var base = 'The text could not be sent. This was refused by the SMS provider, not by us.';
    if (d.provider_status || d.provider_code) {
      base += ' (provider status ' + (d.provider_status || '?') +
        (d.provider_code ? ', code ' + d.provider_code : '') + ')';
    }
    return base;
  }


  /* ---------- the verified-attendee bonus ----------
     Every call needs the phone-verified session; the server refuses otherwise, so there is no
     path from this file to a point that was not earned. */
  var BONUS = '/api/pc-bonus.php';
  var bonusEmail = '';

  function bpost(action, body) {
    return fetch(BONUS, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action, csrf: me.csrf }, body || {}))
    }).then(function (r) {
      /* A body that will not parse is almost always a PHP fatal, and calling that "network"
         is what hid a 500 behind an outage message. Carry the status instead. */
      return r.json().catch(function () { return { ok: false, reason: 'http_' + r.status }; });
    }).catch(function () {
      // and a rejected fetch really is the network; without this the spinner never moved
      return { ok: false, reason: 'network' };
    });
  }

  /* Which of the two blocks the success screen shows: the invitation, or a note that the
     registration is already linked. Asked of the server rather than remembered locally. */
  /* Which of the bonus states to show, decided by the server's automatic check rather than by
     asking the voter to start another verification. They proved an inbox to vote; if that same
     inbox is on the attendee list, the entitlement is theirs and no second code is needed. */
  /* The automatic registration check: match the address this voter ALREADY proved against the
     attendee list, and never ask for it a second time.

     It paints every copy of the six result blocks rather than the first. Two screens carry
     them now -- the one straight after a vote, and the one a returning voter lands on -- and
     with $() only the first was ever painted, so the returning voter's screen stayed blank
     and fell back to the manual form. Only the copy inside the visible step is seen.

     It awards nothing. It reports what is possible; the points come from an explicit press. */
  function paintBonus() {
    var all = ['[data-pc-bonus-wait]', '[data-pc-bonus-yes]', '[data-pc-bonus-no]',
               '[data-pc-bonus-ask]', '[data-pc-bonus-taken]', '[data-pc-bonus-down]',
               '[data-pc-bonus-done]'];
    var only = function (sel) {
      all.forEach(function (x) {
        $$(x, vDlg).forEach(function (n) { n.hidden = x !== sel; });
      });
    };
    only('[data-pc-bonus-wait]');
    $$('[data-pc-bonus-why]', vDlg).forEach(function (n) { n.hidden = true; });
    bpost('auto').then(function (d) {
      /* On staging the server says WHY, and this puts it on the screen rather than leaving it
         in a response nobody reads. "We could not check" with no detail is what turned a
         fatal error into a week of guessing. Production sends no code, so this stays hidden. */
      /* eb is only sent on a successful lookup, so the first version of this line could not
         describe the very failure it was added for. reason covers the rest. */
      var why = d && (d.eb || d.reason);
      $$('[data-pc-bonus-why]', vDlg).forEach(function (n) {
        n.textContent = why ? 'Staging diagnostic: ' + why : '';
        n.hidden = !why;
      });
      if (!d || !d.ok) { only('[data-pc-bonus-down]'); return; }
      if (d.mode !== 'daily') { only(''); return; }
      if (d.status === 'verified') {
        only(d.remaining > 0 ? '[data-pc-bonus-yes]' : '[data-pc-bonus-done]');
        return;
      }
      /* "We could not check" is not "you are not registered", and must never be shown as it:
         a registered attendee told they are not registered does not come back. */
      if (d.status === 'unavailable') { only('[data-pc-bonus-down]'); return; }
      /* Same principle: no address to search with is not a finding about their registration. */
      if (d.status === 'no_email') { only('[data-pc-bonus-ask]'); return; }
      if (d.status === 'claimed_elsewhere') { only('[data-pc-bonus-taken]'); return; }
      only('[data-pc-bonus-no]');      // not registered, or no proven address to match on
    });
  }

  /* The returning voter's screen: someone who cast their point earlier and came back for the
     two that were waiting. The +1 row names the channel the SERVER says they used -- it was
     hard-coded to "Phone vote", which was simply wrong for the email voters who are the
     majority of this route -- and the registration check starts the moment the screen opens.
     No address is asked for. One was already proven; asking again establishes nothing. */
  function paintVotedBonus(d) {
    var ch = (d && d.channel === 'email') ? 'Email vote'
           : ((d && d.channel === 'sms') ? 'Phone vote' : 'Your vote');
    $$('[data-pc-vb-channel]', vDlg).forEach(function (n) { n.textContent = ch; });
    paintBonus();
  }

  function bonusErr(sel, d) {
    $$(sel, vDlg).forEach(function (e) {
      e.textContent = bonusText(d);
      e.hidden = false;
    });
  }

  /* NOTE the shape of this return. It used to sit on a line of its own above the ternary,
     which is valid JavaScript and completely wrong: automatic semicolon insertion turned it
     into `return;`, so every bonus error in the system rendered the word "undefined". The
     expression has to begin on the same line as the return. */
  function bonusText(d) {
    return d.reason === 'not_found' ? 'We could not find a NextGen Summit registration for that email. Check the address you registered with, or use the ticket link below to join us.' :
      d.reason === 'claimed' ? 'That registration has already been linked to another voter. Each registration counts once.' :
      d.reason === 'unavailable' ? 'We cannot reach the registration system right now. Your vote is safe — please try the bonus again in a few minutes.' :
      d.reason === 'mail' ? 'We could not send the email just now. Please try again in a moment.' :
      d.reason === 'too_many' ? 'That is too many verification emails for one day. Please try again tomorrow.' :
      d.reason === 'email' ? 'That does not look like an email address.' :
      d.reason === 'expired' ? 'That code has expired. Send a new one and try again.' :
      d.reason === 'attempts' ? 'Too many attempts. Start the registration check again.' :
      d.reason === 'none' ? 'We have no code waiting. Send one and try again.' :
      d.reason === 'code' ? ('That code did not match.' + (d.tries_left ? ' ' + d.tries_left + ' tries left.' : '')) :
      d.reason === 'vote_first' ? 'Cast today’s vote first, then the bonus can be added to it.' :
      d.reason === 'spent' ? 'Today’s points are already used. They reset at midnight Eastern.' :
      d.reason === 'closed' ? 'Voting has closed.' :
      d.reason === 'verify_required' ? 'Your session expired. Close this and verify your phone again.' :
      d.reason === 'network' ? 'We could not reach the server. Check your connection and try again.' :
      'Something went wrong. Please try again.';
  }

  function confirmStep() {
    step('confirm');
    track('verify_complete', { method: method || 'phone' });
  }

  /* The vote is the server's to accept. Nothing is marked done, stored or repainted until it
     has said so: no optimistic counting, and a failure says what went wrong rather than
     showing a confirmation that is not true. */
  function castVote() {
    if (!pending) return;
    var btn = $('[data-pc-cast]', vDlg);
    if (btn) { btn.disabled = true; btn.textContent = 'Recording…'; }
    var who = pending;
    fetch(API, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entrant: who.id, voter: voterClaim(), csrf: me.csrf })
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, reason: 'network' }; });
    }).then(function (d) {
      if (btn) { btn.disabled = false; btn.textContent = 'Confirm my vote'; }
      if (d && d.ok) {
        var nameEl = $('[data-pc-done-name]', vDlg);
        if (nameEl) nameEl.textContent = who.name;
        var forEl = $('[data-pc-done-for]', vDlg);
        if (forEl) forEl.textContent = 'Your vote for ' + who.name + ' at ' + who.company +
          ' has been recorded. Now come and experience what’s next.';
        /* "Come back tomorrow" only when the active configuration actually permits it. Under
           the approved one-vote rule it would be a lie, so it stays hidden. */
        var again = $('[data-pc-done-again]', vDlg);
        if (again) {
          var more = d.mode === 'daily' && typeof d.remaining === 'number';
          if (more && d.remaining > 0) {
            again.textContent = 'You have ' + d.remaining +
              (d.remaining === 1 ? ' more vote' : ' more votes') + ' today.';
            again.hidden = false;
          } else if (more && d.next_window) {
            again.textContent = 'That is your allowance for today. Come back after midnight Eastern to vote again.';
            again.hidden = false;
          } else {
            again.hidden = true;
          }
        }
        step('done');
        paintBonus();          // invitation, or "already linked", decided by the server
        track('vote_success', { entrant_id: who.id, entrant_slot: who.n,
                                simulated: !!d.simulated, mode: d.mode });
        repaintAfterVote();
        return;
      }
      /* The server refused. Ask it what this voter's position actually is and show that,
         rather than assuming a refusal means there is nothing left to do -- an allowance
         spent at the phone tier is precisely the person with two bonus points waiting. */
      var why = d && d.reason;
      if (why === 'allowance' || why === 'duplicate') {
        track(why === 'duplicate' ? 'vote_duplicate_blocked' : 'vote_allowance_spent',
              { entrant_id: who.id });
        refreshMe().then(function (me2) {
          var to = routeFor(me2, who.id);
          if (to === 'all-done') paintSummary(me2);
          if (to === 'other') paintOther(me2);
          step(to === 'confirm' ? 'all-done' : to);
          if (to === 'voted-bonus') paintVotedBonus(me2);
          repaintAfterVote();
        });
        return;
      }
      var e = $('[data-pc-error-cast]', vDlg);
      if (e) {
        e.textContent = why === 'closed' ? 'Voting is not open. Nothing was recorded.'
          : why === 'rate' ? 'Too many attempts from this connection. Try again shortly.'
          : 'That did not go through, and no vote was recorded. Please try again.';
        e.hidden = false;
      }
      track('vote_failed', { entrant_id: who.id, reason: why || 'unknown' });
    }).catch(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'Confirm my vote'; }
      var e = $('[data-pc-error-cast]', vDlg);
      if (e) { e.textContent = 'No connection, so no vote was recorded. Please try again.'; e.hidden = false; }
      track('vote_failed', { reason: 'network' });
    });
  }

  /* The gallery, painted from the SERVER's account of the day rather than a note the page
     wrote to itself.

     This used to disable every vote button the moment a ballot existed locally, and label
     them all "You have already voted" -- including the founder the vote went to. True of the
     regular point and wrong about everything else: it walled off the one card that still had
     two bonus points waiting behind it, leaving no way back in. The dialog had already been
     taught to route on server state; the gallery in front of it had not, and the gallery is
     what people actually look at.

     The founder who received today's vote keeps a live button. Everyone else is told the
     daily vote is spent, and every profile stays open and shareable either way. */
  /* A card's button is small and says "Vote"; the profile's is full width and says the whole
     phrase. cardHtml already draws that difference, so the labeller has to preserve it --
     otherwise the repaint on load rewrites twenty cards into the long version, which is both
     a copy change nobody asked for and a visible flicker. */
  function idleLabel(b) {
    return (STATE === 'open' && b.closest('.pce')) ? 'Vote' : COPY[STATE].vote;
  }

  function labelVoteButton(b, d) {
    var id = b.getAttribute('data-pc-vote');
    var today = (d && d.verified) ? (d.today_entrant || null) : null;
    if (STATE !== 'open') {
      b.disabled = true; b.classList.remove('btn--ghost'); b.textContent = idleLabel(b); return;
    }
    if (!today) {
      b.disabled = false; b.classList.remove('btn--ghost'); b.textContent = idleLabel(b); return;
    }
    if (id === today) {
      /* The founder today's vote went to. Never disabled: this is the way back into the
         bonus, and the only door to it. Solid, because on a page of twenty cards it is now
         the only thing a voter can usefully press. */
      var bonusOpen = !!(d.bonus_claimable || d.bonus_eligible);
      var used = typeof d.used === 'number' ? d.used : 1;
      b.disabled = false;
      b.classList.remove('btn--ghost');
      b.textContent = bonusOpen ? 'View my vote & +2 bonus'
        : 'View my ' + used + (used === 1 ? ' point' : ' points');
    } else {
      /* Every other founder. Still live, deliberately: a disabled button says "no" and
         nothing else, while this one opens a screen that says where today's points went and
         offers the way back to them. Opening it records nothing.

         Outlined rather than solid. Live is not the same as inviting, and nineteen solid
         buttons shouting a statement of fact would bury the one that is an actual offer. */
      b.disabled = false;
      b.classList.add('btn--ghost');
      b.textContent = 'Today’s vote is used';
    }
  }

  function paintVoteButtons(d) {
    $$('[data-pc-vote]').forEach(function (b) {
      if (b.closest('[data-pc-step]')) return;   // the dialog's own buttons route themselves
      labelVoteButton(b, d);
    });
  }

  /* Ask the server, then paint. */
  function repaintAfterVote() {
    return refreshMe().then(paintVoteButtons);
  }

  /* ---------- 8. the share sheet ---------- */
  var sDlg = $('[data-pc-share-dialog]');
  function openShare(id) {
    var e = byId[id];
    var url = e ? shareUrl(e) : location.origin + location.pathname;
    var text = e
      ? 'Back ' + e.name + ' in the NextGen Summit People’s Choice Award.'
      : 'Vote in the NextGen Summit People’s Choice Award.';
    $('[data-pc-share-url]', sDlg).textContent = url;
    $('[data-pc-share-wa]', sDlg).href = 'https://wa.me/?text=' + encodeURIComponent(text + ' ' + (e ? shareUrl(e, 'whatsapp') : url));
    $('[data-pc-share-li]', sDlg).href = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(e ? shareUrl(e, 'linkedin') : url);
    $('[data-pc-share-x]', sDlg).href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(e ? shareUrl(e, 'x') : url);
    var nat = $('[data-pc-share-native]', sDlg);
    if (nat) {
      nat.hidden = typeof navigator.share !== 'function';
      nat.onclick = function () {
        navigator.share({ title: e ? e.name : 'NextGen People’s Choice', text: text, url: url })
          .then(function () { track('share_native', e ? { entrant_id: e.id } : {}); })
          .catch(function () {});
      };
    }
    var copy = $('[data-pc-share-copy]', sDlg);
    copy.textContent = 'Copy link';
    copy.setAttribute('data-url', url);
    if (!sDlg.open) { if (sDlg.showModal) sDlg.showModal(); else sDlg.setAttribute('open', ''); }
    track('share_open', e ? { entrant_id: e.id } : {});
  }

  /* ---------- 9. one listener for the lot ---------- */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target : ev.target.parentNode;
    if (!t || !t.closest) return;
    var el;

    if ((el = t.closest('[data-pc-open]'))) {
      opener = el; openProfile(el.getAttribute('data-pc-open')); return;
    }
    if ((el = t.closest('[data-pc-watch]'))) {
      opener = el;
      var wid = el.getAttribute('data-pc-watch');
      openProfile(wid);
      var poster = $('[data-pc-play]', pDlg);
      if (poster && !poster.disabled) poster.click();
      return;
    }
    if ((el = t.closest('[data-pc-play]'))) {
      if (el.disabled) return;
      var pe = byId[el.getAttribute('data-pc-play')];
      if (!pe || !pe.video) return;
      var src = embedSrc(pe.video);
      if (!src) return;
      $('[data-pc-p-video]', pDlg).innerHTML =
        '<iframe src="' + src + '" title="Pitch video: ' + pe.name + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
      track('video_play', { entrant_id: pe.id });
      return;
    }
    /* Must be tested BEFORE [data-pc-vote]: this button sits inside the vote dialog and
       re-enters the flow on a different founder, which is exactly what openVote does. */
    if ((el = t.closest('[data-pc-other-go]'))) {
      var mine = el.getAttribute('data-pc-other-go');
      if (mine) openVote(mine);
      return;
    }
    if ((el = t.closest('[data-pc-vote]'))) {
      if (el.disabled) return;
      openVote(el.getAttribute('data-pc-vote')); return;
    }
    if (t.closest('[data-pc-phone-send]')) {
      var f = $('[data-pc-phone]', vDlg), err = $('[data-pc-error-phone]', vDlg);
      err.hidden = true;
      if (!f.value.replace(/\D/g, '')) {
        err.textContent = 'Enter your mobile number.'; err.hidden = false; return;
      }
      var btn = t.closest('[data-pc-phone-send]');
      btn.disabled = true; btn.textContent = 'Sending…';
      post('start', { phone: f.value }).then(function (d) {
        btn.disabled = false; btn.textContent = 'Send my code';
        if (!d.ok) {
          err.textContent = otpStartMsg(d);
          err.hidden = false;
          track('otp_start_failed', { reason: d.reason });
          return;
        }
        lastPhone = f.value;
        holdResend(60);          // the server's cooldown, shown rather than discovered
        $('[data-pc-phone-mask]', vDlg).textContent = d.phone || 'your phone';
        var tc = $('[data-pc-test-code]', vDlg);
        if (d.test_code) {
          tc.innerHTML = '⚠ ' + d.test_note + ' Code:<b>' + d.test_code + '</b>';
          tc.hidden = false;
        } else { tc.hidden = true; }
        step('phone-code');
        track('otp_start', { mock: !!d.mock });
      });
      return;
    }
    if (t.closest('[data-pc-resend]')) {
      /* It used to send the voter back to the number screen, which is "change number", not
         "resend" -- the label promised one thing and did another. This asks for another code
         for the same number and then holds the button for the server's cooldown, so the
         countdown on screen matches the rule that will actually be applied. */
      var rb = t.closest('[data-pc-resend]');
      if (rb.disabled) return;
      var rerr = $('[data-pc-error-code]', vDlg);
      if (rerr) rerr.hidden = true;
      rb.disabled = true; rb.textContent = 'Sending…';
      post('start', { phone: lastPhone }).then(function (d) {
        if (!d.ok) {
          if (rerr) { rerr.textContent = otpStartMsg(d); rerr.hidden = false; }
          holdResend(typeof d.wait === 'number' && d.wait > 0 ? d.wait : 60);
          return;
        }
        holdResend(60);
      });
      return;
    }
    if (t.closest('[data-pc-code-check]')) {
      var c = $('[data-pc-smscode]', vDlg), ce = $('[data-pc-error-code]', vDlg);
      ce.hidden = true;
      var cb = t.closest('[data-pc-code-check]');
      cb.disabled = true; cb.textContent = 'Checking…';
      post('check', { code: c.value }).then(function (d) {
        cb.disabled = false; cb.textContent = 'Verify my number';
        if (!d.ok) {
          ce.textContent =
            d.reason === 'expired' ? 'That code has expired. Ask for a new one.' :
            d.reason === 'too_many' ? 'Too many attempts. Start again with your number.' :
            d.reason === 'format' ? 'Enter the six digits from the message.' :
            d.reason === 'no_pending' ? 'Ask for a code first.' :
            'That code did not match.' + (typeof d.tries_left === 'number' ? ' ' + d.tries_left + ' left.' : '');
          ce.hidden = false;
          track('otp_check_failed', { reason: d.reason });
          return;
        }
        me = d;
        method = 'phone';
        track('otp_verified', { mock: d.sms === 'mock' });
        confirmStep();
      });
      return;
    }
    /* One route in. The Google and email branches that used to live here signed nobody in:
       Google went straight to the confirmation and email accepted any six digits. Both are
       gone, so the only way to a ballot is a code we actually sent. */
    if ((el = t.closest('[data-pc-begin]'))) {
      var ch = el.getAttribute('data-pc-begin') || 'sms';
      if (ch === 'sms' && me.sms !== 'live') return;     // not offered when it cannot work
      method = ch === 'email' ? 'email' : 'phone';
      track('verify_start', { method: method });
      step(ch === 'email' ? 'email' : 'phone');
      return;
    }
    if (t.closest('[data-pc-vemail-send]')) {
      var ve = $('[data-pc-vemail]', vDlg), vee = $('[data-pc-error-vemail]', vDlg);
      vee.hidden = true;
      var vb = t.closest('[data-pc-vemail-send]');
      if (vb.disabled) return;
      vb.disabled = true; vb.textContent = 'Sending…';
      lastEmail = (ve.value || '').trim();
      post('email_start', { email: lastEmail }).then(function (d) {
        vb.disabled = false; vb.textContent = 'Send my code';
        if (!d.ok) { vee.textContent = emailMsg(d); vee.hidden = false; return; }
        $('[data-pc-vemail-mask]', vDlg).textContent = d.mask || lastEmail;
        holdEmailResend(60);
        step('email-code');
        track('email_otp_sent', {});
      });
      return;
    }
    if (t.closest('[data-pc-vemail-resend]')) {
      var rb2 = t.closest('[data-pc-vemail-resend]');
      if (rb2.disabled) return;
      var re2 = $('[data-pc-error-vemailcode]', vDlg);
      if (re2) re2.hidden = true;
      rb2.disabled = true; rb2.textContent = 'Sending…';
      post('email_start', { email: lastEmail }).then(function (d) {
        if (!d.ok && re2) { re2.textContent = emailMsg(d); re2.hidden = false; }
        holdEmailResend(typeof d.wait === 'number' && d.wait > 0 ? d.wait : 60);
      });
      return;
    }
    if (t.closest('[data-pc-vemail-check]')) {
      var vc = $('[data-pc-vemailcode]', vDlg), vce = $('[data-pc-error-vemailcode]', vDlg);
      vce.hidden = true;
      var vcb = t.closest('[data-pc-vemail-check]');
      if (vcb.disabled) return;
      vcb.disabled = true; vcb.textContent = 'Checking…';
      post('email_check', { code: vc.value }).then(function (d) {
        vcb.disabled = false; vcb.textContent = 'Verify my email';
        if (!d.ok) { vce.textContent = emailMsg(d); vce.hidden = false; return; }
        me.verified = true;
        track('email_otp_verified', {});
        /* Verifying never casts anything. Ask the server where this voter now stands and go
           to whichever screen that is -- usually the confirmation, with the vote still to be
           pressed. */
        var who = pending;
        refreshMe().then(function (m2) {
          var to = routeFor(m2, who ? who.id : '');
          if (to === 'all-done') paintSummary(m2);
          step(to === 'confirm' ? 'confirm' : to);
        });
      });
      return;
    }
    if (t.closest('[data-pc-bonus-recheck]')) { paintBonus(true); return; }
    if (t.closest('[data-pc-bonus-other]')) { step('bonus-email'); return; }
    if (t.closest('[data-pc-bonus-later]') || t.closest('[data-pc-bonus-cancel]')) {
      step('done'); paintBonus(); return;
    }
    if (t.closest('[data-pc-ebmail-send]')) {
      var em = $('[data-pc-ebmail]', vDlg), eme = $('[data-pc-error-ebmail]', vDlg);
      eme.hidden = true;
      var b1 = t.closest('[data-pc-ebmail-send]');
      b1.disabled = true; b1.textContent = 'Sending…';
      bonusEmail = (em.value || '').trim();
      bpost('lookup', { email: bonusEmail }).then(function (d) {
        b1.disabled = false; b1.textContent = 'Send my code';
        if (!d.ok) { bonusErr('[data-pc-error-ebmail]', d); return; }
        if (d.already) { step('bonus-confirm'); return; }
        var mask = $('[data-pc-ebmail-mask]', vDlg);
        if (mask) mask.textContent = bonusEmail;
        step('bonus-code');
      });
      return;
    }
    if (t.closest('[data-pc-ebcode-check]')) {
      var cc = $('[data-pc-ebcode]', vDlg), cce = $('[data-pc-error-ebcode]', vDlg);
      cce.hidden = true;
      var b2 = t.closest('[data-pc-ebcode-check]');
      b2.disabled = true; b2.textContent = 'Checking…';
      bpost('check', { code: (cc.value || '') }).then(function (d) {
        b2.disabled = false; b2.textContent = 'Verify my registration';
        if (!d.ok) { bonusErr('[data-pc-error-ebcode]', d); return; }
        step('bonus-confirm');          // verified, and nothing awarded until they ask
      });
      return;
    }
    if (t.closest('[data-pc-ebclaim]')) {
      var scope = liveStep();
      var ce = $('[data-pc-error-ebclaim]', scope) || $('[data-pc-error-ebclaim-c]', scope);
      if (ce) ce.hidden = true;
      var b3 = t.closest('[data-pc-ebclaim]');
      var was = b3.textContent;          // restore THIS button's wording, not a third variant
      b3.disabled = true; b3.textContent = 'Adding…';
      bpost('claim').then(function (d) {
        b3.disabled = false; b3.textContent = was;
        if (!d.ok) {
          if (ce) { ce.textContent = bonusText(d); ce.hidden = false; }
          return;
        }
        var tot = $('[data-pc-bonus-total]', vDlg);
        if (tot) tot.textContent = '+' + (d.used || 3) + ' points';
        var bp = $('[data-pc-bonus-done-p]', vDlg);
        if (bp) bp.textContent = 'That is your full allowance for today. Come back tomorrow after midnight Eastern for three more.';
        track('bonus_claimed', { awarded: d.awarded });
        step('bonus-done');
        paintBonus();
      });
      return;
    }
    if (t.closest('[data-pc-cast]')) { castVote(); return; }
    if ((el = t.closest('[data-pc-back]'))) { step(el.getAttribute('data-pc-back')); return; }
    if (t.closest('[data-pc-close-vote]')) { vDlg.close(); return; }
    if (t.closest('[data-pc-close-profile]')) { closeProfile(); return; }
    if (t.closest('[data-pc-close-share]')) { sDlg.close(); return; }
    if ((el = t.closest('[data-pc-share]'))) { openShare(el.getAttribute('data-pc-share')); return; }
    if (t.closest('[data-pc-share-page]')) { openShare(null); return; }
    if ((el = t.closest('[data-pc-share-copy]'))) {
      var u = el.getAttribute('data-url');
      try {
        navigator.clipboard.writeText(u).then(function () { el.textContent = 'Link copied'; });
      } catch (e2) { el.textContent = u; }
      track('share_copy'); return;
    }
    if (t.closest('[data-pc-tickets]')) { track('tickets_click', { from: 'peoples_choice_vote' }); return; }
  });

  // the backdrop closes a dialog, the card inside it never does
  [pDlg, vDlg, sDlg].forEach(function (d) {
    if (!d) return;
    d.addEventListener('click', function (ev) { if (ev.target === d) d.close(); });
  });

  /* ---------- 10. the page furniture ---------- */
  function paintFurniture() {
    $$('[data-pc-state]').forEach(function (n) {
      n.setAttribute('data-state', STATE);
      var label = $('[data-pc-state-label]', n);
      if (label) label.textContent = COPY[STATE].pill;
    });
    var note = COPY[STATE].note;
    if (STATE === 'open' && MODE === 'single') {
      note = 'One verified person, one vote, for the whole competition.';
    }
    $$('[data-pc-state-note]').forEach(function (n) { n.textContent = note; });
  }
  paintFurniture();

  // the countdown, only when there is something to count to
  /* The countdown runs to an absolute instant the server worked out in Eastern time, so it is
     the same moment for a visitor in Maryland and one in Lagos. Seconds tick, and when it
     reaches zero the page asks the server what the state is now rather than deciding itself. */
  var clock = $('[data-pc-clock]');
  var clockTimer = null;
  function startClock() {
    if (!clock) return;
    clearInterval(clockTimer);
    if (!DEADLINE) { clock.hidden = true; return; }
    var end = new Date(DEADLINE).getTime();
    if (isNaN(end)) { clock.hidden = true; return; }
    var closed = false;
    var tick = function () {
      var left = end - Date.now();
      if (left <= 0) {
        clock.hidden = true;
        if (!closed) {
          closed = true;
          STATE = 'closed';
          grid.innerHTML = ENTRANTS.map(cardHtml).join('');
          paintFurniture();
          track('voting_closed_locally');
        }
        return;
      }
      var d = Math.floor(left / 864e5), h = Math.floor(left / 36e5) % 24,
          m = Math.floor(left / 6e4) % 60, sec = Math.floor(left / 1e3) % 60;
      $('[data-pc-clock-v]', clock).innerHTML =
        d + '<span>d</span> ' + h + '<span>h</span> ' + m + '<span>m</span> ' + sec + '<span>s</span>';
      clock.hidden = false;
    };
    tick();
    clockTimer = setInterval(tick, 1000);
  }
  startClock();

  repaintAfterVote();

  /* A shared link opens straight onto that pitch -- either a contestant's own page, where the
     server left the id on the window, or a #fragment on the gallery. */
  function fromHash() {
    var id = location.hash.replace('#', '');
    if (byId[id]) openProfile(id, true);
  }
  addEventListener('hashchange', fromHash);
  if (window.__pcOpen && byId[window.__pcOpen]) {
    openProfile(window.__pcOpen, true);
    track('entrant_link_visit', { entrant_id: window.__pcOpen, source: window.__pcSource || 'direct' });
  } else {
    fromHash();
  }

  /* The competition's state belongs to the server; the constant above is only the fallback
     for a page served before the endpoint answers. ?pc= still wins, for review. */
  if (!FORCED) {
    fetch(API, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) return;
        if (d.deadline && d.deadline !== DEADLINE) { DEADLINE = d.deadline; startClock(); }
        if (d.mode && d.mode !== MODE) { MODE = d.mode; paintFurniture(); }
        if (STATES.indexOf(d.state) < 0 || d.state === STATE) return;
        STATE = d.state;
        grid.innerHTML = ENTRANTS.map(cardHtml).join('');
        paintFurniture();
        repaintAfterVote();
      })
      .catch(function () {});
  }

  track('page_view', { state: STATE, entrants: ENTRANTS.length, simulated: true });
})();
