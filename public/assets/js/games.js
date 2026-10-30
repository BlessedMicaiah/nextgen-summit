/* ============================================================================
   NEXTGEN GAMES — BACK THE NEXT
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

   WHERE THE WORDS COME FROM

   Names, ventures, descriptions and films are read from window.NGS_FOUNDERS -- the same
   verified founder data the rest of the site runs on -- joined by entrant id. Nothing about
   a pitch is written in this file, so nothing about a pitch can be invented in it.

   NG$ IS NOT MONEY. It is never called dollars, never formatted as currency, and buys
   nothing. It is a way of saying who you would back.
   ============================================================================ */
(function () {
  'use strict';

  var API = '/api/ng-games.php';
  var BUDGET = 10000;
  var CHIPS = [500, 1000, 2500, 5000];

  /* The ten, in the running order for the live show.

     `art` is the cartoon's file stem. The supplied package had already applied the Gemini
     crosswalk -- its F01 is Caleb Orji, not the Gemini F01 -- and the pairing was checked
     founder by founder against the real photographs before any of it was imported. The
     tints are the game's own palette, chosen so no two neighbours clash; they are not taken
     from anybody's logo. */
  var FOUNDERS = [
    { id: 'f01', art: 'f01', entrant: 'entrant-01', name: 'Caleb Orji',                   company: 'Haptol Labs',           tint: '#00A3E6' },
    { id: 'f02', art: 'f02', entrant: 'entrant-03', name: 'Muyiwa Ogunsola',              company: 'Sooz',                  tint: '#1FC7BE' },
    { id: 'f03', art: 'f03', entrant: 'entrant-06', name: 'Velma Funebe',                 company: 'iBraid',                tint: '#EC008C' },
    { id: 'f04', art: 'f04', entrant: 'entrant-07', name: 'Divine Ayomide Fiolu',         company: 'BeforeKeys LLC',        tint: '#A77BE8' },
    { id: 'f05', art: 'f05', entrant: 'entrant-05', name: 'Ethan Edouard',                company: 'Lookbook',              tint: '#8FD14F' },
    { id: 'f06', art: 'f06', entrant: 'entrant-02', name: 'Annrita Karu',                 company: 'Credible blossom',      tint: '#FFC53D' },
    { id: 'f07', art: 'f07', entrant: 'entrant-14', name: 'Kate Mina Lin',                company: 'K8Culture Productions', tint: '#7A8CFF' },
    { id: 'f08', art: 'f08', entrant: 'entrant-12', name: 'Joyson BaLisamore',            company: "Jay's Watermelonade",   tint: '#FF6B5A' },
    { id: 'f09', art: 'f09', entrant: 'entrant-04', name: 'Ariel Laura Métayer',     company: 'The Luminous Lab',      tint: '#F2A1C8' },
    { id: 'f10', art: 'f10', entrant: 'entrant-13', name: 'Ugochinyere Blessing Okogeri', company: 'Offguardz',             tint: '#00C27A' }
  ];

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var reduced = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

  /* ---------------------------------------------------------------- state */
  var S = {
    open: true, revealed: false, signedIn: false, submitted: false,
    mailReady: true, demoAllowed: false, demo: false,
    mask: '', draft: {}, portfolio: null, booted: false
  };
  var email = '';              /* only while signing in; never stored anywhere */
  var sheetFor = null;
  var openedOne = false;
  var saveTimer = null;

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
  function byId(id) {
    for (var i = 0; i < FOUNDERS.length; i++) if (FOUNDERS[i].id === id) return FOUNDERS[i];
    return null;
  }
  /* The verified site record for a founder: description, film, logo. Absent on a page that
     did not load pc-founders.js, which is why every reader below copes with null. */
  function site(f) {
    var all = window.NGS_FOUNDERS;
    if (!Array.isArray(all)) return null;
    for (var i = 0; i < all.length; i++) if (all[i] && all[i].entrant === f.entrant) return all[i];
    return null;
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
     a thumb on a chip four times in a second is one intention, not four. */
  function saveDraft() {
    if (!S.signedIn || S.submitted) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      api('save-draft', { alloc: S.draft });
    }, 450);
  }

  /* ---------------------------------------------------------------- screens */
  function show(name) {
    $$('[data-screen]').forEach(function (el) { el.hidden = el.getAttribute('data-screen') !== name; });
    $('[data-bar]').hidden = (name === 'signin');
    dock(name === 'room' && !S.submitted);
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }

  function dock(up) {
    var d = $('[data-dock]');
    if (!d) return;
    d.classList.toggle('is-up', !!up);
  }

  function paintBar() {
    var bar = $('[data-bar]');
    if (!bar) return;
    var inv = S.submitted && S.portfolio ? S.portfolio.invested : invested();
    var left = S.submitted && S.portfolio ? S.portfolio.unspent : available();
    $('[data-w-cap]').textContent = ngd(BUDGET);
    $('[data-w-in]').textContent = ngd(inv);
    $('[data-w-left]').textContent = ngd(left);
    $('[data-who]').textContent = S.mask ? S.mask : '';

    var alloc = S.submitted && S.portfolio ? S.portfolio.alloc : S.draft;
    var split = $('[data-split]');
    var html = '';
    FOUNDERS.forEach(function (f) {
      var n = alloc[f.id] || 0;
      if (n > 0) {
        html += '<span class="gm-split__seg" style="width:' + (n / BUDGET * 100) + '%;background:'
              + f.tint + '" title="' + esc(f.name) + '"></span>';
      }
    });
    html += '<span class="gm-split__rest"></span>';
    split.innerHTML = html;
  }

  /* ---------------------------------------------------------------- the room */
  function cardHTML(f, i) {
    var n = S.draft[f.id] || 0;
    return ''
      + '<button class="gm-card gm-card--in' + (n > 0 ? ' is-backed' : '') + '" type="button"'
      +   ' style="--tint:' + f.tint + ';--d:' + (i * 45) + 'ms" data-open="' + f.id + '"'
      +   ' aria-label="' + esc(f.name) + ' of ' + esc(f.company)
      +   (n > 0 ? ', currently backed with ' + ngd(n) : ', not backed yet') + '">'
      +   '<span class="gm-card__art">'
      +     '<span class="gm-card__no">' + String(i + 1).padStart(2, '0') + '</span>'
      +     '<span class="gm-card__tag" data-tag="' + f.id + '">' + ngd(n) + '</span>'
      +     '<img src="/assets/img/games/cutout/' + f.art + '.webp" alt="" loading="lazy" decoding="async">'
      +   '</span>'
      +   '<span class="gm-card__txt">'
      +     '<span class="gm-card__name">' + esc(f.name) + '</span>'
      +     '<span class="gm-card__co">' + esc(f.company) + '</span>'
      +   '</span>'
      + '</button>';
  }

  function paintRoom() {
    var grid = $('[data-grid]');
    grid.innerHTML = FOUNDERS.map(cardHTML).join('');
    requestAnimationFrame(function () { grid.classList.add('is-in'); });
    paintDock();
  }

  function paintDock() {
    var n = 0;
    for (var k in S.draft) if (S.draft[k] > 0) n++;
    $('[data-dock-sum]').innerHTML =
      '<b>' + ngd(invested()) + ' placed</b>'
      + (n ? n + (n === 1 ? ' founder backed' : ' founders backed') + ' · ' + ngd(available()) + ' left'
           : 'Every founder is optional — ' + ngd(available()) + ' still to place');
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

  /* ---------------------------------------------------------------- the drawer */
  function openSheet(id) {
    var f = byId(id);
    if (!f) return;
    sheetFor = f;
    var rec = site(f);
    var sheet = $('[data-sheet]');

    $('[data-sheet-hero]').innerHTML =
      '<img src="/assets/img/games/scene/' + f.art + '.webp" alt="" decoding="async">';
    $('[data-sheet-name]').textContent = f.name;

    /* Two of the ten have no logo anywhere in the project. Their venture's name is set
       properly instead; nothing is drawn to stand in for a mark that does not exist. */
    var brand = $('[data-sheet-brand]');
    if (rec && rec.logo) {
      brand.innerHTML = '<img class="gm-sheet__logo" src="' + esc(rec.logo) + '" alt="'
        + esc(f.company) + ' logo" decoding="async">';
    } else {
      brand.innerHTML = '<span class="gm-sheet__wordmark">' + esc(f.company) + '</span>';
    }

    $('[data-sheet-blurb]').textContent = rec && rec.blurb ? rec.blurb : '';
    $('[data-sheet-blurb]').hidden = !(rec && rec.blurb);

    var film = $('[data-sheet-film]');
    var src = rec && rec.video && rec.video.type === 'file' ? rec.video.src : '';
    if (src) {
      film.innerHTML = '<div class="gm-film"><video controls playsinline preload="none"'
        + (rec.poster ? ' poster="' + esc(rec.poster) + '"' : '')
        + '><source src="' + esc(src) + '" type="video/mp4"></video></div>';
    } else {
      film.innerHTML = '<p class="gm-nofilm">No pitch film on file for this founder yet — '
        + 'their description above is what the Summit has on record.</p>';
    }

    paintAlloc();
    sheet.hidden = false;
    requestAnimationFrame(function () { sheet.classList.add('is-up'); });
    document.body.style.overflow = 'hidden';
    $('[data-sheet-x]').focus({ preventScroll: true });

    if (!openedOne && !reduced) { openedOne = true; spark(); }
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
      $('[data-sheet-film]').innerHTML = '';     /* drop the video element, not just its sound */
    }, reduced ? 0 : 380);
    if (back) {
      var btn = $('[data-open="' + back.id + '"]');
      if (btn) btn.focus({ preventScroll: true });
    }
    sheetFor = null;
  }

  function paintAlloc() {
    if (!sheetFor) return;
    var f = sheetFor;
    var now = S.draft[f.id] || 0;
    $('[data-alloc-now]').innerHTML = 'Behind ' + esc(f.name.split(' ')[0]) + ' <b class="gm-ngd">'
      + ngd(now) + '</b>';

    var free = available() + now;      /* what this founder could hold if it took everything free */
    var chips = $('[data-chips]');
    var html = '';
    CHIPS.forEach(function (c) {
      html += '<button class="gm-chip" type="button" data-chip="' + c + '"'
        + (c > free ? ' disabled' : '') + '>+' + ngd(c).replace('NG$', 'NG$') + '</button>';
    });
    html += '<button class="gm-chip" type="button" data-chip="max"'
      + (free <= 0 ? ' disabled' : '') + '>All in</button>';
    html += '<button class="gm-chip gm-chip--clear" type="button" data-chip="0"'
      + (now <= 0 ? ' disabled' : '') + '>Remove</button>';
    chips.innerHTML = html;

    var input = $('[data-amount]');
    input.value = now > 0 ? String(now) : '';
    input.max = String(free);
    $('[data-alloc-go]').textContent = now > 0 ? 'Update' : 'Back this founder';
    note('You have ' + ngd(available()) + ' left to place.', false);
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
    if (want > free) {
      note('You only have ' + ngd(free) + ' available for this founder.', true);
      return false;
    }
    if (want === now) return false;
    if (want === 0) delete S.draft[f.id]; else S.draft[f.id] = want;

    markCard(f);
    paintBar();
    paintDock();
    paintAlloc();
    saveDraft();
    if (want > now) coins();
    return true;
  }

  /* ---------------------------------------------------------------- review */
  function rowHTML(f, n, dim) {
    return ''
      + '<li class="gm-row' + (n > 0 ? '' : ' is-zero') + '" style="--tint:' + f.tint + '">'
      +   '<span class="gm-row__pic"><img src="/assets/img/games/cutout/' + f.art
      +     '.webp" alt="" loading="lazy" decoding="async"></span>'
      +   '<span class="gm-row__id"><b>' + esc(f.name) + '</b><span>' + esc(f.company) + '</span></span>'
      +   '<span class="gm-row__amt gm-ngd">' + (n > 0 ? '<b>' + ngd(n) + '</b>' : ngd(0)) + '</span>'
      + '</li>';
  }

  function paintReview() {
    var inv = invested(), left = available();
    var backed = FOUNDERS.filter(function (f) { return (S.draft[f.id] || 0) > 0; });
    var rest = FOUNDERS.filter(function (f) { return !(S.draft[f.id] || 0); });

    $('[data-review-list]').innerHTML =
      backed.map(function (f) { return rowHTML(f, S.draft[f.id]); }).join('')
      + rest.map(function (f) { return rowHTML(f, 0); }).join('');

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
      ask.innerHTML = '<p>You’re keeping <b class="gm-ngd">' + ngd(left)
        + '</b> — ready to lock in your portfolio?</p>'
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
  function paintDone() {
    var p = S.portfolio;
    if (!p) return;
    var backed = FOUNDERS.filter(function (f) { return (p.alloc[f.id] || 0) > 0; });
    var rest = FOUNDERS.filter(function (f) { return !(p.alloc[f.id] || 0); });
    $('[data-done-list]').innerHTML =
      backed.map(function (f) { return rowHTML(f, p.alloc[f.id]); }).join('')
      + rest.map(function (f) { return rowHTML(f, 0); }).join('');
    $('[data-done-in]').textContent = ngd(p.invested);
    $('[data-done-left]').textContent = ngd(p.unspent);
    $('[data-done-sub]').textContent = p.backed === 0
      ? 'You kept all ' + ngd(BUDGET) + ' of your virtual capital.'
      : 'You put ' + ngd(p.invested) + ' behind ' + p.backed
        + (p.backed === 1 ? ' founder.' : ' founders.');
  }

  /* ---------------------------------------------------------------- effects */
  function coins() {
    if (reduced) return;
    var layer = $('[data-coins]');
    if (!layer) return;
    var box = $('[data-alloc-go]').getBoundingClientRect();
    var target = $('[data-w-in]').getBoundingClientRect();
    for (var i = 0; i < 12; i++) {
      (function (i) {
        var c = document.createElement('span');
        c.className = 'gm-coin';
        var x = box.left + box.width / 2 + (Math.random() - 0.5) * 60;
        var y = box.top + box.height / 2;
        c.style.left = x + 'px';
        c.style.top = y + 'px';
        c.style.setProperty('--dx', (target.left + target.width / 2 - x) + 'px');
        c.style.setProperty('--dy', (target.top + 10 - y) + 'px');
        c.style.setProperty('--dur', (720 + Math.random() * 380) + 'ms');
        c.style.animationDelay = (i * 32) + 'ms';
        layer.appendChild(c);
        setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 1600);
      }(i));
    }
  }

  function spark() {
    var layer = $('[data-coins]');
    if (!layer) return;
    var el = document.createElement('span');
    el.className = 'gm-spark';
    el.textContent = '✦ now you’re looking';
    el.style.left = '50%';
    el.style.top = '26%';
    el.style.transform = 'translateX(-50%)';
    layer.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1600);
  }

  /* ---------------------------------------------------------------- sign in */
  function signinMsg(text, kind) {
    var el = $('[data-signin-msg]');
    el.textContent = text || '';
    el.className = 'gm-msg' + (kind ? ' gm-msg--' + kind : '');
  }

  var SAYS = {
    email: 'That address does not look right. Check it and try again.',
    disposable: 'That looks like a throwaway address. Please use one you can read today.',
    cooldown: 'A code just went out. Give it a moment before asking for another.',
    addr_daily: 'That address has asked for too many codes today.',
    ip_hourly: 'Too many codes from this network in the last hour. Try again shortly.',
    mail_not_configured: 'Email sign-in is not switched on here yet.',
    mail: 'The code could not be sent. Try again in a moment.',
    code: 'That code is not right.',
    expired: 'That code has expired. Ask for a new one.',
    attempts: 'Too many tries. Ask for a new code.',
    no_pending: 'Ask for a code first.',
    network: 'No connection. Check your signal and try again.',
    store: 'The game store is unavailable. Tell the NextGen team.',
    closed: 'Submissions have closed.',
    over_budget: 'That is more than NG$10,000.',
    not_whole: 'NG$ comes in whole numbers only.',
    unknown_founder: 'That founder is not in this game.',
    already_submitted: 'Your portfolio is already locked in.'
  };
  function says(r) { return SAYS[r && r.reason] || 'Something went wrong. Try again.'; }

  function step(which) {
    $('[data-step="email"]').hidden = which !== 'email';
    $('[data-step="code"]').hidden = which !== 'code';
    signinMsg('');
    var el = which === 'code' ? $('[data-code]') : $('[data-email]');
    if (el) setTimeout(function () { el.focus(); }, 60);
  }

  /* ---------------------------------------------------------------- routing */
  function route() {
    if (!S.signedIn) { show('signin'); return; }
    if (S.submitted) { paintBar(); paintDone(); show('done'); return; }
    paintBar(); paintRoom(); show('room');
  }

  /* Both notices can be true at once, and the first version showed only the demo one -- so a
     demo player on a closed game was told the thing that mattered least and found out the
     rest by having a submission refused. Closed goes first, because it changes what they can
     do; the demo note goes after, because it changes what their result means. */
  function banner() {
    var b = $('[data-banner]');
    if (!b) return;
    var say = [];
    var stop = false;
    if (!S.open && !S.submitted) {
      say.push('<b>Submissions are closed.</b> You can still look around and read the '
        + 'founders, but a new portfolio cannot be locked in.');
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
    /* ---- sign in ---- */
    $('[data-send]').addEventListener('click', function () {
      var v = $('[data-email]').value.trim();
      if (!v) { signinMsg('Enter your email address.', 'bad'); return; }
      this.disabled = true;
      signinMsg('Sending a code…');
      var btn = this;
      api('otp-start', { email: v }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) {
          signinMsg(says(r) + (r.wait ? ' (' + r.wait + 's)' : ''), 'bad');
          return;
        }
        email = v;
        $('[data-mask]').textContent = r.mask || v;
        step('code');
        signinMsg('Code sent. It expires in ten minutes.', 'ok');
      });
    });

    $('[data-verify]').addEventListener('click', function () {
      var c = $('[data-code]').value.replace(/\D+/g, '');
      if (c.length !== 6) { signinMsg('Enter the six digits from your email.', 'bad'); return; }
      this.disabled = true;
      signinMsg('Checking…');
      var btn = this;
      api('otp-check', { email: email, code: c }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) {
          signinMsg(says(r) + (typeof r.tries_left === 'number'
            ? ' ' + r.tries_left + ' left.' : ''), 'bad');
          return;
        }
        take(r);
        email = '';
        banner();
        route();
      });
    });

    $('[data-again]').addEventListener('click', function () { step('email'); });

    $('[data-demo]').addEventListener('click', function () {
      this.disabled = true;
      var btn = this;
      api('demo-signin', {}).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { signinMsg(says(r), 'bad'); return; }
        take(r); banner(); route();
      });
    });

    [['data-email', 'data-send'], ['data-code', 'data-verify']].forEach(function (p) {
      $('[' + p[0] + ']').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); $('[' + p[1] + ']').click(); }
      });
    });

    /* ---- the room ---- */
    $('[data-grid]').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-open]') : null;
      if (b) openSheet(b.getAttribute('data-open'));
    });

    /* ---- the drawer ---- */
    var sheet = $('[data-sheet]');
    $('[data-sheet-x]').addEventListener('click', closeSheet);
    $('[data-sheet-veil]').addEventListener('click', closeSheet);

    $('[data-chips]').addEventListener('click', function (e) {
      var c = e.target.closest ? e.target.closest('[data-chip]') : null;
      if (!c || c.disabled || !sheetFor) return;
      var v = c.getAttribute('data-chip');
      var now = S.draft[sheetFor.id] || 0;
      if (v === 'max') place(sheetFor, now + available());
      else if (v === '0') place(sheetFor, 0);
      else place(sheetFor, now + parseInt(v, 10));
    });

    $('[data-alloc-go]').addEventListener('click', function () {
      if (!sheetFor) return;
      var raw = $('[data-amount]').value.trim();
      if (raw === '') { place(sheetFor, 0); return; }
      if (!/^\d+$/.test(raw)) { note('Whole NG$ only — no decimals.', true); return; }
      place(sheetFor, parseInt(raw, 10));
    });
    $('[data-amount]').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('[data-alloc-go]').click(); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !sheet.hidden) { e.preventDefault(); closeSheet(); }
    });

    /* Focus stays in the sheet while it is up; it is a dialog over a page of buttons. */
    sheet.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' || sheet.hidden) return;
      var f = $$('button:not([disabled]), input, video, [tabindex]:not([tabindex="-1"])', sheet)
        .filter(function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    /* ---- moving between panels ---- */
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
      paintBar(); paintDone(); show('done');
      var hero = $('[data-done-hero]');
      if (hero && !reduced) { hero.classList.remove('gm-pop'); void hero.offsetWidth; hero.classList.add('gm-pop'); }
    }).catch(function (e) {
      /* The portfolio may well be saved -- this only means the screen could not be drawn.
         Never leave a live-event button reading "Locking in..." with nothing happening:
         give it back, say so, and let `boot()` find out from the server what is actually
         true rather than guessing from here. */
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
      S.booted = true;
      $('[data-demo-wrap]').hidden = !(S.demoAllowed && !S.signedIn);
      if (!S.mailReady && !S.signedIn) {
        signinMsg('Email sign-in is not available on this server yet.', 'bad');
        $('[data-send]').disabled = true;
      }
      banner();
      route();
    });
  }

  function start() {
    if (!$('[data-screen="room"]')) return;         /* not the game page */
    wire();
    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
