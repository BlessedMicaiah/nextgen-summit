/* NextGen Summit — official exhibitors: the three hanging credentials swing when touched.
   The same damped pendulum as the attendee credential (names.js), one per card, hung from
   the top of its strap. A pointer passing over a card pushes it the way the pointer is going:
   harder the faster it moves, and less the further below the pivot it is caught. Gravity
   brings it back and the air takes the energy out. On a touch screen a tap nudges it away
   from the finger. The angle goes to the `rotate` property, which adds to the idle sway the
   stylesheet keeps on `transform`. Nothing moves with reduced motion. */
(function () {
  'use strict';

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var W2 = Math.pow(2 * Math.PI / 1.7, 2);  // gravity over length: a 1.7 s swing
  var DAMP = 1.35;                           // per second: a hard push dies away in about 3 s
  var MAX_A = 0.5, MAX_W = 1.6;
  var clamp = function (v, m) { return v > m ? m : v < -m ? -m : v; };

  Array.prototype.forEach.call(document.querySelectorAll('.xb__hang'), function (hang) {
    var strap = hang.querySelector('.xb__strap');
    var ang = 0, vel = 0, raf = null, last = 0, lastX = null, lastT = 0;

    var pivotY = function () {
      return hang.getBoundingClientRect().top - (strap ? strap.offsetHeight : 0);
    };

    function step(t) {
      var dt = Math.min(0.034, (t - last) / 1000 || 0.016);
      last = t;
      vel += (-W2 * Math.sin(ang) - DAMP * vel) * dt;
      ang = clamp(ang + vel * dt, MAX_A);
      hang.style.rotate = ang.toFixed(5) + 'rad';
      if (Math.abs(ang) < 0.0004 && Math.abs(vel) < 0.002) {
        ang = vel = 0; hang.style.rotate = ''; raf = null; return;
      }
      raf = requestAnimationFrame(step);
    }
    function push(dw) {
      vel = clamp(vel + dw, MAX_W);
      if (raf === null) { last = performance.now(); raf = requestAnimationFrame(step); }
    }

    hang.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      var now = e.timeStamp;
      if (lastX !== null && now - lastT < 120) {
        var dx = e.clientX - lastX;
        var speed = Math.abs(dx) / Math.max(1, now - lastT) * 1000;          // px per second
        var arm = Math.max(60, e.clientY - pivotY());
        // a clockwise turn carries a hanging card's bottom to the left, so a push right is negative
        push(-clamp(dx / arm, 0.12) * 1.5 * (0.3 + 0.7 * Math.min(1, speed / 900)));
      }
      lastX = e.clientX; lastT = now;
    });
    hang.addEventListener('pointerleave', function () { lastX = null; });
    hang.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      var r = hang.getBoundingClientRect();
      var off = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);          // -1 left edge .. 1 right
      push(clamp(off, 1) * 0.9 + (off >= 0 ? 0.25 : -0.25));    // away from the finger
    });
  });
})();
