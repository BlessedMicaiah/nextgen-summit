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

  /* ---------- smooth scrolling (Lenis) ----------
     Wheel and trackpad scrolling glide; touch keeps the phone's own native scroll (syncTouch is
     off by default). Lenis still moves the real window scroll position every frame, so every
     scroll listener on the site keeps working untouched. Off entirely for reduced motion. */
  var lenis = null;
  function initSmoothScroll() {
    function start() {
      if (lenis || reduced || typeof window.Lenis !== 'function') return;
      lenis = new window.Lenis({
        autoRaf: true,
        // drawers scroll on their own; the page behind them must not move
        prevent: function (node) { return !!(node && node.closest && node.closest('dialog')); }
      });
      if (document.querySelector('dialog[open]')) lenis.stop();
    }
    function end() {
      if (!lenis) return;
      lenis.destroy();
      lenis = null;
    }

    // same-page links glide too (scroll-padding-top keeps targets clear of the nav); a target
    // that takes focus, like <main> for the skip link, still receives it
    document.addEventListener('click', function (e) {
      if (!lenis || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest('a[href^="#"]');
      var id = a && a.getAttribute('href').slice(1);
      var target = id && document.getElementById(id);
      if (!target || target.tagName === 'DIALOG') return;
      e.preventDefault();
      lenis.scrollTo(target, { immediate: a.classList.contains('skip') });
      history.replaceState(null, '', '#' + id);
      if (target.hasAttribute('tabindex')) target.focus({ preventScroll: true });
    });

    // for other scripts (pitch.js): glide to an element when Lenis is running
    window.NGScrollTo = function (target) {
      if (!lenis) return false;
      lenis.scrollTo(target);
      return true;
    };

    start();
    onMotionChange(function () { if (reduced) end(); else start(); });
  }

  /* ---------- Motion ----------
     Motion's animate() and scroll() drive the drawers, the hero parallax and the ticket counter.
     If the library is missing, or motion is reduced, the CSS transitions underneath take over. */
  function motionOn() { return !reduced && !!window.Motion; }
  function initMotionClass() {
    doc.classList.toggle('has-motion', motionOn());
    onMotionChange(function () { doc.classList.toggle('has-motion', motionOn()); });
  }

  /* ---------- hero entrance ---------- */
  function initHero() {
    var hero = $('.hero');
    if (!hero) return;
    var img = $('.hero__img', hero);
    var mark = $('.hero__title .reg', hero);
    if (mark) buildReg(mark);
    initHeroParallax(hero);
    if (mark) initHeroMorph(hero, mark);
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

  // As the hero scrolls away the photograph drifts down at a slower pace than the page and the
  // words lift and fade. The photo only ever moves down, so the gap it opens at the top of the
  // hero is always above the screen. Scroll-linked through Motion, transform and opacity only.
  function initHeroParallax(hero) {
    var media = $('.hero__media', hero), inner = $('.hero__inner', hero);
    if (!media || !inner) return;
    var stops = [];
    function link(node, keyframes, times) {
      var anim = Motion.animate(node, keyframes, { ease: 'linear', times: times });
      var unlink = Motion.scroll(anim, { target: hero, offset: ['start start', 'end start'] });
      stops.push(function () { unlink(); anim.cancel(); });
    }
    function on() {
      if (stops.length || !motionOn()) return;
      link(media, { transform: ['translate3d(0,0,0)', 'translate3d(0,22%,0)'] });
      link(inner, { transform: ['translate3d(0,0,0)', 'translate3d(0,-48px,0)'] });
      // the words stay solid for the first stretch, so the buttons never read as disabled
      link(inner, { opacity: [1, 1, 0, 0] }, [0, 0.4, 0.85, 1]);
    }
    function off() {
      stops.forEach(function (stop) { stop(); });
      stops = [];
      [media, inner].forEach(function (n) { n.style.removeProperty('transform'); n.style.removeProperty('opacity'); });
    }
    on();
    onMotionChange(function () { if (reduced) off(); else on(); });
  }

  /* ---------- hero wordmark: jelly letters ----------
     Each letter of "nextgen" is a small soft body: a damped spring ties it to its place in the
     word, and it has its own velocity and spin. The pointer pushes nearby letters away, and a fast
     swipe throws them; letters stretch along the way they are moving and squash as they stop,
     lean into their motion, shove a neighbour they run into, then bounce home and jiggle out.
     Phones get one hop through the word after the opening animation, and a tap knocks the
     letters away from the finger. When everything is still the loop stops and every inline style
     is removed, so the word at rest is exactly the static text.

     A letter needs its own box to move, and separate boxes lose the font's kerning, so the kerned
     position of every letter is measured first and given back to it as a margin (in em, so it
     holds at every screen size): at rest the word sits exactly where it always did. */
  function initHeroMorph(hero, mark) {
    var word = $('.reg__k', mark);
    if (!word) return;
    var K = 170, C = 9.5;                               // spring home (1/s^2) and damping: under-damped, so it jiggles
    var KR = 150, CR = 9;                               // the same for the lean
    var letters = null, homes = [], fs = 1;
    var raf = null, last = 0, doneAt = 0, ptr = null, hopped = false;

    new MutationObserver(function () {
      if (!doneAt && mark.classList.contains('is-done')) { doneAt = performance.now(); setTimeout(hop, 650); }
    }).observe(mark, { attributes: true, attributeFilter: ['class'] });

    // the letters split only once the opening registration animation has finished with the word
    function ready() {
      if (!motionOn()) return false;
      if (mark.classList.contains('is-armed') && !(doneAt && performance.now() - doneAt > 600)) return false;
      if (!letters) split();
      return true;
    }
    function split() {
      fs = parseFloat(getComputedStyle(word).fontSize) || 1;
      var text = word.textContent;
      word.textContent = '';
      var spans = Array.prototype.map.call(text, function (ch) {
        var s = el('span', 'reg__l', ch);
        word.appendChild(s);
        return s;
      });
      var kerned = spans.map(function (s) { return s.getBoundingClientRect().left; });   // inline: kerning intact
      word.classList.add('is-jelly');                   // now each letter is its own box
      spans.forEach(function (s, i) {
        var shift = kerned[i] - s.getBoundingClientRect().left;
        if (Math.abs(shift) > 0.01) s.style.marginLeft = (shift / fs).toFixed(4) + 'em';
      });
      letters = spans.map(function (s) { return { el: s, x: 0, y: 0, vx: 0, vy: 0, r: 0, vr: 0, moving: false }; });
      measure();
    }
    // each letter's home centre, relative to the word's own box (layout, so transforms never skew it)
    function measure() {
      fs = parseFloat(getComputedStyle(word).fontSize) || 1;
      homes = letters.map(function (l) { return { x: l.el.offsetLeft + l.el.offsetWidth / 2, y: l.el.offsetTop + l.el.offsetHeight * 0.55, w: l.el.offsetWidth }; });
    }
    function local(e) {
      var r = word.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
    }

    /* ---- the simulation ---- */
    function step(dt) {
      var R = fs * 0.72, push = fs * 52, lean = 11 / fs, room = fs * 0.05;
      letters.forEach(function (l, i) {
        var h = homes[i];
        var ax = -K * l.x - C * l.vx, ay = -K * l.y - C * l.vy;
        if (ptr) {                                      // the pointer pushes letters out of its way
          var dx = h.x + l.x - ptr.x, dy = h.y + l.y - ptr.y, d = Math.hypot(dx, dy);
          if (d < R) {
            var f = push * Math.pow(1 - d / R, 2);
            ax += d > 1 ? f * dx / d : 0;
            ay += d > 1 ? f * dy / d : -f;
          }
        }
        l.ax = ax; l.ay = ay;
        l.ar = -KR * l.r - CR * l.vr + lean * l.vx;     // a letter leans into the way it is moving
      });
      for (var i = 0; i < letters.length - 1; i++) {    // a letter running into its neighbour shoves it
        var a = letters[i], b = letters[i + 1], over = (a.x - b.x) - room;
        if (over > 0) { a.ax -= over * 420; b.ax += over * 420; }
      }
      letters.forEach(function (l) {
        l.vx += l.ax * dt; l.vy += l.ay * dt; l.vr += l.ar * dt;
        l.x += l.vx * dt; l.y += l.vy * dt; l.r += l.vr * dt;
      });
    }
    function render() {
      var still = true;
      letters.forEach(function (l) {
        var speed = Math.hypot(l.vx, l.vy);
        var active = Math.abs(l.x) > 0.25 || Math.abs(l.y) > 0.25 || speed > 4 || Math.abs(l.r) > 0.002 || Math.abs(l.vr) > 0.02;
        if (!active) {
          if (l.moving) { l.moving = false; l.x = l.y = l.vx = l.vy = l.r = l.vr = 0; l.el.style.removeProperty('transform'); l.el.style.removeProperty('will-change'); }
          return;
        }
        still = false;
        if (!l.moving) { l.moving = true; l.el.style.willChange = 'transform'; }
        // stretch along the motion and thin across it (the volume stays the same), then lean
        var s = 1 + Math.min(0.34, speed / (fs * 8.5)), ang = Math.atan2(l.vy, l.vx);
        l.el.style.transform = 'translate3d(' + l.x.toFixed(2) + 'px,' + l.y.toFixed(2) + 'px,0) rotate(' + ang.toFixed(4) + 'rad) scale(' + s.toFixed(4) + ',' + (1 / s).toFixed(4) + ') rotate(' + (-ang + l.r).toFixed(4) + 'rad)';
      });
      return still;
    }
    function frame(t) {
      raf = null;
      if (!letters) return;
      var dt = last ? Math.min(1 / 30, (t - last) / 1000) : 1 / 60;
      last = t;
      for (var n = Math.max(1, Math.round(dt * 240)), k = 0; k < n; k++) step(dt / n);   // small fixed steps keep the springs stable
      var still = render();
      if (still && !ptr) { last = 0; return; }        // all home and no pointer: stop drawing altogether
      // a pointer resting over the word holds the letters aside; once they stop moving there is
      // nothing new to draw until the pointer moves again
      if (ptr && letters.every(function (l) { return Math.hypot(l.vx, l.vy) < 2 && Math.abs(l.vr) < 0.02; })) { last = 0; return; }
      raf = requestAnimationFrame(frame);
    }
    function wake() { if (raf === null && letters) { last = 0; raf = requestAnimationFrame(frame); } }

    /* ---- input ---- */
    // a moving pointer also throws the letters it passes through, harder the faster it goes
    function throwAt(p, vx, vy) {
      var R = fs * 0.72, cap = fs * 9;
      vx = clamp(vx, -cap, cap); vy = clamp(vy, -cap, cap);
      letters.forEach(function (l, i) {
        var d = Math.hypot(homes[i].x + l.x - p.x, homes[i].y + l.y - p.y);
        if (d < R) { var f = 0.32 * (1 - d / R); l.vx += vx * f; l.vy += vy * f; }
      });
    }
    function near(p) { var r = word.getBoundingClientRect(); return p.x > -fs * 0.6 && p.x < r.width + fs * 0.6 && p.y > -fs * 0.5 && p.y < r.height + fs * 0.5; }

    hero.addEventListener('pointermove', function (e) {
      if (!ready()) return;
      if (e.pointerType === 'touch' && !(e.buttons || e.pressure)) return;
      var p = local(e);
      if (!near(p)) { ptr = null; return; }
      if (ptr && p.t > ptr.t) throwAt(p, (p.x - ptr.x) / (p.t - ptr.t) * 1000, (p.y - ptr.y) / (p.t - ptr.t) * 1000);
      ptr = p;
      wake();
    });
    function lift() { ptr = null; wake(); }
    hero.addEventListener('pointerleave', lift);
    hero.addEventListener('pointerup', function (e) { if (e.pointerType === 'touch') lift(); });
    hero.addEventListener('pointercancel', lift);
    // a tap knocks the letters away from the finger, the nearest hardest
    hero.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch' || !ready()) return;
      var p = local(e);
      if (!near(p)) return;
      letters.forEach(function (l, i) {
        var dx = homes[i].x - p.x, dy = homes[i].y - p.y - fs * 0.25, d = Math.hypot(dx, dy) || 1;
        var f = fs * 5.2 * Math.exp(-Math.pow(d / (fs * 1.3), 2));
        l.vx += f * dx / d; l.vy += f * dy / d - f * 0.35;
      });
      wake();
    });

    // after the opening animation, one hop runs through the word, so every visitor sees it is alive
    function hop() {
      if (hopped || !ready()) return;
      hopped = true;
      letters.forEach(function (l, i) {
        setTimeout(function () { if (motionOn()) { l.vy -= fs * 2.6; l.vr += (i % 2 ? 1 : -1) * 0.9; wake(); } }, 120 + i * 75);
      });
    }

    var resizeT = null;
    addEventListener('resize', function () {
      if (!letters) return;
      clearTimeout(resizeT);
      resizeT = setTimeout(measure, 150);
    });

    onMotionChange(function () {
      if (motionOn() || !letters) return;
      if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
      ptr = null;
      letters.forEach(function (l) {
        l.x = l.y = l.vx = l.vy = l.r = l.vr = 0; l.moving = false;
        l.el.style.removeProperty('transform'); l.el.style.removeProperty('will-change');
      });
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
      return left;
    }
    // each tick lands just after the second turns over (a plain interval drifts and now and then skips one)
    function loop() {
      timer = null;
      if (tick() && visible && !document.hidden) timer = setTimeout(loop, 1000 - Date.now() % 1000 + 15);
    }
    function run() {                        // only ticks while the hero is on screen and the tab is open
      var on = visible && !document.hidden;
      if (on && !timer) loop();
      else if (!on && timer) { clearTimeout(timer); timer = null; }
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

    // --seam (site.css) is how far a photo section dissolves into the paper at each edge. It is
    // registered as a length so its computed value comes back in px, from the one definition in CSS.
    try { CSS.registerProperty({ name: '--seam', syntax: '<length>', inherits: true, initialValue: '0px' }); } catch (e) {}
    function seamOf(s) {
      var v = parseFloat(getComputedStyle(s).getPropertyValue('--seam'));
      return isNaN(v) ? 0 : v;
    }

    function update() {
      raf = null;
      var y = nav.offsetHeight / 2;
      var theme = 'paper';
      for (var i = 0; i < sections.length; i++) {
        var r = sections[i].getBoundingClientRect();
        if (r.top <= y && r.bottom > y) {
          var s = sections[i];
          var mode = s.getAttribute('data-nav');
          var photo = mode === 'photo' || (mode === 'xp' && s.classList.contains('is-lit'));
          // inside a fade the bar is still over paper; it turns white only where the photo is solid
          var seam = photo ? seamOf(s) : 0;
          theme = photo && y - r.top >= seam && r.bottom - y > seam ? 'photo' : 'paper';
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

  /* ---------- buttons: liquid morph ----------
     With a mouse, every .btn behaves like a drop of ink. The corners nearest the pointer swell
     toward round while the far ones stay crisp, the button leans a few pixels after the pointer
     (less for the smaller nav and form buttons),
     and a deeper turquoise floods in from where the pointer entered and drains out where it left.
     A press (mouse, touch, or Enter on the keyboard, all through Motion's press()) squashes
     it and lets it spring back. Reduced motion, or no Motion, leaves the plain CSS button. */
  function initButtonMorph() {
    var btns = $$('.btn:not(.btn--ghost)');            // outline buttons have no fill to flood
    if (!btns.length || !window.Motion || !Motion.hover || !Motion.press) return;
    var fineMQ = matchMedia('(hover:hover) and (pointer:fine)');
    var MORPH = { type: 'spring', visualDuration: 0.35, bounce: 0.3 };
    var SETTLE = { type: 'spring', visualDuration: 0.5, bounce: 0.45 };
    var FLOOD = { duration: 0.5, ease: [0.16, 1, 0.3, 1] };
    var LEAN_X = 6, LEAN_Y = 3;                         // px a big (58px) button follows the pointer

    function usable(btn) { return motionOn() && !btn.disabled; }

    function reset(btn) {
      btn.__morph = (btn.__morph || 0) + 1;            // any settle still running must not clean up later
      ['transform', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']
        .forEach(function (p) { btn.style.removeProperty(p); });
      btn.__ink.removeAttribute('style');
    }

    btns.forEach(function (btn) {
      if (btn.__ink) return;
      btn.__ink = el('span', 'btn__ink', null, true);
      btn.insertBefore(btn.__ink, btn.firstChild);
      var target = null, raf = null, round = 29, lean = 1;
      var base = parseFloat(getComputedStyle(btn).borderTopLeftRadius) || 8;   // read before any inline shape

      // corner radii from where the pointer sits: (u, v) run 0..1 across the button. Each corner is
      // its own property, so Motion springs four plain lengths rather than one shorthand string.
      function morph() {
        raf = null;
        if (!target || !usable(btn)) return;
        var u = target.u, v = target.v;
        function corner(cx, cy) {
          var k = 1 - Math.min(1, Math.hypot(u - cx, v - cy) / 1.1);
          return (base + (round - base) * k * k).toFixed(1) + 'px';
        }
        Motion.animate(btn, {
          x: (u - 0.5) * 2 * LEAN_X * lean,
          y: (v - 0.5) * 2 * LEAN_Y * lean,
          borderTopLeftRadius: corner(0, 0),
          borderTopRightRadius: corner(1, 0),
          borderBottomRightRadius: corner(1, 1),
          borderBottomLeftRadius: corner(0, 1)
        }, MORPH);
      }
      function track(e) {
        var r = btn.getBoundingClientRect();
        target = { u: clamp((e.clientX - r.left) / r.width, 0, 1), v: clamp((e.clientY - r.top) / r.height, 0, 1) };
        if (raf === null) raf = requestAnimationFrame(morph);
      }

      Motion.hover(btn, function (_, start) {
        if (!fineMQ.matches || !usable(btn)) return;
        var token = btn.__morph = (btn.__morph || 0) + 1;
        var r = btn.getBoundingClientRect();         // measured on every entry: widths change with the screen
        round = r.height / 2;
        lean = Math.min(1, r.height / 58);
        var x = start.clientX - r.left, y = start.clientY - r.top;
        var R = Math.ceil(Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y)));
        var ink = btn.__ink;
        ink.style.cssText = 'width:' + 2 * R + 'px;height:' + 2 * R + 'px;left:' + (x - R) + 'px;top:' + (y - R) + 'px';
        Motion.animate(ink, { transform: ['scale(0)', 'scale(1)'] }, FLOOD);
        track(start);
        btn.addEventListener('pointermove', track);

        return function (end) {
          btn.removeEventListener('pointermove', track);
          target = null;
          if (btn.__morph !== token) return;
          // the flood drains toward the point the pointer left from
          var ir = ink.getBoundingClientRect();
          ink.style.transformOrigin = (end.clientX - ir.left) + 'px ' + (end.clientY - ir.top) + 'px';
          Motion.animate(ink, { transform: 'scale(0)' }, { duration: 0.4, ease: [0.65, 0, 0.35, 1] });
          var b = base + 'px';
          Motion.animate(btn, { x: 0, y: 0, borderTopLeftRadius: b, borderTopRightRadius: b, borderBottomRightRadius: b, borderBottomLeftRadius: b }, SETTLE).then(function () {
            if (btn.__morph === token) reset(btn);     // hand the shape back to the stylesheet
          });
        };
      });

      Motion.press(btn, function () {
        if (!usable(btn)) return;
        Motion.animate(btn, { scaleX: 1.04, scaleY: 0.92 }, { type: 'spring', visualDuration: 0.18, bounce: 0 });
        return function () {
          Motion.animate(btn, { scaleX: 1, scaleY: 1 }, SETTLE);
        };
      });
    });

    onMotionChange(function () { if (reduced) btns.forEach(reset); });
  }

  /* ---------- FAQ: the morphing thread ----------
     The buttons are drops of ink; the FAQ is a thread. One turquoise rail marks the open question,
     and when another opens it stretches across both, like a drop pulling apart, before letting go
     of the old one. The answer springs open and shut in every browser (the CSS height transition
     needs interpolate-size, which only Chromium has), its text comes into focus out of a blur, and
     the plus twists as it becomes a minus. Motion takes over the one-open-at-a-time rule from
     <details name>, so the closing answer can animate too; with Motion off, the native accordion
     and its CSS come back untouched. */
  function initFaq() {
    var faq = $('.faq');
    if (!faq || !window.Motion) return;
    var items = $$('details', faq);
    if (!items.length) return;
    var group = items[0].getAttribute('name');
    var rail = el('span', 'faq__rail', null, true);
    faq.appendChild(rail);
    var OPEN = { type: 'spring', visualDuration: 0.45, bounce: 0.2 };
    var CLOSE = { type: 'spring', visualDuration: 0.32, bounce: 0 };
    var TWIST = { type: 'spring', visualDuration: 0.5, bounce: 0.4 };
    var railAt = null, railToken = 0, railBusy = false; // where the rail sits: { top, h }, relative to .faq

    function parts(d) { return { a: $('.faq__a', d), plus: $('.faq__plus', d), sum: $('summary', d) }; }
    function kids(a) { return Array.prototype.slice.call(a.children); }
    function clear(d) {
      var p = parts(d);
      ['height', 'padding-bottom', 'overflow'].forEach(function (k) { p.a.style.removeProperty(k); });
      kids(p.a).forEach(function (k) { ['opacity', 'filter', 'transform'].forEach(function (s) { k.style.removeProperty(s); }); });
    }

    // returns the answer's full height, so the rail knows where the item will end
    function expand(d) {
      var p = parts(d), token = d.__anim = (d.__anim || 0) + 1;
      var from = d.open ? p.a.offsetHeight : 0;       // reopened mid-close: carry on from there
      d.__state = 'open';
      d.open = true;
      clear(d);
      var full = p.a.offsetHeight, pad = getComputedStyle(p.a).paddingBottom;
      p.a.style.overflow = 'hidden';
      Motion.animate(p.a, { height: [from + 'px', full + 'px'], paddingBottom: [from ? pad : '0px', pad] }, OPEN).then(function () {
        if (d.__anim === token) ['height', 'padding-bottom', 'overflow'].forEach(function (k) { p.a.style.removeProperty(k); });
      });
      Motion.animate(kids(p.a), { opacity: [0, 1], filter: ['blur(8px)', 'blur(0px)'], y: [10, 0] }, { duration: 0.5, delay: 0.06, ease: [0.16, 1, 0.3, 1] }).then(function () {
        // a leftover filter, even blur(0), can soften text in some browsers
        if (d.__anim === token) kids(p.a).forEach(function (k) { ['opacity', 'filter', 'transform'].forEach(function (s) { k.style.removeProperty(s); }); });
      });
      Motion.animate(p.plus, { rotate: 180 }, TWIST);
      return full;
    }

    // returns the answer's current height, which is what the items below it are about to lose
    function collapse(d) {
      var p = parts(d), token = d.__anim = (d.__anim || 0) + 1;
      var now = p.a.offsetHeight;
      d.__state = 'closed';
      p.a.style.overflow = 'hidden';
      Motion.animate(kids(p.a), { opacity: 0, filter: 'blur(4px)' }, { duration: 0.18 });
      Motion.animate(p.a, { height: '0px', paddingBottom: '0px' }, CLOSE).then(function () {
        if (d.__anim !== token) return;
        d.open = false;
        clear(d);
      });
      Motion.animate(p.plus, { rotate: 0 }, TWIST);
      return now;
    }

    function placeRail(top, h, opacity) {
      railAt = h > 0 ? { top: top, h: h } : null;
      rail.style.top = top + 'px';
      rail.style.height = h + 'px';
      rail.style.opacity = opacity;
    }

    // rail to (top, h): grow out of the question if nothing was marked, otherwise stretch across
    // both places first and then contract onto the new one
    function railTo(top, h) {
      var token = ++railToken, from = railAt, anim;
      railAt = h > 0 ? { top: top, h: h } : null;
      if (h <= 0) {
        if (!from) { railBusy = false; return; }
        anim = Motion.animate(rail, { top: [from.top + 'px', top + 'px'], height: [from.h + 'px', '0px'], opacity: [1, 0] }, CLOSE);
      } else if (!from) {
        anim = Motion.animate(rail, { top: [top + 22 + 'px', top + 'px'], height: ['0px', h + 'px'], opacity: [0, 1] }, OPEN);
      } else {
        var lo = Math.min(from.top, top), hi = Math.max(from.top + from.h, top + h);
        anim = Motion.animate(rail, {
          top: [from.top + 'px', lo + 'px', top + 'px'],
          height: [from.h + 'px', hi - lo + 'px', h + 'px'],
          opacity: [1, 1, 1]
        }, { duration: 0.7, times: [0, 0.42, 1], ease: [[0.65, 0, 0.35, 1], [0.16, 1, 0.3, 1]] });
      }
      railBusy = true;
      anim.then(function () { if (token === railToken) { railBusy = false; placeRail(top, h, h > 0 ? 1 : 0); } });
    }

    function toggle(d) {
      var sumH = parts(d).sum.offsetHeight;
      if (d.__state === 'open') {
        collapse(d);
        railTo(d.offsetTop + sumH / 2, 0);
        return;
      }
      var prev = items.filter(function (x) { return x !== d && x.__state === 'open'; })[0];
      var lost = prev ? collapse(prev) : 0;
      var full = expand(d);
      // where this item will sit once the other answer has folded away above it
      var top = d.offsetTop - (prev && prev.offsetTop < d.offsetTop ? lost : 0);
      railTo(top, sumH + full);
    }

    items.forEach(function (d) {
      d.__state = d.open ? 'open' : 'closed';
      parts(d).sum.addEventListener('click', function (e) {
        if (!motionOn()) return;
        e.preventDefault();
        toggle(d);
      });
      // opened by the browser itself (find in page): keep one open and the rail on it
      d.addEventListener('toggle', function () {
        if (!motionOn() || !d.open || d.__state === 'open') return;
        items.forEach(function (x) { if (x !== d && x.open) { x.__anim = (x.__anim || 0) + 1; x.__state = 'closed'; x.open = false; clear(x); } });
        d.__state = 'open';
        placeRail(d.offsetTop, d.offsetHeight - 1, 1);
      });
    });

    // the drawer can change width, which changes how tall an open answer is
    new ResizeObserver(function () {
      var d = items.filter(function (x) { return x.__state === 'open'; })[0];
      if (d && railAt && !railBusy && !parts(d).a.style.height) placeRail(d.offsetTop, d.offsetHeight - 1, 1);
    }).observe(faq);

    function sync() {
      items.forEach(function (d) {
        if (motionOn()) d.removeAttribute('name');
        else {
          if (group) d.setAttribute('name', group);
          d.__anim = (d.__anim || 0) + 1;
          if (d.__state === 'closed') d.open = false;
          d.__state = d.open ? 'open' : 'closed';
          clear(d);
          parts(d).plus.style.removeProperty('transform');
        }
      });
      if (!motionOn()) { railToken++; railBusy = false; railAt = null; rail.removeAttribute('style'); }
    }
    sync();
    onMotionChange(sync);
  }

  /* ---------- FAQ: questions that roll from ink to turquoise ----------
     Every letter of a question sits in its own little window with a turquoise twin waiting just
     below it. On hover the letters roll up, ink out of the top and turquoise in from below, one
     after another, rippling out from the letter the pointer came in on and landing with a small
     spring; leaving rolls them back down, rippling from the letter it left from. Keyboard focus
     rolls the question the same way, from its first letter.
     A question is split into letters the first time it is reached, with the font's kerning
     measured and given back to each letter, so at rest the text sits exactly where it did. The
     roll itself is a CSS transition: site.js only sets each letter's delay and the class. */
  function initFaqText() {
    var sums = $$('.faq summary');
    if (!sums.length) return;
    var fineMQ = matchMedia('(hover:hover) and (pointer:fine)');
    var STAGGER = 16;                                   // ms between neighbouring letters

    function split(sum) {
      if (sum.__q) return sum.__q;
      var text = sum.firstChild;
      if (!text || text.nodeType !== 3 || !text.textContent.trim()) return null;
      var q = el('span', 'faq__q');
      sum.insertBefore(q, text);
      sum.removeChild(text);
      var letters = [];
      text.textContent.trim().split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { q.appendChild(document.createTextNode(' ')); return; }
        var w = el('span', 'faq__w');                   // a word never breaks inside
        q.appendChild(w);
        Array.prototype.forEach.call(part, function (ch) {
          var s = el('span', 'faq__l', ch);
          w.appendChild(s);
          letters.push(s);
        });
      });
      var fs = parseFloat(getComputedStyle(q).fontSize) || 16;
      var kerned = letters.map(function (s) { return s.getBoundingClientRect().left; });
      q.classList.add('is-split');                      // each letter is its own box now: give the kerning back
      letters.forEach(function (s, i) {
        var shift = kerned[i] - s.getBoundingClientRect().left;
        if (Math.abs(shift) > 0.01) s.style.marginLeft = (shift / fs).toFixed(4) + 'em';
        // the window's contents: the letter, and its turquoise twin underneath (hidden from
        // screen readers and from copying, so the question still reads and copies once)
        var ch = s.textContent;
        s.textContent = '';
        var roll = el('span', 'faq__r', ch);
        var twin = el('span', 'faq__t', ch, true);
        roll.appendChild(twin);
        s.appendChild(roll);
      });
      sum.__q = letters;
      return letters;
    }
    // the ripple: each letter waits in proportion to how far it is from where the pointer crossed
    function stagger(letters, x, y) {
      var near = 0, best = Infinity;
      var boxes = letters.map(function (s) { return s.getBoundingClientRect(); });
      boxes.forEach(function (r, i) {
        var d = Math.hypot(r.left + r.width / 2 - x, (r.top + r.height / 2 - y) * 2);
        if (d < best) { best = d; near = i; }
      });
      letters.forEach(function (s, i) { s.style.setProperty('--d', Math.abs(i - near) * STAGGER + 'ms'); });
    }
    function roll(sum, on, x, y) {
      if (!motionOn()) return;
      var letters = split(sum);
      if (!letters) return;
      stagger(letters, x, y);
      sum.classList.toggle('is-rolled', on);
    }

    sums.forEach(function (sum) {
      sum.addEventListener('pointerenter', function (e) {
        if (e.pointerType === 'mouse' && fineMQ.matches) roll(sum, true, e.clientX, e.clientY);
      });
      sum.addEventListener('pointerleave', function (e) {
        if (sum.classList.contains('is-rolled') && sum !== document.activeElement) roll(sum, false, e.clientX, e.clientY);
      });
      sum.addEventListener('focus', function () {
        if (!sum.matches(':focus-visible')) return;
        var r = sum.getBoundingClientRect();
        roll(sum, true, r.left, r.top + r.height / 2);
      });
      sum.addEventListener('blur', function () {
        if (!sum.classList.contains('is-rolled') || sum.matches(':hover')) return;
        var r = sum.getBoundingClientRect();
        roll(sum, false, r.left, r.top + r.height / 2);
      });
    });

    onMotionChange(function () {
      if (!motionOn()) sums.forEach(function (sum) { sum.classList.remove('is-rolled'); });
    });
  }

  /* ---------- utilities: drawers ---------- */
  // With Motion the panel slides in and back out on a spring with no overshoot, and the backdrop
  // fades through --bd (the ::backdrop reads it from its dialog). Every way of closing (the close
  // button, Escape, a click on the backdrop) plays the exit before the dialog actually closes.
  // Without Motion, the CSS slide in site.css does the work and close() is immediate.
  var DRAWER_IN = { type: 'spring', bounce: 0, visualDuration: 0.5 };
  var DRAWER_OUT = { type: 'spring', bounce: 0, visualDuration: 0.34 };

  function dismiss(d) {
    if (!d.open || d.__closing) return;
    if (!motionOn()) { d.close(); return; }
    d.__closing = true;
    Promise.all([
      Motion.animate(d, { transform: 'translate3d(100%,0,0)' }, DRAWER_OUT),
      Motion.animate(d, { '--bd': 0 }, { duration: 0.3, ease: 'easeOut' })
    ]).then(function () { if (d.__closing) d.close(); });
  }

  function initDialogs() {
    var dialogs = {};
    $$('dialog.drawer').forEach(function (d) {
      dialogs[d.id] = d;
      d.addEventListener('click', function (e) { if (e.target === d) dismiss(d); });
      // browsers close a modal dialog on Escape themselves; this covers the non-modal fallback too
      d.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); dismiss(d); } });
      d.addEventListener('cancel', function (e) { e.preventDefault(); dismiss(d); });
      d.addEventListener('close', function () {
        if (d.open) return;                 // already opened again before this event arrived
        d.__closing = false;
        d.style.removeProperty('transform');
        d.style.removeProperty('--bd');
        if (lenis && !document.querySelector('dialog[open]')) lenis.start();
        if (location.hash === '#' + d.id) history.replaceState(null, '', location.pathname + location.search);
      });
    });

    function open(id) {
      var d = dialogs[id];
      if (!d) return;
      // switching from one drawer to another: the old one goes at once, the new one slides in
      Object.keys(dialogs).forEach(function (k) { if (k !== id && dialogs[k].open) dialogs[k].close(); });
      if (d.__closing) { d.__closing = false; d.close(); }   // reopened mid-exit: the exit must not close it again
      if (!d.open) {
        if (lenis) lenis.stop();
        if (typeof d.showModal === 'function') d.showModal();
        else d.setAttribute('open', '');
        if (motionOn()) {
          Motion.animate(d, { transform: ['translate3d(100%,0,0)', 'translate3d(0%,0,0)'] }, DRAWER_IN);
          Motion.animate(d, { '--bd': [0, 1] }, { duration: 0.45, ease: 'easeOut' });
        }
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
        if (d) dismiss(d);
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
  initMotionClass();
  initSmoothScroll();
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
  initButtonMorph();
  initFaq();
  initFaqText();
  initDialogs();
  initForms();
})();
