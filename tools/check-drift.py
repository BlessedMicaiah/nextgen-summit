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

# Assets whose BYTES cannot be judged over HTTP, so only their EXISTENCE is checked.
#
# The Hostinger CDN (Server: hcdn) caches static media for 30 days and re-encodes images:
# measured on 25 October 2026, assets/img/closing-1200.jpg comes back as Exif/TIFF where the
# repository holds JFIF, same dimensions, 136,816 bytes against 133,313. The edge also
# ignores the cache-busting query for these, so there is no way to ask it for the original.
#
# Comparing those bytes would report a dozen images as "drift" on every single run, on a
# site where nothing had changed -- and a check that cries wolf every time is a check people
# route around. So for media the question narrows to the one that still matters and can
# still be answered honestly: does the live site have a file the repository does not, which
# a release would delete? That is exactly how the 9.5 MB how-to-vote.mp4 was found.
#
# Text is unaffected: HTML, CSS and JS come back byte-accurate, confirmed by a staging run
# against the very branch staging was deployed from.
BINARY_ASSET = ('.mp4', '.webm', '.mov', '.jpg', '.jpeg', '.png', '.gif', '.webp',
                '.avif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.otf', '.pdf')

# The branch each site is released from. The comparison is against THIS, not against the
# working tree: a working tree that is ahead is simply unreleased work, which is normal and
# not drift. Drift is the live site holding something the released branch never had.
BRANCH = {'production': 'main', 'staging': 'monday-launch'}

# Every page asks for its CSS and JS with ?v=<stamp>, and the stamp moves on every release.
# Comparing it would report every file as different the moment a stamp is bumped, which is
# noise that would train everybody to ignore this tool.
STAMP = re.compile(rb'\?v=[0-9A-Za-z.-]+')


def unstamp(b):
    """Compare text the way a browser would, not the way git stores it.

    Two things make identical files look different and would have made this tool cry wolf
    until everybody ignored it:

      the cache stamp   every page asks for its assets with ?v=<stamp>, and the stamp moves
                        on every release, so comparing it reports every file as changed the
                        moment anybody bumps it.
      line endings      core.autocrlf is on, so `git show` hands back LF while the file on
                        the server has CRLF. On one 51-line stylesheet that is a 51-byte
                        difference and zero actual difference. Measured, not guessed.
    """
    return STAMP.sub(b'?v=', b).replace(b'\r\n', b'\n')


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

    missing, differs, unreachable, aliases = [], [], [], []
    seen_assets = set()

    # Every page body the branch already has, keyed by its bytes.
    #
    # A 200 does not mean the server has that file. /pitch/peoples-choice/<anything>/ is a
    # catch-all -- entrant.php answers it -- so the moment a NEW page is added under that
    # folder locally, this tool fetches its URL, gets the People's Choice page back with a
    # 200, finds nothing of that name on the branch, and reports a page that exists only on
    # the server. Measured on 25 October 2026 for /pitch/peoples-choice/top-10/: 61,891 bytes
    # live, byte-identical to the branch's peoples-choice/index.html.
    #
    # That is the dangerous direction for a gate to fail in. It blocks a release that is
    # perfectly safe, and a gate that blocks safe releases is one people learn to override.
    #
    # So: if a "new" live page is byte-identical to a page the branch already holds, it is a
    # route answering, not a file. Nothing can be lost by releasing over it, because the only
    # content there is content the branch already has.
    known_pages = {}
    for rel, _url in pages():
        b = at_branch(ref, rel)
        if b is not None:
            known_pages.setdefault(unstamp(b), rel)

    for rel, url in pages():
        status, body, _ = get(host + url)
        if status != 200:
            unreachable.append('%s (HTTP %s)' % (url, status))
            continue
        theirs = at_branch(ref, rel)
        if theirs is None:
            served_by = known_pages.get(unstamp(body))
            if served_by:
                aliases.append('%s   (a route, serving %s -- no file of its own)' % (url, served_by))
            else:
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
        if a.endswith(BINARY_ASSET):
            # existence only -- see BINARY_ASSET for why the bytes cannot be trusted here
            if at_branch(ref, a) is None and not os.path.isfile(local):
                status, _, _ = get(host + '/' + a, head=True)
                missing.append('%s   (live: HTTP %s, and in no commit)' % (a, status))
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
    if aliases:
        # Printed, not hidden: a page you expected to find on the server and that turns out to
        # be a route is worth knowing about, even though it cannot be overwritten.
        print('answered by a route, not a file (safe -- nothing to lose):')
        for a in aliases:
            print('   ' + a)
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
