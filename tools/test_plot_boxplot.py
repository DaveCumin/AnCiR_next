#!/usr/bin/env python3
"""
The exported Boxplot checked against what the APP draws.

The cases and the expected drawing come from the app itself:
src/lib/_parity/emitBoxplot.svelte.test.js loads real demo sessions (box plots by day, the
violin groups, the ANOVA and two-group workflows, Group Comparison, the Join Data stack
example's boxplot by Source), changes saved settings where a case says so (points, violins,
the box toggle, the significance method and look, a second series, series with no category
column, monochrome, a user's category colour, box styling, x gridlines), mounts the real
Boxplot and records every mark it draws in px from the plot area's top left. The fixture is
tools/parity/boxplot_app.json (regenerate:
GEN_BOXPLOT=1 pnpm vitest run src/lib/_parity/emitBoxplot.svelte.test.js).

Pinned here, to 1e-6 px unless said otherwise:
  - every box: its centre and half widths (dodged per series), the quartiles, median and
    whisker ends, the outlier rings (place, radius, stroke), fill, stroke, widths and dashes,
    the median's colour and width, in the order the app draws them; and the matplotlib
    artists drawn for them, read back in px;
  - every jittered point (place, radius, fill and its opacity, the darker stroke);
  - every violin outline, vertex for vertex, with its fill, opacity and stroke;
  - the significance brackets (bars, end ticks, the label, its size, colour and baseline) and
    the pairwise statistics behind them (p and adjusted p to 1e-9 relative);
  - the category ticks, the x gridlines at the category centres, both domains, the legend.

    tools/.venv/bin/python -m pytest tools/test_plot_boxplot.py -q
"""

from __future__ import annotations

import copy
import json
import math
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pytest  # noqa: E402
from matplotlib.colors import to_rgba  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import ancir_runtime as rt  # noqa: E402
from test_session_parity import run_session  # noqa: E402

FIXTURE = json.loads((HERE / "parity" / "boxplot_app.json").read_text())
CASES = {c["name"]: c for c in FIXTURE["cases"]}
CASE_NAMES = sorted(CASES)
DEMOS = ROOT / "static" / "sessions" / "demos"
TOL = 1e-6

_SESSIONS = {}


@pytest.fixture(autouse=True)
def _reset():
    yield
    plt.close("all")


def columns_for(case):
    if case["demo"] not in _SESSIONS:
        session = json.loads((DEMOS / f"{case['demo']}.json").read_text())
        cols, _raw, errors = run_session(session)
        assert not errors, errors
        _SESSIONS[case["demo"]] = cols
    cols = _SESSIONS[case["demo"]]
    for cid, label in (case.get("columnLabels") or {}).items():
        if int(cid) in cols:
            cols[int(cid)].label = label
    return cols


def render(name):
    """One case's plot as the exported script draws it, on the saved padding (as the
    emitter's jsdom, which cannot measure text, lays it out)."""
    case = CASES[name]
    plot = copy.deepcopy(case["plotJSON"])
    fig, ax = rt.render_plot_figure(plot, columns_for(case), auto_pad=False)
    fig.canvas.draw()
    return fig, ax, ax._ancir_boxplot, case


def rgba(c):
    return tuple(round(v, 6) for v in to_rgba(c))


def same_colour(a, b):
    return rgba(a) == rgba(b)


def near(a, b, tol=TOL):
    return abs(a - b) <= tol


def dashes(artist):
    """An artist's dash pattern in px: (offset, (on, off, ...)) or (0, None) when solid."""
    off, seq = artist._unscaled_dash_pattern
    if seq is None:
        return (0, None)
    # matplotlib scales the pattern by the width in pt (the px width x 0.75), so a pattern
    # drawn at the app's px lengths is stored divided by the px width.
    w = artist.get_linewidth() / 0.75
    return (off, tuple(round(v * w, 9) for v in seq))


def app_dashes(dasharray, width):
    """An SVG stroke-dasharray ('solid' or '5, 5') as (offset, px pattern)."""
    if dasharray in (None, "solid"):
        return (0, None)
    parts = [float(v) for v in dasharray.replace(",", " ").split()]
    return (0, tuple(parts if len(parts) % 2 == 0 else parts * 2))


