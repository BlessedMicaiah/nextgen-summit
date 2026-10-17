/* NextGen Summit — featured speakers.
   The lineup is a plain grid of collectible cards, laid out by the stylesheet and never moved
   from here. This file does two things: it holds what each card says, and it opens the chosen
   card -- enlarged, and turning over to its reverse for the credentials.

   Every line a card says is written here, as text, so it can be corrected without touching a
   picture. Each line comes from an authoritative source for that person. */
(function () {
  'use strict';

  if (window.__ngsSpeakers) return;
  window.__ngsSpeakers = true;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var gal = $('[data-gal]');
  var dlg = $('#speaker');
  if (!gal || !dlg) return;

  // the card-into-collectible morph below asks whether motion is wanted before it runs
  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

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
      role: 'Entrepreneur <span aria-hidden="true">&middot;</span> Forbes 30 Under 30',
      roleFlat: 'Entrepreneur, Forbes 30 Under 30',
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
    /* Added 17 October on Pastor Debbie's word, with his speaker card and portrait. The four
       lines are his own description of the work he does rather than claims of office or award,
       and are reproduced as supplied. */
    jamar: {
      first: 'Jamar', last: 'Simms Jr.',
      role: 'Cinematographer <span aria-hidden="true">&middot;</span> Marketer',
      roleFlat: 'Cinematographer and marketer',
      shot: 'jamar-simms',
      wins: [
        { k: 'Film', v: 'Cinematic storyteller focused on high-quality visual content and branded media', icon: 'play' },
        { k: 'Production', v: 'Camera operation, on-set capture and shaping compelling visual moments', icon: 'case' },
        { k: 'Marketing', v: 'Creative execution with marketing thinking, to help stories connect with people', icon: 'board' },
        { k: 'Creative', v: 'A strong eye for visuals, audience engagement and modern digital storytelling', icon: 'bulb' }
      ],
      link: 'https://www.linkedin.com/in/jamar-simms-jr-30521a249'
    },

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

  /* ---------- the collectible ---------- */
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
        '<div class="sp__list">' +
          '<ul class="sp__wins">' + rows + '</ul>' +
          '<button class="sp__more" type="button" data-sp-more hidden>Scroll for more' +
            '<i aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></i>' +
          '</button>' +
        '</div>' +
        (p.pending ? '<p class="sp__brole" style="margin-top:12px">' + p.pending + '</p>' : '') +
        act +
      '</div>';

    dlg.setAttribute('aria-label', full + ', speaker');
    return true;
  }

  /* On a short screen the credentials don't all fit on the back, and they scroll inside the card.
     Its scrollbar is hidden, so a "Scroll for more" button and a fade at the foot of the list say
     there is more, only while there is; the button scrolls the list on by most of its height. */
  function more() {
    var list = $('.sp__wins', back), btn = $('.sp__more', back);
    if (!list || !btn) return;
    var on = list.scrollHeight - list.clientHeight - list.scrollTop > 4;
    list.parentNode.classList.toggle('has-more', on);
    btn.hidden = !on;
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
    opener = btn;
    leaving = false;
    face(false);                                     // every opening starts on the front
    requestAnimationFrame(more);
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

  gal.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-spk]') : null;
    if (btn) open(btn);
  });

  dlg.addEventListener('click', function (e) {
    if (e.target.closest('[data-sp-turn]')) { face(!dlg.classList.contains('is-back')); more(); return; }
    if (e.target.closest('[data-sp-more]')) {
      var list = $('.sp__wins', back);
      list.scrollBy({ top: list.clientHeight * 0.8, behavior: reduce.matches ? 'auto' : 'smooth' });
      return;
    }
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

  // scroll doesn't bubble, so listen on the way down; and a resize can make the list fit, or not
  back.addEventListener('scroll', more, true);
  addEventListener('resize', function () { if (dlg.open) more(); });

  dlg.addEventListener('close', function () {
    face(false);                                     // reset for the next one
    if (inner.getAnimations) inner.getAnimations().forEach(function (a) { a.cancel(); });
    dlg.classList.remove('is-closing', 'is-reveal', 'is-morph');
    leaving = false;
    lift(opener, false);                             // back in the deck before it takes focus
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  });
})();
