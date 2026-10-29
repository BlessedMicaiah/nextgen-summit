# -*- coding: utf-8 -*-
"""Is the site actually working? Ask it, every day, and say so plainly.

    python -I tools/healthcheck.py production
    python -I tools/healthcheck.py staging
    python -I tools/healthcheck.py both          [--json FILE] [--quiet]

WHY THIS EXISTS

Nothing here is clever. It is a list of the ways this particular site has broken, or could
break quietly, turned into questions that get asked every morning instead of whenever
somebody happens to notice:

  - a page 404s or 500s after a deploy;
  - a page asks for a stylesheet or a script that is not there -- the usual result of a
    cache stamp bumped in one file and not another, and invisible until the page renders
    wrong for somebody;
  - an image or a video referenced by a page has gone missing from the server;
  - the voting API stops answering, or answers nonsense. A ballot that is quietly down is
    the worst failure this site has, because nobody complains -- they just leave;
  - the People's Choice deadline goes null, which does not close voting, it makes it run
    forever;
  - the certificate is days from expiry;
  - staging gets indexed, or production stops being indexable;
  - somebody edits the live server by hand and the next deploy silently reverts them
    (tools/check-drift.py, called from here).

It is strictly READ-ONLY. It fetches pages and prints. It never writes to the site, never
deploys, never touches the database. Run it as often as you like.

EXIT CODE
    0  everything passed, or only warnings
    1  at least one FAIL
    2  the check itself could not run
"""
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = 'NextGenHealthcheck/1.0 (+https://nextgensummit.us)'
TIMEOUT = 25

TARGETS = {
    'production': {
        'base': 'https://nextgensummit.us',
        'branch': 'main',
        'indexable': True,
    },
    'staging': {
        'base': 'https://staging.nextgensummit.us',
        'branch': 'monday-launch',
        'indexable': False,
    },
}

# The pages a visitor can reach. Anything that 404s here is a broken promise somewhere.
PAGES = [
    '/', '/about/', '/tickets/', '/music/', '/experience/', '/scholarship/',
    '/pitch/', '/pitch/peoples-choice/', '/pitch/peoples-choice/top-10/',
    '/thanks/', '/registration-received/', '/scholarship/received/',
]

# Read-only API endpoints, with the keys their answer must contain.
APIS = [
    ('/api/pc-vote.php', ['ok', 'state', 'open', 'deadline', 'mode']),
    ('/api/attendee-count.php', ['count']),
]

# A page is not healthy just because it returns 200. These are the things that must be on it.
CONTENT = [
    ('/', ['nextgen', 'Gordon', 'tickets'], 'the Summit page'),
    ('/tickets/', ['eventbrite', 'NEXTSTAR'], 'Get tickets'),
    ('/pitch/peoples-choice/', ['People', 'peoples-choice.js'], "People's Choice"),
    ('/music/', ['soundcloud.com', 'SHOW ME'], 'Music'),
]

ASSET_RE = re.compile(
    r'(?:src|href)\s*=\s*["\']([^"\']+\.(?:css|js|webp|png|jpg|jpeg|svg|mp4|ico|woff2?))(?:\?[^"\']*)?["\']',
    re.I)


class Report(object):
    def __init__(self, quiet=False):
        self.rows = []
        self.quiet = quiet

    def add(self, level, area, message, detail=''):
        self.rows.append({'level': level, 'area': area, 'message': message, 'detail': detail})
        if not self.quiet:
            mark = {'ok': '  ok  ', 'warn': ' WARN ', 'fail': ' FAIL '}[level]
            line = '%s %-18s %s' % (mark, area, message)
            if detail:
                line += '\n' + ''.join('              %s\n' % d for d in detail.splitlines()).rstrip()
            print(line)
            sys.stdout.flush()

    def count(self, level):
        return sum(1 for r in self.rows if r['level'] == level)


def fetch(url, want_body=True):
    """Returns (status, body, seconds). status is None when the request never landed."""
    req = Request(url, headers={'User-Agent': UA, 'Cache-Control': 'no-cache', 'Pragma': 'no-cache'})
    t0 = time.time()
    try:
        with urlopen(req, timeout=TIMEOUT) as r:
            body = r.read() if want_body else b''
            return r.getcode(), body, time.time() - t0
    except HTTPError as e:
        try:
            body = e.read()
        except Exception:
            body = b''
        return e.code, body, time.time() - t0
    except (URLError, socket.timeout, ssl.SSLError, OSError) as e:
        return None, str(e).encode('utf-8', 'replace'), time.time() - t0


def bust(url):
    sep = '&' if '?' in url else '?'
    return '%s%shc=%d' % (url, sep, int(time.time() * 1000) % 100000000)


# ---------------------------------------------------------------- the checks

