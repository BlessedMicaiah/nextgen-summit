/* NextGen Summit — Pitch Competition page.
   Rides on site.js (nav, countdown, reveals, drawers). This file owns the five-step progression,
   the two tabs and the People's Choice panel. The application link is plain HTML in /pitch/index.html. */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reduced = matchMedia('(prefers-reduced-motion: reduce)');

  /* ======================================================================
     1. THE FIVE STEPS
     Whichever step is nearest the reading line is the active one, and every
     step above it is marked done so the rail reads as progress rather than
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
     2. THE TABS  —  Competition / People's Choice
     ================================================================== */
  function initTabs() {
    var list = $('[role="tablist"]');
    if (!list) return;
    var tabs = $$('[role="tab"]', list);
    if (tabs.length < 2) return;

    function select(tab, moveFocus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (moveFocus) tab.focus();
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab, false); });
      tab.addEventListener('keydown', function (e) {
        var go = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1
               : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
        if (go < 0 || go > tabs.length - 1) {
          if (e.key === 'ArrowRight') go = 0;
          else if (e.key === 'ArrowLeft') go = tabs.length - 1;
          else return;
        }
        e.preventDefault();
        select(tabs[go], true);
      });
    });
  }

  /* ======================================================================
     3. THE TOP 20  —  empty until the semifinalists are real.

     When they are confirmed, fill this array and the People's Choice panel
     renders the cards in place of the pre-launch note. Nothing here ships
     with placeholder founders: an empty list is the honest state, and a
     made-up one would read as a real announcement.

       { id: 'slug', name: 'Founder Name', company: 'Company',
         blurb: 'One line on what they are building.',
         image: '/assets/img/semifinalists/slug.jpg',   // 3:4 portrait
         site: 'https://example.com' }                   // optional
     ================================================================== */
  var SEMIFINALISTS = [];

  function initVote() {
    var wrap = $('[data-vote]');
    if (!wrap || !SEMIFINALISTS.length) return;          // keep the pre-launch state
    var ul = document.createElement('ul');
    ul.className = 'vote__grid';
    SEMIFINALISTS.forEach(function (f) {
      var li = document.createElement('li');
      li.className = 'vote__card';
      li.setAttribute('data-founder', f.id || '');
      if (f.image) {
        var img = document.createElement('img');
        img.src = f.image;
        img.alt = 'Portrait of ' + (f.name || 'a semifinalist') + '.';
        img.loading = 'lazy';
        img.decoding = 'async';
        li.appendChild(img);
      }
      var name = document.createElement('h3');
      name.className = 'vote__name';
      name.textContent = f.name || '';
      li.appendChild(name);
      if (f.company) {
        var co = document.createElement('p');
        co.className = 'vote__co';
        co.textContent = f.company;
        li.appendChild(co);
      }
      if (f.blurb) {
        var b = document.createElement('p');
        b.className = 'vote__blurb';
        b.textContent = f.blurb;
        li.appendChild(b);
      }
      ul.appendChild(li);
    });
    wrap.textContent = '';
    wrap.appendChild(ul);
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

  /* ---------- the competition board ----------

     This markup shipped without a driver, so the clock sat on "--Days : --Hrs" for as long
     as the page has been live and the timeline bars never filled.

     The deadline comes from the People's Choice API rather than a date typed in here,
     because that endpoint is what actually decides whether a vote is accepted. If the two
     disagreed, the page would be counting down to the wrong moment -- and the one on the
     page is the one people plan around. The dates in the markup are the fallback for when
     the endpoint cannot be reached. */
  function initBoard() {
    var board = document.querySelector('[data-board]');
    if (!board) return;

    var cells = {
      d: board.querySelector('[data-c="d"]'),
      h: board.querySelector('[data-c="h"]'),
      m: board.querySelector('[data-c="m"]'),
      s: board.querySelector('[data-c="s"]')
    };
    var kicker = board.querySelector('[data-clock-k]');
    var nowT = board.querySelector('[data-board-now]');
    var live = board.querySelector('[data-board-live]');
    var stages = [].slice.call(board.querySelectorAll('[data-stage]'));

    /* The last stage's end is the backstop: the furthest moment the page knows about, and
       counting to it beats counting to nothing. */
    var fallback = stages.length
      ? Date.parse(stages[stages.length - 1].getAttribute('data-to') || '')
      : NaN;
    var deadline = isFinite(fallback) ? fallback : NaN;
    var closed = false;

    function two(n) { return (n < 10 ? '0' : '') + n; }

    function paint() {
      var now = Date.now();

      /* The timeline is recomputed from the dates rather than trusted from the classes in
         the markup -- those were written by hand for one particular day and are wrong by
         the next. */
      stages.forEach(function (li) {
        var from = Date.parse(li.getAttribute('data-from') || '');
        var to = Date.parse(li.getAttribute('data-to') || '');
        var run = li.querySelector('.board__run');
        if (!isFinite(from) || !isFinite(to) || to <= from) return;
        var past = now >= to, nowish = now >= from && now < to;
        li.classList.toggle('is-past', past);
        li.classList.toggle('is-now', nowish);
        if (nowish) { li.setAttribute('aria-current', 'step'); }
        else { li.removeAttribute('aria-current'); }
        if (run) {
          run.style.width = past ? '100%'
            : (nowish ? Math.max(2, Math.min(100, ((now - from) / (to - from)) * 100)) + '%' : '0');
        }
      });

      if (!isFinite(deadline)) return;
      var left = Math.max(0, deadline - now);

      if (left === 0 && !closed) {
        closed = true;
        if (kicker) kicker.textContent = 'Voting has closed';
        if (nowT) nowT.textContent = 'Public voting has closed';
        if (live) live.textContent = 'Closed';
      }

      var sec = Math.floor(left / 1000);
      if (cells.d) cells.d.textContent = String(Math.floor(sec / 86400));
      if (cells.h) cells.h.textContent = two(Math.floor(sec / 3600) % 24);
      if (cells.m) cells.m.textContent = two(Math.floor(sec / 60) % 60);
      if (cells.s) cells.s.textContent = two(sec % 60);
    }

    paint();
    setInterval(paint, 1000);

    /* The authoritative deadline, if the endpoint will give one. A failure here is not
       worth showing anyone: the fallback is already counting. */
    fetch('/api/pc-otp.php?action=status', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.deadline) return;
        var t = Date.parse(d.deadline);
        if (isFinite(t)) { deadline = t; paint(); }
      })
      .catch(function () {});
  }

  initSteps();
  initTabs();
  initVote();
  initScrollLinks();
  initBoard();
})();
