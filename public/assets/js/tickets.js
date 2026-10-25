/* NextGen Summit — tickets.
   Eventbrite owns the transaction: prices, inventory, quantity and group rules, payment and the
   hidden scholarship ticket all live there. This file only opens their checkout modal over our
   page and shows a NextGen confirmation afterwards. Nothing about the order is decided here. */
(function () {
  'use strict';

  if (window.__ngsTickets) return;                    // never wire the page twice
  window.__ngsTickets = true;

  var EVENT_ID = '1999190304016';
  var EVENT_URL = 'https://www.eventbrite.com/e/nextgen-summit-tickets-' + EVENT_ID;
  var WIDGET_SRC = 'https://www.eventbrite.com/static/widgets/eb_widgets.js';
  var TRIGGER_ID = 'eventbrite-widget-modal-trigger-' + EVENT_ID;

  /* brandColor is the site's own --accent read from the stylesheet, so the checkout can never
     drift from the design token. The hex is only the fallback if the variable cannot be read. */
  var BRAND_FALLBACK = '#1FC7BE';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function accentColor() {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      return /^#[0-9a-f]{3,8}$/i.test(v) ? v.toUpperCase() : BRAND_FALLBACK;
    } catch (e) { return BRAND_FALLBACK; }
  }

  /* ---------- ours, after Eventbrite has done its own confirmation ---------- */
  function orderComplete() {
    // tell any open NextGen homepage to refresh its ticket counter (counter.js); nothing else listens
    try { new BroadcastChannel('nextgen-tickets').postMessage('order-complete'); } catch (e) {}
    var opts = $('[data-tickets]');
    var fine = $('[data-tickets-fine]');
    var done = $('[data-done]');
    if (!done) return;
    if (opts) opts.hidden = true;
    if (fine) fine.hidden = true;
    done.hidden = false;
    done.focus();
    if (window.dataLayer) window.dataLayer.push({ event: 'nextgen_ticket_order_complete' });
  }

  /* Is the checkout actually in front of the visitor?

     This used to answer "yes" to any element whose id began eventbrite-widget-modal, other
     than our own trigger. That was wrong, and it quietly disabled the fallback below.
     createWidget inserts <div id="eventbrite-widget-modal-overlay"> at the moment the widget
     is CREATED, long before anyone clicks -- verified on staging: with no modal open and no
     iframe on the page, the old test still returned true.

     So the 1500ms escape hatch could never fire. A visitor whose modal failed to draw -- an
     in-app browser, a blocked third-party frame -- got a button that did nothing at all,
     rather than being carried out to Eventbrite. That is the worst of the three outcomes and
     the only one nobody designed.

     The iframe is the real signal. The overlay counts only when it is genuinely displayed. */
  function modalIsOpen() {
    if (document.querySelector('iframe[src*="eventbrite"]')) return true;
    var o = document.getElementById('eventbrite-widget-modal-overlay');
    if (!o) return false;
    var cs = getComputedStyle(o);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && o.getBoundingClientRect().height > 0;
  }

  var wired = false;                                   // createWidget must never run twice

  function initCheckout() {
    if (wired) return;
    var links = $$('[data-eb]');
    var trigger = document.getElementById(TRIGGER_ID);
    if (!links.length || !trigger || !window.EBWidgets || typeof window.EBWidgets.createWidget !== 'function') return;

    try {
      window.EBWidgets.createWidget({
        widgetType: 'checkout',
        eventId: EVENT_ID,
        modal: true,
        modalTriggerElementId: TRIGGER_ID,
        themeSettings: {
          brandColor: accentColor(),
          fontColor: '#000000',
          background: '#FFFFFF'
        },
        onOrderComplete: orderComplete
      });
    } catch (e) {
      return;                                          // links stay plain links to Eventbrite
    }

    wired = true;
    document.documentElement.classList.add('eb-ready');
    $$('[data-eb-sr]').forEach(function (s) { s.textContent = ' (opens the Eventbrite checkout)'; });
    links.forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;   // a new tab on purpose
        e.preventDefault();
        trigger.click();
        // if the modal does not actually appear, go to Eventbrite rather than nowhere.
        // The same check decides whether a checkout actually OPENED, which is the one
        // funnel step a click alone cannot tell you -- and the reason this dashboard
        // never reports a click as a purchase.
        setTimeout(function () {
          if (modalIsOpen()) { ngd('checkout_open'); return; }
          window.location.href = a.href || EVENT_URL;
        }, 1500);
      });
    });
  }

  /* Their script is fetched once. If it is blocked or fails, or the page is not on https
     (Eventbrite refuses to draw the checkout there), the buttons simply stay links to the
     Eventbrite event page, which is the fallback everywhere. */
  function loadWidget() {
    if (location.protocol !== 'https:') return;
    if (window.EBWidgets) { initCheckout(); return; }
    var s = document.querySelector('script[src="' + WIDGET_SRC + '"]');
    if (!s) {
      s = document.createElement('script');
      s.src = WIDGET_SRC;
      s.async = true;
      document.head.appendChild(s);
    }
    s.addEventListener('load', initCheckout, { once: true });
    /* A tag already in the document may have finished loading before that listener was
       attached, and its load event will never fire again. Watch for the global as well,
       briefly, then give up rather than poll at a page forever. */
    var tries = 0;
    var wait = setInterval(function () {
      if (wired || ++tries > 40) { clearInterval(wait); return; }
      if (window.EBWidgets) { clearInterval(wait); initCheckout(); }
    }, 100);
  }

  /* ---------- NextGen Data ----------
     This file has no track() of its own -- the only dataLayer push in it is the order
     confirmation above -- so the two funnel steps that only exist here are sent directly.
     Guarded and fire-and-forget, exactly as in ngd-track.js: nothing on this page may ever
     fail because an analytics call did. */
  function ngd(kind) {
    try { if (window.NGD_BEACON) window.NGD_BEACON(kind, null); } catch (e) {}
  }

  /* The ticket page was opened. GA4 sees this page already; NextGen Data does not, and
     the visitor-to-ticket funnel cannot be joined up without it. */
  ngd('tickets_view');

  $$('[data-eb]').forEach(function (a) { if (!a.getAttribute('href')) a.href = EVENT_URL; });

  /* Start as soon as the markup is parsed, not at window.load.

     window.load waits for every image on the page. Measured on production, that is 448ms on
     fast broadband and much longer on a phone on mobile data -- and for the whole of that
     window the buttons are already painted, already tappable, and still plain links out to
     eventbrite.com with target="_blank". Someone who taps in that gap lands on Eventbrite
     and reports, correctly, that the embed is missing.

     initCheckout only needs the two links and the trigger button, all of which exist at
     DOMContentLoaded. The measured gap between first paint and a wired checkout was 382ms;
     this closes most of it. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadWidget, { once: true });
  } else {
    loadWidget();
  }
})();
