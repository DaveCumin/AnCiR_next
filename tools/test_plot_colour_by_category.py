#!/usr/bin/env python3
"""
Colour by, Category mode (colour-by plan 2026-10-20, v1.1), in the exported Scatterplot,
checked against what the APP draws.

The sessions and the expected colours come from the app itself (the `category*` cases of
src/lib/_parity/emitColourBy.svelte.test.js, fixture tools/parity/colour_by_app.json;
regenerate: GEN_COLOUR_BY=1 pnpm vitest run src/lib/_parity/emitColourBy.svelte.test.js).
Each figure is drawn as the exported PNG draws it (render_plot_figure: the plot's own size and
padding), so the plot area and the key's place are the app's.

Pinned here, exactly:
  - every point and line segment in its category's colour: the session's category colours the
    export carries (`seriesColours[i].colourCategories`), a user-pinned colour among them, the
    Boxplot's greys when monochrome; a missing cell in the series colour, underneath;
  - the category key: its swatches, names, "no value" entry and title at the app's geometry
    (wrapped into columns on a small plot) and the app's place, sharing a corner with the
    size key as the app does; the plot area the key takes its room from;
  - the palette cap: one category more than the palette refuses (nothing coloured, no key);
  - without the app's colours (a session not exported from the app): the default palette by
    first appearance, refused past its length; the runtime's palette is the app's default;
  - labels as the app writes them (JS String: 3.0 is "3"), in the Boxplot's order.

    tools/.venv/bin/python -m pytest tools/test_plot_colour_by_category.py -q
"""

from __future__ import annotations

import copy
import json
import re
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pytest  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import ancir_runtime as rt  # noqa: E402
from test_session_parity import run_session  # noqa: E402
from test_plot_colour_by import check_points, check_line, rgb255  # noqa: E402
from test_plot_size_by import px_rect, colour_key_axes, size_key_axes  # noqa: E402

FIXTURE = json.loads((HERE / "parity" / "colour_by_app.json").read_text())
CAT_CASES = [c for c in FIXTURE["cases"] if c["name"].startswith("category")]
CASES = {c["name"]: c for c in CAT_CASES}
PLOTS = [(c["name"], i) for c in CAT_CASES for i in range(len(c["expected"]))]


def render(name, plot_index=0, with_colours=True):
    """One plot of a category case as the exported PNG draws it. (fig, ax, plot, expected,
    session). `with_colours=False` drops the export's resolved colours (a session not exported
    from the app)."""
    case = CASES[name]
    session = copy.deepcopy(case["session"])
    cols, _raw, errors = run_session(session)
    assert not errors, errors
    for cid, label in (session.get("columnLabels") or {}).items():
        if int(cid) in cols:
            cols[int(cid)].label = label
    rt.set_display_timezone(session["appState"]["displayTimezone"])
    plot = session["plots"][plot_index]
    colours = (session.get("seriesColours") or {}).get(str(plot["id"]))
    if colours and with_colours:
        plot["seriesColours"] = colours
    fig, ax = rt.render_plot_figure(plot, cols, auto_pad=False)
    fig.canvas.draw()
    return fig, ax, plot, case["expected"][plot_index], session


@pytest.fixture(autouse=True)
def _reset():
    yield
    rt.set_display_timezone("utc")
    plt.close("all")


def artist(ax, gid):
    found = [a for a in list(ax.collections) + list(ax.lines) if a.get_gid() == gid]
    assert len(found) <= 1, gid
    return found[0] if found else None


# ---- every mark ----------------------------------------------------------------------------

@pytest.mark.parametrize("name,plot_index", PLOTS)
def test_every_point_and_segment_has_the_apps_category_colour(name, plot_index):
    _fig, ax, plot, exp, session = render(name, plot_index)
    for i, s in enumerate(exp["series"]):
        if s["active"]:
            check_points(ax, session, plot, exp, i)
        check_line(ax, session, plot, exp, i)


def test_a_colour_the_user_pinned_is_exported():
    _fig, ax, _plot, exp, _s = render("categoryPoints")
    assert exp["key"]["categories"][0] == {"label": "het", "colour": "#7a1f5c"}
    faces = {rgb255(f) for f in artist(ax, "series-0-points").get_facecolors()}
    assert rgb255("#7a1f5c") in faces


