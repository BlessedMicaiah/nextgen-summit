/* NextGen Summit — the Experience.
   Two things live here. The entrance: the wordmark arrives on near-black, takes the accent,
   then opens and the theatre is behind it. And the chapters: each one holds its photograph
   still while its scenes scroll past, and the photograph changes as each scene reaches the
   middle of the screen. Transform and opacity only; nothing is driven frame by frame. */
(function () {
  'use strict';

  if (window.__ngsXP) return;
  window.__ngsXP = true;

  var root = document.documentElement;
  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- the entrance ---------- */
  var intro = $('.intro');
  var timers = [];

  function done() {
    timers.forEach(clearTimeout);
    timers = [];
    root.classList.remove('is-intro', 'in-1', 'in-2', 'in-3');
    if (intro && intro.parentNode) intro.parentNode.removeChild(intro);
    intro = null;
  }

  function run() {
    if (!intro) return;
    if (reduce.matches) {                              // the brand, then a fade. Nothing moves.
      root.classList.add('in-1', 'in-2');
      timers.push(setTimeout(function () { root.classList.add('in-3'); }, 420));
      timers.push(setTimeout(done, 1180));
      return;
    }
    var at = function (ms, cls) { timers.push(setTimeout(function () { root.classList.add(cls); }, ms)); };
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        root.classList.add('in-1');                    // the wordmark arrives
        at(520, 'in-2');                               // and takes the accent
        at(1010, 'in-3');                              // then opens on the theatre
        timers.push(setTimeout(done, 2000));
      });
    });
  }

  if (intro) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
    // a page coming back from the back/forward cache is already past its entrance
    window.addEventListener('pageshow', function (e) { if (e.persisted) done(); });
    if (reduce.addEventListener) reduce.addEventListener('change', function () { if (reduce.matches) done(); });
  }

  /* ---------- the chapters ---------- */
  $$('.ch').forEach(function (ch) {
    var scenes = $$('.sc', ch);
    var shots = $$('[data-scene]', $('.ch__stage', ch));
    if (!scenes.length || !shots.length) return;
    var active = null;

    function show(key) {
      if (key === active) return;
      active = key;
      shots.forEach(function (s) { s.classList.toggle('is-on', s.getAttribute('data-scene') === key); });
      scenes.forEach(function (s) { s.classList.toggle('is-on', s.getAttribute('data-scene') === key); });
    }

    show(scenes[0].getAttribute('data-scene'));

    // the scene crossing the middle band of the screen owns the photograph
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) show(e.target.getAttribute('data-scene')); });
    }, { rootMargin: '-45% 0px -45% 0px' });
    scenes.forEach(function (s) { io.observe(s); });

    // the photographs are only worth fetching once the chapter is near
    var once = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return;
      once.disconnect();
      shots.forEach(function (p) {
        $$('source, img', p).forEach(function (n) {
          if (n.dataset.srcset) { n.srcset = n.dataset.srcset; delete n.dataset.srcset; }
          if (n.dataset.src) { n.src = n.dataset.src; delete n.dataset.src; }
        });
      });
    }, { rootMargin: '60% 0px' });
    once.observe(ch);
  });
})();
