/* NextGen Summit — scholarship application.
   A short form: each problem is shown under its own question, the 75-word answer is counted in
   words (typed or pasted), and the button stays disabled while a send is in flight. Nothing on
   this page approves anyone or unlocks a ticket; the team reviews every application. */
(function () {
  'use strict';

  var form = document.querySelector('form[name="scholarship"]');
  if (!form) return;

  var MAX_WORDS = 75;
  var LOCAL_PREVIEW = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var done = document.querySelector('[data-sch-done]');
  var btn = form.querySelector('button[type=submit]');
  var label = btn.querySelector('.btn__t');
  var err = form.querySelector('.form__error');
  var why = form.elements.why;
  var count = form.querySelector('[data-words]');
  var otherWrap = form.querySelector('[data-other]');
  var other = form.elements.reason_other;

  var MSG = {
    name: 'Please add your full name.',
    email: 'Please check your email address.',
    phone: 'Please check your phone number.',
    organization: 'Please add your school, college or organization.',
    why: 'Please tell us why you want to attend.',
    why_long: 'Please keep this to 75 words or fewer.',
    reason: 'Please choose a reason.',
    reason_other: 'Please add your reason.',
    commit: 'Please choose Yes or No.'
  };
  // where each message is shown, and which element carries aria-invalid
  var SPOT = {
    name: ['s-name-err', 's-name'],
    email: ['s-email-err', 's-email'],
    phone: ['s-phone-err', 's-phone'],
    organization: ['s-org-err', 's-org'],
    why: ['s-why-err', 's-why'],
    reason: ['s-reason-err', 's-reason'],
    reason_other: ['s-other-err', 's-other'],
    commit: ['s-commit-err', 's-commit']
  };

  function words(s) { return (s || '').trim().split(/\s+/).filter(Boolean).length; }
  function radio(name) { var c = form.querySelector('input[name="' + name + '"]:checked'); return c ? c.value : ''; }

  function mark(field, text) {
    var spot = SPOT[field];
    if (!spot) return;
    var note = document.getElementById(spot[0]);
    var el = document.getElementById(spot[1]);
    if (el) { if (text) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); }
    if (note) { note.textContent = text || ''; note.hidden = !text; }
  }

  function problems() {
    var out = {};
    if (!form.elements.name.value.trim()) out.name = MSG.name;
    var email = form.elements.email;
    if (!email.value.trim() || !email.validity.valid) out.email = MSG.email;
    var phone = form.elements.phone.value.trim();
    var digits = phone.replace(/\D+/g, '').length;
    if (digits < 7 || digits > 15 || !/^[0-9+().\-\s]+$/.test(phone)) out.phone = MSG.phone;
    if (!form.elements.organization.value.trim()) out.organization = MSG.organization;
    var n = words(why.value);
    if (!n) out.why = MSG.why; else if (n > MAX_WORDS) out.why = MSG.why_long;
    var reason = radio('reason');
    if (!reason) out.reason = MSG.reason;
    else if (reason === 'other' && !other.value.trim()) out.reason_other = MSG.reason_other;
    if (!radio('commit')) out.commit = MSG.commit;
    return out;
  }

  /* ---------- the word counter: live, and honest about pasted text ---------- */
  function updateCount() {
    var n = words(why.value);
    count.textContent = n + ' / ' + MAX_WORDS + ' words';
    count.classList.toggle('is-over', n > MAX_WORDS);
    if (n > MAX_WORDS) mark('why', 'That is ' + n + ' words. ' + MSG.why_long);
    else if (why.getAttribute('aria-invalid') === 'true' && n > 0) mark('why', '');
  }
  why.addEventListener('input', updateCount);
  updateCount();

  /* ---------- "Other" opens a small field of its own ---------- */
  function syncOther() {
    var on = radio('reason') === 'other';
    otherWrap.hidden = !on;
    other.required = on;
    if (!on) mark('reason_other', '');
  }
  Array.prototype.forEach.call(form.querySelectorAll('input[name="reason"]'), function (r) {
    r.addEventListener('change', function () {
      syncOther();
      mark('reason', '');
      if (r.value === 'other' && r.checked) other.focus();
    });
  });
  Array.prototype.forEach.call(form.querySelectorAll('input[name="commit"]'), function (r) {
    r.addEventListener('change', function () { mark('commit', ''); });
  });
  syncOther();

  ['name', 'email', 'phone', 'organization', 'reason_other'].forEach(function (f) {
    form.elements[f].addEventListener('input', function () {
      if (this.getAttribute('aria-invalid') === 'true' && !problems()[f]) mark(f, '');
    });
  });

  function focusFirst(fields) {
    var order = ['name', 'email', 'phone', 'organization', 'why', 'reason', 'reason_other', 'commit'];
    for (var i = 0; i < order.length; i++) {
      if (fields.indexOf(order[i]) < 0) continue;
      var target = order[i] === 'reason' || order[i] === 'commit'
        ? form.querySelector('input[name="' + order[i] + '"]')
        : document.getElementById(SPOT[order[i]][1]);
      if (target) { target.focus(); return true; }
    }
    return false;
  }

  function busy(on) {
    btn.disabled = on;
    if (on) { btn.setAttribute('aria-busy', 'true'); label.__t = label.textContent; label.textContent = 'Sending'; }
    else { btn.removeAttribute('aria-busy'); if (label.__t) label.textContent = label.__t; }
  }

  function send() {
    if (LOCAL_PREVIEW) return new Promise(function (res) { setTimeout(res, 450); });
    return fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams(new FormData(form)).toString()
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.ok && data.ok) return;
        var e = new Error('Scholarship post failed with ' + r.status);
        e.userMessage = data.error || '';
        e.fields = Array.isArray(data.fields) ? data.fields : [];
        throw e;
      });
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (btn.disabled) return;
    err.hidden = true;
    var bad = problems();
    Object.keys(SPOT).forEach(function (f) { mark(f, bad[f] || ''); });
    var keys = Object.keys(bad);
    if (keys.length) { focusFirst(keys); return; }
    busy(true);
    send().then(function () {
      form.hidden = true;
      if (LOCAL_PREVIEW) {
        var s = document.createElement('small');
        s.textContent = 'Local preview: nothing was sent. This form works once the site is live.';
        done.querySelector('.sch__done-x').appendChild(s);
      }
      done.hidden = false;
      done.focus();
      window.scrollTo({ top: Math.max(0, done.getBoundingClientRect().top + window.pageYOffset - 120) });
    }).catch(function (x) {
      busy(false);
      var fields = (x && x.fields) || [];
      fields.forEach(function (f) { mark(f, f === 'why' && words(why.value) > MAX_WORDS ? MSG.why_long : MSG[f]); });
      err.textContent = (x && x.userMessage) || "That didn't go through. Please check your connection and try again.";
      err.hidden = false;
      if (!focusFirst(fields)) err.focus();
    });
  });
})();
