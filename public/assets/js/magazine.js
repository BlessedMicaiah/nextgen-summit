/* ============================================================================
   TOP 10 — the People's Choice magazine.

   Ten covers on a rack. Pick one, the cover opens on the spine, and the issue inside runs
   the pitch on the left and the founder on the right, then closes on a sign-off page.

   Built against the ten concept boards in NextGen_Top10_Magazine_Design_Handoff.
   Those boards are art direction, not source material, and the difference matters:

     TAKEN FROM THEM   the structure (masthead, side rail, name over company over rule over
                       description, "THE PITCH | OPEN THE STORY"), the two-page spread, the
                       editorial voice, and each founder's accent colour -- sampled from the
                       company-name line of their own board, then brought to one consistent
                       editorial saturation so ten issues read as one publication.

     NOT TAKEN         every word the boards put in a founder's mouth. Each board carries a
                       pull quote attributed to its founder, a running time, and a set of
                       three-word value props. All three were generated. None appear here.
                       The only prose on these pages is each founder's own `blurb` from the
                       manifest, and the running time is read off the video file itself.

   WHERE THE CONTENT COMES FROM

   window.NGS_FOUNDERS, which tools/build-founders.py generates from the Top 20 manifest.
   Nothing is written here. The manifest has `bio: null` for all twenty founders, so where
   there is no profile the page says there is none rather than filling the hole.

   THE SIGN-OFF

   The brief suggested "See you at NextGen. I can't wait to share my pitch!" -- first person,
   as though the founder said it. No founder supplied it, and the design handoff's own note
   says not to impersonate founders. So the headline is kept verbatim as NextGen addressing
   the reader, and the second line is rewritten into NextGen's voice. Nothing on the page is
   attributed to a founder. If the founders approve the original wording, swap SIGN_OFF.
   ========================================================================= */