def test_missing_cells_are_drawn_in_the_series_colour_underneath():
    _fig, ax, _plot, exp, _s = render("categoryPoints")
    nv = artist(ax, "series-0-points-novalue")
    # '' and null have no category; the null-y row draws no point at all.
    assert len(nv.get_offsets()) == 2
    assert rgb255(nv.get_facecolors()[0]) == rgb255(exp["series"][0]["resolved"]["points"])
    assert ax.collections.index(nv) < ax.collections.index(artist(ax, "series-0-points"))


def test_monochrome_draws_the_boxplots_greys_by_key_order():
    _fig, ax, _plot, exp, _s = render("categoryMonochrome")
    greys = [c["colour"] for c in exp["key"]["categories"]]
    assert greys == [rt.grey_for_index(i, 3) for i in range(3)]
    for f in artist(ax, "series-0-points").get_facecolors():
        r, g, b = rgb255(f)
        assert r == g == b


# ---- the key -------------------------------------------------------------------------------

@pytest.mark.parametrize("name,plot_index", PLOTS)
def test_the_category_key_is_the_apps_at_the_apps_place(name, plot_index):
    _fig, ax, _plot, exp, _s = render(name, plot_index)
    key = exp["key"]
    kax = colour_key_axes(ax)
    if key is None:
        assert kax is None
        return
    geom = key["geometry"]
    at = exp["keyLayout"]["colour"]
    x, y, w, h = px_rect(ax, kax)
    assert (x, y) == pytest.approx((at["x"], at["y"]), abs=1e-6)
    assert (w, h) == pytest.approx((geom["width"], geom["height"]), abs=1e-6)
    swatches = [p for p in kax.patches
                if p.get_gid() in ("colour-key-category", "colour-key-novalue")]
    assert len(swatches) == len(geom["rows"])
    for p, row in zip(swatches, geom["rows"]):
        assert p.get_gid() == ("colour-key-novalue" if row["noValue"] else "colour-key-category")
        assert (p.get_x(), p.get_y()) == pytest.approx(
            (row["x"], row["y"] + (geom["rowH"] - geom["swatch"]) / 2))
        assert p.get_width() == pytest.approx(geom["swatch"])
        assert rgb255(p.get_facecolor()) == rgb255(row["colour"])
    names = [t for t in kax.texts if t.get_position()[0] > 0 or t.get_va() == "center"]
    assert [t.get_text() for t in names] == [r["label"] for r in geom["rows"]]
    for t, row in zip(names, geom["rows"]):
        assert t.get_position() == pytest.approx(
            (row["x"] + geom["swatch"] + rt.CATEGORY_LABEL_GAP, row["y"] + geom["rowH"] / 2))
    titles = [t for t in kax.texts if t.get_va() == "top"]
    assert [(t.get_text(), t.get_position()[1]) for t in titles] == \
        [(ln["text"], pytest.approx(ln["y"])) for ln in geom["titleLines"]]


@pytest.mark.parametrize("name,plot_index", PLOTS)
def test_the_runtime_geometry_is_the_apps(name, plot_index):
    _fig, ax, plot, exp, _s = render(name, plot_index)
    key = exp["key"]
    if key is None:
        return
    at = exp["keyLayout"]["colour"]
    font_px = rt._colour_key_font_px(plot["plot"].get("colourScale"), rt.plot_look(plot))
    g = rt.category_key_geometry([(c["label"], c["colour"]) for c in key["categories"]],
                                 key["noValue"], key["title"], font_px, at["length"])
    want = key["geometry"]
    assert (g["width"], g["height"], g["columns"], g["per_column"]) == pytest.approx(
        (want["width"], want["height"], want["columns"], want["perColumn"]))
    assert [(r["label"], r["x"], r["y"]) for r in g["rows"]] == \
        [(r["label"], pytest.approx(r["x"]), pytest.approx(r["y"])) for r in want["rows"]]


@pytest.mark.parametrize("name,plot_index", PLOTS)
def test_the_plot_area_is_the_apps_after_the_key_takes_its_room(name, plot_index):
    _fig, ax, _plot, exp, _s = render(name, plot_index)
    assert rt._axes_px(ax) == pytest.approx(
        (exp["keyLayout"]["plotArea"]["w"], exp["keyLayout"]["plotArea"]["h"]), abs=1e-6)


