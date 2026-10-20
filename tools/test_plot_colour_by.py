#!/usr/bin/env python3
"""
Colour by in the exported Scatterplot (colour-by plan 2026-10-20, phase 1d), checked against
what the APP draws.

The sessions and the expected colours come from the app itself:
src/lib/_parity/emitColourBy.svelte.test.js builds them with the real plot classes, saves them
with outputCoreAsJson() (plus the export's columnLabels and seriesColours) and records, for
every series, the colour bucket and colour of each point, the coloured line's segments and
colours (colouredLine.js), the colour bar (title, ticks, "no value"), the legend swatches and
the colours a series without a saved colour resolves to. The fixture is
tools/parity/colour_by_app.json (regenerate: GEN_COLOUR_BY=1 pnpm vitest run
src/lib/_parity/emitColourBy.svelte.test.js).

Pinned here, per point and per segment, exactly (0/255):
  - modes (value, hour of day in the display zone, day of year, days since start, wrapped
    hours), the range (shared by series on one column, facet-wide, manual ends), the cyclic
    wrap, the 64-bucket colours, "no value" marks in the series colour and drawn underneath;
  - the coloured line (each segment the colour of its starting row, the series line colour
    when that row has no value; solid; gaps broken unless joinGaps);
  - monochrome (greys / cyclic greys at draw time);
  - the colour bar's colours, ticks, title and "no value" swatch;
  - the legend: line plus marker for a series drawing both, grey for a coloured series;
  - a series with no saved colour in the app's resolved colour, not matplotlib's palette;
  - the runtime's colour tables are the app's (and the pinned matplotlib stops).

    tools/.venv/bin/python -m pytest tools/test_plot_colour_by.py -q
"""

from __future__ import annotations

import copy
import json
import math
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from matplotlib.colors import to_rgba  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import ancir_runtime as rt  # noqa: E402
from test_session_parity import run_session  # noqa: E402

FIXTURE = json.loads((HERE / "parity" / "colour_by_app.json").read_text())
STOPS_JSON = json.loads(
    (ROOT / "src" / "lib" / "components" / "plotbits" / "colormapStops.json").read_text())
CASES = {c["name"]: c for c in FIXTURE["cases"]}
DPI = 96


# ---- helpers --------------------------------------------------------------------------

def rgb255(c):
    """Any colour (CSS 'rgb(r, g, b)', hex, matplotlib RGBA) as an (r, g, b) 0..255 tuple."""
    if isinstance(c, str) and c.startswith("rgb"):
        c = rt._mpl_colour(c)
    r, g, b, _a = to_rgba(c)
    return (round(r * 255), round(g * 255), round(b * 255))


def render_case(name, plot_index=0):
    """Render one plot of a fixture case as the exported script does; returns
    (fig, ax, plot, expected, session)."""
    case = CASES[name]
    session = copy.deepcopy(case["session"])
    cols, _raw, errors = run_session(session)
    assert not errors, errors
    for cid, label in (session.get("columnLabels") or {}).items():
        if int(cid) in cols:
            cols[int(cid)].label = label
    rt.set_display_timezone(session["appState"]["displayTimezone"])
    plot = session["plots"][plot_index]
    # What pythonExport.js does with the caller's seriesColours.
    colours = (session.get("seriesColours") or {}).get(str(plot["id"]))
    if colours:
        plot["seriesColours"] = colours
    fig, ax = plt.subplots(figsize=(8, 5), dpi=DPI)
    has_right = any(s.get("yAxis") == "right" for s in plot["plot"]["data"])
    rt.plot_scatterplot(plot, cols, ax, ax.twinx() if has_right else None)
    fig.canvas.draw()
    return fig, ax, plot, case["expected"][plot_index], session


@pytest.fixture(autouse=True)
def _reset_zone_and_close():
    yield
    rt.set_display_timezone("utc")
    plt.close("all")


def artist(ax, gid):
    found = [a for a in list(ax.collections) + list(ax.lines) if a.get_gid() == gid]
    assert len(found) <= 1, gid
    return found[0] if found else None