class Px:
    """Data coordinates of the drawn artists back to the app's px."""

    def __init__(self, ax, lay):
        self.w, self.h = rt._axes_px(ax)
        self.xd, self.yd = lay["x_domain"], lay["y_domain"]

    def x(self, v):
        return (v - self.xd[0]) / (self.xd[1] - self.xd[0]) * self.w

    def y(self, v):
        return self.h - (v - self.yd[0]) / (self.yd[1] - self.yd[0]) * self.h


def test_the_plot_area_is_the_apps():
    for name in CASE_NAMES:
        _fig, ax, lay, case = render(name)
        w, h = rt._axes_px(ax)
        assert (w, h) == pytest.approx(tuple(case["expected"]["plotSize"]), abs=1e-6), name


@pytest.mark.parametrize("name", CASE_NAMES)
def test_categories_domains_ticks_and_gridlines(name):
    _fig, ax, lay, case = render(name)
    exp = case["expected"]
    assert lay["categories"] == exp["categories"]
    assert lay["category_coloured"] == exp["categoryColoured"]
    assert lay["x_domain"] == pytest.approx(tuple(exp["xDomain"]), abs=1e-9)
    span = exp["yDomain"][1] - exp["yDomain"][0]
    assert lay["y_domain"] == pytest.approx(tuple(exp["yDomain"]), abs=1e-6 * span)
    assert ax.get_xlim() == pytest.approx(tuple(exp["xDomain"]), abs=1e-9)
    ticks = [(t, lab.get_text()) for t, lab in zip(ax.xaxis.get_ticklocs(),
                                                    ax.xaxis.get_ticklabels())]
    assert ticks == [(pytest.approx(t["value"]), t["label"]) for t in exp["ticks"]]
    grid = sorted(ln.get_xdata()[0] for ln in ax.lines if ln.get_gid() == "gridline-bottom")
    assert grid == [t["value"] for t in exp["ticks"] if t["grid"]]


@pytest.mark.parametrize("name", CASE_NAMES)
def test_every_box_is_the_apps(name):
    _fig, ax, lay, case = render(name)
    px = Px(ax, lay)
    exp = case["expected"]["boxes"]
    got = lay["boxes"]
    assert len(got) == len(exp), name
    for g, e in zip(got, exp):
        assert g["series"] == e["series"]
        for k in ("cx", "halfWidth", "whiskerHalfWidth", "yQ1", "yQ3", "yMedian",
                  "yLowerWhisker", "yUpperWhisker"):
            assert near(g[k], e[k]), (name, k, g[k], e[k])
        assert same_colour(g["fill"], e["fill"]) and same_colour(g["stroke"], e["stroke"])
        # The app draws the fill at the series' saved fill opacity (only the fill: the outline,
        # whiskers, median and rings stay opaque).
        assert e["fillOpacity"] is not None and float(e["fillOpacity"]) == g["fillOpacity"]
        assert g["strokeWidth"] == e["strokeWidth"] and g["dash"] == e["dash"]
        assert e["whiskerDash"] == e["dash"] and e["capDash"] is None
        assert same_colour(g["medianStroke"], e["medianStroke"])
        assert g["medianWidth"] == e["medianWidth"]
        assert [near(a, b) for a, b in zip(g["outliers"], [o["cy"] for o in e["outliers"]])] \
            == [True] * len(e["outliers"]) and len(g["outliers"]) == len(e["outliers"])
        for o in e["outliers"]:
            assert near(o["cx"], e["cx"]) and o["r"] == g["outlierSize"]
            assert same_colour(o["stroke"], e["stroke"]) and o["strokeWidth"] == e["strokeWidth"]

        # What matplotlib drew for it, back in px.
        a = g["artists"]
        r = a["rect"]
        assert near(px.x(r.get_x()), e["cx"] - e["halfWidth"])
        assert near(px.x(r.get_x() + r.get_width()), e["cx"] + e["halfWidth"])
        assert near(px.y(r.get_y() + r.get_height()), e["yQ3"])
        assert near(px.y(r.get_y()), e["yQ1"])
        assert rgba(r.get_facecolor()) == rgba(to_rgba(e["fill"], float(e["fillOpacity"])))
        assert rgba(r.get_edgecolor()) == rgba(e["stroke"])
        assert r.get_linewidth() == pytest.approx(e["strokeWidth"] * 0.75)
        assert dashes(r) == app_dashes(e["dash"], e["strokeWidth"])
        med = a["median"]
        assert [near(px.x(v), w) for v, w in zip(med.get_xdata(), e["medianX"])] == [True] * 2
        assert near(px.y(med.get_ydata()[0]), e["yMedian"])
        assert to_rgba(med.get_color()) == to_rgba(e["medianStroke"])
        assert med.get_linewidth() == pytest.approx(e["medianWidth"] * 0.75)
        for key, y0, y1 in (("lower", "yLowerWhisker", "yQ1"), ("upper", "yQ3", "yUpperWhisker")):
            ln = a[key]
            assert near(px.x(ln.get_xdata()[0]), e["cx"])
            assert near(px.y(ln.get_ydata()[0]), e[y0]) and near(px.y(ln.get_ydata()[1]), e[y1])
            assert dashes(ln) == app_dashes(e["whiskerDash"], e["strokeWidth"])
            cap = a[f"{key}_cap"]
            assert near(px.x(cap.get_xdata()[0]), e["cx"] - e["whiskerHalfWidth"])
            assert near(px.x(cap.get_xdata()[1]), e["cx"] + e["whiskerHalfWidth"])
            assert near(px.y(cap.get_ydata()[0]), e["yLowerCap" if key == "lower" else "yUpperCap"])
            assert dashes(cap) == (0, None)  # the caps are never dashed
            assert to_rgba(cap.get_color()) == to_rgba(e["capStroke"])
        assert near(e["upperCapX"][0], e["cx"] - e["whiskerHalfWidth"])
        assert near(e["upperCapX"][1], e["cx"] + e["whiskerHalfWidth"])
        if e["outliers"]:
            offs = a["outliers"].get_offsets()
            assert [near(px.y(v), o["cy"]) for v, o in zip(offs[:, 1], e["outliers"])] == \
                [True] * len(e["outliers"])
            # A marker's size is its diameter in pt: 2 r px at 0.75 pt to the px.
            assert a["outliers"].get_sizes()[0] == pytest.approx((2 * e["outliers"][0]["r"] * 0.75) ** 2)
            assert a["outliers"].get_facecolors().size == 0
        else:
            assert "outliers" not in a


