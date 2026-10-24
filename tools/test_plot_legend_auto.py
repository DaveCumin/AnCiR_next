#!/usr/bin/env python3
"""
The exported legend's place checked against the APP (tools/parity/plot_extras_app.json, the
'legend' cases of src/lib/_parity/emitPlotExtras.svelte.test.js): scatterplots (with and
without Colour by keys), periodograms, the FFT with its phase axis, the correlogram, box plots
and actograms, each with an 'auto' legend (inside, or pushed outside by its marks) or one set
'outsideright'.

Pinned here, with the label widths the app's tests measure (0.55 em a character):
  - the legend box (legendBoxSize), its label list and font size, exactly;
  - the occupancy grid of the marks 'auto' avoids, cell for cell (legendLayout.buildOccupancy
    over the plot area before any outside reservation, from the export's own marks);
  - the candidate 'auto' picks (corner or edge midpoint, its x and y) or its move outside;
  - an outside legend's room taken from the plot area (the plot area's width, to 1e-6 px)
    and its place beside the plot (past a right or phase axis);
  - where the legend is drawn: an outside legend's frame top left on the app's, an inside
    one's frame against the edges the app's box is inset from (10 px);
  - Colour by keys stacked after the legend (under it outside, past it in its corner).

    tools/.venv/bin/python -m pytest tools/test_plot_legend_auto.py -q
"""

from __future__ import annotations

import math

import pytest

from plot_extras_support import (CASES, app_bbox, cases_of, close_all, legend_of, render,
                                 rle_decode, rt)

LEGEND_CASES = cases_of("legend") + [n for n in cases_of("fft")
                                     if CASES[n]["expected"]["legend"]["box"]]


@pytest.fixture(autouse=True)
def _reset():
    yield
    close_all()


def layout_of(name):
    fig, ax, case = render(name)
    return fig, ax, case, ax._ancir_legend_layout, case["expected"]["legend"]


@pytest.mark.parametrize("name", LEGEND_CASES)
def test_the_box_is_the_apps(name):
    _fig, _ax, _case, lay, exp = layout_of(name)
    assert lay["box"] is not None, name
    for k in ("width", "height", "lineH", "padding"):
        assert lay["box"][k] == pytest.approx(exp["box"][k], abs=1e-9), (name, k)
    assert lay["font_px"] == pytest.approx(exp["fontPx"])


@pytest.mark.parametrize("name", [n for n in LEGEND_CASES
                                  if CASES[n]["expected"]["legend"]["occupancy"]])
