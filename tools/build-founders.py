"""Turn the Top 20 public manifest into site assets and one public-safe data file.

Run:  python -I tools/build-founders.py <manifest.json>

What it does, and deliberately nothing more:

  - downloads each founder's submitted image, resizes it and writes WebP into
    public/assets/img/founders/
  - works out what each "pitch video" submission ACTUALLY is, because the column labels in
    the source sheet are not reliable: several are PDFs, one is a .docx holding a YouTube
    link, two are Google Drive files, and three PDFs have a YouTube URL in the filename
  - writes public/assets/js/pc-founders.js, which sets window.NGS_FOUNDERS

What it never writes: an email address, a phone number, a vote, or a contestant id. The
mapping from founder to entrant-NN lives in tools/founder-map.json and is reviewed by a
human; this script reads it and refuses to invent one.

Downloads land in a directory of their own and are only ever read as bytes.
"""
import io
import json
import os
import re
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMGDIR = os.path.join(ROOT, 'public', 'assets', 'img', 'founders')
JSOUT = os.path.join(ROOT, 'public', 'assets', 'js', 'pc-founders.js')
MAPFILE = os.path.join(ROOT, 'tools', 'founder-map.json')
CACHE = os.path.join(ROOT, 'release', '_founder-src')      # not shipped; release zips public/

UA = 'Mozilla/5.0 (compatible; NextGenSummitBuild/1.0)'
LONG_EDGE = 1100
QUALITY = 82


def slugify(s):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', s.lower())).strip('-')


def fetch(url, limit=None):
    r = urllib.request.Request(url)
    r.add_header('User-Agent', UA)
    with urllib.request.urlopen(r, timeout=90) as resp:
        return resp.read(limit) if limit else resp.read()


