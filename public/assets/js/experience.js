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
      timers.push(setTimeout(function () { root.classList.add('in-3'); }, 460));
      timers.push(setTimeout(done, 1500));
      return;
    }
    var at = function (ms, cls) { timers.push(setTimeout(function () { root.classList.add(cls); }, ms)); };
    var go = function () {
      requestAnimationFrame(function () {
        root.classList.add('in-1');                    // the letters are written out of the black
        at(780, 'in-2');                               // SUMMIT settles and the colour flows in
        at(2050, 'in-3');                              // and it dissolves into the room
        timers.push(setTimeout(done, 3400));
      });
    };
    // the letters are drawn in the wordmark's own face, so wait for it (briefly): animating the
    // fallback and then swapping it would make every letter jump
    var face = document.fonts && document.fonts.load ? document.fonts.load('900 1em Fraunces') : null;
    if (face) Promise.race([face, new Promise(function (r) { setTimeout(r, 700); })]).then(go, go);
    else go();
  }

  if (intro) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
    // a page coming back from the back/forward cache is already past its entrance
    window.addEventListener('pageshow', function (e) { if (e.persisted) done(); });
    if (reduce.addEventListener) reduce.addEventListener('change', function () { if (reduce.matches) done(); });
  }

  /* ---------- the stage ----------
     One frame, six scenes. The scene crossing the middle of the screen owns the picture, and
     the change is a dissolve: the two overlap while one fades out and the other fades in.
     Nothing travels across the frame. */
  var stage = $('.stg');
  if (stage) {
    var frame = $('.stg__frame', stage);
    var scenes = $$('.sn', stage);
    var shots = $$('picture[data-scene]', frame);
    var acts = $$('.act', stage);
    var actEl = $('[data-stg-act]', stage);
    var numEl = $('[data-stg-n]', stage);
    var ruleEl = $('[data-stg-rule]', stage);
    var at = null;

    function wake(scope) {
      $$('picture[data-scene] img', scope).forEach(function (n) {
        if (n.dataset.srcset) { n.srcset = n.dataset.srcset; delete n.dataset.srcset; }
        if (n.dataset.src) { n.src = n.dataset.src; delete n.dataset.src; }
      });
    }

    function light(key, n, act) {
      if (key === at) return;
      at = key;
      shots.forEach(function (p) { p.classList.toggle('is-on', p.getAttribute('data-scene') === key); });
      scenes.forEach(function (sn) { sn.classList.toggle('is-on', sn.getAttribute('data-scene') === key); });
      if (actEl) actEl.textContent = act;
      if (numEl) numEl.textContent = 'Scene ' + n;
      if (ruleEl) ruleEl.style.setProperty('--p', (parseInt(n, 10) / scenes.length).toFixed(3));
    }

    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var sn = e.target;
        light(sn.getAttribute('data-scene'), sn.getAttribute('data-n'), sn.getAttribute('data-act'));
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    scenes.forEach(function (sn) { io.observe(sn); });

    /* The title cards. Reaching an act takes the picture out altogether and puts the act on a
       field of its own, dark for the first and paper for the second; leaving it brings the
       picture back and the scenes carry on. The nav bar is told, because over the paper card a
       white bar would be invisible. */
    function cards() {
      var lit = acts.filter(function (a) { return a.classList.contains('is-on'); });
      var paper = lit.some(function (a) { return a.getAttribute('data-card') === 'paper'; });
      stage.classList.toggle('is-card', lit.length > 0);
      stage.classList.toggle('is-card--paper', paper);
      stage.classList.toggle('is-paper', paper);
      if (window.__ngsNav) window.__ngsNav();
    }

    var actIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.target.classList.toggle('is-on', e.isIntersecting); });
      cards();
    }, { rootMargin: '-30% 0px -30% 0px' });
    acts.forEach(function (a) { actIO.observe(a); });

    var near = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return;
      near.disconnect();
      wake(stage);
    }, { rootMargin: '70% 0px' });
    near.observe(stage);

    if (scenes.length) light(scenes[0].getAttribute('data-scene'), scenes[0].getAttribute('data-n'), scenes[0].getAttribute('data-act'));
  }
})();