def x_number(v):
    """An app x value (a number, or epoch ms for a time column) as a matplotlib coordinate."""
    return float(v)


def app_rows(session, plot, i):
    """The series' x and y cells as the app reads them (rawData through the column ids)."""
    s = plot["plot"]["data"][i]
    by_id = {c["id"]: c for c in session["data"]}

    def cells(ref):
        return session["rawData"][str(by_id[ref]["data"])]

    return cells(s["x"]["refId"]), cells(s["y"]["refId"])


def valid(v):
    return v is not None and not (isinstance(v, float) and math.isnan(v))


def x_coord(ax, session, plot, i, v):
    s = plot["plot"]["data"][i]
    x_col = next(c for c in session["data"] if c["id"] == s["x"]["refId"])
    if x_col["type"] == "time":
        return mdates.date2num(np.datetime64(int(v), "ms"))
    return float(v)


def expected_point_groups(exp_series, xs, ys):
    """(no-value rows, coloured rows in draw order): no value underneath, then buckets in
    index order with rows in data order inside each bucket (Points.svelte)."""
    idx = exp_series["idx"]
    # The rows the app draws a point for (valid x and y, points shown).
    rows = [r for r, c in enumerate(exp_series["pointColours"]) if c is not None]
    assert all(valid(xs[r]) and valid(ys[r]) for r in rows)
    bucket = (lambda r: idx[r] if r < len(idx) else -1)
    none = [r for r in rows if bucket(r) < 0]
    coloured = sorted((r for r in rows if bucket(r) >= 0), key=bucket)
    return none, coloured


def check_points(ax, session, plot, exp, i):
    s_exp = exp["series"][i]
    xs, ys = app_rows(session, plot, i)
    none, coloured = expected_point_groups(s_exp, xs, ys)
    for gid, rows in ((f"series-{i}-points", coloured), (f"series-{i}-points-novalue", none)):
        coll = artist(ax, gid)
        if not rows:
            assert coll is None, gid
            continue
        assert coll is not None, gid
        offsets = coll.get_offsets()
        assert len(offsets) == len(rows), gid
        want_xy = [(x_coord(ax, session, plot, i, xs[r]), float(ys[r])) for r in rows]
        np.testing.assert_allclose(np.asarray(offsets, dtype=float), want_xy, rtol=0, atol=1e-9)
        faces = coll.get_facecolors()
        if len(faces) == 1:
            faces = np.repeat(faces, len(rows), axis=0)
        got = [rgb255(f) for f in faces]
        want = [rgb255(s_exp["pointColours"][r]) for r in rows]
        assert got == want, gid
    # No-value points sit UNDER the coloured ones (drawn first at the same zorder).
    nv, col = artist(ax, f"series-{i}-points-novalue"), artist(ax, f"series-{i}-points")
    if nv is not None and col is not None:
        assert ax.collections.index(nv) < ax.collections.index(col)
        assert nv.get_zorder() <= col.get_zorder()


def check_line(ax, session, plot, exp, i):
    s_exp = exp["series"][i]
    lc = artist(ax, f"series-{i}-line")
    if not s_exp["segments"]:
        return lc
    from matplotlib.collections import LineCollection
    assert isinstance(lc, LineCollection)
    xs, ys = app_rows(session, plot, i)
    want = [[(x_coord(ax, session, plot, i, xs[a]), float(ys[a])),
             (x_coord(ax, session, plot, i, xs[b]), float(ys[b]))]
            for a, b, _c in s_exp["segments"]]
    got = [np.asarray(seg) for seg in lc.get_segments()]
    assert len(got) == len(want)
    for g, w in zip(got, want):
        np.testing.assert_allclose(g, w, rtol=0, atol=1e-9)
    assert [rgb255(c) for c in lc.get_colors()] == [rgb255(c) for _a, _b, c in s_exp["segments"]]
    # Solid, round caps and joins, the app's width in points.
    assert all(ls[1] is None for ls in lc.get_linestyles())
    assert lc.get_capstyle() == "round" and lc.get_joinstyle() == "round"
    width = (plot["plot"]["data"][i].get("line") or {}).get("strokeWidth", 3)
    assert lc.get_linewidths()[0] == pytest.approx(width * 0.75)
    return lc


