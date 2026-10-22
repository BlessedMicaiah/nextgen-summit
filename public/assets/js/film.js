/* NextGen Summit: the film pop-up (see css/film.css).
   - Once per browser session, a moment after the homepage has loaded, the NextGen film opens over
     the page. It tries to play with sound; browsers usually refuse that, so it plays muted with a
     "Tap for sound" chip.
   - The close button stays locked until the film has played to its end; until then a ring around
     it counts the film down. Freed early only if the film cannot play (load error, a stall of 10 s,
     autoplay refused), so nobody is left stuck with it.
   - Scrolling, Esc or a click on the shade tucks it into the bottom-right corner, where it keeps
     playing; a tap there brings it back to the middle.
   - Skipped with Data Saver. With reduced motion it waits for play and can be closed at once.
     Add ?film to the address to see it again in the same session. */
(function () {
  'use strict';

  var SRC = '/assets/nextgen-film.mp4?v=20261021-10';
  var POSTER = '/assets/img/nextgen-film-poster.jpg?v=20261021-10';
  var KEY = 'ngs-film-seen';
  var DELAY = 1600;                 // after the page has loaded, so the hero gets its moment first
  var REST = 83;                    // s: the frame the end card rests on (the nextgen mark on black)
  var STALL = 10000;                // no progress for this long once it has started: free the close
  var NEVER = 30000;                // no first frame at all after this long: free the close
  var NUDGE = 40;                   // px of scrolling that tucks it into the corner
  var RING = 2 * Math.PI * 21;      // the countdown ring's circumference (r = 21 in a 48 box)
  var EASE = 'cubic-bezier(.16,1,.3,1)';

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function seen() { try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function remember() { try { sessionStorage.setItem(KEY, '1'); } catch (e) {} }
  function forced() { return /[?&]film(=|&|$)/.test(location.search); }

  function build() {
    var f = document.createElement('div');
    f.className = 'film';
    f.setAttribute('role', 'dialog');
    f.setAttribute('aria-modal', 'false');
    f.setAttribute('aria-label', 'A message from NextGen Summit');
    f.innerHTML =
      '<div class="film__shade" aria-hidden="true"></div>' +
      '<div class="film__box">' +
        '<div class="film__bar" aria-hidden="true"></div>' +
        '<div class="film__frame">' +
          '<video class="film__video" playsinline webkit-playsinline muted preload="none" disableremoteplayback poster="' + POSTER + '"></video>' +
          '<div class="film__ui">' +
            '<p class="film__kicker" aria-hidden="true">A message from nextgen</p>' +
            '<button class="film__grow" type="button" aria-label="Bring the film back to the middle">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</button>' +
            '<button class="film__gate" type="button" disabled aria-label="Close, available when the film ends">' +
              '<svg viewBox="0 0 48 48" aria-hidden="true">' +
                '<circle class="film__track" cx="24" cy="24" r="21"/>' +
                '<circle class="film__ring" cx="24" cy="24" r="21" stroke-dasharray="' + RING.toFixed(2) + '" stroke-dashoffset="' + RING.toFixed(2) + '"/>' +
                '<path class="film__x" pathLength="1" d="M18 18l12 12"/>' +
                '<path class="film__x" pathLength="1" d="M30 18L18 30"/>' +
              '</svg>' +
              '<span class="film__count" aria-hidden="true"></span>' +
            '</button>' +
            '<button class="film__sound" type="button" aria-pressed="false">' +
              '<span class="film__eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' +
              '<span class="film__off">Tap for sound</span><span class="film__on">Sound on</span>' +
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
            '<div class="film__progress" aria-hidden="true"><span></span></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<p class="sr" aria-live="polite"></p>';
    document.body.appendChild(f);
    return f;
  }

  function show() {
    remember();   // once a session, however it ends
    var f = build();
    function $(s) { return f.querySelector(s); }
    var box = $('.film__box'), v = $('.film__video'), gate = $('.film__gate'), ring = $('.film__ring'),
        count = $('.film__count'), bar = $('.film__progress span'), sound = $('.film__sound'), live = $('.sr');

    var mini = false, free = false, closing = false, held = false, begun = false, raf = 0;
    var y0 = window.scrollY, last = -1, lastMove = Date.now();

    /* ---------- the gate ---------- */
    function release(why) {
      if (free) return;
      free = true;
      gate.disabled = false;
      gate.setAttribute('aria-label', 'Close the film');
      f.classList.add('is-free');
      ring.style.strokeDashoffset = '0';
      live.textContent = why || 'The film has ended. You can close it now.';
    }

    function tick() {
      var d = v.duration, t = v.currentTime || 0;
      if (d && isFinite(d)) {
        var p = f.classList.contains('is-over') ? 1 : Math.min(1, t / d);
        bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
        if (!free) {
          ring.style.strokeDashoffset = (RING * (1 - p)).toFixed(2);
          count.textContent = Math.max(0, Math.ceil(d - t));
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
    }

    // with sound if the browser allows it, otherwise muted; if even that is refused, a play button
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
    setTimeout(function () { if (!begun) release('The film could not load. You can close it now.'); }, NEVER);
    v.addEventListener('pause', function () { if (held) f.classList.add('is-paused'); });
    v.addEventListener('ended', function () {
      f.classList.add('is-over');
      bar.style.transform = 'scaleX(1)';
      if (v.duration > REST) v.currentTime = REST;   // the last second is black: rest on the mark
      release();
    });
    v.addEventListener('error', function () { release('The film could not load. You can close it now.'); });

    sound.addEventListener('click', function () {
      var on = v.muted;
      v.muted = !on;
      setSound(on);
      if (on && v.paused && !v.ended) play(true);
    });
    $('.film__play').addEventListener('click', function () { play(true); });
    $('.film__again').addEventListener('click', function () {
      f.classList.remove('is-over');
      v.currentTime = 0;
      play(!v.muted);
    });
    // a click on the picture pauses and resumes, as people expect of a video
    $('.film__frame').addEventListener('click', function (e) {
      if (mini || e.target.closest('button') || f.classList.contains('is-over')) return;
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

    /* ---------- the middle and the corner ---------- */
    // FLIP: measure, switch the class, measure again, and play the difference back to nothing
    function morph(toMini) {
      if (mini === toMini || closing) return;
      var a = box.getBoundingClientRect();
      mini = toMini;
      f.classList.toggle('is-mini', mini);
      if (!mini) y0 = window.scrollY;
      if (reduce || !box.animate) return;
      var b = box.getBoundingClientRect();
      f.classList.add('is-morphing');
      var run = box.animate([
        { transform: 'translate(' + (a.left - b.left) + 'px,' + (a.top - b.top) + 'px) scale(' + (a.width / b.width) + ')' },
        { transform: 'none' }
      ], { duration: mini ? 750 : 850, easing: EASE });
      run.onfinish = run.oncancel = function () { f.classList.remove('is-morphing'); };
    }

    function onScroll() { if (!mini && Math.abs(window.scrollY - y0) > NUDGE) morph(true); }
    function onKey(e) {
      if (e.key !== 'Escape' || mini || document.querySelector('dialog[open]')) return;
      morph(true);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('keydown', onKey);
    // a wheel or a swipe over the film means "I want the page": even at the very top, where nothing scrolls
    f.addEventListener('wheel', function () { if (!mini) morph(true); }, { passive: true });
    f.addEventListener('touchmove', function () { if (!mini) morph(true); }, { passive: true });
    $('.film__shade').addEventListener('click', function () { morph(true); });
    $('.film__grow').addEventListener('click', function () { morph(false); });

    /* ---------- closing ---------- */
    function finish() {
      cancelAnimationFrame(raf);
      v.removeAttribute('src');
      v.load();
      f.remove();
    }
    gate.addEventListener('click', function () {
      if (!free || closing) return;
      closing = true;
      v.pause();
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisible);
      if (reduce || !box.animate) { finish(); return; }
      f.classList.add('is-leaving');
      box.style.transformOrigin = '50% 50%';
      box.animate([
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: mini ? 'translate(0,40px) scale(.9)' : 'translate(0,28px) scale(.94)' }
      ], { duration: 420, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' }).onfinish = finish;
    });

    /* ---------- go ---------- */
    v.preload = 'auto';
    v.src = SRC;
    requestAnimationFrame(function () { f.classList.add('is-in'); });
    raf = requestAnimationFrame(tick);
    if (reduce) {
      // no motion unless asked for: it waits for play, and can be closed at once
      f.classList.add('is-blocked');
      release('Press play to watch the film, or close it.');
    } else {
      start(true);
    }
  }

  function begin() {
    if (!forced() && seen()) return;
    if (navigator.connection && navigator.connection.saveData && !forced()) return;
    if (typeof document.createElement('video').play !== 'function') return;
    function attempt() {
      // never on top of a menu, a speaker card or a form someone already has open
      if (document.querySelector('dialog[open]') || document.hidden) { setTimeout(attempt, 1500); return; }
      show();
    }
    var started = false;
    function soon() { if (started) return; started = true; setTimeout(attempt, DELAY); }
    if (document.readyState === 'complete') soon();
    else { window.addEventListener('load', soon, { once: true }); setTimeout(soon, 3500); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin);
  else begin();
})();
