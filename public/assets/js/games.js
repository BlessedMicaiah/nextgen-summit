/* ============================================================================
   NEXTGEN GAMES — NEXTGEN VENTURE
   The NG$10,000 Founder Challenge

   One page, four panels: sign in, the room, review, and the portfolio you end up with.
   Nothing here navigates away, because navigating away from a wallet you have not locked
   in yet is how people lose their game.

   WHAT THIS FILE IS NOT ALLOWED TO DECIDE

   Nothing that matters. The wallet is checked here so the screen can answer instantly, and
   checked again on the server, which is the one that counts: /api/ng-games.php re-reads
   every amount, every founder id and the budget before it writes anything, and will not
   accept a portfolio twice. If the two ever disagree, the server is right and this file is
   a bug.

   WHERE THE FACES AND THE WORDS COME FROM

   Every founder is their own photograph -- the square story crop the People's Choice page
   already shows -- read from window.NGS_FOUNDERS along with their description, film and
   logo, joined by entrant id. There is no artwork of any kind inside the game: no cartoon,
   no illustration, no hero image. Nothing about a founder is written in this file, so
   nothing about a founder can be invented in it.

   NG$ IS NOT MONEY. It is never called dollars, never formatted as currency, and buys
   nothing. It is a way of saying who you would back.
   ============================================================================ */
