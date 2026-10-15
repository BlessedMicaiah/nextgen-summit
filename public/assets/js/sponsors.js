/* NextGen Summit — the homepage sponsor strip, made something you can move.
   It drifts left on its own, as the CSS animation did, but here the script owns the position so
   a visitor can take hold of it: drag it with a mouse, swipe it on a phone, or scroll it sideways
   on a trackpad (or Shift + wheel). Let go and it carries on with the speed it was given, eases
   back to its drift, and stops while a pointer rests on it or a logo has keyboard focus.

   The track holds six identical runs, so the position wraps every three runs (half the track)
   and the strip never runs out in either direction. A drag never opens a sponsor's link; a plain
   click still does. Vertical swipes and wheels are left to the page. Without this script the CSS
   animation carries on; with reduced motion the strip stays the still row the stylesheet gives it. */
(function () {
  'use strict';

  var box = document.querySelector('.spon__marquee');
  var track = box && box.querySelector('.spon__track');
  if (!track) return;
  var motion = matchMedia('(prefers-reduced-motion: reduce)');
  var pause = document.querySelector('.spon__pause');
  var paused = false;

  box.classList.add('is-live');                     // the stylesheet stands its animation down
  box.querySelectorAll('img').forEach(function (i) { i.draggable = false; });

  var half = 0;                                      // one full set of three runs, in px
  var x = 0;                                         // how far the strip has travelled left
  var v = 0;                                         // current speed, px per second
  var cruise = 0;                                    // the drift it returns to
  var held = false, hovered = false, focused = false, visible = true;
  var raf = null, last = 0;

  function measure() {
    half = track.scrollWidth / 2;
    // Match the slower CSS drift, giving each mark time to be read.
    cruise = half / (innerWidth <= 760 ? 78 : 90);
    if (!held && !hovered && !focused) v = paused ? 0 : cruise;
  }
  function wrap() { if (half > 0) x = ((x % half) + half) % half; }
  function paint() { track.style.transform = 'translate3d(' + (-x).toFixed(2) + 'px,0,0)'; }

  function frame(t) {
    if (motion.matches) { raf = null; return; }
    var dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    if (!held) {
      var target = paused || hovered || focused ? 0 : cruise;
      // a fling slows like a coasting wheel; the drift picks itself back up more gently
      v += (target - v) * (1 - Math.exp(-dt * (Math.abs(v) > cruise ? 2.4 : 1.6)));
      x += v * dt;
      if (!focused) wrap();
      paint();
    }
    raf = visible && !document.hidden ? requestAnimationFrame(frame) : null;
  }
  function run() {
    if (raf === null && visible && !document.hidden && !motion.matches) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  /* ---------- drag and swipe ---------- */
  var startX = 0, startY = 0, lastX = 0, lastT = 0, moved = false, decided = false, pid = null;

  box.addEventListener('pointerdown', function (e) {
    if (motion.matches) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pid = e.pointerId; startX = lastX = e.clientX; startY = e.clientY; lastT = e.timeStamp;
    moved = false; decided = e.pointerType === 'mouse';   // a touch waits to see which way it goes
    held = decided;
    if (held) { v = 0; box.classList.add('is-held'); }
  });

  box.addEventListener('pointermove', function (e) {
    if (e.pointerId !== pid) return;
    var dx = e.clientX - startX, dy = e.clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      decided = true;
      if (Math.abs(dy) > Math.abs(dx)) { pid = null; return; }   // a vertical swipe belongs to the page
      held = true; v = 0; box.classList.add('is-held');
    }
    if (!held) return;
    if (!moved && Math.abs(dx) > 5) { moved = true; try { box.setPointerCapture(pid); } catch (err) {} }
    var step = e.clientX - lastX, dt = Math.max(1, e.timeStamp - lastT);
    x -= step; wrap(); paint();
    v = -step / dt * 1000 * 0.8 + v * 0.2;                 // remembered for the throw
    lastX = e.clientX; lastT = e.timeStamp;
  });

  function release(e) {
    if (e.pointerId !== pid) return;
    pid = null;
    if (!held) return;
    held = false; box.classList.remove('is-held');
    if (e.timeStamp - lastT > 90) v = 0;                    // it was held still before letting go
    v = Math.max(-3200, Math.min(3200, v));
    run();
  }
  box.addEventListener('pointerup', release);
  box.addEventListener('pointercancel', release);

  // a drag that ends over a logo must not open it
  box.addEventListener('click', function (e) {
    if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
  }, true);

  /* ---------- sideways scrolling ---------- */
  box.addEventListener('wheel', function (e) {
    if (motion.matches) return;
    var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (!d) return;                                          // an ordinary wheel scrolls the page
    e.preventDefault();
    x += d * (e.deltaMode === 1 ? 32 : 1);
    v = 0; wrap(); paint(); run();
  }, { passive: false });

  /* ---------- rest while looked at ---------- */
  box.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') hovered = true; });
  box.addEventListener('pointerleave', function () { hovered = false; });
  box.addEventListener('focusin', function (e) {
    focused = true;
    v = 0;
    if (motion.matches) return;
    // bring a logo reached by Tab fully into view, centred. Only for the keyboard: a mouse press
    // focuses the link too, and moving the strip under it would make the click miss.
    var li = e.target.closest('.spon__logo');
    if (!li || held || !e.target.matches(':focus-visible')) return;
    var b = box.getBoundingClientRect(), r = li.getBoundingClientRect();
    x += (r.left + r.width / 2) - (b.left + b.width / 2);
    paint();
  });
  box.addEventListener('focusout', function () { focused = false; });

  if (pause) {
    pause.hidden = motion.matches;
    pause.addEventListener('click', function () {
      paused = !paused;
      v = 0;
      pause.setAttribute('aria-pressed', String(paused));
      pause.textContent = paused ? 'Resume motion' : 'Pause motion';
    });
  }
  function syncMotion() {
    held = false; pid = null; v = 0;
    box.classList.remove('is-held');
    box.classList.toggle('is-live', !motion.matches);
    if (pause) pause.hidden = motion.matches;
    if (motion.matches) {
      cancelAnimationFrame(raf); raf = null; x = 0;
      track.style.transform = '';
    } else { measure(); paint(); run(); }
  }
  motion.addEventListener('change', syncMotion);

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; run(); }).observe(box);
  }
  document.addEventListener('visibilitychange', run);
  addEventListener('resize', function () { var p = half ? x / half : 0; measure(); x = p * half; wrap(); paint(); });

  syncMotion();
})();
