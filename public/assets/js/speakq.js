/* NextGen Summit — the speaker Q&A drawer (#ask-speakers), opened from the card at the top of
   the FAQ. The form is the FAQ's question form marked for the speakers, so /api/register.php
   stores it with the other questions (admin, Questions tab) and emails the team a copy. Every
   required answer is checked here first and again on the server, which names any field it
   refuses so it can be marked. On a local preview server there is no PHP, so the preview shows
   the thank-you and says nothing was sent, as site.js does for the other forms. */
(function () {
  'use strict';

  var form = document.querySelector('[data-sqd]');
  if (!form) return;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var dialog = form.closest('dialog');
  var done = $('[data-sqd-done]', dialog);
  var btn = $('button[type=submit]', form);
  var label = $('.btn__t', btn);
  var err = $('.form__error', form);
  var count = $('[data-sqd-count]', form);
  var LOCAL_PREVIEW = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var MSG = {
    question: 'Please write your question.',
    name: 'Please add your full name.',
    email: 'Please check your email address.'
  };

  function mark(name, text) {
    var input = form.elements[name];
    var note = input && document.getElementById(input.id + '-err');
    if (!input) return;
    if (text) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    if (note) { note.textContent = text || ''; note.hidden = !text; }
  }

  function problems() {
    var out = [];
    if (!form.elements.question.value.trim()) out.push('question');
    if (!form.elements.name.value.trim()) out.push('name');
    var email = form.elements.email;
    if (!email.value.trim() || !email.validity.valid) out.push('email');
    return out;
  }

  function send() {
    if (LOCAL_PREVIEW) return new Promise(function (res) { setTimeout(res, 450); });
    return fetch(form.getAttribute('action'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams(new FormData(form)).toString()
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.ok && data.ok) return;
        var e = new Error('Form post failed with ' + r.status);
        e.userMessage = data.error || '';
        e.fields = Array.isArray(data.fields) ? data.fields : [];
        throw e;
      });
    });
  }

  function busy(on) {
    btn.disabled = on;
    if (on) { btn.setAttribute('aria-busy', 'true'); label.textContent = 'Sending'; }
    else { btn.removeAttribute('aria-busy'); label.textContent = 'Send my question'; }
  }

  function counted() { count.textContent = form.elements.question.value.length; }

  Object.keys(MSG).forEach(function (name) {
    form.elements[name].addEventListener('input', function () {
      if (this.getAttribute('aria-invalid') === 'true' && problems().indexOf(name) < 0) mark(name, '');
    });
  });
  form.elements.question.addEventListener('input', counted);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (btn.disabled) return;
    err.hidden = true;
    var bad = problems();
    Object.keys(MSG).forEach(function (name) { mark(name, bad.indexOf(name) >= 0 ? MSG[name] : ''); });
    if (bad.length) { form.elements[bad[0]].focus(); return; }
    busy(true);
    send().then(function () {
      var who = (form.querySelector('[name="speaker"]:checked') || {}).value || 'Any speaker';
      $('[data-sqd-name]', done).textContent = (form.elements.name.value.trim().split(/\s+/)[0] || 'friend').toLowerCase();
      $('[data-sqd-for]', done).textContent = who === 'Any speaker' ? 'the speakers' : who;
      var note = $('small', done);
      if (LOCAL_PREVIEW && !note) {
        note = document.createElement('small');
        note.style.cssText = 'display:block;margin-top:6px;font:600 13px/1.45 var(--f-sans)';
        note.textContent = 'Local preview: nothing was sent. This form works once the site is live.';
        $('.sqd__lede', done).appendChild(note);
      }
      form.hidden = true;
      done.hidden = false;
      if (dialog) dialog.scrollTop = 0;
      done.focus({ preventScroll: true });
      (window.dataLayer = window.dataLayer || []).push({ event: 'speaker_question_sent' });
    }).catch(function (x) {
      var fields = (x && x.fields) || [];
      fields.forEach(function (name) { if (MSG[name]) mark(name, MSG[name]); });
      err.textContent = (x && x.userMessage) || "That didn't go through. Please check your connection and try again.";
      err.hidden = false;
      if (fields.length && form.elements[fields[0]]) form.elements[fields[0]].focus(); else err.focus();
    }).then(function () { busy(false); });
  });

  // another question keeps the name and email, and clears the rest
  $('[data-sqd-again]', done).addEventListener('click', function () {
    form.elements.question.value = '';
    form.querySelector('[name="speaker"][value="Any speaker"]').checked = true;
    counted();
    done.hidden = true;
    form.hidden = false;
    if (dialog) dialog.scrollTop = 0;
    form.elements.question.focus();
  });
})();