def check_pages(base, rep):
    bodies = {}
    for path in PAGES:
        code, body, secs = fetch(bust(base + path))
        if code != 200:
            rep.add('fail', 'page', '%s did not load' % path, 'status: %s' % code)
            continue
        html = body.decode('utf-8', 'replace')
        # A byte floor was the first instinct and it was wrong: the confirmation pages are
        # deliberately spare, and /scholarship/received/ is a legitimate 1.3KB. What actually
        # distinguishes a real page from a truncated one or an error page is whether it is
        # whole -- a title at the top and a closed document at the bottom.
        if '</html>' not in html.lower() or '<title' not in html.lower():
            rep.add('fail', 'page', '%s came back incomplete' % path,
                    '%d bytes, no title or unterminated document' % len(body))
            continue
        bodies[path] = html
        if secs > 6:
            rep.add('warn', 'page', '%s is slow' % path, '%.1f seconds' % secs)
    if len(bodies) == len(PAGES):
        rep.add('ok', 'page', 'all %d pages load' % len(PAGES))
    return bodies


def check_assets(base, bodies, rep):
    """Every stylesheet, script, image and video a page asks for must exist.

    This is the one that catches a half-bumped cache stamp, which is otherwise invisible
    until somebody sees an unstyled page."""
    seen, missing, checked = set(), [], 0
    for path, html in sorted(bodies.items()):
        for raw in ASSET_RE.findall(html):
            if raw.startswith(('http://', 'https://', 'data:', '//')):
                continue                                   # third-party is not ours to police
            url = urljoin(base + path, raw)
            if url in seen:
                continue
            seen.add(url)
            checked += 1
            code, _, _ = fetch(bust(url), want_body=False)
            if code != 200:
                missing.append('%s  (asked for by %s)  status %s' % (urlparse(url).path, path, code))
    if missing:
        rep.add('fail', 'asset', '%d of %d referenced files are missing' % (len(missing), checked),
                '\n'.join(missing[:20]))
    else:
        rep.add('ok', 'asset', 'all %d referenced files resolve' % checked)


def check_apis(base, rep):
    state = {}
    for path, keys in APIS:
        code, body, _ = fetch(bust(base + path))
        if code != 200:
            rep.add('fail', 'api', '%s did not answer' % path, 'status: %s' % code)
            continue
        try:
            data = json.loads(body.decode('utf-8', 'replace'))
        except ValueError:
            rep.add('fail', 'api', '%s did not return JSON' % path,
                    body[:160].decode('utf-8', 'replace'))
            continue
        gone = [k for k in keys if k not in data]
        if gone:
            rep.add('fail', 'api', '%s is missing fields' % path, 'absent: %s' % ', '.join(gone))
        else:
            rep.add('ok', 'api', '%s answers correctly' % path)
        if path.endswith('pc-vote.php'):
            state = data
    return state


def check_voting(state, rep):
    """The ballot's own invariants. A null deadline does not close voting -- it removes the
    closing time, so voting runs forever. That has to be loud."""
    if not state:
        return
    if state.get('state') not in ('coming-soon', 'open', 'closed', 'results'):
        rep.add('fail', 'voting', 'the voting state is not one this site knows',
                'state: %r' % state.get('state'))
    deadline = state.get('deadline')
    if deadline is None:
        if state.get('state') == 'open':
            rep.add('fail', 'voting', 'voting is open with no deadline set',
                    'nothing will close it; set a deadline in the People\'s Choice admin')
        else:
            rep.add('warn', 'voting', 'no deadline is set', 'state is %r' % state.get('state'))
        return
    try:
        dt = datetime.strptime(deadline[:19], '%Y-%m-%dT%H:%M:%S')
    except ValueError:
        rep.add('fail', 'voting', 'the deadline is not a date this script can read', repr(deadline))
        return
    # open must agree with the clock, allowing a minute either side of the cutoff
    offset = deadline[19:] or '+00:00'
    try:
        sign = 1 if offset[0] == '+' else -1
        utc_dt = dt - sign * timedelta(hours=int(offset[1:3]), minutes=int(offset[4:6]))
    except (ValueError, IndexError):
        utc_dt = dt
    now = utcnow()
    should_be_open = now < utc_dt
    is_open = bool(state.get('open'))
    if abs((utc_dt - now).total_seconds()) > 120 and should_be_open != is_open:
        rep.add('fail', 'voting', 'open does not match the deadline',
                'open=%s, deadline %s, now %sZ' % (is_open, deadline, now.strftime('%Y-%m-%dT%H:%M:%S')))
    else:
        when = 'closes' if should_be_open else 'closed'
        rep.add('ok', 'voting', 'state %r, open=%s, %s %s'
                % (state.get('state'), is_open, when, deadline))


