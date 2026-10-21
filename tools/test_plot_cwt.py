#!/usr/bin/env python3
"""
The exported wavelet scalogram (CWT) checked against the APP (tools/parity/plot_extras_app.json,
the 'cwt' cases of src/lib/_parity/emitPlotExtras.svelte.test.js): the demo's Morlet scalogram,
then with the ridge, a period band and lines, a linear period axis with raw power and the
colour scale in a corner, a Paul and a DOG wavelet.

Pinned here:
  - the transform (utils/cwt.js ported in cwt_from_series): every period to 1e-9, the sample
    interval, the largest power to 1e-9 and a grid of power samples to 1e-7 of it;
  - the image: which scale each row shows (one row per scale on a log axis, resampled onto a
    linear one so each scale sits at its own period), its column count (at most 4096) and
    the colour of a grid of cells, as the app's canvas paints them (the colormap at power
    over 0 .. the largest);
  - the cone of influence (curve and shade), the ridge, the period and time ticks and titles,
    in the app's px to 1e-6;
  - the period overlays (a band with its edges, lines; one outside the range draws nothing);
  - the colour scale ("Power", 0 / middle / largest) beside the plot or in its corner.

    tools/.venv/bin/python -m pytest tools/test_plot_cwt.py -q
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from plot_extras_support import (CASES, app_bbox, cases_of, close_all, data_to_app, render,
                                 rgb255, rt)

CWT = cases_of("cwt")


@pytest.fixture(autouse=True)
def _reset():
    yield
    close_all()


def exp_of(name):
    return CASES[name]["expected"]["cwt"]


def app_xy(ax, x, y):
    return data_to_app(ax, x, y)


@pytest.mark.parametrize("name", CWT)
def test_the_transform_is_the_apps(name):
    _fig, ax, _case = render(name)
    tr = ax._ancir_cwt["transform"]
    w = exp_of(name)
    assert tr["valid"]
    assert tr["periods"] == pytest.approx(w["periods"], abs=1e-9)  # the fixture keeps 1e-9
    assert len(tr["times"]) == w["nTimes"]
    assert (tr["times"][0], tr["times"][-1]) == pytest.approx((w["t0"], w["t1"]))
    assert tr["dt"] == pytest.approx(w["dt"], abs=1e-9)
    pmax = ax._ancir_cwt["powerMax"]
    assert pmax == pytest.approx(w["powerMax"], rel=1e-9)
    for j, i, v in w["powerSamples"]:
        assert tr["power"][j][i] == pytest.approx(v, abs=1e-7 * pmax), (name, j, i)


@pytest.mark.parametrize("name", CWT)
def test_the_image_is_the_apps(name):
    _fig, ax, _case = render(name)
    w = exp_of(name)
    im = [i for i in ax.images if i.get_gid() == "cwt-power"][0]
    arr = np.asarray(im.get_array())
    # One row per scale on a log axis, resampled onto a linear one (as the app paints it).
    assert arr.shape[0] == len(w["imageRows"]["j0"])
    assert arr.shape[1] == w["imageColumns"]
    for row, col, css in w["imageCells"]:
        got = tuple(int(round(v * 255)) for v in arr[row, col][:3])
        assert got == rgb255(css)[:3], (name, row, col)
    # Stretched over the whole plot area.
    left, top, right, bottom = im.get_extent()[0], im.get_extent()[3], im.get_extent()[1], \
        im.get_extent()[2]
    pad = CASES[name]["expected"]["padding"]
    assert app_xy(ax, left, top) == pytest.approx((pad["left"], pad["top"]), abs=1e-6)


@pytest.mark.parametrize("name", CWT)
def test_the_image_rows_are_the_apps(name):
    """What each image row shows (two scales and a blend weight): the app's
    scalogramImageRows, row for row."""
    _fig, ax, case = render(name)
    w = exp_of(name)["imageRows"]
    log = case["plotJSON"]["plot"].get("logScale", True) is not False
    j0, j1, wt = rt.cwt_image_rows(ax._ancir_cwt["transform"]["periods"], log)
    assert (j0, j1) == (w["j0"], w["j1"])
    assert wt == pytest.approx(w["w"], abs=1e-9)
    n = len(exp_of(name)["periods"])
    if log:
        assert j0 == list(range(n - 1, -1, -1)) and not any(wt)
    else:
        assert len(j0) == max(n, rt.SCALOGRAM_LINEAR_ROWS)


def test_on_a_linear_axis_each_scale_is_drawn_at_its_period():
    """cwtLinearRaw (4 to 30 h, linear): at each scale's own period on the axis (where its
    tick, the cone and the overlays go) the image row shows that scale at (near) full weight.
    It used to keep one evenly spaced row per scale, which put the 24 h power near 26 h."""
    _fig, ax, _case = render("cwtLinearRaw")
    periods = ax._ancir_cwt["transform"]["periods"]
    j0, j1, wt = rt.cwt_image_rows(periods, False)
    _w, h = rt._axes_px(ax)

    def weight(r, j):
        return (1 - wt[r] if j0[r] == j else 0) + (wt[r] if j1[r] == j else 0)
    for j, per in enumerate(periods):
        y = rt.cwt_period_to_y(per, periods, h, False)
        r = min(len(j0) - 1, int(y / h * len(j0)))
        assert weight(r, j) > 0.9, (j, per)
    old = list(range(len(periods) - 1, -1, -1))   # the old evenly spaced rows
    j24 = min(range(len(periods)), key=lambda j: abs(periods[j] - 24))
    y24 = rt.cwt_period_to_y(periods[j24], periods, h, False)
    assert old[min(len(old) - 1, int(y24 / h * len(old)))] != j24


@pytest.mark.parametrize("name", CWT)
def test_the_cone_and_ridge_are_the_apps(name):
    _fig, ax, _case = render(name)
    w = exp_of(name)
    tx, ty = w["groupTranslate"]

    def line(gid):
        got = [ln for ln in ax.get_lines() if ln.get_gid() == gid]
        return got[0] if got else None

    coi = line("cwt-coi")
    assert (coi is not None) == bool(w["coi"])
    if coi is not None:
        got = [v for x, y in zip(coi.get_xdata(), coi.get_ydata())
               for v in app_xy(ax, x, y)]
        want = [v for x, y in w["coi"] for v in (tx + x, ty + y)]
        assert got == pytest.approx(want, abs=1e-6)
        shade = [p for p in ax.patches if p.get_gid() == "cwt-coi-shade"][0]
        got = [v for x, y in shade.get_xy()[:len(w["coiShade"])] for v in app_xy(ax, x, y)]
        want = [v for x, y in w["coiShade"] for v in (tx + x, ty + y)]
        assert got == pytest.approx(want, abs=1e-6)
    ridge = line("cwt-ridge")
    assert (ridge is not None) == bool(w["ridgeLine"])
    if ridge is not None:
        got = [v for x, y in zip(ridge.get_xdata(), ridge.get_ydata())
               for v in app_xy(ax, x, y)]
        want = [v for x, y in w["ridgeLine"] for v in (tx + x, ty + y)]
        assert got == pytest.approx(want, abs=1e-6)
        from ancir_runtime import cwt_ridge
        rp = cwt_ridge(ax._ancir_cwt["transform"])["ridgePeriod"]
        assert [None if math.isnan(v) else v for v in rp] == pytest.approx(
            [None if v is None else v for v in w["ridge"]], abs=1e-9)


@pytest.mark.parametrize("name", CWT)
def test_the_ticks_and_titles_are_the_apps(name):
    _fig, ax, _case = render(name)
    w = exp_of(name)
    tx, ty = w["groupTranslate"]
    want = [t for t in w["texts"] if t["cls"] is None]
    got = [t for t in ax.texts if (t.get_gid() or "").startswith("cwt-")]
    assert [t.get_text() for t in got] == [t["text"] for t in want]
    for g, t in zip(got, want):
        x, y = app_xy(ax, *g.get_position())
        if t["x"] is not None:
            assert x == pytest.approx(tx + t["x"], abs=1e-6), t
            assert y == pytest.approx(ty + t["y"], abs=1e-6), t
        assert g.get_fontsize() == pytest.approx(t["size"] * 0.75)


@pytest.mark.parametrize("name", [n for n in CWT if exp_of(n)["overlayLines"] or
                                  exp_of(n)["overlayBands"]])
def test_the_period_overlays_are_the_apps(name):
    _fig, ax, _case = render(name)
    w = exp_of(name)
    pad = CASES[name]["expected"]["padding"]
    plot_h = CASES[name]["expected"]["plotSize"][1]
    lines = [ln for ln in ax.get_lines() if (ln.get_gid() or "").startswith("overlay-")]
    # A line outside the period range is drawn by neither (the app used to place it off the
    # plot and clip it away).
    visible = [ln for ln in w["overlayLines"] if pad["top"] <= ln["y1"] <= pad["top"] + plot_h]
    assert visible == w["overlayLines"]
    edges = w["bandEdges"]
    assert len(lines) == len(visible) + len(edges)
    got = sorted(round(app_xy(ax, 0, ln.get_ydata()[0])[1], 6) for ln in lines)
    want = sorted(round(e["y1"], 6) for e in visible + edges)
    assert got == pytest.approx(want, abs=1e-6)
    bands = [p for p in ax.patches if (p.get_gid() or "").startswith("overlay-")]
    assert len(bands) == len(w["overlayBands"])
    for b, r in zip(bands, w["overlayBands"]):
        x0, y0 = app_xy(ax, b.get_x(), b.get_y())
        x1, y1 = app_xy(ax, b.get_x() + b.get_width(), b.get_y() + b.get_height())
        assert (min(x0, x1), min(y0, y1), abs(x1 - x0), abs(y1 - y0)) == pytest.approx(
            (r["x"], r["y"], r["width"], r["height"]), abs=1e-6)
        assert rgb255(b.get_facecolor()) == rgb255(r["fill"])


@pytest.mark.parametrize("name", CWT)
def test_the_colour_scale_is_the_apps(name):
    fig, ax, _case = render(name)
    w = exp_of(name)
    keys = [a for a in list(fig.axes) + list(ax.child_axes) if a.get_gid() == "colour-key"]
    if w["key"] is None:
        assert not keys
        return
    assert len(keys) == 1
    left, top, right, bottom = app_bbox(fig, keys[0])
    tx, ty = w["key"]["translate"]
    bar = w["key"]["bar"]
    assert (left, top) == pytest.approx((tx + bar["x"], ty + bar["y"]), abs=1e-6)
    assert (right - left, bottom - top) == pytest.approx((bar["width"], bar["height"]),
                                                         abs=1e-6)
    labels = [t.get_text() for t in keys[0].yaxis.get_ticklabels()]
    want = [t["text"] for t in w["texts"] if t["cls"] == "colour-scale-tick"]
    assert sorted(labels) == sorted(want)
    assert keys[0].yaxis.label.get_text() == "Power"


@pytest.mark.parametrize("name", CWT)
def test_the_plot_data_is_the_apps(name):
    """CWT.svelte scalogramExport: (time, period, power) per cell, periods outer."""
    from ancir_runtime import cwt_download_data
    from plot_extras_support import columns_for
    case = CASES[name]
    headers, rows = cwt_download_data(case["plotJSON"], columns_for(case))
    want = exp_of(name)["download"]
    assert headers == want["headers"]
    assert len(rows) == want["n"]
    pmax = exp_of(name)["powerMax"]
    for got, w in zip(rows[:3] + rows[-3:], want["head"] + want["tail"]):
        assert got[:2] == pytest.approx(w[:2], abs=1e-9)
        assert got[2] == pytest.approx(w[2], abs=1e-7 * pmax)
