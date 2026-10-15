/* NextGen Summit — who's coming: registered attendee names on the credential.
   The names arrive with the live count: counter.js fires "ngs:tally" with each reply from
   /api/attendee-count.php, whose "names" lists first name and last initial ("Maya R."), each
   name once, newest registration first. The card stays hidden until at least one arrives.

   One person at a time, never a list. Each name is written onto the card left to right, as a
   hand would write it, then holds long enough to read before the next person takes its place.
   With reduced motion the name simply appears and nothing turns by itself. Screen readers get
   the names once, as a list, rather than an announcement every few seconds.

   Preview: on localhost (or with ?names=demo) sample names stand in, marked "Sample names" so
   a preview is never mistaken for real registrations. */
(function () {
  'use strict';

  var box = document.querySelector('[data-names-box]');
  var tally = document.querySelector('[data-tally]');
  if (!box || !tally) return;

  var view = box.querySelector('[data-names="badge"]');
  var slot = box.querySelector('.nb__names');
  var srOut = box.querySelector('[data-names-sr]');
  var demoTag = box.querySelector('[data-names-demo]');
  if (!view || !slot) return;

  var reduce = matchMedia('(prefers-reduced-motion: reduce)');
  var host = location.hostname;
  var demo = /(?:^|[?&])names=demo(?:&|$)/.test(location.search) ||
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || /\.localhost$/.test(host);
  var SAMPLE = ['Maya R.', 'Jordan T.', 'Aaliyah M.', 'Diego S.', 'Priya K.', 'Marcus J.', 'Sofia L.',
    'Andre W.', 'Nia B.', 'Elijah C.'];

  var names = [];
  var idx = 0;
  var shown = null;
  var cur = null;
  var timers = [];

  var HOLD = 5200;          // how long a name stays before the next one is written
  var WRITE = 1150;         // how long the hand takes to cross the name

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearLater() { timers.forEach(clearTimeout); timers = []; }

  // one line, always: a long name is set smaller rather than wrapped or cut
  function fit(p) {
    p.style.transform = '';
    var room = slot.clientWidth;
    var w = p.scrollWidth;
    if (room && w > room) p.style.transform = 'scale(' + (room / w).toFixed(3) + ')';
    p.style.transformOrigin = 'left bottom';
  }

  function make(name) {
    var p = document.createElement('p');
    p.className = 'nb__name';
    p.textContent = name;
    return p;
  }

  /* writes a name on: the mask sweeps left to right, so the strokes appear in the order a
     hand would make them. The sweep is driven by the browser, not a timer per letter. */
  function write(name) {
    var p = make(name);
    p.classList.add('is-writing');
    p.style.setProperty('--ink-to', '0%');
    slot.appendChild(p);
    fit(p);

    var old = cur;
    cur = p;
    shown = name;

    if (reduce.matches) {
      p.style.setProperty('--ink-to', '100%');
      if (old) old.remove();
      return;
    }

    if (old) {
      old.classList.add('is-out');
      later(function () { old.remove(); }, 360);
    }

    // ease-out, so the hand slows as it finishes the last letters
    var t0 = performance.now();
    (function step(now) {
      if (cur !== p) return;                      // a newer name took over
      var k = Math.min(1, (now - t0) / WRITE);
      var e = 1 - Math.pow(1 - k, 3);
      p.style.setProperty('--ink-to', (e * 100).toFixed(2) + '%');
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  function next() {
    if (names.length < 2) return;
    idx = (idx + 1) % names.length;
    write(names[idx]);
    later(next, HOLD + WRITE);
  }

  function start() {
    clearLater();
    if (!names.length) return;
    box.hidden = false;
    tally.classList.add('has-names');
    if (demoTag) demoTag.hidden = !demo;

    // a refreshed list carries on from whoever is on the card, so everyone gets a turn
    if (shown) {
      var i = names.indexOf(shown);
      idx = i < 0 ? 0 : i;
    } else {
      idx = 0;
    }
    if (shown !== names[idx]) write(names[idx]);
    if (names.length > 1 && !reduce.matches) later(next, HOLD + WRITE);

    if (srOut && !srOut.textContent) {
      srOut.textContent = 'Among those registered: ' + names.slice(0, 12).join(', ') + '.';
    }
  }

  // counter.js hands over every reply from the endpoint
  document.addEventListener('ngs:tally', function (e) {
    var list = e && e.detail && Array.isArray(e.detail.names) ? e.detail.names : null;
    if (!list && demo) list = SAMPLE;
    if (!list || !list.length) return;
    var same = list.length === names.length && list.every(function (n, i) { return n === names[i]; });
    names = list;
    if (!same || !cur) start();
  });

  if (demo) {
    names = SAMPLE;
    start();
  }

  // nothing writes itself while the page is out of sight
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) clearLater();
    else if (names.length > 1 && !reduce.matches) later(next, HOLD);
  });

  /* ---------- the credential swings when it is touched ----------
     A damped pendulum hung from the top of the strap. A pointer passing over the card or the
     lanyard pushes it the way the pointer is going: harder the faster it moves, and less the
     further below the pivot it is caught, as a real lever would. Gravity brings it back and
     the air takes the energy out, so it settles on its own. On a touch screen a tap nudges it
     away from the finger. The angle goes to the `rotate` property, which adds to the gentle
     idle sway the stylesheet keeps on `transform` rather than replacing it. */
  var hang = view.querySelector('.nb__hang');
  var strap = view.querySelector('.nb__strap');
  if (hang && !reduce.matches) {
    var W2 = Math.pow(2 * Math.PI / 1.7, 2);  // gravity over length: a 1.7 s swing
    var DAMP = 1.35;                           // per second: a hard push dies away in about 3 s
    var MAX_A = 0.5, MAX_W = 1.6;              // about 29 degrees, never reached; a cap on how hard it spins
    var ang = 0, vel = 0, raf = null, last = 0, lastX = null, lastT = 0;

    var pivotY = function () {
      return hang.getBoundingClientRect().top - (strap ? strap.offsetHeight : 0);
    };
    var clamp = function (v, m) { return v > m ? m : v < -m ? -m : v; };

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
        // a clockwise turn (positive) carries a hanging card's bottom to the left, so a push to
        // the right is a negative turn
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
  }
})();
