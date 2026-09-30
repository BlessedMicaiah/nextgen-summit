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
import os
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

    os.makedirs(os.path.join(ROOT, 'release'), exist_ok=True)
    name = ('nextgensummit.us' if target == 'production' else 'staging') + f'-{head[:7]}.zip'
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
