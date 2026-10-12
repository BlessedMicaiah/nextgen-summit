/* NextGen Summit — the application forms.
   Google Forms and Typeform still own the questions, the answers and the storage; this file only
   brings them inside the site. Each panel is an ordinary dialog.drawer, so site.js already gives
   it Escape, the backdrop, the focus trap and the scroll lock; all that is left is to load the
   provider's page the first time the panel opens, and never before.

   Every trigger keeps its href. With no JavaScript, a blocked provider or an old browser, the
   button is still a plain link to the same form. */
(function () {
  'use strict';

  if (window.__ngsForms) return;
  window.__ngsForms = true;

  var panels = document.querySelectorAll('dialog.drawer--form');
  if (!panels.length) return;

  function load(panel) {
    var frame = panel.querySelector('iframe[data-src]');
    if (!frame) return;                                 // already loaded
    frame.src = frame.getAttribute('data-src');
    frame.removeAttribute('data-src');
  }

  // the click runs before site.js opens the panel, so the provider starts loading with the slide
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-open]');
    if (!t) return;
    var panel = document.getElementById(t.getAttribute('data-open'));
    if (panel && panel.classList.contains('drawer--form')) load(panel);
  }, true);

  // the same panels open from a #hash, which site.js handles on load and on hashchange
  function fromHash() {
    var panel = document.getElementById(location.hash.slice(1));
    if (panel && panel.classList.contains('drawer--form')) load(panel);
  }
  addEventListener('hashchange', fromHash);
  fromHash();

  // the triggers are links until this file runs; now they say what they really do
  Array.prototype.forEach.call(document.querySelectorAll('[data-form-sr]'), function (s) {
    s.textContent = ' (opens the application on this page)';
  });
})();
