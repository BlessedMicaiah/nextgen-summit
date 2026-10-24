"""Download, verify, organise and archive the Top 20 media submissions. Local only.

  python tools/fetch-top20-media.py docs/top20-public-manifest.json

Output: %USERPROFILE%\\Downloads\\NextGen_Top20_Media\\
          NN_Business_Name/ images/ videos/ source_documents/
          NN_Business_Name.zip
          NextGen_Top20_Media_ALL.zip
          download_report.csv
          download_summary.txt

WHY THE MANIFEST AND NOT THE SHEET
The manifest was generated from a live read of the Top 20 tab and carries the resolved
hyperlink targets -- the thing a CSV export drops. It also omits the applicants' email
addresses and phone numbers by construction, so no private column can leak into a filename,
a ZIP or the report. Reading the Sheet again would need a Google sign-in and would put those
columns back in reach for no gain. Pass --sheet-note to print what a Sheet re-read would add.

WHAT IT DOES NOT DO
No upload, no website change, no edit to the source Sheet, no credential handling. It only
reads public URLs and writes under Downloads. Nothing is renamed to pretend it is a video:
a PDF stays a PDF, and a pitch that is not a video is reported as one that is not a video.
"""
import csv
import io
import json
import os
import re
import shutil
import ssl
import struct
import sys
import time
import urllib.error
import urllib.request
import zipfile

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NextGenSummitAssetFetch/1.0'
ROOT = os.path.join(os.path.expanduser('~'), 'Downloads', 'NextGen_Top20_Media')
RETRIES = 3
BACKOFF = 2.5
CHUNK = 1 << 16

YT = re.compile(r'(?:youtube\.com/shorts/|youtu\.be[/_]|youtube\.com/watch\?v=|'
                r'youtube\.comshorts)([A-Za-z0-9_-]{11})')
DRIVE = re.compile(r'drive\.google\.com/file/d/([A-Za-z0-9_-]{10,})')
CTX = ssl.create_default_context()


# ----------------------------------------------------------------- small helpers

def safe(s, maxlen=60):
    s = re.sub(r"[^A-Za-z0-9]+", '_', (s or '').strip())
    return re.sub(r'_+', '_', s).strip('_')[:maxlen] or 'unnamed'


