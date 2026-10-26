/* ============================================================================
   TOP 10 — the People's Choice magazine.

   Ten covers. Open one and it becomes a two-page spread: the pitch on the left, the founder
   on the right. Prev/next move through the collection without closing the book.

   WHERE THE CONTENT COMES FROM, AND WHERE IT DOES NOT

   Everything on these pages is read out of window.NGS_FOUNDERS, which tools/build-founders.py
   generates from the Top 20 manifest. Nothing is written here. That matters because the
   obvious way to make an editorial page feel finished is to write the editorial -- a
   biography, a problem statement, a pull quote, a funding figure -- and every one of those
   would be invented. The manifest has `name`, `company`, `blurb`, a portrait, a pitch video
   and a logo. It has `bio: null` for all twenty founders.

   So the layout is built around what exists. Where a field is genuinely absent the page says
   so in plain words rather than filling the hole, and the only prose on the page is each
   founder's own `blurb`, shown once.

   THE RANKING

   Voting is still open, so there is no confirmed Top 10. TOP_10 below is null, and while it
   is null this page is explicitly a preview: the order comes from the live standings, the
   banner says what it is, and the page is noindex. When leadership confirms the ten, set
   TOP_10 to their entrant ids -- the banner disappears, the server is no longer consulted
   for ordering, and nothing else changes.
   ========================================================================= */
