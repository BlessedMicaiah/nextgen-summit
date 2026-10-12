/* NextGen Summit — live ticket counter on the homepage.
   Reads {"count": N} from /api/attendee-count.php (Eventbrite, cached briefly on the server)
   every 10 seconds while the page is visible. The counter stays hidden until a real count
   arrives, keeps the last good number if a refresh fails, and never shows a placeholder zero.

   Around the number: the C/M/Y plates misregister and settle into black whenever it changes,
   a halftone screen draws one dot per person (stamped in step with the count-up, so the dots
   and the number always agree), people who register while the page is open get a printed
   ring, and the Live mark greys out if Eventbrite has not answered for a while.

   Where people come from: when the reply also carries "states" ([[code, n], ...], most first)
   and "unknown", every dot is inked in its state's colour, the most common state in the brand
   turquoise. States are scattered through the screen like a crowd, never stacked in bands, but
   the counts are exact: 71 Maryland dots means 71 people from Maryland. The scatter is fixed
   (the same dot is always the same seat), and a new snapshot re-inks dots with a short
   crossfade instead of moving them. No state given stays black, so the screen reads as it
   always has until answers come in. Dots past the snapshot (registered in the last minutes)
   print as hollow rings until their state is known.

   Pointing at the crowd: the dots are ink on springs. The pointer pushes them aside and they
   wobble back into the screen; the dot under it swells, says where that person is from, and
   sends a ripple through everyone from the same state while the rest of the crowd steps back.
   The chips below are the key and do the same from a keyboard or a tap. */
