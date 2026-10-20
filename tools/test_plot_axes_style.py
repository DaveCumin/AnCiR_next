#!/usr/bin/env python3
"""
The exported figures' look (axes, ticks, gridlines, type) checked against what the APP draws.

The cases and the expected drawing come from the app itself:
src/lib/_parity/emitAxisStyle.svelte.test.js loads real demo sessions, changes a saved
setting where a case says so (a display zone, a tick count, manual ticks, gridlines off, a
log axis, a figure type size, a time tick format, actogram row labels, the heatmap), mounts
the real plot component and records every axis's ticks (value, label, gridline or not), its
tick and title type sizes, its title, the scale domains, the legend and colour-bar type sizes,
the actogram's row labels and heatmap cells. The fixture is tools/parity/axis_style_app.json
(regenerate: GEN_AXIS_STYLE=1 pnpm vitest run src/lib/_parity/emitAxisStyle.svelte.test.js).

Pinned here, exactly unless said otherwise:
  - tick values and labels on every axis: time axes in the display zone (UTC, Asia/Kolkata,
    Europe/London, and America/New_York across its change to daylight time), with the plot's
    own tick format; linear axes (d3 ',.Nf' with the Unicode minus); log axes (the
    Periodogram/FFT '~g' labels and d3's own SI labels, only the labelled ones); manual ticks;
    category ticks; the saved tick counts;
  - gridlines: on or off per axis, only at labelled ticks, none on the crossing axis line;
  - the axis domains (to 1e-6 of the span);
  - tick, axis title, legend, colour bar and row label sizes (pt = 0.75 px) and the family;
  - the actogram's row labels and its heatmap: every cell's place and colour, and the scale
    bar's end labels.

    tools/.venv/bin/python -m pytest tools/test_plot_axes_style.py -q
"""

from __future__ import annotations

import copy
import json
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

FIXTURE = json.loads((HERE / "parity" / "axis_style_app.json").read_text())
CASES = {c["name"]: c for c in FIXTURE["cases"]}
DEMOS = ROOT / "static" / "sessions" / "demos"

# Which app scale each matplotlib axis shows, per plot type.
DOMAIN_KEYS = {
    "scatterplot": {"bottom": "XScale", "left": "YScaleLeft", "right": "YScaleRight"},
    "periodogram": {"bottom": "overlayXScale", "left": "yScale"},
    "fft": {"bottom": "overlayXScale", "left": "yScale"},
    "correlogram": {"bottom": "overlayXScale", "left": "overlayYScale"},
    "boxplot": {"left": "overlayYScale"},
    "actogram": {},
}


@pytest.fixture(autouse=True)
def _reset():
    yield
    rt.set_display_timezone("utc")
    plt.close("all")


_RENDERED = {}


def render(name):
    """Render one case's plot as the exported script does: (fig, axes by position, case)."""
    case = CASES[name]
    session = json.loads((DEMOS / f"{case['demo']}.json").read_text())
    cols, _raw, errors = run_session(session)
    assert not errors, errors
    # The app's names for node outputs, as the export carries them (columnLabels).
    for cid, label in (case.get("columnLabels") or {}).items():
        if int(cid) in cols:
            cols[int(cid)].label = label
    rt.set_display_timezone(case["zone"])
    plot = copy.deepcopy(case["plotJSON"])
    # The saved padding, as the emitter's jsdom (which cannot measure text) lays the plot out;
    # the automatic padding is checked on its own below.
    fig, ax = rt.render_plot_figure(plot, cols, auto_pad=False)
    fig.canvas.draw()
    by_pos = {"bottom": ax, "top": ax, "left": ax}
    for other in fig.axes:
        if other is not ax and other.get_gid() != "colour-key" and \
                other.spines["right"].get_visible():
            by_pos["right"] = other
    return fig, ax, by_pos, case


def axis_of(by_pos, pos):
    a = by_pos[pos]
    return a, (a.xaxis if pos in ("bottom", "top") else a.yaxis)


