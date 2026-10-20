#!/usr/bin/env python3
"""
Size by in the exported Scatterplot (colour-by plan 2026-10-20, phase 3), checked against what
the APP draws.

The sessions and the expected sizes come from the app itself (the size cases of
src/lib/_parity/emitColourBy.svelte.test.js, fixture tools/parity/colour_by_app.json;
regenerate: GEN_COLOUR_BY=1 pnpm vitest run src/lib/_parity/emitColourBy.svelte.test.js). For
every drawn point the app records its exact radius and the order it is drawn in; per plot,
the size key (entries, "no value", title, marker shape) and where the colour bar and the size
key are placed.

Pinned here, exactly:
  - every point's `s` is (1.5 r m)^2 for the app's radius r px (1 px = 0.75 pt; m the
    shape's largest |coordinate| at r = 1), not a guess from the default size;
  - the points are drawn in the app's order (largest layer first, colour within a layer);
  - a point with no size value keeps the series' point size;
  - the size key's circles, labels, title and "no value" entry, at the app's place and size;
  - the colour bar shares its place with the size key exactly as the app places it (the bar
    shortened so both fit in a shared corner or beside the plot);
  - the plot area the keys take their room from is the app's;
  - the runtime's scale, layers and modes are the app's.

    tools/.venv/bin/python -m pytest tools/test_plot_size_by.py -q
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
import numpy as np  # noqa: E402
import pytest  # noqa: E402

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import ancir_runtime as rt  # noqa: E402
from test_session_parity import run_session  # noqa: E402
from test_plot_colour_by import app_rows, x_coord, rgb255  # noqa: E402

FIXTURE = json.loads((HERE / "parity" / "colour_by_app.json").read_text())
SIZE_CASES = [c for c in FIXTURE["cases"] if c["name"].startswith("size")]
CASES = {c["name"]: c for c in SIZE_CASES}
PLOTS = [(c["name"], i) for c in SIZE_CASES for i in range(len(c["expected"]))]

# The largest |coordinate| of each marker at r = 1 (pointShapes.js): 1 for every shape but
# the rotated cross, whose arm tips sit at (1, 1/3) turned 45 degrees.
SHAPE_REACH = {"x": (1 + 1 / 3) / math.sqrt(2)}


def render(name, plot_index=0):
    """One plot of a size case as the exported PNG draws it: the plot's own size and padding
    (render_plot_figure), so the plot area is the app's. (fig, ax, plot, expected, session)."""
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
    if colours:
        plot["seriesColours"] = colours
    fig, ax = rt.render_plot_figure(plot, cols, auto_pad=False)
    fig.canvas.draw()
    return fig, ax, plot, case["expected"][plot_index], session


def rt_columns(name):
    session = copy.deepcopy(CASES[name]["session"])
    cols, _raw, _errors = run_session(session)
    return cols


@pytest.fixture(autouse=True)
def _reset():
    yield
    rt.set_display_timezone("utc")
    plt.close("all")


def points_of(ax, i):
    found = [a for a in ax.collections if a.get_gid() == f"series-{i}-points"]
    assert len(found) == 1
    return found[0]


def size_key_axes(ax):
    keys = [a for a in ax.child_axes if a.get_gid() == "size-key"]
    return keys[0] if keys else None


def colour_key_axes(ax):
    keys = [a for a in ax.child_axes if a.get_gid() == "colour-key"]
    return keys[0] if keys else None


def px_rect(ax, child):
    """A child axes' rectangle in px from the plot area's top left: (x, y, w, h)."""
    ax_w, ax_h = rt._axes_px(ax)
    p = ax.get_position()
    c = child.get_position()
    x = (c.x0 - p.x0) / p.width * ax_w
    y = (p.y1 - c.y1) / p.height * ax_h
    return x, y, c.width / p.width * ax_w, c.height / p.height * ax_h


# ---- per point --------------------------------------------------------------------------

