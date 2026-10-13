"""Draws the cartoon map on the back of the homepage ticket and writes it into public/index.html.

    python tools/map/make-map.py

Sources (fetched 2026-10-05, kept in tools/map/geo so the map redraws without the network):
  - venue: Nominatim geocode of 3506 Gwynnbrook Ave, Owings Mills, MD 21117 -> 39.4473168, -76.7731642
  - routes and highways: OSRM demo server, driving profile, overview=full&geometries=geojson
      penn.json   Baltimore Penn Station -> venue        bwi.json  BWI Airport -> venue
      b695a.json  I-695 waypoints Curtis Bay ... Dundalk  i95.json  I-95 Laurel -> White Marsh
      bwp.json    BW Parkway toward DC                    i97.json  I-97 south of BWI
    e.g. curl "https://router.project-osrm.org/route/v1/driving/-76.6157,39.3076;-76.7731642,39.4473168?overview=full&geometries=geojson"
  - distances / times on the labels (OSRM, no traffic): Penn 16.6 mi 30 min, BWI 23.0 mi 38 min,
    BWI rail 23.2 mi 39 min, DCA 55.3 mi 86 min, IAD 72.6 mi 100 min
Water, reservoirs, park and city outlines are hand points (lat, lon) below. Map data (c) OpenStreetMap contributors.
"""
import os, re
HERE = os.path.dirname(os.path.abspath(__file__))
import json, math
W, H = 400, 420
L0, L1, T0, T1 = -76.95, -76.40, 39.50, 39.052


def P(lon, lat):
    return ((lon - L0) / (L1 - L0) * W, (T0 - lat) / (T0 - T1) * H)


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    n = math.hypot(dx, dy) or 1e-9
    i, dmax = 0, 0
    for k in range(1, len(pts) - 1):
        d = abs(dy * pts[k][0] - dx * pts[k][1] + x2 * y1 - y2 * x1) / n
        if d > dmax:
            i, dmax = k, d
    if dmax > eps:
        return rdp(pts[:i + 1], eps)[:-1] + rdp(pts[i:], eps)
    return [pts[0], pts[-1]]


def f(v):
    return ('%.1f' % v).rstrip('0').rstrip('.')


def line(pts):
    return 'M' + ' L'.join(f(x) + ' ' + f(y) for x, y in pts)


def smooth(pts, closed=False):
    # Catmull-Rom through hand points: soft, drawn-by-hand curves
    p = [pts[-1]] + pts + pts[:2] if closed else [pts[0]] + pts + [pts[-1]]
    d = 'M' + f(p[1][0]) + ' ' + f(p[1][1])
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += ' C%s %s %s %s %s %s' % tuple(map(f, (*c1, *c2, *p2)))
    return d + (' Z' if closed else '')


def despur(pts, max_turn=125):
    # drop the out-and-back stubs the router leaves where a waypoint snapped onto a ramp
    pts = list(pts)
    changed = True
    while changed and len(pts) > 3:
        changed = False
        for i in range(1, len(pts) - 1):
            ax, ay = pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]
            bx, by = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
            na, nb = math.hypot(ax, ay), math.hypot(bx, by)
            if na < 1e-6 or nb < 1e-6 or math.degrees(math.acos(max(-1, min(1, (ax * bx + ay * by) / (na * nb))))) > max_turn:
                del pts[i]
                changed = True
                break
    return pts


def geo(name, eps=1.1):
    c = json.load(open(os.path.join(HERE, 'geo', '%s.json' % name)))['routes'][0]['geometry']['coordinates']
    return despur(rdp(despur([P(lo, la) for lo, la in c]), eps))


def near(pts, lon, lat):
    tx, ty = P(lon, lat)
    return min(pts, key=lambda q: (q[0] - tx) ** 2 + (q[1] - ty) ** 2)


def ll(pts):
    return [P(lo, la) for la, lo in pts]


V = P(-76.7731642, 39.4473168)
PENN = P(-76.6157, 39.3076)
BWI = P(-76.6684, 39.1774)
BWIR = P(-76.6941, 39.1923)

# water: the bay's western shore, the Patapsco mouth and the harbour (hand points, lat/lon)
bay = ll([(39.335, -76.395), (39.30, -76.415), (39.27, -76.428), (39.245, -76.445), (39.215, -76.448), (39.205, -76.47),
          (39.215, -76.50), (39.235, -76.525), (39.255, -76.552), (39.268, -76.575), (39.279, -76.594), (39.285, -76.607),
          (39.276, -76.614), (39.262, -76.617), (39.252, -76.630), (39.244, -76.622), (39.236, -76.598), (39.222, -76.575),
          (39.205, -76.545), (39.185, -76.52), (39.168, -76.49), (39.150, -76.465), (39.125, -76.452), (39.10, -76.448), (39.078, -76.44), (39.055, -76.428), (39.03, -76.42)])
