#!/usr/bin/env python3
"""
The exported actogram's light bar, phase markers, annotations and single-image (raster) rows
checked against the APP (tools/parity/plot_extras_app.json, the 'actogram' cases of
src/lib/_parity/emitPlotExtras.svelte.test.js).

Pinned here, in the app's plot px (to 1e-6 px unless said otherwise):
  - the light bar: each band's rect (place, size, fill, 1 px grey outline) above the plot, and
    the room it adds to the top padding; it spans exactly the rows (one copy of the bands per
    plotted period) with row labels on or an outside legend, at its saved height;
  - phase markers: every block's fitted line and its copies (a tau apart; the primary last),
    its colour and width, and every dot (centre, radius, colour), for own blocks (onset,
    hand-placed, a fixed line) and marker rules (one following each series' colour, one fixed);
  - annotations: the lower half of every row they cover, split at the period boundary, in
    their colour (alpha included);
  - the legend's entries (series, then their marker blocks, then fixed-colour rules);
  - rows under 1 px: one image per series holding the area every bar (or heatmap cell) covers
    in each pixel (actogramRaster.js), compared as 8 x 8 px tile sums (and the heatmap's
    cover-weighted mean colour per tile).

    tools/.venv/bin/python -m pytest tools/test_plot_actogram_extras.py -q
"""

from __future__ import annotations

import pytest

from plot_extras_support import (CASES, app_bbox, app_px_of_display, cases_of, close_all,
                                 columns_for, render, data_to_app, rgb255, rt)

ACTO = cases_of("actogram")


@pytest.fixture(autouse=True)
def _reset():
    yield
    close_all()


def exp_of(name):
    return CASES[name]["expected"]


@pytest.mark.parametrize("name", ACTO)
def test_the_plot_area_is_the_apps(name):
    _fig, ax, case = render(name)
    w, h = rt._axes_px(ax)
    assert (w, h) == pytest.approx(tuple(case["expected"]["plotSize"]), abs=1e-6)
    pad = case["expected"]["padding"]
    left, top, _w, _h = rt._axes_frame_px(ax)
    band = ax.figure._ancir_geometry["band"]
    assert (left, top - band) == pytest.approx((pad["left"], pad["top"]), abs=1e-6)


@pytest.mark.parametrize("name", [n for n in ACTO if exp_of(n)["actogram"]["bands"]["rects"]])
def test_the_light_bar_is_the_apps(name):
    fig, _ax, case = render(name)
    bar = exp_of(name)["actogram"]["bands"]
    tx, ty = bar["translate"]
    got = [a for a in fig.artists if a.get_gid() == "actogram-light-band"]
    assert len(got) == len(bar["rects"]), name
    for art, r in zip(got, bar["rects"]):
        left, top, right, bottom = app_bbox(fig, art)
        assert (left, top) == pytest.approx((tx + r["x"], ty + r["y"]), abs=1e-6)
        assert (right - left, bottom - top) == pytest.approx((r["width"], r["height"]),
                                                             abs=1e-6)
        assert rgb255(art.get_facecolor()) == rgb255(r["fill"])
        assert rgb255(art.get_edgecolor()) == rgb255(r["stroke"])
        assert art.get_linewidth() == pytest.approx(r["stroke-width"] * 0.75)


def _drawn_lines(ax, d):
    return [ln for ln in ax.get_lines() if (ln.get_gid() or "").startswith(
        f"actogram-marker-{d}-") and ln.get_gid().endswith("-line")]


@pytest.mark.parametrize("name", [n for n in ACTO if any(
    m["lines"] or any(dd["centres"] for dd in m["dots"])
    for m in exp_of(n)["actogram"]["markers"])])