@pytest.mark.parametrize("name", CASE_NAMES)
def test_every_point_is_the_apps(name):
    _fig, ax, lay, case = render(name)
    px = Px(ax, lay)
    exp = case["expected"]["points"]
    got = lay["points"]
    assert len(got) == len(exp)
    for g, e in zip(got, exp):
        assert g["series"] == e["series"]
        assert near(g["cx"], e["cx"]) and near(g["cy"], e["cy"]), (name, g, e)
        assert g["r"] == e["r"] and g["fillOpacity"] == e["fillOpacity"]
        assert same_colour(g["fill"], e["fill"]) and same_colour(g["stroke"], e["stroke"])
        assert g["strokeWidth"] == e["strokeWidth"]
    # Drawn: each collection's offsets, sizes and colours, in the app's order.
    drawn = []
    seen = set()
    for g in got:
        coll = g["artist"]
        if id(coll) in seen:
            continue
        seen.add(id(coll))
        for (x, y), s, fc, ec in zip(coll.get_offsets(), coll.get_sizes(),
                                     coll.get_facecolors(), coll.get_edgecolors()):
            drawn.append((px.x(x), px.y(y), s, tuple(fc), tuple(ec)))
    assert len(drawn) == len(exp)
    for d, e in zip(drawn, exp):
        assert near(d[0], e["cx"]) and near(d[1], e["cy"])
        assert d[2] == pytest.approx((2 * e["r"] * 0.75) ** 2)
        assert tuple(round(v, 6) for v in d[3]) == rgba(to_rgba(e["fill"], e["fillOpacity"]))
        assert tuple(round(v, 6) for v in d[4]) == rgba(e["stroke"])


