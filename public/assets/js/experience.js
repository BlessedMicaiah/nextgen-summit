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

  /* ---------- the stage ----------
     One frame, six scenes. The scene crossing the middle of the screen owns the picture; on
     each change the house lights dip, one turquoise cue crosses the frame, and they come back
     up on the next picture. Narrow screens get the same scenes told straight down instead:
     each one keeps its own picture and nothing is held or pinned. */
  var stage = $('.stg');
  if (stage) {
    var frame = $('.stg__frame', stage);
    var scenes = $$('.sn', stage);
    var shots = $$('picture[data-scene]', frame);
    var actEl = $('[data-stg-act]', stage);
    var numEl = $('[data-stg-n]', stage);
    var ruleEl = $('[data-stg-rule]', stage);
    var at = null, cueTimer = null;

    function wake(scope) {
      $$('picture[data-scene] img', scope).forEach(function (n) {
        if (n.dataset.srcset) { n.srcset = n.dataset.srcset; delete n.dataset.srcset; }
        if (n.dataset.src) { n.src = n.dataset.src; delete n.dataset.src; }
      });
    }

    function light(key, n, act) {
      if (key === at) return;
      var first = at === null;
      at = key;
      shots.forEach(function (p) { p.classList.toggle('is-on', p.getAttribute('data-scene') === key); });
      scenes.forEach(function (sn) { sn.classList.toggle('is-on', sn.getAttribute('data-scene') === key); });
      if (actEl) actEl.textContent = act;
      if (numEl) numEl.textContent = 'Scene ' + n;
      if (ruleEl) ruleEl.style.setProperty('--p', (parseInt(n, 10) / scenes.length).toFixed(3));
      if (first || reduce.matches) return;
      stage.classList.add('is-cueing');                 // light cue, scene change, reveal
      clearTimeout(cueTimer);
      cueTimer = setTimeout(function () { stage.classList.remove('is-cueing'); }, 800);
    }

    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var sn = e.target;
        light(sn.getAttribute('data-scene'), sn.getAttribute('data-n'), sn.getAttribute('data-act'));
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    scenes.forEach(function (sn) { io.observe(sn); });

    var near = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return;
      near.disconnect();
      wake(stage);
    }, { rootMargin: '70% 0px' });
    near.observe(stage);

    if (scenes.length) light(scenes[0].getAttribute('data-scene'), scenes[0].getAttribute('data-n'), scenes[0].getAttribute('data-act'));
  }
})();
