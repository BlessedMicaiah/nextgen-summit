/* NextGen Summit: the Convener's film (see css/film.css).
   Homepage: a call button and a pop-up player.
   - A call button waits in the bottom-right corner: the Convener's face in a spinning print ring,
     a "1" badge and "New message / From our Convener". It rings now and then until the film has
     been watched; on small screens the words tuck away after a few seconds, leaving the face. It
     steps out of the way while a link or button sits under its corner.
   - A click opens the film out of the button into the middle of the screen, with sound (the click
     allows it). A cinema button makes it as large as the screen allows (full screen on an upright
     phone), and back.
   - The close button unlocks after 15 s of the film; a ring around it counts them down. Once the
     film has been watched to the end (remembered in this browser), it can be closed at once. Also
     freed early if the film cannot play (load error, a 10 s stall, no frame in 30 s, play refused).
   - Scrolling, Esc or a click on the shade tucks it into the bottom-right corner, where it keeps
     playing; a tap there brings it back. Closing flies it back into the call button, ready to be
     played again as often as anyone likes. ?film in the address opens it straight away.
   About page: the film is a section of the page instead. Any element with data-film-inline gets a
   player in place (poster and a play button; the film itself loads on the first play), with the
   same sound, full-screen and end-card controls, a progress line to click along, and no gate.
   A page with an inline player gets no call button.
   Another film can use the same inline player: data-film-src, -poster, -label, -play, -cue,
   -len and -rest on the element name it, and data-film-shape="tall" makes the player upright
   (9:16, the People's Choice walkthrough). Only the Convener's film counts as watched. */
