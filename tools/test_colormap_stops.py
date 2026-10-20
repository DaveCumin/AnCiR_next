#!/usr/bin/env python3
"""
The app's colormap stop tables (src/lib/components/plotbits/colormapStops.json) are
matplotlib's maps: the file must equal what tools/gen_colormap_stops.py produces from the
installed matplotlib, so the JS tests that compare the app against the file's matplotlib
reference values are comparing against matplotlib itself (colour-by plan 2026-10-20,
section 3.4).

    tools/.venv/bin/python -m pytest tools/test_colormap_stops.py -q
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import gen_colormap_stops as gen  # noqa: E402


def test_the_stop_file_is_the_generator_output():
    assert gen.OUT.read_text() == gen.render(gen.build()), (
        "colormapStops.json is stale or hand-edited: run tools/gen_colormap_stops.py")


def test_stops_are_matplotlib_at_the_stop_positions():
    data = json.loads(gen.OUT.read_text())
    for name in gen.SAMPLED:
        cm = matplotlib.colormaps[name]
        table = data["stops"][name]
        assert len(table) == gen.N_STOPS
        for i, row in enumerate(table):
            want = gen.rgb255(cm(i / (gen.N_STOPS - 1)))
            # The cyclic map's closing stop is its first; matplotlib's is one step short.
            tol = 1 if (name in gen.CYCLIC and i == gen.N_STOPS - 1) else 0
            assert max(abs(a - b) for a, b in zip(row, want)) <= tol, (name, i, row, want)
    tw = data["stops"]["twilight_shifted"]
    assert tw[0] == tw[-1]