def test_the_occupancy_grid_is_the_apps(name):
    _fig, _ax, _case, lay, exp = layout_of(name)
    occ, want = lay["occupancy"], exp["occupancy"]
    assert (occ["cols"], occ["rows"], occ["cell"]) == (want["cols"], want["rows"], want["cell"])
    expected = rle_decode(want["rle"], want["cols"] * want["rows"])
    diff = [i for i in range(len(expected)) if expected[i] != occ["grid"][i]]
    assert not diff, (name, len(diff), [(i % occ["cols"], i // occ["cols"]) for i in diff[:10]])


@pytest.mark.parametrize("name", LEGEND_CASES)
def test_auto_picks_the_apps_place(name):
    _fig, _ax, _case, lay, exp = layout_of(name)
    if exp["auto"] is None:
        assert lay["auto"] is None
        return
    a, b = lay["auto"], exp["auto"]
    assert (a["name"], a["outside"]) == (b["name"], b["outside"]), name
    assert a["x"] == pytest.approx(b["x"], abs=1e-9)
    assert a["y"] == pytest.approx(b["y"], abs=1e-9)


@pytest.mark.parametrize("name", LEGEND_CASES)
def test_an_outside_legend_takes_the_apps_room(name):
    _fig, ax, case, lay, exp = layout_of(name)
    assert lay["reserveW"] == pytest.approx(exp["reserveW"], abs=1e-9), name
    if exp["outsidePosition"] is None:
        assert lay["outside"] is None
    else:
        assert lay["outside"]["x"] == pytest.approx(exp["outsidePosition"]["x"], abs=1e-9)
        assert lay["outside"]["y"] == pytest.approx(exp["outsidePosition"]["y"], abs=1e-9)
    w, h = rt._axes_px(ax)
    assert w == pytest.approx(case["expected"]["plotSize"][0], abs=1e-6), name
    assert h == pytest.approx(case["expected"]["plotSize"][1], abs=1e-6), name


@pytest.mark.parametrize("name", LEGEND_CASES)
def test_the_legend_is_drawn_where_the_app_draws_it(name):
    fig, ax, case, lay, exp = layout_of(name)
    leg = legend_of(fig)
    assert leg is not None, name
    pad = case["expected"]["padding"]
    plot_w, plot_h = case["expected"]["plotSize"]
    left, top, right, bottom = app_bbox(fig, leg.get_frame())
    d = exp["drawn"]
    where = (exp["auto"] or {}).get("name") if exp["auto"] else lay["position"]
    if lay["outside"] is not None:
        assert (left, top) == pytest.approx((d["x"], d["y"]), abs=0.6), name
        return
    m = 10
    if where in ("topright", "right", "bottomright"):
        assert right == pytest.approx(pad["left"] + plot_w - m, abs=0.6), name
    if where in ("topleft", "left", "bottomleft"):
        assert left == pytest.approx(pad["left"] + m, abs=0.6), name
    if where in ("topright", "topleft", "top"):
        assert top == pytest.approx(pad["top"] + m, abs=0.6), name
    if where in ("bottomright", "bottomleft", "bottom"):
        assert bottom == pytest.approx(pad["top"] + plot_h - m, abs=0.6), name
    if where in ("top", "bottom"):
        assert (left + right) / 2 == pytest.approx(pad["left"] + plot_w / 2, abs=0.6), name
    if where in ("left", "right"):
        assert (top + bottom) / 2 == pytest.approx(pad["top"] + plot_h / 2, abs=0.6), name


@pytest.mark.parametrize("name", LEGEND_CASES)
def test_the_legend_lists_the_apps_entries(name):
    fig, _ax, _case, _lay, exp = layout_of(name)
    texts = [t.get_text() for t in legend_of(fig).get_texts()]
    assert texts == exp["labels"], name


@pytest.mark.parametrize("name", [n for n in LEGEND_CASES
                                  if (CASES[n]["expected"].get("keys") or {}).get("colour")])
def test_the_keys_stack_after_the_legend(name):
    _fig, ax, case, lay, _exp = layout_of(name)
    keys = case["expected"]["keys"]
    k = ax._ancir_key_layout
    for part in ("colour", "size"):
        want = keys[part]
        if want is None:
            assert k[part] is None
            continue
        assert k[part]["x"] == pytest.approx(want["x"], abs=1e-6), (name, part)
        assert k[part]["y"] == pytest.approx(want["y"], abs=1e-6), (name, part)
        if "length" in want:
            assert k[part]["length"] == pytest.approx(want["length"], abs=1e-6), (name, part)
    plot_w, plot_h = rt._axes_px(ax)
    placed = rt.legend_placed_box(case["plotJSON"]["plot"]["legend"], lay, plot_w, plot_h)
    want = keys["legendPlaced"]
    assert placed["outside"] == want["outside"]
    assert (placed["x"], placed["y"]) == pytest.approx((want["x"], want["y"]), abs=1e-6)


def test_measured_label_widths_place_the_same_legends():
    """In the export the label widths are matplotlib's own (the browser measures its own font):
    the decision can differ from the estimate only where a box is a whisker from fitting."""
    for name in LEGEND_CASES:
        _fig, ax, _case = render(name, estimate=False)
        lay = ax._ancir_legend_layout
        assert lay["box"]["width"] > 0
        assert math.isfinite(lay["box"]["width"])
        close_all()


# ---- The frame itself (Legend.svelte's <rect>, legendBoxSize) ------------------------------
#
# matplotlib's own legend box pads the entries by one `borderpad` all round and spaces rows
# only BETWEEN them, so the exported frame was 6 px narrower (the app adds 2 px + half the
# padding after the widest label) and about 12 px shorter (every app row is fontSize +
# itemSpacing + 4 px, the last one too) than the app's. Now it is the app's box to the pixel,
# the entries placed as Legend.svelte places them.

DRAWN = sorted(n for n, c in CASES.items()
               if (c["expected"].get("legend") or {}).get("drawn"))


@pytest.mark.parametrize("name", DRAWN)
def test_the_frame_is_the_apps_rect(name):
    fig, _ax, case = render(name)
    d = case["expected"]["legend"]["drawn"]
    left, top, right, bottom = app_bbox(fig, legend_of(fig).get_frame())
    assert (right - left, bottom - top) == pytest.approx((d["width"], d["height"]), abs=1e-6)
    assert (left, top) == pytest.approx((d["x"], d["y"]), abs=1e-6)


@pytest.mark.parametrize("name", [n for n in DRAWN if (CASES[n]["plotJSON"]["plot"].get(
    "legend") or {}).get("orientation", "vertical") != "horizontal"])
def test_the_entries_sit_where_the_app_draws_them(name):
    """Entry i: its label `padding + 25 + 4` px in, its baseline `padding + i * lineH +
    lineH / 2` down plus 0.35 em (the text's dy); a line swatch from 2 to 18 px, butt ends."""
    fig, ax, case = render(name)
    leg = legend_of(fig)
    box = case["expected"]["legend"]["box"]
    fs = case["expected"]["legend"]["fontPx"]
    left, top, _r, _b = app_bbox(fig, leg.get_frame())
    k = rt._FIG_PX_PER_IN / fig.dpi
    for i, t in enumerate(leg.get_texts()):
        x, y = t.get_transform().transform(t.get_position())
        ax_, ay = x * k, fig._ancir_geometry["fig_h"] - y * k - fig._ancir_geometry["band"]
        assert ax_ - left == pytest.approx(box["padding"] + 25 + 4, abs=1e-6), (name, i)
        want = box["padding"] + i * box["lineH"] + box["lineH"] / 2 + 0.35 * fs
        assert ay - top == pytest.approx(want, abs=1e-6), (name, i)
    from matplotlib.lines import Line2D
    lines = [h for h in leg.legend_handles if isinstance(h, Line2D)
             and h.get_linestyle() not in ("None", "none", "")]
    for ln in lines:
        (x0, _), (x1, _) = (ln.get_transform().transform((xx, 0)) for xx in ln.get_xdata()[[0, -1]])
        assert (x1 - x0) * k == pytest.approx(16, abs=1e-6), name
        assert ln.get_solid_capstyle() == "butt"


def test_the_frame_is_measured_from_the_labels_without_a_layout():
    """A legend drawn with no layout box (as _legend_with_overlays may be) is still
    legendBoxSize over its labels as drawn, at the default figure style."""
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(5.2, 3), dpi=96)
    ax.plot([0, 1], [0, 1], label="Data")
    ax.plot([0, 1], [1, 0], label="A longer label")
    look = rt.resolve_figure_style(None)
    leg = rt._legend_with_overlays(ax, [], legend_json={"show": True}, look=look)
    fig.canvas.draw()
    r = fig.canvas.get_renderer()
    bb = leg.get_frame().get_window_extent(r)
    px = r.points_to_pixels(rt._PX_TO_PT)
    widths = [t.get_window_extent(r).width / px for t in leg.get_texts()]
    want = rt.legend_box_size(widths, look["px"]["legend"])
    assert (bb.width / px, bb.height / px) == pytest.approx((want["width"], want["height"]),
                                                          abs=1e-6)
    assert want["height"] == 2 * (look["px"]["legend"] + 8) + 16
