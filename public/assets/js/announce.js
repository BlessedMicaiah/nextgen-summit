/* NextGen Summit: the extended pitch deadline (see css/announce.css).
   Draws the strike through October 17 on every .dl as it scrolls into view.
   Also opens the People's Choice voting pop-up while voting is open (see below).
   (The deadline pop-up was removed once the October 20 deadline passed.) */
(function () {
  'use strict';

  /* ---------- the struck dates ---------- */
  function strike() {
    var dates = Array.prototype.slice.call(document.querySelectorAll('.dl'));
    if (!dates.length) return;
    if (!('IntersectionObserver' in window)) { dates.forEach(function (d) { d.classList.add('is-on'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-on'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    dates.forEach(function (d) { io.observe(d); });
  }


  /* ---------- the People's Choice pop-up ----------
     Four seconds into a visit, once per browser session, an invitation to go and vote, with a
     direct link to the People's Choice page. It only appears while the server says voting is
     open (GET /api/pc-vote.php), never on the People's Choice page itself, and never on top of
     a menu or form someone already has open. Founder faces are picked at random every time so
     the pop-up never favours anyone. Add ?pcpopup=1 to any URL to preview it regardless. */
  var PC_URL = '/pitch/peoples-choice/';
  var PC_KEY = 'ngs-pc-vote-popup-seen';
  var PC_DELAY = 4000;                                        // the brief asks for 3 to 5 seconds
  var PC_HARD_END = new Date('2026-10-29T00:00:00-04:00');    // a backstop if the server is quiet
  var PC_FACES = ['haptol-labs', 'credible-blossom', 'sooz', 'the-luminous-lab', 'lookbook', 'ibraid',
    'beforekeys-llc', 'if-the-shoe-fits-itsf', 'rest', 'pathbridge', 'applytrack', 'jay-s-watermelonade',
    'offguardz', 'k8culture-productions', 'melavyr', 'light', 'beauty-boot-camp', 'nextofferup',
    'exam-me', 'find-your-mission-corp'];

  function pcSeen() { try { return sessionStorage.getItem(PC_KEY) === '1'; } catch (e) { return false; } }
  function pcRemember() { try { sessionStorage.setItem(PC_KEY, '1'); } catch (e) {} }

  function pick(list, n) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a.slice(0, n);
  }

  function pcBuild(closes) {
    var faces = pick(PC_FACES, 5).map(function (slug, i) {
      return '<li class="pcp__face" style="--i:' + i + '"><img src="/assets/img/founders/' + slug + '.webp" alt="" width="112" height="112" decoding="async"></li>';
    }).join('');
    var bits = '';
    for (var k = 0; k < 14; k++) bits += '<span class="pcp__bit" style="--k:' + k + '"></span>';
    var d = document.createElement('dialog');
    d.className = 'ann pcp';
    d.id = 'pc-vote-news';
    d.setAttribute('aria-labelledby', 'pcp-title');
    d.setAttribute('aria-describedby', 'pcp-copy');
    d.innerHTML =
      '<div class="ann__bar" aria-hidden="true"></div>' +
      '<div class="ann__in" tabindex="-1" autofocus>' +
        '<button class="ann__close" type="button" data-pcp-close aria-label="Close">' +
          '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 2l14 14M16 2L2 16" stroke="currentColor" stroke-width="2" fill="none"/></svg>' +
        '</button>' +
        '<p class="ann__kicker pcp__kicker"><span class="pcp__live" aria-hidden="true"></span>' +
          '<span class="pcp__kt">People&rsquo;s Choice <span class="pcp__sep" aria-hidden="true">&middot;</span> <span class="pcp__now">Voting is open</span></span></p>' +
        '<div class="pcp__stage" aria-hidden="true"><div class="pcp__burst">' + bits + '</div><ul class="pcp__faces">' + faces + '</ul></div>' +
        '<h2 class="ann__title wm pcp__title" id="pcp-title">who gets<br> your vote?</h2>' +
        '<p class="ann__copy pcp__copy" id="pcp-copy">Twenty young founders are in the running for the People&rsquo;s Choice Award. Watch their pitches and vote for your favorite, once a day' +
          (closes ? ', until <strong>' + closes + '</strong>' : '') + '.</p>' +
        '<p class="ann__cta">' +
          '<a class="btn btn--lg" href="' + PC_URL + '" data-pcp-go>Vote now <span class="arr" aria-hidden="true">&rarr;</span></a>' +
          '<button class="ann__later" type="button" data-pcp-close>Maybe later</button>' +
        '</p>' +
      '</div>';
    document.body.appendChild(d);
    return d;
  }

  function pcShow(closes) {
    var d = pcBuild(closes);
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    function close() {
      if (!d.open || d.classList.contains('is-leaving')) return;
      if (reduce) { d.close(); return; }
      d.classList.add('is-leaving');
      setTimeout(function () { d.classList.remove('is-leaving'); d.close(); }, 300);
    }
    d.addEventListener('click', function (e) {
      if (e.target.closest('[data-pcp-close]')) { close(); return; }
      if (e.target === d) close();                                   // a click on the backdrop
    });
    d.addEventListener('cancel', function (e) { e.preventDefault(); close(); });   // Esc
    d.addEventListener('close', function () { d.remove(); });
    pcRemember();   // shown once is enough for this session, however it is closed
    d.showModal();
    if (typeof window.gtag === 'function') { try { window.gtag('event', 'pc_popup_shown'); } catch (e) {} }
    d.querySelector('[data-pcp-go]').addEventListener('click', function () {
      if (typeof window.gtag === 'function') { try { window.gtag('event', 'pc_popup_vote_click'); } catch (e) {} }
    });
  }

  function pcInvite() {
    var preview = /[?&]pcpopup=1\b/.test(location.search);
    if (!preview) {
      if (location.pathname.indexOf(PC_URL) === 0) return;          // they are already there
      if (pcSeen() || new Date() >= PC_HARD_END) return;
    }
    if (typeof HTMLDialogElement !== 'function') return;
    var t0 = Date.now();
    function later(closes) {
      function attempt() {
        if (!preview && pcSeen()) return;
        if (document.querySelector('dialog[open]') || document.hidden) { setTimeout(attempt, 1500); return; }
        pcShow(closes);
      }
      setTimeout(attempt, Math.max(0, PC_DELAY - (Date.now() - t0)));
    }
    if (preview) { later('October 28, 11:59 PM ET'); return; }
    fetch('/api/pc-vote.php', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok && d.open === true) later(d.closes_label || ''); })
      .catch(function () {});                                       // no answer, no pop-up
  }

  function start() { strike(); pcInvite(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
