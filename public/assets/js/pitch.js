/* NextGen Summit — Pitch Competition page.
   Rides on site.js (nav, countdown, reveals, drawers). This file owns where the competition stands
   (the stage board, its clock, the done / now / next marks), the five-step progression and the
   buttons to the People's Choice vote. */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reduced = matchMedia('(prefers-reduced-motion: reduce)');

  /* ======================================================================
     1. THE FIVE STEPS
     Whichever step is nearest the reading line is the active one, and every
     step above it is marked done so the list reads as progress rather than
     as five separate rows. On a pointer device hover and keyboard focus
     take over, the same way the audience cards behave on the home page.
     One rAF-throttled passive listener, only while the list is on screen.
     ================================================================== */
  function initSteps() {
    var list = $('[data-steps]');
    if (!list) return;
    var steps = $$('[data-step]', list);
    if (!steps.length) return;
    var hoverMQ = matchMedia('(hover:hover) and (pointer:fine)');
    var active = null, held = null, raf = null, onScreen = false, leaveT = null;

    function paintFrom(index) {
      steps.forEach(function (s, i) {
        s.classList.toggle('is-active', i === index);
        s.classList.toggle('is-done', index > -1 && i < index);
      });
      list.classList.toggle('has-active', index > -1);
      active = index;
    }

    function fromScroll() {
      if (held !== null) return;
      var line = window.innerHeight * 0.52, best = -1, bestD = Infinity;
      steps.forEach(function (s, i) {
        var r = s.getBoundingClientRect();
        if (r.bottom <= 0 || r.top >= window.innerHeight) return;
        var d = Math.abs(r.top + r.height / 2 - line);
        if (d < bestD) { bestD = d; best = i; }
      });
      // once the list is behind you, leave the whole run marked done
      var lr = list.getBoundingClientRect();
      if (best === -1 && lr.bottom < 0) best = steps.length - 1;
      if (best !== active) paintFrom(best);
    }

    function tick() { raf = null; fromScroll(); }
    function request() { if (raf === null && onScreen) raf = requestAnimationFrame(tick); }

    steps.forEach(function (s, i) {
      s.addEventListener('pointerenter', function () {
        if (!hoverMQ.matches) return;
        clearTimeout(leaveT);
        held = i;
        paintFrom(i);
      });
      s.addEventListener('pointerleave', function () {
        if (!hoverMQ.matches) return;
        clearTimeout(leaveT);
        leaveT = setTimeout(function () { held = null; fromScroll(); }, 120);
      });
      s.addEventListener('focusin', function () { clearTimeout(leaveT); held = i; paintFrom(i); });
      s.addEventListener('focusout', function (e) {
        if (s.contains(e.relatedTarget)) return;
        held = null;
        fromScroll();
      });
    });

    new IntersectionObserver(function (es) {
      onScreen = es[0].isIntersecting;
      request();
    }, { rootMargin: '20% 0px' }).observe(list);
    addEventListener('scroll', request, { passive: true });
    addEventListener('resize', request, { passive: true });
    fromScroll();
  }

  /* ======================================================================
     2. WHERE THE COMPETITION STANDS
     The stage board in the hero carries the dates (data-from / data-to, as
     Eastern instants). Today decides which stage is "now": everything before
     it is done, today's cell on the board fills as the stage's days
     pass, the clock counts to whatever comes next, and the five steps further
     down take the same marks. The markup ships as voting week, so the page
     reads true without JavaScript; from October 29 it moves on by itself.
     ?stage-at=2026-10-29T12:00-04:00 previews any moment.
     ================================================================== */
  var COPY = [
    { eye: 'Applications', l1: 'your idea', l2: 'belongs on stage.', now: 'Applications are closing',
      clockK: 'Applications close in', lede: '' },
    { eye: 'Semifinals', l1: 'twenty founders.', l2: 'almost named.', now: 'The committee is choosing the Top 20',
      clockK: 'The Top 20 are named in',
      lede: 'Applications are closed. The review committee is reading every one of them, and the Top 20 semifinalists are named on October 22.' },
    null,                                  // voting week: the markup already says it
    { eye: 'Finalists', l1: 'ten founders.', l2: 'one stage.', now: 'The Top 10 are announced',
      clockK: 'The live final starts in',
      lede: 'Voting has closed. One founder earned the People’s Choice place, the judges chose nine more, and tomorrow the ten pitch live for a share of $10,000.' },
    { eye: 'Live final', l1: 'ten founders.', l2: 'live today.', now: 'The live final is today', clockK: '',
      lede: 'The ten finalists pitch on the main stage at NextGen Summit today, to an executive panel and the whole room. The top three share $10,000.' },
    { eye: '2026', l1: 'ten founders.', l2: 'one stage.', now: 'The final has been pitched', clockK: '',
      lede: 'Thank you to every founder who applied, everyone who voted, and every judge. The results are shared by the NextGen team.' }
  ];

  function nowMs() {
    var at = /[?&]stage-at=([^&]+)/.exec(location.search);
    var t = at ? new Date(decodeURIComponent(at[1])).getTime() : NaN;
    return isNaN(t) ? Date.now() : t;
  }

  function initStage() {
    var board = $('[data-board]');
    if (!board) return;
    var stages = $$('[data-stage]', board);
    var steps = $$('[data-step]');
    var span = stages.map(function (s) {
      return [new Date(s.getAttribute('data-from')).getTime(), new Date(s.getAttribute('data-to')).getTime()];
    });
    var t0 = nowMs(), offset = t0 - Date.now();          // a preview keeps ticking from its own moment
    var at = stages.length;                              // past the last stage: all done
    for (var i = 0; i < span.length; i++) if (t0 < span[i][1]) { at = i; break; }

    stages.forEach(function (s, i) {
      s.classList.toggle('is-past', i < at);
      s.classList.toggle('is-now', i === at);
      if (i === at) s.setAttribute('aria-current', 'step'); else s.removeAttribute('aria-current');
      var sr = $('[data-stage-sr]', s);
      if (sr) sr.textContent = i < at ? ' (done)' : i === at ? ' (happening now)' : '';
    });
    var TAGS = ['Done', 'Now', 'Next', 'Coming'];
    steps.forEach(function (s, i) {
      s.classList.toggle('is-past', i < at);
      s.classList.toggle('is-now', i === at);
      var tag = $('[data-tag]', s);
      if (tag) tag.textContent = TAGS[i < at ? 0 : i === at ? 1 : i === at + 1 ? 2 : 3];
    });

    // today's cell fills with the share of its days gone by, one notch per day
    var part = 0;
    if (at < stages.length) part = Math.min(1, Math.max(0, (t0 - span[at][0]) / (span[at][1] - span[at][0])));
    stages.forEach(function (s, i) {
      var days = Math.max(1, Math.round((span[i][1] - span[i][0]) / 864e5));
      s.style.setProperty('--i', String(i));
      s.style.setProperty('--days', String(days));
      s.style.setProperty('--run', i === at ? Math.max(part, .04).toFixed(3) : '0');
    });
    steps.forEach(function (s, i) {
      s.style.setProperty('--run', i === at ? Math.max(part, .04).toFixed(3) : '0');
    });
    var day = $('[data-board-day]', board);
    if (day && at < stages.length) {
      var n = Math.max(1, Math.round((span[at][1] - span[at][0]) / 864e5));
      day.textContent = 'Day ' + Math.min(n, Math.floor((t0 - span[at][0]) / 864e5) + 1) + ' of ' + n;
      day.hidden = n < 2;
    }
    var live = $('[data-board-live]', board);
    if (live) live.textContent = at >= stages.length ? 'Complete' : 'Live';
    board.classList.toggle('is-over', at >= stages.length);

    var c = COPY[Math.min(at, COPY.length - 1)];
    function put(sel, text) { var e = $(sel); if (e && text) e.textContent = text; }
    if (c) {
      put('[data-stage-eyebrow]', c.eye);
      put('[data-stage-l1]', c.l1);
      put('[data-stage-l2]', c.l2);
      put('[data-board-now]', c.now);
      put('[data-stage-lede]', c.lede);
      put('[data-clock-k]', c.clockK);
    }
    if (at >= 3) put('[data-pv-lede]', 'Voting closed on October 28. The People’s Choice finalist is announced with the rest of the Top 10 on October 29.');
    document.documentElement.setAttribute('data-pitch-stage', String(at));

    // the clock counts to the end of voting, then to the final; on the day it steps aside
    var clock = $('[data-clock]', board);
    var target = at <= 2 ? span[Math.max(at, 0)][1] - 1000 : at === 3 ? span[4][0] : 0;
    if (!clock) return;
    if (!target) { clock.hidden = true; return; }
    var out = {};
    ['d', 'h', 'm', 's'].forEach(function (k) { out[k] = $('[data-c="' + k + '"]', clock); });
    var sr = $('[data-clock-sr]', clock);
    if (sr && at === 3) sr.textContent = 'The live final is on October 30.';
    else if (sr && at < 2) sr.textContent = 'The Top 20 are named on October 22.';
    var timer = null, visible = false;
    function pad(v) { return (v < 10 ? '0' : '') + v; }
    function tick() {
      var left = Math.max(0, target - (Date.now() + offset));
      var sec = Math.floor(left / 1000);
      out.d.textContent = pad(Math.floor(sec / 86400));
      out.h.textContent = pad(Math.floor(sec % 86400 / 3600));
      out.m.textContent = pad(Math.floor(sec % 3600 / 60));
      out.s.textContent = pad(sec % 60);
      return left;
    }
    function loop() {
      timer = null;
      if (tick() && visible && !document.hidden) timer = setTimeout(loop, 1000 - Date.now() % 1000 + 15);
    }
    function run() {                            // ticks only while the board is on screen
      var on = visible && !document.hidden;
      if (on && !timer) loop();
      else if (!on && timer) { clearTimeout(timer); timer = null; }
    }
    tick();
    // in voting week the People's Choice endpoint holds the real closing time; the markup's date
    // is the fallback, so the board never counts to a moment the vote does not keep
    if (at === 2 && window.fetch && !/[?&]stage-at=/.test(location.search)) {
      fetch('/api/pc-otp.php?action=status', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var t = d && d.ok && d.deadline ? Date.parse(d.deadline) : NaN;
          if (isFinite(t)) { target = t; tick(); }
        })
        .catch(function () {});
    }
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; run(); }).observe(clock);
    document.addEventListener('visibilitychange', run);
  }

  /* ======================================================================
     3. THE WAY TO THE VOTE
     The People's Choice gallery is its own page, and it is not on every
     copy of this site yet. Its endpoint answers a GET with the state of the
     vote, so the buttons to it appear only where it answers, worded for that
     state; anywhere else the page says the gallery is coming instead of
     sending people to a page that is not there.
     ================================================================== */
  var PC_LABEL = { 'open': 'Vote for a founder', 'coming-soon': 'Meet the Top 20', 'closed': 'See the Top 20', 'results': 'See the results' };

  function initVoteLinks() {
    var links = $$('[data-pc-link]'), soon = $$('[data-pc-soon]');
    if (!links.length) return;
    var stage = +document.documentElement.getAttribute('data-pitch-stage') || 0;
    function none() {
      // once voting is over there is nothing to promise any more
      if (stage >= 3) soon.forEach(function (e) { e.hidden = true; });
      // in the voting week, a copy of the site without the gallery must not say voting is open
      if (stage === 2) waiting();
    }
    function waiting() {
      var board = $('[data-board]');
      if (!board) return;
      board.classList.add('is-waiting');
      var now = $('[data-board-now]', board), live = $('[data-board-live]', board);
      var day = $('[data-board-day]', board), clock = $('[data-clock]', board);
      if (now) now.textContent = 'Public voting opens soon';
      if (live) live.textContent = 'Soon';
      if (day) day.hidden = true;
      if (clock) clock.hidden = true;
    }
    if (!window.fetch) return none();
    fetch('/api/pc-vote.php', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.ok || !PC_LABEL[j.state]) return none();
        links.forEach(function (a) {
          var l = $('[data-pc-label]', a);
          if (l) l.textContent = PC_LABEL[j.state];
          a.hidden = false;
        });
        soon.forEach(function (e) { e.hidden = true; });
        document.documentElement.classList.add('has-pc');
        // the gallery is up but the vote is not open yet: the board must not say it is
        if (j.state === 'coming-soon' && stage === 2) waiting();
      })
      .catch(none);
  }

  /* ---------- in-page jump, without fighting the sticky bar ---------- */
  function initScrollLinks() {
    $$('[data-scroll]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var target = document.querySelector(a.getAttribute('href'));
        if (!target) return;
        e.preventDefault();
        // glide with Lenis when site.js is running it, otherwise the browser's own scroll
        if (!(window.NGScrollTo && window.NGScrollTo(target))) {
          target.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' });
        }
        history.replaceState(null, '', a.getAttribute('href'));
      });
    });
  }

  initStage();
  initSteps();
  initVoteLinks();
  initScrollLinks();
})();
