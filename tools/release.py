"""Builds the Hostinger upload for the live site or the staging (review) site.

    python tools/release.py production   -> release/nextgensummit.us-<commit>.zip   (from main)
    python tools/release.py staging      -> release/staging-<commit>.zip           (from monday-launch)
    python tools/release.py staging --overlay -> tracked files only; preserve server configuration

Rule: nothing is released that is not on GitHub. The build stops unless the right branch is
checked out, tracked changes are committed, and the branch matches the chosen remote (pushed).

The zip holds the contents of public/ at its top level, with api/config.php (private, never
committed) and without any stored submissions. The staging build also:
  - disallows all crawlers in robots.txt and drops sitemap.xml,
  - sends X-Robots-Tag: noindex on every response,
  - keeps its own submissions in nextgen-data-staging, beside the live data, outside the web root.
"""
import os
import argparse
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', choices=BRANCH)
    parser.add_argument('--overlay', action='store_true')
    parser.add_argument('--remote', default='origin', help='Git remote to verify (default: origin)')
    parser.add_argument('--remote-branch', help='Remote release branch (defaults to the local release branch)')
    args = parser.parse_args()
    target = args.target
    branch = BRANCH[target]
    overlay = args.overlay
    remote = args.remote
    remote_branch = args.remote_branch or branch
    if remote not in git('remote').splitlines():
        stop('choose a configured Git remote.')
    git('check-ref-format', 'refs/heads/' + remote_branch)
    if overlay and target != 'staging':
        stop('--overlay is only supported for staging.')

    if git('rev-parse', '--abbrev-ref', 'HEAD') != branch:
        stop(f'{target} is built from {branch}; check it out first.')
    if git('status', '--porcelain', '--untracked-files=no' if overlay else '--untracked-files=all', '--', 'public', 'tools'):
        stop('uncommitted changes. Commit them and push to GitHub first.')
    git('fetch', '--quiet', remote, remote_branch)
    head, remote_head = git('rev-parse', 'HEAD'), git('rev-parse', f'{remote}/{remote_branch}')
    if head != remote_head:
        stop(f'{branch} is not identical to GitHub ({head[:7]} here, {remote_head[:7]} on {remote}). Push first.')
    if not overlay and not os.path.isfile(os.path.join(PUBLIC, 'api', 'config.php')):
        stop('public/api/config.php is missing (private settings, never committed).')

    # An overlay is uploaded file by file without clearing the destination. Never
    # include local originals, private settings, or runtime data in that upload.
    tracked = set(git('ls-files', '-z', '--', 'public').split('\0')) if overlay else None

    os.makedirs(os.path.join(ROOT, 'release'), exist_ok=True)
    name = ('nextgensummit.us' if target == 'production' else 'staging') + f'-{head[:7]}' + ('-overlay' if overlay else '') + '.zip'
    out = os.path.join(ROOT, 'release', name)
    count = 0
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, dirs, files in os.walk(PUBLIC):
            dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', 'resumes')]
            for f in files:
                if f.endswith(SKIP_EXT):
                    continue
                full = os.path.join(base, f)
                rel = os.path.relpath(full, PUBLIC).replace(os.sep, '/')
                if overlay and (f'public/{rel}' not in tracked or rel == 'api/config.php' or
                                rel.startswith(('data/', 'api/resumes/'))):
                    continue
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
    if overlay:
        print('OVERLAY ONLY: upload individual files; do not replace/clear the site or use archive deployment. Existing config.php and runtime data must remain in place.')


if __name__ == '__main__':
    main()
