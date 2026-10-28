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


def test_two_level_data_gives_no_markers_not_made_up_ones():
    # 0 / 1 data: the non-zero 50th percentile is 1, nothing is above it, so the match is flat.
    # It used to put every marker N = 3 h into the window; now each row reports none.
    xs, ys = {}, {}
    for k in range(int(240 / 0.25)):
        t = k * 0.25
        xs.setdefault(int(t // 24), []).append(t)
        ys.setdefault(int(t // 24), []).append(1 if 6 <= t % 24 < 18 else 0)
    for type in ('onset', 'offset'):
        out = run(xs, ys, type=type)
        assert len(out['hours']) == 10
        assert all(math.isnan(h) for h in out['hours'])
        assert all(math.isnan(t) for t in out['times'])