def check_robots(base, indexable, rep):
    code, body, _ = fetch(bust(base + '/robots.txt'))
    if code != 200:
        rep.add('warn', 'robots', 'robots.txt did not load', 'status: %s' % code)
        return
    text = body.decode('utf-8', 'replace')
    blanket = re.search(r'^\s*Disallow:\s*/\s*$', text, re.M) is not None
    if indexable and blanket:
        rep.add('fail', 'robots', 'production is telling search engines to stay out')
    elif not indexable and not blanket:
        rep.add('fail', 'robots', 'staging is NOT disallowed and could be indexed')
    else:
        rep.add('ok', 'robots', 'indexing rule is right for this site')


def check_certificate(base, rep):
    host = urlparse(base).hostname
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=TIMEOUT) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ss:
                cert = ss.getpeercert()
        expires = datetime.strptime(cert['notAfter'], '%b %d %H:%M:%S %Y %Z')
        days = (expires - utcnow()).days
        if days < 7:
            rep.add('fail', 'certificate', 'expires in %d days' % days, cert['notAfter'])
        elif days < 21:
            rep.add('warn', 'certificate', 'expires in %d days' % days, cert['notAfter'])
        else:
            rep.add('ok', 'certificate', 'valid for another %d days' % days)
    except Exception as e:
        rep.add('warn', 'certificate', 'could not be checked', str(e))


def check_content(base, bodies, rep):
    for path, needles, label in CONTENT:
        html = bodies.get(path)
        if html is None:
            continue                                    # already reported as a failed page
        gone = [n for n in needles if n.lower() not in html.lower()]
        if gone:
            rep.add('fail', 'content', '%s is missing something it should have' % label,
                    'not found: %s' % ', '.join(repr(g) for g in gone))
        else:
            rep.add('ok', 'content', '%s reads correctly' % label)


def check_drift(name, rep):
    """Has somebody edited the live server by hand? tools/check-drift.py already answers
    this properly; it is called rather than reimplemented."""
    try:
        p = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'tools', 'check-drift.py'), name],
                           cwd=ROOT, capture_output=True, text=True, timeout=600)
    except Exception as e:
        rep.add('warn', 'drift', 'the drift check could not run', str(e))
        return
    out = (p.stdout or '') + (p.stderr or '')
    if 'has nothing this repository lacks' in out:
        rep.add('ok', 'drift', 'the server matches the repository')
    elif 'DIFFERENT ON THE LIVE SITE' in out or 'STOPPED' in out:
        lines = [l for l in out.splitlines() if l.strip().startswith('/') or 'live ' in l]
        rep.add('fail', 'drift', 'the live server holds something the repository does not',
                '\n'.join(lines[:12]) + '\n(somebody may have edited the server directly -- '
                'a deploy would revert it)')
    else:
        rep.add('warn', 'drift', 'the drift check gave an answer this script did not expect',
                out.strip()[-400:])


# ---------------------------------------------------------------- running it

def run(name, rep):
    t = TARGETS[name]
    print('\n=== %s  (%s) ===' % (name, t['base']))
    bodies = check_pages(t['base'], rep)
    check_content(t['base'], bodies, rep)
    check_assets(t['base'], bodies, rep)
    state = check_apis(t['base'], rep)
    check_voting(state, rep)
    check_robots(t['base'], t['indexable'], rep)
    check_certificate(t['base'], rep)
    check_drift(name, rep)


def main(argv):
    which = argv[1] if len(argv) > 1 else 'both'
    if which not in ('production', 'staging', 'both'):
        print(__doc__)
        return 2
    quiet = '--quiet' in argv
    out_json = None
    if '--json' in argv:
        out_json = argv[argv.index('--json') + 1]

    names = ['production', 'staging'] if which == 'both' else [which]
    rep = Report(quiet=quiet)
    started = datetime.now()
    print('NextGen Summit health check  %s' % started.strftime('%Y-%m-%d %H:%M'))
    for n in names:
        run(n, rep)

    fails, warns = rep.count('fail'), rep.count('warn')
    print('\n%s' % ('-' * 64))
    if fails:
        print('%d FAILED, %d warning(s), %d passed.' % (fails, warns, rep.count('ok')))
        print('\nWhat failed:')
        for r in rep.rows:
            if r['level'] == 'fail':
                print('  * [%s] %s' % (r['area'], r['message']))
    elif warns:
        print('No failures. %d warning(s), %d passed.' % (warns, rep.count('ok')))
    else:
        print('All %d checks passed. The site is behaving.' % rep.count('ok'))

    if out_json:
        d = os.path.dirname(os.path.abspath(out_json))
        if d and not os.path.isdir(d):
            os.makedirs(d)
        with open(out_json, 'w', encoding='utf-8', newline='\n') as f:
            json.dump({'started': started.isoformat(timespec='seconds'),
                       'targets': names,
                       'passed': rep.count('ok'), 'warnings': warns, 'failures': fails,
                       'rows': rep.rows}, f, indent=2)
        print('\nreport written to %s' % out_json)
    return 1 if fails else 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv))
    except KeyboardInterrupt:
        sys.exit(2)
