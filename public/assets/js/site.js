/* Next Gen Summit, V1 prototype.
   Plain JavaScript, no dependencies. Each section is one small init function. */
(function () {
  'use strict';
  document.documentElement.classList.add('js-ready');

  var doc = document.documentElement;
  var reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  var reduced = reduceMQ.matches;
  var motionHooks = [];

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, text, hidden) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (hidden) n.setAttribute('aria-hidden', 'true');
    return n;
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function onMotionChange(fn) { motionHooks.push(fn); }

  var fontsReady = (document.fonts && document.fonts.load)
    ? Promise.all([
        document.fonts.load('900 100px Fraunces'),
        document.fonts.load('800 100px Montserrat')
      ]).catch(function () {})
    : Promise.resolve();

  /* ---------- registration plates ---------- */
  function buildReg(node) {
    if (node.__reg) return node;
    var text = node.textContent;
    node.textContent = '';
    node.appendChild(el('span', 'reg__k', text));
    ['c', 'm', 'y'].forEach(function (p) {
      node.appendChild(el('span', 'reg__p reg__p--' + p, text, true));
    });
    node.__reg = true;
    return node;
  }

  function regPlay(node, delay) {
    if (reduced) return;
    clearTimeout(node.__t1);
    clearTimeout(node.__t2);
    node.classList.remove('is-in', 'is-done');
    node.classList.add('is-armed');
    void node.offsetWidth;                 // commit the misregistered start state
    node.__t1 = setTimeout(function () {
      node.classList.add('is-in');
      node.__t2 = setTimeout(function () { node.classList.add('is-done'); }, 1700);
    }, delay || 0);
  }

  function regReset(node) {
    clearTimeout(node.__t1);
    clearTimeout(node.__t2);
    node.classList.remove('is-armed', 'is-in', 'is-done');
  }

  /* ---------- reveals ---------- */
  function settle(node) {
    var d = parseFloat(node.style.getPropertyValue('--d')) || 0;
    setTimeout(function () { node.classList.add('settled'); }, d * 1000 + 1400);
  }

  function initReveals() {
    var items = $$('.rv').filter(function (n) { return !n.closest('.hero'); });
    if (!('IntersectionObserver' in window) || reduced) {
      items.forEach(function (n) { n.classList.add('in', 'settled'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        settle(e.target);
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    items.forEach(function (n) { io.observe(n); });
  }

  /* ---------- hero entrance ---------- */
  function initHero() {
    var hero = $('.hero');
    if (!hero) return;
    var img = $('.hero__img', hero);
    var mark = $('.hero__title .reg', hero);
    if (mark) buildReg(mark);
    var imgReady = new Promise(function (res) {
      if (!img || img.complete) return res();
      img.addEventListener('load', res, { once: true });
      img.addEventListener('error', res, { once: true });
    });
    var timeout = new Promise(function (res) { setTimeout(res, 800); });
    Promise.race([Promise.all([imgReady, fontsReady]), timeout]).then(function () {
      doc.classList.add('is-ready');
      $$('.rv', hero).forEach(function (n) { n.classList.add('in'); settle(n); });
      if (mark) regPlay(mark, 280);
    });
  }

  /* ---------- hero countdown ---------- */
  function initCountdown() {
    var box = $('.count');
    if (!box) return;
    var target = new Date(box.getAttribute('data-until')).getTime();
    if (!target) { box.hidden = true; return; }
    var out = {};
    ['days', 'hours', 'minutes', 'seconds'].forEach(function (k) { out[k] = $('[data-count="' + k + '"]', box); });
    var sr = $('[data-count-sr]', box);
    var timer = null, visible = false;

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function tick() {
      var left = Math.max(0, target - Date.now());
      var sec = Math.floor(left / 1000);
      var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
      out.days.textContent = pad(d);
      out.hours.textContent = pad(h);
      out.minutes.textContent = pad(m);
      out.seconds.textContent = pad(sec % 60);
      if (sr) sr.textContent = left ? d + ' days until NextGen Summit on October 30.' : 'NextGen Summit is here.';
      if (!left && timer) { clearInterval(timer); timer = null; }
    }
    function run() {                        // only ticks while the hero is on screen and the tab is open
      var on = visible && !document.hidden;
      if (on && !timer) { tick(); timer = setInterval(tick, 1000); }
      else if (!on && timer) { clearInterval(timer); timer = null; }
    }
    tick();
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; run(); }).observe(box);
    document.addEventListener('visibilitychange', run);
  }

  /* ---------- nav theme ---------- */
  var requestNav = function () {};
  function initNav() {
    var nav = $('.nav');
    if (!nav) return;
    var sections = $$('[data-nav]');
    var hero = $('.hero');
    var state = '';
    var raf = null;

    function update() {
      raf = null;
      var y = nav.offsetHeight / 2;
      var theme = 'paper';
      for (var i = 0; i < sections.length; i++) {
        var r = sections[i].getBoundingClientRect();
        if (r.top <= y && r.bottom > y) {
          var s = sections[i];
          var mode = s.getAttribute('data-nav');
          theme = (mode === 'photo' || (mode === 'xp' && s.classList.contains('is-lit'))) ? 'photo' : 'paper';
          break;
        }
      }
      var atHero = !!hero && hero.getBoundingClientRect().bottom > window.innerHeight * 0.42;
      var next = theme + (atHero ? ':hero' : '');
      if (next === state) return;
      state = next;
      nav.classList.toggle('on-photo', theme === 'photo');
      nav.classList.toggle('on-paper', theme === 'paper');
      nav.classList.toggle('at-hero', atHero);
    }

    requestNav = function () { if (raf === null) raf = requestAnimationFrame(update); };
    addEventListener('scroll', requestNav, { passive: true });
    addEventListener('resize', requestNav);
    update();
  }

  /* ---------- 02 rotating identity ---------- */
  function initRotator() {
    var box = $('[data-rotator]');
    if (!box) return;
    var words;
    try { words = JSON.parse(box.getAttribute('data-rotator')); } catch (e) { return; }
    var toggle = $('[data-rotator-toggle]');
    var title = box.closest('h2') || box;
    box.textContent = '';
    var nodes = words.map(function (w, i) {
      var wrap = el('span', 'what__word' + (i === 0 ? ' is-current' : ''));
      var r = el('span', 'reg', w);
      wrap.appendChild(buildReg(r));
      wrap.appendChild(el('span', 'what__dot', '.'));
      box.appendChild(wrap);
      return wrap;
    });

    var idx = 0, timer = null, visible = false, userPaused = false, hovering = false;

    function canRun() { return visible && !userPaused && !hovering && !reduced && !document.hidden; }
    function step() {
      var cur = nodes[idx];
      idx = (idx + 1) % nodes.length;
      var nxt = nodes[idx];
      cur.classList.remove('is-current');
      cur.classList.add('is-leaving');
      setTimeout(function () { cur.classList.remove('is-leaving'); }, 650);
      nxt.classList.add('is-current');
      regPlay($('.reg', nxt), 60);
    }
    function schedule() {
      clearTimeout(timer);
      timer = null;
      if (canRun()) timer = setTimeout(function () { step(); schedule(); }, 1500);   // time each word holds
    }
    function showFirst() {
      nodes.forEach(function (n, i) {
        n.classList.toggle('is-current', i === 0);
        n.classList.remove('is-leaving');
        regReset($('.reg', n));
      });
      idx = 0;
    }

    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; schedule(); }, { threshold: 0.3 }).observe(title);
    title.addEventListener('pointerenter', function () { hovering = true; schedule(); });
    title.addEventListener('pointerleave', function () { hovering = false; schedule(); });
    document.addEventListener('visibilitychange', schedule);

    if (toggle) {
      toggle.addEventListener('click', function () {
        userPaused = !userPaused;
        toggle.setAttribute('aria-pressed', String(userPaused));
        var label = userPaused ? 'Play the rotating words' : 'Pause the rotating words';
        $('.toggle__t', toggle).textContent = userPaused ? 'Play words' : 'Pause words';
        toggle.setAttribute('aria-label', label);
        schedule();
      });
    }

    onMotionChange(function () {
      if (reduced) showFirst();
      if (toggle) toggle.hidden = reduced;
      schedule();
    });
    if (toggle) toggle.hidden = reduced;
  }

  /* ---------- 03 the experience ---------- */
  function initExperience() {
    var xp = $('.xp');
    if (!xp) return;
    var items = $$('.xp__item', xp);
    var bgs = $$('.xp__bg', xp);
    var touchMQ = matchMedia('(hover:none),(pointer:coarse),(max-width:900px)');
    var active = null, leaveTimer = null, loaded = false;

    function loadImages() {
      if (loaded) return;
      loaded = true;
      bgs.forEach(function (f) {
        $$('source, img', f).forEach(function (n) {    // sources first, so the img picks from them
          if (n.dataset.srcset) n.srcset = n.dataset.srcset;
          if (n.dataset.src) n.src = n.dataset.src;
        });
      });
    }
    new IntersectionObserver(function (es) { if (es[0].isIntersecting) loadImages(); }, { rootMargin: '50% 0px' }).observe(xp);

    function setActive(key) {
      if (key === active) return;
      active = key;
      items.forEach(function (it) { it.classList.toggle('is-active', it.getAttribute('data-key') === key); });
      bgs.forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-key') === key); });
      xp.classList.toggle('has-active', !!key);
      xp.classList.toggle('is-lit', !!key);
      requestNav();
    }

    // desktop: hover a phrase
    items.forEach(function (it) {
      var key = it.getAttribute('data-key');
      $('.xp__phrase', it).addEventListener('pointerenter', function () {
        if (touchMQ.matches) return;
        clearTimeout(leaveTimer);
        setActive(key);
      });
      it.addEventListener('click', function () { if (touchMQ.matches) setActive(key); });
    });
    $('.xp__list', xp).addEventListener('pointerleave', function () {
      if (touchMQ.matches) return;
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(function () { setActive(null); }, 260);
    });

    // touch and narrow screens: the phrase crossing the middle of the screen is active
    var centerIO = new IntersectionObserver(function (es) {
      if (!touchMQ.matches) return;
      es.forEach(function (e) { if (e.isIntersecting) setActive(e.target.getAttribute('data-key')); });
    }, { rootMargin: '-46% 0px -46% 0px' });
    items.forEach(function (it) { centerIO.observe(it); });
    new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting && touchMQ.matches) setActive(null);
    }).observe(xp);

    touchMQ.addEventListener('change', function () { setActive(null); });
  }

  /* ---------- 04 the invitation ---------- */
  function initInvite() {
    var sec = $('.invite');
    if (!sec) return;
    var canvas = $('canvas', sec);
    var dateBox = $('.invite__date', sec);
    var dates = $$('.reg', dateBox);
    dates.forEach(buildReg);
    var liquid = null, played = false, mounting = false;
    var SEP_OPEN = 28, SEP_REST = 8;

    function mount() {
      if (liquid || mounting) return;
      mounting = true;
      fontsReady.then(function () {
        if (!window.NGLiquid || !canvas) { doc.classList.add('no-webgl'); return; }
        liquid = window.NGLiquid.mount(canvas, {
          sep: (played || reduced) ? SEP_REST : SEP_OPEN,
          time: 14,
          frameY: [0.12, 0.86]
        });
        if (!liquid) { doc.classList.add('no-webgl'); return; }
        if (!reduced) liquid.play();
      });
    }

    new IntersectionObserver(function (es) { if (es[0].isIntersecting) mount(); }, { rootMargin: '60% 0px' }).observe(canvas);
    new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting || played) return;
      played = true;
      dates.forEach(function (d, i) { regPlay(d, i * 180); });
      if (liquid) liquid.setSep(SEP_REST);
    }, { threshold: 0.45 }).observe(dateBox);

    onMotionChange(function () {
      if (!liquid) return;
      if (reduced) { liquid.pause(); liquid.setSep(SEP_REST, true); }
      else liquid.play();
      if (reduced) dates.forEach(regReset);
    });
  }

  /* ---------- 06 who nextgen is for ---------- */
  // One composition: the 17—29 headline hands off to the numerals behind the portraits (--p),
  // a turquoise thread draws 01 → 02 → 03 → the ending, and one portrait at a time comes alive
  // while the others make room for it.
  function initGen() {
    var gen = $('.gen');
    if (!gen) return;
    var range = $('.gen__range .reg', gen);
    if (range) {
      buildReg(range);
      new IntersectionObserver(function (es, io) {
        if (!es[0].isIntersecting) return;
        regPlay(range, 200);
        io.disconnect();
      }, { threshold: 0.5 }).observe(range);
    }

    var set = $('.gen__set', gen);
    if (!set) return;
    var stages = $$('.gen__stage', set);
    var art = $('.gen__art', gen);
    var end = $('.gen__end', gen);
    var hoverMQ = matchMedia('(hover:hover) and (pointer:fine)');

    /* --- one stage holds the attention; the other two settle back --- */
    var active = null, leaveT = null;
    function setActive(st) {
      if (reduced) st = null;
      if (st === active) return;
      active = st;
      stages.forEach(function (s) { s.classList.toggle('is-active', s === st); });
      set.classList.toggle('has-active', !!st);
    }
    function settle() {                       // after hover or focus leaves, keep whatever still holds it
      clearTimeout(leaveT);
      leaveT = setTimeout(function () {
        var focused = stages.filter(function (s) { return s.contains(document.activeElement); })[0];
        var hovered = hoverMQ.matches && stages.filter(function (s) { return s.matches(':hover'); })[0];
        if (focused || hovered) setActive(focused || hovered);
        else if (hoverMQ.matches) setActive(null);   // with a mouse, resting means no one is singled out
        else pickCentered();
      }, 90);
    }
    stages.forEach(function (st) {
      st.addEventListener('pointerenter', function () {
        if (!hoverMQ.matches) return;
        clearTimeout(leaveT);
        setActive(st);
      });
      st.addEventListener('pointerleave', function () { if (hoverMQ.matches) settle(); });
      st.addEventListener('focusin', function () { clearTimeout(leaveT); setActive(st); });
      st.addEventListener('focusout', settle);
    });

    // touch and trackpad-less screens: whichever portrait is nearest the reading line takes the focus,
    // so scrolling normally walks 01 -> 02 -> 03. Nothing is pinned and nothing hijacks the scroll.
    function pickCentered() {
      if (hoverMQ.matches) return;
      var line = window.innerHeight * 0.46, best = null, bestD = Infinity;
      stages.forEach(function (s) {
        var r = s.getBoundingClientRect();
        if (r.bottom <= 0 || r.top >= window.innerHeight) return;   // off screen: not a candidate
        var d = Math.abs(r.top + r.height / 2 - line);
        if (d < bestD) { bestD = d; best = s; }
      });
      if (!best && stages.some(function (s) { return s.contains(document.activeElement); })) return;
      setActive(best);
    }

    /* --- the rail: park it at the height every frame shares, so it reads as one line running
           behind all three photographs and showing in the gaps between them --- */
    var rail = $('.gen__rail', gen), oneRow = matchMedia('(min-width:1001px)');
    function placeRail() {
      if (!rail) return;
      if (!oneRow.matches) { rail.style.removeProperty('--rail-y'); return; }
      var tops = [], bottoms = [];
      stages.forEach(function (s) {
        var f = $('.gen__card', s), y = 0, n = f;
        while (n && n !== art) { y += n.offsetTop; n = n.offsetParent; }
        tops.push(y);
        bottoms.push(y + f.offsetHeight);
      });
      var lo = Math.max.apply(null, tops), hi = Math.min.apply(null, bottoms);
      rail.style.setProperty('--rail-y', (hi - lo > 40 ? (lo + hi) / 2 : art.offsetHeight * 0.54) + 'px');
    }

    /* --- scroll: one rAF-throttled passive listener, only while the section is on screen --- */
    var onScreen = false, raf = null;
    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
    function paint() {
      raf = null;
      var vh = window.innerHeight;
      if (reduced) {
        gen.style.removeProperty('--p');
        gen.style.setProperty('--q', '1');       // the rail simply sits there, fully drawn
        return;
      }
      // --p: 0 while 17-29 sits in view, 1 once it has handed off to the portraits
      pickCentered();
      var anchor = range || $('.gen__title', gen);
      var rt = anchor ? anchor.getBoundingClientRect().top : 0;
      gen.style.setProperty('--p', clamp01((vh * 0.35 - rt) / (vh * 0.55)).toFixed(3));
      // --q: the rail draws across the collage, finishing as the ending arrives
      var a = art.getBoundingClientRect(), e = (end || art).getBoundingClientRect();
      gen.style.setProperty('--q', clamp01((vh * 0.85 - a.top) / Math.max(1, e.bottom - a.top)).toFixed(3));
    }
    function request() { if (raf === null && onScreen) raf = requestAnimationFrame(paint); }
    new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; request(); }, { rootMargin: '25% 0px' }).observe(gen);
    addEventListener('scroll', request, { passive: true });
    addEventListener('resize', function () { placeRail(); request(); }, { passive: true });
    new ResizeObserver(placeRail).observe(art);
    fontsReady.then(placeRail);
    placeRail();

    hoverMQ.addEventListener('change', function () { setActive(null); pickCentered(); });
    onMotionChange(function () {
      if (reduced) setActive(null); else pickCentered();
      paint();
    });
  }

  /* ---------- 04 the speaker runway ----------
     One row of portraits sliding left to right for ever. site.js measures one set of speakers,
     clones the set until the row is wider than the screen plus one whole set, then drives a single
     transform: x = -setW + (pos mod setW). Because the content repeats exactly every setW, the wrap
     is invisible -- there is no reset to see. Position lives in `pos` (pixels travelled), so pausing
     is simply "stop adding to pos" and resuming carries on from the very same place. */
  function initRunway() {
    var run = $('[data-run]');
    if (!run) return;
    var track = $('[data-run-track]', run);
    var originals = track ? $$('.spk', track) : [];
    if (!originals.length) return;

    var SPEED = 34;                                    // px per second: slow enough to read a name
    var hoverMQ = matchMedia('(hover:hover) and (pointer:fine)');
    var smallMQ = matchMedia('(max-width:760px)');
    var pos = 0, setW = 0, last = 0, raf = null, onScreen = false, paused = false, active = null;

    function speed() { return smallMQ.matches ? SPEED * 0.7 : SPEED; }

    function place() {
      if (!setW) return;
      track.style.transform = 'translate3d(' + (-setW + pos).toFixed(2) + 'px,0,0)';
    }

    function copyOf(li) {
      var c = li.cloneNode(true);
      c.classList.add('spk--copy');
      c.classList.remove('is-active');
      c.setAttribute('aria-hidden', 'true');          // the copies are decoration, announced once only
      $$('[id]', c).forEach(function (n) { n.removeAttribute('id'); });
      $$('[tabindex],a,button', c).forEach(function (n) { n.setAttribute('tabindex', '-1'); });
      return c;
    }

    function build() {
      $$('.spk--copy', track).forEach(function (n) { n.remove(); });
      if (reduced) { track.style.transform = ''; return; }   // static row: no copies, no transform
      var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      var w = 0;
      originals.forEach(function (li) { w += li.getBoundingClientRect().width + gap; });
      if (!w) return;
      setW = w;
      // One copy of the LAST speaker goes in front of the real ones. The row still repeats exactly
      // every setW, but the originals now start a card in from the left edge, which is what lets
      // every one of them be slid into view when it takes keyboard focus.
      track.insertBefore(copyOf(originals[originals.length - 1]), originals[0]);
      var guard = 0;
      while (track.scrollWidth < run.clientWidth + setW * 2 && guard++ < 12) {
        originals.forEach(function (li) { track.appendChild(copyOf(li)); });
      }
      if (pos > setW) pos = pos % setW;
      place();
    }

    function frame(t) {
      raf = null;
      if (!last) last = t;
      var dt = Math.min(64, t - last);                 // a hidden tab must not jump on return
      last = t;
      pos += speed() * dt / 1000;
      if (pos >= setW) pos -= setW;                    // same picture, smaller number: no visible reset
      place();
      tick();
    }
    function tick() { if (raf === null && onScreen && !paused && !reduced) raf = requestAnimationFrame(frame); }
    function stop() { if (raf !== null) { cancelAnimationFrame(raf); raf = null; } last = 0; }
    function pause() { paused = true; stop(); }
    function resume() { if (!paused) return; paused = false; last = 0; tick(); }

    function setActive(card) {
      if (card === active) return;
      active = card;
      $$('.spk', track).forEach(function (s) { s.classList.toggle('is-active', s === card); });
      run.classList.toggle('has-active', !!card);
    }

    // a card reached by keyboard may be off to one side, so slide the row to it rather than let the
    // browser scroll a clipped box, which would put the row out of step with its own transform
    function reveal(card) {
      if (!setW) return;
      var L = card.offsetLeft, cw = card.offsetWidth, runW = run.clientWidth;
      var pad = Math.max(24, Math.min(96, runW * 0.07));
      var want = pad - L;                              // this card, pad in from the left edge
      var rightMost = runW - pad - cw - L;             // no further right than the far edge allows
      if (want > rightMost) want = rightMost;
      if (want > 0) want = 0;
      if (want < -setW) want = -setW;
      pos = want + setW;
      place();
    }

    run.addEventListener('pointerover', function (e) {
      if (!hoverMQ.matches) return;
      var card = e.target.closest('.spk');
      if (!card) return;
      pause();
      setActive(card);
    });
    run.addEventListener('pointerleave', function () {
      if (!hoverMQ.matches) return;
      setActive(null);
      resume();
    });
    run.addEventListener('focusin', function (e) {
      var card = e.target.closest('.spk');
      if (!card) return;
      pause();
      setActive(card);
      reveal(card);
    });
    run.addEventListener('focusout', function (e) {
      if (run.contains(e.relatedTarget)) return;
      setActive(null);
      resume();
    });
    // touch: tap a speaker to hold the row on them, tap them again or tap away to let it go.
    // A tap is a pointerup that did not travel, so swiping the page past the row never grabs it.
    var tapX = 0, tapY = 0, tapT = 0;
    run.addEventListener('pointerdown', function (e) {
      tapX = e.clientX; tapY = e.clientY; tapT = e.timeStamp;
    });
    run.addEventListener('pointerup', function (e) {
      if (hoverMQ.matches) return;
      if (Math.abs(e.clientX - tapX) > 10 || Math.abs(e.clientY - tapY) > 10 || e.timeStamp - tapT > 700) return;
      var card = e.target.closest('.spk');
      if (card && card !== active) { pause(); setActive(card); }
      else { setActive(null); resume(); }
    });
    document.addEventListener('pointerup', function (e) {
      if (hoverMQ.matches || !active || run.contains(e.target)) return;
      setActive(null);
      resume();
    });
    // a clipped box can still be scrolled programmatically; keep it pinned so the loop stays true
    run.addEventListener('scroll', function () { run.scrollLeft = 0; });

    new IntersectionObserver(function (es) {
      onScreen = es[0].isIntersecting;
      if (!onScreen) { stop(); return; }
      // the row slides pictures in from the side rather than scrolling them in, which lazy loading
      // cannot anticipate, so once the section is near, let every copy fetch (same three cached files)
      $$('img[loading="lazy"]', track).forEach(function (im) { im.loading = 'eager'; });
      last = 0;
      tick();
    }, { rootMargin: '15% 0px' }).observe(run);
    var rebuildRaf = null;                            // build() touches the DOM: never inside the callback
    function rebuild() {
      if (rebuildRaf !== null) return;
      rebuildRaf = requestAnimationFrame(function () { rebuildRaf = null; build(); });
    }
    new ResizeObserver(rebuild).observe(run);
    fontsReady.then(build);
    onMotionChange(function () {
      if (reduced) { stop(); setActive(null); }
      build();
      if (!reduced) { last = 0; tick(); }
    });
    build();
  }

  /* ---------- 07 finale ---------- */
  function initFinale() {
    var t = $('.finale__title .reg');
    if (!t) return;
    buildReg(t);
    new IntersectionObserver(function (es, io) {
      if (!es[0].isIntersecting) return;
      regPlay(t, 120);
      io.disconnect();
    }, { threshold: 0.6 }).observe(t);
  }

  /* ---------- utilities: drawers ---------- */
  function initDialogs() {
    var dialogs = {};
    $$('dialog.drawer').forEach(function (d) {
      dialogs[d.id] = d;
      d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
      // browsers close a modal dialog on Escape themselves; this covers the non-modal fallback too
      d.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); d.close(); } });
      d.addEventListener('close', function () {
        if (location.hash === '#' + d.id) history.replaceState(null, '', location.pathname + location.search);
      });
    });

    function open(id) {
      var d = dialogs[id];
      if (!d) return;
      Object.keys(dialogs).forEach(function (k) { if (k !== id && dialogs[k].open) dialogs[k].close(); });
      if (!d.open) {
        if (typeof d.showModal === 'function') d.showModal();
        else d.setAttribute('open', '');
      }
      if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    }

    document.addEventListener('click', function (e) {
      var opener = e.target.closest('[data-open]');
      if (opener) {
        e.preventDefault();
        open(opener.getAttribute('data-open'));
        return;
      }
      var closer = e.target.closest('[data-close]');
      if (closer) {
        var d = closer.closest('dialog');
        if (d) d.close();
      }
    });

    function fromHash() {
      var id = location.hash.slice(1);
      if (dialogs[id]) open(id);
      // once the early-access drawer is gone (ticketing is live), old #registration links go to tickets
      else if (id === 'registration' && !document.getElementById('registration')) location.replace('/tickets/');
    }
    addEventListener('hashchange', fromHash);
    fromHash();
  }

  /* ---------- utilities: forms, saved by /api/register.php without leaving the page ---------- */
  // On file:// or a plain local preview server there is no PHP to receive the post, so the preview
  // shows the success state and says plainly that nothing was sent.
  var FORM_ENDPOINT = '/api/register.php';
  var LOCAL_PREVIEW = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  function sendForm(form) {
    if (LOCAL_PREVIEW) return new Promise(function (res) { setTimeout(res, 450); });
    return fetch(FORM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams(new FormData(form)).toString()
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.ok && data.ok) return;
        var err = new Error('Form post failed with ' + r.status);
        err.userMessage = data.error || '';
        err.fields = Array.isArray(data.fields) ? data.fields : [];
        throw err;
      });
    });
  }

  function setBusy(btn, on) {
    var t = $('.btn__t', btn);
    btn.disabled = on;
    if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
    if (!t) return;
    if (on) { t.__label = t.textContent; t.textContent = 'Sending'; }
    else if (t.__label) t.textContent = t.__label;
  }

  function firstName(v) { return (v || '').trim().split(/\s+/)[0] || 'friend'; }

  function showError(err, text) {
    if (!err) return;
    err.textContent = text;
    err.hidden = false;
  }

  function initForms() {
    $$('[data-expand]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = document.getElementById(btn.getAttribute('aria-controls'));
        if (!target) return;
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        target.hidden = open;
        if (!open) {
          var first = $('input:not([type=hidden]):not([name=bot-field])', target);
          if (first) first.focus();
        }
      });
    });

    // volunteer and partner notes
    $$('form.mini').forEach(function (form) {
      var btn = $('button[type=submit]', form);
      var err = $('.form__error', form);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (err) err.hidden = true;
        setBusy(btn, true);
        sendForm(form).then(function () {
          var done = el('div', 'mini__done');
          done.setAttribute('role', 'status');
          done.tabIndex = -1;
          done.id = form.id;
          done.appendChild(document.createTextNode('Thanks, ' + firstName(form.elements.name.value) + '. We received your note and will reach out at ' + form.elements.email.value.trim() + '.'));
          if (LOCAL_PREVIEW) done.appendChild(el('small', null, 'Local preview: nothing was sent. This form works once the site is live.'));
          form.replaceWith(done);
          done.focus();
        }).catch(function (e) {
          setBusy(btn, false);
          showError(err, (e && e.userMessage) || "That didn't go through. Please check your connection and try again.");
        });
      });
    });

    initRegistration();
    initQuestion();
  }

  // "Still have a question?" under the FAQ. Each problem is shown under its own field and
  // announced with it; the button stays disabled while a send is in flight.
  function initQuestion() {
    var form = $('form[name="question"]');
    if (!form) return;
    var done = $('[data-ask-done]');
    var btn = $('button[type=submit]', form);
    var err = $('.form__error', form);
    var MSG = {
      name: 'Please add your full name.',
      email: 'Please check your email address.',
      question: 'Please write your question.'
    };

    function mark(name, text) {
      var input = form.elements[name];
      var note = input && document.getElementById(input.id + '-err');
      if (!input) return;
      if (text) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
      if (note) { note.textContent = text || ''; note.hidden = !text; }
    }

    function problems() {
      var out = [];
      if (!form.elements.name.value.trim()) out.push('name');
      var email = form.elements.email;
      if (!email.value.trim() || !email.validity.valid) out.push('email');
      if (!form.elements.question.value.trim()) out.push('question');
      return out;
    }

    Object.keys(MSG).forEach(function (name) {
      form.elements[name].addEventListener('input', function () {
        if (this.getAttribute('aria-invalid') === 'true' && problems().indexOf(name) < 0) mark(name, '');
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (btn.disabled) return;
      err.hidden = true;
      var bad = problems();
      Object.keys(MSG).forEach(function (name) { mark(name, bad.indexOf(name) >= 0 ? MSG[name] : ''); });
      if (bad.length) { form.elements[bad[0]].focus(); return; }
      setBusy(btn, true);
      sendForm(form).then(function () {
        form.hidden = true;
        if (LOCAL_PREVIEW) $('.ask__done-x', done).appendChild(el('small', null, 'Local preview: nothing was sent. This form works once the site is live.'));
        done.hidden = false;
        done.focus();
      }).catch(function (e) {
        setBusy(btn, false);
        var fields = (e && e.fields) || [];
        fields.forEach(function (name) { if (MSG[name]) mark(name, MSG[name]); });
        showError(err, (e && e.userMessage) || "That didn't go through. Please check your connection and try again.");
        if (fields.length && form.elements[fields[0]]) form.elements[fields[0]].focus(); else err.focus();
      });
    });
  }

  // Drives the waitlist form, or the paused registration form if it is restored in index.html.
  function initRegistration() {
    var form = $('form[name="waitlist"]') || $('form[name="registration"]');
    if (!form) return;
    var dialog = form.closest('dialog');
    var wrap = $('[data-form-wrap]', dialog);
    var done = $('[data-form-done]', dialog);
    var btn = $('button[type=submit]', form);
    var err = $('.form__error', form);
    var school = form.elements.school_name;
    var schoolHint = $('[data-school-hint]', form);
    var mark = $('.done__title .reg', done);
    if (mark) buildReg(mark);

    // registration form only: school becomes optional for "Other" (the waitlist has no school question)
    function syncSchool() {
      if (!school || !form.elements.education_level) return;
      var other = form.elements.education_level.value === 'Other';
      school.required = !other;
      if (schoolHint) schoolHint.hidden = !other;
    }
    $$('input[name="education_level"]', form).forEach(function (i) { i.addEventListener('change', syncSchool); });
    syncSchool();

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.hidden = true;
      var who = {
        first: firstName((form.elements.first_name || form.elements.name).value),
        email: form.elements.email.value.trim(),
        volunteer: !!form.elements.volunteer_interest && form.elements.volunteer_interest.value === 'Yes'
      };
      setBusy(btn, true);
      sendForm(form).then(function () {
        $('[data-done-name]', done).textContent = who.first;
        $('[data-done-email]', done).textContent = who.email;
        var vol = $('[data-done-volunteer]', done);
        if (vol) vol.hidden = !who.volunteer;
        $('[data-done-local]', done).hidden = !LOCAL_PREVIEW;
        wrap.hidden = true;
        done.hidden = false;
        dialog.scrollTop = 0;
        done.focus();
        if (mark) regPlay(mark, 120);
        form.reset();
        syncSchool();
      }).catch(function (e) {
        showError(err, (e && e.userMessage) || "Your registration didn't go through. Please check your connection and try again.");
        err.focus();
      }).then(function () {
        setBusy(btn, false);
      });
    });

    $('[data-form-again]', done).addEventListener('click', function () {
      done.hidden = true;
      wrap.hidden = false;
      dialog.scrollTop = 0;
      (form.elements.first_name || form.elements.name).focus();
    });
  }

  /* ---------- motion preference, live in both directions ---------- */
  function initMotionPrefs() {
    doc.classList.toggle('is-reduced', reduced);
    reduceMQ.addEventListener('change', function (e) {
      reduced = e.matches;
      doc.classList.toggle('is-reduced', reduced);
      if (reduced) {
        $$('.rv').forEach(function (n) { n.classList.add('in', 'settled'); });
        $$('.reg').forEach(regReset);
      }
      motionHooks.forEach(function (fn) { fn(); });
    });
    document.addEventListener('visibilitychange', function () {
      document.body.classList.toggle('paused', document.hidden);
    });
  }

  // every link to another site opens in a new tab, so visitors keep their place here; the markup
  // already says so, this keeps it true for any link added later without target="_blank"
  function initExternalLinks() {
    $$('a[href^="http"]').forEach(function (a) {
      if (a.host === location.host || a.target === '_blank') return;
      a.target = '_blank';
      a.rel = (a.rel + ' noopener noreferrer').trim();
    });
  }

  initExternalLinks();
  initMotionPrefs();
  initNav();
  initCountdown();
  initHero();
  initReveals();
  initRotator();
  initExperience();
  initInvite();
  initRunway();
  initGen();
  initFinale();
  initDialogs();
  initForms();
})();