def colour_key_axes(ax):
    keys = [a for a in ax.child_axes if a.get_gid() == "colour-key"]
    return keys[0] if keys else None


def check_key(ax, exp):
    key = exp["key"]
    cax = colour_key_axes(ax)
    if key is None:
        assert cax is None
        return None
    assert cax is not None
    vertical = cax.get_position().height > cax.get_position().width
    axis = cax.yaxis if vertical else cax.xaxis
    ticks = [(round(float(t), 9), lab.get_text()) for t, lab in
             zip(axis.get_ticklocs(), axis.get_ticklabels())]
    assert ticks == [(round(t["t"], 9), t["label"]) for t in key["ticks"]]
    assert axis.get_label().get_text() == key["title"]
    # The bar's colours are the 64 bucket colours of the map the app draws.
    # (The colorbar's drawn cells, low end first.)
    got = [rgb255(c) for c in cax._colorbar.solids.get_facecolors()]
    assert got == [rgb255(c) for c in FIXTURE["bucketColours"][key["colormap"]]]
    leg = cax.get_legend()
    if key["noValue"]:
        assert leg is not None
        assert [t.get_text() for t in leg.get_texts()] == ["no value"]
        assert rgb255(leg.legend_handles[0].get_facecolor()) == rgb255(key["noValue"]["colour"])
    else:
        assert leg is None
    return cax


def legend_entries(ax):
    leg = ax.get_legend()
    if leg is None:
        return {}
    return {t.get_text(): h for t, h in zip(leg.get_texts(), leg.legend_handles)}


def check_legend(ax, exp):
    entries = legend_entries(ax)
    for s in exp["series"]:
        item = s["legend"]
        if item is None:
            continue
        h = entries[item["label"]]
        kinds = {el["type"]: el for el in item["elements"]}
        if "line" in kinds:
            assert h.get_linewidth() == pytest.approx(kinds["line"]["strokeWidth"] * 0.75)
            assert rgb255(h.get_color()) == rgb255(kinds["line"]["color"])
        else:
            assert h.get_linestyle() in ("None", "none", "")
        if "points" in kinds:
            assert h.get_marker() not in (None, "None", "none", "")
            assert rgb255(h.get_markerfacecolor()) == rgb255(kinds["points"]["color"])
            r_pt = kinds["points"]["size"] * 0.75
            if kinds["points"]["shape"] == "circle":
                assert h.get_markersize() == pytest.approx(2 * r_pt)
        else:
            assert h.get_marker() in (None, "None", "none", "")


# ---- the colour tables -------------------------------------------------------------------

def test_runtime_colormaps_are_the_apps_tables():
    assert set(rt.COLORMAPS) == set(FIXTURE["colormaps"])
    for name, stops in FIXTURE["colormaps"].items():
        assert [list(s) for s in rt.COLORMAPS[name]] == stops, name


def test_runtime_stops_are_the_pinned_matplotlib_stops():
    for name, stops in STOPS_JSON["stops"].items():
        assert [list(s) for s in rt.COLORMAPS[name]] == stops, name


def test_bucket_colours_equal_the_apps_for_every_map():
    for name, colours in FIXTURE["bucketColours"].items():
        assert [rt._rgb_css(c) for c in rt.bucket_colours(name)] == colours, name


def test_bucket_colours_are_within_one_step_of_matplotlibs_own_map():
    for name in ("viridis", "magma", "twilight_shifted"):
        cm = matplotlib.colormaps[name]
        for b, got in enumerate(rt.bucket_colours(name)):
            want = rgb255(cm((b + 0.5) / 64))
            assert max(abs(g - w) for g, w in zip(got, want)) <= 1, (name, b)


