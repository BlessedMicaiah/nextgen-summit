/* NextGen Summit — leaving for the Experience.
   The page does not cut away. It darkens, and the Experience opens on the same black with
   the wordmark already in it, so the two halves read as one move. Nothing travels across the
   screen and there is no wait: the fade is the navigation.

   The link is a link throughout. Without JavaScript, with reduced motion, on a middle click
   or a modifier click, the browser navigates and none of this runs. */
(function () {
  'use strict';

  if (window.__ngsDepart) return;
  window.__ngsDepart = true;

  var FADE = 520;
  var STRANDED = 2400;                               // navigation never happened: give it back
  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var veil = null, going = false, timers = [];

  function clear() {
    timers.forEach(clearTimeout);
    timers = [];
    if (veil && veil.parentNode) veil.parentNode.removeChild(veil);
    veil = null;
    going = false;
  }

  function leave(href) {
    if (going) return;
    going = true;
    veil = document.createElement('div');
    veil.className = 'depart';
    veil.setAttribute('aria-hidden', 'true');
    document.body.appendChild(veil);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        veil.classList.add('is-on');
        timers.push(setTimeout(function () { window.location.href = href; }, FADE - 40));
        timers.push(setTimeout(clear, STRANDED));
      });
    });
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest('a[data-depart]') : null;
    if (!a || a.target === '_blank' || reduce.matches) return;
    var href = a.getAttribute('href');
    if (!href || a.pathname === location.pathname) return;
    e.preventDefault();
    leave(href);
  });

  // warm the room while the pointer is still on its way
  var warmed = false;
  document.addEventListener('pointerenter', function (e) {
    if (warmed || !e.target.closest) return;
    var a = e.target.closest('a[data-depart]');
    if (!a) return;
    warmed = true;
    var l = document.createElement('link');
    l.rel = 'prefetch';
    l.href = a.getAttribute('href');
    document.head.appendChild(l);
  }, true);

  // a page restored from the back/forward cache must never come back darkened
  window.addEventListener('pageshow', function (e) { if (e.persisted) clear(); });
})();
