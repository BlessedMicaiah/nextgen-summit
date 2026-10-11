/* NextGen Summit — who's in the room.
   Three states. A portrait-led card on a slow runway; the collectible, enlarged, when one is
   chosen; and its reverse, with the credentials, when it is turned over.

   The runway is the one this section had before it was taken down: measure one set of cards,
   clone the set until the row is wider than the screen plus one whole set, then drive a single
   transform, x = -setW + (pos mod setW). Because the content repeats exactly every setW the wrap
   is invisible; there is no reset to see. Position lives in `pos`, so pausing is simply "stop
   adding to pos" and resuming carries on from the same place.

   Every line a card says is written here, as text, so it can be corrected without touching a
   picture. Each line comes from an authoritative source for that person. */
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

  /* ---------- the people ----------
     `wins` is the credential list on the back: a label and the thing itself. `icon` picks one
     of the outlines below. `link` is only ever a profile we have actually seen. */
  var PEOPLE = {
    tunde: {
      first: 'Tunde', last: 'Onakoya',
      role: 'National Master <span aria-hidden="true">&middot;</span> Founder, Chess in Slums Africa',
      roleFlat: 'National Master, Founder of Chess in Slums Africa',
      shot: 'tunde-onakoya',
      wins: [
        { k: '2018', v: 'Founded Chess in Slums Africa', icon: 'people' },
        { k: 'Chess', v: 'Nigerian National Master', icon: 'board' },
        { k: 'April 2025', v: 'Guinness World Record, longest chess marathon: 64 hours with Shawn Martinez', icon: 'cup' },
        { k: 'Impact', v: 'Education and youth empowerment through chess', icon: 'book' }
      ],
      link: 'https://www.linkedin.com/in/tunde-onakoya'
    },
    tisha: {
      first: 'Tisha', last: 'Edwards',
      role: 'President &amp; CEO <span aria-hidden="true">&middot;</span> Maryland Bankers Association',
      roleFlat: 'President and CEO, Maryland Bankers Association',
      suffix: 'Tisha Edwards, MSW, JD',
      shot: 'tisha-edwards',
      wins: [
        { k: '2025', v: 'President &amp; CEO, Maryland Bankers Association', icon: 'case' },
        { k: '2025', v: 'Joined the University System of Maryland Board of Regents', icon: 'cap' },
        { k: 'Public service', v: 'Former Maryland Secretary of Appointments', icon: 'people' },
        { k: 'Education', v: 'Former Interim CEO, Baltimore City Public Schools', icon: 'book' }
      ],
      link: 'https://www.linkedin.com/in/tisha-edwards'
    },
    kennedy: {
      first: 'Kennedy', last: 'Ekezie',
      role: 'Technology entrepreneur',
      roleFlat: 'Technology entrepreneur',
      shot: 'kennedy-ekezie',
      wins: [
        { k: 'Recognition', v: 'Forbes 30 Under 30', icon: 'cup' },
        { k: 'Building', v: 'Technology entrepreneur', icon: 'case' }
      ],
      pending: 'Fuller credentials are being confirmed and will be added here.'
    }
  };

  var ICON = {
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.1"/><path d="M3.2 19a5.8 5.8 0 0 1 11.6 0"/><path d="M16.5 8.2a2.6 2.6 0 1 0 0-.2M17 13.4A4.9 4.9 0 0 1 20.8 18"/></svg>',
    board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3.6" y="3.6" width="16.8" height="16.8" rx="1.6"/><path d="M3.6 9.2h16.8M3.6 14.8h16.8M9.2 3.6v16.8M14.8 3.6v16.8"/></svg>',
    cup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 5.5H5A2.2 2.2 0 0 0 7.5 9M16.5 5.5H19A2.2 2.2 0 0 1 16.5 9"/><path d="M12 13.5V17M9 20h6"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.6S10.4 4.8 4.8 4.8v12.6c5.6 0 7.2 1.8 7.2 1.8s1.6-1.8 7.2-1.8V4.8C13.6 4.8 12 6.6 12 6.6z"/><path d="M12 6.6v12.6"/></svg>',
    case: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3.2" y="7.2" width="17.6" height="12.4" rx="1.8"/><path d="M8.8 7.2V5.6a1.6 1.6 0 0 1 1.6-1.6h3.2a1.6 1.6 0 0 1 1.6 1.6v1.6M3.2 12.4h17.6"/></svg>',
    cap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.4 21.2 9 12 13.6 2.8 9z"/><path d="M6.4 11v4.6c0 1.4 2.5 2.6 5.6 2.6s5.6-1.2 5.6-2.6V11"/></svg>'
  };

  /* ---------- the runway ---------- */
  var track = $('[data-run-track]', run);
  var originals = track ? $$('.spk', track) : [];
  var SPEED = 30;                                    // px a second: slow enough to read a name
  var hoverMQ = matchMedia('(hover:hover) and (pointer:fine)');
  var smallMQ = matchMedia('(max-width:760px)');
  var pos = 0, setW = 0, last = 0, raf = null, onScreen = false;

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
    if (!w || originals[0].parentNode !== track) return;
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
  var why = { pointer: false, focus: false, dialog: false };
  function stopped() { return why.pointer || why.focus || why.dialog; }
  function tick() { if (raf === null && onScreen && !stopped() && !reduce.matches) raf = requestAnimationFrame(frame); }
  function stop() { if (raf !== null) { cancelAnimationFrame(raf); raf = null; } last = 0; }
  function hold(k) { why[k] = true; stop(); }
  function release(k) { why[k] = false; if (!stopped()) { last = 0; tick(); } }

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

  run.addEventListener('pointerenter', function () { if (hoverMQ.matches) hold('pointer'); });
  run.addEventListener('pointerleave', function () { if (hoverMQ.matches) release('pointer'); });
  run.addEventListener('focusin', function (e) {
    var li = e.target.closest ? e.target.closest('.spk') : null;
    hold('focus');
    if (li) reveal(li);
  });
  run.addEventListener('focusout', function () { release('focus'); });
  run.addEventListener('touchstart', function () { hold('pointer'); }, { passive: true });
  run.addEventListener('touchend', function () { setTimeout(function () { release('pointer'); }, 1800); }, { passive: true });

  new IntersectionObserver(function (es) {
    onScreen = es[0].isIntersecting;
    if (onScreen) tick(); else stop();               // nothing runs while the section is away
  }, { rootMargin: '10% 0px' }).observe(run);

  var rt = null;
  addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(build, 180); });
  if (reduce.addEventListener) reduce.addEventListener('change', function () { build(); tick(); });
  addEventListener('load', build, { once: true });
  build();

  /* ---------- the collectible ---------- */
  var front = $('[data-sp-front]', dlg);
  var back = $('[data-sp-back]', dlg);
  var opener = null;

  function shotTag(key, cls, alt) {
    var p = PEOPLE[key];
    return '<img class="' + cls + '" src="assets/img/speakers/' + p.shot + '-620.jpg"' +
      ' srcset="assets/img/speakers/' + p.shot + '-620.jpg 620w, assets/img/speakers/' + p.shot + '-900.jpg 900w"' +
      ' sizes="(max-width:560px) 94vw, 430px" width="900" height="1260" decoding="async" alt="' + alt + '">';
  }

  function paint(key) {
    var p = PEOPLE[key];
    if (!p) return false;
    var full = p.suffix || (p.first + ' ' + p.last);

    front.innerHTML =
      '<div class="sp__pane">' +
        '<div class="sp__top">' +
          '<p class="sp__wm wm">nextgen<small>Summit</small></p>' +
          '<p class="sp__when">Friday<b>Oct 30</b>Maryland</p>' +
        '</div>' +
        '<p class="sp__say" aria-hidden="true"><i></i><span>See what&rsquo;s possible.</span></p>' +
        '<span class="sp__shot">' + shotTag(key, '', full) + '</span>' +
        '<div class="sp__id">' +
          '<p class="sp__tag">Speaker</p>' +
          '<h3 class="sp__name" id="sp-name">' + p.first + '<b>' + p.last + '</b></h3>' +
          '<p class="sp__role">' + p.role + '</p>' +
          '<p class="sp__bar"><small>NextGen Summit</small>' +
            '<button class="sp__turn" type="button" data-sp-turn>Flip for<br>highlights' +
              '<i aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15M13 6l6 6-6 6"/></svg></i>' +
            '</button>' +
          '</p>' +
        '</div>' +
      '</div>';

    var rows = p.wins.map(function (w) {
      return '<li><span class="sp__ico" aria-hidden="true">' + (ICON[w.icon] || ICON.cup) + '</span>' +
        '<span><span class="sp__wk">' + w.k + '</span><span class="sp__wv">' + w.v + '</span></span></li>';
    }).join('');

    var act = '<p class="sp__act">';
    if (p.link) {
      act += '<a class="sp__li" href="' + p.link + '" target="_blank" rel="noopener noreferrer">' +
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.98 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3 9h4v12H3zM9.5 9h3.8v1.7h.05c.53-.95 1.83-1.95 3.76-1.95 4.02 0 4.76 2.5 4.76 5.76V21h-4v-5.5c0-1.31-.02-3-1.9-3-1.9 0-2.19 1.42-2.19 2.9V21h-4z"/></svg>' +
        'View LinkedIn</a>';
    }
    act += '<button class="sp__turn" type="button" data-sp-turn>Back to<br>front' +
      '<i aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H5M11 6l-6 6 6 6"/></svg></i></button></p>';

    back.innerHTML =
      '<div class="sp__pane sp__bpane">' +
        '<div class="sp__bhead">' +
          '<div>' +
            '<p class="sp__wm wm">nextgen<small>Summit</small></p>' +
            '<h3 class="sp__bname">' + p.first + '<b>' + p.last + '</b></h3>' +
            '<p class="sp__brole">' + p.role + '</p>' +
            '<span class="sp__rule" aria-hidden="true"></span>' +
          '</div>' +
          '<span class="sp__thumb">' + shotTag(key, '', '') + '</span>' +
        '</div>' +
        '<ul class="sp__wins">' + rows + '</ul>' +
        (p.pending ? '<p class="sp__brole" style="margin-top:12px">' + p.pending + '</p>' : '') +
        act +
      '</div>';

    dlg.setAttribute('aria-label', full + ', speaker');
    return true;
  }

  function face(isBack) {
    dlg.classList.toggle('is-back', isBack);
    front.setAttribute('aria-hidden', String(isBack));
    back.setAttribute('aria-hidden', String(!isBack));
    $$('a,button', isBack ? front : back).forEach(function (n) { n.setAttribute('tabindex', '-1'); });
    $$('a,button', isBack ? back : front).forEach(function (n) { n.removeAttribute('tabindex'); });
  }

  function open(btn) {
    if (!paint(btn.getAttribute('data-spk'))) return;
    opener = btn;
    face(false);                                     // every opening starts on the front
    hold('dialog');
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  function close() { if (dlg.open) dlg.close(); }

  run.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-spk]') : null;
    if (btn) open(btn);
  });

  dlg.addEventListener('click', function (e) {
    if (e.target.closest('[data-sp-turn]')) { face(!dlg.classList.contains('is-back')); return; }
    if (e.target.closest('[data-sp-close]')) { close(); return; }
    // the backdrop is anything outside the card itself
    if (!e.target.closest('.sp__in')) close();
  });

  dlg.addEventListener('close', function () {
    face(false);                                     // reset for the next one
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
    // the focus we just restored is ours, not the visitor tabbing in, so it does not hold the row
    why.focus = false;
    release('dialog');
  });
})();
