"""Move an MP4's moov atom to the front so it can start playing before it has finished downloading.

    python tools/faststart.py <in.mp4> <out.mp4>

WHY THIS EXISTS

An MP4 keeps its index -- the moov atom -- either before or after the media. A player cannot
begin until it has the index, so when moov sits at the end the browser must fetch the entire
file first. On the founder feed that is the difference between a pitch starting as you scroll
onto it and a pitch that does nothing for twenty seconds on a phone.

ffmpeg -movflags +faststart does this. ffmpeg is not installed here, and this is a container
rewrite rather than a re-encode: not a single byte of video or audio is touched, so doing it
directly is both safe and lossless. It is the same operation qt-faststart performs.

WHAT IT REWRITES

Moving moov in front of mdat pushes the media down the file by exactly the length of moov, so
every absolute chunk offset recorded inside moov is now wrong by that amount. Those live in
stco (32-bit offsets) and co64 (64-bit). Both are found recursively and corrected. Nothing
else in moov is altered.

A 32-bit stco entry that would overflow past 4 GiB after the shift is refused rather than
silently truncated -- the file would need co64 and converting it is beyond what this does.
"""
import io
import os
import struct
import sys


def atoms(buf, start=0, end=None):
    """Top-level atoms in buf[start:end] as (type, offset, length)."""
    end = len(buf) if end is None else end
    out = []
    i = start
    while i + 8 <= end:
        size = struct.unpack('>I', buf[i:i + 4])[0]
        typ = buf[i + 4:i + 8].decode('latin1')
        hdr = 8
        if size == 1:                       # 64-bit extended size
            size = struct.unpack('>Q', buf[i + 8:i + 16])[0]
            hdr = 16
        elif size == 0:                     # runs to end of file
            size = end - i
        if size < hdr or i + size > end:
            break
        out.append((typ, i, size))
        i += size
    return out


def patch_offsets(moov, shift):
    """Add shift to every stco/co64 entry inside moov. Returns the patched bytes."""
    b = bytearray(moov)
    patched = {'stco': 0, 'co64': 0}

    def walk(start, end):
        for typ, off, size in atoms(b, start, end):
            if typ in ('stco', 'co64'):
                # full box: 4 bytes version+flags, then a 4-byte count, then the entries
                p = off + 8
                count = struct.unpack('>I', b[p + 4:p + 8])[0]
                q = p + 8
                for _ in range(count):
                    if typ == 'stco':
                        v = struct.unpack('>I', b[q:q + 4])[0] + shift
                        if v > 0xFFFFFFFF:
                            raise ValueError('a 32-bit chunk offset would overflow; '
                                             'this file needs co64 and is not handled')
                        struct.pack_into('>I', b, q, v)
                        q += 4
                    else:
                        v = struct.unpack('>Q', b[q:q + 8])[0] + shift
                        struct.pack_into('>Q', b, q, v)
                        q += 8
                patched[typ] += count
            elif typ in ('moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta'):
                walk(off + 8, off + size)    # containers worth descending into

    walk(0, len(b))
    return bytes(b), patched


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__.strip().split('\n')[2].strip())
    src, dst = sys.argv[1], sys.argv[2]
    raw = io.open(src, 'rb').read()
    top = atoms(raw)
    kinds = [t for t, _, _ in top]
    if 'moov' not in kinds or 'mdat' not in kinds:
        sys.exit('  not a readable MP4: atoms are ' + ','.join(kinds))
    if kinds.index('moov') < kinds.index('mdat'):
        io.open(dst, 'wb').write(raw)
        print('  %s: already faststart, copied unchanged' % os.path.basename(src))
        return

    moov = next((o, s) for t, o, s in top if t == 'moov')
    moov_bytes = raw[moov[0]:moov[0] + moov[1]]
    fixed, counts = patch_offsets(moov_bytes, len(moov_bytes))

    out = bytearray()
    for t, o, s in top:
        if t == 'ftyp':
            out += raw[o:o + s]
    out += fixed
    for t, o, s in top:
        if t in ('ftyp', 'moov'):
            continue
        out += raw[o:o + s]

    if len(out) != len(raw):
        sys.exit('  refusing to write: length changed %d -> %d' % (len(raw), len(out)))
    io.open(dst, 'wb').write(bytes(out))

    check = [t for t, _, _ in atoms(bytes(out))]
    ok = check.index('moov') < check.index('mdat')
    print('  %s: moov moved to the front, %d stco + %d co64 offsets shifted by %d  [%s]'
          % (os.path.basename(src), counts['stco'], counts['co64'], len(moov_bytes),
             'verified' if ok else 'FAILED'))
    if not ok:
        sys.exit(1)


if __name__ == '__main__':
    main()
