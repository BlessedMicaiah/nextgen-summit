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
      note: 'Your vote could change their future. Vote once a day through October 28!' },
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
      shot: null,
      shotFit: 'cover',
      video: null,
      videoUrl: null
    };
  }

  /* The real Top 20, written by tools/build-founders.py from the approved manifest and
     loaded as pc-founders.js before this file.

     The contestant id is NOT derived here. It comes from tools/founder-map.json, which a
     human reviews, because vote rows reference entrant-NN and an id invented from a
     spreadsheet's row order would quietly re-point votes at a different founder. A founder
     with no id keeps their placeholder slot and is visible but not votable.

     Nothing here is invented: a founder with no usable portrait gets a monogram, and one
     with no playable pitch gets an editorial card. Neither is dressed up as the real thing. */
  function fromManifest() {
    var src = window.NGS_FOUNDERS;
    if (!src || !src.length) return null;
    var byEntrant = {};
    src.forEach(function (f) { if (f.entrant) byEntrant[f.entrant] = f; });
    var out = [];
    for (var i = 1; i <= 20; i++) {
      var base = slot(i);
      var f = byEntrant[base.id];
      if (!f) { out.push(base); continue; }
      base.draft = false;
      base.slug = f.slug;
      base.name = f.name;
      base.company = f.company;
      base.blurb = f.blurb;
      base.summary = f.blurb;
      /* The biography is whatever the manifest actually carries, and for all twenty that
         is nothing: the submission form asked about the BUSINESS. Copying the business
         description in here is what printed one paragraph under both "The founder" and
         "The project" and made the card read as unfinished. No founder copy means the
         block stays shut, not padded. */
      base.bio = f.bio || null;
      base.shot = f.shot || null;
      /* The company mark, for the small thumbnail on the back of the card. Several of
         these were already in the project -- they had simply been placed on the FRONT,
         standing in for the founder's face. Nothing was re-sourced; they moved. */
      base.logo = f.logo || null;
      base.shotFit = f.shotFit || 'cover';
      base.focal = f.focal || '50% 42%';
      base.video = f.video || null;
      base.poster = f.poster || null;
      base.selfHosted = !!f.selfHosted;
      base.pitchNote = f.pitchNote || '';
      out.push(base);
    }
    return out;
  }
  var ENTRANTS = fromManifest();
  if (!ENTRANTS) {
    ENTRANTS = [];
    for (var i = 1; i <= 20; i++) ENTRANTS.push(slot(i));
  }

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

  /* ---------- 5. the founders ----------
     There is no second gallery any more, so there is no grid to find and nothing to bail
     out over. This guard used to read `if (!grid) return`, which with the grid removed
     would have stopped the entire People's Choice script -- voting included -- on a page
     that looked perfectly fine. */

  function initials(e) {
    return e.draft ? e.n : e.name.split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('');
  }

  /* The gallery card is gone with the gallery it filled. It carried the last arbitrary
     contestant number on the site -- the small circle in the corner of each tile -- and
     that markup and its styling are deleted rather than hidden. Founders are identified
     by their name and their company. The only number a visitor sees now is a position
     earned from counted points. */

  function shareIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'aria-hidden="true"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/>' +
      '<circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3"/></svg>';
  }


  $$('[data-pc-count]').forEach(function (n) { n.textContent = ENTRANTS.length; });

  /* ---------- 6. the profile ---------- */
  var pDlg = $('[data-pc-profile]');
  var opener = null;

  function playIcon() {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
  }
  /* Built only when someone asks for it, so twenty profiles cost no third-party request until
     a pitch is actually watched. youtube-nocookie and vimeo's dnt flag keep the player from
     profiling the viewer for us. */
  /* Four kinds of pitch arrived, because the submission form accepted whatever was to hand:
     a direct mp4 or mov, a YouTube id recovered from a filename or a .docx, a Google Drive
     file, and -- for four founders -- a PDF or an image that is not a pitch video at all.
     The first three play. The fourth gets an editorial card and is listed for the team. */
  function embedSrc(v, autoplay) {
    if (!v) return null;
    /* autoplay only when a play control was actually pressed. Opening a story is a tap on a
       founder, not a request for sound: the self-hosted pitches show their poster and wait,
       and an embed that started talking by itself would be the odd one out. */
    var ap = autoplay ? '1' : '0';
    if (v.type === 'youtube') {
      return 'https://www.youtube-nocookie.com/embed/' + v.id + '?autoplay=' + ap + '&rel=0';
    }
    if (v.type === 'vimeo') {
      return 'https://player.vimeo.com/video/' + v.id + '?autoplay=' + ap + '&dnt=1';
    }
    if (v.type === 'drive') return 'https://drive.google.com/file/d/' + v.id + '/preview';
    return null;   // 'file' is a <video>, not an iframe
  }

  function playerHtml(v, title, poster, autoplay) {
    if (!v) return '';
    if (v.type === 'file') {
      /* No autoplay. A pitch that starts talking the moment a card opens is startling on a
         phone and burns data nobody asked to spend; the poster stands in until someone
         presses play. preload=metadata fetches the header, not the file, so the duration
         and the scrub bar are right without pulling megabytes first. */
      return '<video src="' + v.src + '"' + (poster ? ' poster="' + poster + '"' : '') +
        ' controls playsinline preload="metadata" controlslist="nodownload"' +
        ' title="Pitch video: ' + esc(title) + '"></video>';
    }
    var src = embedSrc(v, autoplay);
    if (!src) return '';
    return '<iframe src="' + src + '" title="Pitch video: ' + esc(title) + '" ' +
      'allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
  }

  /* Founder copy is real text from the manifest and goes into innerHTML, so it is escaped
     here rather than trusted. An apostrophe in a business name should not be able to end an
     attribute. */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

  /* The founder card, painted into the speaker-card markup.

     Two faces, two different pieces of writing. The manifest describes the BUSINESS and
     says nothing about the person, so "The founder" is hidden rather than filled with the
     project copy a second time -- printing one paragraph under both headings is what made
     the old profile read as unfinished, and inventing a biography is not an option. Where
     the portrait is a frame lifted from the founder's own pitch the card says so. */
  function paintProfile(e) {
    /* Company and founder name appear on both faces, so they are set by selector across
       the whole dialog rather than once each. */
    $$('[data-pc-p-co]', pDlg).forEach(function (n) { n.textContent = e.company; });
    $$('[data-pc-p-name]', pDlg).forEach(function (n) { n.textContent = e.name; });

    /* The card's corner follows the reel's: once there are standings it shows the
       founder's position. Before that it keeps the contestant number, which on the card
       carries a label and identifies them in a field of twenty -- it is not the bare,
       unexplained badge leadership queried on the reel. */
    /* No contestant number anywhere a visitor can see it. The id still exists and is
       still what every vote, share link and database row is keyed on -- it simply is not
       something the public needs, and leadership asked for it gone. The corner carries
       the founder's POSITION once there are standings, and nothing at all before then. */
    var cst = standing(e);
    var corner = $('.fcd__when', pDlg);
    var num = $('[data-fcd-n]', pDlg);
    var numK = $('[data-fcd-k]', pDlg);
    if (corner) corner.hidden = !cst;
    if (num) num.textContent = cst ? cst.label : '';
    if (numK) numK.textContent = cst && cst.detail ? cst.detail : 'Position';

    /* The front previews, the back explains. Every one of the twenty descriptions turned
       out to be a single sentence -- measured, not assumed -- so there is no second
       sentence to hold back. The front therefore shows the same copy clamped to two
       lines, which reads as the preview it is, and the back gives it in full.

       What is NOT duplicated any more is "The founder" against "The project": the
       biography is only ever the manifest's own, and the manifest has none. */
    var blurb = $('[data-fcd-blurb]', pDlg);
    if (blurb) blurb.textContent = e.blurb || '';

    /* the portrait, and an honest monogram when there is no portrait to show */
    var shot = $('[data-pc-p-shot]', pDlg);
    var img = shot ? $('img', shot) : null;
    var mono = $('[data-fcd-mono]', pDlg);
    if (img) {
      if (e.shot) {
        img.src = e.shot;
        img.alt = e.company + ' - ' + e.name;
        img.hidden = false;
        if (e.shotFit !== 'contain' && e.focal) img.style.objectPosition = e.focal;
        else img.style.objectPosition = '';
        shot.classList.toggle('is-contain', e.shotFit === 'contain');
      } else {
        img.removeAttribute('src');
        img.hidden = true;
        shot.classList.remove('is-contain');
      }
    }
    if (mono) { mono.hidden = !!e.shot; mono.textContent = initials(e); }

    /* Back of the card: the company's logo where one exists, the founder's own
       photograph where one does not. A logo is contained so it keeps its proportions
       and its whitespace; a photograph is covered and framed on its focal point. */
    var thumb = $('[data-fcd-thumb]', pDlg);
    var timg = thumb ? $('img', thumb) : null;
    if (timg) {
      var art = e.logo || e.shot;
      if (art) { timg.src = art; timg.hidden = false; }
      else { timg.removeAttribute('src'); timg.hidden = true; }
      thumb.classList.toggle('is-contain', !!e.logo || e.shotFit === 'contain');
      /* A logo sits in a square; a founder's photograph keeps the 3:4 it was shot in.
         Every logo panel is the same size, the same padding and the same corner. */
      thumb.classList.toggle('is-logo', !!e.logo);
      timg.alt = e.logo ? (e.company + ' logo') : '';
    }

    /* "The founder": shown only when there is verified copy about the person. */
    var bioEl = $('[data-pc-p-bio]', pDlg);
    if (bioEl) {
      bioEl.textContent = e.bio || '';
      var bioBlock = bioEl.closest('[data-pc-p-bio-block]') || bioEl.parentNode;
      if (bioBlock) bioBlock.hidden = !e.bio;
    }
    $('[data-pc-p-sum]', pDlg).textContent = e.summary || e.blurb || '';

    var flag = $('[data-pc-p-flag]', pDlg);
    if (flag) flag.hidden = !e.draft;

    /* Watch the pitch returns to this founder in the feed rather than opening a second
       player inside the card. One place where the pitches play, so closing the card always
       puts the visitor back where the video is. */
    var watch = $('[data-fcd-watch]', pDlg);
    if (watch) {
      watch.setAttribute('data-fcd-watch', e.id);
      watch.hidden = !e.video;
    }

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
    pDlg.setAttribute('aria-label', e.company + ', ' + e.name);
  }

  /* ---- the turn ----
     The stylesheet does the rotating and decides which face is on screen; this keeps the
     reading order and the tab order honest about which one that is. Lifted from
     speakers.js so the two card systems behave identically. */
  var fcdFront = $('[data-fcd-front]', pDlg);
  var fcdBack = $('[data-fcd-back]', pDlg);

  function fcdFace(isBack) {
    pDlg.classList.toggle('is-back', isBack);
    if (!fcdFront || !fcdBack) return;
    fcdFront.setAttribute('aria-hidden', String(isBack));
    fcdBack.setAttribute('aria-hidden', String(!isBack));
    $$('a,button', isBack ? fcdFront : fcdBack).forEach(function (n) { n.setAttribute('tabindex', '-1'); });
    $$('a,button', isBack ? fcdBack : fcdFront).forEach(function (n) { n.removeAttribute('tabindex'); });
  }

  /* The card grows out of whatever was tapped and shrinks back into it on the way out --
     the same morph the speaker deck uses. The centre is read from the screen, the width
     from layout, and both faces are 5:7 so one scale fits. */
  var fcdIn = $('.fcd__in', pDlg);
  var fcdCanMorph = !matchMedia('(prefers-reduced-motion: reduce)').matches
    && fcdIn && typeof fcdIn.animate === 'function';
  var fcdLeaving = false;

  function fcdSlot(btn) {
    var a = btn.getBoundingClientRect(), b = fcdIn.getBoundingClientRect();
    if (!a.width || !b.width) return 'none';
    return 'translate(' + ((a.left + a.width / 2) - (b.left + b.width / 2)) + 'px,' +
      ((a.top + a.height / 2) - (b.top + b.height / 2)) + 'px) scale(' +
      (a.width / (b.width || 1)) + ')';
  }

  function openProfile(id, viaHash) {
    var e = byId[id];
    if (!e) return;
    paintProfile(e);
    fcdLeaving = false;
    fcdFace(false);                                    // every opening starts on the front
    var morph = fcdCanMorph && opener && opener.isConnected && !pDlg.open;
    pDlg.classList.toggle('is-morph', !!morph);
    if (!pDlg.open) {
      if (typeof pDlg.showModal === 'function') pDlg.showModal();
      else pDlg.setAttribute('open', '');
    }
    if (morph) {
      fcdIn.animate([{ transform: fcdSlot(opener) }, { transform: 'none' }],
        { duration: 620, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
    /* Inside the immersive feed the hash is the feed's business, not the card's: rewriting
       it here would fight the deep link the visitor arrived on. */
    if (!viaHash && !reelLive && location.hash !== '#' + id) {
      history.replaceState(history.state, '', '#' + id);
    }
    track('profile_view', { entrant_id: id, entrant_slot: e.n });
  }

  function closeProfile() {
    if (!pDlg.open || fcdLeaving) return;
    if (!fcdCanMorph || !opener || !opener.isConnected) { pDlg.close(); return; }
    fcdLeaving = true;
    pDlg.classList.add('is-closing');
    var shut = function () { if (pDlg.open) pDlg.close(); };
    var run = fcdIn.animate([{ transform: 'none' }, { transform: fcdSlot(opener) }],
      { duration: 420, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' });
    run.onfinish = run.oncancel = shut;
    /* And a hard backstop. An animation only finishes if the page is being composited,
       and a page that is hidden, occluded or throttled is not -- measured here: the card
       stayed open because onfinish never arrived. A card whose only exit depends on an
       animation completing is a card that can trap someone, so the close happens on time
       whether the animation got there or not. */
    setTimeout(shut, 520);
  }

  /* Escape leaves the same way the close button does, so the card still shrinks back into
     the thing it came out of rather than vanishing. */
  pDlg.addEventListener('cancel', function (ev) {
    if (!fcdCanMorph || fcdLeaving) return;
    ev.preventDefault();
    closeProfile();
  });

  pDlg.addEventListener('close', function () {
    fcdFace(false);                                    // reset for the next one
    if (fcdIn && fcdIn.getAnimations) fcdIn.getAnimations().forEach(function (a) { a.cancel(); });
    pDlg.classList.remove('is-closing', 'is-morph');
    fcdLeaving = false;
    /* The hash belongs to the feed while the feed is open. */
    if (!reelLive && location.hash) {
      history.replaceState(history.state, '', location.pathname + location.search);
    }
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  });

  /* The card itself never closes the dialog; the area outside it does. */
  pDlg.addEventListener('click', function (ev) {
    if (!ev.target.closest) return;
    if (ev.target.closest('.fcd__in')) return;
    closeProfile();
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
    /* Same contradiction as the bonus screens: this is where a verified attendee lands once
       they have given all three, and it was offering to sell them the ticket they used. */
    $$('[data-pc-tickets]', vDlg).forEach(function (n) {
      n.hidden = !!(d && d.ticket_verified);
    });
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
      d.reason === 'not_allowlisted' ? 'This number is not approved for text messages yet.' :
      d.reason === 'budget' ? 'The message allowance has been used up for now. Please try again later.' :
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
    $$('[data-pc-tickets]', vDlg).forEach(function (n) { n.hidden = false; });
    bpost('auto').then(function (d) {
      /* On staging the server says WHY, and this puts it on the screen rather than leaving it
         in a response nobody reads. "We could not check" with no detail is what turned a
         fatal error into a week of guessing. Production sends no code, so this stays hidden. */
      /* eb is only sent on a successful lookup, so the first version of this line could not
         describe the very failure it was added for. reason covers the rest. */
      /* The reason code is kept, but no longer printed at the visitor.

         "http_500" is support information, not a message for someone who came to vote; they
         already have a plain sentence and a Try again button above it. The code now rides on
         a data attribute, readable in developer tools by whoever is helping, and nothing
         technical reaches the page. */
      var why = d && (d.eb || d.reason);
      $$('[data-pc-bonus-why]', vDlg).forEach(function (n) {
        n.textContent = '';
        n.hidden = true;
        if (why) { n.setAttribute('data-why', String(why)); }
        else { n.removeAttribute('data-why'); }
      });
      if (!d || !d.ok) { only('[data-pc-bonus-down]'); return; }
      if (d.mode !== 'daily') { only(''); return; }
      if (d.status === 'verified') {
        /* They hold a ticket. Hiding the ticket link is not decoration: a page that confirms
           the registration in one paragraph and offers to sell them one in the next reads as
           though the confirmation is not believed. */
        $$('[data-pc-tickets]', vDlg).forEach(function (n) { n.hidden = true; });
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
          /* This line is about the REGULAR vote and must say so.

             It used to read "That is your allowance for today" to anyone whose daily point
             was spent -- including the voter standing one click away from two bonus points,
             with the offer of them printed directly underneath. The two statements
             contradicted each other on the same screen, and the flat one came first.

             A spent allowance at the +1 tier is not a spent allowance. Say when the next
             regular vote unlocks, and leave the bonus to speak for itself. */
          var more = d.mode === 'daily' && typeof d.remaining === 'number';
          if (more && d.remaining > 0) {
            again.textContent = 'You have ' + d.remaining +
              (d.remaining === 1 ? ' more vote' : ' more votes') + ' today.';
            again.hidden = false;
          } else if (more && d.next_window) {
            again.textContent = 'Come back tomorrow to show your support again.';
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
  /* A gallery card has the founder's name beside it, so its button only needs the verb.
     The founder card is a page of its own, so it says who the vote is for. Anywhere a
     button carries data-pc-idle, that is the wording while voting is open; everything
     else -- closed, already voted, not opened yet -- is still the one shared copy, so
     there is no second place for the voting states to drift. */
  function idleLabel(b) {
    if (STATE !== 'open') return COPY[STATE].vote;
    return b.getAttribute('data-pc-idle') || (b.closest('.pce') ? 'Vote' : COPY[STATE].vote);
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

  /* "Where you stand", in a line, from the server's account of this visitor and nothing
     else. Before the server has answered it says what the rule is rather than guessing at a
     status, because a wrong guess here is the whole class of bug this page has been fighting. */
  function paintStatus(d) {
    var el = $('[data-ff-status]');
    if (!el) return;
    var txt;
    if (STATE !== 'open') {
      txt = COPY[STATE].pill;
    } else if (!d || !d.verified) {
      txt = 'Verify once to vote';
    } else if (typeof d.remaining === 'number' && d.remaining > 0) {
      txt = d.remaining + (d.remaining === 1 ? ' point to give' : ' points to give');
    } else if (d.bonus_eligible) {
      txt = '+2 bonus available';
    } else {
      txt = 'Allowance given today';
    }
    el.textContent = txt;
  }

  /* The reel's vote control is an icon above a one-word label, not a wide button with a
     sentence in it. Writing the gallery wording into it with textContent wiped the icon and
     dropped "Vote for this pitch" across the founder's face. It gets the same server-driven
     STATE, said in the space it actually has. */
  function labelReelVote(b, d) {
    var small = $('small', b);
    if (!small) return;
    var id = b.getAttribute('data-pc-vote');
    var today = (d && d.verified) ? (d.today_entrant || null) : null;
    if (STATE !== 'open') { b.disabled = true; small.textContent = 'Closed'; return; }
    if (!today) { b.disabled = false; small.textContent = 'Vote'; return; }
    if (id === today) {
      b.disabled = false;
      b.classList.add('reel__act--on');
      small.textContent = (d.bonus_claimable || d.bonus_eligible) ? '+2 bonus' : 'Voted';
    } else {
      b.disabled = false;
      b.classList.remove('reel__act--on');
      small.textContent = 'Used';
    }
  }

  function paintVoteButtons(d) {
    paintStatus(d);
    $$('[data-pc-vote]').forEach(function (b) {
      if (b.closest('[data-pc-step]')) return;   // the dialog's own buttons route themselves
      if (b.closest('.reel__rail')) { labelReelVote(b, d); return; }
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
    /* The whole caption opens the card on a pointer device, which is what the cursor
       and the hover state already promise. Not on touch: there the caption sits under
       a thumb that is trying to scroll. */
    if ((el = t.closest('.reel__meta'))) {
      if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
        var mp = el.closest('[data-reel-panel]');
        var mid = mp && mp.getAttribute('data-reel-panel');
        if (mid && byId[mid]) { opener = el; openProfile(mid); return; }
      }
    }
    /* Watch the pitch, from anywhere: the feed is where the pitches play, so this takes
       the visitor there rather than opening a second player somewhere else. */
    if ((el = t.closest('[data-pc-watch]'))) {
      reelOpenAt(el.getAttribute('data-pc-watch'));
      return;
    }
    if ((el = t.closest('[data-fcd-watch]'))) {
      var fwid = el.getAttribute('data-fcd-watch');
      closeProfile();
      reelOpenAt(fwid);
      return;
    }
    if (t.closest('[data-fcd-turn]')) {
      fcdFace(!pDlg.classList.contains('is-back'));
      return;
    }
    if (t.closest('[data-ff-enter]')) { enterExperience(); return; }
    if (t.closest('[data-ff-clear]')) {
      if (searchBox) { searchBox.value = ''; searchBox.focus(); }
      applyFilter('');
      return;
    }
    if (t.closest('[data-ff-prev]')) { railStep(-1); return; }
    if (t.closest('[data-ff-next-rail]')) { railStep(1); return; }
    if (t.closest('[data-fci-skip]')) { introEnd(true); return; }
    if (t.closest('[data-reel-exit]')) { reelExit(); return; }
    if (t.closest('[data-reel-tap]')) { reelToggle(); return; }
    if ((el = t.closest('[data-deck-open]'))) { deckSpread(+el.getAttribute('data-deck-open')); return; }
    if (t.closest('[data-deck-close]')) { deckSpreadClose(); return; }
    if ((el = t.closest('[data-deck-pick]'))) {
      var did = el.getAttribute('data-deck-pick');
      deckSpreadClose();
      reelOpenAt(did);
      return;
    }
    if ((el = t.closest('[data-ff-story]'))) {
      /* One journey, not two. The bubble used to open a separate story viewer, which meant
         two competing ways to browse the same twenty founders. It now drops the visitor at
         that founder inside the feed. */
      var sid = el.getAttribute('data-ff-story');
      reelOpenAt(sid);
      track('story_jump', { entrant_id: sid });
      return;
    }
    if ((el = t.closest('[data-reel-embed]'))) {
      var rid = el.getAttribute('data-reel-embed');
      var re = byId[rid];
      var host = el.closest('.reel__media');
      if (re && re.video && host) {
        host.innerHTML = playerHtml(re.video, re.company, re.poster, true);
        track('video_play', { entrant_id: rid, kind: re.video.type });
      }
      return;
    }
    if (t.closest('[data-reel-sound]')) { reelSetSound(reelMuted); return; }
    if (t.closest('[data-reel-restart]')) {
      var first = $$('[data-reel-panel]', reelTrack)[0];
      if (first) {
        if (reelLive && reel) reel.scrollTo({ top: first.offsetTop, behavior: 'smooth' });
        else first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(reelQueue, 700);
      }
      return;
    }
    if (t.closest('[data-reel-top]') || t.closest('[data-reel-up]')) {
      if (reelLive) { reelExit(); return; }
      var top = $('#gallery');
      if (top) top.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (t.closest('[data-ff-next]')) { stepStory(1); return; }
    if (t.closest('[data-ff-prev]')) { stepStory(-1); return; }
    if (t.closest('[data-ff-close]')) { closeStory(); return; }
    if ((el = t.closest('[data-ff-profile]'))) {
      var pid = el.getAttribute('data-ff-profile');
      closeStory();
      if (byId[pid]) openProfile(pid);
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
        /* The founder comes from the server's answer -- d.entrant is the row pc-bonus.php read
           from the database -- so the name on the screen is the one the points went to, not a
           guess from whatever the page was last looking at. */
        var bwho = byId[d.entrant] || pending;
        $$('[data-pc-bonus-name]', vDlg).forEach(function (n) {
          n.textContent = bwho ? bwho.name : 'your founder';
        });
        var bshare = $('[data-pc-bonus-share]', vDlg);
        if (bshare && bwho) bshare.setAttribute('data-pc-share', bwho.id);
        var bp = $('[data-pc-bonus-done-p]', vDlg);
        if (bp) bp.textContent = 'Your vote and NextGen attendee bonus have been counted! Come back tomorrow to vote again and keep your favorite founder in the running.';
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

  /* ---------- the founder reels ----------

     The scrolling half of the experience. One panel per founder, snapped against the PAGE
     rather than a nested scroller, because a scroller of its own would hold the visitor
     until it ran out and the brief rules that out. Snapping is proximity, not mandatory, so
     a deliberate flick carries straight through into the rest of the page.

     What it does NOT do is cast, count or change a vote. The vote control here carries the
     same [data-pc-vote] the gallery card does and lands in the same dialog and the same
     verified flow. */

  var reel = $('[data-reel]');
  var RANK = null;          // the server's running order, fetched once per page load
  var reelTrack = $('[data-reel-track]');
  var reelMuted = true;
  var reelActive = null;

  /* "Tap" on a device with no touchscreen is an instruction the visitor cannot follow.
     Asked of the device rather than the screen width, because a touch laptop is both. */
  function exploreWord() {
    var fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
    return fine ? 'Click to explore this founder' : 'Tap to explore this founder';
  }

  function reelIcon(name) {
    var p = {
      vote: '<path d="M4.5 12.5l5 5 10-11" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
      share: '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3"/>',
      sound: '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/><path d="M16 9.2a4 4 0 0 1 0 5.6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
      mute: '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/><path d="M16.5 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
      play: '<path d="M8 5.2v13.6L19 12z" fill="currentColor"/>'
    }[name];
    var stroke = (name === 'share') ? ' fill="none" stroke="currentColor" stroke-width="1.9"' : '';
    return '<svg viewBox="0 0 24 24"' + stroke + ' aria-hidden="true">' + p + '</svg>';
  }

  /* 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th. The teens are the whole reason this is a
     function rather than a lookup on the last digit. */
  function ordinal(n) {
    n = Number(n) || 0;
    var t = n % 100;
    if (t >= 11 && t <= 13) return n + 'th';
    return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  }

  /* What a founder's standing says, if it says anything.

     Returns null when the server reports no meaningful standings -- which is the case
     until real voting separates anybody -- so every caller renders nothing rather than
     a place nobody has earned. */
  function standing(e) {
    if (!RANK || !RANK.ranked || !RANK.rank) return null;
    var place = RANK.rank[e.id];
    if (!place) return null;
    var pts = (RANK.points && RANK.points[e.id] != null) ? RANK.points[e.id] : null;
    var people = (RANK.voters && RANK.voters[e.id] != null) ? RANK.voters[e.id] : null;
    return {
      place: place,
      ordinal: ordinal(place),
      points: pts,
      voters: people,
      /* "points", not "votes": an attendee casts one choice worth three points, so the
         two numbers are different and saying either one for the other is wrong. */
      label: pts == null ? ordinal(place)
        : ordinal(place) + ' · ' + pts + (pts === 1 ? ' point' : ' points'),
      detail: (people == null) ? '' :
        people + (people === 1 ? ' voter' : ' voters')
    };
  }

  function reelPanelHtml(e, i) {
    var poster = e.poster || e.shot || '';
    var canVote = STATE === 'open';
    /* The media is decided here and not guessed at playback: a founder with a file plays
       inline, one on YouTube gets its embed behind a play control so nothing third-party
       loads until asked, and one with no pitch at all gets their portrait and their words
       rather than a broken frame. */
    var media;
    if (e.video && e.video.type === 'file') {
      media = '<video data-reel-video preload="none" playsinline muted loop ' +
        'poster="' + esc(poster) + '" data-src="' + esc(e.video.src) + '"></video>';
    } else if (e.video) {
      /* Two founders submitted no image at all and their pitch is on YouTube, so there is
         no frame of their own to borrow either. An <img src=""> is not a neutral blank --
         the browser resolves it to the page and draws a broken-image icon over the
         founder's panel. They get the monogram plate instead. */
      media = (poster
          ? '<img class="reel__still" src="' + esc(poster) + '" alt="" loading="lazy">'
          : '<span class="reel__plate"><span class="reel__mono">' + esc(initials(e)) + '</span></span>') +
        '<button class="reel__play" type="button" data-reel-embed="' + e.id + '" ' +
        'aria-label="Play the pitch from ' + esc(e.company) + '">' +
        '<span>' + reelIcon('play') + '</span></button>';
    } else {
      media = poster
        ? '<img class="reel__still" src="' + esc(poster) + '" alt="" loading="lazy">'
        : '<span class="reel__plate"><span class="reel__mono">' + esc(initials(e)) + '</span></span>';
    }
    /* A medal is a claim about the standings, so it only appears when the standings
       support one. With every founder level -- which is the case until real voting starts --
       RANK.ranked is false and nothing is shown, because "currently leading" over a field of
       zeroes would simply be untrue. Tied founders share a rank and get the same badge. */
    var st = standing(e);
    var place = st ? st.place : 0;
    var medal = '';
    if (st && place <= 3) {
      medal = '<span class="reel__medal reel__medal--' + place + '" data-reel-standing="' + e.id + '">' +
        '<b>' + st.ordinal + '</b> ' + (st.points == null ? 'place'
          : st.points + (st.points === 1 ? ' point' : ' points')) + '</span>';
    }
    /* The corner badge is the founder's POSITION, not their contestant number.

       Leadership asked what the number was for and the honest answer was nothing -- a
       visitor has no use for "entrant 01". It carries the standing instead, and when
       there is no standing to carry, because every founder is still level, it is not
       rendered at all rather than inventing a rank nobody has earned. The top three
       have the medal above, so no panel states its position twice. */
    var badge = (st && place > 3)
      ? '<span class="reel__num" data-reel-standing="' + e.id + '">' + st.label + '</span>'
      : '';
    return '' +
      '<li class="reel__panel' + (place && place <= 3 ? ' reel__panel--p' + place : '') +
        '" data-reel-panel="' + e.id + '" data-pc-card="' + e.id + '">' +
        medal +
        (poster ? '<span class="reel__back" style="background-image:url(&quot;' + esc(poster) + '&quot;)"></span>' : '') +
        '<span class="reel__media">' + media + '</span>' +
        '<span class="reel__scrim"></span>' +
        /* A tap anywhere on the footage holds it, the way a reel does. Only for the
           pitches we serve ourselves -- an embed owns its own surface and putting a
           transparent button over it would just break YouTube's controls. */
        (e.video && e.video.type === 'file'
          ? '<button class="reel__tap" type="button" data-reel-tap aria-label="Pause or resume this pitch">' +
            '<span aria-hidden="true">' + reelIcon('play') + '</span></button>' +
            '<span class="reel__wait" aria-hidden="true"></span>'
          : '') +
        badge +
        '<div class="reel__meta">' +
          '<p class="reel__co">' + esc(e.company) + '</p>' +
          '<p class="reel__by">' + esc(e.name) + '</p>' +
          '<p class="reel__blurb">' + esc(e.blurb) + '</p>' +
          '<button class="reel__meet" type="button" data-pc-open="' + e.id + '">' + exploreWord() + '</button>' +
        '</div>' +
        (i === 0
          ? '<span class="reel__hint" aria-hidden="true">Swipe for the next' +
            '<i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
            'stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14m-6-6 6 6 6-6"/></svg></i></span>'
          : '') +
        '<div class="reel__rail">' +
          '<button class="reel__act reel__act--vote" type="button" data-pc-vote="' + e.id + '"' +
            (canVote ? '' : ' disabled') + '><span>' + reelIcon('vote') + '</span>' +
            '<small>' + (canVote ? 'Vote' : 'Closed') + '</small></button>' +
          '<button class="reel__act" type="button" data-pc-share="' + e.id + '">' +
            '<span>' + reelIcon('share') + '</span><small>Share</small></button>' +
          (e.video && e.video.type === 'file'
            ? '<button class="reel__act" type="button" data-reel-sound>' +
              '<span>' + reelIcon('mute') + '</span><small>Sound</small></button>'
            : '') +
        '</div>' +
      '</li>';
  }

  /* ---------- the ending: twenty cards, three decks ----------

     The last panel of the feed. A line saying "you have finished watching" is a dead end;
     this is the way back in. The three groups are 6 / 6 / 8 and are cut from the SAME
     order the feed runs in, so when real standings exist the first deck holds the
     founders currently ahead -- and every founder appears in exactly one deck, which is
     asserted below rather than assumed. */
  var DECK_SIZES = [6, 6, 8];
  var DECK_NAMES = ['Deck one', 'Deck two', 'Deck three'];

  function deckGroups() {
    var all = reelOrder();
    var out = [];
    var at = 0;
    DECK_SIZES.forEach(function (n) { out.push(all.slice(at, at + n)); at += n; });
    /* Anything left over -- which would mean the lineup is no longer twenty -- goes into
       the last deck rather than being silently dropped. A founder missing from the ending
       is worse than a deck of nine. */
    if (at < all.length) out[out.length - 1] = out[out.length - 1].concat(all.slice(at));
    return out;
  }

  function deckCardFace(e, i) {
    var dst = standing(e);
    var place = dst ? dst.place : 0;
    var rank = (dst && place <= 3)
      ? '<span class="deck__rank deck__rank--' + place + '">' + dst.ordinal + '</span>'
      : '';
    var art = e.shot
      ? '<img src="' + esc(e.shot) + '" alt="" loading="lazy" decoding="async"' +
        (e.shotFit === 'contain' ? '' : ' style="object-position:' + esc(e.focal || '50% 26%') + '"') + '>'
      : '<span class="deck__mono">' + esc(initials(e)) + '</span>';
    return rank + art + deckCardFaceText(e);
  }

  function deckPanelHtml() {
    var groups = deckGroups();
    var flown = 0;
    var stacks = groups.map(function (g, gi) {
      /* The cards fly in from alternating sides and from below, each a little later than
         the one before, and land in the stack they belong to. */
      var cards = g.map(function (e, i) {
        var side = ((flown + i) % 2) ? 1 : -1;
        var vars = '--i:' + i + ';--d:' + (flown + i) +
          ';--r:' + (gi === 1 ? -1 : 1) +
          ';--fx:' + (side * (104 + ((flown + i) % 3) * 16)) + 'vw' +
          ';--fy:' + (18 + ((flown + i) % 4) * 7) + 'vh' +
          ';--fr:' + (side * (18 + ((flown + i) % 5) * 5)) + 'deg';
        return '<span class="deck__card' + (e.shotFit === 'contain' ? ' deck__card--logo' : '') +
          '" style="' + vars + '">' + deckCardFace(e, i) + '</span>';
      }).reverse().join('');          // first founder on top of the stack
      flown += g.length;
      return '' +
        '<li class="deck__stack">' +
          '<button class="deck__open" type="button" data-deck-open="' + gi + '" ' +
            'aria-label="Open ' + esc(DECK_NAMES[gi]) + ', ' + g.length + ' founders">' +
            '<span class="deck__fan">' + cards + '</span>' +
            '<span class="deck__label"><b>' + esc(DECK_NAMES[gi]) + '</b>' +
              '<span>' + g.length + ' founders</span></span>' +
          '</button>' +
        '</li>';
    }).join('');

    return '' +
      '<li class="reel__panel deck" data-reel-end data-deck>' +
        '<p class="deck__k">The NextGen deck</p>' +
        '<h3 class="deck__t">20 founders.<br>20 bold ideas.</h3>' +
        '<p class="deck__p">Find the one that inspires you. Open a deck and pick a founder to ' +
          'watch their pitch again.</p>' +
        '<ul class="deck__stacks">' + stacks + '</ul>' +
        '<div class="deck__foot">' +
          '<button class="btn btn--lg" type="button" data-reel-restart>Start from the first pitch</button>' +
          '<button class="btn btn--lg btn--ghost" type="button" data-reel-top>Back to People&rsquo;s Choice</button>' +
        '</div>' +
      '</li>';
  }

  /* The order the feed runs in.

     Leader first, from the server's own count of valid points. Fetched ONCE per page load
     and then left alone: re-sorting under someone who is halfway through watching would
     move the founder out from under them because a stranger voted. A refresh picks up the
     new order, which is what the brief asks for and all it asks for. */
  function reelOrder() {
    if (!RANK || !RANK.order) return ENTRANTS.slice();
    var out = [];
    RANK.order.forEach(function (id) { if (byId[id]) out.push(byId[id]); });
    ENTRANTS.forEach(function (e) { if (out.indexOf(e) < 0) out.push(e); });
    return out;
  }

  function paintReels() {
    if (!reelTrack) return;
    var order = reelOrder();
    reelTrack.innerHTML = order.map(reelPanelHtml).join('') + deckPanelHtml();
    watchReels();
  }

  function loadRanking(then) {
    fetch('/api/pc-rank.php', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) RANK = d; })
      .catch(function () {})
      .then(function () { if (then) then(); });
  }

  /* ---------- keeping the standings current ----------

     Every 45 seconds, and only while the tab is being looked at. The endpoint caches for
     30, so this is one cheap request a minute per reader and no busier when the page is
     left open in a background tab.

     What arrives is applied in two different ways, because they carry different risks:

       THE NUMBERS are written straight into the badges that are already on screen. A
       founder's point total changing under a reader costs them nothing.

       THE ORDER is only rebuilt when the visitor is demonstrably not in the middle of
       something -- no dialog open, not inside the immersive feed, nothing playing. The
       feed re-sorting under someone watching a pitch would take the founder away from
       them because a stranger voted somewhere else. When it is not safe, the new order
       waits; the next time they leave the feed or reload, it is there. */
  var rankTimer = null;

  function standingsText(id) {
    var e = byId[id];
    return e ? standing(e) : null;
  }

  function repaintStandings() {
    $$('[data-reel-standing]').forEach(function (n) {
      var st = standingsText(n.getAttribute('data-reel-standing'));
      if (!st) { n.hidden = true; return; }
      n.hidden = false;
      if (n.classList.contains('reel__medal')) {
        n.innerHTML = '<b>' + esc(st.ordinal) + '</b> ' +
          (st.points == null ? 'place' : esc(String(st.points)) +
            (st.points === 1 ? ' point' : ' points'));
      } else {
        n.textContent = st.label;
      }
    });
    if (pDlg.open) {
      var cur = byId[pDlg.getAttribute('data-entrant')];
      if (cur) paintProfile(cur);
    }
  }

  function safeToReorder() {
    if (reelLive) return false;                       // they are inside the feed
    if (pDlg.open || (vDlg && vDlg.open)) return false;  // a card or the vote flow is open
    if (deckWrap && deckWrap.classList.contains('is-on')) return false;
    if ($$('[data-reel-video]', reelTrack).some(function (v) { return !v.paused; })) return false;
    return true;
  }

  function watchStandings() {
    if (rankTimer) clearInterval(rankTimer);
    rankTimer = setInterval(function () {
      if (document.hidden) return;
      var before = RANK && RANK.order ? RANK.order.join(',') : '';
      loadRanking(function () {
        var after = RANK && RANK.order ? RANK.order.join(',') : '';
        repaintStandings();
        if (after !== before && safeToReorder()) {
          paintReels();
          paintStories();
        }
      });
    }, 45000);
  }

  /* Only the panel in view plays, and only its neighbours are even given a src. Twenty
     videos asked for at once would be a bill the visitor never agreed to. */
  function reelLoadNear(idx) {
    var panels = $$('[data-reel-panel]', reelTrack);
    panels.forEach(function (p, i) {
      var v = $('[data-reel-video]', p);
      if (!v) return;
      var near = Math.abs(i - idx) <= 1;
      if (near && !v.src && v.getAttribute('data-src')) {
        v.src = v.getAttribute('data-src');
        v.preload = 'metadata';
      } else if (!near && v.src && Math.abs(i - idx) > 2) {
        // let go of the ones well out of reach so memory does not creep on a long scroll
        try { v.pause(); v.removeAttribute('src'); v.load(); } catch (err) {}
      }
    });
  }

  function reelActivate(panel) {
    if (reelActive === panel) return;
    $$('[data-reel-video]', reelTrack).forEach(function (v) {
      if (!panel || v !== $('[data-reel-video]', panel)) { try { v.pause(); } catch (e) {} }
    });
    reelActive = panel;
    if (!panel) return;
    var panels = $$('[data-reel-panel]', reelTrack);
    reelLoadNear(panels.indexOf(panel));
    var v = $('[data-reel-video]', panel);
    if (!v) return;
    v.muted = reelMuted;
    /* Wide footage on a tall screen needs a different composition from portrait footage,
       and the only honest way to know which is which is to ask the file. Once the header
       is in, the panel says so and the stylesheet lifts the clip clear of the caption. */
    var shape = function () {
      if (!v.videoWidth || !v.videoHeight) return;
      panel.classList.toggle('is-wide', (v.videoWidth / v.videoHeight) > 1.2);
    };
    if (v.readyState >= 1) shape();
    else v.addEventListener('loadedmetadata', shape, { once: true });
    /* Muted autoplay is what phones allow. If this browser refuses anyway the poster is
       already there and the play control is one tap away, which is the same screen either
       way -- no error, no apology. */
    var go = v.play();
    if (go && go.catch) { go.catch(function () {}); }
  }

  /* Which panel is live is worked out from geometry on scroll, not from an
     IntersectionObserver.

     The observer was the obvious choice and it is the one that failed: in at least one
     embedded Chromium it delivers no callbacks at all for a page that is not frontmost, so
     a panel sitting 97% on screen never became active and no video was ever given a source.
     Measuring positions against the viewport centre cannot go quiet that way, costs one
     cheap loop over twenty elements per animation frame, and has the happy side effect of
     being testable. */
  var reelTick = null;
  function reelSync() {
    if (!reelTrack) return;
    reelTick = null;
    var panels = $$('[data-reel-panel]', reelTrack);
    if (!panels.length) return;
    var mid = window.innerHeight / 2;
    var best = null, bestGap = Infinity, anyOn = false;
    panels.forEach(function (p) {
      var r = p.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) anyOn = true;
      // only a panel genuinely holding the middle of the screen counts as the live one
      if (r.top > mid || r.bottom < mid) return;
      var gap = Math.abs((r.top + r.bottom) / 2 - mid);
      if (gap < bestGap) { bestGap = gap; best = p; }
    });
    if (reel) reel.classList.toggle('is-inside', anyOn);
    /* Nothing holding the middle of the screen means nothing should be talking: the end
       card, the gap between two panels, or the page scrolled past the feed entirely. The
       earlier version only stopped when no panel was on screen AT ALL, which left the last
       pitch playing underneath the closing card. */
    /* The deck is deliberately NOT in the panel list: it is not a founder, and counting
       it would make a twenty-founder feed twenty-one long in the progress bar and in the
       preload arithmetic. So its arrival is decided from its own rectangle rather than by
       asking which panel holds the centre -- which is why the earlier data-reel-end test
       here could never fire. */
    /* In card mode nothing plays. Twenty cards sit side by side sharing one vertical
       band, so "which panel holds the middle of the screen" has no sensible answer, and
       a page that starts talking because a card drifted past the centre is not what
       anybody asked for. Posters until someone opens a founder or enters the reels. */
    if (!reelLive) {
      reelActivate(null);
      reelProgress(null);
      return;
    }

    var end = $('[data-reel-end]', reelTrack);
    if (end) {
      var er = end.getBoundingClientRect();
      if (er.top < window.innerHeight * 0.72 && er.bottom > 0) deckArrive(end);
    }
    reelActivate(best || null);
    reelProgress(best || null);
  }

  /* Coalesce to one check per frame, but never let a pending frame become a permanent lock.

     This held the whole feed shut. requestAnimationFrame does not run for a page that is
     hidden or occluded, so the first call latched a handle that would never resolve, the
     guard saw a pending tick forever after, and every later request returned immediately.
     That is not only a test-rig problem: a visitor who changes tab part-way down the feed
     would come back to a reel that had quietly stopped deciding which panel was live.

     Cancelling the outstanding frame instead of refusing the new one keeps the coalescing
     and removes the trap. */
  function reelQueue() {
    if (reelTick) { cancelAnimationFrame(reelTick); }
    reelTick = requestAnimationFrame(reelSync);
  }

  function watchReels() {
    if (!reelTrack) return;
    /* Capture on the document, not a scroll listener on window.

       site.css sets overflow-x on the body, which makes the BODY the scrolling box rather
       than the viewport. Scroll events then fire on that element and never reach window, so
       a window listener hears nothing at all -- measured: the page moved thirteen thousand
       pixels and the handler was called zero times. Scroll does not bubble, but it does
       capture, so one capturing listener on the document catches it wherever it comes from. */
    document.addEventListener('scroll', reelQueue, { passive: true, capture: true });
    addEventListener('resize', reelQueue, { passive: true });
    addEventListener('orientationchange', reelQueue, { passive: true });

    /* And a slow heartbeat, because neither of the event-driven routes can be relied on.

       Measured in this build: IntersectionObserver delivers no callbacks for a page that is
       not frontmost, and a programmatic scroll dispatches no scroll event at all -- not on
       window, not capturing on the document. Both are environment quirks rather than
       mistakes in the page, and a real browser fires both. But a feed whose video only
       starts if an event turns up is a feed that silently does nothing when one does not.

       Four checks a second over twenty rectangles is nothing, it stops while the tab is
       hidden, and it means the behaviour depends on where the panels ARE rather than on
       being told that they moved. */
    setInterval(function () {
      // straight to the work: rAF is one of the two things that goes quiet here
      if (!document.hidden) reelSync();
    }, 250);

    reelSync();
  }

  function reelGoTo(id, smooth) {
    var panel = $('[data-reel-panel="' + id + '"]', reelTrack);
    if (!panel) return false;
    /* Immersive mode scrolls its own box. scrollIntoView would work, but setting scrollTop
       directly lands exactly on the snap position instead of near it, which matters when
       snapping is mandatory: a landing a few pixels out leaves the browser to decide, and
       it sometimes decides on the panel above. */
    if (reelLive && reel) {
      if (smooth === false || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        reel.scrollTop = panel.offsetTop;
      } else if (typeof reel.scrollTo === 'function') {
        reel.scrollTo({ top: panel.offsetTop, behavior: 'smooth' });
      } else {
        reel.scrollTop = panel.offsetTop;
      }
      setTimeout(reelQueue, 60);
      setTimeout(reelQueue, 700);
      return true;
    }
    panel.scrollIntoView({ behavior: smooth === false ? 'auto' : 'smooth', block: 'center' });
    /* A smooth scroll lands some time after this returns, so nudge the check again once it
       has had a chance to finish rather than reading a position mid-flight. */
    setTimeout(reelQueue, 60);
    setTimeout(reelQueue, 700);
    return true;
  }

  function reelSetSound(on) {
    reelMuted = !on;
    $$('[data-reel-video]', reelTrack).forEach(function (v) { v.muted = reelMuted; });
    $$('[data-reel-sound]').forEach(function (b) {
      b.classList.toggle('reel__act--on', !reelMuted);
      $('span', b).innerHTML = reelIcon(reelMuted ? 'mute' : 'sound');
    });
  }

  /* ---------- immersive mode ----------

     The feed above is the in-page version, and it stays: panels under the viewport,
     proximity snapping, the website still around them. That was a deliberate choice --
     a full-screen scroller a visitor falls into is a trap, and this page has voting at
     the bottom of it.

     Immersive mode answers the other half without reintroducing the trap. The visitor
     ENTERS it from a control, the way out sits in the corner the whole time, Escape
     works, and so does the browser's own Back button. Same panels, same markup, same
     geometry-driven activation; the only difference is that the section becomes a fixed
     full-viewport scroller with mandatory snapping, so exactly one founder is on screen
     and one swipe moves exactly one founder. */

  var reelBar = $('[data-reel-bar]');
  var reelLive = false;
  var reelReturn = 0;        // where the page was before we took it over
  var reelHeld = false;      // paused by a tap, rather than by scrolling away

  function reelEnter(id) {
    if (!reel || !reelTrack) return false;
    if (reelLive) { if (id) reelGoTo(id, false); return true; }
    reelLive = true;
    reelHeld = false;
    reelReturn = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    document.documentElement.classList.add('pc-live');
    reel.classList.add('is-live');
    reel.classList.remove('is-moved');
    if (reelBar) { reelBar.hidden = false; reelBar.classList.add('is-on'); }
    reelTicks();
    /* Land on the founder asked for, with no visible travel: scrollTop rather than a
       smooth scroll, because nobody asked to watch the feed scroll to the start. */
    var panel = id ? $('[data-reel-panel="' + id + '"]', reelTrack) : null;
    reel.scrollTop = panel ? panel.offsetTop : 0;
    /* Back leaves the feed instead of leaving the website. */
    try { history.pushState({ pcReel: 1 }, '', location.pathname + location.search + (id ? '#' + id : '')); } catch (e) {}
    reelQueue();
    setTimeout(reelQueue, 80);
    track('reel_enter', { entrant_id: id || null });
    return true;
  }

  function reelExit(viaPop) {
    if (!reelLive) return;
    reelLive = false;
    reelHeld = false;
    document.documentElement.classList.remove('pc-live');
    reel.classList.remove('is-live');
    if (reelBar) { reelBar.hidden = true; reelBar.classList.remove('is-on'); }
    /* Silence first, then put the page back. Leaving the feed must stop the sound, and
       the sync pass that follows decides for itself whether an in-flow panel is live. */
    $$('[data-reel-video]', reelTrack).forEach(function (v) { try { v.pause(); } catch (e) {} });
    $$('[data-reel-panel]', reelTrack).forEach(function (p) { p.classList.remove('is-held', 'is-waiting'); });
    reelActive = null;
    window.scrollTo(0, reelReturn);
    if (!viaPop) {
      try { if (history.state && history.state.pcReel) history.back(); } catch (e) {}
    }
    reelQueue();
    track('reel_exit', {});
  }

  /* Open the feed at one founder, from a bubble, a card, a share link or the deck.
     No introduction here on purpose: the brief is explicit that choosing another
     founder must not replay it. */
  function reelOpenAt(id) {
    if (!byId[id]) return false;
    if (!reelEnter(id)) { if (!reelGoTo(id)) openProfile(id); }
    return true;
  }

  addEventListener('popstate', function () {
    if (reelLive) reelExit(true);
  });

  /* ---------- the progress of the feed ---------- */
  function reelTicks() {
    var box = $('[data-reel-ticks]');
    if (!box) return;
    var n = $$('[data-reel-panel]', reelTrack).length;
    var out = '';
    for (var i = 0; i < n; i++) out += '<i></i>';
    box.innerHTML = out;
  }

  function reelProgress(panel) {
    if (!reelLive) return;
    var panels = $$('[data-reel-panel]', reelTrack);
    var at = panel ? panels.indexOf(panel) : -1;
    var ticks = $$('i', $('[data-reel-ticks]') || document.createElement('div'));
    ticks.forEach(function (t, i) {
      t.classList.toggle('is-on', i === at);
      t.classList.toggle('is-seen', at >= 0 && i < at);
    });
    var of = $('[data-reel-of]');
    if (of) of.textContent = at >= 0 ? (at + 1) + ' / ' + panels.length : 'The deck';
    if (at > 0) reel.classList.add('is-moved');       // the swipe hint has done its job
  }

  /* ---------- tap to hold, and a spinner only if there is a wait ---------- */
  function reelToggle() {
    if (!reelActive) return;
    var v = $('[data-reel-video]', reelActive);
    if (!v) return;
    if (v.paused) {
      reelHeld = false;
      reelActive.classList.remove('is-held');
      var go = v.play();
      if (go && go.catch) go.catch(function () {});
    } else {
      reelHeld = true;
      v.pause();
      reelActive.classList.add('is-held');
    }
  }

  /* Media events do not bubble, so they are caught on the way down instead. One pair of
     listeners for the whole track rather than two per video. */
  if (reelTrack) {
    ['waiting', 'stalled'].forEach(function (ev) {
      reelTrack.addEventListener(ev, function (e) {
        var p = e.target.closest ? e.target.closest('[data-reel-panel]') : null;
        if (p) p.classList.add('is-waiting');
      }, true);
    });
    ['playing', 'canplay', 'error', 'pause'].forEach(function (ev) {
      reelTrack.addEventListener(ev, function (e) {
        var p = e.target.closest ? e.target.closest('[data-reel-panel]') : null;
        if (p) p.classList.remove('is-waiting');
      }, true);
    });
  }

  /* ---------- the cinematic introduction ----------

     Four scenes, then a title, then the first pitch. Every frame is a founder's own
     submitted image or a frame from their own pitch video -- there is no stock
     photography here and no invented event picture, because a made-up photograph of a
     NextGen stage would be a lie told in the first six seconds.

     Shown once a session, skippable from the first frame, and reduced to a single held
     frame for anyone who asks for less motion. */
  var fci = $('[data-fci]');
  var introThen = null;
  var introTimer = null;

  function introSources() {
    /* Posters first: they are frames of a founder mid-pitch, which is exactly the
       material the brief asks for. Portraits fill in behind them. Logos are skipped --
       a logo is not a person presenting an idea. */
    var seen = {};
    var out = [];
    ENTRANTS.forEach(function (e) {
      if (e.poster && !seen[e.poster]) { seen[e.poster] = 1; out.push({ src: e.poster, fp: '50% 34%' }); }
    });
    ENTRANTS.forEach(function (e) {
      if (e.shot && e.shotFit !== 'contain' && !seen[e.shot]) {
        seen[e.shot] = 1; out.push({ src: e.shot, fp: e.focal || '50% 30%' });
      }
    });
    if (!out.length) return [];
    /* Four, spread across the list rather than the first four, so the sequence does not
       open on four founders who happen to sit together in the running order. */
    var pick = [];
    var step = Math.max(1, Math.floor(out.length / 4));
    for (var i = 0; i < 4; i++) pick.push(out[(i * step) % out.length]);
    return pick;
  }

  function introPlay(then) {
    var stage = fci ? $('[data-fci-stage]', fci) : null;
    var scenes = introSources();
    if (!fci || !stage || scenes.length < 2) { if (then) then(); return; }
    stage.innerHTML = scenes.map(function (sc, i) {
      return '<span class="fci__scene fci__scene--' + (i + 1) + '">' +
        '<img src="' + esc(sc.src) + '" alt="" decoding="async" style="--fp:' + esc(sc.fp) + '">' +
        '</span>';
    }).join('');
    introThen = then || null;
    fci.classList.add('is-on');
    fci.setAttribute('aria-hidden', 'false');
    var skip = $('[data-fci-skip]', fci);
    if (skip) skip.focus({ preventScroll: true });
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      /* No sequence at all: the last frame and the title, held long enough to read. */
      fci.classList.add('is-still');
      introTimer = setTimeout(function () { introEnd(); }, 2000);
    } else {
      fci.classList.add('is-playing');
      introTimer = setTimeout(function () { introEnd(); }, 7500);
      /* And a check that the film is actually running. If the first scene is still fully
         transparent a beat after it was told to appear, this browser is not animating --
         so the sequence collapses to the held frame and the title rather than showing a
         black rectangle for seven seconds. */
      setTimeout(function () {
        if (!fci.classList.contains('is-on')) return;
        var first = $('.fci__scene--1', fci);
        if (first && parseFloat(getComputedStyle(first).opacity) < 0.02) {
          fci.classList.add('is-settled');
          if (introTimer) clearTimeout(introTimer);
          introTimer = setTimeout(function () { introEnd(); }, 1800);
        }
      }, 650);
    }
    try { sessionStorage.setItem('ngs-pc-intro', '1'); } catch (e) {}
    track('intro_play', {});
  }

  function introEnd(skipped) {
    if (introTimer) { clearTimeout(introTimer); introTimer = null; }
    if (fci) {
      fci.classList.remove('is-on', 'is-playing', 'is-still', 'is-settled');
      fci.setAttribute('aria-hidden', 'true');
      var stage = $('[data-fci-stage]', fci);
      if (stage) stage.innerHTML = '';          // release the images
    }
    var then = introThen;
    introThen = null;
    if (skipped) track('intro_skip', {});
    if (then) then();
  }

  /* The front door: Meet the Founders -> the introduction -> the first pitch.
     A returning visitor goes straight in; the film is a welcome, not a toll. */
  function enterExperience() {
    var seen = false;
    try { seen = sessionStorage.getItem('ngs-pc-intro') === '1'; } catch (e) {}
    if (seen) { reelEnter(null); return; }
    introPlay(function () { reelEnter(null); });
  }

  /* ---------- the deck ---------- */
  function deckArrive(panel) {
    if (!panel || panel.classList.contains('is-arrived')) return;
    panel.classList.add('is-arrived');
    /* The longest card waits 19 x 45ms before it starts and runs for 900ms. Shortly
       after that everything should be in place -- and if the animation never ran at all,
       this is what puts the deck on screen regardless. */
    setTimeout(function () { panel.classList.add('is-settled'); }, 2100);
  }

  var deckWrap = $('[data-deck-spread]');
  var deckOpener = null;
  var deckSettle = null;

  function deckSpread(gi) {
    var g = deckGroups()[gi];
    var grid = deckWrap ? $('[data-deck-grid]', deckWrap) : null;
    if (!g || !grid) return;
    deckOpener = document.activeElement;
    grid.innerHTML = g.map(function (e, i) {
      var art = e.shot
        ? '<img src="' + esc(e.shot) + '" alt="" loading="lazy" decoding="async"' +
          (e.shotFit === 'contain' ? '' : ' style="object-position:' + esc(e.focal || '50% 26%') + '"') + '>'
        : '<span class="deck__mono">' + esc(initials(e)) + '</span>';
      return '<li><button class="deck__pick' + (e.shotFit === 'contain' ? ' deck__pick--logo' : '') +
        '" type="button" data-deck-pick="' + e.id + '" ' +
        'style="--d:' + i + ';--sr:' + (((i % 2) ? 1 : -1) * 5) + 'deg" ' +
        'aria-label="Watch the pitch from ' + esc(e.company) + ', ' + esc(e.name) + '">' +
        art + deckCardFaceText(e) + '</button></li>';
    }).join('');
    var t = $('[data-deck-spread-t]', deckWrap);
    var n = $('[data-deck-spread-n]', deckWrap);
    if (t) t.textContent = DECK_NAMES[gi];
    if (n) n.textContent = g.length + ' founders - tap to watch';
    deckWrap.classList.remove('is-settled');
    deckWrap.classList.add('is-on');
    deckWrap.setAttribute('aria-hidden', 'false');
    /* Cancel the previous deck's backstop before arming this one. Without this, opening a
       second deck inside 1.2s inherited the first deck's timer: measured, deck one showed
       none of its six cards while decks two and three showed all of theirs. */
    if (deckSettle) clearTimeout(deckSettle);
    deckSettle = setTimeout(function () { deckWrap.classList.add('is-settled'); }, 1200);
    var x = $('[data-deck-close]', deckWrap);
    if (x) x.focus({ preventScroll: true });
    track('deck_open', { deck: gi + 1, founders: g.length });
  }

  function deckCardFaceText(e) {
    return '<span class="deck__face">' +
      '<p class="deck__co">' + esc(e.company) + '</p>' +
      '<p class="deck__by">' + esc(e.name) + '</p>' +
      '</span>';
  }

  function deckSpreadClose() {
    if (!deckWrap || !deckWrap.classList.contains('is-on')) return;
    if (deckSettle) { clearTimeout(deckSettle); deckSettle = null; }
    deckWrap.classList.remove('is-on');
    deckWrap.setAttribute('aria-hidden', 'true');
    if (deckOpener && deckOpener.isConnected) deckOpener.focus({ preventScroll: true });
    deckOpener = null;
  }

  /* ---------- one keyboard route out of everything ----------
     Innermost first: the spread sits over the deck, which sits inside the feed. The
     card is a <dialog> and handles its own Escape. */
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape' && ev.key !== 'Esc') return;
    if (deckWrap && deckWrap.classList.contains('is-on')) { deckSpreadClose(); return; }
    if (fci && fci.classList.contains('is-on')) { introEnd(true); return; }
    if (reelLive && !pDlg.open) { reelExit(); return; }
  });

  /* Arrow keys and the space bar inside the feed, for anyone not using a touchscreen. */
  document.addEventListener('keydown', function (ev) {
    if (!reelLive || pDlg.open) return;
    if (deckWrap && deckWrap.classList.contains('is-on')) return;
    var tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    var panels = $$('[data-reel-panel]', reelTrack);
    var at = reelActive ? panels.indexOf(reelActive) : -1;
    if (ev.key === 'ArrowDown' || ev.key === 'PageDown') {
      ev.preventDefault();
      if (at >= 0 && panels[at + 1]) reelGoTo(panels[at + 1].getAttribute('data-reel-panel'));
      else if (at === panels.length - 1) reel.scrollTo({ top: reel.scrollHeight, behavior: 'smooth' });
    } else if (ev.key === 'ArrowUp' || ev.key === 'PageUp') {
      ev.preventDefault();
      if (at > 0) reelGoTo(panels[at - 1].getAttribute('data-reel-panel'));
    } else if (ev.key === ' ' || ev.key === 'Spacebar') {
      if (ev.target === document.body || (ev.target && ev.target.hasAttribute('data-reel-tap'))) {
        ev.preventDefault();
        reelToggle();
      }
    }
  });

  /* Reactions were here, and leadership has taken them out: "Please remove the REACT
     feature. Over complication."

     They were never public -- nothing was posted, counted or sent anywhere, and the sheet
     said as much in a note. That honesty was also the problem: a control that saves a
     thought to one browser and shows it to nobody is a button that explains itself and
     then does nothing, sitting beside Vote and Share, which both do exactly what they say.

     Gone from the rail, the sheet, the stylesheet and the markup. It is in git if it is
     ever wanted back with a real store, a moderation queue and a report route behind it. */

  /* ---------- the Founder Feed layer ----------

     Stories, the story viewer, search and the opening reveal. All of it sits ON TOP of the
     voting code: it opens the same profile dialog, calls the same openProfile(), and shares
     through the same handler. Nothing here can cast, count or change a vote.

     It is also entirely optional. If the markup for a piece is absent, that piece quietly
     does nothing and the rest still works. */

  var rail = $('[data-ff-rail]');
  var vwr = $('[data-ff-viewer]');
  var vwrIdx = -1;

  /* Who appears in the stories row, and in what order. Founders with a playable pitch come
     first, because a pitch is what the row promises. Everyone is in it regardless: being
     left out would read as being out of the competition. */
  /* The bubbles run in the same order as everything else. One authoritative list from
     one endpoint, so the rail, the reels and the deck can never disagree. */
  function storyOrderRanked() {
    return reelOrder();
  }

  function storyOrder() {
    var withVideo = ENTRANTS.filter(function (e) { return e.video; });
    var without = ENTRANTS.filter(function (e) { return !e.video; });
    return withVideo.concat(without);
  }

  function bubbleHtml(e) {
    var fit = e.shotFit === 'contain' ? ' class="is-contain"' : '';
    var bpos = e.shotFit === 'contain' ? '' : ' style="object-position:' + esc(e.focal) + '"';
    var face = e.shot
      ? '<img src="' + e.shot + '"' + fit + bpos + ' alt="" loading="lazy" decoding="async">'
      : '<span class="ff-bub__mono">' + esc(initials(e)) + '</span>';
    return '<button class="ff-bub' + (e.video ? '' : ' ff-bub--flat') + '" type="button" ' +
      'data-ff-story="' + e.id + '" aria-label="' +
      (e.video ? 'Watch the pitch from ' : 'Read about ') + esc(e.company) + '">' +
      '<span class="ff-bub__ring"><span class="ff-bub__in">' + face + '</span>' +
      (e.video ? '<span class="ff-bub__play" aria-hidden="true">' + playIcon() + '</span>' : '') +
      '</span>' +
      '<span class="ff-bub__n">' + esc(e.company) + '</span></button>';
  }

  function paintStories() {
    if (!rail) return;
    rail.innerHTML = storyOrderRanked().map(bubbleHtml).join('');
    bubbleEntrance();
  }

  /* The bubbles fly in from alternating sides, staggered, and settle.

     Latched on purpose. The brief is explicit that this must not re-trigger whenever
     somebody drifts a little up or down the page, so the class goes on once and the
     watcher is dropped -- there is no route back to the hidden state. */
  function bubbleEntrance() {
    if (!rail) return;
    rail.setAttribute('data-enter', '');
    rail.classList.add('is-armed');
    /* And disarmed shortly after, unconditionally. While is-armed is on the rail the
       bubbles are hidden; once it is gone the hidden rule stops matching and they are
       simply visible, with no transition left to depend on. */
    setTimeout(function () { rail.classList.remove('is-armed'); }, 1800);
    $$('.ff-bub', rail).forEach(function (b, i) {
      /* alternating sides, and a little further out every other card for depth */
      var side = (i % 2) ? 1 : -1;
      b.style.setProperty('--bx', (side * (54 + (i % 3) * 20)) + 'px');
      b.style.setProperty('--bd', (i * 55) + 'ms');
    });
    if (rail.classList.contains('is-in')) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      rail.classList.add('is-in');
      return;
    }
    /* The entrance is an enhancement and is treated as one. Whatever happens with
       scroll events, observers or the compositor, the bubbles are on screen shortly
       after the rail is painted. Measured on the deployed site before this: is-in was
       set and the portraits were still at opacity 0, because the transition never
       ran. */
    setTimeout(function () { rail.classList.add('is-in'); }, 1200);
    var fired = false;
    var fire = function () {
      if (fired) return;
      var r = rail.getBoundingClientRect();
      if (r.top > innerHeight * 0.88 || r.bottom < 0) return;
      fired = true;
      rail.classList.add('is-in');
      document.removeEventListener('scroll', fire, true);
      clearInterval(beat);
    };
    document.addEventListener('scroll', fire, { passive: true, capture: true });
    /* Same reason as the feed: in this environment neither IntersectionObserver nor a
       window scroll listener can be relied on, so position is read on a slow heartbeat
       as well. It stops the moment the bubbles have flown. */
    var beat = setInterval(fire, 220);
    fire();
  }

  /* ---------- the story viewer ---------- */

  function stopPlayback() {
    if (!vwr) return;
    var stage = $('[data-ff-stage]', vwr);
    if (stage) stage.innerHTML = '';   /* removing the node is what actually stops the audio */
  }

  function openStory(id) {
    if (!vwr) return;
    var order = storyOrder();
    var i = -1;
    order.forEach(function (e, k) { if (e.id === id) i = k; });
    if (i < 0) return;
    vwrIdx = i;
    paintStory();
    if (!vwr.open) {
      if (typeof vwr.showModal === 'function') vwr.showModal();
      else vwr.setAttribute('open', '');
    }
    track('story_open', { entrant_id: id });
  }

  function paintStory() {
    var order = storyOrder();
    var e = order[vwrIdx];
    if (!e) return;
    var fit = e.shotFit === 'contain' ? ' class="is-contain"' : '';

    var ticks = $('[data-ff-ticks]', vwr);
    if (ticks) {
      ticks.innerHTML = order.map(function (_, k) {
        return '<span class="ff-view__tick' + (k <= vwrIdx ? ' is-on' : '') + '"></span>';
      }).join('');
    }
    var vpos = e.shotFit === 'contain' ? '' : ' style="object-position:' + esc(e.focal) + '"';
    var av = $('[data-ff-av]', vwr);
    if (av) {
      av.innerHTML = e.shot
        ? '<img src="' + e.shot + '"' + fit + vpos + ' alt="">'
        : '<span class="ff-bub__mono" style="font-size:14px">' + esc(initials(e)) + '</span>';
    }
    /* The frame behind the video. Pitches arrived portrait, landscape and square, and a
       vertical viewer has to hold all three without cropping anyone. The founder's own
       image, blurred, fills what the video does not -- so the gap reads as deliberate
       rather than as a bug. */
    var stageEl = $('[data-ff-stage]', vwr);
    if (stageEl) {
      var usable = e.shot && e.shotFit !== 'contain';   // a logo blurs to a pale haze
      stageEl.style.setProperty('--ff-back', usable ? 'url("' + e.shot + '")' : 'none');
    }
    var co = $('[data-ff-co]', vwr); if (co) { co.textContent = e.company; }
    var by = $('[data-ff-by]', vwr); if (by) { by.textContent = e.name; }

    var stage = $('[data-ff-stage]', vwr);
    if (stage) {
      stage.innerHTML = e.video
        ? playerHtml(e.video, e.company, e.poster)
        /* No playable pitch: an editorial card, not a broken player and not a fake one. Four
           founders submitted a PDF or an image where a video was expected. That is an
           editorial problem for the team, not something to paper over here. */
        : '<div class="ff-view__tell">' +
            '<span class="ff-view__tell-k">Founder story</span>' +
            '<p class="ff-view__tell-co">' + esc(e.company) + '</p>' +
            '<p class="ff-view__tell-p">' + esc(e.blurb) + '</p>' +
            '<p class="ff-view__tell-p" style="color:var(--accent)">' + esc(e.name) + '</p>' +
          '</div>';
    }
    var go = $('[data-ff-profile]', vwr);
    if (go) go.setAttribute('data-ff-profile', e.id);
    var sh = $('[data-ff-share]', vwr);
    if (sh) sh.setAttribute('data-pc-share', e.id);
  }

  function stepStory(d) {
    var order = storyOrder();
    var next = vwrIdx + d;
    if (next < 0) return;
    if (next >= order.length) { closeStory(); return; }
    stopPlayback();
    vwrIdx = next;
    paintStory();
  }

  function closeStory() {
    stopPlayback();
    if (vwr && vwr.open) vwr.close();
  }

  /* One pitch at a time. Two founders talking over each other is the fastest way to make
     a showcase feel broken, and it is easy to reach: open a story, open a profile. */
  document.addEventListener('play', function (ev) {
    if (!ev.target || ev.target.tagName !== 'VIDEO') return;
    $$('video').forEach(function (other) {
      if (other !== ev.target && !other.paused) other.pause();
    });
  }, true);

  /* The founder card no longer carries a player of its own -- Watch the pitch takes the
     visitor to the feed, so there is exactly one place a pitch can be playing and closing
     the card cannot leave audio running behind it. The guard that used to empty the card's
     player went with the player. */

  /* Stop playback whenever a dialog stops being open, however that happened.

     The close event is the obvious hook and it is not sufficient on its own: in at least one
     Chromium build a programmatic .close() fires nothing at all, which would leave a pitch
     talking behind a dismissed dialog. Watching the open attribute catches the close button,
     the Escape key, a script call and anything else, because it watches the state rather
     than the announcement of it. */
  function stopWhenClosed(dialog, stop) {
    if (!dialog || !window.MutationObserver) return;
    new MutationObserver(function () {
      if (!dialog.open) stop();
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  }
  stopWhenClosed(vwr, stopPlayback);

  if (vwr) {
    vwr.addEventListener('close', stopPlayback);
    vwr.addEventListener('cancel', stopPlayback);
    document.addEventListener('keydown', function (ev) {
      if (!vwr.open) return;
      if (ev.key === 'ArrowRight') { ev.preventDefault(); stepStory(1); }
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); stepStory(-1); }
    });
  }

  /* ---------- search ----------

     It filters the founder rail, which is the surface the founders are actually on. There
     is no second directory to search any more, and building one was never the point: the
     brief was less scrolling, not another list.

     Matching is forgiving on case, spacing and accents, because a visitor typing
     "metayer" should find Metayer. Clearing restores the standings order.  */

  var searchBox = $('[data-ff-search]');
  var clearBtn = $('[data-ff-clear]');
  var countEl = $('[data-ff-count]');

  function fold(t) {
    t = String(t == null ? '' : t).toLowerCase();
    if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return t.replace(/\s+/g, ' ').trim();
  }

  function applyFilter(q) {
    var needle = fold(q);
    var shown = 0;
    $$('[data-ff-story]', rail).forEach(function (b) {
      var e = byId[b.getAttribute('data-ff-story')];
      var hay = e ? fold(e.company + ' ' + e.name) : '';
      var hit = !needle || hay.indexOf(needle) >= 0;
      b.hidden = !hit;
      if (hit) shown++;
    });
    /* The cards are the primary surface, so they filter with the rail. */
    $$('[data-reel-panel]', reelTrack).forEach(function (p) {
      var e = byId[p.getAttribute('data-reel-panel')];
      var hay = e ? fold(e.company + ' ' + e.name) : '';
      p.hidden = !!(needle && hay.indexOf(needle) < 0);
    });
    var empty = $('[data-ff-empty]');
    if (empty) empty.hidden = !(needle && shown === 0);
    if (clearBtn) clearBtn.hidden = !needle;
    if (countEl) {
      /* "1 of 20 founder" -- the plural follows the total, not the match count. */
      countEl.textContent = needle
        ? shown + ' of ' + ENTRANTS.length + ' founders'
        : ENTRANTS.length + ' founders';
    }
    railArrows();
  }

  if (searchBox) {
    searchBox.addEventListener('input', function () { applyFilter(searchBox.value); });
    /* Enter on a single match goes straight to that founder's pitch, which is the whole
       reason someone searched. */
    searchBox.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      var hit = $$('[data-ff-story]', rail).filter(function (b) { return !b.hidden; });
      if (hit.length) reelOpenAt(hit[0].getAttribute('data-ff-story'));
    });
  }

  /* ---------- the rail, for a mouse ----------
     A phone swipes this; a desktop should not have to. Arrows appear only when there is
     something off either end, and they move by roughly a screenful of bubbles. */
  function railArrows() {
    var rail = activeRail();
    if (!rail) return;
    var prev = $('[data-ff-prev]'), next = $('[data-ff-next-rail]');
    if (!prev || !next) return;
    var over = rail.scrollWidth - rail.clientWidth;
    var fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
    prev.hidden = !fine || over < 8 || rail.scrollLeft < 8;
    next.hidden = !fine || over < 8 || rail.scrollLeft > over - 8;
  }

  /* Which horizontal rail the arrows drive. While the cards are laid out as a rail
     they are the main thing to browse, so the arrows move them; the bubbles keep their
     own swipe and keyboard. */
  function activeRail() {
    if (reel && !reel.classList.contains('is-live') && reelTrack
        && reelTrack.scrollWidth > reelTrack.clientWidth + 8) {
      return reelTrack;
    }
    return rail;
  }

  function railStep(dir) {
    var rail = activeRail();
    if (!rail) return;
    var by = Math.max(160, Math.round(rail.clientWidth * 0.8));
    var from = rail.scrollLeft;
    var smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (smooth && typeof rail.scrollBy === 'function') {
      rail.scrollBy({ left: dir * by, behavior: 'smooth' });
    }
    /* A smooth scroll needs a compositor, and there are real conditions where it never
       starts -- a hidden or throttled page, reduced motion, an engine that ignores the
       option. An arrow that silently does nothing is worse than one that jumps, so if
       nothing has moved shortly after, it moves. */
    setTimeout(function () {
      if (Math.abs(rail.scrollLeft - from) < 2) rail.scrollLeft = from + dir * by;
      railArrows();
    }, 120);
    setTimeout(railArrows, 460);
  }

  if (rail) {
    rail.addEventListener('scroll', railArrows, { passive: true });
    addEventListener('resize', railArrows, { passive: true });
    /* Left and right move along the rail when a bubble has focus, so the row is
       reachable without a mouse or a swipe. */
    rail.addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      var all = $$('[data-ff-story]', rail).filter(function (b) { return !b.hidden; });
      var at = all.indexOf(document.activeElement);
      if (at < 0) return;
      ev.preventDefault();
      var to = all[at + (ev.key === 'ArrowRight' ? 1 : -1)];
      if (to) { to.focus(); to.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }
    });
  }

  /* ---------- the opening reveal ----------
     Once per tab, and never in front of a page that is already there. */
  function boot() {
    var b = $('[data-ff-boot]');
    if (!b) return;
    var seen = false;
    try { seen = sessionStorage.getItem('ngs-ff-boot') === '1'; } catch (e) {}
    if (seen) { b.remove(); return; }
    try { sessionStorage.setItem('ngs-ff-boot', '1'); } catch (e) {}
    var kill = function () { if (b && b.parentNode) b.remove(); };
    setTimeout(kill, 1800);
    b.addEventListener('animationend', function (ev) {
      if (ev.animationName === 'ff-boot-out') kill();
    });
  }

  function paintFeedFurniture() {
    paintStories();
    paintReels();                       // contestant order, so the feed exists immediately
    loadRanking(function () {           // then re-laid in standings order
      paintReels();
      paintStories();
      watchStandings();
    });
    var pc = $('[data-ff-pitches]');
    if (pc) {
      /* The honest number: how many of the twenty submitted something that actually plays.
         Four sent a PDF or an image, and saying twenty here would be a small lie that the
         stories row would immediately expose. */
      pc.textContent = String(ENTRANTS.filter(function (e) { return e.video; }).length);
    }
    applyFilter(searchBox ? searchBox.value : '');
  }

  /* the Meet the Founders panel arrives once, as it comes into view */
  (function () {
    var x = $('[data-ffx]');
    if (!x) return;
    if (!('IntersectionObserver' in window)
        || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      x.classList.add('is-in');
      return;
    }
    new IntersectionObserver(function (rows, obs) {
      rows.forEach(function (r) {
        if (r.isIntersecting) { r.target.classList.add('is-in'); obs.unobserve(r.target); }
      });
    }, { threshold: 0.3 }).observe(x);
  }());

  boot();
  paintFeedFurniture();

  /* A shared link opens straight onto that pitch -- either a contestant's own page, where the
     server left the id on the window, or a #fragment on the gallery. */
  function fromHash() {
    var id = location.hash.replace('#', '');
    if (byId[id]) openProfile(id, true);
  }
  addEventListener('hashchange', fromHash);
  if (window.__pcOpen && byId[window.__pcOpen]) {
    reelGoTo(window.__pcOpen, false);
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
        paintReels();
        paintFurniture();
        repaintAfterVote();
      })
      .catch(function () {});
  }

  track('page_view', { state: STATE, entrants: ENTRANTS.length, simulated: true });
})();
