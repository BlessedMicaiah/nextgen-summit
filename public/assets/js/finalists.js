/* Top 10 Pitch Finalists — the card that opens and turns.

   The same shape as speakers.js, deliberately: a deck of cards, one dialog, a front and a back
   that turn. What differs is the back, which carries a pitch video instead of a list of
   achievements, and the data, which the server writes into the page as JSON so that there is
   exactly one place a finalist is described (api/finalists.php).

   Turning is a press, never a hover. On a phone there is no hover to speak of, and a card that
   flips when a thumb grazes it is a card nobody can read. Both faces carry their own control.

   Accessibility: the face that is turned away is hidden from screen readers and taken out of
   the tab order, so the reading order always matches what is actually on screen. The dialog is
   a real <dialog>, so Escape and the focus trap come from the browser rather than from here.

   Nothing in this file votes, counts a vote, or knows that People's Choice exists. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var dlg = $('#finalist');
  var deck = $('[data-fin-deck]');
  var node = $('#fin-data');
  if (!dlg || !deck || !node || !dlg.showModal) return;

  var PEOPLE = {};
  try {
    (JSON.parse(node.textContent) || []).forEach(function (f) { PEOPLE[f.id] = f; });
  } catch (e) { return; }

  var front = $('[data-fin-front]', dlg);
  var back = $('[data-fin-back]', dlg);
  var opener = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function shot(f, alt) {
    if (!f.shot) return '';
    var b = '/assets/img/finalists/' + f.shot;
    return '<img src="' + esc(b) + '-620.jpg" srcset="' + esc(b) + '-620.jpg 620w, ' +
      esc(b) + '-900.jpg 900w" sizes="(max-width:760px) 92vw, 430px" width="620" height="868" ' +
      'decoding="async" alt="' + esc(alt) + '">';
  }

  var PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var ARR_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';
  var ARR_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H5M11 6l-6 6 6 6"/></svg>';

  function paint(id) {
    var f = PEOPLE[id];
    if (!f || !f.confirmed) return false;

    front.innerHTML =
      '<div class="sp__pane">' +
        '<div class="sp__top">' +
          '<p class="sp__wm wm">nextgen<small>Summit</small></p>' +
          '<p class="sp__when">Friday<b>Oct 30</b>Maryland</p>' +
        '</div>' +
        '<p class="sp__say" aria-hidden="true"><i></i><span>Pitching live.</span></p>' +
        '<span class="sp__shot">' + shot(f, f.name) + '</span>' +
        '<div class="sp__id">' +
          '<p class="sp__tag">Top 10 Finalist</p>' +
          '<h3 class="sp__name" id="fin-name">' + esc(f.first) + '<b>' + esc(f.last) + '</b></h3>' +
          '<p class="sp__role">' + esc(f.venture) +
            (f.category ? '<span class="fin__cat">' + esc(f.category) + '</span>' : '') + '</p>' +
          '<p class="sp__bar"><small>NextGen Summit</small>' +
            '<button class="sp__turn" type="button" data-fin-turn>Watch their<br>pitch' +
              '<i aria-hidden="true">' + ARR_R + '</i>' +
            '</button>' +
          '</p>' +
        '</div>' +
      '</div>';

    var media;
    if (f.video && f.video.embed) {
      media = '<div class="fin__vwrap" data-fin-video="' + esc(f.video.embed) + '">' +
        (f.video.poster
          ? '<img class="fin__poster" src="' + esc(f.video.poster) + '" alt="" loading="lazy" decoding="async">'
          : '') +
        '<button class="fin__play" type="button" data-fin-play>' +
          '<i aria-hidden="true">' + PLAY + '</i>' +
          '<span>Watch their pitch</span>' +
          '<span class="sr">Play the pitch video for ' + esc(f.name) + '</span>' +
        '</button></div>';
    } else {
      media = '<div class="fin__vwrap"><p class="fin__soon">The pitch video will be added here once it is published.</p></div>';
    }

    back.innerHTML =
      '<div class="sp__pane sp__bpane">' +
        '<div class="sp__bhead">' +
          '<div>' +
            '<p class="sp__wm wm">nextgen<small>Summit</small></p>' +
            '<h3 class="sp__bname">' + esc(f.first) + '<b>' + esc(f.last) + '</b></h3>' +
            '<p class="sp__brole">' + esc(f.venture) + '</p>' +
            '<span class="sp__rule" aria-hidden="true"></span>' +
          '</div>' +
        '</div>' +
        media +
        (f.blurb ? '<p class="fin__bblurb">' + esc(f.blurb) + '</p>' : '') +
        '<p class="sp__act">' +
          (f.video && f.video.watch
            ? '<a class="sp__li" href="' + esc(f.video.watch) + '" target="_blank" rel="noopener noreferrer">Open in a new tab</a>'
            : '') +
          '<button class="sp__turn" type="button" data-fin-turn>Back to<br>front' +
            '<i aria-hidden="true">' + ARR_L + '</i></button>' +
        '</p>' +
      '</div>';

    dlg.setAttribute('aria-label', f.name + ', Top 10 finalist');
    return true;
  }

  /* Which way the card faces. The stylesheet turns it; this keeps the reading order and the tab
     order honest about which side is actually in front. */
  function face(isBack) {
    dlg.classList.toggle('is-back', isBack);
    front.setAttribute('aria-hidden', String(isBack));
    back.setAttribute('aria-hidden', String(!isBack));
    $$('a,button', isBack ? front : back).forEach(function (n) { n.setAttribute('tabindex', '-1'); });
    $$('a,button', isBack ? back : front).forEach(function (n) { n.removeAttribute('tabindex'); });
    var turn = $('[data-fin-turn]', isBack ? back : front);
    if (turn) turn.focus();
  }

  /* The player is fetched only when somebody asks for it: until then the back of the card is a
     poster and a button, and the provider has not been told that anyone is here. */
  function play(wrap) {
    var src = wrap.getAttribute('data-fin-video');
    if (!src || wrap.querySelector('iframe')) return;
    var f = document.createElement('iframe');
    f.className = 'fin__frame';
    f.setAttribute('allow', 'accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen');
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('title', 'Pitch video');
    f.src = src;
    wrap.appendChild(f);
    var btn = $('[data-fin-play]', wrap);
    if (btn) btn.remove();
  }

  function open(btn) {
    if (!paint(btn.getAttribute('data-fin'))) return;
    opener = btn;
    face(false);
    dlg.showModal();
  }

  function close() {
    // drop the player on the way out, so a pitch never keeps playing behind a closed card
    $$('iframe', dlg).forEach(function (n) { n.remove(); });
    dlg.close();
  }

  deck.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-fin]') : null;
    if (btn) { e.preventDefault(); open(btn); }
  });

  dlg.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    if (e.target.closest('[data-fin-close]')) { close(); return; }
    if (e.target.closest('[data-fin-turn]')) { face(!dlg.classList.contains('is-back')); return; }
    var p = e.target.closest('[data-fin-play]');
    if (p) { play(p.parentNode); return; }
    // a press on the backdrop, outside the card itself, closes it
    if (e.target === dlg) close();
  });

  dlg.addEventListener('close', function () {
    $$('iframe', dlg).forEach(function (n) { n.remove(); });
    if (opener) { opener.focus(); opener = null; }
  });
})();
