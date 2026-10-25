/* ============================================================================
   NEXTGEN DATA — the beacon.

   WHAT THIS IS FOR

   The site already emits a full analytics taxonomy: peoples-choice.js has a track()
   with 36 call sites and pc-stage.js has its own with 4, and both push to the
   dataLayer that GTM reads. Everything the leadership funnel needs is already being
   announced; it just goes to Google and not to us. So this file does not add a single
   event listener, does not touch a single handler, and does not know anything about
   voting. It exposes one function, and each existing track() calls it on one guarded
   line.

   THE RULE THIS FILE EXISTS TO OBEY

   At five places in peoples-choice.js, track() is called immediately before the UI
   continuation the voter is waiting on — track('vote_success') then repaintAfterVote(),
   track('otp_verified') then confirmStep(), and three more of the same shape — and
   several of those sit inside a promise callback, where a thrown error is swallowed by
   the promise and produces no visible failure at all. A beacon that can throw inside
   track() would therefore record the vote on the server and leave the screen stuck,
   with nothing in the console to explain it.

   So: every path through this file is inside try/catch, nothing is ever awaited,
   nothing is returned into a promise chain, and no caller can observe success or
   failure. If this file fails to load, window.NGD_BEACON is simply undefined and the
   one-line call sites skip it. The endpoint answers 204 to everything — including when
   collection is switched off — so there is no response worth waiting for either.

   WHAT IT SENDS, AND WHAT IT NEVER SENDS

   An event name from a fixed map, the page's PATH (never the full URL, never the query
   string), an optional contestant id, an optional campaign label, and a per-tab random
   id. No cookie is set or read. No name, email address, phone number or voter key is
   ever in the payload — the same rule the existing track() already follows, stated at
   peoples-choice.js:149-151. The visitor is identified server-side by a token salted
   with the Eastern day, which stops being linkable tomorrow (ngd-lib.php:376).

   Site event names that are not in the map below are not sent at all. That is the
   allow-list: adding an event to the site does not silently add it here.
   ========================================================================= */
(function () {
  'use strict';

  var URL_ = '/api/ngd-collect.php';

  /* site event name -> the kind the collector accepts (ngd-lib.php NGD_EVENT_KINDS).
     Several site events map to one kind on purpose: "opened a founder" is the same step
     of the funnel whether it came from a card, a story bubble or the deck. */
  var KIND = {
    page_view:            'page_view',

    profile_view:         'founder_open',
    story_open:           'founder_open',
    story_jump:           'founder_open',
    deck_open:            'founder_open',
    entrant_link_visit:   'founder_open',
    reel_enter:           'founder_open',
    reel_enter_from_home: 'founder_open',

    video_play:           'video_play',

    vote_open:            'vote_start',
    verify_start:         'verify_open',
    otp_start:            'otp_request',
    email_otp_sent:       'otp_request',
    otp_verified:         'otp_verified',
    email_otp_verified:   'otp_verified',
    verify_complete:      'otp_verified',
    vote_success:         'vote_confirmed',

    vote_failed:          'vote_blocked',
    voting_closed_locally:'vote_blocked',
    otp_start_failed:     'vote_blocked',
    otp_check_failed:     'vote_blocked',

    bonus_claimed:        'bonus_claimed',
    attendee_unlocked:    'attendee_unlocked',

    tickets_click:        'ticket_cta',
    tickets_view:         'tickets_view',
    checkout_open:        'checkout_open',

    share_open:           'share_click',
    share_native:         'share_click',
    share_copy:           'share_click',

    /* the homepage cinematic section */
    home_view:            'founder_view',
    home_switch:          'founder_view',
    home_sound:           'founder_view',
    home_enter:           'nominees_open'
  };

  /* A per-TAB id, held in sessionStorage. Not a cookie: it is never sent to any other
     site, never survives the tab closing, and exists only so one visit's steps can be
     told apart from another's when the funnel is counted. If storage is unavailable --
     a private window, blocked site data -- we simply go without one. */
  function session() {
    try {
      var k = 'ngd-tab';
      var v = window.sessionStorage.getItem(k);
      if (v && /^[a-f0-9]{8,32}$/.test(v)) return v;
      var hex = '';
      if (window.crypto && window.crypto.getRandomValues) {
        var a = new Uint8Array(8);
        window.crypto.getRandomValues(a);
        for (var i = 0; i < a.length; i++) {
          hex += (a[i] < 16 ? '0' : '') + a[i].toString(16);
        }
      } else {
        while (hex.length < 16) { hex += Math.floor(Math.random() * 16).toString(16); }
      }
      window.sessionStorage.setItem(k, hex);
      return hex;
    } catch (e) {
      return null;
    }
  }

  /* The campaign label, read from the same query parameter the voting system already
     uses for contestant links, and cleaned to the same shape (pc-rules.php:138). */
  function source() {
    try {
      var m = /[?&](?:src|utm_source|ref)=([^&#]{1,60})/.exec(window.location.search);
      if (!m) return null;
      return decodeURIComponent(m[1]).replace(/[^a-z0-9_.-]/gi, '').slice(0, 40) || null;
    } catch (e) {
      return null;
    }
  }

  var sent = 0;

  function beacon(name, params) {
    try {
      var kind = KIND[String(name)];
      if (!kind) return;                      // not on the allow-list: not sent
      if (++sent > 150) return;               // a loop in a console cannot flood the store

      var body = { kind: kind, page: String(window.location.pathname || '/') };
      var s = session();
      if (s) body.session = s;
      var src = source();
      if (src) body.source = src;

      if (params) {
        /* Only the two fields the collector will keep, and only in the shapes it accepts.
           Everything else the site puts on a dataLayer event stays on the dataLayer. */
        var e = params.entrant || params.entrant_id || params.id;
        if (typeof e === 'string' && /^entrant-\d{2}$/.test(e)) body.entrant = e;
        var r = params.reason;
        if (typeof r === 'string') body.meta = { reason: r.replace(/[^a-z0-9_.: -]/gi, '').slice(0, 40) };
      }

      var json = JSON.stringify(body);

      /* sendBeacon is the right tool: the browser owns the request, it survives the page
         going away, and it cannot be awaited even by mistake. */
      if (window.navigator && typeof window.navigator.sendBeacon === 'function') {
        try {
          window.navigator.sendBeacon(URL_, new Blob([json], { type: 'text/plain;charset=UTF-8' }));
          return;
        } catch (e) { /* fall through to fetch */ }
      }
      if (typeof window.fetch === 'function') {
        /* keepalive so a click that navigates away still delivers. The catch is attached
           immediately so an unhandled rejection can never surface. */
        window.fetch(URL_, {
          method: 'POST',
          body: json,
          keepalive: true,
          credentials: 'omit',
          headers: { 'Content-Type': 'text/plain' }
        })['catch'](function () {});
      }
    } catch (e) {
      /* Deliberately silent. See the header: a voter is sometimes waiting on the line
         after the track() call that reached this function. */
    }
  }

  try {
    window.NGD_BEACON = beacon;
  } catch (e) {}
})();
