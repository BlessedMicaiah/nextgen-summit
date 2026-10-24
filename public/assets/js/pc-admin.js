/* People's Choice — keeping the dashboard current.

   The rule this file exists to obey: never count anything here. Every number drawn on the
   screen arrived in the last reply from the server, which counted it from the vote rows. There
   is no local tally to drift, so after a dropped connection there is nothing to reconcile --
   the next good reply simply replaces what is on screen.

   Polling, not pushing. A few seconds behind, honestly labelled, beats a socket that silently
   dies and leaves a stale number looking live. When the feed fails the page says so rather
   than carrying on as though the figures were fresh. */
(function () {
  'use strict';

  var dash = document.querySelector('[data-pc-dash]');
  if (!dash) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };

  var EVERY = 5000;          // the quiet cadence
  var BACKOFF = [5000, 8000, 13000, 21000, 34000];   // after failures, ease off
  var fails = 0;
  var timer = null;
  var lastGood = 0;
  var stop = false;

  function conn(stateName, label) {
    var el = $('[data-pc-conn]');
    if (!el) return;
    el.setAttribute('data-conn', stateName);
    var t = $('[data-pc-conn-label]', el);
    if (t) t.textContent = label;
  }

  function ago(ms) {
    var s = Math.round((Date.now() - ms) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return s + ' seconds ago';
    var m = Math.round(s / 60);
    return m + (m === 1 ? ' minute ago' : ' minutes ago');
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- drawing ---------- */

  function paintLeader(d) {
    var k = $('[data-pc-leader-k]');
    var body = $('[data-pc-leader-body]');
    if (!body) return;
    if (!d.leaders || !d.leaders.length) {
      if (k) k.textContent = 'Current leader — #1';
      body.innerHTML = '<p class="lead__none">No valid votes yet.</p>';
      return;
    }
    // a tie is a tie: everyone on the top count is shown, nobody is picked
    if (k) k.textContent = d.tie
      ? 'Tied for first — ' + d.leaders.length + ' contestants'
      : 'Current leader — #1';
    body.innerHTML = d.leaders.map(function (l) {
      var shot = l.shot
        ? '<img class="lead__img" src="' + esc(l.shot) + '" alt="' + esc(l.name) + '">'
        : '<span class="lead__shot">' + esc(String(l.name).slice(-2)) + '</span>';
      return '<div class="lead__one">' + shot +
        '<div><p class="lead__name">' + esc(l.name) + '</p>' +
        '<p class="lead__co">' + esc(l.company) + '</p></div>' +
        '<p class="lead__votes">' + l.votes + '<span>votes</span></p></div>';
    }).join('');
  }

  /* The board is rewritten from the server's order, so a change of lead reorders the rows
     without anyone touching anything. A row whose number moved is marked briefly, because a
     table that silently rearranges itself is hard to trust. */
  var seen = {};
  function paintBoard(d) {
    var tb = $('[data-pc-board]');
    if (!tb || !d.standings) return;
    tb.innerHTML = d.standings.map(function (r) {
      var moved = seen[r.id] !== undefined && seen[r.id] !== r.votes;
      seen[r.id] = r.votes;
      return '<tr' + (moved ? ' class="is-moved"' : '') + '>' +
        '<td class="rk">#' + r.rank + '</td>' +
        '<td>' + esc(r.name) + '</td>' +
        '<td>' + esc(r.company) + '</td>' +
        '<td class="num">' + r.votes + '</td></tr>';
    }).join('');
  }

  function paint(d) {
    paintLeader(d);
    paintBoard(d);
    var set = function (sel, v) { var n = $(sel); if (n) n.textContent = v; };
    set('[data-pc-total]', d.total_valid);
    set('[data-pc-invalid]', d.invalidated);
    set('[data-pc-state]', d.state);
    set('[data-pc-deadline]', d.deadline || 'Not set');
  }

  /* ---------- the feed ---------- */

  function tick() {
    if (stop) return;
    fetch('./?data=1', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401) { throw new Error('signed out'); }
        if (!r.ok) { throw new Error('http ' + r.status); }
        return r.json();
      })
      .then(function (d) {
        if (!d || !d.ok) throw new Error('bad payload');
        fails = 0;
        lastGood = Date.now();
        paint(d);
        conn('live', 'Live');
        schedule(EVERY);
      })
      .catch(function (e) {
        fails++;
        if (String(e.message) === 'signed out') {
          conn('down', 'Signed out — reload to sign in');
          stop = true;
          return;
        }
        // the numbers on screen are now of unknown age, and the page says so
        conn(fails > 1 ? 'down' : 'retry',
          fails > 1 ? 'Disconnected — last updated ' + ago(lastGood) : 'Reconnecting…');
        schedule(BACKOFF[Math.min(fails - 1, BACKOFF.length - 1)]);
      });
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
  }

  // a hidden tab need not be polled; coming back should be instant
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearTimeout(timer); }
    else if (!stop) { conn('retry', 'Refreshing…'); tick(); }
  });
  addEventListener('online', function () { if (!stop) tick(); });
  addEventListener('offline', function () { conn('down', 'Offline — last updated ' + ago(lastGood)); });

  // keep the "updated" line honest between polls
  setInterval(function () {
    var n = $('[data-pc-updated]');
    if (n && lastGood) n.textContent = ago(lastGood);
  }, 5000);

  conn('retry', 'Connecting…');
  tick();
})();
