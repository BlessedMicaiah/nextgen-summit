/* ============================================================================
   NEXTGEN DATA — the dashboard's behaviour.

   One fetch of /insights/report.php fills every panel. That is deliberate: each figure
   comes out of a single snapshot read at a single instant, so the headline, the chart
   and the table cannot disagree with each other on screen. Seven endpoints would each
   read at a slightly different moment and eventually show three different totals.

   No charting library. Every chart here is SVG built from the same data the tables
   use, which keeps the page to two requests, works with no CDN, and means a number in
   a chart and the same number in a table are literally the same value.

   Nothing in this file can affect voting. It runs only on /insights/, behind a session,
   and it only ever reads.
   ========================================================================= */
(function () {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var SVG = 'http://www.w3.org/2000/svg';
  var REFRESH_MS = 60000;

  var state = {
    data: null,
    period: 'all',
    from: '',
    to: '',
    compare: [],
    sort: { key: 'rank', dir: 1 },
    search: '',
    timer: null,
    loading: false
  };

  /* ---------- small helpers ---------- */

  function n(v) { return (v === null || v === undefined || isNaN(v)) ? 0 : Number(v); }

  function num(v) { return n(v).toLocaleString('en-US'); }

  function pct(v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + Math.round(v * 10) / 10 + '%';
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }

  function svg(tag, attrs) {
    var e = document.createElementNS(SVG, tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, String(attrs[k]));
    return e;
  }

  function hour(h) {
    h = n(h);
    var ap = h < 12 ? 'am' : 'pm';
    var v = h % 12;
    return (v === 0 ? 12 : v) + ap;
  }

  function shortDay(d) {
    if (!d) return '';
    var p = String(d).split('-');
    return p.length === 3 ? (Number(p[2]) + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(p[1]) - 1]) : d;
  }

  function ago(s) {
    s = n(s);
    if (s < 10) return 'just now';
    if (s < 90) return s + 's ago';
    var m = Math.round(s / 60);
    if (m < 90) return m + ' min ago';
    return Math.round(m / 60) + 'h ago';
  }

  function etTime(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleString('en-US', {
        timeZone: 'America/New_York', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      }) + ' ET';
    } catch (e) { return String(iso); }
  }

  function loading(node) {
    if (node) { node.innerHTML = ''; node.appendChild(el('div', 'ld', 'Reading')); }
  }

  function emptyRow(table, cols, msg) {
    var tb = el('tbody');
    var tr = el('tr');
    var td = el('td', 'empty', msg);
    td.colSpan = cols;
    tr.appendChild(td);
    tb.appendChild(tr);
    table.appendChild(tb);
  }

  /* ---------- the period window ---------- */

  /* Which days the current period covers. Returns null for "everything", which is the
     default the brief asks for: all time, since voting launched. */
  function window_() {
    var d = state.data;
    if (!d || !d.daily || !d.daily.length) return null;
    var days = d.daily.map(function (r) { return r.day; });
    var last = days[days.length - 1];
    switch (state.period) {
      case 'today':     return [last, last];
      case 'yesterday': return days.length > 1 ? [days[days.length - 2], days[days.length - 2]] : [last, last];
      case '24h':       return [last, last];
      case '48h':       return [days[Math.max(0, days.length - 2)], last];
      case 'custom':    return (state.from && state.to) ? [state.from, state.to] : null;
      default:          return null;
    }
  }

  function inWindow(day) {
    var w = window_();
    return !w || (day >= w[0] && day <= w[1]);
  }

  function periodLabel() {
    var d = state.data;
    var launch = d && d.totals && d.totals.launch_day;
    switch (state.period) {
      case 'today':     return 'Today so far (Eastern)';
      case 'yesterday': return 'Yesterday, a complete day (Eastern)';
      case '24h':       return 'The last 24 hours, against the 24 before it';
      case '48h':       return 'The last 48 hours';
      case 'custom':    return (state.from && state.to)
                          ? ('Custom range: ' + state.from + ' to ' + state.to + ' (Eastern)')
                          : 'Pick a from and a to date';
      default:          return 'All time, since voting launched' + (launch ? ' on ' + launch : '');
    }
  }

  /* The figures for the chosen period. All time and the named windows come straight out
     of the snapshot. A custom range comes from the server, because unique voters cannot
     be added up across days and we do not ship voter keys to the browser to try. */
  function windowTotals() {
    var d = state.data, t = d.totals || {};
    if (state.period === 'all') return { points: t.points, voters: t.voters, bonus: t.bonus,
      standard: t.standard, verified: t.verified, unverified: t.unverified, test: t.test,
      exact: true, cmp: null };
    if (state.period === 'today') return { points: t.today, voters: t.today_voters, exact: true,
      cmp: { label: 'vs yesterday', v: t.day_growth_pct } };
    if (state.period === 'yesterday') return { points: t.yesterday, voters: t.yesterday_voters, exact: true, cmp: null };
    if (state.period === '24h') return { points: t.last24, voters: null, exact: true,
      cmp: { label: 'vs the previous 24h', v: t.rolling_growth_pct } };
    if (state.period === '48h') return { points: n(t.last24) + n(t.prev24), voters: null, exact: true, cmp: null };
    if (state.period === 'custom' && d.range && d.range.ok) {
      var r = d.range;
      return { points: r.points, voters: r.voters, bonus: r.bonus, standard: r.standard,
               verified: r.verified, unverified: r.unverified, test: r.test, exact: true, cmp: null };
    }
    /* A custom range the server has not answered for yet: sum the days we hold, and say
       plainly that the voter count is not available rather than printing a wrong one. */
    var pts = 0;
    (d.daily || []).forEach(function (row) { if (inWindow(row.day)) pts += n(row.points); });
    return { points: pts, voters: null, exact: false, cmp: null };
  }

  /* Per-founder points for the chosen period, from the trend array the snapshot carries. */
  function founderPoints(f) {
    if (state.period === 'all') return n(f.points);
    if (state.period === 'today') return n(f.today);
    if (state.period === 'yesterday') return n(f.yesterday);
    var d = state.data, sum = 0;
    (d.daily || []).forEach(function (row, i) {
      if (inWindow(row.day)) sum += n((f.trend || [])[i]);
    });
    return sum;
  }

  function foundersForPeriod() {
    var d = state.data;
    if (state.period === 'custom' && d.range && d.range.ok) return d.range.founders.slice();
    var list = (d.founders || []).map(function (f) {
      var c = {};
      for (var k in f) if (f.hasOwnProperty(k)) c[k] = f[k];
      c._p = founderPoints(f);
      return c;
    });
    if (state.period !== 'all') {
      /* re-rank within the window, so "today's leader" is today's leader */
      var sorted = list.slice().sort(function (a, b) {
        return b._p - a._p || (a.id < b.id ? -1 : 1);
      });
      var place = 0, seen = 0, lastV = null;
      sorted.forEach(function (f) {
        seen++;
        if (f._p !== lastV) { place = seen; lastV = f._p; }
        f._rank = place;
      });
    } else {
      list.forEach(function (f) { f._rank = f.rank; });
    }
    return list;
  }

  /* ---------- fetch ---------- */

  function load(force) {
    if (state.loading) return;
    state.loading = true;
    var q = ['source=live'];
    if (force) q.push('refresh=1');
    if (state.period === 'custom' && state.from && state.to) {
      q.push('from=' + encodeURIComponent(state.from));
      q.push('to=' + encodeURIComponent(state.to));
    }
    fetch('/insights/report.php?' + q.join('&'), {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }).then(function (r) {
      if (r.status === 401) { location.reload(); throw new Error('signed out'); }
      if (!r.ok) throw new Error('report ' + r.status);
      return r.json();
    }).then(function (d) {
      state.data = d;
      state.loading = false;
      render();
    })['catch'](function (e) {
      state.loading = false;
      failed(e && e.message ? e.message : 'the report could not be read');
    });
  }

  function failed(msg) {
    var dot = $('[data-ngd-dot]');
    if (dot) dot.setAttribute('data-state', 'down');
    var f = $('[data-ngd-fresh]');
    if (f) f.textContent = 'could not read';
    var a = $('[data-ngd-alerts]');
    if (a && !$('.alert--bad', a)) {
      var box = el('div', 'alert alert--bad');
      box.appendChild(el('b', null, 'The report could not be loaded'));
      box.appendChild(document.createTextNode(
        msg + '. Nothing on the live site is affected by this — voting and ticketing do not read ' +
        'this dashboard. Try Refresh; if it keeps failing, the voting database may be momentarily locked ' +
        'by a write, which clears by itself.'));
      a.appendChild(box);
    }
  }

  /* ---------- render ---------- */

  function render() {
    var d = state.data;
    if (!d) return;
    health(d);
    alerts(d);
    var lbl = $('[data-ngd-period-label]');
    if (lbl) lbl.textContent = periodLabel();
    kpis(d);
    splits(d);
    leaderBars(d);
    chartCumulative(d);
    chartDaily($('[data-ngd-chart="daily"]'), d);
    chartDaily($('[data-ngd-chart="daily2"]'), d);
    chartHourly(d);
    chartRanks(d);
    heatmap(d);
    tableDaily(d);
    tableFounders(d);
    compare(d);
    traffic(d);
    conversions(d);
    insights(d);
    exportsPanel(d);
    foot(d);
  }

  function health(d) {
    var h = d.health || {};
    var dot = $('[data-ngd-dot]');
    var src = $('[data-ngd-src]');
    var fr  = $('[data-ngd-fresh]');
    if (dot) dot.setAttribute('data-state', h.stale ? 'stale' : (h.error ? 'down' : 'live'));
    if (src) src.textContent = h.source === 'live' ? 'Live production data' : 'Review (staging) data';
    if (fr) {
      fr.textContent = h.stale
        ? ('stale — last read ' + ago(h.age_s))
        : (num(h.rows_read) + ' rows · ' + ago(h.age_s));
    }
    var det = $('[data-ngd-health-detail]');
    if (det) {
      det.innerHTML = '';
      [
        ['Source', h.source_label || '' ],
        ['Reading', h.reading || ''],
        ['This site is', h.environment === 'review' ? 'the review (staging) build' : 'the live build'],
        ['Access', 'Read-only. ' + (h.open_method || 'not currently open')],
        ['Rows read', num(h.rows_read) + ' vote rows, in ' + (h.build_ms === null ? '?' : h.build_ms) + ' ms'],
        ['Cache', 'A snapshot is reused for ' + n(h.ttl_s) + ' seconds before the database is read again'],
        ['Founder names from', h.names_from || 'the built-in placeholder list'],
        ['Databases present', (h.sources_present || []).map(function (s) {
            return s.label + ': ' + (s.present ? 'found' : 'not found');
          }).join(' · ')],
        ['Last read at', etTime(d.meta && d.meta.built_at)]
      ].forEach(function (r) {
        var row = el('div', 'def');
        row.appendChild(el('b', null, r[0]));
        row.appendChild(el('span', null, r[1]));
        det.appendChild(row);
      });
    }
  }

  function alerts(d) {
    var a = $('[data-ngd-alerts]');
    if (!a) return;
    a.innerHTML = '';
    var h = d.health || {};

    if (h.stale) {
      var s = el('div', 'alert alert--warn');
      s.appendChild(el('b', null, 'Stale data'));
      s.appendChild(document.createTextNode(
        'The live voting database could not be re-read' +
        (h.stale_reason ? ' (' + h.stale_reason + ')' : '') +
        '. Every figure below is as at ' + etTime(d.meta && d.meta.built_at) + ', ' + ago(h.age_s) +
        '. This is almost always a momentary lock while a vote is being written, and clears by itself.'));
      a.appendChild(s);
    }

    if (d.meta && d.meta.environment === 'review' && h.source === 'live') {
      var r = el('div', 'alert alert--info');
      r.appendChild(el('b', null, 'Review site, live numbers'));
      r.appendChild(document.createTextNode(
        'You are on the review build, and the figures below are the real competition’s, read ' +
        'read-only from the live database. Nothing here can change a vote.'));
      a.appendChild(r);
    }

    var t = d.totals || {};
    if (n(t.test) > 0) {
      var w = el('div', 'alert alert--warn');
      w.appendChild(el('b', null, num(t.test) + ' test points are inside these totals'));
      w.appendChild(document.createTextNode(
        'They were written by the admin panel’s seed button. The official count includes them, ' +
        'so this dashboard includes them too rather than quietly disagreeing with the admin ' +
        'dashboard — and shows them separately everywhere.'));
      a.appendChild(w);
    }

    if (state.period === 'custom' && d.range && !d.range.ok) {
      var e = el('div', 'alert alert--warn');
      e.appendChild(el('b', null, 'That range could not be counted'));
      e.appendChild(document.createTextNode(d.range.error || 'Check the dates.'));
      a.appendChild(e);
    }
  }

  /* ---------- KPI cards ---------- */

  function kpi(parent, opts) {
    var c = el('div', 'kpi' + (opts.hero ? ' kpi--hero' : ''));
    c.appendChild(el('div', 'kpi__k', opts.k));
    var v = el('div', 'kpi__v');
    v.appendChild(document.createTextNode(opts.v));
    if (opts.unit) v.appendChild(el('small', null, opts.unit));
    c.appendChild(v);
    if (opts.delta !== undefined && opts.delta !== null) {
      var cls = opts.delta > 0 ? 'up' : (opts.delta < 0 ? 'down' : 'flat');
      c.appendChild(el('div', 'kpi__d kpi__d--' + cls,
        (opts.delta > 0 ? '▲ ' : (opts.delta < 0 ? '▼ ' : '— ')) +
        pct(opts.delta) + (opts.deltaLabel ? ' ' + opts.deltaLabel : '')));
    }
    if (opts.n) c.appendChild(el('div', 'kpi__n', opts.n));
    if (opts.spark && opts.spark.length > 1) {
      var box = el('div', 'kpi__spark');
      box.appendChild(sparkline(opts.spark, 200, 30));
      c.appendChild(box);
    }
    parent.appendChild(c);
  }

  function kpis(d) {
    var box = $('[data-ngd-kpis]');
    if (!box) return;
    box.innerHTML = '';
    var t = d.totals || {};

    /* If the source could not be read and there is no earlier snapshot to fall back on,
       every total below would be a zero -- and a zero is indistinguishable from a real
       figure on a KPI card. "No votes" and "we could not look" are completely different
       facts for a leadership team, so the cards are replaced rather than filled with
       nought. The alert above already says what went wrong. */
    if (d.meta && d.meta.ok === false && !t.points) {
      var card = el('div', 'kpi kpi--hero');
      card.appendChild(el('div', 'kpi__k', 'The competition data could not be read'));
      card.appendChild(el('div', 'kpi__v', '—'));
      card.appendChild(el('div', 'kpi__n',
        (d.meta.error ? d.meta.error.charAt(0).toUpperCase() + d.meta.error.slice(1) + '. ' : '') +
        'These cards are blank on purpose: showing zero here would read as "nobody has voted", ' +
        'which is a different thing entirely. Voting and ticketing are unaffected — nothing ' +
        'in those paths reads this dashboard.'));
      box.appendChild(card);
      return;
    }

    var w = windowTotals();
    var trend = (d.daily || []).map(function (r) { return n(r.points); });
    var rules = d.rules || {};

    kpi(box, {
      hero: true, k: 'Valid voting points', v: num(w.points),
      delta: w.cmp ? w.cmp.v : null, deltaLabel: w.cmp ? w.cmp.label : '',
      n: state.period === 'all'
        ? ('One point is one vote row. ' + num(t.voters) + ' voters, ' + t.points_per_voter + ' points each on average.')
        : periodLabel(),
      spark: trend
    });

    /* The public standings count a smaller set than the admin dashboard does: pc-rank.php
       additionally requires simulated = 0. Showing only one of the two is how a leadership
       deck ends up quoting a number nobody else on the team recognises. */
    if (state.period === 'all' && t.points_public !== undefined && t.points_public !== t.points) {
      kpi(box, {
        k: 'Public standings total', v: num(t.points_public),
        n: 'What /api/pc-rank.php shows the public: valid points from a verified identity only. ' +
           'The headline above is the admin dashboard’s definition, which also counts the ' +
           num(n(t.points) - n(t.points_public)) + ' unverified point(s). Both are correct.'
      });
    }

    kpi(box, {
      k: 'Verified voting identities',
      v: w.voters === null ? '—' : num(w.voters),
      n: w.voters === null
        ? 'Not available for a rolling window — identities cannot be added up across days.'
        : 'Distinct voter keys, not people. One person using two email addresses is two ' +
          'identities with two daily allowances. Read it as a ceiling on headcount.'
    });

    kpi(box, {
      k: 'Today', v: num(t.today), delta: t.day_growth_pct, deltaLabel: 'vs yesterday',
      n: num(t.today_voters) + ' voters today · yesterday finished on ' + num(t.yesterday)
    });

    kpi(box, {
      k: 'Last 24 hours', v: num(t.last24), delta: t.rolling_growth_pct, deltaLabel: 'vs previous 24h',
      n: 'The 24 hours before that took ' + num(t.prev24)
    });

    kpi(box, {
      k: 'Registration points', v: num(t.bonus), unit: '/ ' + num(t.points),
      n: Math.round(n(t.bonus_share_pct)) + '% of all points sit in slot 2 or 3, which only a ' +
         'voter with a daily allowance above one can create.'
    });

    kpi(box, {
      k: 'Verified share', v: Math.round(n(t.verified_share_pct)) + '%',
      n: num(t.verified) + ' points from a verified voter, ' + num(t.unverified) + ' without. ' +
         'Both count towards the official total.'
    });

    kpi(box, {
      k: 'Days of voting', v: num(t.days_active),
      n: (t.launch_day ? 'Opened ' + shortDay(t.launch_day) + '. ' : '') +
         (rules.deadline ? 'Closes ' + etTime(rules.deadline) + '.' : 'No closing date is set.')
    });

    kpi(box, {
      k: 'Busiest hour', v: t.peak_hour === null || t.peak_hour === undefined ? '—' : hour(t.peak_hour),
      n: 'Eastern. The single hour that has carried the most points across the whole competition.'
    });
  }

  function splits(d) {
    var box = $('[data-ngd-splits]');
    if (!box) return;
    box.innerHTML = '';
    var t = d.totals || {};
    var total = Math.max(1, n(t.points));
    [
      ['Standard points', t.standard, 'var(--accent)', 'One point a day, for any verified voter.'],
      ['Registration points (slot 2–3)', t.bonus, 'var(--cyan)', 'Only a voter whose daily allowance is above one can create these, which today means a verified Eventbrite registration.'],
      ['Verified voter', t.verified, 'var(--good)', 'Cast after an email or phone was verified.'],
      ['Unverified voter', t.unverified, 'var(--warn)', 'Cast without that verification. Still counted officially.'],
      ['Seeded test rows', t.test, 'var(--magenta)', 'Voter key begins "seed:" — the only discriminator there is. Inside the official total.']
    ].forEach(function (r) {
      var v = n(r[1]);
      var wrap = el('div', 'split');
      var k = el('div', 'split__k');
      k.appendChild(el('span', null, r[0]));
      k.appendChild(el('i', null, num(v) + '  ·  ' + Math.round(v / total * 100) + '%'));
      wrap.appendChild(k);
      var t2 = el('div', 'split__t');
      var f = el('div', 'split__f');
      f.style.width = (v / total * 100) + '%';
      f.style.background = r[2];
      t2.appendChild(f);
      wrap.appendChild(t2);
      wrap.appendChild(el('div', 'split__n', r[3]));
      box.appendChild(wrap);
    });
  }

  /* ---------- the leaderboard bars ---------- */

  function leaderBars(d) {
    var box = $('[data-ngd-bars="overview"]');
    if (!box) return;
    box.innerHTML = '';
    var list = foundersForPeriod().slice().sort(function (a, b) {
      return (b._p !== undefined ? b._p : b.points) - (a._p !== undefined ? a._p : a.points);
    });
    var max = Math.max(1, list.length ? (list[0]._p !== undefined ? list[0]._p : list[0].points) : 1);
    list.slice(0, 20).forEach(function (f) {
      var v = f._p !== undefined ? f._p : n(f.points);
      var row = el('div', 'brow');
      row.appendChild(el('div', 'brow__r', f._rank || f.rank || '—'));
      var b = el('div', 'brow__b');
      var fill = el('div', 'brow__f');
      fill.style.width = (v / max * 100) + '%';
      b.appendChild(fill);
      var tx = el('div', 'brow__t');
      tx.appendChild(el('span', null, f.name));
      b.appendChild(tx);
      row.appendChild(b);
      var val = el('div', 'brow__v');
      val.appendChild(document.createTextNode(num(v)));
      val.appendChild(el('i', null, num(f.voters) + ' voters'));
      row.appendChild(val);
      box.appendChild(row);
    });
    if (!list.length) box.appendChild(el('div', 'ld', 'No points yet'));
  }

  /* ---------- charts ---------- */

  function axes(s, w, h, pad, yMax, xLabels) {
    var steps = 4;
    for (var i = 0; i <= steps; i++) {
      var y = pad.t + (h - pad.t - pad.b) * (i / steps);
      s.appendChild(svg('line', { x1: pad.l, y1: y, x2: w - pad.r, y2: y, 'class': 'gl' }));
      var val = Math.round(yMax * (1 - i / steps));
      var tx = svg('text', { x: pad.l - 7, y: y + 3.5, 'text-anchor': 'end', 'class': 'ax' });
      tx.textContent = val >= 1000 ? (Math.round(val / 100) / 10) + 'k' : val;
      s.appendChild(tx);
    }
    var every = Math.ceil(xLabels.length / 12);
    xLabels.forEach(function (lbl, i) {
      if (i % every !== 0 && i !== xLabels.length - 1) return;
      var bw = (w - pad.l - pad.r) / Math.max(1, xLabels.length);
      var tx = svg('text', {
        x: pad.l + bw * (i + 0.5), y: h - pad.b + 14, 'text-anchor': 'middle', 'class': 'ax'
      });
      tx.textContent = lbl;
      s.appendChild(tx);
    });
  }

  function sparkline(vals, w, h) {
    var s = svg('svg', { viewBox: '0 0 ' + w + ' ' + h, preserveAspectRatio: 'none' });
    var max = Math.max.apply(null, vals.concat([1]));
    var step = w / Math.max(1, vals.length - 1);
    var pts = vals.map(function (v, i) {
      return (i * step).toFixed(1) + ',' + (h - (n(v) / max) * (h - 3) - 1.5).toFixed(1);
    });
    var area = svg('path', {
      d: 'M0,' + h + ' L' + pts.join(' L') + ' L' + w + ',' + h + ' Z',
      fill: 'rgba(31,199,190,.22)'
    });
    s.appendChild(area);
    s.appendChild(svg('path', {
      d: 'M' + pts.join(' L'), fill: 'none', stroke: '#1FC7BE', 'stroke-width': 1.8,
      'vector-effect': 'non-scaling-stroke'
    }));
    return s;
  }

  function chartCumulative(d) {
    var box = $('[data-ngd-chart="cumulative"]');
    if (!box) return;
    box.innerHTML = '';
    var rows = (d.cumulative || []).filter(function (r) { return inWindow(String(r.at).slice(0, 10)); });
    if (!rows.length) { box.appendChild(el('div', 'ld', 'Nothing in this period')); return; }

    var w = 760, h = 260, pad = { t: 14, r: 14, b: 26, l: 42 };
    var s = svg('svg', { viewBox: '0 0 ' + w + ' ' + h, role: 'img' });
    s.setAttribute('aria-label', 'Cumulative points since voting launched');
    var defs = svg('defs');
    var g = svg('linearGradient', { id: 'ngdFill', x1: 0, y1: 0, x2: 0, y2: 1 });
    g.appendChild(svg('stop', { offset: '0%', 'stop-color': '#1FC7BE', 'stop-opacity': '.34' }));
    g.appendChild(svg('stop', { offset: '100%', 'stop-color': '#1FC7BE', 'stop-opacity': '0' }));
    defs.appendChild(g);
    s.appendChild(defs);

    var base = rows[0].cumulative - rows[0].points;
    var max = Math.max(1, rows[rows.length - 1].cumulative - base);
    var iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;

    axes(s, w, h, pad, max + base, rows.map(function (r) { return shortDay(String(r.at).slice(0, 10)); }));

    var pts = rows.map(function (r, i) {
      var x = pad.l + (rows.length === 1 ? iw / 2 : iw * (i / (rows.length - 1)));
      var y = pad.t + ih - ih * ((r.cumulative - base) / max);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    s.appendChild(svg('path', {
      d: 'M' + pad.l + ',' + (pad.t + ih) + ' L' + pts.join(' L') +
         ' L' + (w - pad.r) + ',' + (pad.t + ih) + ' Z', 'class': 'area'
    }));
    s.appendChild(svg('path', { d: 'M' + pts.join(' L'), 'class': 'line' }));

    var lastXY = pts[pts.length - 1].split(',');
    s.appendChild(svg('circle', { cx: lastXY[0], cy: lastXY[1], r: 3.6, 'class': 'dot' }));
    var lab = svg('text', { x: Number(lastXY[0]) - 6, y: Number(lastXY[1]) - 10, 'text-anchor': 'end', 'class': 'lbl' });
    lab.textContent = num(rows[rows.length - 1].cumulative) + ' points';
    s.appendChild(lab);

    box.appendChild(s);
  }

  function chartDaily(box, d) {
    if (!box) return;
    box.innerHTML = '';
    var rows = (d.daily || []).filter(function (r) { return inWindow(r.day); });
    if (!rows.length) { box.appendChild(el('div', 'ld', 'Nothing in this period')); return; }

    var w = 760, h = 250, pad = { t: 14, r: 14, b: 26, l: 42 };
    var s = svg('svg', { viewBox: '0 0 ' + w + ' ' + h, role: 'img' });
    s.setAttribute('aria-label', 'Points a day, standard and registration bonus');
    var max = Math.max.apply(null, rows.map(function (r) { return n(r.points); }).concat([1]));
    var iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    var bw = iw / rows.length;

    axes(s, w, h, pad, max, rows.map(function (r) { return shortDay(r.day); }));

    rows.forEach(function (r, i) {
      var x = pad.l + bw * i + bw * 0.18;
      var bwid = bw * 0.64;
      var hStd = ih * (n(r.standard) / max);
      var hBon = ih * (n(r.bonus) / max);
      if (hBon > 0) {
        s.appendChild(svg('rect', {
          x: x.toFixed(1), y: (pad.t + ih - hStd - hBon).toFixed(1),
          width: bwid.toFixed(1), height: Math.max(1, hBon).toFixed(1),
          'class': 'bar-b', rx: 2
        }));
      }
      s.appendChild(svg('rect', {
        x: x.toFixed(1), y: (pad.t + ih - hStd).toFixed(1),
        width: bwid.toFixed(1), height: Math.max(1, hStd).toFixed(1),
        'class': 'bar-a', rx: 2
      }));
      if (bw > 34) {
        var tx = svg('text', {
          x: (x + bwid / 2).toFixed(1), y: (pad.t + ih - hStd - hBon - 6).toFixed(1),
          'text-anchor': 'middle', 'class': 'lbl'
        });
        tx.textContent = r.points;
        s.appendChild(tx);
      }
      if (r.is_today) {
        var t2 = svg('text', {
          x: (x + bwid / 2).toFixed(1), y: (h - pad.b + 24).toFixed(1),
          'text-anchor': 'middle', 'class': 'ax'
        });
        t2.textContent = 'open';
        s.appendChild(t2);
      }
    });

    box.appendChild(s);
    var key = el('p', 'card__p');
    key.innerHTML = '<span style="color:var(--accent)">■</span> standard &nbsp; ' +
                    '<span style="color:var(--cyan)">■</span> registration bonus' +
                    (rows.some(function (r) { return r.is_today; }) ? ' &nbsp;·&nbsp; today is still open' : '');
    box.appendChild(key);
  }

  function chartHourly(d) {
    var box = $('[data-ngd-chart="hourly"]');
    if (!box) return;
    box.innerHTML = '';
    var rows = d.hourly || [];
    if (!rows.length) { box.appendChild(el('div', 'ld', 'No hourly data')); return; }
    var w = 760, h = 230, pad = { t: 14, r: 14, b: 26, l: 42 };
    var s = svg('svg', { viewBox: '0 0 ' + w + ' ' + h, role: 'img' });
    s.setAttribute('aria-label', 'Points by Eastern hour across the whole competition');
    var max = Math.max.apply(null, rows.map(function (r) { return n(r.points); }).concat([1]));
    var iw = w - pad.l - pad.r, ih = h - pad.t - pad.b, bw = iw / 24;
    axes(s, w, h, pad, max, rows.map(function (r, i) { return i % 3 === 0 ? hour(r.hour) : ''; }));
    rows.forEach(function (r, i) {
      var hh = ih * (n(r.points) / max);
      s.appendChild(svg('rect', {
        x: (pad.l + bw * i + bw * 0.16).toFixed(1), y: (pad.t + ih - hh).toFixed(1),
        width: (bw * 0.68).toFixed(1), height: Math.max(1, hh).toFixed(1),
        fill: n(r.points) === max ? '#1FC7BE' : 'rgba(31,199,190,.5)', rx: 2
      }));
    });
    box.appendChild(s);
  }

  function chartRanks(d) {
    var box = $('[data-ngd-chart="ranks"]');
    if (!box) return;
    box.innerHTML = '';
    var hist = (d.rank_history || []).filter(function (r) { return inWindow(r.day); });
    if (hist.length < 2) {
      box.appendChild(el('div', 'ld', 'Two days are needed to show movement'));
      return;
    }
    var top = (d.founders || []).slice(0, 10);
    var w = 760, h = 300, pad = { t: 16, r: 150, b: 26, l: 34 };
    var s = svg('svg', { viewBox: '0 0 ' + w + ' ' + h, role: 'img' });
    s.setAttribute('aria-label', 'Day-end rank for the current top ten');
    var iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;

    for (var r = 1; r <= 17; r += 4) {
      var y = pad.t + ih * ((r - 1) / 19);
      s.appendChild(svg('line', { x1: pad.l, y1: y, x2: w - pad.r, y2: y, 'class': 'gl' }));
      var tx = svg('text', { x: pad.l - 6, y: y + 3.5, 'text-anchor': 'end', 'class': 'ax' });
      tx.textContent = '#' + r;
      s.appendChild(tx);
    }
    hist.forEach(function (row, i) {
      var tx = svg('text', {
        x: (pad.l + (hist.length === 1 ? iw / 2 : iw * (i / (hist.length - 1)))).toFixed(1),
        y: h - pad.b + 15, 'text-anchor': 'middle', 'class': 'ax'
      });
      tx.textContent = shortDay(row.day);
      s.appendChild(tx);
    });

    var hues = ['#1FC7BE', '#00A3E6', '#EC008C', '#FFE500', '#2FE08A',
                '#FF5A6E', '#9D7BFF', '#FFB224', '#5AC8FA', '#C0CF3A'];
    top.forEach(function (f, k) {
      var pts = hist.map(function (row, i) {
        var rk = n(row.rank[f.id]) || 20;
        var x = pad.l + (hist.length === 1 ? iw / 2 : iw * (i / (hist.length - 1)));
        var y = pad.t + ih * ((rk - 1) / 19);
        return x.toFixed(1) + ',' + y.toFixed(1);
      });
      s.appendChild(svg('path', {
        d: 'M' + pts.join(' L'), fill: 'none', stroke: hues[k % hues.length],
        'stroke-width': 2, 'stroke-linejoin': 'round', opacity: '.92'
      }));
      var last = pts[pts.length - 1].split(',');
      s.appendChild(svg('circle', { cx: last[0], cy: last[1], r: 3, fill: hues[k % hues.length] }));
      var lab = svg('text', {
        x: Number(last[0]) + 8, y: Number(last[1]) + 3.5, 'class': 'ax', fill: hues[k % hues.length]
      });
      lab.textContent = '#' + (f.rank || '?') + '  ' + f.name;
      s.appendChild(lab);
    });
    box.appendChild(s);
  }

  function heatmap(d) {
    var box = $('[data-ngd-heat]');
    if (!box) return;
    box.innerHTML = '';
    var rows = (d.heatmap || []).filter(function (r) { return inWindow(r.day); });
    if (!rows.length) { box.appendChild(el('div', 'ld', 'Nothing in this period')); return; }
    var max = 1;
    rows.forEach(function (r) { r.hours.forEach(function (v) { max = Math.max(max, n(v)); }); });

    var t = el('table');
    var cap = el('caption', null,
      'Darkest cell is ' + num(max) + ' point' + (max === 1 ? '' : 's') + ' in one hour. Eastern time.');
    t.appendChild(cap);
    var thead = el('thead');
    var tr = el('tr');
    tr.appendChild(el('th', 'd', ''));
    for (var i = 0; i < 24; i++) tr.appendChild(el('th', null, i % 3 === 0 ? hour(i) : ''));
    thead.appendChild(tr);
    t.appendChild(thead);
    var tb = el('tbody');
    rows.forEach(function (r) {
      var row = el('tr');
      var th = el('th', 'd', r.weekday + ' ' + shortDay(r.day));
      row.appendChild(th);
      r.hours.forEach(function (v, hIdx) {
        var td = el('td');
        var cell = el('i');
        if (n(v) > 0) {
          cell.setAttribute('data-v', String(v));
          cell.style.setProperty('--w', String(Math.pow(n(v) / max, 0.6)));
        }
        cell.title = num(v) + ' point' + (n(v) === 1 ? '' : 's') + ' at ' + hour(hIdx) + ' on ' + r.day;
        td.appendChild(cell);
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
    t.appendChild(tb);
    box.appendChild(t);
  }

  /* ---------- tables ---------- */

  function head(table, cols) {
    var thead = el('thead');
    var tr = el('tr');
    cols.forEach(function (c) {
      var th = el('th', c.cls || null, c.label);
      if (c.sort) {
        th.setAttribute('data-sort', c.sort);
        if (state.sort.key === c.sort) {
          th.setAttribute('aria-sort', state.sort.dir === 1 ? 'ascending' : 'descending');
        }
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
  }

  function tableDaily(d) {
    var t = $('[data-ngd-table="daily"]');
    if (!t) return;
    t.innerHTML = '';
    head(t, [{ label: 'Day' }, { label: 'Points', cls: 'num' }, { label: 'Voters', cls: 'num' },
             { label: 'Standard', cls: 'num' }, { label: 'Bonus', cls: 'num' },
             { label: 'Verified', cls: 'num' }, { label: 'Unverified', cls: 'num' },
             { label: 'Test', cls: 'num' }, { label: 'Cumulative', cls: 'num' },
             { label: 'Day leader' }]);
    var rows = (d.daily || []).filter(function (r) { return inWindow(r.day); }).slice().reverse();
    if (!rows.length) { emptyRow(t, 10, 'Nothing in this period.'); return; }
    var tb = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      var c1 = el('td');
      c1.appendChild(el('b', null, r.weekday + ' ' + shortDay(r.day)));
      if (r.is_today) c1.appendChild(el('i', null, ' still open'));
      tr.appendChild(c1);
      [[r.points, 'big'], [r.voters], [r.standard], [r.bonus], [r.verified], [r.unverified],
       [r.test], [r.cumulative]].forEach(function (v) {
        tr.appendChild(el('td', 'num' + (v[1] ? ' ' + v[1] : ''), num(v[0])));
      });
      tr.appendChild(el('td', null, r.top ? (r.top.name + '  (' + r.top.points + ')') : '—'));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
  }

  function tableFounders(d) {
    var t = $('[data-ngd-table="founders"]');
    if (!t) return;
    t.innerHTML = '';
    head(t, [
      { label: '' }, { label: 'Rank', cls: 'num', sort: 'rank' }, { label: 'Founder', sort: 'name' },
      { label: 'Points', cls: 'num', sort: 'points' }, { label: 'Supporters', cls: 'num', sort: 'voters' },
      { label: 'Standard', cls: 'num', sort: 'standard' }, { label: 'Bonus', cls: 'num', sort: 'bonus' },
      { label: 'Today', cls: 'num', sort: 'today' }, { label: 'Yesterday', cls: 'num', sort: 'yesterday' },
      { label: 'Day growth', cls: 'num', sort: 'growth_pct' }, { label: 'Move', cls: 'num', sort: 'rank_move' },
      { label: 'Share', cls: 'num', sort: 'share_pct' }, { label: 'Trend' }
    ]);

    var list = foundersForPeriod();
    var q = state.search.toLowerCase();
    if (q) {
      list = list.filter(function (f) {
        return (f.name + ' ' + f.company + ' ' + f.id).toLowerCase().indexOf(q) >= 0;
      });
    }
    /* dir is +1 for ascending and -1 for descending, consistently. Rank and name start
       ascending, because rank 1 and "A" are what you want at the top; every numeric column
       starts descending, because the biggest number is the interesting one. */
    var k = state.sort.key, dir = state.sort.dir;
    list.sort(function (a, b) {
      var av, bv;
      if (k === 'name') {
        av = String(a.name).toLowerCase(); bv = String(b.name).toLowerCase();
        return av < bv ? -dir : (av > bv ? dir : 0);
      }
      if (k === 'rank') { av = n(a._rank || a.rank) || 99; bv = n(b._rank || b.rank) || 99; }
      else if (k === 'points') {
        av = a._p !== undefined ? a._p : n(a.points);
        bv = b._p !== undefined ? b._p : n(b.points);
      } else { av = n(a[k]); bv = n(b[k]); }
      if (av === bv) { return String(a.id) < String(b.id) ? -1 : 1; }
      return (av - bv) * dir;
    });

    if (!list.length) { emptyRow(t, 13, 'No founder matches that search.'); return; }

    var tb = el('tbody');
    list.forEach(function (f) {
      var tr = el('tr');

      var pick = el('td');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-ngd-pick', f.id);
      cb.checked = state.compare.indexOf(f.id) >= 0;
      cb.setAttribute('aria-label', 'Compare ' + f.name);
      pick.appendChild(cb);
      tr.appendChild(pick);

      tr.appendChild(el('td', 'num big', f._rank || f.rank || '—'));

      var who = el('td');
      var box = el('div', 'who');
      if (f.shot) {
        var img = document.createElement('img');
        img.src = f.shot;
        img.alt = '';
        img.loading = 'lazy';
        box.appendChild(img);
      }
      var txt = el('div');
      txt.appendChild(el('b', null, f.name));
      txt.appendChild(el('i', null, f.company));
      box.appendChild(txt);
      who.appendChild(box);
      tr.appendChild(who);

      tr.appendChild(el('td', 'num big', num(f._p !== undefined ? f._p : f.points)));
      tr.appendChild(el('td', 'num', num(f.voters)));
      tr.appendChild(el('td', 'num', num(f.standard)));
      tr.appendChild(el('td', 'num', num(f.bonus)));
      tr.appendChild(el('td', 'num', num(f.today)));
      tr.appendChild(el('td', 'num', num(f.yesterday)));
      tr.appendChild(el('td', 'num', f.growth_pct === null || f.growth_pct === undefined
        ? 'new' : pct(f.growth_pct)));

      var mv = el('td', 'num');
      var m = f.rank_move;
      if (m === null || m === undefined) mv.appendChild(el('span', 'move move--same', '—'));
      else if (m > 0) mv.appendChild(el('span', 'move move--up', '▲ ' + m));
      else if (m < 0) mv.appendChild(el('span', 'move move--down', '▼ ' + Math.abs(m)));
      else mv.appendChild(el('span', 'move move--same', 'held'));
      tr.appendChild(mv);

      tr.appendChild(el('td', 'num', (f.share_pct || 0) + '%'));

      var sp = el('td');
      if (f.trend && f.trend.length > 1) {
        var s = sparkline(f.trend, 78, 22);
        s.setAttribute('class', 'spark');
        sp.appendChild(s);
      }
      tr.appendChild(sp);

      tb.appendChild(tr);
    });
    t.appendChild(tb);
  }

  function compare(d) {
    var card = $('[data-ngd-compare-card]');
    var box = $('[data-ngd-chart="compare"]');
    var tbl = $('[data-ngd-table="compare"]');
    if (!card || !box || !tbl) return;
    if (!state.compare.length) { card.hidden = true; return; }
    card.hidden = false;
    box.innerHTML = '';
    tbl.innerHTML = '';

    var picked = (d.founders || []).filter(function (f) { return state.compare.indexOf(f.id) >= 0; });
    var days = (d.daily || []).filter(function (r) { return inWindow(r.day); });
    var idx = (d.daily || []).map(function (r) { return r.day; });

    var w = 760, h = 270, pad = { t: 16, r: 130, b: 26, l: 42 };
    var s = svg('svg', { viewBox: '0 0 ' + w + ' ' + h, role: 'img' });
    s.setAttribute('aria-label', 'Points a day for the selected founders');
    var max = 1;
    picked.forEach(function (f) {
      idx.forEach(function (day, i) { if (inWindow(day)) max = Math.max(max, n((f.trend || [])[i])); });
    });
    var iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    axes(s, w, h, pad, max, days.map(function (r) { return shortDay(r.day); }));

    var hues = ['#1FC7BE', '#00A3E6', '#EC008C', '#FFE500', '#2FE08A'];
    picked.forEach(function (f, k) {
      var pts = [];
      var j = 0;
      idx.forEach(function (day, i) {
        if (!inWindow(day)) return;
        var x = pad.l + (days.length === 1 ? iw / 2 : iw * (j / Math.max(1, days.length - 1)));
        var y = pad.t + ih - ih * (n((f.trend || [])[i]) / max);
        pts.push(x.toFixed(1) + ',' + y.toFixed(1));
        j++;
      });
      if (pts.length < 1) return;
      s.appendChild(svg('path', {
        d: 'M' + pts.join(' L'), fill: 'none', stroke: hues[k % hues.length],
        'stroke-width': 2.2, 'stroke-linejoin': 'round'
      }));
      var last = pts[pts.length - 1].split(',');
      s.appendChild(svg('circle', { cx: last[0], cy: last[1], r: 3.2, fill: hues[k % hues.length] }));
      var lab = svg('text', {
        x: Number(last[0]) + 8, y: Number(last[1]) + 3.5, 'class': 'ax', fill: hues[k % hues.length]
      });
      lab.textContent = f.name;
      s.appendChild(lab);
    });
    box.appendChild(s);

    head(tbl, [{ label: 'Founder' }, { label: 'Rank', cls: 'num' }, { label: 'Points', cls: 'num' },
               { label: 'Supporters', cls: 'num' }, { label: 'Points each', cls: 'num' },
               { label: 'Bonus', cls: 'num' }, { label: 'Today', cls: 'num' },
               { label: 'Share', cls: 'num' }]);
    var tb = el('tbody');
    picked.forEach(function (f) {
      var tr = el('tr');
      var c = el('td');
      c.appendChild(el('b', null, f.name));
      c.appendChild(el('i', null, f.company));
      tr.appendChild(c);
      [f.rank, f.points, f.voters, f.points_per_voter, f.bonus, f.today].forEach(function (v) {
        tr.appendChild(el('td', 'num', num(v)));
      });
      tr.appendChild(el('td', 'num', (f.share_pct || 0) + '%'));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
  }

  /* ---------- traffic ---------- */

  function traffic(d) {
    var note = $('[data-ngd-traffic-note]');
    var tr = d.traffic || {};
    var ev = d.events || {};
    if (note) {
      note.innerHTML = '';
      note.appendChild(el('h2', 'card__h', 'What traffic data exists, and what does not'));
      var p = el('p', 'card__p');
      p.textContent = tr.coverage || '';
      note.appendChild(p);
      var p2 = el('p', 'card__p');
      p2.textContent = ev.collecting
        ? ('The NextGen Data collector has been recording page views and journey steps since ' +
           etTime(ev.since) + '. ' + (ev.note || ''))
        : ('The NextGen Data collector is not recording on this site, so the page-view and journey ' +
           'tables below are empty. Nothing before it is switched on can be recovered.');
      note.appendChild(p2);
      var p3 = el('p', 'card__p');
      p3.innerHTML = '<b>Google Analytics 4 is already on the live site</b> (measurement ' +
        'G-3M5BCK61VB, via GTM container GTM-PRVSWFBN), on the homepage, the People’s Choice ' +
        'page and the ticket pages. That means site-wide page views and referrers for the ' +
        'competition’s first days <i>do exist</i> — in Google’s property, not in this ' +
        'database. Pulling them in here needs a Google Analytics Data API service account, which is ' +
        'an access decision rather than a build task. Note also that the individual contestant pages ' +
        'carry no GA4 tag at all, which is why the visit table below is the only per-founder traffic ' +
        'signal that exists.';
      note.appendChild(p3);
    }

    var t = $('[data-ngd-table="traffic"]');
    if (t) {
      t.innerHTML = '';
      head(t, [{ label: 'Founder' }, { label: 'Link opens', cls: 'num' },
               { label: 'Day-unique', cls: 'num' }, { label: 'Their points', cls: 'num' },
               { label: 'Opens to voters', cls: 'num' }]);
      var byE = tr.by_entrant || {};
      var names = {};
      (d.founders || []).forEach(function (f) { names[f.id] = f; });
      var rows = Object.keys(byE).map(function (id) {
        return { id: id, v: byE[id], f: names[id] };
      }).sort(function (a, b) { return n(b.v.visits) - n(a.v.visits); });
      if (!rows.length) {
        emptyRow(t, 5, 'No contestant-page link opens have been recorded on this source.');
      } else {
        var tb = el('tbody');
        rows.forEach(function (r) {
          var row = el('tr');
          var c = el('td');
          c.appendChild(el('b', null, (r.f && r.f.name) || r.id));
          c.appendChild(el('i', null, (r.f && r.f.company) || ''));
          row.appendChild(c);
          row.appendChild(el('td', 'num big', num(r.v.visits)));
          row.appendChild(el('td', 'num', num(r.v.uniques)));
          row.appendChild(el('td', 'num', num(r.f && r.f.points)));
          row.appendChild(el('td', 'num', (r.v.uniques > 0 && r.f)
            ? (Math.round(n(r.f.voters) / n(r.v.uniques) * 1000) / 10) + '%' : '—'));
          tb.appendChild(row);
        });
        t.appendChild(tb);
      }
    }

    var s = $('[data-ngd-table="sources"]');
    if (s) {
      s.innerHTML = '';
      head(s, [{ label: 'Source' }, { label: 'Link opens', cls: 'num' }, { label: 'Day-unique', cls: 'num' }]);
      var src = tr.by_source || [];
      if (!src.length) emptyRow(s, 3, 'No sources recorded.');
      else {
        var tb2 = el('tbody');
        src.forEach(function (r) {
          var row = el('tr');
          row.appendChild(el('td', null, r.source || 'direct'));
          row.appendChild(el('td', 'num big', num(r.visits)));
          row.appendChild(el('td', 'num', num(r.uniques)));
          tb2.appendChild(row);
        });
        s.appendChild(tb2);
      }
    }

    var p = $('[data-ngd-table="pages"]');
    if (p) {
      p.innerHTML = '';
      head(p, [{ label: 'Page' }, { label: 'Views', cls: 'num' }, { label: 'Unique visitors', cls: 'num' }]);
      var pages = ev.by_page || [];
      if (!pages.length) {
        emptyRow(p, 3, ev.collecting
          ? 'No page views recorded in this period.'
          : 'The collector is not switched on for this site, so no page views exist.');
      } else {
        var tb3 = el('tbody');
        pages.forEach(function (r) {
          var row = el('tr');
          row.appendChild(el('td', null, r.page));
          row.appendChild(el('td', 'num big', num(r.views)));
          row.appendChild(el('td', 'num', num(r.visitors)));
          tb3.appendChild(row);
        });
        p.appendChild(tb3);
      }
    }
  }

  /* ---------- conversions ---------- */

  function conversions(d) {
    var note = $('[data-ngd-funnel-note]');
    var ev = d.events || {};
    if (note) {
      note.innerHTML = '';
      note.appendChild(el('h2', 'card__h', 'How this funnel is measured'));
      var p = el('p', 'card__p');
      p.textContent = ev.collecting
        ? ('Steps are counted from events this site has collected since ' + etTime(ev.since) +
           '. A step belongs to a visitor token that lasts one Eastern day, so a journey that ' +
           'crosses midnight shows as two visitors — which understates conversion rather ' +
           'than overstating it.')
        : ('Nothing is being collected on this site, so every step below reads zero because ' +
           'nothing was measured, not because nothing happened. The switch is in Settings.');
      note.appendChild(p);
      var p2 = el('p', 'card__p');
      p2.innerHTML = '<b>A click is never counted as a purchase.</b> Confirmed ticket orders require ' +
        'Eventbrite order data, which this dashboard does not read and will not infer.';
      note.appendChild(p2);
    }

    var box = $('[data-ngd-funnel]');
    if (box) {
      box.innerHTML = '';
      var k = ev.kinds || {};
      var steps = [
        ['Page view', 'page_view', 'Any page carrying the collector'],
        ['Founder opened', 'founder_open', 'A card, bubble or reel actively opened'],
        ['Vote started', 'vote_start', 'The vote button pressed'],
        ['Verification opened', 'verify_open', 'The email or phone dialog shown'],
        ['Code verified', 'otp_verified', 'A code accepted'],
        ['Vote confirmed', 'vote_confirmed', 'A point actually cast'],
        ['Ticket link clicked', 'ticket_cta', 'A link towards tickets'],
        ['Ticket page viewed', 'tickets_view', 'The ticket page opened'],
        ['Checkout opened', 'checkout_open', 'The Eventbrite checkout actually opened']
      ];
      var first = null;
      steps.forEach(function (s) {
        var row = k[s[1]] || { events: 0, visitors: 0 };
        if (first === null && n(row.visitors) > 0) first = n(row.visitors);
        var pc = (first && first > 0) ? Math.round(n(row.visitors) / first * 1000) / 10 : 0;
        var d2 = el('div', 'fstep');
        d2.style.setProperty('--w', pc + '%');
        var kk = el('div', 'fstep__k');
        kk.appendChild(el('span', null, s[0]));
        kk.appendChild(el('i', null, s[2]));
        d2.appendChild(kk);
        var vv = el('div', 'fstep__v');
        vv.appendChild(document.createTextNode(num(row.visitors)));
        vv.appendChild(el('i', null, num(row.events) + ' events · ' + pc + '% of the first step'));
        d2.appendChild(vv);
        box.appendChild(d2);
      });

      var last = el('div', 'fstep fstep--none');
      var lk = el('div', 'fstep__k');
      lk.appendChild(el('span', null, 'Confirmed ticket order'));
      lk.appendChild(el('i', null, 'Requires Eventbrite order data'));
      last.appendChild(lk);
      var lv = el('div', 'fstep__v', 'not available');
      last.appendChild(lv);
      box.appendChild(last);
    }

    var o = $('[data-ngd-orders]');
    if (o) {
      o.innerHTML = '';
      var p3 = el('p', 'card__p');
      p3.innerHTML = 'The server already holds an Eventbrite private token, which the homepage ticket ' +
        'counter uses to read attendee numbers for event 1999190304016. Reading <i>orders</i> — ' +
        'which is what a confirmed purchase is — is a different Eventbrite endpoint and a ' +
        'different permission, and attributing an order back to a People’s Choice visit needs ' +
        'either a tracking code on the checkout link or a custom question on the order form. ' +
        'Neither exists yet. Until one does, this panel stays empty rather than showing a click ' +
        'count and calling it a sale.';
      o.appendChild(p3);
    }
  }

  /* ---------- insights, integrity, definitions ---------- */

  function insights(d) {
    var box = $('[data-ngd-insights]');
    if (box) {
      box.innerHTML = '';
      (d.insights || []).forEach(function (i) {
        var c = el('div', 'ins ins--' + (i.tone || 'info'));
        c.appendChild(el('h2', 'ins__h', i.headline));
        c.appendChild(el('p', 'ins__e', i.evidence));
        c.appendChild(el('p', 'ins__a', i.action));
        box.appendChild(c);
      });
      if (!(d.insights || []).length) box.appendChild(el('div', 'ld', 'No insights yet'));
    }

    var ig = $('[data-ngd-integrity]');
    if (ig) {
      ig.innerHTML = '';
      (d.integrity || []).forEach(function (i) {
        var row = el('div', 'intg intg--' + (i.level || 'info'));
        row.appendChild(el('span', 'intg__t'));
        var tx = el('div');
        tx.appendChild(el('b', null, i.what));
        tx.appendChild(document.createTextNode(' — ' + i.detail));
        row.appendChild(tx);
        ig.appendChild(row);
      });
      if (!(d.integrity || []).length) {
        ig.appendChild(el('div', 'intg', 'Nothing to flag about these numbers.'));
      }
    }

    var df = $('[data-ngd-defs]');
    if (df) {
      df.innerHTML = '';
      var defs = d.definitions || {};
      Object.keys(defs).forEach(function (k) {
        var row = el('div', 'def');
        row.appendChild(el('b', null, k.replace(/_/g, ' ')));
        row.appendChild(el('span', null, defs[k]));
        df.appendChild(row);
      });
    }
  }

  /* ---------- exports ---------- */

  function exportUrl(report, format, entrant) {
    var q = ['report=' + report, 'format=' + format, 'source=live'];
    if (state.period === 'custom' && state.from && state.to) {
      q.push('from=' + encodeURIComponent(state.from), 'to=' + encodeURIComponent(state.to));
    }
    if (entrant) q.push('entrant=' + encodeURIComponent(entrant));
    return '/insights/export.php?' + q.join('&');
  }

  function exportsPanel(d) {
    var box = $('[data-ngd-exports]');
    if (box) {
      box.innerHTML = '';
      [
        ['executive',   'Executive summary',        'Every headline figure, the top ten, and the insights, with definitions.'],
        ['leaderboard', 'Founder leaderboard',      'All twenty founders with points, supporters, bonus, movement and share.'],
        ['daily',       'Daily and hourly activity','Day by day since launch, plus the hourly pattern across the competition.'],
        ['hourly',      'Hourly heatmap',           'Every day crossed with every Eastern hour.'],
        ['ranks',       'Rank movement',            'Day-end rank per founder, reconstructed from vote timestamps.'],
        ['bonus',       'Registration bonus points','Standard against bonus, by day and by founder.'],
        ['traffic',     'Traffic sources',          'Contestant-page visits and whatever the collector has gathered.'],
        ['conversions', 'Conversion funnel',        'Each measured step, with the gaps named rather than filled in.']
      ].forEach(function (r) {
        var row = el('div', 'exp');
        var k = el('div', 'exp__k');
        k.appendChild(el('span', null, r[1]));
        k.appendChild(el('i', null, r[2]));
        row.appendChild(k);
        var b = el('div', 'exp__b');
        [['csv', 'CSV'], ['xlsx', 'Excel'], ['pdf', 'PDF']].forEach(function (f) {
          var a = el('a', 'btn btn--ghost btn--sm', f[1]);
          a.href = exportUrl(r[0], f[0]);
          a.setAttribute('download', '');
          b.appendChild(a);
        });
        row.appendChild(b);
        box.appendChild(row);
      });
    }

    var sel = $('[data-ngd-export-founder]');
    if (sel && !sel.options.length) {
      (d.founders || []).forEach(function (f) {
        var o = document.createElement('option');
        o.value = f.id;
        o.textContent = f.name + ' — ' + f.company;
        sel.appendChild(o);
      });
    }
    $$('[data-ngd-export-one]').forEach(function (a) {
      a.href = exportUrl('founder', a.getAttribute('data-ngd-export-one'), sel && sel.value);
      a.setAttribute('download', '');
    });
  }

  function foot(d) {
    var f = $('[data-ngd-foot]');
    if (!f) return;
    var m = d.meta || {}, h = d.health || {};
    f.textContent = [
      'source ' + (m.source || '?'),
      m.rows_read + ' rows',
      'read ' + (m.built_at || '?'),
      'built in ' + (m.build_ms === undefined ? '?' : m.build_ms) + 'ms',
      'served ' + (m.served || '?'),
      h.open_method || 'read-only'
    ].join('  ·  ');
  }

  /* ---------- wiring ---------- */

  function tabs() {
    $$('[data-ngd-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-ngd-tab');
        $$('[data-ngd-tab]').forEach(function (b) {
          b.setAttribute('aria-current', b === btn ? 'true' : 'false');
        });
        $$('[data-ngd-panel]').forEach(function (p) {
          p.hidden = p.getAttribute('data-ngd-panel') !== name;
        });
        try { history.replaceState(null, '', '#' + name); } catch (e) {}
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
    var want = (location.hash || '').replace('#', '');
    if (want) {
      var b = $('[data-ngd-tab="' + want + '"]');
      if (b) b.click();
    }
  }

  function periods() {
    $$('[data-ngd-period]').forEach(function (c) {
      c.addEventListener('click', function () {
        var p = c.getAttribute('data-ngd-period');
        $$('[data-ngd-period]').forEach(function (x) {
          x.setAttribute('aria-pressed', x === c ? 'true' : 'false');
        });
        state.period = p;
        var cust = $('[data-ngd-custom]');
        if (cust) cust.hidden = p !== 'custom';
        if (p === 'custom') {
          var d = state.data;
          var from = $('[data-ngd-from]'), to = $('[data-ngd-to]');
          if (d && d.daily && d.daily.length) {
            if (from && !from.value) from.value = d.daily[0].day;
            if (to && !to.value) to.value = d.daily[d.daily.length - 1].day;
          }
        } else if (state.data) {
          render();
        }
      });
    });

    var apply = $('[data-ngd-apply]');
    if (apply) {
      apply.addEventListener('click', function () {
        var from = $('[data-ngd-from]'), to = $('[data-ngd-to]');
        state.from = from ? from.value : '';
        state.to = to ? to.value : '';
        if (!state.from || !state.to) return;
        load(false);
      });
    }
  }

  function sorting() {
    document.addEventListener('click', function (e) {
      var th = e.target.closest ? e.target.closest('th[data-sort]') : null;
      if (!th) return;
      var k = th.getAttribute('data-sort');
      state.sort = (state.sort.key === k)
        ? { key: k, dir: state.sort.dir * -1 }
        : { key: k, dir: (k === 'name' || k === 'rank') ? 1 : -1 };
      if (state.data) tableFounders(state.data);
    });
  }

  function picking() {
    document.addEventListener('change', function (e) {
      var cb = e.target;
      if (!cb || !cb.getAttribute || !cb.getAttribute('data-ngd-pick')) return;
      var id = cb.getAttribute('data-ngd-pick');
      var at = state.compare.indexOf(id);
      if (cb.checked && at < 0) {
        if (state.compare.length >= 5) {
          cb.checked = false;
          return;
        }
        state.compare.push(id);
      } else if (!cb.checked && at >= 0) {
        state.compare.splice(at, 1);
      }
      if (state.data) compare(state.data);
    });
  }

  function searching() {
    var box = $('[data-ngd-search]');
    if (!box) return;
    var t = null;
    box.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        state.search = box.value || '';
        if (state.data) tableFounders(state.data);
      }, 140);
    });
  }

  function refreshing() {
    var btn = $('[data-ngd-refresh]');
    if (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        btn.textContent = 'Reading';
        load(true);
        setTimeout(function () { btn.disabled = false; btn.textContent = 'Refresh'; }, 1400);
      });
    }
    /* A quiet poll, and only while the tab is actually in front: a dashboard left open on
       a spare monitor overnight has no business reading the database every minute. */
    state.timer = setInterval(function () {
      if (!document.hidden) load(false);
    }, REFRESH_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.data) load(false);
    });
  }

  function init() {
    if (!$('[data-ngd-kpis]')) return;        // the gate, or the dashboard switched off
    loading($('[data-ngd-kpis]'));
    tabs();
    periods();
    sorting();
    picking();
    searching();
    refreshing();
    load(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