@pytest.mark.parametrize("name", CASE_NAMES)
def test_every_violin_is_the_apps(name):
    _fig, ax, lay, case = render(name)
    px = Px(ax, lay)
    exp = case["expected"]["violins"]
    got = lay["violins"]
    assert len(got) == len(exp)
    for g, e in zip(got, exp):
        assert g["series"] == e["series"]
        assert len(g["points"]) == len(e["points"]), name
        for (gx, gy), (ex, ey) in zip(g["points"], e["points"]):
            assert near(gx, ex) and near(gy, ey), (name, gx, gy, ex, ey)
        poly = g["artist"]
        verts = poly.get_xy()[:-1]  # matplotlib closes the polygon with the first vertex
        assert len(verts) == len(e["points"])
        for (vx, vy), (ex, ey) in zip(verts, e["points"]):
            assert near(px.x(vx), ex) and near(px.y(vy), ey)
        assert rgba(poly.get_facecolor()) == rgba(to_rgba(e["fill"], e["fillOpacity"]))
        assert rgba(poly.get_edgecolor()) == rgba(e["stroke"])
        assert poly.get_linewidth() == pytest.approx(e["strokeWidth"] * 0.75)


@pytest.mark.parametrize("name", CASE_NAMES)
def test_significance_brackets_are_the_apps(name):
    _fig, ax, lay, case = render(name)
    px = Px(ax, lay)
    exp = case["expected"]["sigBars"]
    got = lay["sig_bars"]
    assert len(got) == len(exp)
    for g, e in zip(got, exp):
        assert near(g["x1"], e["x1"]) and near(g["x2"], e["x2"]) and near(g["y"], e["y"])
        assert near(g["tick"], e["tickBottom"]) and near(g["tick"], e["tickBottomRight"])
        assert g["label"] == e["label"]
        assert near(g["labelX"], e["labelX"]) and near(g["labelY"], e["labelY"])
        assert g["labelPx"] == pytest.approx(e["labelPx"])
        assert same_colour(g["stroke"], e["stroke"]) and same_colour(g["stroke"], e["labelFill"])
        assert g["strokeWidth"] == e["strokeWidth"] and e["labelAnchor"] == "middle"
        left, bar, right = g["artists"]
        assert near(px.x(bar.get_xdata()[0]), e["x1"]) and near(px.x(bar.get_xdata()[1]), e["x2"])
        assert near(px.y(bar.get_ydata()[0]), e["y"])
        assert near(px.y(left.get_ydata()[0]), e["tickBottom"])
        assert near(px.y(right.get_ydata()[1]), e["tickBottomRight"])
        assert bar.get_linewidth() == pytest.approx(e["strokeWidth"] * 0.75)
        assert not bar.get_clip_on()
        t = g["text"]
        assert t.get_text() == e["label"]
        assert near(px.x(t.get_position()[0]), e["labelX"])
        assert near(px.y(t.get_position()[1]), e["labelY"])
        assert t.get_fontsize() == pytest.approx(e["labelPx"] * 0.75)
        assert t.get_ha() == "center" and t.get_va() == "baseline"
        assert to_rgba(t.get_color()) == to_rgba(e["labelFill"])


@pytest.mark.parametrize("name", CASE_NAMES)
def test_the_pairwise_statistics_are_the_apps(name):
    """The brackets come from the same tests as the app (Group Comparison's Welch t-test,
    Mann-Whitney, one-way ANOVA + Tukey-Kramer, pairwise Mann-Whitney with Holm), on the same
    groups, so every pair's p and adjusted p agree."""
    _fig, _ax, lay, case = render(name)
    exp = case["expected"]["sigTable"]
    got = lay["sig_table"]
    assert [(g["groupA"], g["groupB"], g["significant"]) for g in got] == \
        [(e["groupA"], e["groupB"], e["significant"]) for e in exp]
    for g, e in zip(got, exp):
        for k in ("pValue", "pAdjusted"):
            assert g[k] == pytest.approx(e[k], rel=1e-9, abs=1e-15), (name, k, g, e)
    assert [(e["i"], e["j"], e["level"]) for e in lay["sig_levels"]] == \
        [(e["i"], e["j"], e["level"]) for e in case["expected"]["sigLevels"]]


