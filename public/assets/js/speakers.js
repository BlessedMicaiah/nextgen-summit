/* NextGen Summit — who's in the room.
   A row of speaker cards sliding left to right for ever, and one dialog that enlarges whichever
   card is chosen and turns it over.

   The runway is the one this section had before it was taken down: measure one set of cards,
   clone the set until the row is wider than the screen plus one whole set, then drive a single
   transform, x = -setW + (pos mod setW). Because the content repeats exactly every setW the wrap
   is invisible; there is no reset to see. Position lives in `pos`, so pausing is simply "stop
   adding to pos" and resuming carries on from the same place.

   Everything a card says comes from the data below, which comes from an authoritative source for
   that person. A speaker with no verified portrait has none here, and the card says so rather
   than standing something in. */
(function () {
  'use strict';

  if (window.__ngsSpeakers) return;
  window.__ngsSpeakers = true;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var run = $('[data-run]');
  var dlg = $('#speaker');
  if (!run || !dlg) return;

  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  /* ---------- the people ---------- */
  var PEOPLE = {
    tunde: {
      name: 'Tunde Onakoya',
      role: 'Founder, Chess in Slums Africa',
      bio: 'Teaches chess to children in Nigeria’s slum communities and uses the game to get them into school. He founded Chess in Slums Africa in 2018.',
      wins: ['Guinness World Record, longest chess marathon (2025)',
             'Founded Chess in Slums Africa (2018)']
    },
    kennedy: {
      name: 'Kennedy Ekezie',
      role: 'Co-founder and CEO, Kippa',
      bio: 'Builds financial tools for small businesses. Before Kippa he led TikTok’s expansion into Africa. Born in Lagos; has lived in Beijing, San Francisco and London.',
      wins: ['Forbes 30 Under 30 (2024)',
             'Co-founder and CEO of Kippa',
             'Led TikTok’s expansion into Africa'],
      link: { href: 'https://www.linkedin.com/in/kennedyekezie/', label: 'LinkedIn' }
    },
    tisha: {
      name: 'Tisha Edwards',
      role: 'President & CEO, Maryland Bankers Association',
      shot: { src: 'assets/img/speakers/tisha-edwards-820.jpg',
              srcset: 'assets/img/speakers/tisha-edwards-560.jpg 560w, assets/img/speakers/tisha-edwards-820.jpg 820w' },
      bio: 'Two decades across public service and the private sector. Previously interim chief executive of Baltimore City Public Schools, chief of staff to the Mayor of Baltimore, and Secretary of Appointments in the Moore–Miller administration.',
      wins: ['First Black woman to lead a state banking association (2025)',
             'Influential Marylander, The Daily Record (2025)',
             'Top 100 Women, The Daily Record (2024)'],
      link: { href: 'https://www.mdbankers.com/about-mba/meet-the-ceo/', label: 'Maryland Bankers Association' }
    }
  };

  /* ---------- the runway ---------- */
  var track = $('[data-run-track]', run);
  var originals = track ? $$('.spk', track) : [];
  var SPEED = 30;                                    // px a second: slow enough to read a name
  var hoverMQ = matchMedia('(hover:hover) and (pointer:fine)');
  var smallMQ = matchMedia('(max-width:760px)');
  var pos = 0, setW = 0, last = 0, raf = null, onScreen = false, held = 0;

  function speed() { return smallMQ.matches ? SPEED * 0.72 : SPEED; }
  function place() { if (setW) track.style.transform = 'translate3d(' + (-setW + pos).toFixed(2) + 'px,0,0)'; }

  function copyOf(li) {
    var c = li.cloneNode(true);
    c.classList.add('spk--copy');
    c.setAttribute('aria-hidden', 'true');           // the copies are decoration, announced once only
    $$('[id]', c).forEach(function (n) { n.removeAttribute('id'); });
    $$('button,a', c).forEach(function (n) { n.setAttribute('tabindex', '-1'); });
    return c;
  }

  function build() {
    $$('.spk--copy', track).forEach(function (n) { n.remove(); });
    if (reduce.matches) { track.style.transform = ''; return; }   // a static row: no copies at all
    var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    var w = 0;
    originals.forEach(function (li) { w += li.getBoundingClientRect().width + gap; });
    if (!w) return;
    setW = w;
    // one copy of the last card goes in front, so the originals start a card in from the left
    // edge and every one of them can be slid into view when it takes keyboard focus
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
  function tick() { if (raf === null && onScreen && !held && !reduce.matches) raf = requestAnimationFrame(frame); }
  function stop() { if (raf !== null) { cancelAnimationFrame(raf); raf = null; } last = 0; }
  function hold() { held++; stop(); }
  function release() { held = Math.max(0, held - 1); if (!held) { last = 0; tick(); } }

  // a card reached by keyboard may be off to one side, so slide the row to it rather than let
  // the browser scroll a clipped box, which would put the row out of step with its transform
  function reveal(card) {
    if (!setW) return;
    var L = card.offsetLeft, cw = card.offsetWidth, runW = run.clientWidth;
    var pad = Math.max(24, Math.min(96, runW * 0.07));
    var want = Math.min(pad - L, runW - pad - cw - L);
    pos = Math.max(-setW, Math.min(0, want)) + setW;
    place();
  }

  run.addEventListener('pointerenter', function () { if (hoverMQ.matches) hold(); });
  run.addEventListener('pointerleave', function () { if (hoverMQ.matches) release(); });
  run.addEventListener('focusin', function (e) {
    var li = e.target.closest ? e.target.closest('.spk') : null;
    hold();
    if (li) reveal(li);
  });
  run.addEventListener('focusout', function () { release(); });
  run.addEventListener('touchstart', function () { hold(); }, { passive: true });
  run.addEventListener('touchend', function () { setTimeout(release, 1800); }, { passive: true });

  new IntersectionObserver(function (es) {
    onScreen = es[0].isIntersecting;
    if (onScreen) tick(); else stop();               // nothing runs while the section is away
  }, { rootMargin: '10% 0px' }).observe(run);

  var rt = null;
  addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(build, 180); });
  reduce.addEventListener && reduce.addEventListener('change', function () { build(); tick(); });
  if (document.readyState === 'complete') build();
  else addEventListener('load', build, { once: true });
  build();

  /* ---------- the chosen card ---------- */
  var flip = $('[data-sp-flip]', dlg);
  var turn = $('[data-sp-turn]', dlg);
  var turnT = $('[data-sp-turn-t]', dlg);
  var opener = null;

  function fill(key) {
    var p = PEOPLE[key];
    if (!p) return false;
    $('[data-sp-name]', dlg).textContent = p.name;
    $('[data-sp-role]', dlg).textContent = p.role;
    $('[data-sp-bio]', dlg).textContent = p.bio;

    var shot = $('[data-sp-shot]', dlg);
    shot.textContent = '';
    if (p.shot) {
      var img = document.createElement('img');
      img.src = p.shot.src;
      if (p.shot.srcset) { img.srcset = p.shot.srcset; img.sizes = '(max-width:760px) 86vw, 420px'; }
      img.alt = p.name;
      img.decoding = 'async';
      shot.appendChild(img);
      shot.classList.remove('is-await');
    } else {
      var set = document.createElement('span');
      set.className = 'sp__set wm';
      set.textContent = p.name;
      shot.appendChild(set);
      var note = document.createElement('span');
      note.className = 'spk__await';
      note.textContent = 'Portrait to come';
      shot.appendChild(note);
      shot.classList.add('is-await');
    }

    var wins = $('[data-sp-wins]', dlg);
    wins.textContent = '';
    p.wins.forEach(function (w) {
      var li = document.createElement('li');
      li.textContent = w;
      wins.appendChild(li);
    });

    var link = $('[data-sp-link]', dlg);
    link.textContent = '';
    if (p.link) {
      var a = document.createElement('a');
      a.href = p.link.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = p.link.label;
      var sr = document.createElement('span');
      sr.className = 'sr';
      sr.textContent = ' (opens in a new tab)';
      a.appendChild(sr);
      link.appendChild(a);
      link.hidden = false;
    } else {
      link.hidden = true;
    }
    return true;
  }

  function face(back) {
    dlg.classList.toggle('is-back', back);
    turn.setAttribute('aria-pressed', String(back));
    turnT.textContent = back ? 'Back to the front' : 'Turn the card';
  }

  function open(btn) {
    if (!fill(btn.getAttribute('data-spk'))) return;
    opener = btn;
    face(false);
    hold();
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  function close() {
    if (dlg.open) dlg.close();
  }

  run.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-spk]') : null;
    if (btn) open(btn);
  });

  turn.addEventListener('click', function () { face(!dlg.classList.contains('is-back')); });
  $('[data-sp-close]', dlg).addEventListener('click', close);
  dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
  dlg.addEventListener('close', function () {
    face(false);
    release();
    if (opener && opener.isConnected) opener.focus();
    opener = null;
  });
})();
