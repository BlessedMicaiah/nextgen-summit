/* NextGen Summit — the curtain between the homepage and the Experience.
   Two leaves a side close over the page, the browser navigates behind them, and the
   destination opens them again. Everything is transform and opacity, so the whole thing
   runs on the compositor; the layer is built on first use and taken out of the DOM when it
   is finished, so nothing of it is left sitting over the page.

   The link is a link throughout. Without JavaScript, with reduced motion, on a middle
   click or a modifier click, the browser navigates and no curtain is involved. */
(function () {
  'use strict';

  if (window.__ngsCurtain) return;
  window.__ngsCurtain = true;

  var KEY = 'ngs:curtain';
  var CLOSE = 520;                 // the leaves meet
  var HOLD = 90;                   // a beat shut before the page changes
  var OPEN = 680;                  // and part again on the other side
  var STRANDED = 2600;             // navigation never happened: give the page back

  var root = document.documentElement;
  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  var layer = null;
  var leaving = false;

  function wants() { return !(reduce && reduce.matches); }

  function build() {
    var el = document.querySelector('.curt');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'curt';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div class="curt__s curt__s--l"><i class="curt__b"></i><i class="curt__f"></i></div>' +
      '<div class="curt__s curt__s--r"><i class="curt__b"></i><i class="curt__f"></i></div>';
    document.body.appendChild(el);
    return el;
  }

  function drop() {
    root.classList.remove('is-curtained', 'is-closing', 'is-opening');
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    layer = null;
    leaving = false;
  }

  /* ---------- leaving: close, then go ---------- */
  function close(href) {
    if (leaving) return;
    leaving = true;
    layer = build();
    root.classList.add('is-curtained');
    // one frame with the leaves parked off-screen, so the transition has a start to run from
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        root.classList.add('is-closing');
        setTimeout(function () { window.location.href = href; }, CLOSE + HOLD);
        // the back button, a blocked navigation, anything: never leave the page covered
        setTimeout(function () { if (leaving) { root.classList.remove('is-closing'); setTimeout(drop, OPEN); } }, STRANDED);
      });
    });
  }

  /* ---------- arriving: the destination parts them ---------- */
  function open() {
    layer = document.querySelector('.curt');
    if (!layer) { root.classList.remove('is-curtained'); return; }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        root.classList.add('is-opening');
        setTimeout(drop, OPEN + 160);
      });
    });
  }

  /* ---------- the links that carry it ---------- */
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest('a[data-curtain]') : null;
    if (!a || a.target === '_blank') return;
    if (!wants() || !('sessionStorage' in window)) return;      // the plain link does the job
    var href = a.getAttribute('href');
    if (!href || a.pathname === location.pathname) return;       // already here
    e.preventDefault();
    try { sessionStorage.setItem(KEY, '1'); } catch (err) { window.location.href = href; return; }
    close(href);
  });

  // warm the destination while the pointer is still travelling, so the shut beat stays short
  var warmed = false;
  document.addEventListener('pointerenter', function (e) {
    if (warmed || !e.target.closest) return;
    var a = e.target.closest('a[data-curtain]');
    if (!a) return;
    warmed = true;
    var l = document.createElement('link');
    l.rel = 'prefetch';
    l.href = a.getAttribute('href');
    document.head.appendChild(l);
  }, true);

  /* a page restored from the back/forward cache must never come back still covered */
  window.addEventListener('pageshow', function (e) { if (e.persisted) drop(); });

  if (root.classList.contains('is-curtained')) {
    if (!wants()) { drop(); }
    else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', open, { once: true });
    else open();
  }

  // the preference can change while the page is open; a covered page must give way at once
  if (reduce && reduce.addEventListener) {
    reduce.addEventListener('change', function () { if (reduce.matches && root.classList.contains('is-curtained')) drop(); });
  }
})();
