"""Refuse to release anything that would overwrite work only the live site has.

    python -I tools/check-drift.py production
    python -I tools/check-drift.py staging

tools/release.py runs this before it builds. It can also be run on its own, any time,
to answer "is the repo behind the server?"

WHY THIS EXISTS

A deploy sends the repository's idea of the site to the server. When somebody has edited
the live site directly -- and on this project they do -- the repository is behind, and the
next release silently reverts their work. It has happened repeatedly, it is invisible at
the moment it happens, and it is only noticed later when a feature is "mysteriously gone".

On 25 October 2026 a release was one command away from reverting a whole walkthrough-video
feature that was live and not in the repository at all: seven asset files plus a 9.5 MB
video. Nothing in the tooling would have objected.

So the rule is no longer written down. It is enforced:

    NOTHING IS RELEASED WHILE THE LIVE SITE HAS CONTENT THE REPOSITORY LACKS.

WHAT IT CHECKS

For every page the repository knows how to serve, it fetches the live copy and compares.
Then it reads every asset those live pages reference and checks each one exists in the
repository with identical bytes.

Two kinds of finding, and both stop a build:

    MISSING   live has a file the repository does not. A deploy either deletes it or
              orphans it, and either way the page that references it breaks.
    DIFFERS   live and the repository both have it, and they are not the same. A deploy
              overwrites the live one. If the live one is newer, that work is gone.

It cannot tell which side is NEWER -- that needs a human. What it can do is refuse to let
the question go unasked.

CACHE

Every request carries Cache-Control: no-cache and a random query string, because a CDN
will happily answer with last week's copy and make the site look identical to a repository
that is days behind. That has also already happened here.
"""
import io
import os
import subprocess
import random
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'public')

HOSTS = {
    'production': 'https://nextgensummit.us',
    'staging': 'https://staging.nextgensummit.us',
}

# Served by PHP from another file's markup, so the repository has no page of its own for
# them. entrant.php reuses pitch/peoples-choice/index.html; comparing a contestant page
# against that file would report a difference that is not drift.
SERVED_BY_PHP = ('pitch/peoples-choice/entrant.php',)

SKIP_ASSET = ('.mp4', '.webm', '.mov')   # fetched by HEAD only; see below

# The branch each site is released from. The comparison is against THIS, not against the
# working tree: a working tree that is ahead is simply unreleased work, which is normal and
# not drift. Drift is the live site holding something the released branch never had.
BRANCH = {'production': 'main', 'staging': 'monday-launch'}

# Every page asks for its CSS and JS with ?v=<stamp>, and the stamp moves on every release.
# Comparing it would report every file as different the moment a stamp is bumped, which is
# noise that would train everybody to ignore this tool.
STAMP = re.compile(rb'\?v=[0-9A-Za-z.-]+')


def unstamp(b):
    return STAMP.sub(b'?v=', b)


def at_branch(ref, path):
    """The file as the released branch has it, or None if the branch lacks it."""
    try:
        out = subprocess.run(['git', 'show', '%s:public/%s' % (ref, path)],
                             cwd=ROOT, capture_output=True)
        return out.stdout if out.returncode == 0 else None
    except Exception:                                         # noqa: BLE001
        return None


def get(url, head=False):
    """Fetch, defeating every cache between here and the disk."""
    sep = '&' if '?' in url else '?'
    url = url + sep + 'cb=' + str(random.randint(10 ** 8, 10 ** 9))
    req = urllib.request.Request(url, method='HEAD' if head else 'GET')
    req.add_header('Cache-Control', 'no-cache')
    req.add_header('Pragma', 'no-cache')
    req.add_header('User-Agent', 'nextgen-drift-check')
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status, (b'' if head else r.read()), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, b'', {}
    except Exception as e:                                    # noqa: BLE001
        return 0, str(e).encode(), {}


def pages():
    """Every page the repository can serve, as (repo path, url path)."""
    out = []
    for base, dirs, files in os.walk(PUBLIC):
        dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', 'resumes', 'data', 'api')]
        for f in files:
            if f != 'index.html':
                continue
            rel = os.path.relpath(os.path.join(base, f), PUBLIC).replace(os.sep, '/')
            url = rel[:-len('index.html')]
            out.append((rel, '/' + url))
    return sorted(out)


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else ''
    if target not in HOSTS:
        print('usage: python -I tools/check-drift.py production|staging')
        return 2
    host = HOSTS[target]
    ref = BRANCH[target]

    print('checking %s against %s, the branch it is released from' % (host, ref))
    print('(a CDN will lie about this, so every request is cache-busted)\n')

    missing, differs, unreachable = [], [], []
    seen_assets = set()

    for rel, url in pages():
        status, body, _ = get(host + url)
        if status != 200:
            unreachable.append('%s (HTTP %s)' % (url, status))
            continue
        theirs = at_branch(ref, rel)
        if theirs is None:
            missing.append('%s   (page is live and not on %s)' % (url, ref))
        elif unstamp(theirs) != unstamp(body):
            differs.append('%s   live %db / %s %db' % (url, len(body), ref, len(theirs)))

        # every asset the LIVE page references, which is the set that matters
        for m in re.finditer(rb'(?:src|href|data-film-src|data-film-poster)="([^"]*/assets/[^"?]*)',
                             body):
            a = m.group(1).decode('utf-8', 'replace').lstrip('/')
            if a.startswith('assets/'):
                seen_assets.add(a)

    for a in sorted(seen_assets):
        local = os.path.join(PUBLIC, a)
        if at_branch(ref, a) is None and not os.path.isfile(local):
            status, _, _ = get(host + '/' + a, head=True)
            missing.append('%s   (live: HTTP %s)' % (a, status))
            continue
        if a.endswith(SKIP_ASSET):
            # a byte compare means downloading tens of megabytes; size is enough to notice
            status, _, hdr = get(host + '/' + a, head=True)
            theirs = at_branch(ref, a)
            live_len = int(hdr.get('Content-Length') or 0)
            if theirs is None:
                missing.append('%s   (live, and not on %s)' % (a, ref))
            elif live_len and live_len != len(theirs):
                differs.append('%s   live %db / %s %db' % (a, live_len, ref, len(theirs)))
            continue
        status, body, _ = get(host + '/' + a)
        if status != 200:
            unreachable.append('%s (HTTP %s)' % (a, status))
            continue
        theirs = at_branch(ref, a)
        if theirs is None:
            missing.append('%s   (live, and not on %s)' % (a, ref))
        elif unstamp(theirs) != unstamp(body):
            differs.append('%s   live %db / %s %db' % (a, len(body), ref, len(theirs)))

    print('%d pages, %d assets checked\n' % (len(pages()), len(seen_assets)))

    if missing:
        print('ONLY ON THE LIVE SITE -- a release deletes or orphans these:')
        for m in missing:
            print('   ' + m)
        print()
    if differs:
        print('DIFFERENT ON THE LIVE SITE -- a release overwrites these:')
        for d in differs:
            print('   ' + d)
        print()
    if unreachable:
        print('could not be checked:')
        for u in unreachable:
            print('   ' + u)
        print()

    if missing or differs:
        print('STOPPED: the live site has content this repository does not.')
        print()
        print('  Pull it down and commit it before releasing, or the release reverts it:')
        print('    python -I tools/pull-live.py %s          # fetch them into the tree' % target)
        print('    git diff                                     # read what came back')
        print('    git add -A public && git commit && git push')
        print()
        print('  Nothing here can tell which side is newer. That is a judgement, and it is')
        print('  yours -- but it has to be made, rather than skipped by a deploy.')
        return 1

    print('OK: the live site has nothing this repository lacks.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