bay_tail = ll([(39.02, -76.35), (39.34, -76.35)])
river = ll([(39.252, -76.630), (39.236, -76.662), (39.222, -76.700), (39.236, -76.745), (39.262, -76.790),
            (39.300, -76.830), (39.335, -76.880), (39.368, -76.915)])
liberty = ll([(39.385, -76.905), (39.405, -76.885), (39.432, -76.878), (39.455, -76.892), (39.46, -76.93),
              (39.445, -76.96), (39.418, -76.945), (39.398, -76.93)])
loch = ll([(39.405, -76.585), (39.425, -76.572), (39.448, -76.555), (39.468, -76.538), (39.476, -76.552),
           (39.458, -76.575), (39.436, -76.592), (39.414, -76.600)])
park = ll([(39.246, -76.640), (39.226, -76.676), (39.212, -76.710), (39.226, -76.760), (39.258, -76.808),
           (39.296, -76.850), (39.332, -76.900), (39.36, -76.93), (39.378, -76.902), (39.344, -76.862),
           (39.31, -76.815), (39.274, -76.772), (39.250, -76.735), (39.240, -76.700), (39.258, -76.660)])
city = ll([(39.372, -76.711), (39.372, -76.529), (39.209, -76.529), (39.197, -76.550), (39.234, -76.620), (39.278, -76.711)])

roads = [geo(k, 1.8) for k in ('b695a', 'i95', 'bwp', 'i97')]
routes = {k: geo(k, .9) for k in ('penn', 'bwi')}
# I-695 has no crossing at the Patapsco since the Key Bridge fell (2024): end the drawn loop at Essex
ex, ey = P(-76.50, 39.33)
cut = next(i for i, (x, y) in enumerate(roads[0]) if x > ex and y > ey)
roads[0] = roads[0][:cut]
b695, i95 = roads[0], roads[1]

trees = ''.join('<circle cx="%s" cy="%s" r="%s"/>' % (f(P(lo, la)[0]), f(P(lo, la)[1]), r) for la, lo, r in [
    (39.255, -76.745, 4.6), (39.272, -76.778, 4), (39.30, -76.818, 4.4), (39.322, -76.858, 3.8), (39.236, -76.712, 3.6),
    (39.42, -76.62, 3.6), (39.47, -76.60, 4), (39.44, -76.93, 3.4), (39.40, -76.86, 3.8), (39.16, -76.80, 4.2),
    (39.145, -76.74, 3.6), (39.48, -76.70, 3.8), (39.10, -76.78, 4.4), (39.075, -76.70, 3.8), (39.09, -76.52, 3.6), (39.12, -76.88, 3.8), (39.20, -76.90, 4)])


def shield(pt, t):
    x, y = pt
    w = 11 + 5.4 * len(t)
    return ('<g class="mp-shield" transform="translate(%s %s)"><path d="M%s -7.5 h%s q4 0 4 4 v4 q0 5 -%s 8 q-%s -3 -%s -8 v-4 q0 -4 4 -4z"/>'
            '<text y="3.4">%s</text></g>') % (f(x), f(y), f(-w / 2 + 4), f(w - 8), f(w / 2), f(w / 2), f(w / 2), t)


def at(pts, frac):
    return pts[int(len(pts) * frac)]


def label(x, y, t1, t2, cls=''):
    return ('<text class="mp-l %s" x="%s" y="%s"><tspan class="mp-l1">%s</tspan>'
            '<tspan class="mp-l2" x="%s" dy="13">%s</tspan></text>') % (cls, f(x), f(y), t1.upper(), f(x), t2)


skyline = ''.join('<rect x="%s" y="%s" width="%s" height="%s" rx="1.2"/>' % (f(PENN[0] - 20 + dx), f(PENN[1] + 34 - h), w, h)
                  for dx, w, h in [(0, 6, 11), (7, 7, 19), (15, 5, 14), (21, 8, 24), (30, 6, 16), (37, 7, 10)])

plane = ('M-6.4 1.2 L-1 -0.4 L1.6 -6.6 L3.6 -6.6 L2.6 -0.9 L6.6 -0.9 L7.6 -2.6 L8.8 -2.6 L8.2 0.6 L8.8 3.6 L7.6 3.6 '
         'L6.6 1.9 L2.6 1.9 L3.6 7.6 L1.6 7.6 L-1 2.2 L-6.4 1.9 Z')
train = ('M-4.4 -5.6 h8.8 a2.2 2.2 0 0 1 2.2 2.2 v6 a2.2 2.2 0 0 1 -2.2 2.2 h-8.8 a2.2 2.2 0 0 1 -2.2 -2.2 v-6 '
         'a2.2 2.2 0 0 1 2.2 -2.2z M-3.9 -3.4 v2.7 h7.8 v-2.7z')
wheels = 'M-4.1 4.9 l-2 2.9 M4.1 4.9 l2 2.9'