(function () {
  'use strict';

  /* ------------------------------------------------------------------------
     THE COLLECTION

     `ids` is the ten, in order. `confirmed` says whether this is the official Top 10.

     While it is false the page is an internal design collection and says so in the banner,
     because voting is open and publishing ten names as a result would be a result. When
     leadership confirms the Top 10, set the ids if they changed and flip `confirmed` to
     true: the banner goes, and nothing else needs touching.

     Set `ids` to null to fall back to the live standings instead (also labelled).
     --------------------------------------------------------------------- */
  var ISSUES = {
    ids: [
      'entrant-01',   /* Caleb Orji            — Haptol Labs             */
      'entrant-02',   /* Annrita Karu          — Credible blossom        */
      'entrant-20',   /* Vishwa Shukla         — Find Your Mission Corp. */
      'entrant-03',   /* Muyiwa Ogunsola       — Sooz                    */
      'entrant-04',   /* Ariel Laura Métayer   — The Luminous Lab        */
      'entrant-05',   /* Ethan Edouard         — Lookbook                */
      'entrant-06',   /* Velma Funebe          — iBraid                  */
      'entrant-07',   /* Divine Ayomide Fiolu  — BeforeKeys LLC          */
      'entrant-08',   /* Jolie Wyatt           — If The Shoe Fits (ITSF) */
      'entrant-09'    /* Austin Kendrick Lee   — Rest                    */
    ],
    confirmed: false
  };

  var HOW_MANY = 10;

  /* Each founder's accent, keyed by entrant id so it belongs to the PERSON and not to a
     position in a list -- reorder the ten and everybody keeps their colour.

     Sampled from the company-name line of each concept board, then held to one saturation
     and lightness band. The boards run at full neon (#08F8F8, #F8F808); printed on a dark
     page at that strength they glow rather than sit, which is the "AI look" the brief asks
     to lose. Same hue, editorial weight.

     Three boards came back cyan and two came back lime. Rather than give three issues the
     same colour, each keeps its hue and moves in depth -- Caleb deep teal, Vishwa bright
     cyan, Muyiwa aqua -- so the rack reads as ten issues of one magazine. */
  var ACCENT = {
    'entrant-01': '#2BB8C6',   /* Haptol Labs             — cyan, deepened    */
    'entrant-02': '#E3C64A',   /* Credible blossom        — yellow            */
    'entrant-20': '#4FDCE0',   /* Find Your Mission Corp. — cyan, bright      */
    'entrant-03': '#67DFC6',   /* Sooz                    — aqua              */
    'entrant-04': '#B985F2',   /* The Luminous Lab        — lilac             */
    'entrant-05': '#AEDB4C',   /* Lookbook                — lime, green side  */
    'entrant-06': '#F0417E',   /* iBraid                  — crimson pink      */
    'entrant-07': '#9B7BF0',   /* BeforeKeys LLC          — violet            */
    'entrant-08': '#F57FB0',   /* If The Shoe Fits (ITSF) — rose              */
    'entrant-09': '#E2DC4A'    /* Rest                    — lime, yellow side */
  };
  var ACCENT_FALLBACK = '#1FC7BE';   /* the brand turquoise, for anyone outside the ten */

  /* NextGen's own line, lifted from the boards' cover rail. The publication speaking. */
  var RAIL = ['Real', 'people', 'building', 'a brighter', 'tomorrow'];

  var SIGN_OFF = {
    kicker: 'A NextGen sign-off',
    head: 'See you at NextGen.',
    /* %NAME% and %CO% are filled in below. Deliberately in NextGen's voice: no founder
       supplied a sign-off, and the design handoff says not to impersonate them. */
    body: 'We can’t wait to share %NAME%’s pitch for %CO% with the NextGen community.'
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };

  var stage = $('[data-mag-stage]');
  var shelf = $('[data-mag-shelf]');
  var statusEl = $('[data-mag-status]');
  if (!stage || !shelf) return;

  var left = $('[data-mag-left]', stage);
  var right = $('[data-mag-right]', stage);
  var off = $('[data-mag-off]', stage);
  var cover = $('[data-mag-cover]', stage);
  var idxEl = $('[data-mag-index]', stage);
  var totEl = $('[data-mag-total]', stage);
  var footEl = $('[data-mag-foot]', stage);
  var btnPrev = $('[data-mag-prev]', stage);
  var btnNext = $('[data-mag-next]', stage);
  var btnClose = $('[data-mag-close]', stage);
  var railPrev = $('[data-shelf-prev]');
  var railNext = $('[data-shelf-next]');

  var issues = [];
  var at = -1;
  var open = false;
  var leaf = 'spread';        /* 'spread' or 'signoff' */
  var video = null;
  var probe = null;

  var reduced = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function accentOf(f) { return ACCENT[f.entrant] || ACCENT_FALLBACK; }

  /* GTM is already on this page; these follow the ngs_pc_ convention the rest of the site
     uses, so the existing trigger catches them. An entrant id is a pitch, not a person: no
     name, no email, no voter in any payload. */
  function track(name, data) {
    try {
      window.dataLayer = window.dataLayer || [];
      var e = { event: 'ngs_pc_' + name };
      for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) e[k] = data[k];
      window.dataLayer.push(e);
    } catch (err) { /* analytics must never break the page */ }
  }

  /* ---------------------------------------------------------------------
     Choosing the ten.
     ------------------------------------------------------------------ */
  function founders() {
    var all = Array.isArray(window.NGS_FOUNDERS) ? window.NGS_FOUNDERS : [];
    return all.filter(function (f) { return f && f.entrant && f.name; });
  }

  function byId(list) {
    var m = {};
    list.forEach(function (f) { m[f.entrant] = f; });
    return m;
  }

  function say(kind, text) {
    if (!statusEl) return;
    statusEl.innerHTML = '<span><b>' + esc(kind) + '</b>' + text + '</span>';
    statusEl.hidden = false;
  }

  function pick() {
    var all = founders();
    var map = byId(all);

    if (ISSUES.ids && ISSUES.ids.length) {
      var chosen = ISSUES.ids.map(function (id) { return map[id]; }).filter(Boolean);
      if (chosen.length) {
        if (ISSUES.confirmed) {
          if (statusEl) statusEl.hidden = true;
        } else {
          say('Internal design collection — not a result',
            ' Voting is open until 11:59pm ET on 28 October. These ten founders are the '
            + 'design collection for this page, in the order it was art-directed. They are '
            + 'not the Top 10, and the order is not a standing.');
        }
        return Promise.resolve(chosen.slice(0, HOW_MANY));
      }
      /* The ids were set but match nothing -- a typo, or the manifest was regenerated.
         Falling through silently would publish a different ten than somebody meant to. */
      say('Check the list', ' The entrant ids set for this page do not match the current '
        + 'founder manifest, so the live standings are shown instead. ');
    }

    return fetch('/api/pc-rank.php', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ok && d.ranked && Array.isArray(d.order)) {
          say('Internal preview — not a result',
            ' Voting is open until 11:59pm ET on 28 October. This order is the current '
            + 'standing, shown so the page can be reviewed before the Top 10 is confirmed. '
            + 'It is not the final Top 10 and will change.');
          return d.order.map(function (id) { return map[id]; })
            .filter(Boolean).slice(0, HOW_MANY);
        }
        /* `ranked` false means the server will not publish an order. Inventing a top ten out
           of that would be a fabrication. */
        say('Internal preview — no ranking yet',
          ' The standings are not being published yet, so these are the first ten founders '
          + 'in contestant order. Not a ranking.');
        return all.slice(0, HOW_MANY);
      })
      .catch(function () {
        say('Internal preview — standings unavailable',
          ' The live standings could not be read, so these are the first ten founders in '
          + 'contestant order. Not a ranking.');
        return all.slice(0, HOW_MANY);
      });
  }

  /* ---------------------------------------------------------------------
     Shared pieces.
     ------------------------------------------------------------------ */
  function slotNo(f) {
    var m = /(\d+)\s*$/.exec(f.entrant || '');
    return m ? m[1] : '';
  }

  /* A founder's own pitch page is /pitch/peoples-choice/<slug>/, and the slug is built from
     their NAME -- see pc_slug() in api/pc-rules.php, which entrant.php resolves against.
     Not f.slug, which is the company. The wrong one 404s. */
  function nameSlug(f) {
    return String(f.name || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  /* story/story2x is a 320px square crop for the story rail; shot/shot2x is the real
     portrait at 780px and up. Only the latter holds up at magazine size. */
  function portraitSrc(f) { return f.shot || f.story || ''; }
  function portraitSet(f) {
    if (f.shot && f.shot2x) return ' srcset="' + esc(f.shot) + ' 1x, ' + esc(f.shot2x) + ' 2x"';
    if (!f.shot && f.story && f.story2x) return ' srcset="' + esc(f.story) + ' 1x, ' + esc(f.story2x) + ' 2x"';
    return '';
  }

  /* Every logo in the library is an opaque WebP -- none carries an alpha channel, checked
     file by file -- so each one brings its own background with it. Dropped straight onto a
     dark cover it would read as a rectangle of whatever colour that file happens to be. A
     white chip keeps the artwork exactly as supplied, at its own proportions, and gives it
     the contrast the brief asks for. Nothing is recoloured, stretched or redrawn.

     Three of the ten have no logo in the library at all: The Luminous Lab, iBraid and Rest.
     They get no mark rather than an invented one, and the gap is reported, not papered over. */
  function logoChip(f, cls) {
    if (!f.logo) return '';
    return '<span class="' + cls + '" data-chip><img src="' + esc(f.logo) + '" alt="'
      + esc(f.company) + ' logo" loading="lazy" decoding="async"></span>';
  }

  /* Which way a chip should go, decided by the logo itself rather than by eye.
     Of the seven logos the ten use, four were drawn on white (Haptol Labs, Lookbook,
     BeforeKeys, If The Shoe Fits) and three on their own dark ground (Credible blossom's
     teal, Sooz's and Find Your Mission's near-black). A white tile behind a dark-ground
     logo shows as a dark square inside a white square, which is worse than no tile at all.
     So the four corners are sampled once per file: light ground keeps the white tile, dark
     ground drops it and sits on the page with a hairline instead. Nothing is recoloured.

     Reading pixels back needs same-origin, which /assets/ is. If it ever throws -- a
     cross-origin CDN, a canvas-blocked browser -- the white tile is the safe default. */
  var chipCache = {};
  function fitChips() {
    var chips = stage.querySelectorAll('[data-chip]');
    for (var i = 0; i < chips.length; i++) (function (chip) {
      var img = chip.querySelector('img');
      if (!img) return;
      var key = img.getAttribute('src');
      if (chipCache[key] !== undefined) { chip.classList.toggle('is-dark', chipCache[key]); return; }
      var decide = function () {
        var dark = false;
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) return;
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          var g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          var sum = 0, pts = [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]];
          for (var k = 0; k < 4; k++) {
            var d = g.getImageData(pts[k][0], pts[k][1], 1, 1).data;
            sum += (d[0] * 0.299 + d[1] * 0.587 + d[2] * 0.114) / 4;
          }
          dark = sum < 150;
        } catch (e) { dark = false; }
        chipCache[key] = dark;
        chip.classList.toggle('is-dark', dark);
      };
      if (img.complete && img.naturalWidth) decide();
      else img.addEventListener('load', decide, { once: true });
    }(chips[i]));
  }

  function masthead(cls) {
    return '<span class="' + cls + '">next<i>gen</i><b>.</b>'
      + '<span>People&rsquo;s Choice</span></span>';
  }

  /* ---------------------------------------------------------------------
     The rack.
     ------------------------------------------------------------------ */
  function miniHTML(f, i) {
    var img = portraitSrc(f);
    return ''
      + '<button class="mag-mini" type="button" data-go="' + i + '"'
      +         ' style="--issue:' + accentOf(f) + '"'
      +         ' aria-label="Open issue ' + (i + 1) + ', ' + esc(f.name) + ' of ' + esc(f.company) + '">'
      +   (img ? '<img class="mag-mini__img" src="' + esc(img) + '"' + portraitSet(f) + ' alt=""'
      +          ' loading="lazy" decoding="async"'
      +          (f.focal ? ' style="object-position:' + esc(f.focal) + '"' : '') + '>' : '')
      +   '<span class="mag-mini__tone" aria-hidden="true"></span>'
      +   '<span class="mag-mini__top" aria-hidden="true">'
      +     '<span class="mag-mini__mark">next<i>gen</i><b>.</b></span>'
      +     '<span class="mag-mini__no">' + String(i + 1).padStart(2, '0') + '</span>'
      +   '</span>'
      +   '<span class="mag-mini__foot" aria-hidden="true">'
      +     '<span class="mag-mini__rule"></span>'
      +     '<span class="mag-mini__name">' + esc(f.name) + '</span>'
      +     '<span class="mag-mini__co">' + esc(f.company) + '</span>'
      +   '</span>'
      + '</button>';
  }

  function drawShelf() {
    shelf.innerHTML = issues.map(function (f, i) {
      return '<li class="mag-shelf__slot">' + miniHTML(f, i) + '</li>';
    }).join('');
    if (totEl) totEl.textContent = String(issues.length).padStart(2, '0');
    railState();
  }

  function railState() {
    if (!railPrev || !railNext) return;
    var max = shelf.scrollWidth - shelf.clientWidth - 2;
    railPrev.disabled = shelf.scrollLeft <= 2;
    railNext.disabled = shelf.scrollLeft >= max;
  }

  function nudgeRail(dir) {
    var slot = shelf.querySelector('.mag-shelf__slot');
    var step = slot ? slot.offsetWidth * 3 : 320;
    shelf.scrollBy({ left: dir * step, behavior: reduced ? 'auto' : 'smooth' });
  }

  function markCurrent() {
    var all = shelf.querySelectorAll('.mag-mini');
    for (var i = 0; i < all.length; i++) {
      all[i].setAttribute('aria-current', i === at ? 'true' : 'false');
    }
    /* The rail is scrolled by hand rather than with scrollIntoView, which also scrolls every
       ancestor: turning a page threw the whole document up the screen. One axis, one node. */
    var now = all[at];
    if (!now) return;
    var slot = now.parentNode;
    var want = slot.offsetLeft - (shelf.clientWidth - slot.offsetWidth) / 2;
    want = Math.max(0, Math.min(want, shelf.scrollWidth - shelf.clientWidth));
    if (Math.abs(want - shelf.scrollLeft) > 2) {
      shelf.scrollTo({ left: want, behavior: reduced ? 'auto' : 'smooth' });
    }
  }

  /* ---------------------------------------------------------------------
     The cover.
     ------------------------------------------------------------------ */
  function coverHTML(f, i) {
    var img = portraitSrc(f);
    return ''
      + (img ? '<img class="mag-cover__img" src="' + esc(img) + '"' + portraitSet(f) + ' alt=""'
        + (f.focal ? ' style="object-position:' + esc(f.focal) + '"' : '') + ' decoding="async">' : '')
      + '<span class="mag-cover__tone" aria-hidden="true"></span>'
      + '<span class="mag-cover__in">'
      +   '<span class="mag-cover__top">'
      +     masthead('mag-cover__mast')
      +     '<span class="mag-cover__meta">'
      +       '<span class="mag-cover__no">Issue ' + String(i + 1).padStart(2, '0') + '</span>'
      +       logoChip(f, 'mag-cover__logo')
      +     '</span>'
      +   '</span>'
      +   '<span class="mag-cover__rail">'
      +     RAIL.map(function (w) { return '<i>' + esc(w) + '</i>'; }).join('')
      +   '</span>'
      +   '<span class="mag-cover__foot">'
      +     '<span class="mag-cover__name">' + esc(f.name) + '</span>'
      +     '<span class="mag-cover__co">' + esc(f.company) + '</span>'
      +     '<span class="mag-cover__hr"></span>'
      +     '<span class="mag-cover__blurb">' + esc(f.blurb || '') + '</span>'
      +     '<span class="mag-cover__cta">'
      +       '<i>The pitch</i>'
      +       '<em>Open the story'
      +         '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12 5l7 7-7 7"/></svg>'
      +       '</em>'
      +     '</span>'
      +   '</span>'
      + '</span>';
  }

  /* ---------------------------------------------------------------------
     Left page: the pitch.
     ------------------------------------------------------------------ */
  function leftHTML(f) {
    var src = f.video && f.video.type === 'file' ? f.video.src : '';
    var poster = f.poster || portraitSrc(f);
    var head = '<span class="mag-lab">' + masthead('mag-lab__mast') + '<i>The pitch</i></span>';
    if (!src) {
      return head + '<p class="mag-gap">No pitch video has been supplied for this founder.</p>';
    }
    /* The boards print a running time under "WATCH THE PITCH". Theirs was generated; this
       one is read off the file in stampDuration(), and stays blank until it is known. */
    return head
      + '<div class="mag-pitch" data-pitch>'
      +   '<button class="mag-film" type="button" data-play data-src="' + esc(src) + '"'
      +           ' aria-label="Play ' + esc(f.name) + '&rsquo;s pitch video">'
      +     (poster ? '<img class="mag-film__poster" src="' + esc(poster) + '" alt="" decoding="async">' : '')
      +     '<span class="mag-film__scrim" aria-hidden="true"></span>'
      +     '<span class="mag-film__play" aria-hidden="true">'
      +       '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>'
      +     '<span class="mag-film__cap" aria-hidden="true">'
      +       '<b>Watch the pitch</b><i data-dur></i></span>'
      +   '</button>'
      +   '<div class="mag-pitch__copy">'
      +     '<p class="mag-pitch__lede">' + esc(f.name)
      +       ' recorded this pitch for the NextGen Summit People&rsquo;s Choice Award.</p>'
      +     '<p class="mag-pitch__sub">Their own description of the business follows.</p>'
      +   '</div>'
      + '</div>';
  }

  /* ---------------------------------------------------------------------
     Right page: the founder.
     ------------------------------------------------------------------ */
  function rightHTML(f) {
    var facts = [];
    if (slotNo(f)) facts.push('Contestant ' + slotNo(f));
    facts.push('People&rsquo;s Choice 2026');
    if (f.video && f.video.type === 'file') facts.push('Pitch on film');

    return ''
      + '<span class="mag-lab mag-lab--end"><i>Founder story</i></span>'
      + '<div class="mag-head">'
      +   logoChip(f, 'mag-head__logo')
      +   '<div class="mag-head__t">'
      +     '<h3 class="mag-name wm">' + esc(f.name) + '</h3>'
      +     '<p class="mag-co">' + esc(f.company) + '</p>'
      +   '</div>'
      + '</div>'
      + '<div class="mag-rule" aria-hidden="true"></div>'
      + '<p class="mag-dek">' + esc(f.blurb || '') + '</p>'
      + '<ul class="mag-facts">' + facts.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>'
      /* No founder in the manifest has a biography, so the page says that rather than
         borrowing the boards' invented one. */
      + '<p class="mag-gap">A longer profile has not been supplied for this founder yet. '
      +   'Everything above is their own description and their own pitch.</p>'
      + '<div class="mag-ends">'
      +   '<a class="mag-link" href="/pitch/peoples-choice/' + esc(nameSlug(f)) + '/">'
      +     'Explore full story'
      +     '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12 5l7 7-7 7"/></svg>'
      +   '</a>'
      +   '<button class="mag-link mag-link--ghost" type="button" data-mag-signoff>'
      +     'Read the sign-off'
      +     '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12 5l7 7-7 7"/></svg>'
      +   '</button>'
      + '</div>';
  }

  /* ---------------------------------------------------------------------
     The last page: the sign-off. NextGen's voice throughout; see SIGN_OFF.
     ------------------------------------------------------------------ */
  function offHTML(f) {
    var img = portraitSrc(f);
    var nxt = issues[(at + 1) % issues.length];
    var body = esc(SIGN_OFF.body)
      .replace('%NAME%', '<b>' + esc(f.name) + '</b>')
      .replace('%CO%', '<b>' + esc(f.company) + '</b>');
    return ''
      + '<div class="mag-off__plate">'
      +   (img ? '<img src="' + esc(img) + '"' + portraitSet(f) + ' alt="' + esc(f.name) + '"'
      +     (f.focal ? ' style="object-position:' + esc(f.focal) + '"' : '') + ' loading="lazy">' : '')
      + '</div>'
      + '<div class="mag-off__copy">'
      +   '<p class="mag-off__kicker">' + esc(SIGN_OFF.kicker) + '</p>'
      +   '<p class="mag-off__t wm">' + esc(SIGN_OFF.head) + '</p>'
      +   '<p class="mag-off__p">' + body + '</p>'
      +   '<div class="mag-off__sig">'
      +     logoChip(f, 'mag-off__logo')
      +     '<span><b>' + esc(f.name) + '</b><i>' + esc(f.company) + '</i></span>'
      +   '</div>'
      +   '<div class="mag-ends">'
      +     '<button class="mag-link" type="button" data-mag-nextissue>'
      +       'Explore the next founder'
      +       '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12 5l7 7-7 7"/></svg>'
      +     '</button>'
      +     '<button class="mag-link mag-link--ghost" type="button" data-mag-back>'
      +       '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H6M12 5l-7 7 7 7"/></svg>'
      +       'Back to the story'
      +     '</button>'
      +   '</div>'
      +   '<p class="mag-off__next">Next: ' + esc(nxt ? nxt.name : '') + '</p>'
      + '</div>';
  }

  /* ---------------------------------------------------------------------
     Film: orientation, running time, playback.
     ------------------------------------------------------------------ */

  /* Most pitches in the manifest are phone verticals, a few are landscape, so the layout is
     decided by the poster's own dimensions rather than by an assumption. */
  function markFilm() {
    var wrap = stage.querySelector('[data-pitch]');
    if (!wrap) return;
    var img = wrap.querySelector('.mag-film__poster');
    if (!img) { wrap.classList.add('is-wide'); return; }
    var decide = function () {
      if (!img.naturalWidth) return;
      wrap.classList.toggle('is-wide', img.naturalWidth > img.naturalHeight);
    };
    if (img.complete) decide();
    else img.addEventListener('load', decide, { once: true });
  }

  /* Reads the real running time. preload="metadata" fetches the header, not the film. */
  function stampDuration(src) {
    if (probe) { try { probe.src = ''; } catch (e) {} probe = null; }
    var slot = stage.querySelector('[data-dur]');
    if (!slot || !src) return;
    var want = at;
    var v = document.createElement('video');
    probe = v;
    v.preload = 'metadata';
    v.muted = true;
    v.addEventListener('loadedmetadata', function () {
      if (at === want && isFinite(v.duration) && v.duration > 0) {
        var s = Math.round(v.duration);
        slot.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      }
      try { v.src = ''; } catch (e) {}
      if (probe === v) probe = null;
    }, { once: true });
    v.src = src;
  }

  function dropVideo() {
    if (!video) return;
    try { video.pause(); } catch (e) {}
    video.removeAttribute('src');
    try { video.load(); } catch (e) {}
    if (video.parentNode) video.parentNode.removeChild(video);
    video = null;
    var playing = stage.querySelector('.mag-film.is-playing');
    if (playing) playing.classList.remove('is-playing');
  }

  function play(btn) {
    var src = btn.getAttribute('data-src');
    if (!src) return;
    dropVideo();
    video = document.createElement('video');
    video.className = 'mag-film__video';
    video.src = src;
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('controlsList', 'nodownload');
    btn.appendChild(video);
    btn.classList.add('is-playing');
    var f = issues[at];
    track('top10_play', { entrant_id: f ? f.entrant : '', slot: at + 1 });
    var p = video.play();
    if (p && p.catch) p.catch(function () { /* a blocked autoplay leaves the controls */ });
  }

  /* ---------------------------------------------------------------------
     Showing an issue.
     ------------------------------------------------------------------ */
  function show(i, opts) {
    if (!issues.length) return;
    i = (i + issues.length) % issues.length;          /* the collection wraps */
    var f = issues[i];
    var wasOpen = open;
    dropVideo();

    at = i;
    stage.hidden = false;
    stage.style.setProperty('--issue', accentOf(f));
    cover.setAttribute('aria-label', 'Open issue ' + (i + 1) + ', ' + f.name + ' of ' + f.company);
    leaf = 'spread';

    var paint = function () {
      left.innerHTML = leftHTML(f);
      right.innerHTML = rightHTML(f);
      off.innerHTML = offHTML(f);
      cover.innerHTML = coverHTML(f, i);
      markFilm();
      fitChips();
      stampDuration(f.video && f.video.type === 'file' ? f.video.src : '');
      setLeaf('spread');
      if (idxEl) idxEl.textContent = String(i + 1).padStart(2, '0');
      if (footEl) {
        footEl.textContent = ISSUES.confirmed
          ? 'Issue ' + (i + 1) + ' of ' + issues.length
          : 'Issue ' + (i + 1) + ' of ' + issues.length + ' — internal design collection';
      }
      markCurrent();
      stage.classList.remove('is-turning');
    };

    /* Turning a page should look like turning a page: the old spread leaves before the new
       one arrives. Only when the book is already open -- opening it is its own animation. */
    if (wasOpen && !reduced && !(opts && opts.instant)) {
      stage.classList.add('is-turning');
      window.setTimeout(paint, 190);
    } else {
      paint();
    }

    if (opts && opts.open) setOpen(true);
    if (!(opts && opts.keepScroll)) {
      var box = stage.getBoundingClientRect();
      if (box.top < 0 || box.top > window.innerHeight * 0.5) {
        stage.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      }
    }
  }

  function setLeaf(which) {
    leaf = which;
    var on = which === 'signoff';
    stage.classList.toggle('is-signoff', on);
    off.setAttribute('aria-hidden', (open && on) ? 'false' : 'true');
    left.setAttribute('aria-hidden', (open && !on) ? 'false' : 'true');
    right.setAttribute('aria-hidden', (open && !on) ? 'false' : 'true');
    if (on) dropVideo();
  }

  function setOpen(v) {
    open = !!v;
    stage.classList.toggle('is-open', open);
    /* Disabling it is what takes it out of the tab order and out of the accessibility tree's
       list of things you can press -- which is exactly true once the issue is open. */
    cover.disabled = open;
    cover.setAttribute('aria-hidden', open ? 'true' : 'false');
    if (btnClose) btnClose.disabled = !open;
    if (!open) dropVideo();
    setLeaf(open ? leaf : 'spread');
    var f = issues[at];
    track(open ? 'top10_open' : 'top10_close', { entrant_id: f ? f.entrant : '', slot: at + 1 });
    if (open) {
      var h = stage.querySelector(leaf === 'signoff' ? '.mag-off__kicker' : '.mag-lab');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
  }

  function close() {
    setOpen(false);
    var card = shelf.querySelectorAll('.mag-mini')[at];
    if (card) card.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------------------
     Wiring.
     ------------------------------------------------------------------ */
  shelf.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-go]') : null;
    if (!btn) return;
    show(parseInt(btn.getAttribute('data-go'), 10), { open: true });
  });
  shelf.addEventListener('scroll', railState, { passive: true });
  window.addEventListener('resize', railState);

  if (railPrev) railPrev.addEventListener('click', function () { nudgeRail(-1); });
  if (railNext) railNext.addEventListener('click', function () { nudgeRail(1); });

  cover.addEventListener('click', function () { if (!open) setOpen(true); });

  stage.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var p = t.closest('[data-play]');
    if (p && !p.classList.contains('is-playing')) { play(p); return; }
    if (t.closest('[data-mag-signoff]')) {
      setLeaf('signoff');
      var k = off.querySelector('.mag-off__kicker');
      if (k) { k.setAttribute('tabindex', '-1'); k.focus({ preventScroll: true }); }
      var f = issues[at];
      track('top10_signoff', { entrant_id: f ? f.entrant : '', slot: at + 1 });
      return;
    }
    if (t.closest('[data-mag-back]')) { setLeaf('spread'); return; }
    if (t.closest('[data-mag-nextissue]')) {
      show(at + 1, { open: true, keepScroll: true });
    }
  });

  if (btnPrev) btnPrev.addEventListener('click', function () { show(at - 1, { open: open, keepScroll: true }); });
  if (btnNext) btnNext.addEventListener('click', function () { show(at + 1, { open: open, keepScroll: true }); });
  if (btnClose) btnClose.addEventListener('click', close);

  document.addEventListener('keydown', function (e) {
    if (stage.hidden) return;
    var t = e.target;
    /* arrow keys belong to a focused video's scrub bar, not to us */
    if (t && (t.tagName === 'VIDEO' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      if (leaf === 'signoff') setLeaf('spread'); else close();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault(); show(at - 1, { open: open, keepScroll: true });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault(); show(at + 1, { open: open, keepScroll: true });
    }
    /* Enter and Space on the cover need no handler: it is a real <button>. */
  });

  /* A horizontal swipe turns the page on a phone, where there are no arrow keys and the
     prev/next buttons are a thumb-stretch away. Vertical movement is left alone -- stealing
     it would break scrolling, which is how the spread is read on a small screen. */
  (function swipe() {
    var x0 = 0, y0 = 0, on = false;
    stage.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { on = false; return; }
      on = true; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (!on || !open) return;
      on = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - x0, dy = t.clientY - y0;
      if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.8) {
        show(at + (dx < 0 ? 1 : -1), { open: true, keepScroll: true });
      }
    }, { passive: true });
  }());

  /* a tab change should not leave a pitch playing to an empty room */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && video) { try { video.pause(); } catch (e) {} }
  });

  /* ---------------------------------------------------------------------
     Go.
     ------------------------------------------------------------------ */
  function start() {
    if (!founders().length) {
      shelf.innerHTML = '<li class="mag-shelf__loading">The founder list could not be loaded.</li>';
      return;
    }
    pick().then(function (ten) {
      issues = ten;
      if (!issues.length) {
        shelf.innerHTML = '<li class="mag-shelf__loading">No founders to show.</li>';
        return;
      }
      drawShelf();
      show(0, { instant: true, keepScroll: true });   /* cover shut, waiting to be opened */
      setOpen(false);
      track('top10_view', { entrants: issues.length, provisional: ISSUES.confirmed ? 0 : 1 });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
