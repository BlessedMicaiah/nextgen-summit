"""Make one web-delivery copy and a poster for each downloaded pitch. Originals untouched.

  python tools/optimize-pitch-videos.py

Reads   ~/Downloads/NextGen_Top20_Media/NN_Business/videos/pitch_video.*
Writes  ~/Downloads/NextGen_Top20_Media/NN_Business/optimized/pitch.mp4
                                                     /poster.jpg
                                                     /info.json
        ~/Downloads/NextGen_Top20_Media/media_manifest.csv

WHAT IT RE-ENCODES, AND WHAT IT LEAVES ALONE

All thirteen sources are already H.264 with AAC audio, so none of them *has* to be converted
to play in a browser. Re-encoding every one of them regardless would cost quality for
nothing. What justifies a pass is delivery size against the size the player actually draws:
the story stage is about 460px wide, so a 3840x2160 master and a 9.5 Mbps 720p file are
paying for pixels and bits nobody sees.

  re-encode  when the source is larger than the 1280px cap, or its bitrate is well above
             what the cap needs
  remux      when the source is already small enough but sits in a .mov container, which is
             a copy of the streams into .mp4 with no quality loss at all
  copy       when it is already an .mp4 of a sensible size

Nothing is upscaled. A 480x854 phone recording stays 480x854; pretending otherwise would
just make a bigger file that looks the same.

Aspect ratio is never altered: scale keeps it, and nothing is cropped or padded here. The
letterboxing is the player's job, where it can be done against a blurred backdrop instead of
being burned into the file.
"""
import csv
import io
import json
import os
import subprocess
import sys

HOME = os.path.expanduser('~')
ROOT = os.path.join(HOME, 'Downloads', 'NextGen_Top20_Media')
LONG_EDGE = 1280          # the story stage is ~460 CSS px; 1280 is still generous
CRF = 23
AUDIO_K = '128k'
POSTER_AT = 0.15          # 15% in, so a fade-from-black start does not become the poster


