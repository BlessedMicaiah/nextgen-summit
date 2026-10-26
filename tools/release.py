"""Builds the Hostinger upload for the live site or the staging (review) site.

    python tools/release.py production   -> release/nextgensummit.us-<commit>.zip   (from main)
    python tools/release.py staging      -> release/staging-<commit>.zip           (from monday-launch)

Rule: nothing is released that is not on GitHub. The build stops unless the right branch is
checked out, the working tree is clean, and the branch is identical to origin (pushed).

The zip holds the contents of public/ at its top level, with api/config.php (private, never
committed) and without any stored submissions. The staging build also:
  - disallows all crawlers in robots.txt and drops sitemap.xml,
  - sends X-Robots-Tag: noindex on every response,
  - keeps its own submissions in nextgen-data-staging, beside the live data, outside the web root.
"""
import hashlib
import io
import os
import re
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'public')
BRANCH = {'production': 'main', 'staging': 'monday-launch'}
SKIP_EXT = ('.sqlite', '.jsonl', '.sqlite-journal', '.db')

STAGING_HTACCESS = (
    '\n# review site: never indexed\n'
    '<IfModule mod_headers.c>\n'
    '  Header always set X-Robots-Tag "noindex, nofollow, noarchive"\n'
    '</IfModule>\n'
)
STAGING_CONFIG = (
    "\n// review site only: its own data folder beside the live one, outside the web root\n"
    "define('NGS_DATA_DIR', dirname(__DIR__, 3) . '/nextgen-data-staging');\n"
)


def git(*args):
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()


def stop(msg):
    print('STOPPED: ' + msg)
    sys.exit(1)


def drift_gate(target):
    """Refuse to build while the live site holds work the released branch does not.

    THE RULE, ENFORCED RATHER THAN WRITTEN DOWN

    A deploy sends this repository's idea of the site to the server. People edit the live
    site directly on this project, so the repository is routinely behind -- and a release
    then silently reverts their work. It is invisible when it happens, and only noticed
    later as a feature that "disappeared".

    On 25 October 2026 a release was one command from reverting a whole walkthrough-video
    feature: a page, twelve stylesheets, a pile of images and a 9.5 MB video, none of it in
    the repository. Nothing in this tool would have objected, because the rule was a
    sentence in a document. It is a check now.

    It can be overridden, because an emergency release against a knowingly stale repository
    is a real situation. The flag is deliberately long to type, and it says what it skipped:

        python -I tools/release.py production --i-have-reconciled-drift
    """
    if '--i-have-reconciled-drift' in sys.argv:
        print('WARNING: the drift check was skipped by hand.')
        print('         If the live site holds anything this branch lacks, this release reverts it.')
        return

    check = os.path.join(ROOT, 'tools', 'check-drift.py')
    if not os.path.isfile(check):
        stop('tools/check-drift.py is missing, and it is required before a release.')

    print('checking the live site for work this branch does not have...')
    r = subprocess.run([sys.executable, '-I', check, target], cwd=ROOT)
    if r.returncode == 1:
        stop('the live site holds content this branch lacks (listed above).' + '\n'
             + '  Pull it down and decide, rather than releasing over it:' + '\n'
             + '    python -I tools/pull-live.py ' + target + '\n'
             + '  Or, having already reconciled it by hand:' + '\n'
             + '    python -I tools/release.py ' + target + ' --i-have-reconciled-drift')
    if r.returncode not in (0, 1):
        stop('the drift check could not run (exit %s). Fix it rather than skipping it.' % r.returncode)