def test_the_markers_are_the_apps(name):
    _fig, ax, case = render(name)
    for d, m in enumerate(exp_of(name)["actogram"]["markers"]):
        lines = _drawn_lines(ax, d)
        assert len(lines) == len(m["lines"]), (name, d)
        for ln, want in zip(lines, m["lines"]):
            xs, ys = ln.get_xdata(), ln.get_ydata()
            p1 = data_to_app(ax, xs[0], ys[0])
            p2 = data_to_app(ax, xs[1], ys[1])
            assert p1 == pytest.approx((want["x1"], want["y1"]), abs=1e-6), (name, d)
            assert p2 == pytest.approx((want["x2"], want["y2"]), abs=1e-6), (name, d)
            assert rgb255(ln.get_color()) == rgb255(want["stroke"])
            assert ln.get_linewidth() == pytest.approx(want["stroke-width"] * 0.75)
            assert ln.get_clip_on()
        dots = [c for c in ax.collections if (c.get_gid() or "").startswith(
            f"actogram-marker-{d}-") and c.get_gid().endswith("-dots")]
        want_dots = [dd for dd in m["dots"] if dd["centres"]]
        assert len(dots) == len(want_dots), (name, d)
        for coll, want in zip(dots, want_dots):
            got = [v for x, y in coll.get_offsets() for v in data_to_app(ax, x, y)]
            assert got == pytest.approx([v for cx, cy, _r in want["centres"] for v in (cx, cy)],
                                        abs=1e-6)
            r = want["centres"][0][2]
            assert coll.get_sizes()[0] == pytest.approx((2 * r * 0.75) ** 2)
            assert rgb255(coll.get_facecolor()[0]) == rgb255(want["fill"])


@pytest.mark.parametrize("name", [n for n in ACTO if exp_of(n)["actogram"]["annotations"]])
def test_the_annotations_are_the_apps(name):
    _fig, ax, case = render(name)
    want = exp_of(name)["actogram"]["annotations"]
    got = [p for p in ax.patches if (p.get_gid() or "").startswith("actogram-annotation-")]
    assert len(got) == len(want)
    gap = exp_of(name)["actogram"]["rowGap"]
    for patch, a in zip(got, want):
        pts = [tuple(map(float, q.split(","))) for q in a["points"].split()]
        tx, ty = a["translate"]
        xs = [tx + x for x, _ in pts]
        ys = [ty + gap + y for _, y in pts]
        x0, y0 = data_to_app(ax, patch.get_x(), patch.get_y())
        x1, y1 = data_to_app(ax, patch.get_x() + patch.get_width(),
                             patch.get_y() + patch.get_height())
        assert (min(x0, x1), max(x0, x1)) == pytest.approx((min(xs), max(xs)), abs=1e-6)
        assert (min(y0, y1), max(y0, y1)) == pytest.approx((min(ys), max(ys)), abs=1e-6)
        assert rgb255(patch.get_facecolor()) == rgb255(a["fill"])
        assert not patch.get_clip_on()


@pytest.mark.parametrize("name", [n for n in ACTO if exp_of(n)["legend"]["labels"]
                                  and CASES[n]["plotJSON"]["plot"]["legend"].get("show")])
def test_the_legend_lists_the_apps_entries(name):
    _fig, ax, _case = render(name)
    assert [t.get_text() for t in ax.get_legend().get_texts()] == exp_of(name)["legend"]["labels"]


# A chosen start (`startTimeIN`) on a time column in a non-UTC zone: the rows, their date
# labels and the exported plot-data rows fold at the chosen instant, as the app's do.
START_CHOSEN = [n for n in ACTO if CASES[n]["plotJSON"]["plot"].get("startTimeIN") is not None]


def test_the_chosen_start_cases_exist():
    assert {"actogramStartTimeZoned", "actogramStartTimeBeforeRecord"} <= set(START_CHOSEN)


@pytest.mark.parametrize("name", START_CHOSEN)
def test_a_chosen_start_folds_the_rows_where_the_app_does(name):
    _fig, ax, case = render(name)
    a = exp_of(name)["actogram"]
    got = ax._ancir_actogram
    assert got["start"] == a["startTime"] == case["plotJSON"]["plot"]["startTimeIN"]
    assert got["n_rows"] == a["Ndays"]
    _h, rows = rt.actogram_download_data(case["plotJSON"], columns_for(case))
    assert len(rows) == len(a["download"])
    for r, want in zip(rows, a["download"]):
        assert list(r) == pytest.approx(want, abs=1e-6)


@pytest.mark.parametrize("name", [n for n in ACTO if exp_of(n)["actogram"]["rowLabels"]])
def test_the_row_labels_are_the_apps(name):
    fig, ax, _case = render(name)
    want = exp_of(name)["actogram"]["rowLabels"]
    texts = [t for t in ax.texts if t.get_gid() == "actogram-row-label"]
    assert [t.get_text() for t in texts] == [w["text"] for w in want]
    for t, w in zip(texts, want):
        _x, y = app_px_of_display(fig, *t.get_transform().transform(t.get_position()))
        assert y == pytest.approx(w["y"], abs=1e-6)