(function () {
  'use strict';

  var API = '/api/ng-games.php';
  var BUDGET = 10000;
  var CHIPS = [500, 1000, 2500, 5000];
  var MOVE_CHIPS = [500, 1000, 2500];

  /* The ten, in the running order for the live show. The tints are the game's own palette,
     chosen so no two neighbours clash; they are not taken from anybody's logo. */
  var FOUNDERS = [
    { id: 'f01', entrant: 'entrant-01', name: 'Caleb Orji',                   company: 'Haptol Labs',           tint: '#00A3E6' },
    { id: 'f02', entrant: 'entrant-03', name: 'Muyiwa Ogunsola',              company: 'Sooz',                  tint: '#1FC7BE' },
    { id: 'f03', entrant: 'entrant-06', name: 'Velma Funebe',                 company: 'iBraid',                tint: '#EC008C' },
    { id: 'f04', entrant: 'entrant-07', name: 'Divine Ayomide Fiolu',         company: 'BeforeKeys LLC',        tint: '#A77BE8' },
    { id: 'f05', entrant: 'entrant-05', name: 'Ethan Edouard',                company: 'Lookbook',              tint: '#8FD14F' },
    { id: 'f06', entrant: 'entrant-02', name: 'Annrita Karu',                 company: 'Credible blossom',      tint: '#FFC53D' },
    { id: 'f07', entrant: 'entrant-14', name: 'Kate Mina Lin',                company: 'K8Culture Productions', tint: '#7A8CFF' },
    { id: 'f08', entrant: 'entrant-12', name: 'Joyson BaLisamore',            company: "Jay's Watermelonade",   tint: '#FF6B5A' },
    { id: 'f09', entrant: 'entrant-04', name: 'Ariel Laura Métayer',     company: 'The Luminous Lab',      tint: '#F2A1C8' },
    { id: 'f10', entrant: 'entrant-13', name: 'Ugochinyere Blessing Okogeri', company: 'Offguardz',             tint: '#00C27A' }
  ];

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var reduced = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

  /* ---------------------------------------------------------------- state */
  var S = {
    open: true, revealed: false, signedIn: false, submitted: false,
    mailReady: true, demoAllowed: false, demo: false,
    mask: '', draft: {}, portfolio: null
  };
  var email = '';              /* only while signing in; never stored anywhere */
  var arrive = false;          /* should the ten roll in the next time the room is drawn */
  var sheetFor = null;
  var moveAmt = 1000;
  var pending = null;          /* the amount chosen in the panel, not yet confirmed */
  var factAt = 0, factTimer = null, factHold = 0;
  var saveTimer = null;
  var shown = { cap: 0, inv: 0, left: 0 };     /* what the wallet currently reads, for the tween */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function ngd(n) { return 'NG$' + Number(n || 0).toLocaleString('en-US'); }
  function invested() {
    var t = 0;
    for (var k in S.draft) if (Object.prototype.hasOwnProperty.call(S.draft, k)) t += S.draft[k];
    return t;
  }
  function available() { return BUDGET - invested(); }
  function backedCount(alloc) {
    var n = 0;
    for (var k in alloc) if (alloc[k] > 0) n++;
    return n;
  }
  function byId(id) {
    for (var i = 0; i < FOUNDERS.length; i++) if (FOUNDERS[i].id === id) return FOUNDERS[i];
    return null;
  }
  /* The verified site record for a founder: photograph, description, film, logo. */
  function site(f) {
    var all = window.NGS_FOUNDERS;
    if (!Array.isArray(all)) return null;
    for (var i = 0; i < all.length; i++) if (all[i] && all[i].entrant === f.entrant) return all[i];
    return null;
  }

  /* The face. The story crop with its focal point, in a ring. If the site record is
     somehow missing, initials on a plain circle -- never a stand-in picture. */
  function faceHTML(f, cls, attrs) {
    var rec = site(f);
    var src = rec && (rec.story || rec.shot) ? (rec.story || rec.shot) : '';
    var set = rec && rec.story && rec.story2x ? ' srcset="' + esc(rec.story) + ' 1x, ' + esc(rec.story2x) + ' 2x"' : '';
    var focal = rec && (rec.storyFocal || rec.focal) ? ' style="object-position:' + esc(rec.storyFocal || rec.focal) + '"' : '';
    var inner = src
      ? '<img src="' + esc(src) + '"' + set + focal + ' alt="" loading="lazy" decoding="async">'
      : '<span class="gm-face__init">' + esc(f.name.split(' ').map(function (w) { return w[0]; }).join('').slice(0, 2)) + '</span>';
    return '<span class="gm-face ' + (cls || '') + '" style="--tint:' + f.tint + '"' + (attrs || '') + '>' + inner + '</span>';
  }

  /* ---------------------------------------------------------------- what is remembered

     Two small flags, and neither is anything about a person.

     The opening plays once a SESSION, so a second page in the same visit does not replay
     it; a head script reads the same key before first paint, which is what stops a flash
     of it on the way to the hub. The briefing is shown once a BROWSER, so somebody coming
     back to finish a portfolio is not told the rules again.

     Both are wrapped: storage throws outright in some private modes, and a game that could
     not start because it could not write a flag would be a poor trade. */
  function flag(store, key, set) {
    try {
      var s = window[store];
      if (!s) return false;
      if (set) { s.setItem(key, '1'); return true; }
      return s.getItem(key) === '1';
    } catch (e) { return false; }
  }

  function intro() {
    var el = $('[data-intro]');
    if (!el) return;
    var drop = function () { if (el.parentNode) el.parentNode.removeChild(el); };
    if (reduced || flag('sessionStorage', 'ngg_intro')) { drop(); return; }
    flag('sessionStorage', 'ngg_intro', true);
    el.addEventListener('click', function () {
      el.classList.add('is-out');
      setTimeout(drop, 340);
    });
    /* The CSS animation hides it on its own at 1.95s -- that is what makes the opening
       safe without script at all. This only takes it out of the page a moment after, so
       nothing invisible is left sitting over the hub. */
    setTimeout(drop, 2100);
  }

  /* ---------------------------------------------------------------- the wire */
  function api(action, body) {
    var payload = body || {};
    payload.action = action;
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, reason: 'bad_json' }; })
        .then(function (j) { j.status = r.status; return j; });
    }).catch(function () {
      return { ok: false, reason: 'network', status: 0 };
    });
  }

  function take(st) {
    if (!st || !st.ok) return;
    S.open = !!st.open;
    S.revealed = !!st.revealed;
    S.signedIn = !!st.signed_in;
    S.mailReady = st.mail_ready !== false;
    S.demoAllowed = !!st.demo_allowed;
    S.demo = !!st.demo;
    S.mask = st.email_mask || '';
    S.submitted = !!st.submitted;
    S.portfolio = st.portfolio || null;
    if (st.budget) BUDGET = st.budget;
    S.draft = {};
    if (st.draft && typeof st.draft === 'object') {
      for (var k in st.draft) {
        if (Object.prototype.hasOwnProperty.call(st.draft, k)) S.draft[k] = st.draft[k] | 0;
      }
    }
  }

  /* The draft follows the player around without them thinking about it. Debounced, because
     a thumb on a chip four times in a second is one intention, not four. A save that fails
     says so, once, and is tried again on the next change -- the allocation itself is still
     here on the screen and is sent whole every time, so nothing is lost by a miss. */
  var saveFailed = false;
  function saveDraft() {
    if (!S.signedIn || S.submitted) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      api('save-draft', { alloc: S.draft }).then(function (r) {
        if (r.ok) { if (saveFailed) { saveFailed = false; toast(''); } return; }
        if (r.reason === 'already_submitted') { boot(); return; }
        if (!saveFailed) {
          saveFailed = true;
          toast('Your last change could not be saved — check your signal. It is still on '
            + 'screen and will be saved with your next tap.');
        }
      });
    }, 450);
  }

  var toastTimer = null;
  function toast(text) {
    var t = $('[data-toast]');
    if (!t) return;
    if (toastTimer) clearTimeout(toastTimer);
    if (!text) { t.classList.remove('is-on'); return; }
    t.textContent = text;
    t.classList.add('is-on');
    toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, 5200);
  }

  /* ---------------------------------------------------------------- screens */
  function show(name) {
    $$('[data-screen]').forEach(function (el) { el.hidden = el.getAttribute('data-screen') !== name; });
    $('[data-bar]').hidden = (name === 'signin' || name === 'brief');
    dock(name === 'room' && !S.submitted);
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }
  function dock(up) {
    var d = $('[data-dock]');
    if (d) d.classList.toggle('is-up', !!up);
  }

  /* The three wallet figures count to their new value rather than jumping to it. */
  function tween(el, from, to) {
    if (!el) return;
    if (reduced || from === to) { el.textContent = ngd(to); return; }
    var t0 = null, dur = 420;
    function step(t) {
      if (!t0) t0 = t;
      var k = Math.min(1, (t - t0) / dur);
      k = 1 - Math.pow(1 - k, 3);
      el.textContent = ngd(Math.round(from + (to - from) * k));
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function paintBar() {
    var bar = $('[data-bar]');
    if (!bar) return;
    var final = S.submitted && S.portfolio;
    var inv = final ? S.portfolio.invested : invested();
    var left = final ? S.portfolio.unspent : available();
    var alloc = final ? S.portfolio.alloc : S.draft;

    tween($('[data-w-left]'), shown.left, left);
    tween($('[data-w-in]'), shown.inv, inv);
    shown.left = left; shown.inv = inv;
    var n = backedCount(alloc);
    $('[data-w-n]').textContent = String(n);
    $('[data-w-n-label]').textContent = n === 1 ? 'Founder backed' : 'Founders backed';
    $('[data-who]').textContent = S.mask || '';

    var html = '';
    FOUNDERS.forEach(function (f) {
      var a = alloc[f.id] || 0;
      if (a > 0) html += '<span class="gm-split__seg" style="width:' + (a / BUDGET * 100) + '%;background:' + f.tint + '"></span>';
    });
    $('[data-split]').innerHTML = html + '<span class="gm-split__rest"></span>';
  }

  /* ---------------------------------------------------------------- the room */
  /* Where a founder rolls in from. Four edges in turn, so the ten arrive as a pattern
     rather than a scatter, and each one turns as it travels -- which is what reads as a
     roll rather than a slide. Taken from the position, so it is the same every time. */
  var FROM = [
    ['-128%', '-42%', '-170deg'],
    ['0%', '-178%', '150deg'],
    ['128%', '-42%', '170deg'],
    ['0%', '172%', '-150deg']
  ];

  function cardHTML(f, i) {
    var n = S.draft[f.id] || 0;
    var from = FROM[i % 4];
    return ''
      + '<button class="gm-f' + (arrive ? '' : ' gm-f--in') + (n > 0 ? ' is-backed' : '') + '" type="button"'
      +   ' style="--tint:' + f.tint + ';--d:' + (i * (arrive ? 72 : 40)) + 'ms'
      +   ';--fx:' + from[0] + ';--fy:' + from[1] + ';--fr:' + from[2] + '"'
      +   ' data-open="' + f.id + '"'
      +   ' aria-label="' + esc(f.name) + ' of ' + esc(f.company)
      +   (n > 0 ? ', currently backed with ' + ngd(n) : ', not backed yet') + '">'
      +   faceHTML(f, '', ' data-face="' + f.id + '"')
      +   '<span class="gm-f__amt gm-ngd" data-tag="' + f.id + '">' + ngd(n) + '</span>'
      +   '<span class="gm-f__name">' + esc(f.name) + '</span>'
      +   '<span class="gm-f__co">' + esc(f.company) + '</span>'
      + '</button>';
  }

  function paintRoom() {
    var grid = $('[data-grid]');
    grid.classList.remove('is-arriving', 'is-in');
    grid.innerHTML = FOUNDERS.map(cardHTML).join('');

    if (arrive) {
      /* The circles land first and the room assembles around them: the wallet and the
         heading follow them in, the dock last. .is-in is deliberately NOT set here -- the
         arrival animation owns the cards' transform, and the two would fight over it. */
      grid.classList.add('is-arriving');
      factStart();
      ['[data-bar]', '[data-banner]', '[data-room-head]'].forEach(function (s, k) {
        var el = $(s);
        if (!el) return;
        el.classList.remove('gm-late');
        void el.offsetWidth;
        el.style.setProperty('--ld', (260 + k * 110) + 'ms');
        el.classList.add('gm-late');
      });
      setTimeout(function () { grid.classList.remove('is-arriving'); }, 1700);
    } else {
      requestAnimationFrame(function () { grid.classList.add('is-in'); });
      factStart();
    }
    paintDock();
  }

  /* ---------------------------------------------------------------- did you know

     One sentence at a time, and every sentence is the founder's own: it is taken from
     their description in the site's verified data and trimmed at a full stop, never
     rewritten. A founder with nothing on file is simply skipped rather than given
     something to say.

     The card is a button, because the fact belongs to somebody and tapping it should open
     them -- which is the reason it sits above the grid at all. */
  var FACT_EVERY = 5600;

  function factFor(f) {
    var rec = site(f);
    var b = rec && rec.blurb ? String(rec.blurb).trim() : '';
    if (!b) return null;
    /* the first sentence, if there is more than one and it is long enough to stand alone */
    var cut = b.indexOf('. ');
    var say = (cut > 40 && cut < b.length - 2) ? b.slice(0, cut + 1) : b;
    return { f: f, say: say };
  }

  function factStep() {
    var card = $('[data-fact]');
    if (!card || card.hidden) return;
    var tries = 0, item = null;
    while (tries++ < FOUNDERS.length && !item) {
      item = factFor(FOUNDERS[factAt % FOUNDERS.length]);
      if (!item) factAt++;
    }
    if (!item) { card.hidden = true; return; }

    var f = item.f;
    card.style.setProperty('--tint', f.tint);
    card.setAttribute('aria-label', 'Did you know: ' + item.say + ' \u2014 '
      + f.name + ' of ' + f.company + '. Open their profile.');
    $('[data-fact-k]').textContent = (factAt % 2) ? 'Fun fact!' : 'Did you know?';
    $('[data-fact-say]').textContent = item.say;
    $('[data-fact-who]').textContent = f.name + ' \u00b7 ' + f.company;
    $('[data-fact-face]').innerHTML = faceHTML(f, 'is-backed');

    var slot = $('[data-fact-slot]');
    slot.classList.remove('gm-fact__slot');
    void slot.offsetWidth;
    slot.classList.add('gm-fact__slot');

    var bar = $('[data-fact-bar]');
    bar.style.setProperty('--every', FACT_EVERY + 'ms');
    bar.classList.remove('is-running');
    void bar.offsetWidth;
    if (!reduced) bar.classList.add('is-running');
  }

  function factStart() {
    var card = $('[data-fact]');
    if (!card) return;
    if (!FOUNDERS.some(factFor)) { card.hidden = true; return; }
    card.hidden = false;
    factStep();
    if (factTimer) clearInterval(factTimer);
    /* It keeps its place while somebody is reading it or the tab is in the background --
       losing a sentence halfway through is the one way a rotating card is annoying. */
    factTimer = setInterval(function () {
      if (factHold > 0 || document.hidden) return;
      factAt++;
      factStep();
    }, FACT_EVERY);
  }

  function paintDock() {
    var n = backedCount(S.draft);
    $('[data-dock-sum]').innerHTML =
      '<b>' + ngd(invested()) + ' placed</b>'
      + (n ? n + (n === 1 ? ' founder' : ' founders') + ' · ' + ngd(available()) + ' left'
           : 'Tap a founder to start — ' + ngd(available()) + ' to place');
  }

  function markCard(f) {
    var n = S.draft[f.id] || 0;
    var btn = $('[data-open="' + f.id + '"]');
    if (!btn) return;
    btn.classList.toggle('is-backed', n > 0);
    var tag = $('[data-tag="' + f.id + '"]', btn);
    if (tag) tag.textContent = ngd(n);
    btn.setAttribute('aria-label', f.name + ' of ' + f.company
      + (n > 0 ? ', currently backed with ' + ngd(n) : ', not backed yet'));
  }

  /* ---------------------------------------------------------------- the panel */
  function openSheet(id) {
    var f = byId(id);
    if (!f) return;
    sheetFor = f;
    var rec = site(f);
    var sheet = $('[data-sheet]');

    $('[data-sheet-head]').style.setProperty('--tint', f.tint);
    $('[data-sheet-face]').innerHTML = faceHTML(f, '', ' data-sheet-pic');
    $('[data-sheet-name]').textContent = f.name;

    var brand = $('[data-sheet-brand]');
    if (rec && rec.logo) {
      brand.innerHTML = '<img class="gm-sheet__logo" src="' + esc(rec.logo) + '" alt="'
        + esc(f.company) + ' logo" decoding="async">';
    } else {
      brand.innerHTML = '<span class="gm-sheet__wordmark">' + esc(f.company) + '</span>';
    }

    var blurb = $('[data-sheet-blurb]');
    blurb.textContent = rec && rec.blurb ? rec.blurb : '';
    blurb.hidden = !(rec && rec.blurb);

    var film = $('[data-sheet-film]');
    var src = rec && rec.video && rec.video.type === 'file' ? rec.video.src : '';
    film.innerHTML = src
      ? '<div class="gm-film"><video controls playsinline preload="none"'
        + (rec.poster ? ' poster="' + esc(rec.poster) + '"' : '')
        + '><source src="' + esc(src) + '" type="video/mp4"></video></div>'
      : '<p class="gm-nofilm">No pitch film on file for this founder yet — their description '
        + 'above is what the Summit has on record.</p>';

    $('[data-move]').classList.remove('is-open');
    moveAmt = 1000;
    pending = null;
    $('[data-alloc-panel]').hidden = true;
    $('[data-custom]').hidden = true;
    paintAlloc(false);
    sheet.hidden = false;
    requestAnimationFrame(function () { sheet.classList.add('is-up'); });
    document.body.style.overflow = 'hidden';
    $('[data-sheet-x]').focus({ preventScroll: true });
  }

  function closeSheet() {
    var sheet = $('[data-sheet]');
    sheet.classList.remove('is-up');
    var v = sheet.querySelector('video');
    if (v) { try { v.pause(); } catch (e) {} }
    document.body.style.overflow = '';
    var back = sheetFor;
    setTimeout(function () {
      sheet.hidden = true;
      $('[data-sheet-film]').innerHTML = '';
    }, reduced ? 0 : 380);
    if (back) {
      var btn = $('[data-open="' + back.id + '"]');
      if (btn) btn.focus({ preventScroll: true });
    }
    sheetFor = null;
  }

  /* The panel is shut unless it was already open for this founder. What is behind them
     and what is left to place sit above it either way. */
  function paintAlloc(keepOpen) {
    if (!sheetFor) return;
    var f = sheetFor;
    var now = S.draft[f.id] || 0;
    var free = available() + now;
    var first = f.name.split(' ')[0];

    $('[data-alloc-now]').innerHTML = 'Behind ' + esc(first)
      + ' <b class="gm-ngd">' + ngd(now) + '</b>';
    $('[data-alloc-left]').innerHTML = 'Left <b class="gm-ngd">' + ngd(available()) + '</b>';

    $('[data-alloc-open]').textContent = now > 0 ? 'Change this investment' : 'Back this founder';
    $('[data-alloc-shed]').hidden = now <= 0;

    /* NG$5,000, everything that is free, or a number of their own */
    var pick = '';
    pick += '<button type="button" data-pick="5000"' + (5000 > free ? ' disabled' : '')
         + (pending === 5000 ? ' class="is-on"' : '') + '>' + ngd(5000) + '<small>Flat</small></button>';
    pick += '<button type="button" data-pick="max"' + (free <= 0 ? ' disabled' : '')
         + (pending === free && free > 0 ? ' class="is-on"' : '') + '>All in<small>'
         + ngd(free) + '</small></button>';
    pick += '<button type="button" data-pick="custom"'
         + (pending === 'custom' ? ' class="is-on"' : '') + '>Custom<small>Your call</small></button>';
    $('[data-pick]').innerHTML = pick;

    var go = $('[data-alloc-go]');
    var amount = typeof pending === 'number' ? pending : null;
    go.textContent = amount === null ? 'Confirm'
      : (amount === now ? 'No change' : 'Place ' + ngd(amount));
    go.disabled = amount === null || amount === now;

    if (!keepOpen) {
      $('[data-alloc-panel]').hidden = true;
      $('[data-custom]').hidden = true;
    }
    note(now > 0
      ? ngd(now) + ' is behind ' + first + '. ' + ngd(available()) + ' still to place.'
      : 'You have ' + ngd(available()) + ' left to place.', false);
    paintMove();
  }

  function openPanel(on) {
    var p = $('[data-alloc-panel]');
    p.hidden = !on;
    p.classList.toggle('is-open', !!on);
    /* one action at a time: the button that opened this is not also a thing to press
       while it is open */
    $('[data-alloc-shut]').hidden = !!on;
    if (!on) { pending = null; $('[data-custom]').hidden = true; }
    paintAlloc(on);
    if (on) {
      /* the panel is at the bottom of a sheet; make sure the confirm is reachable */
      var s = $('.gm-sheet__scroll');
      if (s) setTimeout(function () { s.scrollTop = s.scrollHeight; }, 60);
    }
  }

  function note(text, bad) {
    var el = $('[data-alloc-note]');
    el.textContent = text;
    el.classList.toggle('is-bad', !!bad);
  }

  /* One place decides what an amount does, so the chips, the field and the button cannot
     drift apart. Returns false when nothing changed. */
  function place(f, want) {
    var now = S.draft[f.id] || 0;
    var free = available() + now;
    if (!isFinite(want) || want < 0) { note('That is not an amount of NG$.', true); return false; }
    want = Math.floor(want);
    if (want > free) { note('You only have ' + ngd(free) + ' available for this founder.', true); return false; }
    if (want === now) return false;
    if (want === 0) delete S.draft[f.id]; else S.draft[f.id] = want;

    markCard(f);
    paintBar();
    paintDock();
    pending = null;
    paintAlloc(false);
    saveDraft();
    /* The face is the destination, so it has to be on screen. The panel's controls sit in a
       sticky footer and stay put whatever the scroll position, so bringing the top of the
       panel back into view costs the player nothing -- and without it the tokens flew to a
       point above the phone whenever somebody had scrolled down to the film. */
    var scroller = $('.gm-sheet__scroll');
    if (scroller && scroller.scrollTop > 0) scroller.scrollTop = 0;
    var face = $('[data-sheet-pic]');
    if (want > now) {
      flyTo($('[data-w-left]'), face, Math.min(6, 1 + Math.round((want - now) / 1000)), function () { pulse(face); });
    } else if (want < now) {
      flyTo(face, $('[data-w-left]'), 3);
    }
    return true;
  }

  /* ---------------------------------------------------------------- moving NG$ between founders */
  function paintMove() {
    var f = sheetFor;
    var wrap = $('[data-move]');
    var now = S.draft[f.id] || 0;
    wrap.hidden = now <= 0;
    if (now <= 0) return;
    if (moveAmt > now) moveAmt = now;

    var chips = '';
    MOVE_CHIPS.forEach(function (c) {
      if (c > now) return;
      chips += '<button class="gm-chip' + (moveAmt === c ? ' is-on' : '') + '" type="button" data-move-amt="' + c + '">' + ngd(c) + '</button>';
    });
    chips += '<button class="gm-chip' + (moveAmt === now ? ' is-on' : '') + '" type="button" data-move-amt="' + now + '">All ' + ngd(now) + '</button>';
    $('[data-move-chips]').innerHTML = chips;
    $('[data-move-how]').innerHTML = 'Move <b class="gm-ngd">' + ngd(moveAmt) + '</b> of '
      + esc(f.name.split(' ')[0]) + '’s ' + ngd(now) + ' to:';

    var row = '';
    FOUNDERS.forEach(function (o) {
      if (o.id === f.id) return;
      var a = S.draft[o.id] || 0;
      row += '<button class="gm-move__to' + (a > 0 ? ' is-backed' : '') + '" type="button" data-move-to="' + o.id + '"'
        + ' aria-label="Move ' + ngd(moveAmt) + ' to ' + esc(o.name) + '">'
        + faceHTML(o, '', ' data-move-face="' + o.id + '"')
        + '<span>' + esc(o.name.split(' ')[0]) + '</span>'
        + '<em class="gm-ngd">' + (a > 0 ? ngd(a) : '—') + '</em>'
        + '</button>';
    });
    $('[data-move-row]').innerHTML = row;
  }

  function move(from, to, amt) {
    var have = S.draft[from.id] || 0;
    amt = Math.min(Math.floor(amt), have);
    if (amt <= 0) return false;
    var left = have - amt;
    if (left === 0) delete S.draft[from.id]; else S.draft[from.id] = left;
    S.draft[to.id] = (S.draft[to.id] || 0) + amt;

    markCard(from); markCard(to);
    paintBar(); paintDock();
    saveDraft();

    /* From the amount under this founder's name to the face that was tapped. Both live in
       the sticky footer, a few lines apart, so the whole flight is on screen whatever the
       panel above it is scrolled to. */
    var target = $('[data-move-face="' + to.id + '"]');
    flyTo($('[data-alloc-now] b') || $('[data-alloc-now]'), target, Math.min(6, 1 + Math.round(amt / 1000)), function () {
      pulse(target);
    });
    note(ngd(amt) + ' moved to ' + to.name.split(' ')[0] + '. '
      + (left > 0 ? from.name.split(' ')[0] + ' keeps ' + ngd(left) + '.' : 'Nothing left behind ' + from.name.split(' ')[0] + '.'), false);
    /* repaint after the tokens have left, so the row the token is flying to is the row
       it started from */
    setTimeout(function () { paintAlloc($('[data-alloc-panel]').hidden === false); },
               reduced ? 0 : 520);
    return true;
  }

  /* ---------------------------------------------------------------- review */
  function rowHTML(f, n) {
    return ''
      + '<li class="gm-row' + (n > 0 ? ' is-backed' : ' is-zero') + '" style="--tint:' + f.tint + '">'
      +   faceHTML(f, n > 0 ? 'is-backed' : '')
      +   '<span class="gm-row__id"><b>' + esc(f.name) + '</b><span>' + esc(f.company) + '</span></span>'
      +   '<span class="gm-row__amt gm-ngd">' + (n > 0 ? '<b>' + ngd(n) + '</b>' : ngd(0)) + '</span>'
      + '</li>';
  }
  function listHTML(alloc) {
    var backed = FOUNDERS.filter(function (f) { return (alloc[f.id] || 0) > 0; });
    var rest = FOUNDERS.filter(function (f) { return !(alloc[f.id] || 0); });
    return backed.map(function (f) { return rowHTML(f, alloc[f.id]); }).join('')
      + rest.map(function (f) { return rowHTML(f, 0); }).join('');
  }

  function paintReview() {
    var inv = invested(), left = available();
    $('[data-review-list]').innerHTML = listHTML(S.draft);
    $('[data-review-in]').textContent = ngd(inv);
    $('[data-review-left]').textContent = ngd(left);
    var ask = $('[data-ask]');
    if (inv === 0) {
      ask.innerHTML = '<p>You haven’t backed anyone. That is a real answer — but it '
        + 'locks in a portfolio with nothing in it, and it cannot be changed afterwards.</p>'
        + '<div class="gm-ask__row">'
        + '<button class="gm-btn gm-btn--ghost" type="button" data-go="room">Go back and pick</button>'
        + '<button class="gm-btn" type="button" data-submit>Lock in NG$0 anyway</button></div>';
    } else if (left > 0) {
      ask.innerHTML = '<p>You’re keeping <b class="gm-ngd">' + ngd(left) + '</b> — ready to lock in your portfolio?</p>'
        + '<div class="gm-ask__row">'
        + '<button class="gm-btn gm-btn--ghost" type="button" data-go="room">Place more</button>'
        + '<button class="gm-btn" type="button" data-submit>Lock it in</button></div>';
    } else {
      ask.innerHTML = '<p>Every NG$ placed. Once you lock this in it cannot be changed.</p>'
        + '<div class="gm-ask__row">'
        + '<button class="gm-btn gm-btn--ghost" type="button" data-go="room">Change something</button>'
        + '<button class="gm-btn" type="button" data-submit>Lock it in</button></div>';
    }
  }

  /* ---------------------------------------------------------------- the result */
  function clusterHTML(alloc) {
    return FOUNDERS.map(function (f) {
      var on = !alloc || (alloc[f.id] || 0) > 0;
      return faceHTML(f, alloc ? (on ? 'is-backed' : 'is-dim') : '');
    }).join('');
  }

  function paintDone() {
    var p = S.portfolio;
    if (!p) return;
    $('[data-done-cluster]').innerHTML = clusterHTML(p.alloc);
    $('[data-done-list]').innerHTML = listHTML(p.alloc);
    $('[data-done-in]').textContent = ngd(p.invested);
    $('[data-done-left]').textContent = ngd(p.unspent);
    $('[data-done-sub]').textContent = p.backed === 0
      ? 'You kept all ' + ngd(BUDGET) + ' of your virtual capital.'
      : 'You put ' + ngd(p.invested) + ' behind ' + p.backed + (p.backed === 1 ? ' founder.' : ' founders.');
  }

  /* ---------------------------------------------------------------- effects */
  function centre(el) {
    var b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }

  /* Tokens from one element to another. The layer is fixed and above everything, so the
     wallet in the bar and a face inside the sheet are both fair game. */
  function flyTo(fromEl, toEl, count, done) {
    if (reduced || !fromEl || !toEl) { if (done) done(); return; }
    var layer = $('[data-fx]');
    if (!layer) { if (done) done(); return; }
    var a = centre(fromEl), b = centre(toEl);
    var n = Math.max(1, count | 0);
    for (var i = 0; i < n; i++) {
      var t = document.createElement('span');
      t.className = 'gm-token';
      t.textContent = 'NG';
      var jx = (Math.random() - 0.5) * 26, jy = (Math.random() - 0.5) * 18;
      t.style.left = (a.x - 11 + jx) + 'px';
      t.style.top = (a.y - 11 + jy) + 'px';
      t.style.setProperty('--dx', (b.x - a.x - jx) + 'px');
      t.style.setProperty('--dy', (b.y - a.y - jy) + 'px');
      t.style.setProperty('--dur', (700 + Math.random() * 260) + 'ms');
      t.style.setProperty('--delay', (i * 55) + 'ms');
      layer.appendChild(t);
      (function (el) { setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1500); }(t));
    }
    if (done) setTimeout(done, 520 + n * 55);
  }

  function pulse(el) {
    if (!el || reduced) return;
    el.classList.remove('is-pulse');
    void el.offsetWidth;
    el.classList.add('is-pulse');
    setTimeout(function () { el.classList.remove('is-pulse'); }, 800);
  }

  /* The finish: a ring of tokens under one line, then the portfolio. */
  function burst(done) {
    var b = $('[data-burst]');
    if (!b || reduced) { if (done) done(); return; }
    $$('.gm-token', b).forEach(function (t) { t.parentNode.removeChild(t); });
    b.classList.remove('is-out');
    b.hidden = false;
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    for (var i = 0; i < 22; i++) {
      var t = document.createElement('span');
      t.className = 'gm-token';
      t.textContent = 'NG';
      var ang = (i / 22) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      var r = Math.min(window.innerWidth, window.innerHeight) * (0.32 + Math.random() * 0.16);
      t.style.left = (cx - 11) + 'px';
      t.style.top = (cy - 11) + 'px';
      t.style.setProperty('--dx', (Math.cos(ang) * r) + 'px');
      t.style.setProperty('--dy', (Math.sin(ang) * r) + 'px');
      t.style.setProperty('--delay', (i * 14) + 'ms');
      b.appendChild(t);
    }
    setTimeout(function () {
      b.classList.add('is-out');
      setTimeout(function () { b.hidden = true; if (done) done(); }, 340);
    }, 1150);
  }

  /* ---------------------------------------------------------------- sign in */
  function signinMsg(text, kind) {
    var el = $('[data-signin-msg]');
    el.textContent = text || '';
    el.className = 'gm-msg' + (kind ? ' gm-msg--' + kind : '');
  }

  var SAYS = {
    email: 'That address does not look right. Check it and try again.',
    not_registered: 'We could not find that email in the NextGen Summit registrations. Use the address you registered with.',
    disposable: 'That looks like a throwaway address. Please use one you can read today.',
    cooldown: 'A code just went out. Give it a moment before asking for another.',
    addr_daily: 'That address has asked for too many codes today.',
    ip_burst: 'A lot of people are signing in from this network right now. Try again in a minute.',
    ip_hourly: 'Too many sign-ins from this network in the last hour. Try again shortly.',
    mail_not_configured: 'Email sign-in is not switched on here yet.',
    mail: 'The code could not be sent. Try again in a moment.',
    code: 'That code is not right.',
    expired: 'That code has expired. Ask for a new one.',
    attempts: 'Too many tries. Ask for a new code.',
    no_pending: 'Ask for a code first.',
    network: 'No connection. Check your signal and try again.',
    store: 'The game store is busy. Wait a moment and try again — nothing you placed is lost.',
    server: 'Something went wrong on our side. Try again — your allocation is still on screen.',
    closed: 'Submissions have closed.',
    over_budget: 'That is more than NG$10,000.',
    not_whole: 'NG$ comes in whole numbers only.',
    unknown_founder: 'That founder is not in this game.',
    shape: 'That request was not understood. Reload and try again.',
    already_submitted: 'Your portfolio is already locked in.'
  };
  function says(r) { return SAYS[r && r.reason] || 'Something went wrong. Try again.'; }

  function step(which) {
    $('[data-step="email"]').hidden = which !== 'email';
    var codeStep = $('[data-step="code"]');            // gone since the code was dropped
    if (codeStep) codeStep.hidden = which !== 'code';
    signinMsg('');
    var el = which === 'code' ? $('[data-code]') : $('[data-email]');
    if (el) setTimeout(function () { el.focus(); }, 60);
  }

  /* ---------------------------------------------------------------- the briefing */

  /* Shown to somebody who has just arrived with nothing placed and has not been told the
     rules on this browser before. Anyone returning to a wallet they have already started
     goes straight back to it. */
  function owedBrief() {
    return !S.submitted && invested() === 0 && !flag('localStorage', 'ngg_briefed');
  }

  function paintBrief() {
    $('[data-brief-amt]').textContent = ngd(BUDGET);
    $('[data-brief-say]').textContent = 'You\u2019ve been given ' + ngd(BUDGET)
      + ' of virtual NextGen capital to back the ten founders pitching live tonight.';
  }

  /* Let's play: remember it, then draw the room with the ten rolling in. */
  function enterRoom() {
    flag('localStorage', 'ngg_briefed', true);
    arrive = !reduced;
    paintBar();
    paintRoom();
    show('room');
    arrive = false;
  }

  /* ---------------------------------------------------------------- routing */
  function route() {
    if (!S.signedIn) { show('signin'); return; }
    if (S.submitted) { paintBar(); paintDone(); show('done'); return; }
    if (owedBrief()) { paintBrief(); show('brief'); return; }
    paintBar(); paintRoom(); show('room');
  }

  function banner() {
    var b = $('[data-banner]');
    if (!b) return;
    var say = [];
    var stop = false;
    if (!S.open && !S.submitted) {
      say.push('<b>Submissions are closed.</b> You can still look around and read the founders, '
        + 'but a new portfolio cannot be locked in.');
      stop = true;
    }
    if (S.demo) {
      say.push('<b>Staging demo player.</b> You are signed in without an email, which is only '
        + 'possible on the review site. Portfolios saved here are test data.');
    }
    b.className = 'gm-banner' + (stop ? ' gm-banner--stop' : '');
    b.innerHTML = say.join('<br><br>');
    b.hidden = say.length === 0;
  }

  /* ---------------------------------------------------------------- wiring */
  function wire() {
    $('[data-send]').addEventListener('click', function () {
      var v = $('[data-email]').value.trim();
      if (!v) { signinMsg('Enter your email address.', 'bad'); return; }
      this.disabled = true;
      signinMsg('Checking your registration…');
      var btn = this;
      /* Email only, no code (30 October): the server checks the address against the
         NextGen Summit registrations and signs straight in. */
      api('email-signin', { email: v }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { signinMsg(says(r) + (r.wait ? ' (' + r.wait + 's)' : ''), 'bad'); return; }
        signinMsg('');
        take(r); email = ''; banner(); route();
      });
    });

    $('[data-play]').addEventListener('click', enterRoom);

    $('[data-demo]').addEventListener('click', function () {
      this.disabled = true;
      var btn = this;
      api('demo-signin', {}).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { signinMsg(says(r), 'bad'); return; }
        take(r); banner(); route();
      });
    });

    [['data-email', 'data-send']].forEach(function (p) {
      $('[' + p[0] + ']').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); $('[' + p[1] + ']').click(); }
      });
    });

    $('[data-grid]').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-open]') : null;
      if (b) openSheet(b.getAttribute('data-open'));
    });

    var sheet = $('[data-sheet]');
    $('[data-sheet-x]').addEventListener('click', closeSheet);
    $('[data-sheet-veil]').addEventListener('click', closeSheet);

    $('[data-alloc-open]').addEventListener('click', function () { openPanel(true); });
    $('[data-alloc-close]').addEventListener('click', function () { openPanel(false); });
    $('[data-alloc-shed]').addEventListener('click', function () {
      if (sheetFor) place(sheetFor, 0);
    });

    $('[data-pick]').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-pick]') : null;
      if (!b || b.disabled || !sheetFor) return;
      var v = b.getAttribute('data-pick');
      var now = S.draft[sheetFor.id] || 0;
      var free = available() + now;
      if (v === 'custom') {
        pending = 'custom';
        paintAlloc(true);
        $('[data-custom]').hidden = false;
        var i = $('[data-amount]');
        i.value = now > 0 ? String(now) : '';
        setTimeout(function () { i.focus(); i.select(); }, 40);
        return;
      }
      $('[data-custom]').hidden = true;
      pending = v === 'max' ? free : Math.min(parseInt(v, 10), free);
      paintAlloc(true);
    });

    /* typing is choosing: the confirm follows the field */
    $('[data-amount]').addEventListener('input', function () {
      var raw = this.value.trim();
      if (raw === '') { pending = 'custom'; }
      else if (!/^\d+$/.test(raw)) { note('Whole NG$ only — no decimals.', true); return; }
      else { pending = parseInt(raw, 10); }
      paintAlloc(true);
      $('[data-custom]').hidden = false;
    });

    $('[data-alloc-go]').addEventListener('click', function () {
      if (!sheetFor || typeof pending !== 'number') return;
      if (place(sheetFor, pending)) { openPanel(false); }
    });

    $('[data-amount]').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('[data-alloc-go]').click(); }
    });

    $('[data-fact]').addEventListener('click', function () {
      var f = FOUNDERS[factAt % FOUNDERS.length];
      if (f) openSheet(f.id);
    });
    ['mouseenter', 'focus'].forEach(function (ev) {
      $('[data-fact]').addEventListener(ev, function () { factHold++; }, true);
    });
    ['mouseleave', 'blur'].forEach(function (ev) {
      $('[data-fact]').addEventListener(ev, function () { factHold = Math.max(0, factHold - 1); }, true);
    });

    /* moving NG$ */
    $('[data-move-t]').addEventListener('click', function () { $('[data-move]').classList.toggle('is-open'); });
    $('[data-move-chips]').addEventListener('click', function (e) {
      var c = e.target.closest ? e.target.closest('[data-move-amt]') : null;
      if (!c) return;
      moveAmt = parseInt(c.getAttribute('data-move-amt'), 10);
      paintMove();
    });
    $('[data-move-row]').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-move-to]') : null;
      if (!b || !sheetFor) return;
      var to = byId(b.getAttribute('data-move-to'));
      if (to) move(sheetFor, to, moveAmt);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !sheet.hidden) { e.preventDefault(); closeSheet(); }
    });
    sheet.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' || sheet.hidden) return;
      var f = $$('button:not([disabled]), input, video, [tabindex]:not([tabindex="-1"])', sheet)
        .filter(function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    document.addEventListener('click', function (e) {
      var g = e.target.closest ? e.target.closest('[data-go]') : null;
      if (g) {
        var to = g.getAttribute('data-go');
        if (to === 'review') { paintReview(); show('review'); }
        else if (to === 'room') { paintRoom(); show('room'); }
        return;
      }
      if (e.target.closest && e.target.closest('[data-submit]')) submit(e.target.closest('[data-submit]'));
    });

    $('[data-signout]').addEventListener('click', function () {
      api('sign-out', {}).then(function () { location.reload(); });
    });
  }

  /* One submission, and the server is what makes that true. The button is disabled on the
     way in so a double tap cannot even try; if one gets through anyway, the endpoint hands
     back the portfolio that was already stored rather than writing a second. */
  var sending = false;
  function submit(btn) {
    if (sending) return;
    sending = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Locking in…'; }
    api('submit', { alloc: S.draft }).then(function (r) {
      sending = false;
      if (!r.ok) {
        if (btn) { btn.disabled = false; btn.textContent = 'Lock it in'; }
        var ask = $('[data-ask]');
        if (ask) {
          var p = document.createElement('p');
          p.className = 'gm-msg gm-msg--bad';
          p.textContent = says(r);
          ask.appendChild(p);
        }
        if (r.reason === 'already_submitted' || r.status === 409) { boot(); }
        return;
      }
      S.submitted = true;
      S.portfolio = r.portfolio;
      paintBar(); paintDone();
      burst(function () { show('done'); });
    }).catch(function (e) {
      sending = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Lock it in'; }
      try { console.error('NextGen Games: submit paint failed', e); } catch (x) {}
      boot();
    });
  }

  /* ---------------------------------------------------------------- go */
  function boot() {
    return api('state', {}).then(function (r) {
      if (!r.ok) { signinMsg(says(r), 'bad'); return; }
      take(r);
      $('[data-demo-wrap]').hidden = !(S.demoAllowed && !S.signedIn);
      banner();
      route();
    });
  }

  function start() {
    intro();
    /* the cluster of ten faces appears on the hub and the sign-in; nothing else is needed
       for it, so it is drawn wherever it is asked for, game page or not */
    $$('[data-cluster]').forEach(function (el) { el.innerHTML = clusterHTML(null); });
    if (!$('[data-screen="room"]')) return;         /* the hub: done */
    wire();
    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