def sniff(b):
    """What the bytes actually are. The column label is not evidence."""
    if b[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png', 'image/png'
    if b[:3] == b'\xff\xd8\xff':
        return 'jpg', 'image/jpeg'
    if b[:4] == b'RIFF' and b[8:12] == b'WEBP':
        return 'webp', 'image/webp'
    if b[:6] in (b'GIF87a', b'GIF89a'):
        return 'gif', 'image/gif'
    if b[:4] == b'%PDF':
        return 'pdf', 'application/pdf'
    if b[4:8] == b'ftyp':
        brand = b[8:12]
        return ('mov', 'video/quicktime') if brand[:4] == b'qt  ' else ('mp4', 'video/mp4')
    if b[:4] == b'\x1aE\xdf\xa3':
        return 'webm', 'video/webm'
    if b[:2] == b'PK':
        return 'docx', 'application/zip'
    low = b[:400].lower()
    if low.startswith(b'<!doc') or low.startswith(b'<html') or b'<html' in low:
        return 'html', 'text/html'
    return 'bin', 'application/octet-stream'


def req(url, extra=None):
    r = urllib.request.Request(url)
    r.add_header('User-Agent', UA)
    r.add_header('Accept', '*/*')
    for k, v in (extra or {}).items():
        r.add_header(k, v)
    return r


def fetch_bytes(url, limit=None, extra=None):
    with urllib.request.urlopen(req(url, extra), timeout=90, context=CTX) as resp:
        return resp.read(limit) if limit else resp.read(), resp.geturl(), dict(resp.headers)


def download(url, dest, note):
    """Stream to disk with bounded retries. Returns (ok, resolved_url, bytes, err)."""
    last = ''
    for attempt in range(1, RETRIES + 1):
        tmp = dest + '.part'
        try:
            with urllib.request.urlopen(req(url), timeout=180, context=CTX) as resp:
                final = resp.geturl()
                total = 0
                with open(tmp, 'wb') as fh:
                    while True:
                        chunk = resp.read(CHUNK)
                        if not chunk:
                            break
                        fh.write(chunk)
                        total += len(chunk)
                        if total % (4 << 20) < CHUNK:
                            print('      %s  %.1f MB' % (note, total / 1048576), flush=True)
            if total == 0:
                last = 'empty response'
                os.remove(tmp)
            else:
                os.replace(tmp, dest)
                return True, final, total, ''
        except urllib.error.HTTPError as e:
            last = 'HTTP %s' % e.code
            if e.code in (401, 403, 404):
                break                      # not transient; retrying is just noise
        except Exception as e:
            last = type(e).__name__ + ': ' + str(e)[:80]
        finally:
            if os.path.isfile(dest + '.part'):
                try:
                    os.remove(dest + '.part')
                except OSError:
                    pass
        if attempt < RETRIES:
            time.sleep(BACKOFF * attempt)
    return False, url, 0, last


# ----------------------------------------------------------------- media inspection

def mp4_info(path):
    """Duration and pixel size, read from the MP4/MOV atoms.

    ffprobe is not installed on this machine, and an unverified 'it downloaded' is exactly
    the claim this script is supposed to avoid making. Parsing mvhd and tkhd is enough to
    prove the container holds a real, timed video track of a stated size.
    """
    try:
        size = os.path.getsize(path)
        with open(path, 'rb') as fh:
            dur, scale, w, h = None, None, None, None

            def walk(end, depth=0):
                nonlocal dur, scale, w, h
                while fh.tell() < end and depth < 6:
                    head = fh.read(8)
                    if len(head) < 8:
                        return
                    ln = struct.unpack('>I', head[:4])[0]
                    typ = head[4:8]
                    start = fh.tell()
                    if ln == 1:
                        ln = struct.unpack('>Q', fh.read(8))[0] - 8
                        start = fh.tell()
                    elif ln == 0:
                        ln = end - start + 8
                    body = ln - 8
                    if typ in (b'moov', b'trak', b'mdia'):
                        walk(start + body, depth + 1)
                    elif typ == b'mvhd':
                        d = fh.read(min(body, 32))
                        ver = d[0]
                        if ver == 1 and len(d) >= 28:
                            scale = struct.unpack('>I', d[20:24])[0]
                            dur = struct.unpack('>Q', d[24:32])[0] if len(d) >= 32 else None
                        elif len(d) >= 20:
                            scale = struct.unpack('>I', d[12:16])[0]
                            dur = struct.unpack('>I', d[16:20])[0]
                    elif typ == b'tkhd':
                        d = fh.read(min(body, 92))
                        if len(d) >= 84:
                            off = 88 if d[0] == 1 else 76
                            if len(d) >= off + 8:
                                tw = struct.unpack('>I', d[off:off + 4])[0] >> 16
                                th = struct.unpack('>I', d[off + 4:off + 8])[0] >> 16
                                if tw and th and not w:
                                    w, h = tw, th
                    fh.seek(start + body)

            walk(size)
            secs = round(dur / scale, 1) if dur and scale else None
            return {'duration_s': secs, 'width': w, 'height': h,
                    'orientation': (None if not (w and h) else
                                    'portrait' if h > w else
                                    'landscape' if w > h else 'square')}
    except Exception as e:
        return {'error': type(e).__name__ + ': ' + str(e)[:60]}


def image_info(path):
    try:
        from PIL import Image
        with Image.open(path) as im:
            im.verify()
        with Image.open(path) as im:
            return {'width': im.width, 'height': im.height, 'format': im.format}
    except Exception as e:
        return {'error': type(e).__name__ + ': ' + str(e)[:60]}


def links_in_document(path, kind):
    """Pull any external video link out of a PDF or .docx, without executing anything."""
    out = set()
    try:
        if kind == 'docx':
            with zipfile.ZipFile(path) as z:
                for nm in ('word/document.xml', 'word/_rels/document.xml.rels'):
                    try:
                        out |= set(re.findall(r'https?://[^\s<>"\']+',
                                              z.read(nm).decode('utf-8', 'replace')))
                    except KeyError:
                        pass
        else:
            raw = open(path, 'rb').read()
            txt = raw.decode('latin-1', 'replace')
            out |= set(re.findall(r'https?://[^\s<>()\]\[]{6,}', txt))
    except Exception:
        pass
    # the filename itself has carried the link more than once in this dataset
    out |= set(re.findall(r'https?://[^\s]+', os.path.basename(path)))
    return sorted(u.rstrip('.,);') for u in out if 'youtu' in u or 'vimeo' in u or 'drive.' in u)


def drive_direct(file_id):
    """Google's own download endpoint, with the large-file confirm step. No permission is
    bypassed: a file that is not shared still answers with its sign-in page, and that is
    reported as inaccessible."""
    base = 'https://drive.google.com/uc?export=download&id=' + file_id
    try:
        data, final, hdrs = fetch_bytes(base, limit=200000)
    except Exception as e:
        return None, 'drive probe failed: ' + type(e).__name__
    kind, _ = sniff(data)
    if kind != 'html':
        return base, ''
    txt = data.decode('utf-8', 'replace')
    if 'accounts.google.com' in txt and 'signin' in txt:
        return None, 'Drive file is not publicly shared (sign-in required)'
    m = (re.search(r'confirm=([0-9A-Za-z_-]+)', txt)
         or re.search(r'name="confirm"\s+value="([^"]+)"', txt))
    if m:
        return base + '&confirm=' + m.group(1), ''
    m = re.search(r'href="(/uc\?export=download[^"]+)"', txt)
    if m:
        return 'https://drive.google.com' + m.group(1).replace('&amp;', '&'), ''
    return None, 'Drive returned a page, not a file'


# ----------------------------------------------------------------- the run

def main():
    if '--sheet-note' in sys.argv:
        print(__doc__)
        return
    mpath = next((a for a in sys.argv[1:] if a.endswith('.json')), None)
    if not mpath or not os.path.isfile(mpath):
        sys.exit('usage: python tools/fetch-top20-media.py <manifest.json>')
    data = json.load(io.open(mpath, encoding='utf-8'))
    contestants = data['contestants']

    free = shutil.disk_usage(os.path.dirname(ROOT) or 'C:/').free
    print('NextGen Top 20 media fetch')
    print('  output : %s' % ROOT)
    print('  free   : %.1f GB' % (free / 1024 ** 3))
    print('  ffprobe: not installed - MP4 atoms are parsed directly instead')
    print('  records: %d' % len(contestants))
    print()
    os.makedirs(ROOT, exist_ok=True)

    rows = []
    tally = {'images': 0, 'videos': 0, 'docs': 0, 'img_missing': 0, 'vid_missing': 0,
             'zips': 0, 'review': 0, 'skipped': 0}

    for idx, c in enumerate(contestants, start=1):
        biz = c['business_name']
        folder = os.path.join(ROOT, '%02d_%s' % (idx, safe(biz)))
        dirs = {k: os.path.join(folder, k) for k in ('images', 'videos', 'source_documents')}
        for d in dirs.values():
            os.makedirs(d, exist_ok=True)
        print('[%02d/%d] %s' % (idx, len(contestants), biz), flush=True)

        jobs = [('image', c.get('image_source_url')), ('pitch', c.get('pitch_source_url'))]
        for category, url in jobs:
            row = {
                'number': idx, 'business': biz, 'founder': c['founder_name'],
                'category': category, 'source_url': url or '', 'resolved_url': '',
                'original_filename': os.path.basename((url or '').split('?')[0]),
                'local_filename': '', 'actual_type': '', 'bytes': '', 'status': '',
                'failure_reason': '', 'playable_video': 'no', 'manual_action': '',
                'media_details': '',
            }
            if not url:
                row['status'] = 'missing'
                row['failure_reason'] = 'no link in the submission'
                row['manual_action'] = 'ask the founder for a ' + category
                tally['img_missing' if category == 'image' else 'vid_missing'] += 1
                rows.append(row)
                print('   %-6s  (nothing submitted)' % category)
                continue

            fetch_url, note = url, ''
            m = DRIVE.search(url)
            if m:
                fetch_url, note = drive_direct(m.group(1))
                row['resolved_url'] = fetch_url or ''
                if not fetch_url:
                    row['status'] = 'failed'
                    row['failure_reason'] = note
                    row['manual_action'] = 'ask the founder to share the Drive file publicly'
                    tally['vid_missing' if category == 'pitch' else 'img_missing'] += 1
                    rows.append(row)
                    print('   %-6s  FAILED  %s' % (category, note))
                    continue

            stem = 'business_logo_or_headshot' if category == 'image' else 'pitch_video'
            tmp = os.path.join(folder, stem + '.download')

            # a pitch may land as pitch_video.mp4 OR pitch_submission.pdf, so resume has to
            # look for both names or it downloads the document again every run 
            stems = (stem,) if category == 'image' else (stem, 'pitch_submission')
            existing = [os.path.join(d, f) for d in dirs.values()
                        for f in sorted(os.listdir(d)) if f.startswith(stems)]
            if existing and os.path.getsize(existing[0]) > 0:
                dest = existing[0]
                ok, final, size = True, row['resolved_url'] or url, os.path.getsize(dest)
                print('   %-6s  kept (already downloaded) %s' % (category, os.path.basename(dest)))
                tally['skipped'] += 1
            else:
                ok, final, size, err = download(fetch_url, tmp, category)
                if not ok:
                    row['status'] = 'failed'
                    row['failure_reason'] = err
                    row['manual_action'] = 'retry, or request the file from the founder'
                    tally['img_missing' if category == 'image' else 'vid_missing'] += 1
                    rows.append(row)
                    print('   %-6s  FAILED  %s' % (category, err))
                    continue
                head = open(tmp, 'rb').read(4096)
                ext, mime = sniff(head)
                if ext == 'html':
                    os.remove(tmp)
                    row['status'] = 'failed'
                    row['failure_reason'] = 'served an HTML page, not a file'
                    row['manual_action'] = 'check sharing permissions on the link'
                    tally['img_missing' if category == 'image' else 'vid_missing'] += 1
                    rows.append(row)
                    print('   %-6s  FAILED  HTML page, not a file' % category)
                    continue
                bucket = ('images' if ext in ('png', 'jpg', 'webp', 'gif')
                          else 'videos' if ext in ('mp4', 'mov', 'webm')
                          else 'source_documents')
                name = {'images': 'business_logo_or_headshot',
                        'videos': 'pitch_video',
                        'source_documents': 'pitch_submission'}[bucket] + '.' + ext
                dest = os.path.join(dirs[bucket], name)
                n = 2
                while os.path.exists(dest):
                    dest = os.path.join(dirs[bucket], name.rsplit('.', 1)[0]
                                        + '_%d.%s' % (n, ext))
                    n += 1
                os.replace(tmp, dest)
                row['resolved_url'] = final if final != url else row['resolved_url']

            ext, mime = sniff(open(dest, 'rb').read(4096))
            row['local_filename'] = os.path.relpath(dest, ROOT)
            row['actual_type'] = ext
            row['bytes'] = os.path.getsize(dest)
            row['status'] = 'ok'

            if ext in ('png', 'jpg', 'webp', 'gif'):
                info = image_info(dest)
                row['media_details'] = json.dumps(info)
                if 'error' in info:
                    row['status'] = 'corrupt'
                    row['failure_reason'] = info['error']
                    tally['img_missing'] += 1
                else:
                    tally['images'] += 1
                    print('   %-6s  ok  %s  %sx%s' % (category, ext, info['width'], info['height']))
            elif ext in ('mp4', 'mov', 'webm'):
                info = mp4_info(dest) if ext in ('mp4', 'mov') else {}
                row['media_details'] = json.dumps(info)
                playable = bool(info.get('duration_s')) and bool(info.get('width'))
                row['playable_video'] = 'yes' if playable else 'unverified'
                if playable:
                    tally['videos'] += 1
                    print('   %-6s  ok  %s  %sx%s  %ss  %s'
                          % (category, ext, info['width'], info['height'],
                             info['duration_s'], info['orientation']))
                else:
                    row['manual_action'] = 'container parsed but no timed track found; check by hand'
                    print('   %-6s  ok  %s  (could not confirm a video track)' % (category, ext))
            else:
                tally['docs'] += 1
                found = links_in_document(dest, ext)
                row['media_details'] = json.dumps({'links_found': found})
                row['status'] = 'ok (not a video)'
                row['failure_reason'] = 'submitted as %s in the Pitch Video column' % ext
                if found:
                    row['manual_action'] = ('video link found, needs review: ' + '; '.join(found))
                    tally['review'] += 1
                    print('   %-6s  %s  -> link inside: %s' % (category, ext, found[0]))
                else:
                    row['manual_action'] = 'no video link inside; ask the founder for a pitch video'
                    tally['vid_missing'] += 1
                    print('   %-6s  %s  (no video link inside)' % (category, ext))
            rows.append(row)

        # ---- per-contestant archive ----
        zpath = os.path.join(ROOT, '%02d_%s.zip' % (idx, safe(biz)))
        files = [os.path.join(dp, f) for dp, _, fn in os.walk(folder) for f in fn]
        if files:
            with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
                for f in files:
                    z.write(f, os.path.relpath(f, ROOT))
            with zipfile.ZipFile(zpath) as z:
                bad = z.testzip()
            if bad is None and len(files) == len(zipfile.ZipFile(zpath).namelist()):
                tally['zips'] += 1
                print('   zip     %s (%d files)' % (os.path.basename(zpath), len(files)))
            else:
                print('   zip     FAILED verification for %s' % os.path.basename(zpath))
        else:
            print('   zip     skipped (no files downloaded)')
        print()

    # ---- report ----
    rep = os.path.join(ROOT, 'download_report.csv')
    cols = ['number', 'business', 'founder', 'category', 'source_url', 'resolved_url',
            'original_filename', 'local_filename', 'actual_type', 'bytes', 'status',
            'failure_reason', 'playable_video', 'manual_action', 'media_details']
    with io.open(rep, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow(r)

    master = os.path.join(ROOT, 'NextGen_Top20_Media_ALL.zip')
    total_bytes = sum(int(r['bytes']) for r in rows if str(r['bytes']).isdigit())
    if free > total_bytes * 3:
        with zipfile.ZipFile(master, 'w', zipfile.ZIP_DEFLATED) as z:
            for dp, _, fn in os.walk(ROOT):
                if os.path.basename(dp) == os.path.basename(ROOT):
                    continue
                for f in fn:
                    p = os.path.join(dp, f)
                    z.write(p, os.path.relpath(p, ROOT))
        with zipfile.ZipFile(master) as z:
            ok = z.testzip() is None
        print('master zip: %s (%s)' % (os.path.basename(master), 'verified' if ok else 'FAILED'))

    lines = [
        'NextGen Summit 2026 - People\'s Choice Top 20 media fetch',
        '=' * 58,
        'contestants processed      : %d' % len(contestants),
        'images downloaded and read : %d' % tally['images'],
        'playable videos verified   : %d' % tally['videos'],
        'supporting documents saved : %d' % tally['docs'],
        'images missing/unreadable  : %d' % tally['img_missing'],
        'pitch videos not obtained  : %d' % tally['vid_missing'],
        'documents with a video link to review : %d' % tally['review'],
        'files kept from a previous run        : %d' % tally['skipped'],
        'per-contestant zips verified          : %d' % tally['zips'],
        '',
        'Needs a human:',
    ]
    for r in rows:
        if r['manual_action']:
            lines.append('  %02d %-26s %-6s %s'
                         % (r['number'], r['business'][:25], r['category'], r['manual_action']))
    lines += ['', 'No email address or phone number is written to any file here.',
              'ffprobe/ffmpeg are not installed, so codec inspection and any re-encoding',
              'remain outstanding; MP4 duration and pixel size were read from the container.']
    txt = '\n'.join(lines)
    io.open(os.path.join(ROOT, 'download_summary.txt'), 'w',
            encoding='utf-8', newline='\n').write(txt + '\n')
    print()
    print(txt)
    print()
    print('report: %s' % rep)


if __name__ == '__main__':
    main()