def test_colour_values_print_as_the_app_prints_them():
    for v, mode, want in FIXTURE["formatSamples"]:
        assert rt.format_colour_value(math.nan if v is None else v, mode) == want, (v, mode)


# ---- per point, per segment ------------------------------------------------------------

POINT_CASES = [(c["name"], i) for c in FIXTURE["cases"] for i in range(len(c["expected"]))]


@pytest.mark.parametrize("name,plot_index", POINT_CASES)
def test_every_point_and_segment_has_the_apps_colour(name, plot_index):
    _fig, ax, plot, exp, session = render_case(name, plot_index)
    for i, s in enumerate(exp["series"]):
        if s["active"]:
            check_points(ax, session, plot, exp, i)
        check_line(ax, session, plot, exp, i)


@pytest.mark.parametrize("name,plot_index", POINT_CASES)
def test_the_colour_bar_has_the_apps_colours_ticks_and_title(name, plot_index):
    _fig, ax, _plot, exp, _s = render_case(name, plot_index)
    check_key(ax, exp)


@pytest.mark.parametrize("name,plot_index", POINT_CASES)
def test_the_runtime_derives_the_apps_mode_range_and_buckets(name, plot_index):
    case = CASES[name]
    session = copy.deepcopy(case["session"])
    cols, _raw, _errors = run_session(session)
    plot = session["plots"][plot_index]
    encs = rt.scatter_colour_encodings(plot, cols, zone=session["appState"]["displayTimezone"])
    for enc, s in zip(encs, case["expected"][plot_index]["series"]):
        if not s["active"]:
            assert enc is None
            continue
        assert enc["mode"] == s["mode"]
        assert enc["colormap"] == s["colormap"]
        assert enc["title"] == s["title"]
        assert enc["domain"]["lo"] == s["domain"]["lo"]
        assert enc["domain"]["hi"] == s["domain"]["hi"]
        assert enc["domain"]["cyclic"] == s["domain"]["cyclic"]
        assert enc["idx"] == s["idx"]


# ---- the named behaviours ----------------------------------------------------------------

def test_hour_of_day_is_read_in_the_display_zone():
    _fig, ax, _plot, exp, _s = render_case("hourOfDayZone")
    assert exp["key"]["title"] == "Hour of day (Asia/Kolkata)"
    # 18:00 UTC is 23:30 in Kolkata: the top of the scale, then the wrap past midnight.
    assert exp["series"][0]["idx"][:3] == [62, 0, 1]
    assert colour_key_axes(ax).yaxis.get_label().get_text() == "Hour of day (Asia/Kolkata)"


def test_a_manual_range_clamps_and_marks_its_ends():
    _fig, ax, _plot, exp, _s = render_case("manualRange")
    labels = [t.get_text() for t in colour_key_axes(ax).yaxis.get_ticklabels()]
    assert labels == ["≤ 2", "4.75", "≥ 7.5"]
    assert exp["series"][0]["idx"][:3] == [0, 0, 0] and exp["series"][0]["idx"][-2:] == [63, 63]


def test_monochrome_swaps_the_maps_for_greys_at_draw_time():
    _fig, ax, plot, exp, _s = render_case("monochrome")
    assert [s["colormap"] for s in exp["series"]] == ["greys", "greysCyclic"]
    # The saved maps are the user's.
    assert plot["plot"]["data"][0]["colourEncoding"]["colormap"] == "magma"
    for i in (0, 1):
        for f in artist(ax, f"series-{i}-points").get_facecolors():
            r, g, b = rgb255(f)
            assert r == g == b


def test_facet_panels_share_one_range():
    _fig, _ax, _plot, exp, _s = render_case("facets")
    assert [(s["domain"]["lo"], s["domain"]["hi"]) for s in exp["series"]] == [(0, 40), (0, 40)]