def is_time(case, pos):
    return pos == "bottom" and case["plotJSON"]["type"] == "scatterplot" and \
        any(t["value"] > 1e11 for t in case["expected"]["axes"]["bottom"]["ticks"])


def to_app(case, pos, v):
    return rt._datenum_to_ms(v) if is_time(case, pos) else v


def drawn_ticks(case, by_pos, pos):
    a, axis = axis_of(by_pos, pos)
    lo, hi = sorted(a.get_xlim() if pos in ("bottom", "top") else a.get_ylim())
    out = []
    for loc, lab in zip(axis.get_ticklocs(), axis.get_ticklabels()):
        if lo - 1e-9 * abs(hi - lo) <= loc <= hi + 1e-9 * abs(hi - lo):
            out.append((to_app(case, pos, loc), lab.get_text()))
    return out


def close(a, b, span):
    return abs(a - b) <= max(1e-6 * abs(span), 1e-9) or (abs(a - b) <= 1.5 and abs(a) > 1e11)


CASE_NAMES = sorted(CASES)


@pytest.mark.parametrize("name", CASE_NAMES)
def test_every_axis_has_the_apps_ticks_and_labels(name):
    _fig, _ax, by_pos, case = render(name)
    exp_axes = case["expected"]["axes"]
    for pos, exp in exp_axes.items():
        got = drawn_ticks(case, by_pos, pos)
        want = [(t["value"], t["label"]) for t in exp["ticks"]]
        if case["plotJSON"]["type"] == "boxplot" and pos == "bottom":
            # KNOWN GAP: the export draws one box per SERIES (labelled by the series), the
            # app one per x CATEGORY per series; only the value axis is the app's.
            continue
        assert [lab for _, lab in got] == [lab for _, lab in want], (name, pos)
        span = (want[-1][0] - want[0][0]) if len(want) > 1 else 1
        assert all(close(g, w, span) for (g, _), (w, _) in zip(got, want)), (name, pos, got, want)


@pytest.mark.parametrize("name", CASE_NAMES)
def test_gridlines_follow_each_axis_setting(name):
    fig, ax, by_pos, case = render(name)
    for pos, exp in case["expected"]["axes"].items():
        want = [t["value"] for t in exp["ticks"] if t["grid"]]
        lines = [ln for a in fig.axes for ln in a.lines if ln.get_gid() == f"gridline-{pos}"]
        if pos in ("bottom", "top"):
            got = sorted(to_app(case, pos, ln.get_xdata()[0]) for ln in lines)
        else:
            got = sorted(ln.get_ydata()[0] for ln in lines)
        assert len(got) == len(want), (name, pos, got, want)
        span = (max(want) - min(want)) if len(want) > 1 else 1
        assert all(close(g, w, span) for g, w in zip(got, sorted(want))), (name, pos, got, want)
        for ln in lines:
            # Axis.svelte: stroke grey, 1 px, dash 4, opacity 0.8; beneath the data.
            assert to_rgba(ln.get_color())[:3] == pytest.approx(to_rgba("grey")[:3])
            assert ln.get_alpha() == pytest.approx(0.8)
            assert ln.get_linewidth() == pytest.approx(0.75)
            assert ln.get_zorder() < 1
            # Gridlines of a right axis are drawn in the host axes, under every series.
            assert ln.axes is ax


@pytest.mark.parametrize("name", CASE_NAMES)
def test_axis_domains_are_the_apps(name):
    _fig, _ax, by_pos, case = render(name)
    keys = DOMAIN_KEYS[case["plotJSON"]["type"]]
    domains = case["expected"]["domains"]
    for pos, key in keys.items():
        if pos not in case["expected"]["axes"] or key not in domains:
            continue
        a = by_pos[pos]
        lims = a.get_xlim() if pos in ("bottom", "top") else a.get_ylim()
        got = [to_app(case, pos, v) for v in lims]
        want = domains[key]
        span = want[1] - want[0]
        assert all(close(g, w, span) for g, w in zip(got, want)), (name, pos, got, want)