@pytest.mark.parametrize("name,plot_index", PLOTS)
def test_every_point_has_the_apps_exact_size_in_the_apps_order(name, plot_index):
    _fig, ax, plot, exp, session = render(name, plot_index)
    checked = 0
    for i, s_exp in enumerate(exp["series"]):
        size = s_exp.get("size")
        if not size:
            continue
        order = size["drawOrder"]
        coll = points_of(ax, i)
        xs, ys = app_rows(session, plot, i)
        want_xy = [(x_coord(ax, session, plot, i, xs[r]), float(ys[r])) for r in order]
        np.testing.assert_allclose(np.asarray(coll.get_offsets(), dtype=float), want_xy,
                                   rtol=0, atol=1e-9)
        shape = (plot["plot"]["data"][i].get("points") or {}).get("shape") or "circle"
        m = SHAPE_REACH.get(shape, 1.0)
        want_s = [(1.5 * size["radii"][r] * m) ** 2 for r in order]
        got_s = list(coll.get_sizes())
        assert len(got_s) == len(order)
        np.testing.assert_allclose(got_s, want_s, rtol=1e-12, atol=0)
        checked += len(order)
    assert checked > 0


def test_a_point_with_no_size_value_keeps_the_series_point_size():
    _fig, ax, plot, exp, _session = render("sizeAndColour")
    size = exp["series"][0]["size"]
    radius = plot["plot"]["data"][0]["points"]["radius"]
    # Rows 2 (empty) and 4 ('n/a') have no size value.
    assert size["radii"][2] == radius and size["radii"][4] == radius
    coll = points_of(ax, 0)
    by_row = dict(zip(size["drawOrder"], coll.get_sizes()))
    assert by_row[2] == pytest.approx((1.5 * radius) ** 2)
    assert exp["sizeKey"]["noValue"] == {"r": radius, "label": "no value"}


def test_largest_points_are_drawn_first():
    _fig, ax, _plot, exp, _session = render("sizeManual")
    size = exp["series"][0]["size"]
    # The runtime's own layers of the points it drew, in its drawing order.
    e = rt.scatter_size_encodings(_plot, rt_columns("sizeManual"))[0]
    layers = [e["layer"][r] for r in size["drawOrder"]]
    assert layers == sorted(layers, reverse=True)
    assert len(set(layers)) > 2
    radii = [size["radii"][r] for r in size["drawOrder"]]
    # Within a layer the rows keep their data order (one path per layer in the app).
    assert layers[0] == rt.SIZE_BUCKETS - 1 and radii[-1] == min(radii)
    np.testing.assert_allclose(list(points_of(ax, 0).get_sizes()),
                               [(1.5 * r) ** 2 for r in radii], rtol=1e-12)


# ---- the keys ---------------------------------------------------------------------------

@pytest.mark.parametrize("name,plot_index", PLOTS)
def test_the_size_key_is_the_apps(name, plot_index):
    _fig, ax, _plot, exp, _session = render(name, plot_index)
    key = exp["sizeKey"]
    kax = size_key_axes(ax)
    if key is None:
        assert kax is None
        return
    assert kax is not None
    geom = exp["keyLayout"]["sizeGeometry"]
    at = exp["keyLayout"]["size"]
    x, y, w, h = px_rect(ax, kax)
    assert (x, y, w, h) == pytest.approx((at["x"], at["y"], geom["width"], geom["height"]),
                                         abs=1e-6)
    texts = [t.get_text() for t in kax.texts]
    want = [r["label"] for r in geom["rows"]] + [t["text"] for t in geom["titleLines"]]
    assert texts == want
    circles = [c for c in kax.collections]
    assert len(circles) == len(geom["rows"])
    m = SHAPE_REACH.get(key["shape"], 1.0)
    for coll, row in zip(circles, geom["rows"]):
        assert coll.get_sizes()[0] == pytest.approx((1.5 * row["r"] * m) ** 2, rel=1e-12)
        (cx, cy), = coll.get_offsets()
        assert (cx, cy) == pytest.approx((geom["colW"] / 2, row["cy"]), abs=1e-9)
        assert rgb255(coll.get_facecolors()[0]) == (140, 140, 140)
    labels = [r["label"] for r in geom["rows"]]
    assert labels == [it["label"] for it in key["items"]] + (
        ["no value"] if key["noValue"] else [])
    backdrop = [p for p in ax.patches if p.get_gid() == "size-key-backdrop"]
    position = ((_plot["plot"].get("sizeScale") or {}).get("position")) or "right"
    assert bool(backdrop) == (position != "right")


