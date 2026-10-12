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
})();