@pytest.mark.parametrize("name", CASE_NAMES)
def test_the_legend_is_the_apps(name):
    _fig, ax, lay, case = render(name)
    exp = case["expected"]["legend"]
    leg = ax.get_legend()
    if not exp:
        assert leg is None
        return
    assert [t.get_text() for t in leg.get_texts()] == [e["text"] for e in exp]
    assert all(t.get_fontsize() == pytest.approx(e["px"] * 0.75)
               for t, e in zip(leg.get_texts(), exp))
    for h, e in zip(leg.legend_handles, exp):
        sw = e["swatch"]
        # The swatch is the box: its fill at the box's fill opacity.
        assert rgba(h.get_facecolor()) == rgba(to_rgba(sw["fill"], float(sw["fillOpacity"])))
        assert rgba(h.get_edgecolor()) == rgba(sw["stroke"])
        assert h.get_linewidth() == pytest.approx(sw["strokeWidth"] * 0.75)
        assert h.get_width() == pytest.approx(sw["width"] * 0.75)
        assert h.get_height() == pytest.approx(sw["height"] * 0.75)


def test_paint_order_is_the_apps():
    """Violins beneath every box, a box's marks in Box.svelte's order with its points last,
    the brackets above the legend."""
    _fig, ax, lay, _case = render("joinTwoSeries")
    top_violin = max(v["artist"].get_zorder() for v in lay["violins"])
    for b in lay["boxes"]:
        a = b["artists"]
        order = [a[k].get_zorder() for k in ("lower", "lower_cap", "rect", "median", "upper",
                                             "upper_cap")]
        assert order == sorted(order) and order[0] > top_violin
    for p in lay["points"]:
        box = next(b for b in lay["boxes"] if (b["series"], b["category"]) ==
                   (p["series"], p["category"]))
        assert p["artist"].get_zorder() > box["artists"]["upper_cap"].get_zorder()
    _fig, ax, lay, _case = render("seriesNoCategories")
    assert min(a.get_zorder() for sb in lay["sig_bars"] for a in sb["artists"]) > \
        ax.get_legend().get_zorder()


# ---- pieces pinned on their own -------------------------------------------------------------

def test_jitter_is_the_apps_hash():
    # helpers/jitter.js jitterOffset, evaluated in node for these indices.
    assert rt.boxplot_jitter_offset(0, 0, 0) == -0.42380116041749716
    assert rt.boxplot_jitter_offset(2, 4, 49) == -0.19041768042370677
    assert rt.boxplot_jitter_offset(1, 3, 7) == 0.9289054479449987
    assert all(-1 <= rt.boxplot_jitter_offset(s, c, p) < 1
               for s in range(3) for c in range(5) for p in range(50))


def test_darken_colour_is_the_apps():
    assert rt.darken_colour("#234154") == "#172a37"
    assert rt.darken_colour("#abc", 0.5) == "#555e66"
    assert rt.darken_colour("rgb(1, 2, 3)") == "rgb(1, 2, 3)"


def test_box_stats_follow_the_series_rule():
    st = rt.boxplot_box_stats([1, 2, 3, 4, 100])
    assert (st["q1"], st["q2"], st["q3"]) == (2, 3, 4)
    assert st["outliers"] == [100] and st["upperWhisker"] == 4
    z = rt.boxplot_box_stats([1, 2, 3, 4, 100], "zscore", z_threshold=1.5)
    assert z["outliers"] == [100]


def test_a_violin_needs_five_distinct_points():
    assert rt.violin_curve([1, 2, 3, 4]) is None
    assert rt.violin_curve([2, 2, 2, 2, 2]) is None
    c = rt.violin_curve([1, 2, 3, 4, 5])
    assert c["points"][0][0] == 1 and c["points"][-1][0] == 5


def test_without_the_apps_colours_the_export_uses_the_default_palette():
    """A hand-written plot (no seriesColours): categories take the default palette in the order
    they first appear, a monochrome figure greys by place, series colours by position."""
    case = CASES["violinGroups"]
    plot = copy.deepcopy(case["plotJSON"])
    plot.pop("seriesColours", None)
    lay = rt.boxplot_layout(plot, columns_for(case), 440, 255)
    first = list(dict.fromkeys(b["category"] for b in lay["boxes"]))
    want = rt.category_palette_fallback(first, lay["categories"])
    assert [b["fill"] for b in sorted(lay["boxes"], key=lambda b: lay["categories"]
                                      .index(b["category"]))] == want
    plot["style"] = {**(plot.get("style") or {}), "monochrome": True}
    lay = rt.boxplot_layout(plot, columns_for(case), 440, 255)
    greys = [rt.grey_for_index(i, 3) for i in range(3)]
    assert sorted(b["fill"] for b in lay["boxes"]) == sorted(greys)