@pytest.mark.parametrize("name,plot_index", PLOTS)
def test_the_colour_bar_shares_its_place_with_the_size_key_as_the_app_does(name, plot_index):
    _fig, ax, _plot, exp, _session = render(name, plot_index)
    at = exp["keyLayout"]["colour"]
    cax = colour_key_axes(ax)
    if at is None:
        assert cax is None
        return
    x, y, w, h = px_rect(ax, cax)
    assert (x, y) == pytest.approx((at["x"], at["y"]), abs=1e-6)
    assert h == pytest.approx(at["length"], abs=1e-6)


@pytest.mark.parametrize("name,plot_index", PLOTS)
def test_the_plot_area_is_the_apps_after_the_keys_take_their_room(name, plot_index):
    _fig, ax, _plot, exp, _session = render(name, plot_index)
    w, h = rt._axes_px(ax)
    area = exp["keyLayout"]["plotArea"]
    assert (w, h) == pytest.approx((area["w"], area["h"]), abs=1e-6)


def test_a_shared_corner_shortens_the_bar_and_stacks_the_key_above_it():
    _fig, ax, _plot, exp, _session = render("sizeTimeCorner")
    bar = exp["keyLayout"]["colour"]
    size = exp["keyLayout"]["size"]
    geom = exp["keyLayout"]["sizeGeometry"]
    assert bar["length"] < 150
    assert size["y"] + geom["height"] <= bar["y"]


# ---- the runtime's rules are the app's -------------------------------------------------

@pytest.mark.parametrize("name,plot_index", PLOTS)
def test_the_runtime_derives_the_apps_mode_range_and_radii(name, plot_index):
    case = CASES[name]
    session = copy.deepcopy(case["session"])
    cols, _raw, _errors = run_session(session)
    rt.set_display_timezone(session["appState"]["displayTimezone"])
    plot = session["plots"][plot_index]
    sizes = rt.scatter_size_encodings(plot, cols)
    for i, s_exp in enumerate(case["expected"][plot_index]["series"]):
        e = sizes[i]
        if not s_exp.get("size"):
            assert e is None
            continue
        size = s_exp["size"]
        assert e["mode"] == size["mode"]
        assert (e["domain"]["lo"], e["domain"]["hi"]) == (size["domain"]["lo"],
                                                         size["domain"]["hi"])
        assert (e["r_min"], e["r_max"]) == (size["range"]["rMin"], size["range"]["rMax"])
        assert e["title"] == size["title"]
        for r, want in enumerate(size["radii"]):
            if want is not None:
                assert e["r"][r] == pytest.approx(want, rel=1e-14), r


def test_the_scale_is_area_proportional_and_refuses_hour_of_day():
    assert rt.size_radius(0, 2, 10) == 2
    assert rt.size_radius(1, 2, 10) == 10
    assert rt.size_radius(0.5, 2, 10) ** 2 == pytest.approx((4 + 100) / 2)
    assert rt.size_radius(-1, 2, 10) == 2 and rt.size_radius(9, 2, 10) == 10
    assert "hourOfDay" not in rt.size_modes_for("time")
    assert rt.effective_size_mode("hourOfDay", "time") == "daysSinceStart"
    assert rt.size_range(0.1, None) == (1, 10)