@pytest.mark.parametrize("name", [n for n in ACTO if exp_of(n)["actogram"]["rasterRows"]])
def test_rows_under_a_pixel_are_one_image_like_the_apps(name):
    _fig, ax, case = render(name)
    a = exp_of(name)["actogram"]
    imgs = [im for im in ax.images if im.get_gid() == "actogram-raster"]
    assert len(imgs) == len(a["raster"])
    assert not [c for c in ax.collections if c.get_gid() in ("actogram-bars",
                                                             "actogram-heatmap")]
    # The same coverage, at the app's 1 device px per CSS px.
    p = case["plotJSON"]["plot"]
    info = ax._ancir_actogram
    entries, _start, _n = rt._actogram_series(case["plotJSON"], columns_for(case), "utc")
    span = p["periodHrs"] * p["doublePlot"]
    heat = p.get("renderMode") == "heatmap"
    for e, want in zip([e for e in entries if e is not None], a["raster"]):
        ys = e["y_col"].get_data()
        lo, hi = rt._js_min_max(ys)
        r = rt.actogram_raster(
            info["n_rows"], want["W"], want["H"], span,
            lambda day, e=e: rt.actogram_row_bins(e["bins"], day, p["doublePlot"],
                                                  p["periodHrs"]),
            "heatmap" if heat else "bars",
            y_frac=lambda day, y: (y - lo) / (hi - lo),
            colour=lambda y: rt.colormap_rgb(p["colormap"], rt.normalise_to_01(y, lo, hi)),
            row_h=info["row_h"], gap=info["gap"])
        T = want["tile"]
        cov = r["cover"]
        H, W = cov.shape
        th, tw = -(-H // T), -(-W // T)
        tiles = [float(cov[ty * T:(ty + 1) * T, tx * T:(tx + 1) * T].sum())
                 for ty in range(th) for tx in range(tw)]
        assert tiles == pytest.approx(want["cover"], abs=2e-3), name
        if heat:
            got = []
            for ty in range(th):
                for tx in range(tw):
                    c = float(cov[ty * T:(ty + 1) * T, tx * T:(tx + 1) * T].sum()) or 1
                    got += [float(r["rgb"][ty * T:(ty + 1) * T, tx * T:(tx + 1) * T, ch].sum())
                            / c for ch in range(3)]
            assert got == pytest.approx(want["rgb"], abs=0.02), name


def test_a_record_too_long_to_draw_says_why():
    case = CASES["actogramRasterBars"]
    import copy
    plot = copy.deepcopy(case["plotJSON"])
    plot["plot"]["periodHrs"] = 0.01
    fig, ax = rt.render_plot_figure(plot, columns_for(case), auto_pad=False)
    texts = [t for t in ax.texts if t.get_gid() == "actogram-refused"]
    assert texts and "Not drawn" in texts[0].get_text()
    assert not ax.images and not [c for c in ax.collections if c.get_gid() == "actogram-bars"]


def test_the_light_bar_stays_put_at_the_export_dpi():
    """The bar is placed through inches, so a PNG saved at another dpi keeps it above the plot."""
    fig, _ax, _case = render("actogramBands")
    want = [app_bbox(fig, a) for a in fig.artists if a.get_gid() == "actogram-light-band"]
    fig.set_dpi(300)
    fig.canvas.draw()
    got = [app_bbox(fig, a) for a in fig.artists if a.get_gid() == "actogram-light-band"]
    assert [v for b in got for v in b] == pytest.approx([v for b in want for v in b], abs=1e-6)


@pytest.mark.parametrize("mode", ["bars", "heatmap"])
def test_the_raster_weights_every_pixel_by_the_area_covered(mode):
    """actogramRaster.js rasterizeRows on bins and rows that straddle pixels (the fixture's
    rasterProbe): every pixel's cover (and colour sums) exactly."""
    from plot_extras_support import FIXTURE

    def bins(day):
        return ([0.1 + day * 0.2, 0.9, 1.65], [0.7 + day * 0.2, 1.4, 2.25],
                [3, None if day == 1 else 7, 10])
    r = rt.actogram_raster(3, 7, 5, 2.3, bins, mode, y_frac=lambda day, y: y / 10 - day * 0.05,
                           colour=lambda y: [y * 20, 255 - y * 10, y * 3], row_h=1.3, gap=0.35)
    want = FIXTURE["rasterProbe"][mode]
    # The app accumulates in Float32Arrays: equal to single precision.
    assert list(r["cover"].ravel()) == pytest.approx(want["cover"], rel=1e-6, abs=1e-6)
    if mode == "heatmap":
        assert list(r["rgb"].ravel()) == pytest.approx(want["rgb"], rel=1e-6, abs=1e-5)