def stale_stamp():
    """Refuse to build if the assets changed but the cache stamp did not.

    Every page asks for its CSS and JS with ?v=<stamp>. Visitors and the CDN key on
    that string, so shipping changed assets under an unchanged stamp means new markup
    arriving with the previous stylesheet -- a site that is visibly broken for anyone
    who has been here before, and fine for everyone who has not, which is the worst
    kind of bug to be told about.

    It is an easy mistake: bump the stamp once, keep editing, deploy. It happened
    during the launch pass and cost a round trip to notice. So the build checks rather
    than trusting anyone to remember.

    The check: hash every file under public/assets, and keep that hash in
    tools/.asset-stamp beside the stamp it belongs to. If the hash moved and the stamp
    did not, say so and name the fix.
    """
    stamp = None
    for page in ('index.html', os.path.join('pitch', 'peoples-choice', 'index.html')):
        f = os.path.join(PUBLIC, page)
        if not os.path.isfile(f):
            continue
        # The stamp is <date>-<build>, and the build part is not always digits: the
        # review site uses s01, s02, s03... A pattern of \d+ therefore matched nothing
        # on staging, stamp stayed None, and this whole guard returned at the 'no stamp
        # scheme here' branch below -- silently inert for every review build it was
        # meant to police. Found by audit on 2026-10-25.
        m = re.search(r'\?v=(\d{8}-[A-Za-z0-9]+)', io.open(f, encoding='utf-8').read())
        if m:
            stamp = m.group(1)
            break
    if not stamp:
        return None                      # no stamp scheme here; nothing to police

    h = hashlib.sha256()
    assets = os.path.join(PUBLIC, 'assets')
    for base, dirs, files in os.walk(assets):
        dirs.sort()
        for f in sorted(files):
            if f.endswith(SKIP_EXT):
                continue
            path = os.path.join(base, f)
            rel = os.path.relpath(path, assets).replace(os.sep, '/')
            h.update(rel.encode('utf-8'))
            with open(path, 'rb') as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b''):
                    h.update(chunk)
    digest = h.hexdigest()

    record = os.path.join(ROOT, 'tools', '.asset-stamp')
    was = io.open(record, encoding='utf-8').read().split() if os.path.isfile(record) else []
    if len(was) == 2 and was[1] != digest and was[0] == stamp:
        return '\n'.join([
            'the assets changed but the cache stamp did not.',
            f'  stamp is still {stamp}, and public/assets no longer hashes to what it did.',
            '  Bump the stamp across public/ (one pass over html/php/js/css), commit, push,',
            '  and build again. Shipping now would hand new markup to cached stylesheets.',
        ])
    io.open(record, 'w', encoding='utf-8', newline='\n').write(stamp + ' ' + digest + '\n')
    return None


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else ''
    if target not in BRANCH:
        stop('say which site: python tools/release.py production|staging')
    branch = BRANCH[target]

    if git('rev-parse', '--abbrev-ref', 'HEAD') != branch:
        stop(f'{target} is built from {branch}; check it out first.')
    if git('status', '--porcelain', '--untracked-files=all', '--', 'public', 'tools'):
        stop('uncommitted changes. Commit them and push to GitHub first.')
    git('fetch', '--quiet', 'origin', branch)
    head, remote = git('rev-parse', 'HEAD'), git('rev-parse', f'origin/{branch}')
    if head != remote:
        stop(f'{branch} is not identical to GitHub ({head[:7]} here, {remote[:7]} on GitHub). Push first.')
    if not os.path.isfile(os.path.join(PUBLIC, 'api', 'config.php')):
        stop('public/api/config.php is missing (private settings, never committed).')

    stale = stale_stamp()
    if stale:
        stop(stale)

    drift_gate(target)

    os.makedirs(os.path.join(ROOT, 'release'), exist_ok=True)
    name = ('nextgensummit.us' if target == 'production' else 'staging') + f'-{head[:7]}.zip'
    out = os.path.join(ROOT, 'release', name)
    count = 0
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, dirs, files in os.walk(PUBLIC):
            dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', 'resumes')]
            for f in files:
                # the Twilio secrets live on the server only; never carry them in a build
                if f == 'config.twilio.php':
                    continue
                if f.endswith(SKIP_EXT):
                    continue
                full = os.path.join(base, f)
                rel = os.path.relpath(full, PUBLIC).replace(os.sep, '/')
                if target == 'staging' and rel == 'sitemap.xml':
                    continue
                data = open(full, 'rb').read()
                if target == 'staging':
                    if rel == 'robots.txt':
                        data = b'User-agent: *\nDisallow: /\n'
                    elif rel == '.htaccess':
                        data = data.rstrip(b'\n') + b'\n' + STAGING_HTACCESS.encode()
                    elif rel == 'api/config.php':
                        data = data.rstrip(b'\n') + b'\n' + STAGING_CONFIG.encode()
                z.writestr(rel, data)
                count += 1
    print(f'{target}: {count} files from {branch} @ {head[:7]} (identical to GitHub) -> {out}')


if __name__ == '__main__':
    main()