def test_no_value_points_are_drawn_in_the_series_colour_and_named_on_the_bar():
    _fig, ax, _plot, exp, _s = render_case("valueLines")
    nv = artist(ax, "series-0-points-novalue")
    assert len(nv.get_offsets()) == 2  # the missing cell and the text cell
    assert rgb255(nv.get_facecolors()[0]) == rgb255(exp["series"][0]["resolved"]["points"])
    assert exp["key"]["noValue"]["label"] == "no value"


def test_a_line_only_series_names_its_no_value_segments_in_the_line_colour():
    _fig, ax, _plot, exp, _s = render_case("lineOnly")
    assert exp["key"]["noValue"]["colour"] == "#aa3311"
    leg = colour_key_axes(ax).get_legend()
    assert rgb255(leg.legend_handles[0].get_facecolor()) == rgb255("#aa3311")
    # Rows past the end of the shorter colour column have no value.
    assert artist(ax, "series-0-points") is None


def test_a_coloured_line_breaks_at_a_gap_unless_it_joins_gaps():
    _fig, ax, _plot, exp, _s = render_case("valueLines")
    segs = [(a, b) for a, b, _c in exp["series"][0]["segments"]]
    assert (4, 5) not in segs and (5, 6) not in segs  # y is missing on row 5
    _fig, ax, _plot, exp, _s = render_case("hourOfDayZone")
    segs = [(a, b) for a, b, _c in exp["series"][0]["segments"]]
    assert (9, 11) in segs  # x is missing on row 10; joinGaps bridges it


@pytest.mark.parametrize("name,plot_index", [("valueLines", 0), ("resolvedColours", 0),
                                             ("resolvedColours", 1), ("lineOnly", 0)])
def test_the_legend_shows_the_apps_swatch(name, plot_index):
    _fig, ax, plot, exp, _s = render_case(name, plot_index)
    if not (plot["plot"].get("legend") or {}).get("show"):
        plot["plot"]["legend"]["show"] = True
        _fig, ax, plot, exp, _s = render_case_with_legend(name, plot_index)
    check_legend(ax, exp)


def render_case_with_legend(name, plot_index):
    case = CASES[name]
    saved = copy.deepcopy(case)
    case["session"]["plots"][plot_index]["plot"]["legend"]["show"] = True
    try:
        return render_case(name, plot_index)
    finally:
        CASES[name] = saved


def test_a_line_and_points_series_has_both_in_its_legend_swatch():
    _fig, ax, _plot, _exp, _s = render_case("resolvedColours", 0)
    h = legend_entries(ax)["hive B"]
    assert h.get_linestyle() not in ("None", "none", "")
    assert h.get_marker() not in (None, "None", "none", "")


def test_series_without_a_saved_colour_use_the_apps_resolved_colour():
    _fig, ax, plot, exp, _s = render_case("resolvedColours", 1)
    # The only series of this plot is the column the first plot drew second: the app gives it
    # that column's colour, where matplotlib's palette by position would give C0.
    want = exp["series"][0]["resolved"]
    assert plot["plot"]["data"][0]["line"]["colour"] is None
    assert rgb255(artist(ax, "series-0-line").get_color()) == rgb255(want["line"])
    assert rgb255(artist(ax, "series-0-points").get_facecolors()[0]) == rgb255(want["points"])
    assert rgb255(want["line"]) != rgb255("C0")


def test_without_resolved_colours_the_old_positional_fallback_remains():
    case = CASES["resolvedColours"]
    session = copy.deepcopy(case["session"])
    cols, _raw, _e = run_session(session)
    plot = session["plots"][1]
    fig, ax = plt.subplots(figsize=(8, 5), dpi=DPI)
    rt.plot_scatterplot(plot, cols, ax)
    assert rgb255(artist(ax, "series-0-line").get_color()) == rgb255("C0")


def test_a_saved_colour_still_wins_over_the_resolved_one():
    _fig, ax, _plot, exp, _s = render_case("lineOnly")
    lc = artist(ax, "series-0-line")
    first = exp["series"][0]["segments"][0]
    assert first[2] == "#aa3311" and rgb255(lc.get_colors()[0]) == rgb255("#aa3311")
