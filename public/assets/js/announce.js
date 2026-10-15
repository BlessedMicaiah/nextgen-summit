/* NextGen Summit: the extended pitch deadline (see css/announce.css).
   - Draws the strike through October 17 on every .dl as it scrolls into view.
   - Opens the announcement 4 seconds into a visit, once per browser session, with an
     Apply Now link to the pitch application. Stops by itself after October 20.
   Remove this file, announce.css and their two tags per page once the deadline is past. */
(function () {
  'use strict';

  var DEADLINE_END = new Date('2026-10-21T00:00:00-04:00');   // the end of October 20, Eastern
  var DELAY = 4000;                                           // the brief asks for 3 to 5 seconds
  var KEY = 'ngs-pitch-deadline-oct20-seen';

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

  /* ---------- the announcement ---------- */
  function seen() { try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function remember() { try { sessionStorage.setItem(KEY, '1'); } catch (e) {} }

  function build() {
    // on the pitch page the application opens in its own panel; anywhere else the link goes there
    var here = !!document.getElementById('apply-pitch');
    var d = document.createElement('dialog');
    d.className = 'ann';
    d.id = 'deadline-news';
    d.setAttribute('aria-labelledby', 'ann-title');
    d.setAttribute('aria-describedby', 'ann-copy');
    d.innerHTML =
      '<div class="ann__bar" aria-hidden="true"></div>' +
      '<div class="ann__in" tabindex="-1" autofocus>' +
        '<button class="ann__close" type="button" data-ann-close aria-label="Close">' +
          '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 2l14 14M16 2L2 16" stroke="currentColor" stroke-width="2" fill="none"/></svg>' +
        '</button>' +
        '<p class="ann__kicker">Great news</p>' +
        '<h2 class="ann__title wm" id="ann-title">more time<br> to pitch.</h2>' +
        '<p class="ann__date">' +
          '<span class="dl" aria-hidden="true"><del class="dl__old">October 17</del><ins class="dl__new">October 20</ins></span>' +
          '<span class="sr">New deadline: October 20</span>' +
        '</p>' +
        '<p class="ann__copy" id="ann-copy">The NextGen Pitch Competition submission deadline has officially been extended to October 20th.</p>' +
        '<p class="ann__cta">' +
          '<a class="btn btn--lg" href="/pitch/#apply-pitch"' + (here ? ' data-open="apply-pitch"' : '') + ' data-ann-apply>Apply now</a>' +
          '<button class="ann__later" type="button" data-ann-close>Maybe later</button>' +
        '</p>' +
      '</div>';
    document.body.appendChild(d);
    return d;
  }

  function show() {
    var d = build();
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var date = d.querySelector('.dl');

    function close() {
      if (!d.open || d.classList.contains('is-leaving')) return;
      if (reduce) { d.close(); return; }
      d.classList.add('is-leaving');
      setTimeout(function () { d.classList.remove('is-leaving'); d.close(); }, 300);
    }

    d.addEventListener('click', function (e) {
      if (e.target.closest('[data-ann-close]')) { close(); return; }
      if (e.target.closest('[data-ann-apply]')) { d.close(); return; }   // at once: the application takes over
      if (e.target === d) close();                                          // a click on the backdrop
    });
    d.addEventListener('cancel', function (e) { e.preventDefault(); close(); });   // Esc
    d.addEventListener('close', function () { d.remove(); });

    remember();   // shown once is enough for this session, however it is closed
    d.showModal();
    setTimeout(function () { date.classList.add('is-on'); }, reduce ? 0 : 250);
  }

  function announce() {
    if (new Date() >= DEADLINE_END || seen() || typeof HTMLDialogElement !== 'function') return;
    function attempt() {
      if (seen()) return;
      // never on top of a menu or a form someone already has open: wait until it closes
      if (document.querySelector('dialog[open]') || document.hidden) { setTimeout(attempt, 1500); return; }
      show();
    }
    setTimeout(attempt, DELAY);
  }

  function start() { strike(); announce(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
