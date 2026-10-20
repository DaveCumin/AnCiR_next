#!/usr/bin/env python3
"""
Series marks in the exported plots (Python side): the line and the points of each series.

The app saves a series' line as LineClass.toJSON (`draw`, `strokeWidth`, `stroke`,
`joinGaps`, `colour`; components/plotbits/Line.svelte) and its points as PointsClass.toJSON
(`draw`, `radius`, `shape`, `colour`; Points.svelte). Until v82.35 the runtime read `show`,
`width` and `size`, keys no writer ever produced, so every exported scatterplot drew a
width-1 line (even when the line was hidden) and never drew a point, and every line bridged
its gaps. The old tests passed `"points": {}` and could not see it.

These tests therefore take their series from the demo sessions (written by the app's own
toJSON) and pin what the app draws:
  - `draw` false hides the mark; missing keys take the class defaults.
  - Units: the app works in CSS px, matplotlib in points (1 in = 96 px = 72 pt), so a
    `strokeWidth` of w px is a linewidth of 0.75 w pt and a marker of radius r px has
    `s = (1.5 r m)^2` (m is the marker's own scale; 1 for a circle). Measured here at
    96 dpi, where 1 px on the canvas is 1 CSS px.
  - Marker shapes are the app's own geometry (pointShapes.js getPointPath, evaluated by
    node when it is available).
  - Dashes keep the app's absolute lengths; SVG default caps (butt) and joins (a miter that
    falls back to a bevel past miter-limit 4; drawn as a bevel, see _SVG_LINE_JOIN).
  - Gaps: a missing x or y breaks the line (d3 `defined(isValid)`) unless `joinGaps` is on,
    which bridges straight across; fewer than two valid points draw no line.
  - FFT, Periodogram and Correlogram draw their line and points by the same rules.

    tools/.venv/bin/python -m pytest tools/test_plot_series_marks.py -q
"""

from __future__ import annotations

import copy
import json
import math
import re
import shutil
import subprocess
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import ancir_runtime as rt  # noqa: E402
from test_session_parity import run_session  # noqa: E402

DEMOS = ROOT / "static" / "sessions" / "demos"
POINT_SHAPES_JS = ROOT / "src" / "lib" / "components" / "plotbits" / "pointShapes.js"
DPI = 96  # 1 canvas px == 1 CSS px, so px measurements compare with the app directly


# ---- helpers --------------------------------------------------------------------------

def demo(sid):
    return json.loads((DEMOS / f"{sid}.json").read_text())


def plot_by_name(session, name):
    """A demo plot by its name: demo ids shift whenever the generator adds a node to an
    earlier demo (v82.49 moved Bin Data's plot from 103 to 105 and its columns 633 to 654)."""
    (plot,) = [p for p in session["plots"] if p.get("name") == name]
    return copy.deepcopy(plot)


def raw_y(plot, i=0):
    """The rawData key of series i's y column."""
    return str(plot["plot"]["data"][i]["y"]["refId"])


def raw_x(plot, i=0):
    """The rawData key of series i's x column."""
    return str(plot["plot"]["data"][i]["x"]["refId"])


BINNED = "Bin Data: data + fit"


def automatic_colours(plot):
    """The plot with every series colour automatic (null). The demo generator picks navy and
    terracotta for Before/After (nodeDemoBuilders.js RAW_COLOUR, OUT_COLOUR); they equal
    palette slots 0 and 1, and until v82.49 loading released them as automatic, so the demos
    saved null. They are picks now and save as such."""
    for d in plot["plot"]["data"]:
        for slot in ("line", "points"):
            if isinstance(d.get(slot), dict):
                d[slot]["colour"] = None
    return plot


def render(session, plot, fn=None):
    cols, _raw, errors = run_session(session)
    assert not errors, errors
    fig, ax = plt.subplots(figsize=(8, 5), dpi=DPI)
    (fn or rt.plot_scatterplot)(plot, cols, ax)
    fig.canvas.draw()
    return fig, ax


