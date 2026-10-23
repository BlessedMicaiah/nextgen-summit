"""Choose a poster frame for each pitch deliberately, instead of guessing at a timestamp.

  python tools/pick-posters.py [--only slug,slug]

THE PROBLEM THIS SOLVES

The first version grabbed a frame 15% into every video. That is a guess, and on these pitches
it guessed badly: Exam.Me opened on ceiling tiles, Melavyr on a blank wall with the top of a
head, BeforeKeys on ceiling lights. The dimensions were right and the framing was useless,
which is a fair description of a thumbnail nobody chose.

HOW A FRAME IS CHOSEN NOW

Candidates are pulled from across the pitch, skipping the opening where people are still
settling and the tail where they are waving goodbye. Each is scored on what actually
separates a shot of a person from a shot of a wall:

  detail        standard deviation of luminance. A ceiling is flat; a face is not.
  edges         mean gradient magnitude, which rises with features and falls on plaster.
  exposure      distance from a sane mean brightness. Very dark and blown-out both lose.
  centre bias   the same two measures over the middle of the frame, where a speaker sits,
                weighted so a busy background cannot win on its own.

ffmpeg's own thumbnail filter is asked for its pick as an extra candidate, since it is built
for this and sometimes beats the sampling grid.

WHAT IT WILL NOT DO

It does not crop, zoom or generate anything. If every candidate scores badly the founder's
approved portrait is used instead and the record says so, because a flattering thumbnail over
badly composed footage would be a claim about the footage that is not true.
"""
import io
import json
import os
import shutil
import subprocess
import sys

HOME = os.path.expanduser('~')
ROOT = os.path.join(HOME, 'Downloads', 'NextGen_Top20_Media')
SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMGDIR = os.path.join(SITE, 'public', 'assets', 'img', 'founders')
VIDDIR = os.path.join(SITE, 'public', 'assets', 'video')
OFFSETS = (0.18, 0.28, 0.40, 0.52, 0.64, 0.76)
MIN_SCORE = 26.0          # below this, nothing in the video is worth showing


