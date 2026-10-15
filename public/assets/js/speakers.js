/* NextGen Summit — featured speakers.
   Three states. A deck of four collectible cards on a dark stage; the chosen card, enlarged;
   and its reverse, with the credentials, when it is turned over.

   The deck does one thing: it opens. The cards sit stacked, NextGen on top, until the section
   comes into view, and then each slides and turns to the place CSS has already given it. It is
   observed once and then forgotten, so a small scroll cannot make it open and close again, and
   nothing animates afterwards. Where the cards land is in the stylesheet, because that is where
   the difference between a wide fan and a phone's two-by-two belongs.

   Every line a card says is written here, as text, so it can be corrected without touching a
   picture. Each line comes from an authoritative source for that person. */
(function () {
  'use strict';

  if (window.__ngsSpeakers) return;
  window.__ngsSpeakers = true;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var deck = $('[data-deck]');
  var dlg = $('#speaker');
  if (!deck || !dlg) return;

  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var hoverMQ = window.matchMedia ? matchMedia('(hover:hover) and (pointer:fine)') : { matches: false };

  /* ---------- the people ----------
     `wins` is the credential list on the back: a label and the thing itself. `icon` picks one
     of the outlines below. `link` is only ever a profile we have actually seen. */
  var PEOPLE = {
    tunde: {
      first: 'Tunde', last: 'Onakoya',
      role: 'National Master <span aria-hidden="true">&middot;</span> Founder, Chess in Slums Africa',
      roleFlat: 'National Master, Founder of Chess in Slums Africa',
      shot: 'tunde-onakoya',
      wins: [
        { k: '2018', v: 'Founded Chess in Slums Africa', icon: 'people' },
        { k: 'Chess', v: 'Nigerian National Master', icon: 'board' },
        { k: 'April 2025', v: 'Guinness World Record, longest chess marathon: 64 hours with Shawn Martinez', icon: 'cup' },
        { k: 'Impact', v: 'Education and youth empowerment through chess', icon: 'book' }
      ],
      link: 'https://www.linkedin.com/in/tunde-onakoya'
    },
    tisha: {
      first: 'Tisha', last: 'Edwards',
      role: 'President &amp; CEO, Maryland Bankers Association <span aria-hidden="true">&middot;</span> Former Secretary of Appointments, State of Maryland',
      roleFlat: 'President and CEO, Maryland Bankers Association; Former Secretary of Appointments, State of Maryland',
      suffix: 'Tisha Edwards, MSW, JD',
      shot: 'tisha-edwards',
      wins: [
        { k: '2025', v: 'President &amp; CEO, Maryland Bankers Association', icon: 'case' },
        { k: '2025', v: 'Joined the University System of Maryland Board of Regents', icon: 'cap' },
        { k: 'Public service', v: 'Former Secretary of Appointments, State of Maryland', icon: 'people' },
        { k: 'Education', v: 'Former Interim CEO, Baltimore City Public Schools', icon: 'book' }
      ],
      link: 'https://www.linkedin.com/in/tisha-edwards'
    },
    // From his own site, kennedyekezie.com, which also gives the LinkedIn address. The Forbes
    // listing is not on his site; it is the 2024 list, per Wikipedia, BellaNaija and BusinessDay,
    // which disagree on the regional edition, so the card does not name one. Kippa is in the
    // past tense because his site puts it there: "Previously, founder and CEO at Kippa".
    kennedy: {
      first: 'Kennedy', last: 'Ekezie',
      role: 'Technology entrepreneur <span aria-hidden="true">&middot;</span> Founder, Kippa',
      roleFlat: 'Technology entrepreneur, Founder of Kippa',
      shot: 'kennedy-ekezie',
      wins: [
        { k: 'Kippa', v: 'Founder and former CEO of a financial management platform used by 1 million businesses', icon: 'case' },
        { k: 'TikTok', v: 'Led TikTok&rsquo;s international expansion into Africa', icon: 'people' },
        { k: '2024', v: 'Forbes 30 Under 30', icon: 'cup' },
        { k: 'Global', v: 'Born in Lagos; has lived in Beijing, San Francisco and London', icon: 'globe' }
      ],
      link: 'https://www.linkedin.com/in/kennedyekezie/'
    },

    /* Verified against local reporting and her university: crowned Miss Maryland in June 2026,
       a business communication major at Stevenson in Owings Mills, the Bloom Initiative is her
       own platform on healthy relationships, and the baton twirling won the talent segment. */
    gianna: {
      first: 'Gianna', last: 'Romero',
      role: 'Miss Maryland 2026',
      roleFlat: 'Miss Maryland 2026',
      shot: 'gianna-romero',                                    // portrait still to come
      wins: [
        { k: '2026', v: 'Crowned Miss Maryland', icon: 'crown' },
        { k: 'Education', v: 'Stevenson University, Business Communication', icon: 'cap' },
        { k: 'Initiative', v: 'The Bloom Initiative: healthy relationships education', icon: 'heart' },
        { k: 'Talent', v: 'Baton twirling', icon: 'star' }
      ],
      link: 'https://www.linkedin.com/in/gianna-romero-26b855361'
    },

    /* SUPPLIED, NOT YET VERIFIED. Nothing found connecting this name to Revival Financial,
       Towson, or the Araminta board; Araminta's own board announcement does not list him.
       Do not publish until someone confirms it. */
    michael: {
      first: 'Michael', last: 'Ley',
      role: 'Entrepreneur and investor <span aria-hidden="true">&middot;</span> Founder, Revival Financial',
      roleFlat: 'Entrepreneur and investor, Founder of Revival Financial',
      shot: 'michael-ley',
      unverified: true,
      wins: [
        { k: 'Founder', v: 'Revival Financial', icon: 'people' },
        { k: 'Education', v: 'Towson University', icon: 'cap' },
        { k: 'Experience', v: 'Background in marketing and management', icon: 'case' },
        { k: 'Community', v: 'Board member, Araminta Freedom Initiative', icon: 'heart' }
      ],
      link: 'https://www.linkedin.com/in/michael-ley-004ba631'
    },

    /* The Mindful Project, the conversation-card game and the mental-health work are confirmed
       from his own podcast interview. The platform handles are not, so the card names the
       platforms without claiming an audience on them. */
    jack: {
      first: 'Jack', last: 'Scalise',
      role: 'Content creator <span aria-hidden="true">&middot;</span> Social media influencer',
      roleFlat: 'Content creator and social media influencer',
      shot: 'jack-scalise',
      wins: [
        { k: 'Content', v: 'Positive, motivational videos', icon: 'play' },
        { k: 'Platforms', v: 'Instagram and TikTok', icon: 'people' },
        { k: 'Impact', v: 'Mental health advocacy and human connection', icon: 'heart' },
        { k: 'Project', v: 'The Mindful Project, a conversation-card concept', icon: 'bulb' }
      ],
      link: 'https://www.linkedin.com/in/jack-scalise'
    }
  };

  var ICON = {
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.1"/><path d="M3.2 19a5.8 5.8 0 0 1 11.6 0"/><path d="M16.5 8.2a2.6 2.6 0 1 0 0-.2M17 13.4A4.9 4.9 0 0 1 20.8 18"/></svg>',
    board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3.6" y="3.6" width="16.8" height="16.8" rx="1.6"/><path d="M3.6 9.2h16.8M3.6 14.8h16.8M9.2 3.6v16.8M14.8 3.6v16.8"/></svg>',
    cup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 5.5H5A2.2 2.2 0 0 0 7.5 9M16.5 5.5H19A2.2 2.2 0 0 1 16.5 9"/><path d="M12 13.5V17M9 20h6"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.6S10.4 4.8 4.8 4.8v12.6c5.6 0 7.2 1.8 7.2 1.8s1.6-1.8 7.2-1.8V4.8C13.6 4.8 12 6.6 12 6.6z"/><path d="M12 6.6v12.6"/></svg>',
    case: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3.2" y="7.2" width="17.6" height="12.4" rx="1.8"/><path d="M8.8 7.2V5.6a1.6 1.6 0 0 1 1.6-1.6h3.2a1.6 1.6 0 0 1 1.6 1.6v1.6M3.2 12.4h17.6"/></svg>',
    cap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.4 21.2 9 12 13.6 2.8 9z"/><path d="M6.4 11v4.6c0 1.4 2.5 2.6 5.6 2.6s5.6-1.2 5.6-2.6V11"/></svg>',
    crown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.4 7.6l3.3 3.1L12 5.2l5.3 5.5 3.3-3.1-1.5 10.2H4.9z"/><path d="M4.9 17.8h14.2"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19.6S3.9 14.9 3.9 9.6A4.1 4.1 0 0 1 12 7.9a4.1 4.1 0 0 1 8.1 1.7c0 5.3-8.1 10-8.1 10z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.4" y="5.2" width="17.2" height="13.6" rx="2.6"/><path d="M10.4 9.6l4.6 2.6-4.6 2.6z"/></svg>',
    bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.3 17.2a6 6 0 1 1 5.4 0"/><path d="M9.6 17.4h4.8M10.4 20.2h3.2"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8M12 3.6c2.3 2.4 3.4 5.2 3.4 8.4s-1.1 6-3.4 8.4c-2.3-2.4-3.4-5.2-3.4-8.4s1.1-6 3.4-8.4z"/></svg>'
  };

  /* ---------- the two experiences ----------
     One deck of cards in the markup and two ways of dealing it. Neither experience owns a card:
     they move the same elements, and both open the same dialog from the same data.

     Option one is scroll driven. The section is tall and the deck sticks inside it, so where you
     are in the section decides which of four states the deck is in. The state is a class, so the
     movement between states is an ordinary CSS transition -- nothing is positioned frame by
     frame, and scrolling back up simply runs it in reverse.

     Option two deals the top card off the pile every few seconds, and stops the moment anyone
     shows an interest in reading rather than watching. */
  var expHold = null;          // option two's pause switch, once that experience is set up
  var swiped = false;          // a swipe ends in a pointerup over a card; it is not a tap
  var exp = $('.exp');
  var deckEl = $('[data-deck]');
  if (exp && deckEl) {
    var cards = $$('.card', deckEl);
    var speakerCards = cards.filter(function (c) { return !!$('[data-spk]', c); });
    var moreEl = $('[data-exp-more]');
    var setEl = $('[data-exp-set]');
    var barEl = $('[data-exp-bar]');
    var nEl = $('[data-exp-n]');
    var mode = 'one';

    /* --- option one --- */
    var STATES = ['is-stack', 'is-a', 'is-shut', 'is-b'];
    var SET_TEXT = ['', 'First three of six', 'The NextGen collection', 'Second three of six'];
    var stateAt = -1, oneRaf = null, openAt = -1;

    function setState(i) {
      if (i === stateAt) return;
      stateAt = i;
      STATES.forEach(function (c, n) { deckEl.classList.toggle(c, n === i); });
      if (setEl) setEl.textContent = SET_TEXT[i] || '';
      // a card that is not being shown must not be reachable by keyboard either
      cards.forEach(function (c) {
        var grp = c.getAttribute('data-grp');
        var on = grp === 'mark' ? false : (grp === 'a' ? i === 1 : i === 3);
        var btn = $('[data-spk]', c);
        if (btn) btn.tabIndex = on ? 0 : -1;
      });
    }

    /* The opening is tied to the scroll rather than fired by it. --o runs 0 to 1 as the deck
       comes up the screen and the cards read it directly, so they start separating on the first
       pixel of scroll instead of waiting for a threshold. Measured before this: the deck sat
       still for 1075px -- more than a whole screen -- because progress only began once the
       section's top had passed the top of the viewport, and then a dead band ate 14% more. */
    var LEAD = 0.92;        // progress starts while the deck is still almost a screen down
    var SPREAD = 0.16;      // and the cards are fully dealt this far into the run

    function readScroll() {
      oneRaf = null;
      if (mode !== 'one') return;
      var vh = window.innerHeight;
      var r = exp.getBoundingClientRect();
      var head = vh * LEAD;
      var span = head + r.height - vh;
      if (span <= 0) { deckEl.style.setProperty('--o', '1'); setState(1); return; }
      var p = Math.min(1, Math.max(0, (head - r.top) / span));

      var o = Math.min(1, p / SPREAD);
      if (o !== openAt) {
        openAt = o;
        deckEl.style.setProperty('--o', o.toFixed(4));
        // while the scroll is driving it the cards must not also be easing, or they lag behind
        deckEl.classList.toggle('is-live', o < 1);
        // the NextGen card faces out until the deal is properly under way
        deckEl.classList.toggle('is-lid', o < 0.4);
      }
      /* The lead-in means p is already part-spent by the time the deck settles, so the bands
         sit later than they would without it: the first three are dealt by 0.16 and then hold
         while the deck is stuck, the deck closes on the NextGen card, and the second three are
         dealt. */
      setState(p < 0.56 ? 1 : p < 0.72 ? 2 : 3);
    }
    function onScroll() { if (oneRaf === null) oneRaf = requestAnimationFrame(readScroll); }

    /* --- option two --- */
    var TURN = 4500;
    var at = 0, timer = null, held = { hover: false, drag: false, dialog: false, away: false, hidden: false };

    function arrange() {
      var n = speakerCards.length;
      speakerCards.forEach(function (c, i) {
        var d = (i - at + n) % n;
        c.classList.remove('is-front', 'is-next', 'is-after');
        if (d === 0) c.classList.add('is-front');
        else if (d === 1) c.classList.add('is-next');
        else if (d === 2) c.classList.add('is-after');
        var btn = $('[data-spk]', c);
        if (btn) btn.tabIndex = d === 0 ? 0 : -1;
      });
      if (nEl) nEl.textContent = ('0' + (at + 1)).slice(-2);
    }

    function go(step) {
      var n = speakerCards.length;
      var leaving = speakerCards[at];
      at = (at + step + n) % n;
      if (step > 0 && leaving) {
        leaving.classList.add('is-out');
        setTimeout(function () { leaving.classList.remove('is-out'); arrange(); }, 340);
      }
      arrange();
    }

    expHold = function (k, v) { hold(k, v); };
    function stopped() { return held.hover || held.drag || held.dialog || held.away || held.hidden; }
    function tick() { clearInterval(timer); timer = null; if (mode === 'two' && !stopped() && !reduce.matches) timer = setInterval(function () { go(1); }, TURN); }
    function hold(k, v) { held[k] = v; if (v) { clearInterval(timer); timer = null; } else tick(); }

    // dragging and swiping, on one set of pointer handlers for mouse and touch alike
    var down = null;
    deckEl.addEventListener('pointerdown', function (e) {
      if (mode !== 'two' || e.button) return;
      down = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false };
      hold('drag', true);
    });
    deckEl.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y;
      // a vertical gesture is the page scrolling, and is left alone
      if (!down.moved && Math.abs(dy) > Math.abs(dx)) { down = null; hold('drag', false); return; }
      if (Math.abs(dx) > 8) down.moved = true;
    });
    function endDrag(e) {
      if (!down) return;
      var dx = (e.clientX || 0) - down.x;
      var quick = Date.now() - down.t < 500;
      if (down.moved && (Math.abs(dx) > 56 || (quick && Math.abs(dx) > 28))) go(dx < 0 ? 1 : -1);
      var wasDrag = down.moved;
      down = null;
      hold('drag', false);
      if (wasDrag) { swiped = true; setTimeout(function () { swiped = false; }, 0); }
    }
    deckEl.addEventListener('pointerup', endDrag);
    deckEl.addEventListener('pointercancel', function () { down = null; hold('drag', false); });

    if (barEl) {
      $('[data-exp-prev]', barEl).addEventListener('click', function () { go(-1); tick(); });
      $('[data-exp-next]', barEl).addEventListener('click', function () { go(1); tick(); });
    }
    deckEl.addEventListener('keydown', function (e) {
      if (mode !== 'two') return;
      if (e.key === 'ArrowRight') { go(1); tick(); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { go(-1); tick(); e.preventDefault(); }
    });
    deckEl.addEventListener('pointerenter', function () { if (hoverMQ.matches) hold('hover', true); });
    deckEl.addEventListener('pointerleave', function () { if (hoverMQ.matches) hold('hover', false); });
    deckEl.addEventListener('focusin', function () { hold('hover', true); });
    deckEl.addEventListener('focusout', function () { hold('hover', false); });
    document.addEventListener('visibilitychange', function () { hold('hidden', document.hidden); });

    new IntersectionObserver(function (es) {
      held.away = !es[0].isIntersecting;
      if (held.away) { clearInterval(timer); timer = null; } else tick();
    }, { rootMargin: '0px' }).observe(exp);

    /* --- switching between them --- */
    function setMode(m, reveal) {
      mode = m;
      exp.setAttribute('data-exp', m);
      exp.classList.toggle('exp--one', m === 'one');
      exp.classList.toggle('exp--two', m === 'two');
      if (barEl) barEl.hidden = m !== 'two';
      if (moreEl) moreEl.hidden = m !== 'one';
      if (setEl) setEl.hidden = m !== 'one';
      $$('[data-exp-pick]').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-exp-pick') === m));
      });
      clearInterval(timer); timer = null;
      cards.forEach(function (c) { c.classList.remove('is-front', 'is-next', 'is-after', 'is-out'); });
      if (m === 'one') {
        STATES.forEach(function (c) { deckEl.classList.remove(c); });
        stateAt = -1;
        readScroll();
        addEventListener('scroll', onScroll, { passive: true });
      } else {
        removeEventListener('scroll', onScroll);
        STATES.forEach(function (c) { deckEl.classList.remove(c); });
        at = 0; arrange(); tick();
      }
      // Stack Reveal is several screens tall. Keep a deliberate switch at the deck
      // when that height changes, and cancel any old smooth-scroll destination.
      // Initial page setup keeps the visitor's existing scroll position.
      if (reveal) {
        var navHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 80;
        var top = Math.max(0, window.scrollY + exp.getBoundingClientRect().top - navHeight - 24);
        if (!window.NGScrollTo || !window.NGScrollTo(top, { immediate: true, force: true })) {
          window.scrollTo({ top: top, behavior: 'instant' });
        }
        if (m === 'one') readScroll();
      }
      try { sessionStorage.setItem('ngsExp', m); } catch (e) {}
    }

    // the switch is for review, so it only exists where review happens
    var host = location.hostname;
    var review = host.indexOf('staging.') === 0 || host === 'localhost' || host === '127.0.0.1' ||
      /[?&]exp=/.test(location.search);
    var sel = $('[data-expsel]');
    if (review && sel) {
      sel.hidden = false;
      $$('[data-exp-pick]').forEach(function (b) {
        b.addEventListener('click', function () { setMode(b.getAttribute('data-exp-pick'), true); });
      });
    }
    var want = (location.search.match(/[?&]exp=(one|two)/) || [])[1];
    if (!want && review) { try { want = sessionStorage.getItem('ngsExp'); } catch (e) {} }
    setMode(want === 'two' ? 'two' : 'one');
    addEventListener('resize', onScroll, { passive: true });
  }

  /* ---------- states two and three: the collectible ---------- */
  var front = $('[data-sp-front]', dlg);
  var back = $('[data-sp-back]', dlg);
  var opener = null;

  function hasShot(key) { return !!(PEOPLE[key] && PEOPLE[key].shot); }

  /* A speaker with no portrait yet shows their name set in the house face rather than a
     stand-in picture. Give the card a `shot` and it becomes a photograph with no other
     change. */
  function shotTag(key, cls, alt) {
    var p = PEOPLE[key];
    if (!p.shot) {
      return '<span class="sp__await' + (cls ? ' ' + cls : '') + '">' +
        '<span class="sp__await-n wm">' + p.first + '<br>' + p.last + '</span>' +
        '<span class="sp__await-k">Portrait to come</span></span>';
    }
    return '<img class="' + cls + '" src="assets/img/speakers/' + p.shot + '-620.jpg"' +
      ' srcset="assets/img/speakers/' + p.shot + '-620.jpg 620w, assets/img/speakers/' + p.shot + '-900.jpg 900w"' +
      ' sizes="(max-width:560px) 94vw, 430px" width="900" height="1260" decoding="async" alt="' + alt + '">';
  }

  function paint(key) {
    var p = PEOPLE[key];
    if (!p) return false;
    var full = p.suffix || (p.first + ' ' + p.last);

    front.innerHTML =
      '<div class="sp__pane">' +
        '<div class="sp__top">' +
          '<p class="sp__wm wm">nextgen<small>Summit</small></p>' +
          '<p class="sp__when">Friday<b>Oct 30</b>Maryland</p>' +
        '</div>' +
        '<p class="sp__say" aria-hidden="true"><i></i><span>See what&rsquo;s possible.</span></p>' +
        '<span class="sp__shot">' + shotTag(key, '', full) + '</span>' +
        '<div class="sp__id">' +
          '<p class="sp__tag">Speaker</p>' +
          '<h3 class="sp__name" id="sp-name">' + p.first + '<b>' + p.last + '</b></h3>' +
          '<p class="sp__role">' + p.role + '</p>' +
          '<p class="sp__bar"><small>NextGen Summit</small>' +
            '<button class="sp__turn" type="button" data-sp-turn>Flip for<br>more' +
              '<i aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15M13 6l6 6-6 6"/></svg></i>' +
            '</button>' +
          '</p>' +
        '</div>' +
      '</div>';

    var rows = p.wins.map(function (w) {
      return '<li><span class="sp__ico" aria-hidden="true">' + (ICON[w.icon] || ICON.cup) + '</span>' +
        '<span><span class="sp__wk">' + w.k + '</span><span class="sp__wv">' + w.v + '</span></span></li>';
    }).join('');

    var act = '<p class="sp__act">';
    if (p.link) {
      act += '<a class="sp__li" href="' + p.link + '" target="_blank" rel="noopener noreferrer">' +
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.98 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3 9h4v12H3zM9.5 9h3.8v1.7h.05c.53-.95 1.83-1.95 3.76-1.95 4.02 0 4.76 2.5 4.76 5.76V21h-4v-5.5c0-1.31-.02-3-1.9-3-1.9 0-2.19 1.42-2.19 2.9V21h-4z"/></svg>' +
        'View LinkedIn</a>';
    }
    act += '<button class="sp__turn" type="button" data-sp-turn>Back to<br>front' +
      '<i aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H5M11 6l-6 6 6 6"/></svg></i></button></p>';

    back.innerHTML =
      '<div class="sp__pane sp__bpane">' +
        '<div class="sp__bhead">' +
          '<div>' +
            '<p class="sp__wm wm">nextgen<small>Summit</small></p>' +
            '<h3 class="sp__bname">' + p.first + '<b>' + p.last + '</b></h3>' +
            '<p class="sp__brole">' + p.role + '</p>' +
            '<span class="sp__rule" aria-hidden="true"></span>' +
          '</div>' +
          '<span class="sp__thumb">' + shotTag(key, '', '') + '</span>' +
        '</div>' +
        '<ul class="sp__wins">' + rows + '</ul>' +
        (p.pending ? '<p class="sp__brole" style="margin-top:12px">' + p.pending + '</p>' : '') +
        act +
      '</div>';

    dlg.setAttribute('aria-label', full + ', speaker');
    return true;
  }

  /* Which way the card is facing. The stylesheet does the turning and decides which face is on
     screen; this keeps the reading order and the tab order honest about it. */
  function face(isBack) {
    dlg.classList.toggle('is-back', isBack);
    front.setAttribute('aria-hidden', String(isBack));
    back.setAttribute('aria-hidden', String(!isBack));
    $$('a,button', isBack ? front : back).forEach(function (n) { n.setAttribute('tabindex', '-1'); });
    $$('a,button', isBack ? back : front).forEach(function (n) { n.removeAttribute('tabindex'); });
  }

  /* The card you choose lifts out of the deck and grows into the collectible; on the way out it
     shrinks back into its place. The deck card is hidden meanwhile, so there is only ever one of
     it. Its centre is read from the screen (rotation does not move a centre) and its width from
     layout (rotation would inflate a measured box); both faces are 5:7, so one scale fits. The
     details then rise in from the stylesheet (.sp.is-reveal). Reduced motion keeps the plain fade. */
  var inner = $('.sp__in', dlg);
  var canMorph = !reduce.matches && typeof inner.animate === 'function';
  var leaving = false;

  function slot(btn) {
    var stock = $('.card__stock', btn) || btn;
    var li = btn.closest('.card');
    var a = stock.getBoundingClientRect(), b = inner.getBoundingClientRect();
    return 'translate(' + ((a.left + a.width / 2) - (b.left + b.width / 2)) + 'px,' +
      ((a.top + a.height / 2) - (b.top + b.height / 2)) + 'px) rotate(' +
      ((li && getComputedStyle(li).getPropertyValue('--r').trim()) || '0deg') + ') scale(' +
      (stock.offsetWidth / (inner.offsetWidth || 1)) + ')';
  }

  function lift(btn, on) {
    var li = btn && btn.closest('.card');
    if (li) li.classList.toggle('is-lifted', on);
  }

  function open(btn) {
    if (!paint(btn.getAttribute('data-spk'))) return;
    if (expHold) expHold('dialog', true);            // the deck waits while this is being read
    opener = btn;
    leaving = false;
    face(false);                                     // every opening starts on the front
    dlg.classList.toggle('is-morph', canMorph);
    dlg.classList.toggle('is-reveal', canMorph);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    if (!canMorph) return;
    inner.animate([{ transform: slot(btn) }, { transform: 'none' }],
      { duration: 680, easing: 'cubic-bezier(.16,1,.3,1)' });
    lift(btn, true);
  }

  function close() {
    if (!dlg.open || leaving) return;
    if (!canMorph || !opener || !opener.isConnected) { dlg.close(); return; }
    leaving = true;
    dlg.classList.add('is-closing');
    var to = slot(opener);
    var run = inner.animate([{ transform: 'none' }, { transform: to }],
      { duration: 440, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' });
    run.onfinish = run.oncancel = function () { if (dlg.open) dlg.close(); };
  }

  deck.addEventListener('click', function (e) {
    if (swiped) return;                              // that was a swipe, not a choice
    var btn = e.target.closest ? e.target.closest('[data-spk]') : null;
    if (btn) open(btn);
  });

  dlg.addEventListener('click', function (e) {
    if (e.target.closest('[data-sp-turn]')) { face(!dlg.classList.contains('is-back')); return; }
    if (e.target.closest('[data-sp-close]')) { close(); return; }
    // the backdrop is anything outside the card itself; the card itself never closes it
    if (!e.target.closest('.sp__in')) close();
  });

  // Escape goes the same way out as the close button, so the card still returns to the deck
  dlg.addEventListener('cancel', function (e) {
    if (!canMorph) return;
    e.preventDefault();
    close();
  });

  dlg.addEventListener('close', function () {
    if (expHold) expHold('dialog', false);           // and carries on from where it was
    face(false);                                     // reset for the next one
    if (inner.getAnimations) inner.getAnimations().forEach(function (a) { a.cancel(); });
    dlg.classList.remove('is-closing', 'is-reveal', 'is-morph');
    leaving = false;
    lift(opener, false);                             // back in the deck before it takes focus
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  });
})();