def series_artists(ax, i):
    return {
        "line": [a for a in ax.lines if a.get_gid() == f"series-{i}-line"],
        "points": [a for a in ax.collections if a.get_gid() == f"series-{i}-points"],
    }


def marker_px(coll):
    """The first marker's outline in canvas px around its centre, y DOWN (SVG convention),
    so it compares with getPointPath directly."""
    verts = coll.get_paths()[0].vertices
    scale = math.sqrt(coll.get_sizes()[0]) * DPI / 72.0
    return np.column_stack([verts[:, 0] * scale, -verts[:, 1] * scale])


def js_point_paths(r):
    """getPointPath(shape, 0, 0, r) for every non-circle shape, from the app's own module."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not available to evaluate pointShapes.js")
    script = (f"import {{ getPointPath }} from {json.dumps(POINT_SHAPES_JS.as_uri())};"
              "const out = {};"
              "for (const s of ['triangle','square','star','cross','x'])"
              f" out[s] = getPointPath(s, 0, 0, {r});"
              "console.log(JSON.stringify(out));")
    res = subprocess.run([node, "--input-type=module", "-e", script], capture_output=True,
                         text=True, check=True)
    return json.loads(res.stdout)


def svg_vertices(d):
    """Vertices of an M/L/h/v/Z path (the commands getPointPath writes for polygons)."""
    out, cx, cy = [], 0.0, 0.0
    for cmd, args in re.findall(r"([MLhvZ])([^MLhvZ]*)", d):
        nums = [float(t) for t in re.findall(r"-?[\d.]+(?:e-?\d+)?", args)]
        if cmd in "ML":
            cx, cy = nums
        elif cmd == "h":
            cx += nums[0]
        elif cmd == "v":
            cy += nums[0]
        else:
            continue
        out.append((cx, cy))
    if len(out) > 1 and np.allclose(out[0], out[-1]):
        out.pop()  # 'h-2r' returns to the start before Z on the square
    return np.array(out)


# ---- points-only and line-only series, as the demos save them -------------------------

def test_points_only_series_draws_its_points_and_no_line():
    # demo-tp-binneddata "Bin Data: data + fit", series 0: {draw: False} line, {radius: 3} points.
    session = demo("demo-tp-binneddata")
    plot = plot_by_name(session, BINNED)
    s0 = plot["plot"]["data"][0]
    assert s0["line"]["draw"] is False and s0["points"]["draw"] is True
    fig, ax = render(session, plot)
    try:
        a = series_artists(ax, 0)
        assert a["line"] == []
        (coll,) = a["points"]
        assert len(coll.get_offsets()) == 50
        # radius 3 px: the circle's outline sits 3 px from its centre.
        assert coll.get_sizes()[0] == pytest.approx((1.5 * 3) ** 2)
        assert np.abs(marker_px(coll)).max() == pytest.approx(3)
        # No outline around the fill (the app draws stroke="none").
        assert list(coll.get_linewidths()) == [0]
    finally:
        plt.close(fig)


def test_line_only_series_draws_its_line_at_the_saved_width_and_no_points():
    # Same plot, series 1: the Bin Data line, strokeWidth 2.5, points hidden.
    session = demo("demo-tp-binneddata")
    plot = plot_by_name(session, BINNED)
    s1 = plot["plot"]["data"][1]
    assert s1["line"]["draw"] is True and s1["points"]["draw"] is False
    fig, ax = render(session, plot)
    try:
        a = series_artists(ax, 1)
        assert a["points"] == []
        (line,) = a["line"]
        assert line.get_linewidth() == pytest.approx(2.5 * 0.75)
        # SVG's default stroke ends, and its corners as drawn (rt._SVG_LINE_JOIN).
        assert line.get_solid_capstyle() == "butt"
        assert line.get_solid_joinstyle() == "bevel"
    finally:
        plt.close(fig)


def test_hidden_line_and_hidden_points_draw_nothing():
    session = demo("demo-tp-binneddata")
    plot = plot_by_name(session, BINNED)
    plot["plot"]["data"][1]["line"]["draw"] = False
    fig, ax = render(session, plot)
    try:
        assert series_artists(ax, 1) == {"line": [], "points": []}
    finally:
        plt.close(fig)


def test_line_and_points_of_one_series_share_the_automatic_colour():
    session = demo("demo-tp-binneddata")
    plot = automatic_colours(plot_by_name(session, BINNED))
    s0 = plot["plot"]["data"][0]
    s0["line"]["draw"] = True
    fig, ax = render(session, plot)
    try:
        a = series_artists(ax, 0)
        line_rgba = matplotlib.colors.to_rgba(a["line"][0].get_color())
        assert tuple(a["points"][0].get_facecolor()[0]) == pytest.approx(line_rgba)
        # The second series takes the next automatic colour, as the app's positional fallback.
        other = matplotlib.colors.to_rgba(series_artists(ax, 1)["line"][0].get_color())
        assert other != line_rgba
    finally:
        plt.close(fig)


def test_explicit_colours_are_kept_per_mark():
    session = demo("demo-tp-binneddata")
    plot = plot_by_name(session, BINNED)
    s0 = plot["plot"]["data"][0]
    s0["line"].update(draw=True, colour="#C0392B")
    s0["points"]["colour"] = "#2980B9"
    fig, ax = render(session, plot)
    try:
        a = series_artists(ax, 0)
        assert matplotlib.colors.to_hex(a["line"][0].get_color()) == "#c0392b"
        assert matplotlib.colors.to_hex(a["points"][0].get_facecolor()[0]) == "#2980b9"
    finally:
        plt.close(fig)


def test_missing_keys_take_the_class_defaults():
    # LineClass / PointsClass fromJSON({}): line 3 px solid drawn, points radius 4 circle drawn.
    session = demo("demo-tp-binneddata")
    plot = plot_by_name(session, BINNED)
    plot["plot"]["data"][0]["line"] = {}
    plot["plot"]["data"][0]["points"] = {}
    fig, ax = render(session, plot)
    try:
        a = series_artists(ax, 0)
        assert a["line"][0].get_linewidth() == pytest.approx(3 * 0.75)
        assert np.abs(marker_px(a["points"][0])).max() == pytest.approx(4)
    finally:
        plt.close(fig)


# ---- shapes and dashes ----------------------------------------------------------------

@pytest.mark.parametrize("shape", ["triangle", "square", "star", "cross", "x"])
def test_marker_shapes_are_the_apps_geometry(shape):
    session = demo("demo-tp-binneddata")
    plot = plot_by_name(session, BINNED)
    plot["plot"]["data"][0]["points"].update(shape=shape, radius=5)
    expected = svg_vertices(js_point_paths(5)[shape])
    fig, ax = render(session, plot)
    try:
        (coll,) = series_artists(ax, 0)["points"]
        got = marker_px(coll)
        assert got.shape == expected.shape
        assert got == pytest.approx(expected, abs=1e-9)
    finally:
        plt.close(fig)


def test_unknown_shape_falls_back_to_a_circle():
    session = demo("demo-tp-binneddata")
    plot = plot_by_name(session, BINNED)
    plot["plot"]["data"][0]["points"]["shape"] = "hexagon"
    fig, ax = render(session, plot)
    try:
        (coll,) = series_artists(ax, 0)["points"]
        assert np.abs(marker_px(coll)).max() == pytest.approx(3)
        assert len(coll.get_paths()[0].vertices) > 12  # a circle, not a polygon marker
    finally:
        plt.close(fig)


@pytest.mark.parametrize("stroke,pattern", [("5, 5", (5, 5)), ("2, 2", (2, 2)),
                                            ("5, 2", (5, 2)), ("solid", None), (-1, None)])
def test_dashes_keep_the_apps_lengths(stroke, pattern):
    session = demo("demo-tp-binneddata")
    plot = plot_by_name(session, BINNED)
    plot["plot"]["data"][1]["line"]["stroke"] = stroke
    fig, ax = render(session, plot)
    try:
        (line,) = series_artists(ax, 1)["line"]
        offset, dashes = line._dash_pattern  # in points, after matplotlib's width scaling
        if pattern is None:
            assert dashes is None
        else:
            assert tuple(d / 0.75 for d in dashes) == pytest.approx(pattern)  # back to px
            assert line.get_dash_capstyle() == "butt"
    finally:
        plt.close(fig)


# ---- gaps -----------------------------------------------------------------------------

def _gap_session(row):
    """demo-tp-binneddata with one missing raw cell (in the data series' y column) and the
    data series' line switched on, as the eye toggle in the app does."""
    session = demo("demo-tp-binneddata")
    plot = plot_by_name(session, BINNED)
    session["rawData"][raw_y(plot)][row] = None
    plot["plot"]["data"][0]["line"]["draw"] = True
    return session, plot


def _runs(line):
    """The drawn polyline runs of a Line2D: maximal stretches of finite vertices."""
    y = np.asarray(line.get_ydata(), dtype=float)
    runs, cur = [], 0
    for v in y:
        if math.isfinite(v):
            cur += 1
        elif cur:
            runs.append(cur)
            cur = 0
    if cur:
        runs.append(cur)
    return runs


def test_missing_y_breaks_the_line_by_default():
    session, plot = _gap_session(20)
    fig, ax = render(session, plot)
    try:
        (line,) = series_artists(ax, 0)["line"]
        assert _runs(line) == [20, 29]  # rows 0..19 and 21..49; no segment 19-20 or 20-21
        # The points skip the missing row and keep the rest.
        assert len(series_artists(ax, 0)["points"][0].get_offsets()) == 49
    finally:
        plt.close(fig)


def test_join_gaps_bridges_the_missing_row():
    session, plot = _gap_session(20)
    plot["plot"]["data"][0]["line"]["joinGaps"] = True
    fig, ax = render(session, plot)
    try:
        (line,) = series_artists(ax, 0)["line"]
        assert _runs(line) == [49]
        xs = list(line.get_xdata())
        assert len(xs) == 49  # row 19 joins straight to row 21
    finally:
        plt.close(fig)


def test_missing_x_breaks_the_line_too():
    # demo-workflow-stats-anscombe "Set I", series 0: raw x and y, 11 rows.
    session = demo("demo-workflow-stats-anscombe")
    plot = plot_by_name(session, "Set I: a real linear relationship")
    assert len(session["rawData"][raw_x(plot)]) == 11
    session["rawData"][raw_x(plot)][5] = None
    plot["plot"]["data"][0]["line"]["draw"] = True
    fig, ax = render(session, plot)
    try:
        (line,) = series_artists(ax, 0)["line"]
        assert _runs(line) == [5, 5]
        assert len(series_artists(ax, 0)["points"][0].get_offsets()) == 10
    finally:
        plt.close(fig)


def test_fewer_than_two_valid_points_draw_no_line_but_keep_the_point():
    session = demo("demo-tp-binneddata")
    plot = plot_by_name(session, BINNED)
    y = raw_y(plot)
    session["rawData"][y] = [None] * 49 + [session["rawData"][y][49]]
    plot["plot"]["data"][0]["line"]["draw"] = True
    fig, ax = render(session, plot)
    try:
        a = series_artists(ax, 0)
        assert a["line"] == []
        assert len(a["points"][0].get_offsets()) == 1
    finally:
        plt.close(fig)


def test_real_trailing_gap_in_the_join_data_demo_draws_the_valid_rows():
    # demo-tp-joindata: two hourly time-axis lines whose last bin is empty.
    session = demo("demo-tp-joindata")
    plot = plot_by_name(session, "Join Data: hourly ambient and hive")
    fig, ax = render(session, plot)
    try:
        for i in (0, 1):
            (line,) = series_artists(ax, i)["line"]
            assert _runs(line) == [72]
            assert line.get_linewidth() == pytest.approx(2.5 * 0.75)
    finally:
        plt.close(fig)


# ---- the other line-and-points plots --------------------------------------------------

@pytest.mark.parametrize("sid,name,fn", [
    ("demo-periodogram-rhythm", "Activity periodogram", rt.plot_periodogram),
    ("demo-fft-rhythm", "Signal FFT", rt.plot_fft),
    ("demo-correlogram-rhythm", "Activity correlogram", rt.plot_correlogram),
])
def test_spectra_draw_line_and_points_at_the_saved_sizes(sid, name, fn):
    session = demo(sid)
    plot = plot_by_name(session, name)
    s0 = plot["plot"]["data"][0]
    assert s0["line"]["draw"] and s0["points"]["draw"]
    fig, ax = render(session, plot, fn)
    try:
        a = series_artists(ax, 0)
        (line,) = a["line"]
        (coll,) = a["points"]
        assert line.get_linewidth() == pytest.approx(s0["line"]["strokeWidth"] * 0.75)
        assert np.abs(marker_px(coll)).max() == pytest.approx(s0["points"]["radius"])
        assert matplotlib.colors.to_rgba(line.get_color()) == pytest.approx(
            tuple(coll.get_facecolor()[0]))
    finally:
        plt.close(fig)
    # Hidden in the app, hidden in the export.
    s0["line"]["draw"] = False
    s0["points"]["draw"] = False
    fig, ax = render(session, plot, fn)
    try:
        assert series_artists(ax, 0) == {"line": [], "points": []}
    finally:
        plt.close(fig)


# ---- overlays share the unit rule -----------------------------------------------------

def test_overlay_widths_use_the_same_px_to_points_rule_as_the_series():
    from test_plot_overlays import ov
    session = demo("demo-tp-binneddata")
    plot = plot_by_name(session, BINNED)
    plot["plot"]["overlays"] = [
        ov(1, "line", "horizontal", at=[20], strokeWidth=2.5, stroke="5, 5"),
        ov(2, "band", "vertical", start=[5], end=[10], edge=True, edgeWidth=2),
    ]
    fig, ax = render(session, plot)
    try:
        (rule,) = [a for a in ax.lines if a.get_gid() == "overlay-1"]
        # Same app width, same exported width, as a series line of 2.5 px.
        assert rule.get_linewidth() == pytest.approx(2.5 * 0.75)
        assert series_artists(ax, 1)["line"][0].get_linewidth() == rule.get_linewidth()
        assert tuple(d / 0.75 for d in rule._dash_pattern[1]) == pytest.approx((5, 5))
        edges = [a for a in ax.lines if a.get_gid() == "overlay-2"]
        assert edges and all(a.get_linewidth() == pytest.approx(2 * 0.75) for a in edges)
    finally:
        plt.close(fig)


def test_a_points_series_and_a_line_series_get_different_automatic_colours():
    # Series 0 points only, series 1 line only (as saved), both colours automatic. In the app
    # they are two columns, so two colours; matplotlib's separate line and scatter cycles
    # would both start at C0.
    session = demo("demo-tp-binneddata")
    plot = automatic_colours(plot_by_name(session, BINNED))
    fig, ax = render(session, plot)
    try:
        pts = tuple(series_artists(ax, 0)["points"][0].get_facecolor()[0])
        line = matplotlib.colors.to_rgba(series_artists(ax, 1)["line"][0].get_color())
        assert pts == pytest.approx(matplotlib.colors.to_rgba("C0"))
        assert line == pytest.approx(matplotlib.colors.to_rgba("C1"))
    finally:
        plt.close(fig)