def test_a_small_plot_wraps_the_categories_into_columns():
    _fig, ax, _plot, exp, _s = render("categoryWrap")
    geom = exp["key"]["geometry"]
    assert geom["columns"] > 1
    xs = sorted({p.get_x() for p in colour_key_axes(ax).patches})
    assert len(xs) == geom["columns"]


def test_the_category_key_and_the_size_key_share_a_corner_without_overlap():
    _fig, ax, _plot, exp, _s = render("categoryNumbers")
    kx, ky, kw, kh = px_rect(ax, colour_key_axes(ax))
    sx, sy, sw, sh = px_rect(ax, size_key_axes(ax))
    at = exp["keyLayout"]["size"]
    assert (sx, sy) == pytest.approx((at["x"], at["y"]), abs=1e-6)
    assert ky + kh <= sy or sy + sh <= ky or kx + kw <= sx or sx + sw <= kx


# ---- the palette cap -------------------------------------------------------------------------

def test_past_the_palette_nothing_is_coloured_and_there_is_no_key():
    _fig, ax, plot, exp, _s = render("categoryRefused")
    assert exp["series"][0]["refusal"].startswith("This column has 10 categories")
    assert colour_key_axes(ax) is None
    assert artist(ax, "series-0-points-novalue") is None
    faces = {rgb255(f) for f in artist(ax, "series-0-points").get_facecolors()}
    assert faces == {rgb255(exp["series"][0]["resolved"]["points"])}


# ---- without the app's colours ----------------------------------------------------------------

def test_the_runtime_palette_is_the_apps_default():
    src = (ROOT / "src" / "lib" / "core" / "core.svelte.js").read_text()
    block = re.search(r"appColours: \[(.*?)\]", src, re.S).group(1)
    assert tuple(re.findall(r"'(#[0-9A-Fa-f]+)'", block)) == rt.APP_PALETTE


def test_without_the_apps_colours_the_default_palette_by_first_appearance():
    case = CASES["categoryNumbers"]
    session = copy.deepcopy(case["session"])
    cols, _raw, _e = run_session(session)
    plot = session["plots"][0]
    (enc,) = rt.scatter_colour_encodings(plot, cols)
    # Ids 3, 1, 2, 10 appear in that order and claim slots 0..3; the key reads 1, 2, 3, 10.
    assert enc["categories"] == ["1", "2", "3", "10"]
    assert enc["palette"] == [rt.APP_PALETTE[1], rt.APP_PALETTE[2], rt.APP_PALETTE[0],
                              rt.APP_PALETTE[3]]
    assert enc["idx"] == [2, 0, 1, 3, 2, 0, 1, 3]


def test_without_the_apps_colours_too_many_categories_refuse():
    case = CASES["categoryRefused"]
    session = copy.deepcopy(case["session"])
    cols, _raw, _e = run_session(session)
    assert rt.scatter_colour_encodings(session["plots"][0], cols) == [None]


def test_labels_and_order_are_the_apps():
    assert rt.category_label(3.0) == "3"
    assert rt.category_label("  ") is None and rt.category_label(float("nan")) is None
    dom = rt.category_domain([["b", None, "10", "a"], ["2", "b"]])
    assert dom["first_seen"] == ["b", "10", "a", "2"]
    assert rt.category_domain([["10", "9", "100"]])["categories"] == ["9", "10", "100"]
    assert rt.encoding_modes_for("category") == ["category"]
    assert rt.encoding_modes_for("number")[-1] == "category"
    assert "category" not in rt.size_modes_for("number")
    assert "category" not in rt.encoding_modes_for("time")


def test_the_apps_refusal_wins_over_the_runtimes_own_cap():
    """A shorter palette in the app refuses sooner than the runtime's default palette would:
    the export's `refused` is followed (nothing coloured, no key)."""
    case = CASES["categoryNumbers"]
    session = copy.deepcopy(case["session"])
    cols, _raw, _e = run_session(session)
    plot = session["plots"][0]
    plot["seriesColours"] = [{"colourCategories": {"refused": True}}]
    assert rt.scatter_colour_encodings(plot, cols) == [None]
    fig, ax = rt.render_plot_figure(plot, cols, auto_pad=False)
    assert colour_key_axes(ax) is None
