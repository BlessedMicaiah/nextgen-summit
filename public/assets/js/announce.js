/* NextGen Summit: the extended pitch deadline (see css/announce.css).
   Draws the strike through October 17 on every .dl as it scrolls into view.
   (The announcement pop-up was removed once the October 20 deadline passed.) */
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

  function start() { strike(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
