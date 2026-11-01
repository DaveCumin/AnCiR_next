#!/usr/bin/env python3
"""
Actogram template markers in the LAST row (match_template_markers, the port of
src/lib/plots/Actogram/onsetUnwrap.js matchTemplateMarkers).

The last row has no next row to search into, so a transition with fewer than N bins before it
in that row had no room for the template and the marker landed N bins in. The last row now
borrows up to N bins from the end of the row before. The same cases are pinned in
onsetUnwrap.test.js ("template matching in the last row").

    tools/.venv/bin/python -m pytest tools/test_actogram_template_markers.py -q
"""

from __future__ import annotations

import math

from ancir_runtime import match_template_markers


def simulate(days, first_onset, P=24.0, bin_size=0.25):
    """Active for 40% of each 24 h cycle from each onset, split into rows of P hours."""
    onsets = [first_onset + k * 24 for k in range(-1, days + 3)]
    xs, ys = {}, {}
    i = 0
    t = 0.0
    while t < days * P:
        active = any(o <= t and t - o < 0.4 * 24 for o in onsets)
        row = int(t // P)
        xs.setdefault(row, []).append(t)
        ys.setdefault(row, []).append(10 if active else 1)
        i += 1
        t = i * bin_size
    return xs, ys


def run(xs, ys, type='onset', bin_size=0.25):
    return match_template_markers(xs, ys, 24, bin_size, 3, 3, 50, type)


def test_an_onset_1_h_into_the_last_row_is_placed_at_1_h():
    out = run(*simulate(4, 1))
    assert len(out['hours']) == 4
    assert math.isclose(out['hours'][3], 1, abs_tol=1e-9)
    assert math.isclose(out['times'][3], 73, abs_tol=1e-9)
    # Interior rows still search into the next row.
    assert out['times'][:3] == [25, 49, 73]


def test_an_onset_at_the_start_of_the_last_row_is_placed_at_0_h():
    assert math.isclose(run(*simulate(3, 0))['hours'][2], 0, abs_tol=1e-9)


def test_an_offset_2_h_into_the_last_row_is_placed_at_2_h():
    assert math.isclose(run(*simulate(3, 16.4), type='offset')['hours'][2], 2, abs_tol=1e-9)


def test_a_lone_row_shorter_than_the_template_has_no_marker():
    out = run({0: [0, 1, 2, 3]}, {0: [1, 1, 10, 10]}, bin_size=1)
    assert len(out['hours']) == 1 and math.isnan(out['hours'][0])
    assert math.isnan(out['times'][0])


def _two_level(level=1, days=10):
    """Active (`level`) 06:00 to 18:00 every day, 0 at rest, in 15 min bins."""
    xs, ys = {}, {}
    for k in range(int(days * 24 / 0.25)):
        t = k * 0.25
        xs.setdefault(int(t // 24), []).append(t)
        ys.setdefault(int(t // 24), []).append(level if 6 <= t % 24 < 18 else 0)
    return xs, ys


def test_two_level_data_gives_the_real_onsets_and_offsets():
    # 0 / 1 data: the non-zero 50th percentile is 1 and nothing is above it, so the two-level
    # window counts at-or-above as active (onsetUnwrap.js; findCentileValue.zeros.test.js pins the
    # same cases). It used to put every marker N = 3 h in, then (v82.65) none at all.
    for level in (1, 7):
        xs, ys = _two_level(level)
        for type, hour in (('onset', 6), ('offset', 18)):
            out = run(xs, ys, type=type)
            assert out['hours'] == [hour] * 10
            assert out['times'] == [i * 24 + hour for i in range(10)]


def test_an_all_zero_window_still_has_no_marker():
    xs, ys = _two_level()
    ys[4] = [0] * len(ys[4])
    ys[5] = [0] * len(ys[5])
    out = run(xs, ys)
    assert math.isnan(out['hours'][4])
    assert out['hours'][3] == 6 and out['hours'][5] == 6


def test_one_non_zero_level_throughout_has_no_marker():
    xs = {0: [k * 0.25 for k in range(96)], 1: [24 + k * 0.25 for k in range(96)]}
    ys = {0: [3] * 96, 1: [3] * 96}
    out = run(xs, ys)
    assert all(math.isnan(h) for h in out['hours'])


def test_one_to_ten_data_gets_real_onsets_at_50_and_100_percent():
    xs, ys = {}, {}
    for k in range(int(240 / 0.25)):
        t = k * 0.25
        xs.setdefault(int(t // 24), []).append(t)
        ys.setdefault(int(t // 24), []).append(10 if 6 <= t % 24 < 18 else 1)
    for centile in (50, 100):
        out = match_template_markers(xs, ys, 24, 0.25, 3, 3, centile, 'onset')
        assert out['hours'] == [6] * 10


def test_noisy_data_at_100_percent_has_no_marker():
    # More than two distinct values: no at-or-above fallback, so nothing is active.
    import random
    r = random.Random(9)
    xs, ys = {}, {}
    for k in range(int(240 / 0.25)):
        t = k * 0.25
        xs.setdefault(int(t // 24), []).append(t)
        ys.setdefault(int(t // 24), []).append(10 + 4 * r.random() if 6 <= t % 24 < 18
                                               else r.random())
    out = match_template_markers(xs, ys, 24, 0.25, 3, 3, 100, 'onset')
    assert all(math.isnan(h) for h in out['hours'])
    assert all(math.isfinite(h) for h in run(xs, ys)['hours'])