(function () {
  'use strict';

  var box = document.querySelector('[data-tally]');
  if (!box || window.__ngsTally) return;               // one counter, one poller
  window.__ngsTally = true;

  var URL = '/api/attendee-count.php';
  // a local preview has no PHP behind it: a sample count stands in, labelled as one, so the card can
  // be seen. Only where the API gives no count, and only on localhost (or with ?names=demo).
  var SAMPLE = (location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ||
    /(?:^|[?&])names=demo(?:&|$)/.test(location.search)) ? 129 : null;
  var sampleTag = box.querySelector('[data-tally-sample]');
  var EVERY = 10000;
  var STALE = 45000;                                   // no good answer for this long: Live greys out
  var TOP = 6;                                         // states with a chip of their own; the rest share one
  var num = box.querySelector('[data-tally-n]');
  var layers = num.querySelectorAll('.reg__k, .reg__p');
  var sr = box.querySelector('[data-tally-sr]');
  var live = box.querySelector('[data-tally-live]');
  var fresh = box.querySelector('[data-tally-new]');
  var freshT = box.querySelector('[data-tally-new-t]');
  var canvas = box.querySelector('[data-tally-crowd]');
  var tip = box.querySelector('[data-tally-tip]');
  var statesBox = box.querySelector('[data-tally-states]');
  var chipsBox = box.querySelector('[data-tally-chips]');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');
  var shown = null;          // the number on screen
  var target = null;         // the latest real count
  var base = null;           // the count when this page first heard from Eventbrite
  var seen = false;          // has the counter been scrolled into view yet
  var okAt = 0;              // when the last good answer came
  var timer = null, busy = false, anim = null;

  var NAMES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
    CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
    IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
    ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
    NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
    ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
    RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
    UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
    WI: 'Wisconsin', WY: 'Wyoming', DC: 'Washington, DC', PR: 'Puerto Rico', GU: 'Guam',
    VI: 'U.S. Virgin Islands', AS: 'American Samoa', MP: 'Northern Mariana Islands',
    INTL: 'Outside the US'
  };
  var UNKNOWN = '?', LATE = '+';                       // group keys: state not given, not in the snapshot yet
  var INK = '#0B0B0F';
  // spot inks, most common state first: the brand turquoise, then the process inks and their
  // overprints, then warm and cool accents; past these, evenly turned hues at the same strength
  var INKS = ['#1FC7BE', '#EC008C', '#00A3E6', '#F2B300', '#2B3990', '#ED1C24', '#00A651',
    '#F7941D', '#7B3FA0', '#A3C939', '#F49AC1', '#8C6239'];

  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function people(n) { return fmt(n) + (n === 1 ? ' person' : ' people'); }
  function write(n) {
    var s = fmt(n);
    // the number is normally set in printing plates (.reg__k/.reg__p); where the markup has
    // none, it is plain type and the element carries it itself
    if (!layers.length) { num.textContent = s; return; }
    for (var i = 0; i < layers.length; i++) layers[i].textContent = s;
  }
  function inkFor(rank) {
    if (rank < INKS.length) return INKS[rank];
    return 'hsl(' + Math.round((rank * 137.508) % 360) + ',68%,46%)';
  }
  function rgb(c) {                                    // '#rrggbb' or 'hsl(h,s%,l%)' to [r, g, b] via the canvas
    var cv = rgb.cv || (rgb.cv = document.createElement('canvas').getContext('2d'));
    cv.fillStyle = '#000'; cv.fillStyle = c;
    var h = cv.fillStyle;                              // the browser normalises to #rrggbb
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  // a fixed number in [0, 1) for each dot: its seat in the scatter
  function seat(i) { var x = Math.sin((i + 1) * 78.233) * 43758.5453; return x - Math.floor(x); }

  /* ---------- plates: the same misregister-and-settle as the hero wordmark (site.css .reg) ---------- */
  var t1 = null, t2 = null;
  function plates(delay) {
    if (reduce.matches) return;
    clearTimeout(t1); clearTimeout(t2);
    num.classList.remove('is-in', 'is-done');
    num.classList.add('is-armed');
    void num.offsetWidth;                              // commit the misregistered start state
    t1 = setTimeout(function () {
      num.classList.add('is-in');
      t2 = setTimeout(function () { num.classList.add('is-done'); }, 1700);
    }, delay || 0);
  }

  /* ---------- groups: the latest per-state snapshot, dealt out over the dots ---------- */
  var snap = null;           // { states: [[code, n], ...], unknown: n } or null when the server has none
  var keyOf = [];            // dot index -> group key, for every dot the snapshot covers
  var colour = {};           // group key -> [r, g, b]
  var coloured = false;      // at least one real state: the screen is inked by state

  function keyAt(i) { return i < keyOf.length ? keyOf[i] : (snap ? LATE : UNKNOWN); }
  function sizeOf(key) {
    if (!snap) return target || 0;
    if (key === UNKNOWN) return snap.unknown;
    if (key === LATE) return Math.max(0, (target || 0) - keyOf.length);
    for (var k = 0; k < snap.states.length; k++) if (snap.states[k][0] === key) return snap.states[k][1];
    return 0;
  }

  function useSnapshot(d) {
    var ok = d && Array.isArray(d.states) && typeof d.unknown === 'number';
    var next = ok ? { states: d.states.filter(function (s) { return Array.isArray(s) && NAMES[s[0]] && s[1] > 0; }), unknown: d.unknown } : null;
    if (JSON.stringify(next) === JSON.stringify(snap)) return;
    var before = keyOf, beforeColour = colour;
    snap = next;
    keyOf = [];
    colour = {};
    coloured = !!(snap && snap.states.length);
    if (snap) {
      // deal the groups over the dots in seat order: exact counts, scattered like a crowd
      var total = snap.unknown;
      snap.states.forEach(function (s, r) { total += s[1]; colour[s[0]] = rgb(inkFor(r)); });
      var order = [];
      for (var i = 0; i < total; i++) order.push(i);
      order.sort(function (a, b) { return seat(a) - seat(b); });
      var at = 0;
      snap.states.forEach(function (s) { for (var n = 0; n < s[1]; n++) keyOf[order[at++]] = s[0]; });
      while (at < total) keyOf[order[at++]] = UNKNOWN;
    }
    colour[UNKNOWN] = colour[LATE] = rgb(INK);
    box.classList.toggle('is-coloured', coloured);
    chips();
    crowd.reink(before, beforeColour);
  }

  /* ---------- the crowd: one halftone dot per person ---------- */
  var crowd = (function () {
    var noop = function () {};
    if (!canvas || !canvas.getContext) return { size: noop, draw: noop, arrive: noop, reink: noop, light: noop, ripple: noop };
    var ctx = canvas.getContext('2d');
    var PLATES = ['#00A3E6', '#EC008C', '#FFE500'].map(rgb);
    var INK_RGB = rgb(INK);
    var g = null;            // grid: width, pitch, columns, rows
    var drawn = 0;           // dots currently drawn
    var arrivals = {};       // index -> time it arrived, for the plate settle
    var raf = null;
    var ptr = null;          // pointer over the screen, in canvas px
    var lens = 0;            // how far the swell around the pointer has grown, 0..1
    var lit = null;          // the groups lit up, as a set of keys ({ MD: true }), or null
    var fade = 0;            // how far everyone else has stepped back, 0..1
    var pinned = -1;         // a dot tapped on a touch screen holds until the next tap
    var hover = -1;          // the dot under the pointer
    var wave = null;         // { x, y, at, keys }: a ripple running through one state
    var was = null;          // { keyOf, colour, at }: the inks before the last snapshot, for the crossfade
    // ink on springs: each dot's offset from its seat in the screen, and its velocity
    var cap = 0, dx, dy, vx, vy;

    function grow(n) {
      if (n <= cap) return;
      var c = Math.max(n, cap * 2, 256);
      function more(a) { var b = new Float32Array(c); if (a) b.set(a); return b; }
      dx = more(dx); dy = more(dy); vx = more(vx); vy = more(vy);
      cap = c;
    }

    // a fixed per-dot size wobble, like ink spread on a real halftone; the same dot is always the same size
    function wobble(i) { var x = Math.sin(i * 12.9898) * 43758.5453; return 0.8 + (x - Math.floor(x)) * 0.2; }

    // the screen ruling that spreads n dots over a block --crowd-h tall: a coarse screen of big dots
    // while the room is small, a finer and fuller one as it grows (never coarser than 38px or finer than 7px)
    function layout(n) {
      var w = canvas.clientWidth;
      if (!w) return null;
      var h = parseFloat(getComputedStyle(canvas).getPropertyValue('--crowd-h')) || 240;
      var pitch = Math.min(38, Math.max(7, Math.sqrt(w * h / Math.max(n, 1))));
      var cols = Math.max(1, Math.floor((w - pitch / 2) / pitch));
      while (pitch > 7 && Math.ceil(n / cols) * pitch > h) {        // rounding left it too tall: tighten a step
        pitch -= 0.5;
        cols = Math.max(1, Math.floor((w - pitch / 2) / pitch));
      }
      return { w: w, h: h, n: n, pitch: pitch, cols: cols, rows: Math.max(1, Math.ceil(n / cols)) };
    }

    function size(n) {
      // someone new keeps the screen as it is (the crowd just gains a dot) until it would run a row past the block
      var keep = g && g.w === canvas.clientWidth && Math.ceil(n / g.cols) * g.pitch <= g.h + g.pitch && n > g.n * 0.8;
      g = keep ? { w: g.w, h: g.h, n: g.n, pitch: g.pitch, cols: g.cols, rows: Math.max(1, Math.ceil(n / g.cols)) } : layout(n);
      if (!g) return;
      grow(n);
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var h = Math.ceil(g.rows * g.pitch);
      canvas.style.height = h + 'px';
      canvas.width = Math.round(g.w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(performance.now());
    }

    function centre(i) {
      var row = Math.floor(i / g.cols), col = i % g.cols;
      return { x: g.pitch * (col + 0.5 + (row % 2 ? 0.5 : 0)), y: g.pitch * (row + 0.5) };   // odd rows sit half a step over
    }

    // the dot under a point, by inverting the screen: no search however big the crowd
    function hit(x, y) {
      if (!g) return -1;
      var row = Math.floor(y / g.pitch);
      var col = Math.floor((x - (row % 2 ? g.pitch / 2 : 0)) / g.pitch);
      if (row < 0 || col < 0 || col >= g.cols) return -1;
      var i = row * g.cols + col;
      return i < drawn ? i : -1;
    }

    function fill(x, y, r, c, a) {
      ctx.fillStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    }
    function ring(x, y, r, c, a, w) {
      ctx.strokeStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke();
    }
    function inkOf(i, now) {
      var c = colour[keyAt(i)] || INK_RGB;
      if (!was) return c;
      var t = Math.min(1, (now - was.at) / 700);
      if (t >= 1) return c;
      var o = was.colour[i < was.keyOf.length ? was.keyOf[i] : UNKNOWN] || INK_RGB;
      return [o[0] + (c[0] - o[0]) * t | 0, o[1] + (c[1] - o[1]) * t | 0, o[2] + (c[2] - o[2]) * t | 0];
    }

    function paint(now) {
      raf = null;
      if (!g) return;
      var calm = reduce.matches;
      var want = ptr && !calm ? 1 : 0;
      lens += (want - lens) * (calm ? 1 : 0.16);
      fade += ((lit ? 1 : 0) - fade) * (calm ? 1 : 0.18);
      if (Math.abs(lens - want) < 0.01) lens = want;
      if (Math.abs(fade - (lit ? 1 : 0)) < 0.01) fade = lit ? 1 : 0;
      var moving = (lens > 0 && lens < 1) || (fade > 0 && fade < 1) || (was && now - was.at < 700);
      if (was && now - was.at >= 700) was = null;
      if (wave && now - wave.at > wave.life) wave = null;
      if (wave) moving = true;

      ctx.clearRect(0, 0, canvas.width, canvas.height);          // the whole bitmap: rows * pitch is fractional
      var P = g.pitch, reach = P * 3.4, push = P * 0.85;
      for (var i = 0; i < drawn; i++) {
        var c = centre(i), x = c.x, y = c.y;
        var key = keyAt(i);

        // springs: the pointer pushes the ink aside; every dot is pulled back to its seat and overshoots a little
        if (!calm) {
          var tx = 0, ty = 0;
          if (ptr) {
            var ex = x - ptr.x, ey = y - ptr.y, d = Math.sqrt(ex * ex + ey * ey);
            if (d < reach && d > 0.001) { var f = 1 - d / reach; f = f * f * push; tx = ex / d * f; ty = ey / d * f; }
          }
          vx[i] = (vx[i] + (tx - dx[i]) * 0.14) * 0.78;
          vy[i] = (vy[i] + (ty - dy[i]) * 0.14) * 0.78;
          dx[i] += vx[i]; dy[i] += vy[i];
          if (Math.abs(tx - dx[i]) > 0.05 || Math.abs(ty - dy[i]) > 0.05 || Math.abs(vx[i]) > 0.05 || Math.abs(vy[i]) > 0.05) moving = true;
          else { dx[i] = tx; dy[i] = ty; vx[i] = vy[i] = 0; }        // at rest: stop the frames until the pointer moves
          x += dx[i]; y += dy[i];
        }

        var r = P * 0.31 * wobble(i);
        if (i === hover || i === pinned) r *= 1 + 0.45 * Math.max(lens, calm ? 1 : 0);
        // the ripple: a swell that travels out from the touched dot through its own state only
        if (wave && wave.keys[key] && i !== hover && i !== pinned) {     // the touched dot has its own swell
          var wx = c.x - wave.x, wy = c.y - wave.y;
          var u = (now - wave.at) / 1000 - Math.sqrt(wx * wx + wy * wy) / wave.speed;
          if (u > 0 && u < 0.42) r *= 1 + 0.6 * Math.sin(Math.PI * u / 0.42);
        }
        var alpha = lit && !lit[key] ? 1 - 0.85 * fade : 1;
        var ink = inkOf(i, now);
        var mine = base !== null && i >= base;

        var at = arrivals[i];
        if (at !== undefined) {
          // a new arrival lands as three plates that slide into register, then the ink prints over them
          var t = Math.min(1, (now - at) / 1400);
          if (t >= 1) delete arrivals[i];
          else {
            moving = true;
            var e = 1 - Math.pow(1 - t, 3), off = (1 - e) * P * 0.55;
            ctx.globalCompositeOperation = 'multiply';
            fill(x - off, y + off * 0.3, r, PLATES[0], alpha);
            fill(x + off * 0.8, y + off * 0.6, r, PLATES[1], alpha);
            fill(x + off * 0.2, y - off, r, PLATES[2], alpha);
            ctx.globalCompositeOperation = 'source-over';
            alpha *= Math.max(0, (t - 0.45) / 0.55);
          }
        }
        if (key === LATE && coloured) ring(x, y, r * 0.82, ink, alpha, Math.max(1.2, r * 0.32));   // not inked yet
        else fill(x, y, r, ink, alpha);
        if (mine) ring(x, y, r + Math.max(2, P * 0.1), INK_RGB, alpha * 0.9, 1.25);                // here since you arrived
      }
      if (moving) raf = requestAnimationFrame(paint);
    }

    function repaint() { if (raf === null) raf = requestAnimationFrame(paint); }

    function draw(n) {
      n = Math.max(0, Math.round(n));
      if (n === drawn) return;
      grow(n);
      drawn = n;
      repaint();
    }

    function arrive(from, to) {
      if (reduce.matches) return;
      var now = performance.now();
      for (var i = from; i < to; i++) arrivals[i] = now + (i - from) * 90;
    }

    function reink(beforeKeyOf, beforeColour) {
      if (!reduce.matches && drawn && beforeKeyOf) was = { keyOf: beforeKeyOf, colour: beforeColour, at: performance.now() };
      repaint();
    }

    // light up one group or several (the "more states" chip); null for none
    function light(keys) {
      var next = keys && keys.length ? {} : null;
      if (next) keys.forEach(function (k) { next[k] = true; });
      lit = next;
      repaint();
    }

    // send a ripple through a group, from a dot (or from the first dot of the group when none is given)
    function ripple(keys, from) {
      if (reduce.matches || !g || !keys || !keys.length) return;
      var set = {};
      keys.forEach(function (k) { set[k] = true; });
      if (from == null || from < 0) {
        from = -1;
        for (var i = 0; i < drawn && from < 0; i++) if (set[keyAt(i)]) from = i;
        if (from < 0) return;
      }
      var c = centre(from), far = Math.sqrt(g.w * g.w + g.rows * g.pitch * g.rows * g.pitch);
      var speed = Math.max(500, far * 1.4);
      wave = { x: c.x, y: c.y, at: performance.now(), keys: set, speed: speed, life: (far / speed + 0.45) * 1000 };
      repaint();
    }

    /* ---------- pointing at the crowd ---------- */
    function local(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function tipFor(i) {
      if (!tip || i < 0) { hideTip(); return; }
      var key = keyAt(i), title, line;
      if (!coloured) { title = 'One of ' + fmt(target); line = 'registered for NextGen'; }
      else if (key === UNKNOWN) { title = 'State not given'; line = people(sizeOf(key)); }
      else if (key === LATE) { title = 'Just registered'; line = 'Their state shows in a few minutes'; }
      else {
        var n = sizeOf(key);
        title = NAMES[key];
        line = people(n) + ' · ' + Math.max(1, Math.round(n / target * 100)) + '%';
      }
      if (base !== null && i >= base) line = 'Registered while you were here';
      tip.firstChild.textContent = title;
      tip.lastChild.textContent = line;
      var ink = colour[key];
      var inked = coloured && ink && key !== UNKNOWN && key !== LATE;
      tip.classList.toggle('has-ink', !!inked);
      if (inked) tip.style.setProperty('--tip-ink', 'rgb(' + ink.join(',') + ')');
      tip.hidden = false;
      var c = centre(i), half = tip.offsetWidth / 2;
      tip.style.left = Math.min(Math.max(c.x, half), g.w - half) + 'px';
      tip.style.top = (c.y - g.pitch * 0.55 - 10) + 'px';            // clear of the dot at its fullest swell
    }
    function hideTip() { if (tip) tip.hidden = true; }

    function point(i) {
      var prev = hover;
      hover = i;
      canvas.classList.toggle('is-on-dot', i >= 0);
      tipFor(i);
      if (i < 0) { light(chipLit()); return; }
      if (!coloured) return;
      var key = keyAt(i);
      light([key]);
      if (prev < 0 || keyAt(prev) !== key) ripple([key], i);           // a new state under the pointer: ripple it
    }

    canvas.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      ptr = local(e);
      if (pinned < 0) { var i = hit(ptr.x, ptr.y); if (i !== hover) point(i); }
      repaint();
    });
    canvas.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'touch') return;
      ptr = null;
      if (pinned < 0) { hover = -1; canvas.classList.remove('is-on-dot'); hideTip(); light(chipLit()); }
      repaint();
    });
    // on a touch screen a tap is the hover: the ink jumps away from the finger, and it holds until the next tap
    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch') return;
      var p = local(e), i = hit(p.x, p.y);
      if (i < 0 || i === pinned) { release(); return; }
      pinned = i;
      ptr = p;
      hover = -1;
      point(i);
      setTimeout(function () { if (pinned === i) { ptr = null; repaint(); } }, 380);   // a nudge, then settle back
    });
    function release() { pinned = -1; hover = -1; ptr = null; canvas.classList.remove('is-on-dot'); hideTip(); light(chipLit()); repaint(); }
    document.addEventListener('pointerdown', function (e) {
      if (pinned >= 0 && e.target !== canvas) release();
    });

    if ('ResizeObserver' in window) {
      var lastW = 0;
      new ResizeObserver(function () {
        if (canvas.clientWidth !== lastW && target !== null) { lastW = canvas.clientWidth; hideTip(); size(target); }
      }).observe(canvas);
    }

    return { size: size, draw: draw, arrive: arrive, reink: reink, light: light, ripple: ripple };
  })();

  /* ---------- chips: the key, and the same groups as buttons for keyboards, screen readers and taps ---------- */
  var pressed = null;        // the chip toggled on, by key

  function chipLit() {
    if (!pressed || !chipsBox) return null;
    var b = chipsBox.querySelector('[data-key="' + pressed + '"]');
    return b ? b.__keys : null;
  }

  function chips() {
    if (!statesBox || !chipsBox) return;
    var known = coloured ? snap.states : [];
    statesBox.hidden = !known.length;                  // nothing to say until at least one real state is in
    var focused = document.activeElement && chipsBox.contains(document.activeElement) ? document.activeElement.getAttribute('data-key') : null;
    chipsBox.textContent = '';
    if (!known.length) { pressed = null; return; }
    function css(k) { var c = colour[k]; return c ? 'rgb(' + c.join(',') + ')' : INK; }
    var list = known.slice(0, TOP).map(function (s) {
      return { key: s[0], keys: [s[0]], code: s[0] === 'INTL' ? 'Intl' : s[0], n: s[1], label: NAMES[s[0]], swatch: css(s[0]) };
    });
    var rest = known.slice(TOP);
    if (rest.length) {
      var stops = rest.map(function (s, k) { return css(s[0]) + ' ' + (k / rest.length * 360) + 'deg ' + ((k + 1) / rest.length * 360) + 'deg'; });
      list.push({ key: 'more', keys: rest.map(function (s) { return s[0]; }), code: '+' + rest.length + ' states',
        n: rest.reduce(function (t, s) { return t + s[1]; }, 0), label: rest.length + ' more states', swatch: 'conic-gradient(' + stops.join(',') + ')' });
    }
    if (snap.unknown > 0) list.push({ key: UNKNOWN, keys: [UNKNOWN], code: 'Not given', n: snap.unknown, label: 'State not given', swatch: INK });
    list.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tally__chip';
      b.setAttribute('data-key', c.key);
      b.setAttribute('aria-pressed', String(pressed === c.key));
      b.setAttribute('aria-label', c.label + ': ' + people(c.n));
      b.__keys = c.keys;
      var i = document.createElement('i'), k = document.createElement('b'), v = document.createElement('span');
      i.style.background = c.swatch;
      k.textContent = c.code;
      v.textContent = fmt(c.n);
      [i, k, v].forEach(function (n) { n.setAttribute('aria-hidden', 'true'); b.appendChild(n); });
      chipsBox.appendChild(b);
    });
    if (pressed && !chipsBox.querySelector('[data-key="' + pressed + '"]')) pressed = null;
    if (focused) { var back = chipsBox.querySelector('[data-key="' + focused + '"]'); if (back) back.focus(); }
    crowd.light(chipLit());
  }

  if (chipsBox) {
    chipsBox.addEventListener('click', function (e) {
      var b = e.target.closest('.tally__chip');
      if (!b) return;
      var key = b.getAttribute('data-key');
      pressed = pressed === key ? null : key;
      Array.prototype.forEach.call(chipsBox.children, function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-key') === pressed)); });
      crowd.light(chipLit());
      if (pressed) crowd.ripple(b.__keys);
    });
    // a look before a click: hovering or focusing a chip lights its people and ripples through them
    var over = null;
    ['pointerover', 'focusin'].forEach(function (ev) {
      chipsBox.addEventListener(ev, function (e) {
        var b = e.target.closest && e.target.closest('.tally__chip');
        if (!b || (ev === 'pointerover' && e.pointerType === 'touch') || b === over) return;
        over = b;
        crowd.light(b.__keys);
        crowd.ripple(b.__keys);
      });
    });
    ['pointerleave', 'focusout'].forEach(function (ev) {
      chipsBox.addEventListener(ev, function () { over = null; crowd.light(chipLit()); });
    });
  }

  // the count-up is a Motion tween (ease-out cubic); without Motion the number simply appears
  function paint(from, to, ms) {
    if (anim) { anim.stop(); anim = null; }
    if (reduce.matches || from === to || !ms || !window.Motion) { write(to); crowd.draw(to); shown = to; return; }
    anim = window.Motion.animate(from, to, {
      duration: ms / 1000,
      ease: [0.33, 1, 0.68, 1],
      onUpdate: function (v) { write(v); crowd.draw(v); },
      onComplete: function () { write(to); crowd.draw(to); shown = to; anim = null; }
    });
  }

  function since(n) {
    if (!fresh || !freshT || base === null) return;
    var d = n - base;
    if (d < 1) { fresh.classList.remove('is-on'); return; }
    freshT.textContent = '+' + fmt(d) + ' since you got here';
    fresh.classList.add('is-on');
    fresh.classList.remove('is-pop');
    void fresh.offsetWidth;
    fresh.classList.add('is-pop');
  }

  // the invitation's ticket carries the next seat: No. 120 while 119 people hold one
  var seatNo = document.querySelector('[data-ticket-no]');
  function ticketNo(n) {
    if (!seatNo || n < 1) return;
    seatNo.textContent = 'No. ' + String(n + 1).padStart(3, '0');
    seatNo.hidden = false;
  }

  function show(n) {
    var prev = target;
    target = n;
    ticketNo(n);
    if (sr) sr.textContent = fmt(n) + ' ';
    // no registrations yet reads as a bad sign, not a fact worth a banner: stay hidden
    if (n < 1) { box.hidden = true; return; }
    if (base === null) base = n;
    var opening = box.hidden;
    box.hidden = false;
    if (opening || prev !== n) crowd.size(n);
    if (!seen) { write(n); crowd.draw(0); return; }    // number and dots count up once it is scrolled into view
    if (shown !== n) {
      if (prev !== null && n > prev) crowd.arrive(prev, n);
      since(n);
      plates(0);
      paint(shown === null ? n : shown, n, 700);
    }
  }

  function staleCheck() {
    if (live) live.classList.toggle('is-stale', !okAt || Date.now() - okAt > STALE);
  }

  function load() {
    if (busy) return;
    busy = true;
    fetch(URL, { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })              // keep whatever is showing; the next tick tries again
      .then(function (d) {
        var real = !!d && typeof d.count === 'number' && d.count >= 0;
        if (!real && SAMPLE !== null && target === null) d = { count: SAMPLE, sample: true };
        if (d && typeof d.count === 'number' && d.count >= 0) {
          if (sampleTag) sampleTag.hidden = !d.sample;
          if (!d.sample) okAt = Date.now();
          useSnapshot(d);
          show(d.count);
        }
        // the "who's coming" names (names.js) ride on the same answer
        if (real) document.dispatchEvent(new CustomEvent('ngs:tally', { detail: d }));
      })
      .then(function () { busy = false; staleCheck(); });
  }

  function start() { if (!timer) timer = setInterval(load, EVERY); }
  function stop() { clearInterval(timer); timer = null; }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return;
      seen = true;
      io.disconnect();
      if (target > 0) { plates(150); paint(1, target, 1400); }   // counts up from 1: the counter never reads 0
    }, { threshold: 0.35 });
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
