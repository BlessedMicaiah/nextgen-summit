/* ============================================================================
   THE NEXTGEN EDITION — the People's Choice magazine.

   Built from NextGen_Caleb_First_Magazine_Prototype_Kit.

   SCOPE: ONE ISSUE

   Issue 01 -- Caleb Orji / Haptol Labs -- is finished and opens. The other nine stand in
   the rack as labelled placeholders and cannot be opened.

   That is a one-line change, not a deletion. READY below is the whole gate: every render
   function, the spread, the closing page, the video handling and the keyboard model are
   shared and already work for all ten. Adding an entrant id to READY turns that issue on.
   Nothing about the other nine has been removed, rewritten or stubbed.

   WHERE THE CONTENT COMES FROM

   window.NGS_FOUNDERS, which tools/build-founders.py generates from the Top 20 manifest.
   Nothing is written here. For Caleb that means: the portrait supplied by the NextGen team,
   the Haptol Labs logo from the project library, his own description, and his own pitch
   video. The manifest has `bio: null` for all twenty founders, so there is no biography to
   show and none is invented -- the standfirst is his own description, credited as such.

   The kit's concept crop, the board's pull quote and the board's "2:18" running time are
   all synthetic and none of them appear. The running time under the film is read off the
   video file itself.

   THE CLOSING PAGE

   "See you at NextGen." and "The story doesn't end here. See what's next." are NextGen
   addressing the reader, which is how the brief wrote them and how they are presented. No
   founder supplied a sign-off, so nothing on that page is attributed to one.
   ========================================================================= */