@pytest.mark.parametrize("name", CASE_NAMES)
def test_type_sizes_and_family_are_the_figure_styles(name):
    fig, ax, by_pos, case = render(name)
    exp = case["expected"]
    serif = exp["fontFamily"].startswith("Georgia")
    families = rt._STYLE_FONT_FAMILIES["serif" if serif else "sans"]
    for pos, e in exp["axes"].items():
        _a, axis = axis_of(by_pos, pos)
        labels = [t for t in axis.get_ticklabels() if t.get_text()]
        assert labels, (name, pos)
        assert all(t.get_fontsize() == pytest.approx(e["tickPx"] * 0.75) for t in labels)
        assert all(t.get_fontfamily()[0] in families for t in labels)
        assert axis.label.get_text() == e["label"]
        if e["label"]:
            assert axis.label.get_fontsize() == pytest.approx(e["labelPx"] * 0.75)
    # The export's title: the figure's title size, bold.
    title = [t for t in fig.texts if t.get_gid() == "export-title"]
    assert len(title) == 1 and title[0].get_text() == case["plotJSON"]["name"]
    assert title[0].get_fontsize() == pytest.approx(exp["sizes"]["title"] * 0.75)
    # The legend, when shown, at the app's size.
    leg = ax.get_legend()
    if exp["legend"]:
        assert leg is not None
        got = [(t.get_text(), t.get_fontsize()) for t in leg.get_texts()]
        assert got == [(e["text"], pytest.approx(e["px"] * 0.75)) for e in exp["legend"]]
    else:
        assert leg is None


def test_the_colour_bar_text_is_the_legend_size():
    fig, ax, _by_pos, case = render("timeColourBy")
    cax = next(a for a in ax.child_axes if a.get_gid() == "colour-key")
    exp = case["expected"]
    labels = [t for t in cax.yaxis.get_ticklabels() if t.get_text()]
    assert sorted(t.get_text() for t in labels) == sorted(e["text"] for e in exp["colourScale"])
    assert all(t.get_fontsize() == pytest.approx(exp["colourScale"][0]["px"] * 0.75)
               for t in labels)
    assert cax.yaxis.label.get_text() == exp["colourScaleTitle"][0]["text"]
    assert cax.yaxis.label.get_fontsize() == pytest.approx(exp["colourScaleTitle"][0]["px"] * 0.75)
    # Beside the plot: the plot area gives up the bar's room, as the app's does.
    w_px, _ = rt._axes_px(ax)
    assert w_px == pytest.approx(exp["plotSize"][0], abs=1.5)
    # No tick marks and no outline (ColourScale draws neither).
    assert cax.yaxis.get_major_ticks()[0].tick2line.get_markersize() == 0
    assert not cax._colorbar.outline.get_visible()


@pytest.mark.parametrize("name", ["actogramRowsHeatmap", "actogramDates"])
def test_actogram_row_labels_are_the_apps(name):
    fig, ax, _by_pos, case = render(name)
    got = [(t.get_text(), t.get_fontsize()) for t in ax.texts
           if t.get_gid() == "actogram-row-label"]
    want = [(e["text"], pytest.approx(e["px"] * 0.75)) for e in case["expected"]["rowLabels"]]
    assert got == want


@pytest.mark.parametrize("name", ["actogramRowsHeatmap", "actogramHeatOffset"])
def test_actogram_heatmap_cells_are_the_apps(name):
    fig, ax, _by_pos, case = render(name)
    exp = case["expected"]
    pc = next(c for c in ax.collections if c.get_gid() == "actogram-heatmap")
    geom = rt.actogram_row_geometry(rt._axes_px(ax)[1], len(set(r for _, r, _ in exp["heatCells"])),
                                    case["plotJSON"]["plot"].get("spaceBetween", 2))
    got = set()
    for path, colour in zip(pc.get_paths(), pc.get_facecolors()):
        x0, y0 = path.vertices.min(axis=0)
        row = round((y0 - geom["gap"]) / (geom["gap"] + geom["height"]))
        got.add((round(float(x0), 6), int(row),
                 tuple(round(float(c) * 255) for c in colour[:3])))
    want = set()
    for x, row, fill in exp["heatCells"]:
        rgb = tuple(int(v) for v in fill[fill.index("(") + 1:-1].split(","))
        want.add((round(x, 6), row, rgb))
    assert got == want
    labels = [t.get_text() for t in ax.texts if t.get_gid() == "actogram-heat-legend-label"]
    assert labels == exp["heatLegend"]


