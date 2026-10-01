/* NextGen Summit — live ticket counter on the homepage.
   Reads {"count": N} from /api/attendee-count.php (Eventbrite, cached briefly on the server)
   every 10 seconds while the page is visible. The counter stays hidden until a real count
   arrives, keeps the last good number if a refresh fails, and never shows a placeholder zero. */
(function () {
  'use strict';

  var box = document.querySelector('[data-tally]');
  if (!box || window.__ngsTally) return;               // one counter, one poller
  window.__ngsTally = true;

  var URL = '/api/attendee-count.php';
  var EVERY = 10000;
  var num = box.querySelector('[data-tally-n]');
  var sr = box.querySelector('[data-tally-sr]');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');
  var shown = null;          // the number on screen
  var target = null;         // the latest real count
  var seen = false;          // has the counter been scrolled into view yet
  var timer = null, busy = false, anim = null;

  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

  // the count-up is a Motion tween (ease-out cubic); without Motion the number simply appears
  function paint(from, to, ms) {
    if (anim) { anim.stop(); anim = null; }
    if (reduce.matches || from === to || !ms || !window.Motion) { num.textContent = fmt(to); shown = to; return; }
    anim = window.Motion.animate(from, to, {
      duration: ms / 1000,
      ease: [0.33, 1, 0.68, 1],
      onUpdate: function (v) { num.textContent = fmt(v); },
      onComplete: function () { num.textContent = fmt(to); shown = to; anim = null; }
    });
  }

  function show(n) {
    target = n;
    if (sr) sr.textContent = fmt(n) + ' ';
    // no registrations yet reads as a bad sign, not a fact worth a banner: stay hidden
    if (n < 1) { box.hidden = true; return; }
    box.hidden = false;
    if (!seen) { num.textContent = fmt(n); return; }  // counts up once it is scrolled into view
    if (shown !== n) paint(shown === null ? n : shown, n, 700);
  }

  function load() {
    if (busy) return;
    busy = true;
    fetch(URL, { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && typeof d.count === 'number' && d.count >= 0) show(d.count); })
      .catch(function () { /* keep whatever is showing; the next tick tries again */ })
      .then(function () { busy = false; });
  }

  function start() { if (!timer) timer = setInterval(load, EVERY); }
  function stop() { clearInterval(timer); timer = null; }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return;
      seen = true;
      io.disconnect();
      if (target > 0) paint(1, target, 1100);         // counts up from 1: the counter never reads 0
    }, { threshold: 0.4 });
    io.observe(box);
  } else {
    seen = true;
  }

  // only while someone can see the page
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else { load(); start(); }
  });
  addEventListener('pagehide', stop);
  addEventListener('pageshow', function (e) { if (e.persisted) { load(); start(); } });

  // a ticket bought in the NextGen checkout (tickets page, any open tab): ask again now, and once
  // more after the server's short cache has turned over
  try {
    new BroadcastChannel('nextgen-tickets').onmessage = function () { load(); setTimeout(load, 16000); };
  } catch (e) { /* older browsers simply wait for the next tick */ }

  load();
  if (!document.hidden) start();
})();
