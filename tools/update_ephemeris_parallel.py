"""
Parallel version of update_ephemeris.py using multiprocessing.
8 workers, each handling ~4-year chunk. Merges & sorts by timestamp.
"""
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from multiprocessing import Pool, cpu_count

sys.stdout.reconfigure(encoding='utf-8')

PLANET_TUPLE = [
    ('sun',     'SUN'),
    ('moon',    'MOON'),
    ('mercury', 'MERCURY'),
    ('venus',   'VENUS'),
    ('mars',    'MARS'),
    ('jupiter', 'JUPITER'),
    ('saturn',  'SATURN'),
    ('uranus',  'URANUS'),
    ('neptune', 'NEPTUNE'),
    ('pluto',   'PLUTO'),
    ('rahu',    'MEAN_NODE'),
]
PLANET_NAMES = [n for n, _ in PLANET_TUPLE] + ['ketu']


def sign_of(longitude_deg: float) -> int:
    return int(longitude_deg % 360 / 30)


def compute_chunk(args):
    """Worker: compute points for a (start_sec, end_sec, step_sec) range."""
    import swisseph as swe
    start_sec, end_sec, step_sec = args
    swe.set_sid_mode(swe.SIDM_LAHIRI)
    PIDS = [(n, getattr(swe, attr)) for n, attr in PLANET_TUPLE]

    points = []
    cur_sec = start_sec
    while cur_sec < end_sec:
        dt = datetime.fromtimestamp(cur_sec, tz=timezone.utc)
        jd = swe.julday(dt.year, dt.month, dt.day, dt.hour + dt.minute/60)

        trop_signs = []
        sid_signs = []
        retros = []
        trop_deg = []   # 星座內度數 x100 取整(0..2999),前端 /100 還原
        sid_deg = []

        for name, pid in PIDS:
            result_t = swe.calc_ut(jd, pid)[0]
            lon_t = result_t[0] % 360
            trop_signs.append(sign_of(lon_t))
            trop_deg.append(int(round((lon_t % 30) * 10)))
            retros.append(1 if result_t[3] < 0 else 0)
            lon_s = swe.calc_ut(jd, pid, swe.FLG_SIDEREAL)[0][0] % 360
            sid_signs.append(sign_of(lon_s))
            sid_deg.append(int(round((lon_s % 30) * 10)))

        # Ketu = Rahu + 180
        rahu_result = swe.calc_ut(jd, swe.MEAN_NODE)[0]
        lon_t_k = (rahu_result[0] + 180) % 360
        trop_signs.append(sign_of(lon_t_k))
        trop_deg.append(int(round((lon_t_k % 30) * 10)))
        lon_s_k = (swe.calc_ut(jd, swe.MEAN_NODE, swe.FLG_SIDEREAL)[0][0] + 180) % 360
        sid_signs.append(sign_of(lon_s_k))
        sid_deg.append(int(round((lon_s_k % 30) * 10)))
        retros.append(1 if rahu_result[3] < 0 else 0)

        points.append({'t': cur_sec, 'T': trop_signs, 'S': sid_signs, 'R': retros,
                       'D': trop_deg, 'DS': sid_deg})
        cur_sec += step_sec

    return points


def main():
    STEP_HOURS = 6
    START = datetime(2018, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    END   = datetime(2051, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    step_sec = STEP_HOURS * 3600
    start_sec = int(START.timestamp())
    end_sec   = int(END.timestamp())
    total_sec = end_sec - start_sec
    total_pts = total_sec // step_sec

    WORKERS = min(8, cpu_count())
    # 每個 worker 拿 total_sec/WORKERS 但要對齊到 step_sec 邊界
    chunk_sec = (total_sec // WORKERS // step_sec) * step_sec
    chunks = []
    cur = start_sec
    for i in range(WORKERS):
        chunk_end = cur + chunk_sec if i < WORKERS - 1 else end_sec
        chunks.append((cur, chunk_end, step_sec))
        cur = chunk_end
    print(f'[parallel] {WORKERS} workers, total {total_pts} points, ~{total_pts // WORKERS} per worker')
    for i, c in enumerate(chunks):
        s = datetime.fromtimestamp(c[0], tz=timezone.utc).date()
        e = datetime.fromtimestamp(c[1], tz=timezone.utc).date()
        print(f'  worker {i}: {s} → {e}  ({(c[1]-c[0])//step_sec} pts)')

    t0 = time.perf_counter()
    with Pool(WORKERS) as pool:
        results = pool.map(compute_chunk, chunks)
    elapsed = time.perf_counter() - t0
    print(f'[parallel] all workers done in {elapsed:.1f}s')

    # merge & sort by t
    points = []
    for chunk_pts in results:
        points.extend(chunk_pts)
    points.sort(key=lambda p: p['t'])
    # dedup (以防邊界重疊)
    seen = set()
    dedup = []
    for p in points:
        if p['t'] in seen:
            continue
        seen.add(p['t'])
        dedup.append(p)
    print(f'[merge] {len(dedup)} unique points')

    output = {
        'generated_at': datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        'sidereal_system': 'Lahiri',
        'resolution_hours': STEP_HOURS,
        'planets_order': PLANET_NAMES,
        'note': 'T=tropical sign idx, S=sidereal Lahiri sign idx, R=retrograde 0/1, D=tropical deg-in-sign x10, DS=sidereal deg-in-sign x10. 6h resolution, 2018-01-01 → 2051-01-01 (33y).',
        'points': dedup,
    }
    out_path = os.path.join(os.path.dirname(__file__), '..', 'ephemeris.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, separators=(',', ':'))
    size = os.path.getsize(out_path)
    print(f'[write] {out_path} ({size:,} bytes)')


if __name__ == '__main__':
    main()