(function () {
  'use strict';

  /* ------------------------------------------------------------------------
     THE GATE.

     Entrant ids whose issue is finished and may be opened. Everyone else appears in the
     rack as a placeholder. Add an id here to switch that issue on; nothing else changes.
     --------------------------------------------------------------------- */
  var READY = ['entrant-01'];

  /* The collection, in rack order, exactly as the kit's founder_manifest.json lists it.
     `confirmed` stays false while voting is open: ten names in a row are a design
     collection, not a standing, and the notice says so. */
  var ISSUES = {
    ids: [
      'entrant-01',   /* 01  Caleb Orji            — Haptol Labs             */
      'entrant-02',   /* 02  Annrita Karu          — Credible blossom        */
      'entrant-20',   /* 03  Vishwa Shukla         — Find Your Mission Corp. */
      'entrant-03',   /* 04  Muyiwa Ogunsola       — Sooz                    */
      'entrant-04',   /* 05  Ariel Laura Métayer   — The Luminous Lab        */
      'entrant-05',   /* 06  Ethan Edouard         — Lookbook                */
      'entrant-06',   /* 07  Velma Funebe          — iBraid                  */
      'entrant-07',   /* 08  Divine Ayomide Fiolu  — BeforeKeys LLC          */
      'entrant-08',   /* 09  Jolie Wyatt           — If The Shoe Fits (ITSF) */
      'entrant-09'    /* 10  Austin Kendrick Lee   — Rest                    */
    ],
    confirmed: false
  };

  var HOW_MANY = 10;

  /* Each issue's colour and its deep tone, from the kit's founder_manifest.json. Keyed by
     entrant id, so the colour belongs to the founder and not to a position in the list. */
  var ACCENT = {
    'entrant-01': ['#20D6DA', '#043F4A'],
    'entrant-02': ['#D9BD26', '#4E420A'],
    'entrant-20': ['#25BFC1', '#124149'],
    'entrant-03': ['#3CC2D7', '#123C53'],
    'entrant-04': ['#B58AD4', '#482F57'],
    'entrant-05': ['#A5C355', '#364D26'],
    'entrant-06': ['#F06C9F', '#642039'],
    'entrant-07': ['#AC8ED1', '#42405A'],
    'entrant-08': ['#E890A1', '#582C36'],
    'entrant-09': ['#B6C956', '#374323']
  };
  var ACCENT_FALLBACK = ['#1FC7BE', '#06403D'];

  /* NextGen's own editorial lines. Nothing here is a founder's words. */
  var COVER_KICKER = 'A story worth opening';
  var END = {
    kicker: 'The NextGen Edition',
    head: 'See you at NextGen.',
    body: 'The story doesn’t end here. See what’s next.',
    back: 'Back to the Collection'
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };

  var reader = $('[data-mag-reader]');
  var shelf = $('[data-mag-shelf]');
  var statusEl = $('[data-mag-status]');
  var noteEl = $('[data-mag-note]');
  if (!reader || !shelf) return;

  var left = $('[data-mag-left]', reader);
  var right = $('[data-mag-right]', reader);
  var off = $('[data-mag-off]', reader);
  var cover = $('[data-mag-cover]', reader);
  var body = $('[data-mag-scroll]', reader);
  var idxEl = $('[data-mag-index]', reader);
  var totEl = $('[data-mag-total]', reader);
  var whoEl = $('[data-mag-who]', reader);
  var btnStory = $('[data-mag-openstory]', reader);
  var btnClose = $('[data-mag-close]', reader);
  var railPrev = $('[data-shelf-prev]');
  var railNext = $('[data-shelf-next]');

  var issues = [];
  var at = -1;
  var open = false;          /* is the cover swung back */
  var ended = false;         /* is the closing page showing (desktop leaf) */
  var video = null;
  var probe = null;
  var lastFocus = null;
  var lastScroll = 0;

  var reduced = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  var phone = function () {
    return window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isReady(f) { return READY.indexOf(f.entrant) !== -1; }
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

  function say(kind, text) {
    if (!statusEl) return;
    statusEl.innerHTML = '<b>' + esc(kind) + '</b>' + text;
    statusEl.hidden = false;
  }

  function pick() {
    var all = founders();
    var map = {};
    all.forEach(function (f) { map[f.entrant] = f; });

    if (ISSUES.ids && ISSUES.ids.length) {
      var chosen = ISSUES.ids.map(function (id) { return map[id]; }).filter(Boolean);
      if (chosen.length) {
        if (ISSUES.confirmed) {
          if (statusEl) statusEl.hidden = true;
        } else {
          say('A design collection, not a result',
            'Voting is open until 11:59pm ET on 28 October. These ten issues are the '
            + 'design collection for this page, in the order it was art-directed. They are '
            + 'not the Top 10, and the order is not a standing.');
        }
        return Promise.resolve(chosen.slice(0, HOW_MANY));
      }
      say('Check the list', 'The entrant ids set for this page do not match the current '
        + 'founder manifest, so the live standings are shown instead.');
    }

    return fetch('/api/pc-rank.php', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ok && d.ranked && Array.isArray(d.order)) {
          say('A preview, not a result',
            'Voting is open until 11:59pm ET on 28 October. This order is the current '
            + 'standing, shown so the page can be reviewed. It is not the final Top 10.');
          return d.order.map(function (id) { return map[id]; })
            .filter(Boolean).slice(0, HOW_MANY);
        }
        say('A preview — no ranking yet',
          'The standings are not being published yet, so these are the first ten founders '
          + 'in contestant order. Not a ranking.');
        return all.slice(0, HOW_MANY);
      })
      .catch(function () {
        say('A preview — standings unavailable',
          'The live standings could not be read, so these are the first ten founders in '
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
     portrait at 780px and up. Only the latter holds up at cover size. */
  function portraitSrc(f) { return f.shot || f.story || ''; }
  function portraitSet(f) {
    if (f.shot && f.shot2x) return ' srcset="' + esc(f.shot) + ' 1x, ' + esc(f.shot2x) + ' 2x"';
    if (!f.shot && f.story && f.story2x) return ' srcset="' + esc(f.story) + ' 1x, ' + esc(f.story2x) + ' 2x"';
    return '';
  }

  /* Every logo in the library is an opaque WebP -- none carries an alpha channel, checked
     file by file -- so each one brings its own background. Dropped onto a dark page it
     reads as a rectangle of whatever colour that file happens to be. fitChips() samples
     each file's corners and decides which way the tile goes. Nothing is recoloured,
     stretched or redrawn, and a founder with no logo in the library gets no mark rather
     than an invented one. */
  function logoChip(f, cls) {
    if (!f.logo) return '';
    return '<span class="' + cls + '" data-chip><img src="' + esc(f.logo) + '" alt="'
      + esc(f.company) + ' logo" loading="lazy" decoding="async"></span>';
  }

  var chipCache = {};
  function fitChips(root) {
    var chips = (root || reader).querySelectorAll('[data-chip]');
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
        } catch (e) { dark = false; }      /* canvas blocked: the white tile is the safe default */
        chipCache[key] = dark;
        chip.classList.toggle('is-dark', dark);
      };
      if (img.complete && img.naturalWidth) decide();
      else img.addEventListener('load', decide, { once: true });
    }(chips[i]));
  }

  /* ---------------------------------------------------------------------
     The cover. One component: the shelf and the reader render the same markup, and the
     stylesheet scales every dimension from the container's own width.
     ------------------------------------------------------------------ */
  function coverHTML(f, i, full) {
    var img = portraitSrc(f);
    /* only a finished issue invites you in */
    var invite = isReady(f)
      ? '<span class="mag-cover__open">Open the story'
        + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12 5l7 7-7 7"/></svg>'
        + '</span>'
      : '';
    return ''
      + (img ? '<img class="mag-cover__img" src="' + esc(img) + '"' + (full ? portraitSet(f) : '')
        + ' alt=""' + (f.focal ? ' style="object-position:' + esc(f.focal) + '"' : '')
        + (full ? '' : ' loading="lazy"') + ' decoding="async">' : '')
      + '<span class="mag-cover__tone" aria-hidden="true"></span>'
      + '<span class="mag-cover__in">'
      +   '<span>'
      +     '<span class="mag-cover__mast">next<i>gen</i><b>.</b>'
      +       '<span class="mag-cover__edition">The Founder Edition</span></span>'
      +     '<span class="mag-cover__hr"></span>'
      +     '<span class="mag-cover__folio">'
      +       '<span>People&rsquo;s Choice</span>'
      +       '<span>Issue ' + String(i + 1).padStart(2, '0') + '</span>'
      +     '</span>'
      +   '</span>'
      +   '<span>'
      +     '<span class="mag-cover__rule"></span>'
      +     '<span class="mag-cover__kicker">' + esc(COVER_KICKER) + '</span>'
      +     '<span class="mag-cover__name">' + esc(f.name) + '</span>'
      +     '<span class="mag-cover__co">' + esc(f.company) + '</span>'
      +     '<span class="mag-cover__blurb">' + esc(f.blurb || '') + '</span>'
      +     '<span class="mag-cover__foot">'
      +       '<span class="mag-cover__brand">'
      +         logoChip(f, 'mag-cover__logo')
      +         '<span class="mag-cover__collection">The NextGen Collection</span>'
      +       '</span>'
      +       invite
      +     '</span>'
      +   '</span>'
      + '</span>';
  }

  /* ---------------------------------------------------------------------
     The rack.
     ------------------------------------------------------------------ */
  function slotHTML(f, i) {
    var ready = isReady(f);
    var ink = accentOf(f);
    var no = String(i + 1).padStart(2, '0');
    return ''
      + '<li class="mag-slot ' + (ready ? 'mag-slot--ready' : 'mag-slot--soon') + '"'
      +     ' style="--issue:' + ink[0] + ';--issue-dk:' + ink[1] + '" data-slot="' + i + '">'
      +   '<button class="mag-slot__btn" type="button" data-go="' + i + '"'
      +           (ready ? '' : ' disabled')
      +           ' aria-label="' + (ready
                    ? 'Open issue ' + (i + 1) + ', ' + esc(f.name) + ' of ' + esc(f.company)
                    : esc(f.name) + ' of ' + esc(f.company) + ', preview coming soon') + '">'
      +     '<span class="mag-cover">' + coverHTML(f, i, false)
      +       (ready ? '' : '<span class="mag-slot__soon">Preview coming soon</span>')
      +     '</span>'
      +   '</button>'
      /* The shelf the issue stands on. A real element, not a pseudo on the button, because
         the magazine lifts off the shelf on hover and the shelf has to stay put. */
      +   '<span class="mag-slot__shelf" aria-hidden="true"></span>'
      +   '<p class="mag-slot__cap"><b>Issue ' + no + '</b> <i>/</i> '
      +     '<em>' + (ready ? 'Tap to open' : 'Coming soon') + '</em></p>'
      + '</li>';
  }

  function drawShelf() {
    shelf.innerHTML = issues.map(slotHTML).join('');
    if (totEl) totEl.textContent = String(issues.length).padStart(2, '0');
    fitChips(shelf);
    railState();
    if (noteEl) {
      var done = issues.filter(isReady);
      var names = done.map(function (f) { return f.name + ' / ' + f.company; }).join(', ');
      noteEl.innerHTML = done.length === issues.length
        ? ''
        : '<b>' + esc(names) + '</b> is the finished issue. The remaining '
          + (issues.length - done.length) + ' are previews of a design still in progress &mdash; '
          + 'their covers are placeholders and their pages are not built yet.';
    }
  }

  function railState() {
    if (!railPrev || !railNext) return;
    var max = shelf.scrollWidth - shelf.clientWidth - 2;
    railPrev.disabled = shelf.scrollLeft <= 2;
    railNext.disabled = shelf.scrollLeft >= max;
  }

  function nudgeRail(dir) {
    var slot = shelf.querySelector('.mag-slot');
    var step = slot ? slot.offsetWidth * 3 : 320;
    shelf.scrollBy({ left: dir * step, behavior: reduced ? 'auto' : 'smooth' });
  }

  function markSlot() {
    var all = shelf.querySelectorAll('.mag-slot');
    for (var i = 0; i < all.length; i++) all[i].classList.toggle('mag-slot--open', i === at);
  }

  /* ---------------------------------------------------------------------
     Left page — the pitch.
     ------------------------------------------------------------------ */
  function runHead(t, n) {
    return '<div class="mag-run"><span class="mag-run__t">' + t + '</span>'
      + '<span class="mag-run__n">' + n + '</span></div>';
  }

  function leftHTML(f, i) {
    var src = f.video && f.video.type === 'file' ? f.video.src : '';
    var poster = f.poster || portraitSrc(f);
    var head = runHead('The pitch', 'NextGen / Issue ' + String(i + 1).padStart(2, '0'));
    if (!src) {
      return head + '<p class="mag-credit">No pitch video has been supplied for this issue.</p>';
    }
    /* The concept board prints a running time under "watch the pitch". That one was
       generated; this one is read off the file in stampDuration(), and stays blank until
       it is known. */
    return head
      + '<p class="mag-pitch__t">The pitch<b>.</b></p>'
      + '<div class="mag-film-wrap">'
      +   '<button class="mag-film" type="button" data-play data-src="' + esc(src) + '"'
      +           ' aria-label="Play ' + esc(f.name) + '&rsquo;s pitch video">'
      +     (poster ? '<img class="mag-film__poster" src="' + esc(poster) + '" alt="" decoding="async">' : '')
      +     '<span class="mag-film__scrim" aria-hidden="true"></span>'
      +     '<span class="mag-film__play" aria-hidden="true">'
      +       '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>'
      +     '<span class="mag-film__cap" aria-hidden="true">'
      +       '<b>Watch the pitch</b><i data-dur></i></span>'
      +   '</button>'
      + '</div>'
      + '<p class="mag-credit"><b>' + esc(f.name) + '</b> recorded this pitch for the NextGen '
      +   'Summit People&rsquo;s Choice Award.</p>';
  }

  /* ---------------------------------------------------------------------
     Right page — the founder story.
     ------------------------------------------------------------------ */
  function rightHTML(f, i) {
    var meta = [];
    if (slotNo(f)) meta.push(['Contestant', slotNo(f)]);
    meta.push(['Edition', 'People’s Choice 2026']);
    meta.push(['Issue', String(i + 1).padStart(2, '0') + ' of ' + issues.length]);

    return ''
      + runHead('The founder story', 'Issue ' + String(i + 1).padStart(2, '0'))
      + '<div class="mag-story">'
      +   '<p class="mag-story__kicker">The NextGen Collection</p>'
      +   '<h3 class="mag-story__name">' + esc(f.name) + '</h3>'
      +   '<p class="mag-story__co">' + esc(f.company) + '</p>'
      +   '<div class="mag-story__hr" aria-hidden="true"></div>'
      +   '<p class="mag-story__dek">' + esc(f.blurb || '') + '</p>'
      +   '<ul class="mag-story__meta">'
      +     meta.map(function (m) {
              return '<li>' + esc(m[0]) + '<b>' + m[1] + '</b></li>';
            }).join('')
      +   '</ul>'
      +   '<div class="mag-story__brand">'
      +     logoChip(f, 'mag-story__logo')
      +     '<span class="mag-story__brandtext">'
      +       '<b>' + esc(f.company) + '</b>'
      /* A provenance credit, not a disclaimer: it says where the words came from, which is
         the only honest thing to print when the manifest holds no biography. */
      +       '<i>Description and pitch supplied by the founder.</i>'
      +     '</span>'
      +   '</div>'
      +   '<a class="mag-story__go" href="/pitch/peoples-choice/' + esc(nameSlug(f)) + '/">'
      +     'Explore full story'
      +     '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12 5l7 7-7 7"/></svg>'
      +   '</a>'
      +   '<button class="mag-story__go" type="button" data-mag-end>'
      +     'Read the closing page'
      +     '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12 5l7 7-7 7"/></svg>'
      +   '</button>'
      + '</div>';
  }

  /* ---------------------------------------------------------------------
     The last page. NextGen's voice; nothing attributed to a founder.
     ------------------------------------------------------------------ */
  function endHTML(f) {
    var img = portraitSrc(f);
    return ''
      + '<div class="mag-end__plate">'
      +   (img ? '<img src="' + esc(img) + '"' + portraitSet(f) + ' alt="' + esc(f.name) + '"'
      +     (f.focal ? ' style="object-position:' + esc(f.focal) + '"' : '') + ' loading="lazy">' : '')
      + '</div>'
      + '<div class="mag-end__copy">'
      +   '<p class="mag-end__kicker">' + esc(END.kicker) + '</p>'
      +   '<p class="mag-end__t">' + esc(END.head) + '</p>'
      +   '<p class="mag-end__p">' + esc(END.body) + '</p>'
      +   '<div class="mag-end__sig">'
      +     logoChip(f, 'mag-end__logo')
      +     '<span><b>' + esc(f.name) + '</b><i>' + esc(f.company) + '</i></span>'
      +   '</div>'
      +   '<button class="mag-end__back" type="button" data-mag-back>'
      +     '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H6M12 5l-7 7 7 7"/></svg>'
      +     esc(END.back)
      +   '</button>'
      + '</div>';
  }

  /* ---------------------------------------------------------------------
     Film: orientation, running time, playback.
     ------------------------------------------------------------------ */

  /* Most pitches in the manifest are phone verticals, a few are landscape, so the frame
     follows the poster's own dimensions rather than an assumption. The brief asks for the
     video's native aspect ratio, and this is what preserves it. */
  function markFilm() {
    var film = reader.querySelector('.mag-film');
    if (!film) return;
    var img = film.querySelector('.mag-film__poster');
    if (!img) { film.classList.add('is-wide'); return; }
    var decide = function () {
      if (!img.naturalWidth) return;
      film.classList.toggle('is-wide', img.naturalWidth > img.naturalHeight);
    };
    if (img.complete) decide();
    else img.addEventListener('load', decide, { once: true });
  }

  /* Reads the real running time. preload="metadata" fetches the header, not the film. */
  function stampDuration(src) {
    if (probe) { try { probe.src = ''; } catch (e) {} probe = null; }
    var slot = reader.querySelector('[data-dur]');
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
    var playing = reader.querySelector('.mag-film.is-playing');
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
     Opening and closing an issue.
     ------------------------------------------------------------------ */
  function paint(i) {
    var f = issues[i];
    left.innerHTML = leftHTML(f, i);
    right.innerHTML = rightHTML(f, i);
    off.innerHTML = endHTML(f);
    cover.innerHTML = coverHTML(f, i, true);
    cover.setAttribute('aria-label', 'Open issue ' + (i + 1) + ', ' + f.name + ' of ' + f.company);
    markFilm();
    fitChips(reader);
    stampDuration(f.video && f.video.type === 'file' ? f.video.src : '');
    if (idxEl) idxEl.textContent = String(i + 1).padStart(2, '0');
    if (whoEl) whoEl.textContent = f.name;
  }

  function openIssue(i) {
    var f = issues[i];
    if (!f || !isReady(f)) return;        /* the gate: a placeholder never opens */

    at = i;
    lastFocus = document.activeElement;
    lastScroll = (document.scrollingElement || document.body).scrollTop;

    var ink = accentOf(f);
    reader.style.setProperty('--issue', ink[0]);
    reader.style.setProperty('--issue-dk', ink[1]);

    paint(i);
    markSlot();
    setOpen(false);
    reader.hidden = false;
    document.body.style.overflow = 'hidden';
    if (body) body.scrollTop = 0;
    if (btnClose) btnClose.focus({ preventScroll: true });
    track('top10_view', { entrant_id: f.entrant, slot: i + 1, provisional: ISSUES.confirmed ? 0 : 1 });
  }

  function closeIssue() {
    dropVideo();
    reader.hidden = true;
    document.body.style.overflow = '';
    (document.scrollingElement || document.body).scrollTop = lastScroll;
    var f = issues[at];
    track('top10_close', { entrant_id: f ? f.entrant : '', slot: at + 1 });
    /* back to the issue you came from, in the rack, exactly where you left it */
    var btn = shelf.querySelector('[data-go="' + at + '"]');
    if (btn) btn.focus({ preventScroll: true });
    else if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function setOpen(v) {
    open = !!v;
    reader.classList.toggle('is-open', open);
    /* Disabling it is what takes it out of the tab order and out of the accessibility
       tree's list of things you can press -- exactly true once the issue is open. */
    cover.disabled = open;
    cover.setAttribute('aria-hidden', open ? 'true' : 'false');
    if (btnStory) btnStory.hidden = open;
    left.setAttribute('aria-hidden', open ? 'false' : 'true');
    right.setAttribute('aria-hidden', open ? 'false' : 'true');
    off.setAttribute('aria-hidden', (open && (phone() || ended)) ? 'false' : 'true');
    if (!open) { dropVideo(); setEnd(false); }
    if (open) {
      var h = reader.querySelector('.mag-run');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
      var f = issues[at];
      track('top10_open', { entrant_id: f ? f.entrant : '', slot: at + 1 });
    }
  }

  /* On a phone the closing page is simply the last thing in the column, so "read the
     closing page" scrolls to it. On a desktop spread it is a leaf that covers both pages. */
  function setEnd(v) {
    if (phone()) {
      ended = false;
      reader.classList.remove('is-end');
      if (v && off) off.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    ended = !!v;
    reader.classList.toggle('is-end', ended);
    off.setAttribute('aria-hidden', (open && ended) ? 'false' : 'true');
    left.setAttribute('aria-hidden', (open && !ended) ? 'false' : 'true');
    right.setAttribute('aria-hidden', (open && !ended) ? 'false' : 'true');
    if (ended) {
      dropVideo();
      var k = off.querySelector('.mag-end__kicker');
      if (k) { k.setAttribute('tabindex', '-1'); k.focus({ preventScroll: true }); }
    }
  }

  /* ---------------------------------------------------------------------
     Wiring.
     ------------------------------------------------------------------ */
  shelf.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-go]') : null;
    if (!btn || btn.disabled) return;
    openIssue(parseInt(btn.getAttribute('data-go'), 10));
  });
  shelf.addEventListener('scroll', railState, { passive: true });
  window.addEventListener('resize', railState);

  if (railPrev) railPrev.addEventListener('click', function () { nudgeRail(-1); });
  if (railNext) railNext.addEventListener('click', function () { nudgeRail(1); });

  cover.addEventListener('click', function () { if (!open) setOpen(true); });
  if (btnStory) btnStory.addEventListener('click', function () { if (!open) setOpen(true); });
  if (btnClose) btnClose.addEventListener('click', closeIssue);

  reader.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var p = t.closest('[data-play]');
    if (p && !p.classList.contains('is-playing')) { play(p); return; }
    if (t.closest('[data-mag-end]')) {
      setEnd(true);
      var f = issues[at];
      track('top10_signoff', { entrant_id: f ? f.entrant : '', slot: at + 1 });
      return;
    }
    if (t.closest('[data-mag-back]')) { closeIssue(); }
  });

  /* Tab stays inside the reader while it is open -- it is a dialog, and letting focus walk
     out into the page behind it is the usual way these go wrong. */
  function focusables() {
    return Array.prototype.filter.call(
      reader.querySelectorAll('a[href], button:not([disabled]), video, [tabindex]:not([tabindex="-1"])'),
      function (el) { return el.offsetParent !== null || el === document.activeElement; });
  }

  document.addEventListener('keydown', function (e) {
    if (reader.hidden) return;
    var t = e.target;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (ended) setEnd(false);
      else if (open) setOpen(false);
      else closeIssue();
      return;
    }
    if (e.key === 'Tab') {
      var f = focusables();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    /* arrow keys belong to a focused video's scrub bar, not to us */
    if (t && (t.tagName === 'VIDEO' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'ArrowRight' && open && !ended) { e.preventDefault(); setEnd(true); }
    else if (e.key === 'ArrowLeft' && ended) { e.preventDefault(); setEnd(false); }
    else if ((e.key === 'Enter' || e.key === ' ') && !open
             && document.activeElement === cover) { e.preventDefault(); setOpen(true); }
  });

  /* A swipe left moves on to the closing page, a swipe right comes back. Vertical movement
     is left alone -- stealing it would break scrolling, which is how a phone reads this. */
  (function swipe() {
    var x0 = 0, y0 = 0, on = false;
    reader.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { on = false; return; }
      on = true; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    }, { passive: true });
    reader.addEventListener('touchend', function (e) {
      if (!on || !open || phone()) return;
      on = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - x0, dy = t.clientY - y0;
      if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.8) setEnd(dx < 0);
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
      shelf.innerHTML = '<li class="mag-rack__loading">The founder list could not be loaded.</li>';
      return;
    }
    pick().then(function (ten) {
      issues = ten;
      if (!issues.length) {
        shelf.innerHTML = '<li class="mag-rack__loading">No issues to show.</li>';
        return;
      }
      drawShelf();
      track('top10_rack', { entrants: issues.length, ready: issues.filter(isReady).length });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