(function () {
  'use strict';

  /* ------------------------------------------------------------------------
     THE ONE THING TO EDIT WHEN THE TOP 10 IS CONFIRMED.

     Put the ten entrant ids here, in the order they should appear:

        var TOP_10 = ['entrant-07', 'entrant-02', ... ];

     Ids, not names -- names change spelling, ids do not, and the ids are what the manifest
     and the ballot both key on. Leave it null until the result is official.
     --------------------------------------------------------------------- */
  var TOP_10 = null;

  var HOW_MANY = 10;

  /* Per-issue accents, drawn from the brand's own palette so ten issues vary without any of
     them leaving the publication. Assigned by position, so the collection looks deliberate
     rather than random -- and looks the same on every load. */
  var INKS = [
    '#1FC7BE', '#FFB224', '#FF5A6E', '#5B8CFF', '#39D98A',
    '#C98BFF', '#FF8A3D', '#2ED3E0', '#FF6FA5', '#9BE15D'
  ];

  var $ = function (s, r) { return (r || document).querySelector(s); };

  var stage    = $('[data-mag-stage]');
  var shelf    = $('[data-mag-shelf]');
  var statusEl = $('[data-mag-status]');
  if (!stage || !shelf) return;

  var left   = $('[data-mag-left]', stage);
  var right  = $('[data-mag-right]', stage);
  var cover  = $('[data-mag-cover]', stage);
  var idxEl  = $('[data-mag-index]', stage);
  var totEl  = $('[data-mag-total]', stage);
  var footEl = $('[data-mag-foot]', stage);
  var btnPrev = $('[data-mag-prev]', stage);
  var btnNext = $('[data-mag-next]', stage);
  var btnClose = $('[data-mag-close]', stage);
  var railPrev = $('[data-shelf-prev]');
  var railNext = $('[data-shelf-next]');

  var issues = [];       /* the ten, in order */
  var at = -1;           /* which issue is on the stage; -1 = nothing yet */
  var open = false;      /* is the cover swung back */
  var video = null;      /* the one <video> allowed to exist at a time */

  var reduced = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* GTM is already on this page; these ride the same ngs_pc_ convention the rest of the
     site uses, so one existing trigger catches them. No name, no email, no voter -- an
     entrant id is a pitch, not a person. */
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

    if (TOP_10 && TOP_10.length) {
      var chosen = TOP_10.map(function (id) { return map[id]; }).filter(Boolean);
      if (chosen.length) {
        if (statusEl) statusEl.hidden = true;
        return Promise.resolve(chosen.slice(0, HOW_MANY));
      }
      /* The ids were set but match nothing -- a typo, or the manifest was regenerated.
         Falling through to the live order silently would publish a different ten than the
         one somebody meant to publish, so this is said out loud. */
      say('Check the list', ' The ten entrant ids set for this page do not match the current '
        + 'founder manifest, so the live standings are shown instead. ');
    }

    /* No confirmed ten, so ask the live standings and label the result honestly. */
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
        /* `ranked` false means the server will not publish an order -- everyone level, or
           ranking off. Inventing a top ten out of that would be a fabrication, so the page
           shows contestant order and says that is what it is. */
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
     The shelf.
     ------------------------------------------------------------------ */
  function slotNo(f) {
    var m = /(\d+)\s*$/.exec(f.entrant || '');
    return m ? m[1] : '';
  }

  /* A founder's own pitch page lives at /pitch/peoples-choice/<slug>/, and the slug is built
     from their NAME -- see pc_slug() in api/pc-rules.php, which entrant.php resolves against.
     Not f.slug, which is the company. Using the wrong one 404s. */
  function nameSlug(f) {
    return String(f.name || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function miniHTML(f, i) {
    var img = f.shot || f.story || '';
    return ''
      + '<button class="mag-mini" type="button" data-go="' + i + '" style="--issue:' + INKS[i % INKS.length] + '"'
      +         ' aria-label="Open issue ' + (i + 1) + ', ' + esc(f.name) + ' of ' + esc(f.company) + '">'
      +   (img ? '<img class="mag-mini__img" src="' + esc(img) + '" alt="" loading="lazy" decoding="async"'
      +          (f.focal ? ' style="object-position:' + esc(f.focal) + '"' : '') + '>' : '')
      +   '<span class="mag-mini__wash" aria-hidden="true"></span>'
      +   '<span class="mag-mini__mast" aria-hidden="true">'
      +     '<span class="mag-mini__logo">next<i>gen</i>'
      +       '<span class="mag-mini__sub">People&rsquo;s Choice</span></span>'
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
      return '<li>' + miniHTML(f, i) + '</li>';
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
    var card = shelf.querySelector('.mag-mini');
    var step = card ? (card.offsetWidth + 14) * 2 : 300;
    shelf.scrollBy({ left: dir * step, behavior: reduced ? 'auto' : 'smooth' });
  }

  function markCurrent() {
    var all = shelf.querySelectorAll('.mag-mini');
    for (var i = 0; i < all.length; i++) {
      all[i].setAttribute('aria-current', i === at ? 'true' : 'false');
    }
    /* The rail is scrolled by hand rather than with scrollIntoView, which also scrolls every
       ancestor: turning a page threw the whole document up the screen and left the spread
       half off the top. This moves one axis of one element. */
    var now = all[at];
    if (!now) return;
    var want = now.offsetLeft - (shelf.clientWidth - now.offsetWidth) / 2;
    want = Math.max(0, Math.min(want, shelf.scrollWidth - shelf.clientWidth));
    if (Math.abs(want - shelf.scrollLeft) > 2) {
      shelf.scrollTo({ left: want, behavior: reduced ? 'auto' : 'smooth' });
    }
  }

  /* ---------------------------------------------------------------------
     A page of the magazine.

     Portraits come in two shapes -- some founders supplied a tall headshot, some a wide
     one -- and shotW/shotH say which. Forcing one aspect ratio on both would crop somebody
     badly, so the frame follows the photograph.
     ------------------------------------------------------------------ */
  function tall(f) {
    return !!(f.shotW && f.shotH && f.shotH > f.shotW);
  }

  /* story/story2x are a 320px square crop for the story rail; shot/shot2x is the real
     portrait, 800px and up. At magazine size only the latter holds up. */
  function portraitSrc(f) { return f.shot || f.story || ''; }
  function portraitSet(f) {
    if (f.shot && f.shot2x) return ' srcset="' + esc(f.shot) + ' 1x, ' + esc(f.shot2x) + ' 2x"';
    if (!f.shot && f.story && f.story2x) return ' srcset="' + esc(f.story) + ' 1x, ' + esc(f.story2x) + ' 2x"';
    return '';
  }

  function leftHTML(f) {
    var src = f.video && f.video.type === 'file' ? f.video.src : '';
    var poster = f.poster || portraitSrc(f);
    var film = src
      ? '<button class="mag-film" type="button" data-play'
        + ' data-src="' + esc(src) + '"'
        + ' aria-label="Play ' + esc(f.name) + '&rsquo;s pitch video">'
        + (poster ? '<img class="mag-film__poster" src="' + esc(poster) + '" alt="" decoding="async">' : '')
        + '<span class="mag-film__scrim" aria-hidden="true"></span>'
        + '<span class="mag-film__play" aria-hidden="true">'
        +   '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>'
        + '<span class="mag-film__len" aria-hidden="true">Watch the pitch</span>'
      + '</button>'
      : '<p class="mag-gap">No pitch video has been supplied for this founder.</p>';

    /* The pitch videos are phone-shot verticals. A 9:16 film laid across a landscape page
       either letterboxes into a strip or eats the page, so the film takes a tall column and
       the copy runs beside it -- a plate-and-column layout, which is what a magazine would
       have done with a portrait photograph anyway. markFilm() swaps to a stacked layout if a
       founder's video turns out to be landscape. */
    return ''
      + '<p class="mag-kicker">The pitch</p>'
      + '<div class="mag-pitch" data-pitch>'
      +   film
      +   '<div class="mag-pitch__copy">'
      +     '<h3 class="mag-idea__t wm">In their words</h3>'
      +     '<p class="mag-idea__p">' + esc(f.blurb || '') + '</p>'
      +   '</div>'
      + '</div>';
    /* No name or logo down here: this is one half of a spread, and both are on the facing
       page. Repeating them stole height the film could use. */
  }

  function rightHTML(f, i) {
    var shot = portraitSrc(f);
    var facts = [];
    if (slotNo(f)) facts.push('Contestant ' + slotNo(f));
    facts.push('People&rsquo;s Choice 2026');
    if (f.video && f.video.type === 'file') facts.push('Pitch on film');

    return ''
      + '<p class="mag-kicker">The founder</p>'
      + (shot
          ? '<div class="mag-port' + (tall(f) ? ' mag-port--tall' : '') + '">'
            + '<img src="' + esc(shot) + '"' + portraitSet(f) + ' alt="' + esc(f.name) + '"'
            + (f.focal ? ' style="object-position:' + esc(f.focal) + '"' : '')
            + ' loading="lazy" decoding="async">'
            + '<span class="mag-port__tag">' + String(i + 1).padStart(2, '0') + ' &middot; '
            + esc(f.company) + '</span>'
            + '</div>'
          : '')
      + '<div class="mag-head">'
      +   (f.logo ? '<img class="mag-head__logo" src="' + esc(f.logo) + '" alt="' + esc(f.company) + ' logo" loading="lazy">' : '')
      +   '<div class="mag-head__t">'
      +     '<h3 class="mag-name wm">' + esc(f.name) + '</h3>'
      +     '<p class="mag-co">' + esc(f.company) + '</p>'
      +   '</div>'
      + '</div>'
      + '<div class="mag-rule" aria-hidden="true"></div>'
      + '<ul class="mag-facts">' + facts.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>'
      /* No founder in the manifest has a biography. Rather than write one, the page says
         what it has and what it does not. */
      + '<p class="mag-gap">A longer profile has not been supplied for this founder yet. '
      +   'Everything above is their own description and their own pitch.</p>'
      + '<a class="mag-link" href="/pitch/peoples-choice/' + esc(nameSlug(f)) + '/">'
      +   'See the full pitch page'
      +   '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12 5l7 7-7 7"/></svg>'
      + '</a>';
  }

  function coverHTML(f, i) {
    var img = portraitSrc(f);
    var bars = '';
    /* A barcode is what tells the eye "this is a magazine". The widths are fixed per issue
       so it does not flicker on every render. */
    for (var b = 0; b < 26; b++) {
      bars += '<i style="height:' + (54 + ((i * 7 + b * 11) % 46)) + '%"></i>';
    }
    return ''
      + (img ? '<img class="mag-cover__img" src="' + esc(img) + '"' + portraitSet(f) + ' alt=""'
        + (f.focal ? ' style="object-position:' + esc(f.focal) + '"' : '') + ' decoding="async">' : '')
      + '<span class="mag-cover__wash" aria-hidden="true"></span>'
      + '<span class="mag-cover__in">'
      +   '<span class="mag-cover__mast">'
      +     '<span class="mag-cover__logo">next<i>gen</i>'
      +       '<span>People&rsquo;s Choice 2026</span></span>'
      +     '<span class="mag-cover__vol">Issue ' + String(i + 1).padStart(2, '0')
      +       '<br>of ' + String(issues.length).padStart(2, '0') + '</span>'
      +   '</span>'
      +   '<span class="mag-cover__foot">'
      +     '<span class="mag-cover__kicker">The founder</span>'
      /* Spans, not a heading and a paragraph: the cover is a <button>, whose content model is
         phrasing only, and the same two lines are real headings on the open spread. */
      +     '<span class="mag-cover__name">' + esc(f.name) + '</span>'
      +     '<span class="mag-cover__co">' + esc(f.company) + '</span>'
      +     '<span class="mag-cover__open">Open the issue'
      +       '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12 5l7 7-7 7"/></svg>'
      +     '</span>'
      +   '</span>'
      + '</span>'
      + '<span class="mag-cover__barcode" aria-hidden="true">' + bars + '</span>';
  }

  /* Every pitch in the current manifest is vertical, but nothing guarantees the next one is,
     so the layout is decided by the poster's own dimensions rather than by an assumption.
     Landscape gets the stacked layout; portrait keeps the column. */
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

  /* ---------------------------------------------------------------------
     Video. One at a time, and it stops the moment the page it lives on leaves.
     ------------------------------------------------------------------ */
  function dropVideo() {
    if (!video) return;
    try { video.pause(); } catch (e) { /* already gone */ }
    video.removeAttribute('src');
    try { video.load(); } catch (e) { /* ditto */ }
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
    stage.style.setProperty('--issue', INKS[i % INKS.length]);
    cover.setAttribute('data-art', String((i % 4) + 1));
    cover.setAttribute('aria-label', 'Open issue ' + (i + 1) + ', ' + f.name + ' of ' + f.company);

    var paint = function () {
      left.innerHTML = leftHTML(f);
      right.innerHTML = rightHTML(f, i);
      cover.innerHTML = coverHTML(f, i);
      markFilm();
      if (idxEl) idxEl.textContent = String(i + 1).padStart(2, '0');
      if (footEl) {
        footEl.textContent = TOP_10 && TOP_10.length
          ? 'Issue ' + (i + 1) + ' of ' + issues.length
          : 'Issue ' + (i + 1) + ' of ' + issues.length + ' — internal preview order';
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

  function setOpen(v) {
    open = !!v;
    stage.classList.toggle('is-open', open);
    /* Disabling it is what takes it out of the tab order and out of the accessibility tree's
       list of things you can press -- which is exactly true once the issue is open. */
    cover.disabled = open;
    cover.setAttribute('aria-hidden', open ? 'true' : 'false');
    if (btnClose) btnClose.disabled = !open;    /* nothing to close while it is shut */
    /* The spread is only in the accessibility tree once it is actually showing, so a screen
       reader is not reading two pages that are hidden behind a cover. */
    left.setAttribute('aria-hidden', open ? 'false' : 'true');
    right.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (!open) dropVideo();
    var f = issues[at];
    track(open ? 'top10_open' : 'top10_close', { entrant_id: f ? f.entrant : '', slot: at + 1 });
    if (open) {
      var h = left.querySelector('.mag-kicker');
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
    var p = e.target.closest ? e.target.closest('[data-play]') : null;
    if (p && !p.classList.contains('is-playing')) { play(p); }
  });

  if (btnPrev) btnPrev.addEventListener('click', function () { show(at - 1, { open: open, keepScroll: true }); });
  if (btnNext) btnNext.addEventListener('click', function () { show(at + 1, { open: open, keepScroll: true }); });
  if (btnClose) btnClose.addEventListener('click', close);

  document.addEventListener('keydown', function (e) {
    if (stage.hidden) return;
    var t = e.target;
    /* arrow keys belong to a focused video's scrub bar, not to us */
    if (t && (t.tagName === 'VIDEO' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape' && open) { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); show(at - 1, { open: open, keepScroll: true }); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(at + 1, { open: open, keepScroll: true }); }
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
      track('top10_view', { entrants: issues.length, provisional: TOP_10 ? 0 : 1 });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