def test_an_actogram_in_bars_mode_has_no_heatmap_and_its_bars_fill_their_rows():
    fig, ax, _by_pos, case = render("actogram")
    assert not [c for c in ax.collections if c.get_gid() == "actogram-heatmap"]
    bars = next(c for c in ax.collections if c.get_gid() == "actogram-bars")
    n_rows = int(max(r[1] for r in rt.actogram_download_data(
        case["plotJSON"], run_session(json.loads(
            (DEMOS / f"{case['demo']}.json").read_text()))[0])[1]))
    geom = rt.actogram_row_geometry(rt._axes_px(ax)[1], n_rows,
                                    case["plotJSON"]["plot"].get("spaceBetween", 2))
    for path in bars.get_paths():
        (x0, y0), (x1, y1) = path.vertices.min(axis=0), path.vertices.max(axis=0)
        row = int((y1 - geom["gap"]) // (geom["gap"] + geom["height"]))
        foot = row * (geom["gap"] + geom["height"]) + geom["gap"] + geom["height"]
        # Every bar stands on its row's foot and is no taller than the row.
        assert y1 == pytest.approx(foot)
        assert y1 - y0 <= geom["height"] + 1e-9


# ---- pieces pinned on their own -------------------------------------------------------------

def test_d3_formats_match_the_apps_strings():
    f = rt.d3_linear_tick_format(-1.05, 1.1, 5)
    assert [f(v) for v in (-1, -0.5, 0, 0.5, 1)] == ["−1.0", "−0.5", "0.0", "0.5", "1.0"]
    assert rt.d3_format(12345.5, ",.0f") == "12,346"  # ties go up, as toFixed does
    assert rt.d3_format(2.5, ",.0f") == "3"
    assert rt.d3_format(-0.0001, ",.0f") == "0"  # no minus on a value that rounds to zero
    assert rt.d3_format(1e-7, "~g") == "1e-7"
    assert rt.d3_format(0.001, "~g") == "0.001"
    assert rt.d3_format(1000000, "~g") == "1e+6"
    assert rt.d3_format(2000, "~s") == "2k"
    assert rt.d3_format(0.5, "~s") == "500m"


def test_time_ticks_are_d3s_utc_intervals_labelled_in_the_zone():
    h = 3600000
    t0 = 1719792000000  # 1 Jul 2024 00:00 UTC
    ticks = rt.d3_utc_ticks(t0 - 1, t0 + 72 * h, 5)
    assert ticks == [t0 + k * 12 * h for k in range(7)]
    assert [rt.time_tick_label(t, "utc") for t in ticks[:3]] == ["Jul", "12:00", "2 Jul"]
    assert [rt.time_tick_label(t, "Asia/Kolkata") for t in ticks[:2]] == ["05:30", "17:30"]
    # Two days a week: unix days (days since 1970) divisible by two, as d3's unixDay.
    two = rt.d3_utc_ticks(t0, t0 + 20 * 24 * h, 8)
    assert all((t // (24 * h)) % 2 == 0 for t in two)


def test_the_title_wraps_as_the_export_does():
    assert rt.wrap_title("one two three four", 9) == ["one two", "three…"]
    assert rt.wrap_title("", 10) == []


def test_a_plot_saved_without_a_style_takes_the_shipped_template():
    look = rt.resolve_figure_style(None)
    assert look["px"]["axisLabel"] == pytest.approx(16)
    assert look["px"]["tick"] == pytest.approx(15)
    assert look["px"]["legend"] == pytest.approx(12)
    m = rt.resolve_figure_style({"fontSize": "m"})
    assert m["px"]["axisLabel"] == pytest.approx(8.5 * 96 / 72)
    assert m["px"]["tick"] == pytest.approx(8.5 * 0.9 * 96 / 72)
