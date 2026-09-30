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

  /* Eventbrite draws the modal as an iframe; anything else with their id prefix except our own
     trigger button counts as the modal being up. */
  function modalIsOpen() {
    return !!document.querySelector('iframe[src*="eventbrite"], [id^="eventbrite-widget-modal"]:not(#' + TRIGGER_ID + ')');
  }

  function initCheckout() {
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

    document.documentElement.classList.add('eb-ready');
    $$('[data-eb-sr]').forEach(function (s) { s.textContent = ' (opens the Eventbrite checkout)'; });
    links.forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;   // a new tab on purpose
        e.preventDefault();
        trigger.click();
        // if the modal does not actually appear, go to Eventbrite rather than nowhere
        setTimeout(function () { if (!modalIsOpen()) window.location.href = a.href || EVENT_URL; }, 1500);
      });
    });
  }

  /* Their script is loaded once, after our page has rendered. If it is blocked or fails, or the
     page is not on https (Eventbrite refuses to draw the checkout there), the buttons simply stay
     links to the Eventbrite event page, which is the fallback everywhere. */
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
  }

  $$('[data-eb]').forEach(function (a) { if (!a.getAttribute('href')) a.href = EVENT_URL; });

  if (document.readyState === 'complete') loadWidget();
  else window.addEventListener('load', loadWidget, { once: true });
})();
