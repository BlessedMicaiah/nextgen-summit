/* NextGen Summit — the People's Choice Awards stage on the homepage.

   Five founders. Point at one and the film behind the words becomes their pitch. Myron and
   Vishwa are always the first two because leadership picked them; the other three are
   whoever is top of the public vote at the moment you look.

   WHAT THIS FILE WILL NOT DO

   It will not cost anything to a visitor who never scrolls to it. Nothing here runs, and no
   manifest, poster or frame of video is requested, until the section is within a screen and
   a half of the viewport. The homepage already spends 19 MB on the hero film after load; a
   second video section that loaded eagerly would be indefensible.

   It never holds more than two video sources at once. That is not a number picked for
   comfort: the founder reels learned it the hard way, because iOS allows only a few
   simultaneously loaded media elements and past that limit play() fails silently on
   whichever element asks next. The reels cap at two and so does this.

   It reads the vote, it does not touch it. Standings come from /api/pc-rank.php and the
   deadline from GET /api/pc-vote.php, both of which are anonymous, sessionless reads.
   Deliberately NOT pc-otp.php?action=status: that one calls pc_session_begin() and would
   mint a thirty-day cookie and a server-side session file for every person who ever loads
   the homepage, which is a real cost for a number we only want to print.

   WHY THE COPY IS VAGUER THAN YOU MIGHT EXPECT

   The attendee allowance is genuinely ambiguous in the system right now: the code falls back
   to three points a day for a registered attendee (pc-rules.php:46) while the admin dashboard
   renders and saves two (admin/index.php:791, :250). Whichever is live, one Save in the
   dashboard flips it. So this section states the part that is certain and unambiguous — one
   point a day once your email is verified — says that registering unlocks more without
   naming a figure, and leaves the exact attendee arithmetic to the People's Choice page,
   which owns it. Publishing a number we might be wrong about, during a live vote, is the one
   mistake here that would actually matter.
*/
(function () {
  'use strict';

  var SELF = document.currentScript;      // captured now; it is null once a callback runs

  var sec = document.querySelector('[data-pcs]');
  if (!sec) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* The two leadership picks, by entrant id. They are not a field in the manifest — there is
     no "featured" flag on any founder — so the choice lives here, named and commented,
     rather than being inferred from something that was never meant to carry it. */
  var ALWAYS = ['entrant-16', 'entrant-20'];     // Myron J. De Bond (LIGHT), Vishwa Shukla (Find Your Mission Corp.)
  var SLOTS = 5;
  var PC_URL = '/pitch/peoples-choice/';

  var reduced = matchMedia('(prefers-reduced-motion: reduce)');
  var conn = navigator.connection || navigator.webkitConnection || null;
  var thrifty = !!(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')));

  var rail = $('[data-pcs-rail]', sec);
  var nowBox = $('[data-pcs-now]', sec);
  var clock = $('[data-pcs-clock]', sec);
  var soundBtn = $('[data-pcs-sound]', sec);
  var layers = $$('[data-pcs-layer]', sec);

  var cast = [];            // the five, in order
  var live = -1;            // index of the founder on screen
  var front = 0;            // which layer is showing
  var muted = true;
  var started = false;
  var deadline = null;
  var state = '';

  /* ---------- analytics, matching what the People's Choice page already emits ---------- */
  function track(name, data) {
    try {
      window.dataLayer = window.dataLayer || [];
      var p = { event: 'ngs_pc_' + name };
      for (var k in data) { if (Object.prototype.hasOwnProperty.call(data, k)) p[k] = data[k]; }
      window.dataLayer.push(p);
    } catch (e) {}
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- getting the pieces ---------- */

  function loadManifest() {
    if (window.NGS_FOUNDERS) return Promise.resolve(window.NGS_FOUNDERS);
    return new Promise(function (done, fail) {
      var s = document.createElement('script');
      /* Same cache stamp as this file, read off its own <script> tag. A hand-kept copy in
         the markup is one the site-wide stamp bump would not find. */
      var me = SELF || $('script[src*="pc-stage.js"]');
      var m = me && /[?&]v=([^&"]+)/.exec(me.src || '');
      s.src = '/assets/js/pc-founders.js' + (m ? '?v=' + m[1] : '');
      s.async = true;
      s.onload = function () { window.NGS_FOUNDERS ? done(window.NGS_FOUNDERS) : fail(); };
      s.onerror = fail;
      document.head.appendChild(s);
    });
  }

  function getJSON(url) {
    return fetch(url, { credentials: 'omit', cache: 'no-store' }).then(function (r) { return r.json(); });
  }

  /* Who is on the stage.

     Myron and Vishwa first, always, whatever the board says. Then the three highest-ranked
     founders who are not them.

     `ranked` has to be checked before `rank` is believed. pc-rank.php assigns rank 1 to all
     twenty when every total is equal — which is the state before voting separates anybody —
     so a consumer that reads rank without that guard draws twenty leaders. When the board
     has nothing to say yet, the three fall back to manifest order, which is deterministic. */
  function chooseCast(all, rank) {
    var byId = {};
    all.forEach(function (e) { byId[e.entrant] = e; });

    var picked = [];
    ALWAYS.forEach(function (id) { if (byId[id]) picked.push({ f: byId[id], editorial: true }); });

    var taken = {};
    picked.forEach(function (p) { taken[p.f.entrant] = true; });

    var pool;
    if (rank && rank.ok && rank.ranked && rank.order && rank.order.length) {
      pool = rank.order.filter(function (id) { return byId[id] && !taken[id]; });
    } else {
      pool = all.map(function (e) { return e.entrant; }).filter(function (id) { return !taken[id]; });
    }

    pool.slice(0, SLOTS - picked.length).forEach(function (id) {
      picked.push({
        f: byId[id],
        editorial: false,
        place: (rank && rank.ranked && rank.rank) ? rank.rank[id] : null,
        points: (rank && rank.points) ? rank.points[id] : null
      });
    });
    return picked.slice(0, SLOTS);
  }

  /* ---------- the rail ---------- */

  function ordinal(n) {
    var t = n % 100;
    if (t >= 11 && t <= 13) return n + 'th';
    return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  }

  function paintRail() {
    rail.innerHTML = cast.map(function (c, i) {
      var e = c.f;
      var img = e.story
        ? '<img src="' + esc(e.story) + '"' +
          (e.story2x ? ' srcset="' + esc(e.story) + ' 320w, ' + esc(e.story2x) + ' 640w" sizes="' + 74 + 'px"' : '') +
          ' alt="" loading="lazy" decoding="async" style="--focal:' + esc(e.storyFocal || '50% 45%') + '">'
        : '<img src="' + esc(e.shot) + '" alt="" loading="lazy" decoding="async">';
      /* The two kinds of place on this rail are different claims and are marked differently:
         one is an editorial choice, the other is where the public has put them. */
      var flag = c.editorial
        ? '<span class="pcs__flag">Featured</span>'
        : (c.place ? '<span class="pcs__flag pcs__flag--rank">' + esc(ordinal(c.place)) + '</span>' : '');
      return '<li role="presentation">' +
        '<button class="pcs__bub" type="button" role="tab" id="pcs-tab-' + i + '"' +
        ' aria-selected="' + (i === 0 ? 'true' : 'false') + '" tabindex="' + (i === 0 ? '0' : '-1') + '"' +
        ' data-pcs-pick="' + i + '" aria-label="' + esc(e.company + ' — ' + e.name) + '">' +
        img + flag + '</button></li>';
    }).join('');
  }

  function paintNow(i) {
    var e = cast[i].f;
    var write = function () {
      nowBox.innerHTML =
        '<span class="pcs__now-co">' + esc(e.company) + '</span>' +
        '<span class="pcs__now-by">' + esc(e.name) + '</span>' +
        '<p class="pcs__now-blurb">' + esc(e.blurb || '') + '</p>';
      nowBox.classList.remove('is-turning');
    };
    if (reduced.matches) { write(); return; }
    nowBox.classList.add('is-turning');
    setTimeout(write, 180);
  }

  /* ---------- the film ----------
     Two layers. The one in front is playing; the one behind is where the next founder is
     prepared. Swapping is a cross-fade, and the layer that goes to the back gives up its
     source, so two is the most that are ever loaded. */

  function layerFor(i) { return layers[i]; }

  function dress(layer, e) {
    layer.innerHTML =
      '<img src="' + esc(e.poster || '') + '" alt="" decoding="async">' +
      '<video playsinline muted loop preload="none" tabindex="-1" aria-hidden="true"></video>';
    return layer;
  }

  function release(layer) {
    var v = $('video', layer);
    if (!v) return;
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch (err) {}
    layer.classList.remove('is-playing');
  }

  function show(i, viaUser) {
    if (i === live || !cast[i]) return;
    var e = cast[i].f;
    var back = layerFor(front ? 0 : 1);
    var fore = layerFor(front);

    dress(back, e);

    var v = $('video', back);
    /* On a metered or very slow connection the stage is a poster gallery and says nothing
       about it. The composition is identical; only the motion is missing. */
    if (v && !thrifty && e.video && e.video.src) {
      v.muted = muted;
      v.src = e.video.src;
      v.autoplay = true;
      var go;
      try { go = v.play(); } catch (err) {}
      var mark = function () { if (!v.paused) back.classList.add('is-playing'); };
      v.addEventListener('playing', mark, { once: true });
      if (go && go.catch) {
        go.catch(function () {
          /* Autoplay refused — Low Power Mode, or no gesture yet. The poster is already
             there and is a perfectly good picture, so nothing is broken; try again the
             moment the browser says it could start. */
          v.addEventListener('canplay', function () {
            if (live !== i) return;
            var again = v.play();
            if (again && again.catch) again.catch(function () {});
          }, { once: true });
        });
      }
    }

    back.classList.add('is-on');
    fore.classList.remove('is-on');
    setTimeout(function () { release(fore); }, reduced.matches ? 0 : 950);

    front = front ? 0 : 1;
    live = i;

    paintNow(i);
    $$('[data-pcs-pick]', rail).forEach(function (b, n) {
      b.setAttribute('aria-selected', n === i ? 'true' : 'false');
      b.setAttribute('tabindex', n === i ? '0' : '-1');
    });

    if (viaUser) track('home_switch', { entrant_id: e.entrant, slot: i });
  }

  /* ---------- sound ----------
     Muted is the only way a browser will start a video by itself, so that is where it
     starts. The control is visible from the beginning rather than appearing once sound is
     possible, because a control that materialises is a control nobody finds. */

  function paintSound() {
    soundBtn.classList.toggle('is-on', !muted);
    soundBtn.setAttribute('aria-pressed', muted ? 'false' : 'true');
    $('[data-pcs-sound-t]', soundBtn).textContent = muted ? 'Sound on' : 'Sound off';
    $('[data-pcs-sound-i]', soundBtn).innerHTML = muted
      ? '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
      : '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 9.2a4 4 0 0 1 0 5.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
  }

  function setSound(on) {
    muted = !on;
    layers.forEach(function (l) { var v = $('video', l); if (v) v.muted = muted; });
    /* Only the live layer should ever be audible; the other is paused and sourceless, but
       be explicit rather than rely on that. */
    var v = $('video', layerFor(front));
    if (v && !muted) { var g = v.play(); if (g && g.catch) g.catch(function () {}); }
    try { localStorage.setItem('ngs-pcs-sound', on ? '1' : '0'); } catch (e) {}
    paintSound();
    track('home_sound', { on: on ? 1 : 0 });
  }

  /* ---------- the clock ----------
     One source of truth. The deadline is whatever the server says it is; if the request
     fails the clock stays hidden rather than counting down to a date invented here. The
     homepage's own initCountdown() is not reused on purpose: it binds a single `.count`
     element and hardcodes its screen-reader line to the Summit date. */

  function paintClock() {
    if (!deadline) return;
    var left = deadline - Date.now();
    if (state === 'closed' || left <= 0) {
      clock.innerHTML = '<p class="pcs__closed">Voting has closed</p>';
      clock.hidden = false;
      return;
    }
    var s = Math.floor(left / 1000);
    var d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60, ss = s % 60;
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    var unit = function (n, l) {
      return '<span class="pcs__u"><span class="pcs__n">' + n + '</span><span class="pcs__l">' + l + '</span></span>';
    };
    clock.innerHTML =
      '<span class="pcs__clock-k">Voting closes in</span>' +
      '<span class="pcs__clock-t">' +
        unit(d, 'Days') + '<span class="pcs__sep">:</span>' +
        unit(two(h), 'Hrs') + '<span class="pcs__sep">:</span>' +
        unit(two(m), 'Min') + '<span class="pcs__sep">:</span>' +
        unit(two(ss), 'Sec') +
      '</span>';
    clock.hidden = false;
  }

  /* ---------- the way in ----------
     Black, the wordmark, the awards lockup, then the reels. Short on purpose: about 1.9
     seconds, skippable at any point, and collapsed to a plain fade for anyone who asked for
     less motion. The destination carries ?reels=1 so the People's Choice page knows to open
     the full-screen feed rather than just load; the founder currently on the stage rides
     along in the hash so the visitor lands on the one they were watching. */

  function enter(ev) {
    if (ev) ev.preventDefault();
    var e = cast[live] ? cast[live].f : null;
    var dest = PC_URL + '?reels=1' + (e ? '#' + e.entrant : '');
    track('home_enter', { entrant_id: e ? e.entrant : null });

    var x = $('[data-pcx]');
    if (!x) { location.href = dest; return; }

    var gone = false;
    var go = function () { if (!gone) { gone = true; location.href = dest; } };

    x.hidden = false;
    // let the browser paint the hidden state once, or the first class lands with no transition
    requestAnimationFrame(function () {
      x.classList.add('is-on');
      if (reduced.matches) { setTimeout(go, 420); return; }
      setTimeout(function () { x.classList.add('s-wm'); }, 240);
      setTimeout(function () { x.classList.add('s-logo'); }, 1180);
      setTimeout(go, 1980);
    });

    x.addEventListener('click', go);
    document.addEventListener('keydown', function onKey(k) {
      if (k.key === 'Escape') { document.removeEventListener('keydown', onKey); go(); }
    });
  }

  /* ---------- wiring ---------- */

  function bind() {
    rail.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-pcs-pick]');
      if (b) show(+b.getAttribute('data-pcs-pick'), true);
    });
    /* Hover is the headline interaction on a pointer device, but it must not fire on a
       touch screen, where a tap produces a hover event immediately before the click. */
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      rail.addEventListener('pointerover', function (ev) {
        if (ev.pointerType !== 'mouse') return;
        var b = ev.target.closest('[data-pcs-pick]');
        if (b) show(+b.getAttribute('data-pcs-pick'), true);
      });
    }
    // a roving tabstop, so the rail is one stop and the arrows move within it
    rail.addEventListener('keydown', function (ev) {
      var n = cast.length;
      if (!n) return;
      var i = live < 0 ? 0 : live, to = null;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') to = (i + 1) % n;
      else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') to = (i - 1 + n) % n;
      else if (ev.key === 'Home') to = 0;
      else if (ev.key === 'End') to = n - 1;
      if (to === null) return;
      ev.preventDefault();
      show(to, true);
      var b = $('[data-pcs-pick="' + to + '"]', rail);
      if (b) b.focus();
    });

    soundBtn.addEventListener('click', function () { setSound(muted); });
    $$('[data-pcs-enter]').forEach(function (b) { b.addEventListener('click', enter); });

    /* Stop paying for a film nobody is looking at. */
    document.addEventListener('visibilitychange', function () {
      var v = $('video', layerFor(front));
      if (!v) return;
      if (document.hidden) { try { v.pause(); } catch (e) {} }
      else { var g = v.play(); if (g && g.catch) g.catch(function () {}); }
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        var v = $('video', layerFor(front));
        if (!v) return;
        if (es[0].isIntersecting) { var g = v.play(); if (g && g.catch) g.catch(function () {}); }
        else { try { v.pause(); } catch (e) {} }
      }, { threshold: 0.15 }).observe(sec);
    }
  }

  function start() {
    if (started) return;
    started = true;

    try { muted = localStorage.getItem('ngs-pcs-sound') !== '1'; } catch (e) {}

    Promise.all([
      loadManifest(),
      getJSON('/api/pc-rank.php').catch(function () { return null; }),
      getJSON('/api/pc-vote.php').catch(function () { return null; })
    ]).then(function (r) {
      var all = r[0], rank = r[1], vote = r[2];
      if (!all || !all.length) { sec.setAttribute('data-pcs-failed', '1'); return; }

      cast = chooseCast(all, rank);
      if (!cast.length) { sec.setAttribute('data-pcs-failed', '1'); return; }

      paintRail();
      paintSound();
      bind();
      show(0, false);

      if (vote && vote.deadline) {
        var t = Date.parse(vote.deadline);
        if (isFinite(t)) { deadline = t; state = vote.state || ''; paintClock(); setInterval(paintClock, 1000); }
      }

      track('home_view', { founders: cast.map(function (c) { return c.f.entrant; }).join(',') });
    }).catch(function () { sec.setAttribute('data-pcs-failed', '1'); });
  }

  /* Nothing above this line runs until the section is close. A screen and a half of margin
     means the first poster is usually decoded by the time it is actually on screen, without
     asking for it from the top of the page. */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es, o) {
      if (!es[0].isIntersecting) return;
      o.disconnect();
      start();
    }, { rootMargin: '150% 0px 150% 0px' }).observe(sec);
  } else {
    addEventListener('load', start);
  }
})();
