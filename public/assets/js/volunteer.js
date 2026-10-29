/* NextGen Summit — the volunteer sign-up.
   The questions are the team's Google Form, asked here in the site's design, one short step at a
   time. Nothing is stored on this site: the answers are posted to the Google Form's own
   formResponse address, so they arrive in its responses (and its sheet) exactly as if they had
   been typed on Google's page.

   Google's form is in sections and skips some of them (students only get the school questions,
   riders only get the pickup questions). pageHistory tells it which sections were seen, and it
   checks the required questions of those sections only, so it has to match the route taken here.

   The browser cannot read Google's reply (it is another site), so a refusal would be silent.
   The values are therefore the form's own options, character for character, and every required
   question is checked here first. The "Open the sign-up form" link stays for anyone who wants
   Google's page. */
(function () {
  'use strict';

  var form = document.querySelector('[data-vf]');
  if (!form) return;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var dialog = form.closest('dialog');
  var done = $('[data-vf-done]', dialog);
  var steps = $$('[data-vf-step]', form);
  var segs = $$('[data-vf-seg]', form);
  var back = $('[data-vf-back]', form);
  var go = $('[data-vf-go]', form);
  var err = $('.form__error', form);
  var where = $('[data-vf-where]', form);
  var MAX_ROLES = 3;
  // Google's section number for each step; "you" is the part before the first section
  var PAGE = { you: 0, school: 1, role: 2, ride: 3, you2: 4 };
  var NAMES = { you: 'About you', school: 'Your school', role: 'Where you would like to help', ride: 'Getting there', you2: 'Experience' };
  var at = 0;

  function val(name) {
    var c = $('[name="' + name + '"]:checked', form);
    return c ? c.value : '';
  }
  function isStudent() { return val('entry.378545828') === 'Yes'; }
  function rides() { return val('entry.1683348645') === 'Yes'; }

  // the route: the school step only for students
  function route() {
    return steps.filter(function (s) {
      return s.getAttribute('data-vf-step') !== 'school' || isStudent();
    });
  }

  // follow-up questions that depend on an answer
  function reveal() {
    $$('[data-vf-if]', form).forEach(function (box) {
      var rule = box.getAttribute('data-vf-if').split('=');
      box.hidden = val(rule[0]) !== rule[1];
    });
    var picked = $$('[name="entry.1569347530"]:checked', form).length;
    $('[data-vf-count]', form).textContent = picked;
    $$('[name="entry.1569347530"]', form).forEach(function (b) {
      b.disabled = !b.checked && picked >= MAX_ROLES;
      b.closest('.vf__role').classList.toggle('is-off', b.disabled);
    });
  }

  // asked, given the answers so far: inside its step, no follow-up around it is hidden
  // (the steps themselves are hidden whenever they are not on screen, so they do not count)
  function seen(el) {
    for (var n = el; n && n !== form && !n.hasAttribute('data-vf-step'); n = n.parentNode) if (n.hidden) return false;
    return true;
  }

  function paint() {
    var r = route(), cur = r[at];
    steps.forEach(function (s) {
      var on = s === cur;
      s.hidden = !on;
      s.classList.toggle('is-on', on);
    });
    var names = r.map(function (s) { return s.getAttribute('data-vf-step'); });
    segs.forEach(function (g) {
      var k = g.getAttribute('data-vf-seg'), i = names.indexOf(k);
      g.classList.toggle('is-skip', i === -1);
      g.classList.toggle('is-done', i > -1 && i < at);
      g.classList.toggle('is-on', i === at);
    });
    $$('[data-vf-n]', form).forEach(function (n) {
      var s = n.closest('[data-vf-step]');
      n.textContent = names.indexOf(s.getAttribute('data-vf-step')) + 1;
    });
    back.hidden = at === 0;
    go.textContent = at === r.length - 1 ? 'Send my sign-up' : 'Continue';
    if (where) where.textContent = 'Step ' + (at + 1) + ' of ' + r.length + ': ' + NAMES[names[at]] + '.';
  }

  function mark(input, box, text) {
    // the message is whichever field__err the input (or its group) is described by
    var ids = ((input && input.getAttribute('aria-describedby')) || box.getAttribute('aria-describedby') || '').split(' ');
    var e = ids.map(function (id) { return id && document.getElementById(id); })
      .filter(function (x) { return x && x.classList.contains('field__err'); })[0];
    if (text) {
      if (e) { e.textContent = text; e.hidden = false; }
      (input || box).setAttribute('aria-invalid', 'true');
      box.setAttribute('aria-invalid', 'true');
    } else {
      if (e) e.hidden = true;
      if (input) input.removeAttribute('aria-invalid');
      box.removeAttribute('aria-invalid');
    }
    return !text;
  }

  // checks the step on screen; returns the first thing that needs attention
  function check(step) {
    var first = null;
    function bad(el) { if (!first) first = el; }
    $$('input[type=text],input:not([type]),input[type=tel],input[type=email],textarea', step).forEach(function (i) {
      if (!seen(i) || !i.required) return;
      var v = i.value.trim(), msg = '';
      if (!v) msg = i.id === 'vf-time' ? 'Please tell us a pickup time that works.' : 'Please fill this in.';
      // Google checks the address too, and a refusal from it would be silent
      else if (i.type === 'email' && !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v)) msg = 'Please check your email address.';
      else if (i.type === 'tel') {
        var digits = v.replace(/\D+/g, '');
        if (digits.length < 7 || digits.length > 15) msg = 'Please check your phone number.';
      }
      if (!mark(i, i.closest('.field'), msg)) bad(i);
    });
    $$('.vf__q', step).forEach(function (q) {
      if (!seen(q)) return;
      if (q.id === 'vf-roles') {
        var n = $$('input:checked', q).length;
        if (!mark(null, q, n ? '' : 'Pick at least one role (up to three).')) bad($('input', q));
        return;
      }
      var radios = $$('input[type=radio]', q);
      if (!radios.length || !radios[0].required) return;
      var ok = radios.some(function (r) { return r.checked; });
      if (!mark(null, q, ok ? '' : 'Please choose one.')) bad(radios[0]);
    });
    return first;
  }

  function show(i) {
    at = i;
    paint();
    if (err) err.hidden = true;
    if (dialog) dialog.scrollTop = 0;
    var step = route()[at];
    step.setAttribute('tabindex', '-1');
    step.focus({ preventScroll: true });
  }

  function payload() {
    var data = new URLSearchParams();
    route().forEach(function (step) {
      $$('input,textarea', step).forEach(function (i) {
        if (!i.name || !seen(i)) return;
        if ((i.type === 'radio' || i.type === 'checkbox') && !i.checked) return;
        var v = i.type === 'radio' || i.type === 'checkbox' ? i.value : i.value.trim();
        if (v !== '') data.append(i.name, v);
      });
    });
    // Google requires the "what time" question whenever the pickup section is seen, even for
    // someone who can make 11:00; they have answered it already, so it says so
    if (rides() && val('entry.932285107') === 'Yes') data.append('entry.1399731544', 'Available at 11:00 AM');
    data.append('pageHistory', pages());
    data.append('fvv', '1');
    return data;
  }

  // the sections seen, in order: school only for students, and the pickup section (which has no
  // step of its own here; it is part of "getting there") only for riders
  function pages() {
    var p = [PAGE.you];
    if (isStudent()) p.push(PAGE.school);
    p.push(PAGE.role);
    if (rides()) p.push(PAGE.ride);
    p.push(PAGE.you2);
    return p.join(',');
  }

  function send() {
    var btn = $('.vf__next', form);
    var data = payload();
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    go.textContent = 'Sending';
    if (err) err.hidden = true;
    window.__ngsVolunteerLast = data.toString();       // for the site's own tests
    fetch(form.action, { method: 'POST', mode: 'no-cors', body: data, keepalive: true })
      .then(function () {
        var first = ($('#vf-first', form).value || '').trim().split(/\s+/)[0] || 'friend';
        $('[data-vf-name]', done).textContent = first.toLowerCase();
        form.hidden = true;
        done.hidden = false;
        if (dialog) dialog.scrollTop = 0;
        done.focus({ preventScroll: true });
        (window.dataLayer = window.dataLayer || []).push({ event: 'volunteer_signup' });
      })
      .catch(function () {
        err.textContent = 'That did not go through. Check your connection and try again, or use the Google sign-up form linked below.';
        err.hidden = false;
        err.focus();
      })
      .then(function () {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        paint();
      });
  }

  form.addEventListener('change', function (e) {
    reveal();
    var box = e.target.closest('.vf__q') || e.target.closest('.field');
    if (box && box.getAttribute('aria-invalid') === 'true') check(route()[at]);
    paint();
  });
  form.addEventListener('input', function (e) {
    var f = e.target.closest('.field');
    if (f && e.target.getAttribute('aria-invalid') === 'true' && e.target.value.trim()) mark(e.target, f, '');
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var step = route()[at];
    var bad = check(step);
    if (bad) { bad.focus(); return; }
    if (at < route().length - 1) show(at + 1);
    else send();
  });
  back.addEventListener('click', function () { if (at > 0) show(at - 1); });

  // after a sign-up has gone, the next opening starts a fresh one
  if (dialog) dialog.addEventListener('close', function () {
    if (done.hidden) return;
    form.reset();
    $$('[aria-invalid]', form).forEach(function (x) { x.removeAttribute('aria-invalid'); });
    $$('.field__err', form).forEach(function (x) { x.hidden = true; });
    form.hidden = false;
    done.hidden = true;
    at = 0;
    reveal();
    paint();
  });

  reveal();
  paint();
})();
