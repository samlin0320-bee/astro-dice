"""
Generate ephemeris.json for astro-dice transit auto-fill.

Covers -30 to +90 days at 6-hour resolution.
Includes both tropical (西洋) and sidereal Lahiri (印度) sign positions
for all 12 dice planets.

Usage:
    python tools/update_ephemeris.py

Output:
    ephemeris.json (in repo root)
"""
import json
import os
from datetime import datetime, timedelta, timezone
import swisseph as swe

PLANETS = [
    ('sun',     swe.SUN),
    ('moon',    swe.MOON),
    ('mercury', swe.MERCURY),
    ('venus',   swe.VENUS),
    ('mars',    swe.MARS),
    ('jupiter', swe.JUPITER),
    ('saturn',  swe.SATURN),
    ('uranus',  swe.URANUS),
    ('neptune', swe.NEPTUNE),
    ('pluto',   swe.PLUTO),
    ('rahu',    swe.MEAN_NODE),  # Vedic 慣用平均交點
    # ketu 由 rahu + 180 推算
]
PLANET_NAMES = [name for name, _ in PLANETS] + ['ketu']


def sign_of(longitude_deg: float) -> int:
    """Return 0..11 sign index from ecliptic longitude in degrees."""
    return int(longitude_deg % 360 / 30)


def compute_point(dt: datetime) -> dict:
    """Compute tropical and sidereal sign positions at a UTC datetime."""
    jd = swe.julday(dt.year, dt.month, dt.day,
                    dt.hour + dt.minute / 60 + dt.second / 3600)

    trop_signs = []
    sid_signs = []

    for name, pid in PLANETS:
        # Tropical
        lon_t = swe.calc_ut(jd, pid)[0][0]
        trop_signs.append(sign_of(lon_t))
        # Sidereal Lahiri
        lon_s = swe.calc_ut(jd, pid, swe.FLG_SIDEREAL)[0][0]
        sid_signs.append(sign_of(lon_s))

    # Ketu = Rahu + 180
    trop_signs.append(sign_of((swe.calc_ut(jd, swe.MEAN_NODE)[0][0] + 180)))
    sid_signs.append(sign_of((swe.calc_ut(jd, swe.MEAN_NODE, swe.FLG_SIDEREAL)[0][0] + 180)))

    return {
        't': int(dt.timestamp()),
        'T': trop_signs,
        'S': sid_signs,
    }


def main():
    swe.set_sid_mode(swe.SIDM_LAHIRI)

    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    # round down to nearest 6-hour mark
    now = now.replace(hour=(now.hour // 6) * 6)

    start = now - timedelta(days=30)
    end = now + timedelta(days=90)

    points = []
    cur = start
    while cur < end:
        points.append(compute_point(cur))
        cur += timedelta(hours=6)

    output = {
        'generated_at': now.isoformat(),
        'sidereal_system': 'Lahiri',
        'resolution_hours': 6,
        'planets_order': PLANET_NAMES,
        'note': 'T = tropical sign indices (西洋), S = sidereal Lahiri sign indices (印度)',
        'points': points,
    }

    out_path = os.path.join(os.path.dirname(__file__), '..', 'ephemeris.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, separators=(',', ':'))

    size = os.path.getsize(out_path)
    print(f'Generated {len(points)} points covering {start.date()} → {end.date()}')
    print(f'File: {out_path} ({size:,} bytes)')


if __name__ == '__main__':
    main()