def sniff(b):
    if b[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if b[:3] == b'\xff\xd8\xff':
        return 'jpeg'
    if b[:4] == b'RIFF' and b[8:12] == b'WEBP':
        return 'webp'
    if b[:4] == b'%PDF':
        return 'pdf'
    if b[4:8] == b'ftyp':
        return 'video'
    if b[:2] == b'PK':
        return 'docx'
    if b[:5].lower() in (b'<?xml', b'<!doc') or b[:5].lower().startswith(b'<htm'):
        return 'html'
    return 'unknown'


YT = re.compile(r'(?:youtube\.com/shorts/|youtu\.be[/_]|youtube\.com/watch\?v=|'
                r'youtube\.comshorts)([A-Za-z0-9_-]{11})')
DRIVE = re.compile(r'drive\.google\.com/file/d/([A-Za-z0-9_-]{10,})')


def resolve_pitch(url, cached):
    """What IS this submission? Returns (kind, ref, note)."""
    if not url:
        return ('none', None, 'no pitch submitted')

    m = DRIVE.search(url)
    if m:
        # Drive serves a viewer page; /preview embeds the file itself.
        title = ''
        try:
            html = fetch(url, 60000).decode('utf-8', 'replace')
            t = re.search(r'<title>(.*?)</title>', html, re.S)
            title = t.group(1).strip().replace(' - Google Drive', '') if t else ''
            if 'ServiceLogin' in html or 'accounts.google.com/v3/signin' in html:
                return ('unavailable', None, 'Google Drive file needs sign-in')
        except Exception as e:
            return ('unavailable', None, 'Drive unreachable: ' + type(e).__name__)
        return ('drive', m.group(1), 'Google Drive: ' + (title or 'file'))

    # A YouTube link hidden in the FILENAME, which is how three of these arrived.
    m = YT.search(url.rsplit('/', 1)[-1])
    if m:
        return ('youtube', m.group(1), 'YouTube id recovered from the submitted filename')

    kind = sniff(cached[:2048]) if cached else 'unknown'
    if kind == 'video':
        return ('file', url, 'direct video file')
    if kind == 'docx':
        try:
            z = zipfile.ZipFile(io.BytesIO(cached))
            blob = z.read('word/document.xml').decode('utf-8', 'replace')
            try:
                blob += z.read('word/_rels/document.xml.rels').decode('utf-8', 'replace')
            except KeyError:
                pass
            m = YT.search(blob)
            if m:
                return ('youtube', m.group(1), 'YouTube link found inside the .docx')
        except Exception:
            pass
        return ('document', None, 'a .docx with no resolvable video link')
    if kind == 'pdf':
        return ('document', None, 'a PDF, not a video')
    if kind in ('png', 'jpeg', 'webp'):
        return ('image', None, 'an image was submitted where a video was expected')
    return ('unavailable', None, 'unrecognised submission (' + kind + ')')


def main():
    manifest = sys.argv[1] if len(sys.argv) > 1 else None
    if not manifest or not os.path.isfile(manifest):
        sys.exit('usage: python -I tools/build-founders.py <manifest.json>')
    data = json.load(io.open(manifest, encoding='utf-8'))

    mapping, reviewed = {}, False
    if os.path.isfile(MAPFILE):
        _mf = json.load(io.open(MAPFILE, encoding='utf-8'))
        mapping = _mf.get('map', {})
        reviewed = bool(_mf.get('reviewed'))

    os.makedirs(IMGDIR, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    from PIL import Image

    out = []
    issues = []
    for c in data['contestants']:
        slug = slugify(c['business_name'])
        rec = {
            'slug': slug,
            'name': c['founder_name'],
            'company': c['business_name'],
            'blurb': c['about_business'],
            'sheet_row': c['sheet_row'],
            'entrant': mapping.get(slug),          # None until a human reviews the mapping
            'shot': None,
            'shotFit': 'cover',
            'video': None,
        }

        # ---- image ----
        iu = c.get('image_source_url')
        if iu:
            raw = None
            cpath = os.path.join(CACHE, slug + '.src')
            if os.path.isfile(cpath):
                raw = open(cpath, 'rb').read()
            else:
                try:
                    raw = fetch(iu)
                    open(cpath, 'wb').write(raw)
                except Exception as e:
                    issues.append((c['business_name'], 'image', 'download failed: '
                                   + type(e).__name__))
            if raw:
                k = sniff(raw)
                if k in ('png', 'jpeg', 'webp'):
                    try:
                        im = Image.open(io.BytesIO(raw))
                        im = im.convert('RGBA') if im.mode in ('RGBA', 'LA', 'P') else im.convert('RGB')
                        w, h = im.size
                        if max(w, h) > LONG_EDGE:
                            s = LONG_EDGE / float(max(w, h))
                            im = im.resize((int(w * s), int(h * s)), Image.LANCZOS)
                        dest = os.path.join(IMGDIR, slug + '.webp')
                        im.save(dest, 'WEBP', quality=QUALITY, method=6)
                        rec['shot'] = '/assets/img/founders/' + slug + '.webp'
                        # a logo wants whitespace around it; a photograph wants to fill
                        fname = iu.rsplit('/', 1)[-1].lower()
                        logo = any(t in fname for t in ('logo', 'branding', 'brand'))
                        rec['shotFit'] = 'contain' if logo else 'cover'
                        rec['shotW'], rec['shotH'] = im.size
                    except Exception as e:
                        issues.append((c['business_name'], 'image',
                                       'could not process: ' + type(e).__name__))
                else:
                    issues.append((c['business_name'], 'image',
                                   'submitted as ' + k + ', not an image'))
        else:
            issues.append((c['business_name'], 'image', 'none submitted'))

        # ---- pitch ----
        pu = c.get('pitch_source_url')
        pcache = None
        if pu and 'drive.google.com' not in pu:
            cpath = os.path.join(CACHE, slug + '.pitch')
            if os.path.isfile(cpath):
                pcache = open(cpath, 'rb').read()
            else:
                try:
                    pcache = fetch(pu, 4096)
                    # a .docx is a zip: the central directory is at the END, so 4 KB of it
                    # parses as nothing. Fetch the whole file for the types that need it.
                    if sniff(pcache) == 'docx':
                        pcache = fetch(pu)
                    open(cpath, 'wb').write(pcache)
                except Exception:
                    pcache = None
        kind, ref, note = resolve_pitch(pu, pcache)
        if kind == 'file':
            rec['video'] = {'type': 'file', 'src': ref}
        elif kind == 'youtube':
            rec['video'] = {'type': 'youtube', 'id': ref}
        elif kind == 'drive':
            rec['video'] = {'type': 'drive', 'id': ref}
        if kind not in ('file', 'youtube', 'drive'):
            issues.append((c['business_name'], 'pitch', note))
        rec['pitchNote'] = note
        out.append(rec)

    body = ('/* Generated by tools/build-founders.py from the Top 20 public manifest.\n'
            '   Public fields only: no email address, no phone number, no private data.\n'
            '   Edit the manifest or tools/founder-map.json and re-run; do not hand-edit. */\n'
            'window.NGS_FOUNDER_MAP_REVIEWED = '
            + ('true' if reviewed else 'false') + ';\n'
            'window.NGS_FOUNDERS = ' + json.dumps(out, indent=2, ensure_ascii=False) + ';\n')
    io.open(JSOUT, 'w', encoding='utf-8', newline='\n').write(body)

    print('wrote %s (%d founders)' % (os.path.relpath(JSOUT, ROOT), len(out)))
    print('images: %d of %d' % (sum(1 for r in out if r['shot']), len(out)))
    print('playable pitches: %d of %d' % (sum(1 for r in out if r['video']), len(out)))
    mapped = sum(1 for r in out if r['entrant'])
    print('mapped to a contestant id: %d of %d%s'
          % (mapped, len(out), '  <-- NOT MAPPED, voting stays on placeholders'
             if mapped == 0 else ''))
    if issues:
        print('\nissues needing a human:')
        for b, what, why in issues:
            print('  %-26s %-6s %s' % (b[:25], what, why))


if __name__ == '__main__':
    main()