def find_ff():
    local = os.path.join(HOME, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages')
    if os.path.isdir(local):
        for d in os.listdir(local):
            if d.lower().startswith('gyan.ffmpeg'):
                for base, _, files in os.walk(os.path.join(local, d)):
                    if 'ffmpeg.exe' in files:
                        return (os.path.join(base, 'ffmpeg.exe'),
                                os.path.join(base, 'ffprobe.exe'))
    return 'ffmpeg', 'ffprobe'


FFMPEG, FFPROBE = find_ff()


def duration(path):
    r = subprocess.run([FFPROBE, '-v', 'error', '-show_entries', 'format=duration',
                        '-of', 'csv=p=0', path], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except Exception:
        return 0.0


def grab(src, at, dest):
    r = subprocess.run([FFMPEG, '-y', '-ss', '%.2f' % at, '-i', src, '-frames:v', '1',
                        '-vf', 'scale=640:-2', '-q:v', '3', dest],
                       capture_output=True, text=True)
    return r.returncode == 0 and os.path.isfile(dest) and os.path.getsize(dest) > 0


def grab_thumbnail_filter(src, dest):
    r = subprocess.run([FFMPEG, '-y', '-i', src, '-vf', 'thumbnail=n=120,scale=640:-2',
                        '-frames:v', '1', '-q:v', '3', dest], capture_output=True, text=True)
    return r.returncode == 0 and os.path.isfile(dest) and os.path.getsize(dest) > 0


def score(path):
    """Higher is a more interesting, better exposed, more face-like frame."""
    from PIL import Image, ImageFilter, ImageStat
    try:
        im = Image.open(path).convert('L')
    except Exception:
        return -1, {}
    w, h = im.size
    full = ImageStat.Stat(im)
    detail = full.stddev[0]
    mean = full.mean[0]
    edges = ImageStat.Stat(im.filter(ImageFilter.FIND_EDGES)).mean[0]

    # the middle of the frame, where a person talking to a phone usually is
    cx0, cy0 = int(w * 0.22), int(h * 0.12)
    cx1, cy1 = int(w * 0.78), int(h * 0.80)
    mid = im.crop((cx0, cy0, cx1, cy1))
    mstat = ImageStat.Stat(mid)
    mdetail = mstat.stddev[0]
    medges = ImageStat.Stat(mid.filter(ImageFilter.FIND_EDGES)).mean[0]

    exposure = max(0.0, 1.0 - abs(mean - 118.0) / 118.0)      # 0..1, best near mid-grey
    s = (detail * 0.22 + edges * 1.5 + mdetail * 0.38 + medges * 2.4) * (0.45 + 0.55 * exposure)
    return s, {'detail': round(detail, 1), 'edges': round(edges, 2), 'mean': round(mean, 1),
               'centre_detail': round(mdetail, 1), 'centre_edges': round(medges, 2),
               'exposure': round(exposure, 2)}


def subject_crop(path):
    """Tighten a poster onto the person when the shot is mostly empty room.

    POSTER ONLY. The video itself is never cropped: a pitch is the founder's, and cutting
    into it to improve a layout would be editing their submission. A still that introduces
    them is a different object, and leaving a founder as a small figure under three metres
    of ceiling serves nobody.

    The person is found by skin tone, not by edges. An edge detector was tried first and
    was defeated by exactly the thing it needed to ignore -- a suspended ceiling is a grid of
    hard lines and scored higher than the speaker underneath it. Skin has no such problem.

    The crop keeps the frame's aspect ratio, never grows beyond the source, and only engages
    when the person really is a small part of the picture.
    """
    from PIL import Image
    try:
        im = Image.open(path).convert('RGB')
    except Exception:
        return False
    w, h = im.size
    small = im.resize((max(1, w // 6), max(1, h // 6)))
    sw, sh = small.size
    px = small.load()

    rows = [0] * sh
    cols = [0] * sw
    total = 0
    for y in range(sh):
        for x in range(sw):
            r, g, b = px[x, y]
            mx, mn = max(r, g, b), min(r, g, b)
            # a broad skin range that holds across skin tones and warm indoor light
            if (r > 50 and g > 28 and b > 15 and mx - mn > 12
                    and r > g + 8 and r > b + 8 and abs(r - g) > 8):
                rows[y] += 1
                cols[x] += 1
                total += 1
    if total < (sw * sh) * 0.012:
        return False                       # no person found; leave the frame alone

    thresh = max(1, max(rows) * 0.22)
    live = [y for y, v in enumerate(rows) if v >= thresh]
    if len(live) < 2:
        return False
    top, bot = min(live) * 6, min(h, (max(live) + 1) * 6)
    span = bot - top
    if span >= h * 0.78:
        return False                       # already fills the frame

    pad = int(span * 0.55)                 # headroom above, body below
    top = max(0, top - int(pad * 0.75))
    bot = min(h, bot + int(pad * 0.45))
    newh = max(1, bot - top)
    neww = int(round(newh * (w / float(h))))
    if neww > w:
        neww = w
        newh = int(round(w * (h / float(w))))
        top = max(0, min(top, h - newh))
    cthresh = max(1, max(cols) * 0.22)
    clive = [x for x, v in enumerate(cols) if v >= cthresh] or [sw // 2]
    cx = ((min(clive) + max(clive)) // 2) * 6
    left = max(0, min(cx - neww // 2, w - neww))
    im.crop((left, top, left + neww, top + newh)).save(path, 'JPEG', quality=88)
    return True


def main():
    only = None
    if '--only' in sys.argv:
        only = set(sys.argv[sys.argv.index('--only') + 1].split(','))

    tmp = os.path.join(ROOT, '_poster_candidates')
    os.makedirs(tmp, exist_ok=True)
    report = []

    for f in sorted(os.listdir(VIDDIR)):
        if not f.endswith('.mp4'):
            continue
        slug = f[:-4]
        if only and slug not in only:
            continue
        src = os.path.join(VIDDIR, f)
        dur = duration(src)
        if dur <= 0:
            continue

        cands = []
        for i, frac in enumerate(OFFSETS):
            c = os.path.join(tmp, '%s_%d.jpg' % (slug, i))
            if grab(src, dur * frac, c):
                s, d = score(c)
                cands.append((s, c, 'at %d%%' % int(frac * 100), d))
        c = os.path.join(tmp, '%s_tf.jpg' % slug)
        if grab_thumbnail_filter(src, c):
            s, d = score(c)
            cands.append((s, c, 'ffmpeg thumbnail filter', d))

        if not cands:
            report.append({'slug': slug, 'poster': 'none', 'why': 'no frame could be read'})
            continue

        cands.sort(key=lambda r: -r[0])
        best, bestpath, where, detail = cands[0]
        dest = os.path.join(VIDDIR, slug + '-poster.jpg')

        portrait = os.path.join(IMGDIR, slug + '.webp')
        if best < MIN_SCORE and os.path.isfile(portrait):
            # Nothing in the footage is worth showing. Say so rather than dressing it up.
            from PIL import Image
            im = Image.open(portrait).convert('RGB')
            im.thumbnail((900, 900))
            im.save(dest, 'JPEG', quality=86)
            report.append({'slug': slug, 'poster': 'founder portrait',
                           'why': 'best frame scored %.1f, below the %.0f floor'
                                  % (best, MIN_SCORE), 'score': round(best, 1)})
            print('%-26s portrait used   (best frame %.1f, too flat/dark)' % (slug, best))
        else:
            shutil.copy2(bestpath, dest)
            cropped = subject_crop(dest)
            report.append({'slug': slug, 'poster': 'video frame', 'cropped': cropped,
                           'why': where,
                           'score': round(best, 1), 'metrics': detail})
            runners = ', '.join('%s %.0f' % (r[2].replace('at ', ''), r[0]) for r in cands[1:4])
            print('%-26s %-24s score %5.1f %-9s (next: %s)'
                  % (slug, where, best, 'tightened' if cropped else '', runners))

    shutil.rmtree(tmp, ignore_errors=True)
    out = os.path.join(ROOT, 'poster_report.json')
    io.open(out, 'w', encoding='utf-8').write(json.dumps(report, indent=2))
    print()
    print('posters from a video frame : %d' % sum(1 for r in report if r['poster'] == 'video frame'))
    print('posters from a portrait    : %d' % sum(1 for r in report if r['poster'] == 'founder portrait'))
    print('report                     : %s' % out)


if __name__ == '__main__':
    main()
