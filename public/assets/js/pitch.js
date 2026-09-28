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
        target.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' });
        history.replaceState(null, '', a.getAttribute('href'));
      });
    });
  }

  initSteps();
  initTabs();
  initVote();
  initScrollLinks();
})();