(function () {
  'use strict';

  var SRC = '/assets/nextgen-film.mp4?v=20261027-202';
  var POSTER = '/assets/img/nextgen-film-poster.jpg?v=20261027-202';
  var FACE = '/assets/img/convener-face.jpg?v=20261027-202';
  var DONE = 'ngs-film-watched';    // localStorage: watched to the end once, so the close is free
  var REST = 83;                    // s: the frame the end card rests on (the nextgen mark on black)
  var GATE = 15;                    // s of the film before the close button unlocks
  var STALL = 10000;                // no progress for this long once it has started: free the close
  var NEVER = 30000;                // no first frame at all after this long: free the close
  var NUDGE = 40;                   // px of scrolling that tucks it into the corner
  var RING = 2 * Math.PI * 21;      // the countdown ring's circumference (r = 21 in a 48 box)
  var EASE = 'cubic-bezier(.16,1,.3,1)';

  // the controls both players share
  var WIDE =
    '<button class="film__wide" type="button" aria-pressed="false" aria-label="Cinema size">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path class="film__out" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>' +
        '<path class="film__in" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>' +
      '</svg>' +
    '</button>';
  var CONTROLS =
    '<button class="film__sound" type="button" aria-pressed="false" aria-label="Sound">' +
      '<svg class="film__spk" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path class="film__cone" d="M3.5 9.2h3.6L12 5v14l-4.9-4.2H3.5z"/>' +
        '<path class="film__w film__w1" d="M15.3 9.6a3.4 3.4 0 0 1 0 4.8"/>' +
        '<path class="film__w film__w2" d="M17.9 7a7.1 7.1 0 0 1 0 10"/>' +
        '<path class="film__m" pathLength="1" d="M16 9.5l5 5"/>' +
        '<path class="film__m" pathLength="1" d="M21 9.5l-5 5"/>' +
      '</svg>' +
      '<span class="film__sl film__off">Tap for sound</span><span class="film__sl film__on">Mute</span>' +
    '</button>' +
    '<button class="film__play" type="button" aria-label="Play the film">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l16 9-16 9z" fill="currentColor"/></svg>' +
    '</button>' +
    '<div class="film__end">' +
      '<button class="film__again" type="button">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        'Watch again' +
      '</button>' +
    '</div>' +
    '<div class="film__progress" aria-hidden="true"><span></span></div>';

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var small = window.matchMedia && matchMedia('(max-width: 600px)');

  function watched() { try { return localStorage.getItem(DONE) === '1'; } catch (e) { return false; } }
  function remember() { try { localStorage.setItem(DONE, '1'); } catch (e) {} }

  // the transform that makes `box` (laid out at rect b) cover the centre of rect a, scaled to a's width
  function from(a, b) {
    var s = a.width / b.width;
    var x = a.left + a.width / 2 - b.left - b.width * s / 2;
    var y = a.top + a.height / 2 - b.top - b.height * s / 2;
    return 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + s.toFixed(4) + ')';
  }

  /* ---------- the call button ---------- */
  var call, open = false, ringer = 0;

  function buildCall() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'film-call';
    b.setAttribute('aria-haspopup', 'dialog');
    b.innerHTML =
      '<span class="film-call__face" aria-hidden="true">' +
        '<span class="film-call__ring"></span>' +
        '<img src="' + FACE + '" alt="" width="96" height="96" decoding="async">' +
        '<span class="film-call__play"><svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg></span>' +
      '</span>' +
      '<span class="film-call__text">' +
        '<span class="film-call__k"><span class="film-call__kt"></span><span class="film-call__dots" aria-hidden="true"><i></i><i></i><i></i></span></span>' +
        '<span class="film-call__t">From our Convener</span>' +
      '</span>' +
      '<span class="film-call__badge" aria-hidden="true"></span>';
    document.body.appendChild(b);
    return b;
  }

  function dress() {
    var done = watched();
    call.classList.toggle('is-done', done);
    call.querySelector('.film-call__kt').textContent = done ? 'Watch again' : 'New message';
    call.querySelector('.film-call__badge').textContent = done ? '✓' : '1';
    call.setAttribute('aria-label', done ? 'Watch the message from our Convener again' : 'You have a new message from our Convener. Play it');
  }

  // a ring now and then, like a phone, until the film has been watched
  function ring() {
    clearInterval(ringer);
    if (reduce) return;
    ringer = setInterval(function () {
      if (open || document.hidden || watched()) return;
      call.classList.remove('is-ring');
      void call.offsetWidth;
      call.classList.add('is-ring');
    }, 7000);
  }

  // on small screens the words tuck away after a few seconds; the face stays
  var tuckTimer = 0;
  function tuckSoon(ms) {
    clearTimeout(tuckTimer);
    if (!small || !small.matches) { call.classList.remove('is-tucked'); return; }
    tuckTimer = setTimeout(function () { call.classList.add('is-tucked'); setTimeout(recheck, 700); }, ms);
  }

  // it never covers a link or a button (the homepage's Get tickets sits in that corner at the top):
  // while anything clickable is under its corner it waits below the screen, and slides in once clear
  var pending = false;
  function blocked() {
    var x = call.offsetLeft, y = call.offsetTop, w = call.offsetWidth, h = call.offsetHeight;
    var pts = [[.08, .2], [.5, .2], [.92, .2], [.08, .8], [.5, .8], [.92, .8]];
    for (var i = 0; i < pts.length; i++) {
      var els = document.elementsFromPoint(x + w * pts[i][0], y + h * pts[i][1]);
      for (var j = 0; j < els.length; j++) {
        if (call.contains(els[j])) continue;
        if (els[j].closest('a[href],button,input,select,textarea,label,[role="button"]')) return true;
      }
    }
    return false;
  }
  function check() { pending = false; if (!open) call.classList.toggle('is-away', blocked()); }
  function recheck() { if (!pending) { pending = true; requestAnimationFrame(check); } }

  /* ---------- the film ---------- */
  function build() {
    var f = document.createElement('div');
    f.className = 'film';
    f.setAttribute('role', 'dialog');
    f.setAttribute('aria-modal', 'false');
    f.setAttribute('aria-label', 'A message from the Convener of NextGen Summit');
    f.innerHTML =
      '<div class="film__shade" aria-hidden="true"></div>' +
      '<div class="film__box">' +
        '<div class="film__bar" aria-hidden="true"></div>' +
        '<div class="film__frame">' +
          '<video class="film__video" playsinline webkit-playsinline preload="auto" disableremoteplayback poster="' + POSTER + '"></video>' +
          '<div class="film__ui">' +
            '<p class="film__kicker" aria-hidden="true">A message from the Convener</p>' +
            '<button class="film__grow" type="button" aria-label="Bring the film back to the middle">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</button>' +
            '<div class="film__tr">' +
              WIDE +
              '<button class="film__gate" type="button" disabled aria-label="Close, available after 15 seconds">' +
                '<svg viewBox="0 0 48 48" aria-hidden="true">' +
                  '<circle class="film__track" cx="24" cy="24" r="21"/>' +
                  '<circle class="film__ring" cx="24" cy="24" r="21" stroke-dasharray="' + RING.toFixed(2) + '" stroke-dashoffset="' + RING.toFixed(2) + '"/>' +
                  '<path class="film__x" pathLength="1" d="M18 18l12 12"/>' +
                  '<path class="film__x" pathLength="1" d="M30 18L18 30"/>' +
                '</svg>' +
                '<span class="film__count" aria-hidden="true"></span>' +
              '</button>' +
            '</div>' +
            CONTROLS +
          '</div>' +
        '</div>' +
      '</div>' +
      '<p class="sr" aria-live="polite"></p>';
    document.body.appendChild(f);
    return f;
  }

  function show() {
    if (open) return;
    open = true;
    clearTimeout(tuckTimer);
    var f = build();
    function $(s) { return f.querySelector(s); }
    var box = $('.film__box'), v = $('.film__video'), gate = $('.film__gate'), ring = $('.film__ring'),
        count = $('.film__count'), bar = $('.film__progress span'), sound = $('.film__sound'),
        wide = $('.film__wide'), live = $('.sr');

    var mode = 'center', free = false, closing = false, held = false, begun = false, raf = 0;
    var y0 = window.scrollY, last = -1, lastMove = Date.now();

    /* ---------- the gate ---------- */
    function release(why) {
      if (free) return;
      free = true;
      gate.disabled = false;
      gate.setAttribute('aria-label', 'Close the film');
      f.classList.add('is-free');
      ring.style.strokeDashoffset = '0';
      if (why !== '') live.textContent = why || 'The film has ended. You can close it now.';
    }
    if (watched()) { f.classList.add('is-known'); release(''); }   // seen before: no lock this time

    function tick() {
      var d = v.duration, t = v.currentTime || 0;
      if (d && isFinite(d)) {
        var p = f.classList.contains('is-over') ? 1 : Math.min(1, t / d);
        bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
        if (!free) {
          var g = Math.min(1, t / GATE);
          ring.style.strokeDashoffset = (RING * (1 - g)).toFixed(2);
          count.textContent = Math.max(0, Math.ceil(GATE - t));
          if (t >= GATE) release('You can close the film now.');
        }
      }
      if (t !== last) { last = t; lastMove = Date.now(); }
      // stalls count only once frames have come: a slow first load is not a stall
      else if (!free && begun && !v.paused && !document.hidden && Date.now() - lastMove > STALL) release('The film could not keep playing. You can close it now.');
      raf = requestAnimationFrame(tick);
    }

    /* ---------- playing ---------- */
    function setSound(on) {
      f.classList.toggle('is-sound', on);
      sound.setAttribute('aria-pressed', on ? 'true' : 'false');
      sound.setAttribute('aria-label', on ? 'Mute' : 'Turn the sound on');
    }

    // with sound when the browser allows it (a click does), otherwise muted; if even that is refused, a play button
    function start(withSound) {
      v.muted = !withSound;
      var p = v.play();
      if (!p || !p.then) { setSound(!v.muted); return; }
      p.then(function () { setSound(!v.muted); }, function () {
        if (closing) return;
        if (withSound) { start(false); return; }
        f.classList.add('is-blocked');
        release('The film did not start by itself. Press play to watch it, or close it.');
      });
    }

    function play(withSound) {
      held = false;
      f.classList.remove('is-blocked', 'is-paused');
      if (withSound) { v.muted = false; setSound(true); }
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    }

    v.addEventListener('playing', function () { begun = true; f.classList.remove('is-blocked', 'is-paused', 'is-over'); lastMove = Date.now(); });
    setTimeout(function () { if (!begun && !closing) release('The film could not load. You can close it now.'); }, NEVER);
    v.addEventListener('pause', function () { if (held) f.classList.add('is-paused'); });
    v.addEventListener('ended', function () {
      f.classList.add('is-over');
      bar.style.transform = 'scaleX(1)';
      if (v.duration > REST) v.currentTime = REST;   // the last second is black: rest on the mark
      remember();
      dress();
      release();
    });
    v.addEventListener('error', function () { release('The film could not load. You can close it now.'); });

    sound.addEventListener('click', function () {
      var on = v.muted;
      v.muted = !on;
      setSound(on);
      sound.classList.remove('is-tap'); void sound.offsetWidth; sound.classList.add('is-tap');
      if (on && v.paused && !v.ended && !f.classList.contains('is-over')) play(true);
    });
    $('.film__play').addEventListener('click', function () { play(true); });
    $('.film__again').addEventListener('click', function () {
      f.classList.remove('is-over');
      v.currentTime = 0;
      play(!v.muted);
    });
    // a click on the picture pauses and resumes, as people expect of a video
    $('.film__frame').addEventListener('click', function (e) {
      if (mode === 'mini' || e.target.closest('button') || f.classList.contains('is-over')) return;
      if (v.paused) play(!v.muted);
      else { held = true; v.pause(); }
    });

    // rests while the tab is hidden, and picks up again when it comes back
    var away = false;
    function onVisible() {
      if (document.hidden) { if (!v.paused) { away = true; v.pause(); } }
      else if (away) { away = false; play(!v.muted); }
    }
    document.addEventListener('visibilitychange', onVisible);

    /* ---------- middle, cinema and corner ---------- */
    // FLIP: measure, switch the class, measure again, and play the difference back to nothing
    function morph(to) {
      if (mode === to || closing) return;
      var a = box.getBoundingClientRect();
      mode = to;
      f.classList.toggle('is-mini', to === 'mini');
      f.classList.toggle('is-cinema', to === 'cinema');
      wide.setAttribute('aria-pressed', to === 'cinema' ? 'true' : 'false');
      wide.setAttribute('aria-label', to === 'cinema' ? 'Back to normal size' : 'Cinema size');
      if (to !== 'mini') y0 = window.scrollY;
      if (reduce || !box.animate) return;
      var b = box.getBoundingClientRect();
      f.classList.add('is-morphing');
      var run = box.animate([
        { transform: 'translate(' + (a.left - b.left) + 'px,' + (a.top - b.top) + 'px) scale(' + (a.width / b.width) + ')' },
        { transform: 'none' }
      ], { duration: to === 'mini' ? 750 : 850, easing: EASE });
      run.onfinish = run.oncancel = function () { f.classList.remove('is-morphing'); };
    }

    function onScroll() { if (mode !== 'mini' && !document.fullscreenElement && Math.abs(window.scrollY - y0) > NUDGE) morph('mini'); }
    function onKey(e) {
      if (e.key !== 'Escape' || mode === 'mini' || document.querySelector('dialog[open]')) return;
      morph(mode === 'cinema' ? 'center' : 'mini');
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('keydown', onKey);
    // a wheel or a swipe over the film means "I want the page": even at the very top, where nothing scrolls
    function wantPage() { if (mode !== 'mini' && !document.fullscreenElement) morph('mini'); }
    f.addEventListener('wheel', wantPage, { passive: true });
    f.addEventListener('touchmove', wantPage, { passive: true });
    $('.film__shade').addEventListener('click', function () { morph('mini'); });
    $('.film__grow').addEventListener('click', function () { morph('center'); });

    // cinema: as large as the page allows. On a phone held upright that gains nothing, so there it
    // goes full screen instead (turned to landscape where the phone allows it)
    function full() { return document.fullscreenElement === box; }
    function onFull() {
      f.classList.toggle('is-full', full());
      wide.setAttribute('aria-pressed', full() || mode === 'cinema' ? 'true' : 'false');
    }
    document.addEventListener('fullscreenchange', onFull);
    wide.addEventListener('click', function () {
      if (full()) { document.exitFullscreen(); return; }
      if (innerWidth < 700 && innerHeight > innerWidth) {
        if (box.requestFullscreen) {
          var p = box.requestFullscreen();
          if (p && p.then) p.then(function () {
            try { var o = screen.orientation.lock('landscape'); if (o && o.catch) o.catch(function () {}); } catch (e) {}
          }, function () { morph(mode === 'cinema' ? 'center' : 'cinema'); });
          return;
        }
        if (v.webkitEnterFullscreen) { v.webkitEnterFullscreen(); return; }   // iPhone: the video alone
      }
      morph(mode === 'cinema' ? 'center' : 'cinema');
    });

    /* ---------- closing: back into the call button ---------- */
    function finish() {
      cancelAnimationFrame(raf);
      v.removeAttribute('src');
      v.load();
      f.remove();
      open = false;
      dress();
      call.classList.remove('is-gone');
      check();
      tuckSoon(4000);
    }
    gate.addEventListener('click', function () {
      if (!free || closing) return;
      closing = true;
      v.pause();
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('fullscreenchange', onFull);
      if (full()) { document.exitFullscreen(); finish(); return; }
      f.classList.add('is-leaving');
      if (reduce || !box.animate) { finish(); return; }
      // the call button is laid out (only faded) while the film is open, so its face can be measured
      var to = from(call.querySelector('.film-call__face').getBoundingClientRect(), box.getBoundingClientRect());
      box.animate([
        { transform: 'none', opacity: 1, borderRadius: '14px' },
        { transform: to, opacity: 0, borderRadius: '50%' }
      ], { duration: 560, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' }).onfinish = finish;
    });

    /* ---------- go: out of the call button ---------- */
    v.src = SRC;
    var face = call.querySelector('.film-call__face').getBoundingClientRect();
    call.classList.add('is-gone');
    f.classList.add('is-in');
    raf = requestAnimationFrame(tick);
    if (!reduce && box.animate) {
      box.animate([
        { transform: from(face, box.getBoundingClientRect()), opacity: 0, borderRadius: '50%' },
        { opacity: 1, offset: .25 },
        { transform: 'none', opacity: 1, borderRadius: '14px' }
      ], { duration: 900, easing: EASE });
    }
    start(true);
  }

  /* ---------- in a page section (About) ---------- */
  function inline(host) {
    var o = host.dataset || {};
    var src = o.filmSrc || SRC, rest = parseFloat(o.filmRest) || REST, tall = o.filmShape === 'tall';
    var own = src === SRC;   // the homepage's "watched" belongs to the Convener's film alone
    host.innerHTML =
      '<div class="film film--inline' + (tall ? ' film--tall' : '') + ' is-idle">' +
        '<div class="film__box">' +
          '<div class="film__bar" aria-hidden="true"></div>' +
          '<div class="film__frame">' +
            '<video class="film__video" playsinline webkit-playsinline preload="none" disableremoteplayback poster="' + POSTER + '"></video>' +
            '<div class="film__ui">' +
              '<div class="film__tr">' + WIDE + '</div>' +
              CONTROLS +
              '<p class="film__cue" aria-hidden="true"><span>Play the message</span><span class="film__len">1:26</span></p>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    var f = host.firstChild;
    function $(s) { return f.querySelector(s); }
    var box = $('.film__box'), v = $('.film__video'), sound = $('.film__sound'), wide = $('.film__wide'),
        bar = $('.film__progress span'), line = $('.film__progress'), raf = 0;
    wide.setAttribute('aria-label', 'Full screen');
    // the words are set as text, never as markup
    if (o.filmPoster) v.setAttribute('poster', o.filmPoster);
    v.setAttribute('aria-label', o.filmLabel || 'A message from the Convener of NextGen Summit');
    $('.film__play').setAttribute('aria-label', o.filmPlay || 'Play the message from our Convener');
    if (o.filmCue) $('.film__cue span').textContent = o.filmCue;
    if (o.filmLen) $('.film__len').textContent = o.filmLen;

    function setSound(on) {
      f.classList.toggle('is-sound', on);
      sound.setAttribute('aria-pressed', on ? 'true' : 'false');
      sound.setAttribute('aria-label', on ? 'Mute' : 'Turn the sound on');
    }
    function tick() {
      var d = v.duration;
      if (d && isFinite(d)) bar.style.transform = 'scaleX(' + (f.classList.contains('is-over') ? 1 : Math.min(1, v.currentTime / d)).toFixed(4) + ')';
      raf = v.paused ? 0 : requestAnimationFrame(tick);
    }
    // with sound (a click allows it); if the browser still refuses, muted
    function play() {
      if (!v.getAttribute('src')) { v.preload = 'auto'; v.src = src; }
      f.classList.remove('is-idle', 'is-paused', 'is-over');
      if (f.classList.contains('is-over-seen')) { f.classList.remove('is-over-seen'); v.currentTime = 0; }
      var p = v.play();
      if (p && p.catch) p.catch(function () {
        v.muted = true; setSound(false);
        var q = v.play(); if (q && q.catch) q.catch(function () { f.classList.add('is-paused'); });
      });
      setSound(!v.muted);
    }
    v.addEventListener('play', function () { if (!raf) raf = requestAnimationFrame(tick); });
    v.addEventListener('playing', function () { f.classList.remove('is-paused', 'is-over'); });
    v.addEventListener('pause', function () { if (!v.ended && !f.classList.contains('is-over')) f.classList.add('is-paused'); tick(); });
    v.addEventListener('ended', function () {
      f.classList.remove('is-paused');
      f.classList.add('is-over', 'is-over-seen');
      if (v.duration > rest) v.currentTime = rest;   // the last second is black: rest on the last frame worth resting on
      bar.style.transform = 'scaleX(1)';
      if (own) remember();
    });

    $('.film__play').addEventListener('click', play);
    $('.film__again').addEventListener('click', play);
    sound.addEventListener('click', function () {
      var on = v.muted;
      v.muted = !on;
      setSound(on);
      sound.classList.remove('is-tap'); void sound.offsetWidth; sound.classList.add('is-tap');
    });
    // a click on the picture plays or pauses
    $('.film__frame').addEventListener('click', function (e) {
      if (e.target.closest('button') || e.target.closest('.film__progress') || f.classList.contains('is-over')) return;
      if (v.paused) play();
      else v.pause();
    });
    // the progress line can be clicked along
    line.addEventListener('click', function (e) {
      if (!v.duration || !isFinite(v.duration)) return;
      var r = line.getBoundingClientRect();
      f.classList.remove('is-over', 'is-over-seen');
      v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * v.duration;
      tick();
    });

    // full screen, and back
    function full() { return document.fullscreenElement === box; }
    document.addEventListener('fullscreenchange', function () {
      f.classList.toggle('is-full', full());
      wide.setAttribute('aria-pressed', full() ? 'true' : 'false');
      wide.setAttribute('aria-label', full() ? 'Leave full screen' : 'Full screen');
    });
    wide.addEventListener('click', function () {
      if (full()) { document.exitFullscreen(); return; }
      if (box.requestFullscreen) {
        var p = box.requestFullscreen();
        if (p && p.then) p.then(function () {
          if (!tall && innerHeight > innerWidth) try { var o = screen.orientation.lock('landscape'); if (o && o.catch) o.catch(function () {}); } catch (e) {}
        }, function () {});
      } else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();   // iPhone: the video alone
    });

    // it opens into view as the section arrives, and pauses when scrolled out of sight
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting && e.intersectionRatio > .2) f.classList.add('is-seen');
          else if (!e.isIntersecting && !v.paused && !full()) v.pause();
        });
      }, { threshold: [0, .2] }).observe(box);
    } else f.classList.add('is-seen');
    document.addEventListener('visibilitychange', function () { if (document.hidden && !v.paused) v.pause(); });
  }

  function begin() {
    if (typeof document.createElement('video').play !== 'function') return;
    var hosts = document.querySelectorAll('[data-film-inline]');
    if (hosts.length) { Array.prototype.forEach.call(hosts, inline); return; }
    call = buildCall();
    dress();
    call.addEventListener('click', show);
    // arrives a moment after the page, bounces in, and the badge pops
    setTimeout(function () {
      check();
      call.classList.add('is-here');
      ring();
      window.addEventListener('scroll', recheck, { passive: true });
      window.addEventListener('resize', recheck);
      tuckSoon(6000);
      if (/[?&]film(=|&|$)/.test(location.search)) setTimeout(show, 600);
    }, reduce ? 0 : 1400);
    if (small && small.addEventListener) small.addEventListener('change', function () { if (!open) tuckSoon(0); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin);
  else begin();
})();
