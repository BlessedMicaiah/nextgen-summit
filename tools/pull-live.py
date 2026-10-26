"""Bring the live site's own work down into the repository, so a release stops reverting it.

    python -I tools/pull-live.py production
    python -I tools/pull-live.py staging

tools/check-drift.py tells you the live site has something the repository lacks. This
fetches those files into the working tree and leaves them UNCOMMITTED, so the next thing
you do is read `git diff` and decide.

IT DOES NOT DECIDE FOR YOU

Nothing here knows which side is newer. The live file may be a feature somebody shipped
directly and the repository has never seen -- in which case keep it. Or the repository may
hold a deliberate change that has not been released yet -- in which case `git checkout` the
file and release as planned. Both happen on this project, often in the same pull.

What this removes is the third option, which is the only dangerous one: releasing without
having looked.

A pulled file is written exactly as the server sent it. Nothing is reformatted, no cache
stamp is rewritten, no line ending is translated -- a byte-for-byte copy is the only
honest starting point for "is this newer than ours?".
"""
import io
import os
import random
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'public')

HOSTS = {
    'production': 'https://nextgensummit.us',
    'staging': 'https://staging.nextgensummit.us',
}
BRANCH = {'production': 'main', 'staging': 'monday-launch'}
STAMP = re.compile(rb'\?v=[0-9A-Za-z.-]+')


def unstamp(b):
    return STAMP.sub(b'?v=', b)


def get(url):
    sep = '&' if '?' in url else '?'
    req = urllib.request.Request(url + sep + 'cb=' + str(random.randint(10 ** 8, 10 ** 9)))
    req.add_header('Cache-Control', 'no-cache')
    req.add_header('Pragma', 'no-cache')
    req.add_header('User-Agent', 'nextgen-pull-live')
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b''
    except Exception as e:                                    # noqa: BLE001
        return 0, str(e).encode()


def at_branch(ref, path):
    out = subprocess.run(['git', 'show', '%s:public/%s' % (ref, path)],
                         cwd=ROOT, capture_output=True)
    return out.stdout if out.returncode == 0 else None


def pages():
    out = []
    for base, dirs, files in os.walk(PUBLIC):
        dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', 'resumes', 'data', 'api')]
        for f in files:
            if f != 'index.html':
                continue
            rel = os.path.relpath(os.path.join(base, f), PUBLIC).replace(os.sep, '/')
            out.append((rel, '/' + rel[:-len('index.html')]))
    return sorted(out)


def write(rel, body):
    path = os.path.join(PUBLIC, rel.replace('/', os.sep))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as fh:
        fh.write(body)


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else ''
    if target not in HOSTS:
        print('usage: python -I tools/pull-live.py production|staging')
        return 2
    host, ref = HOSTS[target], BRANCH[target]
    print('pulling what %s has and %s does not\n' % (host, ref))

    pulled, assets = [], set()

    for rel, url in pages():
        status, body = get(host + url)
        if status != 200:
            print('  skipped %s (HTTP %s)' % (url, status))
            continue
        for m in re.finditer(rb'(?:src|href|data-film-src|data-film-poster)="([^"]*/assets/[^"?]*)', body):
            a = m.group(1).decode('utf-8', 'replace').lstrip('/')
            if a.startswith('assets/'):
                assets.add(a)
        theirs = at_branch(ref, rel)
        if theirs is None or unstamp(theirs) != unstamp(body):
            write(rel, body)
            pulled.append('%s   (%d bytes)' % (rel, len(body)))

    for a in sorted(assets):
        status, body = get(host + '/' + a)
        if status != 200:
            continue
        theirs = at_branch(ref, a)
        local = os.path.join(PUBLIC, a.replace('/', os.sep))
        same_local = os.path.isfile(local) and open(local, 'rb').read() == body
        if theirs is None:
            if not same_local:
                write(a, body)
                pulled.append('%s   (%d bytes, NEW -- not in %s at all)' % (a, len(body), ref))
        elif unstamp(theirs) != unstamp(body):
            write(a, body)
            pulled.append('%s   (%d bytes)' % (a, len(body)))

    if not pulled:
        print('nothing to pull: %s has nothing %s lacks.' % (host, ref))
        return 0

    print('pulled %d file(s) into the working tree:\n' % len(pulled))
    for p in pulled:
        print('   ' + p)
    print()
    print('NOTHING IS COMMITTED. Read them before you keep them:')
    print('   git diff --stat public')
    print('   git diff public/pitch            # or whichever looks surprising')
    print()
    print('Keep a file:     git add <path>')
    print('Discard a file:  git checkout -- <path>      (your version was the newer one)')
    print()
    print('Then commit, push, and release. tools/check-drift.py will confirm.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