parts = [
    '<svg class="mp" viewBox="0 0 %d %d" aria-hidden="true" focusable="false">' % (W, H),
    '<rect class="mp-land" width="%d" height="%d"/>' % (W, H),
    '<path class="mp-city" d="%s"/>' % smooth(city, True),
    '<path class="mp-park" d="%s"/>' % smooth(park, True),
    '<g class="mp-trees">%s</g>' % trees,
    '<path class="mp-water" d="%s"/>' % smooth(liberty, True),
    '<path class="mp-water" d="%s"/>' % smooth(loch, True),
    '<path class="mp-river" d="%s"/>' % smooth(river),
    '<path class="mp-water" d="%s L%s L%s Z"/>' % (smooth(bay), ' '.join(map(f, bay_tail[0])), ' '.join(map(f, bay_tail[1]))),
    '<g class="mp-waves"><path d="M356 236q4-4 8 0t8 0"/><path d="M340 318q4-4 8 0t8 0"/><path d="M372 352q4-4 8 0t8 0"/><path d="M382 280q4-4 8 0t8 0"/><path d="M366 400q4-4 8 0t8 0"/></g>',
    '<g class="mp-roads mp-roads--case">%s</g>' % ''.join('<path d="%s"/>' % smooth(p) for p in roads),
    '<g class="mp-roads">%s</g>' % ''.join('<path d="%s"/>' % smooth(p) for p in roads),
    '<g class="mp-skyline">%s</g>' % skyline,
    '<g class="mp-routes">%s</g>' % ''.join('<path d="%s"/>' % line(p) for p in routes.values()),
    shield(at(b695, .28), '695'),
    shield(near(routes['bwi'], -76.745, 39.405), '795'),
    shield(at(i95, .83), '95'),
    '<g class="mp-runways" transform="translate(%s %s)"><rect x="-15" y="-2.6" width="30" height="5.2" rx="2.6" transform="rotate(-28)"/>'
    '<rect x="-11" y="-2.4" width="22" height="4.8" rx="2.4" transform="rotate(48)"/></g>' % (f(BWI[0]), f(BWI[1])),
    '<g class="mp-pin" transform="translate(%s %s)"><circle r="10.5"/><path d="%s" transform="scale(.82)"/></g>' % (f(BWI[0] + 8), f(BWI[1] - 14), plane),
    '<g class="mp-pin" transform="translate(%s %s)"><circle r="8.5"/><path d="%s" transform="scale(.8)"/><path class="mp-pin__w" d="%s" transform="scale(.8)"/></g>' % (f(BWIR[0] - 12), f(BWIR[1] - 2), train, wheels),
    '<g class="mp-pin" transform="translate(%s %s)"><circle r="10.5"/><path d="%s"/><path class="mp-pin__w" d="%s"/></g>' % (f(PENN[0]), f(PENN[1]), train, wheels),
    '<g class="mp-venue" transform="translate(%s %s)"><path class="mp-venue__pin" d="M0 2C-4 -6 -13 -10 -13 -20A13 13 0 0 1 13 -20C13 -10 4 -6 0 2Z"/>'
    '<path class="mp-venue__star" d="M0 -27.5L2.2 -22.6L7.5 -22.1L3.5 -18.6L4.6 -13.4L0 -16.1L-4.6 -13.4L-3.5 -18.6L-7.5 -22.1L-2.2 -22.6Z"/></g>' % (f(V[0]), f(V[1])),
    '<path class="mp-arrow" d="M60 372L22 404M22 390V404H36"/>',
    '<g class="mp-compass" transform="translate(378 28)"><circle r="12"/><path d="M0 -8L3.8 3L0 .8L-3.8 3Z"/><text y="-15">N</text></g>',
    label(V[0] + 17, V[1] - 24, 'Gordon Center', 'You&#8217;re headed here', 'mp-l--venue'),
    label(PENN[0] + 15, PENN[1] - 5, 'Penn Station', 'Amtrak &#183; 17 mi &#183; ~30 min'),
    label(BWI[0] + 22, BWI[1] + 6, 'BWI Airport', '+ Amtrak &#183; 23 mi &#183; ~40 min'),
    label(14, 352, 'To DC airports', 'DCA 55 mi &#183; IAD 73 mi'),
    '</svg>',
]
svg = '\n'.join(parts)
page = os.path.join(HERE, '..', '..', 'public', 'index.html')
html = open(page, encoding='utf-8').read()
indented = '\n'.join('              ' + l for l in svg.split('\n'))
html, n = re.subn(r'              <svg class="mp".*?</svg>', lambda m: indented, html, flags=re.S)
assert n == 1, 'map svg not found in index.html'
open(page, 'w', encoding='utf-8', newline='').write(html)
print(len(svg), 'bytes; venue', [round(v) for v in V], 'penn', [round(v) for v in PENN], 'bwi', [round(v) for v in BWI], 'bwir', [round(v) for v in BWIR])