def find_ff():
    for probe in ('ffmpeg', 'ffprobe'):
        pass
    cands = []
    local = os.path.join(HOME, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages')
    if os.path.isdir(local):
        for d in os.listdir(local):
            if d.lower().startswith('gyan.ffmpeg'):
                for base, _, files in os.walk(os.path.join(local, d)):
                    if 'ffmpeg.exe' in files:
                        cands.append(base)
    for c in cands:
        return os.path.join(c, 'ffmpeg.exe'), os.path.join(c, 'ffprobe.exe')
    return 'ffmpeg', 'ffprobe'


FFMPEG, FFPROBE = find_ff()


def probe(path):
    out = subprocess.run(
        [FFPROBE, '-v', 'error', '-show_entries',
         'stream=codec_type,codec_name,width,height,bit_rate:format=duration,bit_rate,size',
         '-of', 'json', path], capture_output=True, text=True)
    try:
        j = json.loads(out.stdout)
    except Exception:
        return None
    v = next((s for s in j.get('streams', []) if s.get('codec_type') == 'video'), {})
    a = next((s for s in j.get('streams', []) if s.get('codec_type') == 'audio'), {})
    f = j.get('format', {})
    w, h = int(v.get('width') or 0), int(v.get('height') or 0)
    return {
        'vcodec': v.get('codec_name'), 'acodec': a.get('codec_name'),
        'width': w, 'height': h,
        'orientation': 'portrait' if h > w else 'landscape' if w > h else 'square',
        'duration_s': round(float(f.get('duration') or 0), 1),
        'bitrate_kbps': int(int(f.get('bit_rate') or 0) / 1000),
        'bytes': int(f.get('size') or 0),
    }


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode == 0, (r.stderr or '')[-400:]


def main():
    if not os.path.isdir(ROOT):
        sys.exit('media folder not found: ' + ROOT)
    print('ffmpeg : %s' % FFMPEG)
    print('source : %s' % ROOT)
    print()

    rows = []
    for d in sorted(os.listdir(ROOT)):
        folder = os.path.join(ROOT, d)
        vdir = os.path.join(folder, 'videos')
        if not os.path.isdir(vdir):
            continue
        srcs = [os.path.join(vdir, f) for f in sorted(os.listdir(vdir))
                if f.lower().endswith(('.mp4', '.mov', '.webm', '.m4v'))]
        if not srcs:
            continue
        src = srcs[0]
        info = probe(src)
        if not info or not info['width']:
            print('%-30s  UNREADABLE' % d[:29])
            continue

        odir = os.path.join(folder, 'optimized')
        os.makedirs(odir, exist_ok=True)
        dest = os.path.join(odir, 'pitch.mp4')
        poster = os.path.join(odir, 'poster.jpg')

        longest = max(info['width'], info['height'])
        over_size = longest > LONG_EDGE
        # what the cap would reasonably need, give or take; well above it means wasted bits
        budget = 1800 if longest > 900 else 1200
        over_rate = info['bitrate_kbps'] > budget * 1.6
        is_mp4 = src.lower().endswith('.mp4')

        if over_size or over_rate:
            action = 're-encode'
        elif not is_mp4:
            action = 'remux'
        else:
            action = 'copy'

        if os.path.isfile(dest) and os.path.getsize(dest) > 0:
            action = 'kept'

        if action == 're-encode':
            # -2 keeps the other edge even and PRESERVES the aspect ratio; no crop, no pad
            vf = ("scale='if(gt(iw,ih),min(%d,iw),-2)':'if(gt(iw,ih),-2,min(%d,ih))'"
                  % (LONG_EDGE, LONG_EDGE))
            # A cap, because CRF alone targets quality and will happily spend more bits
            # than the source did. Several of these were already efficiently encoded.
            cap = '1800k' if longest > 900 else '1200k'
            ok, err = run([FFMPEG, '-y', '-i', src, '-vf', vf,
                           '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.0',
                           '-preset', 'slow', '-crf', str(CRF),
                           '-maxrate', cap, '-bufsize', '3600k', '-pix_fmt', 'yuv420p',
                           '-c:a', 'aac', '-b:a', AUDIO_K, '-ac', '2',
                           '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
                           '-movflags', '+faststart', dest])

            # And a guard. If the pass produced a BIGGER file than it started with, it has
            # achieved nothing but a generation of quality loss, so throw it away and fall
            # back to a lossless container copy. Three of these grew on the first run.
            if ok and os.path.isfile(dest):
                grew = os.path.getsize(dest) >= info['bytes']
                if grew:
                    os.remove(dest)
                    action = 'remux (re-encode grew)' if not is_mp4 else 'copy (re-encode grew)'
                    ok, err = run([FFMPEG, '-y', '-i', src, '-c', 'copy',
                                   '-movflags', '+faststart', dest])
                    if not ok:
                        ok, err = run([FFMPEG, '-y', '-i', src, '-c:v', 'copy',
                                       '-c:a', 'aac', '-b:a', AUDIO_K,
                                       '-movflags', '+faststart', dest])
        elif action == 'remux':
            ok, err = run([FFMPEG, '-y', '-i', src, '-c', 'copy',
                           '-movflags', '+faststart', dest])
            if not ok:   # some .mov audio will not sit in mp4 untouched
                ok, err = run([FFMPEG, '-y', '-i', src, '-c:v', 'copy',
                               '-c:a', 'aac', '-b:a', AUDIO_K,
                               '-movflags', '+faststart', dest])
        elif action == 'copy':
            ok, err = run([FFMPEG, '-y', '-i', src, '-c', 'copy',
                           '-movflags', '+faststart', dest])
        else:
            ok, err = True, ''

        if not ok:
            print('%-30s  FAILED (%s) %s' % (d[:29], action, err.splitlines()[-1:]))
            rows.append({'folder': d, 'status': 'failed', 'action': action, 'error': err[-180:]})
            continue

        at = max(0.5, info['duration_s'] * POSTER_AT)
        if not (os.path.isfile(poster) and os.path.getsize(poster) > 0):
            run([FFMPEG, '-y', '-ss', '%.2f' % at, '-i', dest, '-frames:v', '1',
                 '-vf', 'scale=640:-2', '-q:v', '3', poster])

        after = probe(dest) or {}
        rec = {
            'folder': d,
            'action': action,
            'source_file': os.path.basename(src),
            'before_bytes': info['bytes'], 'after_bytes': after.get('bytes', 0),
            'before': '%dx%d %dkbps' % (info['width'], info['height'], info['bitrate_kbps']),
            'after': '%sx%s %skbps' % (after.get('width'), after.get('height'),
                                       after.get('bitrate_kbps')),
            'orientation': after.get('orientation') or info['orientation'],
            'duration_s': after.get('duration_s') or info['duration_s'],
            'vcodec': after.get('vcodec'), 'acodec': after.get('acodec'),
            'poster': 'yes' if os.path.isfile(poster) else 'no',
            'status': 'ok',
        }
        rows.append(rec)
        io.open(os.path.join(odir, 'info.json'), 'w', encoding='utf-8').write(
            json.dumps({'original': info, 'optimized': after, 'action': action}, indent=2))

        saved = info['bytes'] - rec['after_bytes']
        print('%-30s  %-9s %7.1f -> %6.1f MB  %s %s  %s'
              % (d[:29], action, info['bytes'] / 1048576, rec['after_bytes'] / 1048576,
                 rec['after'], rec['orientation'],
                 ('saves %.1f MB' % (saved / 1048576)) if saved > 262144 else ''))

    man = os.path.join(ROOT, 'media_manifest.csv')
    cols = ['folder', 'action', 'source_file', 'before', 'after', 'before_bytes',
            'after_bytes', 'orientation', 'duration_s', 'vcodec', 'acodec', 'poster',
            'status', 'error']
    with io.open(man, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, '') for k in cols})

    okrows = [r for r in rows if r.get('status') == 'ok']
    b = sum(r['before_bytes'] for r in okrows)
    a = sum(r['after_bytes'] for r in okrows)
    print()
    print('optimized      : %d of %d' % (len(okrows), len(rows)))
    print('posters        : %d' % sum(1 for r in okrows if r.get('poster') == 'yes'))
    print('total before   : %.1f MB' % (b / 1048576))
    print('total after    : %.1f MB  (%.0f%% smaller)'
          % (a / 1048576, (1 - a / b) * 100 if b else 0))
    print('manifest       : %s' % man)


if __name__ == '__main__':
    main()
