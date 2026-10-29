/* NextGen Summit: the extended pitch deadline (see css/announce.css).
   Draws the strike through October 17 on every .dl as it scrolls into view.
   Also opens the countdown pop-up in the days before the summit (see below).
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


  /* ---------- the countdown pop-up ----------
     Three seconds into a visit, once per browser session: "nextgen is in 2 days. See you on
     Friday." The number of days is worked out on Eastern time every visit, so it changes by
     itself (2 days, then tomorrow, then today) and the pop-up stops after the summit.
     Add ?cdpopup=1 to any URL to preview it, and ?cdpopup=1&cdtoday=2026-10-29 to preview a
     particular day. (The People's Choice pop-up was retired here when voting closed.) */
  var CD_EVENT = '2026-10-30';                 // Friday, October 30
  var CD_KEY = 'ngs-countdown-popup-seen';
  var CD_DELAY = 3000;

  function cdSeen() { try { return sessionStorage.getItem(CD_KEY) === '1'; } catch (e) { return false; } }
  function cdRemember() { try { sessionStorage.setItem(CD_KEY, '1'); } catch (e) {} }

  // today's date in New York, as YYYY-MM-DD, whatever time zone the visitor's device is in
  function todayEastern() {
    try {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      var get = function (t) { for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return parts[i].value; return ''; };
      return get('year') + '-' + get('month') + '-' + get('day');
    } catch (e) {
      var d = new Date(Date.now() - 4 * 3600 * 1000);   // old browsers: EDT is close enough this week
      return d.toISOString().slice(0, 10);
    }
  }
  function daysBetween(a, b) {               // whole calendar days from a to b
    return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) -
                       Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);
  }

  function cdShow(days) {
    var title, bye;
    if (days >= 2) { title = 'nextgen is in<br> <span class="cdp__n">' + days + '</span> days.'; bye = 'See you on Friday.'; }
    else if (days === 1) { title = 'nextgen is<br> tomorrow.'; bye = 'See you tomorrow.'; }
    else { title = 'nextgen is<br> today.'; bye = 'See you today.'; }
    var plain = days >= 2 ? 'NextGen is in ' + days + ' days.' : days === 1 ? 'NextGen is tomorrow.' : 'NextGen is today.';

    var d = document.createElement('dialog');
    d.className = 'ann cdp';
    d.id = 'countdown-news';
    d.setAttribute('aria-labelledby', 'cdp-title');
    d.setAttribute('aria-describedby', 'cdp-copy');
    d.innerHTML =
      '<div class="ann__bar" aria-hidden="true"></div>' +
      '<div class="ann__in" tabindex="-1" autofocus>' +
        '<button class="ann__close" type="button" data-cdp-close aria-label="Close">' +
          '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 2l14 14M16 2L2 16" stroke="currentColor" stroke-width="2" fill="none"/></svg>' +
        '</button>' +
        '<p class="ann__kicker cdp__kicker"><span>Friday, October 30 <span aria-hidden="true">&middot;</span> Gordon Center</span></p>' +
        '<h2 class="ann__title wm cdp__title" id="cdp-title"><span aria-hidden="true">' + title + '</span><span class="sr">' + plain + '</span></h2>' +
        '<p class="cdp__bye" id="cdp-copy">' + bye + '</p>' +
        '<p class="ann__cta">' +
          '<a class="btn btn--lg" href="/tickets/" data-cdp-go>Get tickets</a>' +
          '<button class="ann__later" type="button" data-cdp-close>Close</button>' +
        '</p>' +
      '</div>';
    document.body.appendChild(d);

    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    function close() {
      if (!d.open || d.classList.contains('is-leaving')) return;
      if (reduce) { d.close(); return; }
      d.classList.add('is-leaving');
      setTimeout(function () { d.classList.remove('is-leaving'); d.close(); }, 300);
    }
    d.addEventListener('click', function (e) {
      if (e.target.closest('[data-cdp-close]')) { close(); return; }
      if (e.target === d) close();                                   // a click on the backdrop
    });
    d.addEventListener('cancel', function (e) { e.preventDefault(); close(); });   // Esc
    d.addEventListener('close', function () { d.remove(); });
    cdRemember();   // once a session, however it is closed
    d.showModal();
    if (typeof window.gtag === 'function') { try { window.gtag('event', 'countdown_popup_shown', { days: days }); } catch (e) {} }
  }

  function cdInvite() {
    var preview = /[?&]cdpopup=1\b/.test(location.search);
    var forced = (location.search.match(/[?&]cdtoday=(\d{4}-\d{2}-\d{2})/) || [])[1];
    var days = daysBetween(forced || todayEastern(), CD_EVENT);
    if (days < 0 || days > 7) return;                                // only the week of, and never after
    if (!preview && cdSeen()) return;
    if (typeof HTMLDialogElement !== 'function') return;
    function attempt() {
      if (!preview && cdSeen()) return;
      // never on top of a menu or a form someone already has open: wait until it closes
      if (document.querySelector('dialog[open]') || document.hidden) { setTimeout(attempt, 1500); return; }
      cdShow(days);
    }
    setTimeout(attempt, CD_DELAY);
  }

  function start() { strike(); cdInvite(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
