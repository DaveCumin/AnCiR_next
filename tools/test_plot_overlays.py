#!/usr/bin/env python3
"""
Plot overlay tests (Python side, overlays plan 2026-10-15 step 5).

The exported scripts draw a plot's reference LINES and shaded BANDS with
`_draw_overlays` (tools/ancir_runtime.py), a port of the app's overlay model
(components/plotbits/overlaySpec.js, Overlay.svelte, overlayHost.js). These tests
pin the port's geometry rules (uniques and the 50 cap on `at`, per-pair dedupe,
equal-length ribbons, repeating maths anchored at the data minimum, time-axis
conversion, FFT period-to-frequency), the host capabilities (against the app's
generated MCP schema and the hosts' source), and what each rendered plot type
draws: matplotlib artists per overlay (counted by their gid `overlay-<id>`), their
positions, their layer (bands under the series, lines above), the domain rules
(only the axes a host widens) and the legend entries.

Histogram, Q-Q plot, Mean +/- SEM and CWT carry overlays in the app but are not
rendered by this runtime at all (render_plots skips them); see the last test.

    tools/.venv/bin/python -m pytest tools/test_plot_overlays.py -q
"""

from __future__ import annotations

import copy
import io
import json
import re
import sys
from contextlib import redirect_stdout
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402
import pytest  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import ancir_runtime as rt  # noqa: E402
from test_session_parity import build_columns, run_session  # noqa: E402

DEMOS = ROOT / "static" / "sessions" / "demos"
SCHEMA = ROOT / "mcp" / "src" / "emit" / "session-schema.generated.json"
PLOTS_SRC = ROOT / "src" / "lib" / "plots"


# ---- helpers --------------------------------------------------------------------------

def ov(oid, kind, form, *, at=None, start=None, end=None, lower=None, upper=None, x=None,
       wire=None, **extra):
    """An overlay as the app saves it (OverlayClass.toJSON). Channel arguments are typed
    lists; `wire={'at': refId}` wires a channel to a column instead."""
    channels = {}
    for key, typed in (("at", at), ("start", start), ("end", end), ("lower", lower),
                       ("upper", upper), ("x", x)):
        if typed is not None:
            channels[key] = {"columns": [], "typed": list(typed)}
    for key, ref in (wire or {}).items():
        channels[key] = {"columns": [{"refId": ref}], "typed": []}
    out = {
        "id": oid, "name": f"{kind} {oid}", "kind": kind, "form": form, "enabled": True,
        "label": "", "colour": "#C0392B", "strokeWidth": 1.5, "stroke": "5, 5",
        "fill": "#2C2C2C30", "edge": False, "edgeColour": "#2C2C2C", "edgeWidth": 1,
        "repeatEveryHours": 24, "nightDurationHours": 12, "startTimeHours": 0,
        "useDataMin": True, "channels": channels,
    }
    out.update(extra)
    return out


def load_demo(sid, ptype):
    session = json.loads((DEMOS / f"{sid}.json").read_text())
    cols, _raw, errors = run_session(session)
    assert not errors, errors
    plot = copy.deepcopy(next(p for p in session["plots"] if p.get("type") == ptype))
    return plot, cols


def by_gid(ax, oid):
    """Every artist of overlay `oid` on the axes, by kind."""
    gid = f"overlay-{oid}"
    return {
        "lines": [a for a in ax.lines if a.get_gid() == gid],
        "patches": [a for a in ax.patches if a.get_gid() == gid],
        "collections": [a for a in ax.collections if a.get_gid() == gid],
    }


def counts(ax, oid):
    found = by_gid(ax, oid)
    return {k: len(v) for k, v in found.items()}


def vline_x(line):
    return float(line.get_xdata()[0])


def hline_y(line):
    return float(line.get_ydata()[0])


def legend_texts(ax):
    leg = ax.get_legend()
    return [t.get_text() for t in leg.get_texts()] if leg else []


def series_zorders(ax):
    return [a.get_zorder() for a in ax.lines if not (a.get_gid() or "").startswith("overlay")]


@pytest.fixture
def fig_ax():
    fig, ax = plt.subplots(figsize=(8, 5))
    yield fig, ax
    plt.close(fig)


GEOM = rt._overlay_geometry


def built(json_ov, host="scatterplot", **kw):
    """One saved overlay through the host's overlaysFromJSON (coercion included)."""
    out = rt._overlays_from_plot({"overlays": [json_ov]}, rt.OVERLAY_CAPABILITIES.get(host),
                                 **kw)
    return out


# ---- capabilities are the app's -------------------------------------------------------

def test_capabilities_match_the_generated_schema():
    """Forms per host, in the host's panel order, as the app's MCP catalogue lists them
    (describeOverlayForms over each class's overlayCapabilities); channels per form too."""
    plots = json.loads(SCHEMA.read_text())["plots"]
    for host, caps in rt.OVERLAY_CAPABILITIES.items():
        forms = plots[host]["overlays"]
        for kind in ("line", "band"):
            assert list(caps[kind]) == list(forms.get(kind, {})), (host, kind)
            for form, specs in forms.get(kind, {}).items():
                want = [(c["key"], c["axis"]) for c in specs]
                assert list(rt._OVERLAY_CHANNELS[kind][form]) == want, (host, kind, form)


def test_domain_axes_match_the_hosts_source():
    """Which axes an overlay may widen, read off each host's `overlayCapabilities.domain`
    (Scatterplot uses ALL_OVERLAY_FORMS: both axes)."""
    folders = {"periodogram": "Periodogram", "correlogram": "Correlogram", "fft": "FFT",
               "boxplot": "Boxplot"}
    for host, folder in folders.items():
        src = (PLOTS_SRC / folder / f"{folder}.svelte").read_text()
        block = src[src.index("static overlayCapabilities"):]
        block = block[:block.index("});")]
        m = re.search(r"domain:\s*Object\.freeze\(\[([^\]]*)\]\)", block)
        assert m, host
        want = tuple(re.findall(r"'(x|y)'", m.group(1)))
        assert rt.OVERLAY_CAPABILITIES[host]["domain"] == want, host
    scatter = (PLOTS_SRC / "Scatterplot" / "Scatterplot.svelte").read_text()
    assert "static overlayCapabilities = ALL_OVERLAY_FORMS" in scatter
    assert rt.OVERLAY_CAPABILITIES["scatterplot"]["domain"] == ("x", "y")


# ---- geometry: the model's rules ------------------------------------------------------

def test_line_positions_are_uniques_capped_at_50():
    typed = [5, 5, 1, 1] + list(range(100, 160))
    (o,) = built(ov(1, "line", "horizontal", at=typed))
    g = GEOM(o, {})
    assert g == {"kind": "line", "orientation": "horizontal",
                 "positions": ([5, 1] + list(range(100, 148)))}
    assert len(g["positions"]) == rt.OVERLAY_POSITION_CAP


def test_paired_segments_dedupe_per_pair_and_skip_empty_pairs():
    (o,) = built(ov(1, "band", "vertical", start=[0, 0, 5, 3, 9], end=[2, 2, 4, 3]))
    # (0,2) twice -> once; (5,4) re-ordered to (4,5); (3,3) empty; the unpaired 9 ignored.
    assert GEOM(o, {})["segments"] == [{"x0": 0, "x1": 2}, {"x0": 4, "x1": 5}]
    (h,) = built(ov(2, "band", "horizontal", lower=[1, 1], upper=[3, 3]))
    assert GEOM(h, {})["segments"] == [{"y0": 1, "y1": 3}]


def test_paired_channels_are_capped_as_raw_lists():
    (o,) = built(ov(1, "band", "vertical", start=[0] * 60, end=[1] * 60))
    assert GEOM(o, {})["segments"] == [{"x0": 0, "x1": 1}]
    starts = list(range(0, 120, 2))
    (o2,) = built(ov(2, "band", "vertical", start=starts, end=[s + 1 for s in starts]))
    assert len(GEOM(o2, {})["segments"]) == 50


def test_ribbon_needs_equal_lengths_and_is_never_capped():
    (o,) = built(ov(1, "band", "ribbon", x=[0, 1, 2], lower=[0, 0], upper=[1, 1, 1]))
    assert GEOM(o, {}) == {"kind": "band", "form": "ribbon", "x": [], "lower": [], "upper": []}
    n = 80
    (o2,) = built(ov(2, "band", "ribbon", x=list(range(n)), lower=[0] * n, upper=[1] * n))
    assert len(GEOM(o2, {})["x"]) == n


def test_typed_values_follow_the_house_rule():
    (o,) = built(ov(1, "line", "horizontal", at=[None, "", " 7 ", "x", float("inf"), 3]))
    assert GEOM(o, {})["positions"] == [7, 3]


def test_repeating_band_anchors_at_the_data_minimum_and_reaches_the_axis():
    (o,) = built(ov(1, "band", "repeating"))
    ctx = {"xDomainMin": -5, "xDomainMax": 50, "xAnchorMin": 0, "xIsTime": False}
    # Anchored at 0, continued back one period (to -24) so the pattern reaches -5.
    assert GEOM(o, {}, ctx)["segments"] == [
        {"x0": 0, "x1": 12}, {"x0": 24, "x1": 36}, {"x0": 48, "x1": 50}]
    ctx2 = dict(ctx, xAnchorMin=10)  # back to -14, so the first band is -14..-2 clamped
    assert GEOM(o, {}, ctx2)["segments"] == [
        {"x0": -5, "x1": -2}, {"x0": 10, "x1": 22}, {"x0": 34, "x1": 46}]
    (fixed,) = built(ov(2, "band", "repeating", useDataMin=False, startTimeHours=6,
                        nightDurationHours=6, repeatEveryHours=12))
    assert GEOM(fixed, {}, ctx)["segments"] == [
        {"x0": 6, "x1": 12}, {"x0": 18, "x1": 24}, {"x0": 30, "x1": 36}, {"x0": 42, "x1": 48}]


def test_repeating_band_on_a_time_axis_scales_hours_to_ms():
    (o,) = built(ov(1, "band", "repeating", nightDurationHours=12, repeatEveryHours=24))
    h = 3600000
    t0 = 1_700_000_000_000
    ctx = {"xDomainMin": t0, "xDomainMax": t0 + 48 * h, "xAnchorMin": t0, "xIsTime": True}
    assert GEOM(o, {}, ctx)["segments"] == [
        {"x0": t0, "x1": t0 + 12 * h}, {"x0": t0 + 24 * h, "x1": t0 + 36 * h}]


def test_legacy_multi_column_line_splits_into_one_line_per_column():
    j = ov(4, "line", "vertical", label="alerts")
    j["channels"]["at"] = {"columns": [{"refId": 1}, {"refId": 2}, {"refId": 3}], "typed": []}
    out = rt._overlays_from_plot({"overlays": [j]}, rt.OVERLAY_CAPABILITIES["scatterplot"])
    assert [o["channels"]["at"]["columns"] for o in out] == [[1], [2], [3]]
    assert [o["name"] for o in out] == ["line 4", "Line 2", "Line 3"]
    assert {o["label"] for o in out} == {"alerts"}


def test_forms_a_host_does_not_allow_are_coerced():
    # Boxplot: horizontal only, so a saved vertical line becomes horizontal (keeping `at`).
    (b,) = built(ov(1, "line", "vertical", at=[40]), host="boxplot")
    assert (b["form"], GEOM(b, {})["positions"]) == ("horizontal", [40])
    # Periodogram: a repeating band becomes its first band form (vertical), with no channels.
    (p,) = built(ov(2, "band", "repeating"), host="periodogram")
    assert p["form"] == "vertical" and GEOM(p, {})["segments"] == []
    # Correlogram has no ribbon: coerced to vertical, and start/end are the new channels.
    (c,) = built(ov(3, "band", "ribbon", x=[1], lower=[0], upper=[1]), host="correlogram")
    assert c["form"] == "vertical" and set(c["channels"]) == {"start", "end"}


def test_a_kind_the_host_does_not_allow_is_dropped():
    caps = {"line": ("horizontal",), "band": (), "domain": ("y",)}
    out = rt._overlays_from_plot(
        {"overlays": [ov(1, "band", "horizontal", lower=[0], upper=[1]),
                      ov(2, "line", "horizontal", at=[1])]}, caps)
    assert [o["id"] for o in out] == [2]


def test_legacy_night_bands_migrate_on_the_scatterplot_only():
    h = 3600000
    nb = [{"name": "Night", "colour": "#11223380", "mode": "custom",
           "customBands": [{"startTime": 1000, "durationHours": 2},
                           {"startTime": 5000, "endTime": 4000},  # end before start: skipped
                           {"startTime": 9000, "endTime": 9500}]},
          {"mode": "repeating", "nightDurationHours": 10}]
    inner = {"overlays": [], "nightBands": nb}
    out = rt._overlays_from_plot(inner, rt.OVERLAY_CAPABILITIES["scatterplot"],
                                 legacy_night_bands=True, x_is_time=True)
    assert [o["form"] for o in out] == ["vertical", "repeating"]
    assert out[0]["fill"] == "#11223380"
    assert GEOM(out[0], {})["segments"] == [{"x0": 1000, "x1": 1000 + 2 * h},
                                            {"x0": 9000, "x1": 9500}]
    assert out[1]["nightDurationHours"] == 10 and out[1]["useDataMin"] is True
    # Off the time axis a duration is in axis units.
    num = rt._overlays_from_plot(inner, rt.OVERLAY_CAPABILITIES["scatterplot"],
                                 legacy_night_bands=True, x_is_time=False)
    assert GEOM(num[0], {})["segments"][0] == {"x0": 1000, "x1": 1002}
    # Without the flag (every other host) they are ignored.
    assert rt._overlays_from_plot(inner, rt.OVERLAY_CAPABILITIES["scatterplot"]) == []


def test_x_value_for_maps_wired_x_columns_only():
    _raw, cols = build_columns({
        "rawData": {"1": [0, 1, 2]},
        "data": [{"id": 1, "name": "h", "type": "number", "data": 1}]})
    (wired,) = built(ov(1, "line", "vertical", wire={"at": 1}))
    (typed,) = built(ov(2, "line", "vertical", at=[0, 1]))
    (horiz,) = built(ov(3, "line", "horizontal", wire={"at": 1}))
    f = lambda col: (lambda v: 1000 + v * 3600000)  # noqa: E731
    assert GEOM(wired, cols, x_value_for=f)["positions"] == [1000, 3601000, 7201000]
    assert GEOM(typed, cols, x_value_for=f)["positions"] == [0, 1]  # typed ms stay as typed
    assert GEOM(horiz, cols, x_value_for=f)["positions"] == [0, 1, 2]  # y channels never


def test_fft_transform_draws_periods_at_one_over_p():
    tx = lambda v: None if not (v > 0) else 1.0 / v  # noqa: E731  frequency mode
    (line,) = built(ov(1, "line", "vertical", at=[24, 0, -3, 12]), host="fft")
    assert GEOM(line, {}, x_transform=tx)["positions"] == [1 / 24, 1 / 12]
    (band,) = built(ov(2, "band", "vertical", start=[20, 0], end=[28, 5]), host="fft")
    assert GEOM(band, {}, x_transform=tx)["segments"] == [{"x0": 1 / 28, "x1": 1 / 20}]
    # Horizontal marks never go through it.
    (h,) = built(ov(3, "line", "horizontal", at=[2]), host="fft")
    assert GEOM(h, {}, x_transform=tx)["positions"] == [2]


def test_disabled_overlays_draw_nothing(fig_ax):
    _fig, ax = fig_ax
    ax.plot([0, 10], [0, 1])
    plot = {"type": "correlogram",
            "plot": {"overlays": [ov(1, "line", "horizontal", at=[0.5], enabled=False,
                                     label="hidden")]}}
    res = rt._draw_overlays(ax, plot, {})
    assert counts(ax, 1) == {"lines": 0, "patches": 0, "collections": 0}
    assert res["legend"] == []


# ---- per plot type: what is drawn -----------------------------------------------------

def test_scatterplot_draws_every_form(fig_ax):
    fig, ax = fig_ax
    plot, cols = load_demo("demo-tp-crossing", "scatterplot")
    inner = plot["plot"]
    # The demo's own two overlays (a typed horizontal line at 20 labelled "threshold" and a
    # vertical line wired to the Crossing node's crossing column) plus one of each band.
    inner["overlays"] += [
        ov(10, "band", "vertical", start=[5, 30], end=[10, 35], edge=True, label="window"),
        ov(11, "band", "horizontal", lower=[40], upper=[60]),
        ov(12, "band", "ribbon", wire={"x": 625, "lower": 627, "upper": 626}),
        ov(13, "band", "repeating", nightDurationHours=6, repeatEveryHours=24),
        ov(14, "line", "horizontal", at=[200]),  # widens y (the scatterplot widens both)
    ]
    rt.plot_scatterplot(plot, cols, ax)
    fig.canvas.draw()

    assert counts(ax, 0) == {"lines": 1, "patches": 0, "collections": 0}
    assert hline_y(by_gid(ax, 0)["lines"][0]) == 20
    crossing = cols[628].get_data()
    assert [vline_x(a) for a in by_gid(ax, 1)["lines"]] == [float(v) for v in crossing]
    assert counts(ax, 10) == {"lines": 4, "patches": 2, "collections": 0}  # 2 spans, 2 edges each
    spans = by_gid(ax, 10)["patches"]
    assert [round(p.get_x(), 9) for p in spans] == [5, 30]
    assert [round(p.get_width(), 9) for p in spans] == [5, 5]
    assert sorted(vline_x(a) for a in by_gid(ax, 10)["lines"]) == [5, 10, 30, 35]
    assert counts(ax, 11) == {"lines": 0, "patches": 1, "collections": 0}
    assert counts(ax, 12)["collections"] == 1
    # Repeating: data minimum 0, 6 h every 24 h, clamped to the axis.
    rep = by_gid(ax, 13)["patches"]
    lo, hi = ax.get_xlim()
    starts = [round(p.get_x(), 9) for p in rep]
    assert starts[:3] == [0, 24, 48] or starts[0] == round(lo, 9)
    assert all(lo - 1e-9 <= p.get_x() and p.get_x() + p.get_width() <= hi + 1e-9 for p in rep)
    assert ax.get_ylim()[1] >= 200
    # Layers: bands under every series line, lines over them.
    top_series = max(series_zorders(ax))
    for oid in (10, 11, 13):
        assert all(p.get_zorder() < 1 for p in by_gid(ax, oid)["patches"])
    assert by_gid(ax, 12)["collections"][0].get_zorder() < 1
    assert all(a.get_zorder() > top_series for a in by_gid(ax, 0)["lines"] + by_gid(ax, 1)["lines"])
    # Legend: series first, then labelled overlays in draw order.
    assert legend_texts(ax) == ["Signal", "threshold", "crossing", "window"]


def test_scatterplot_repeating_band_reaches_the_left_edge(fig_ax):
    fig, ax = fig_ax
    plot, cols = load_demo("demo-tp-crossing", "scatterplot")
    plot["plot"]["overlays"] = [ov(1, "band", "repeating", nightDurationHours=6)]
    plot["plot"]["xlimsIN"] = [-30, None]
    rt.plot_scatterplot(plot, cols, ax)
    rep = by_gid(ax, 1)["patches"]
    # Manual minimum -30 is also the anchor (xlimsUnpadded[0]): bands at -30, -6, 18, 42.
    assert [round(p.get_x(), 9) for p in rep] == [-30, -6, 18, 42]
    assert ax.get_xlim()[0] == -30


def _time_session():
    """A scatterplot over a time column (epoch ms, 1 h steps over two days) plus an
    hours-from-origin number column, so x channels exercise the time conversion."""
    h = 3600000
    t0 = 1_700_000_000_000 - (1_700_000_000_000 % (24 * h))  # a UTC midnight
    n = 48
    session = {
        "rawData": {"1": [t0 + i * h for i in range(n)],
                    "2": [50 + 10 * ((i % 24) < 12) for i in range(n)],
                    "3": [6, 30]},
        "data": [{"id": 1, "name": "time", "type": "time", "data": 1},
                 {"id": 2, "name": "activity", "type": "number", "data": 2},
                 {"id": 3, "name": "alerts_h", "type": "number", "data": 3,
                  "originTime_ms": t0}],
    }
    plot = {"id": 1, "name": "Time scatter", "type": "scatterplot", "plot": {
        "xlimsIN": [None, None], "ylimsLeftIN": [None, None], "ylimsRightIN": [None, None],
        "legend": {"show": True},
        "data": [{"x": {"refId": 1}, "y": {"refId": 2}, "yAxis": "left",
                  "line": {"colour": "#234154"}, "points": {}}],
        "overlays": [ov(1, "line", "vertical", wire={"at": 3}, label="alert"),
                     ov(2, "line", "vertical", at=[t0 + 30 * h])],
        "nightBands": [{"mode": "repeating", "nightDurationHours": 12, "repeatEveryHours": 24,
                        "startTimeHours": 0, "useDataMin": True, "colour": "#00000030"}],
    }}
    return session, plot, t0, h


def test_scatterplot_time_axis_and_migrated_night_bands(fig_ax):
    fig, ax = fig_ax
    session, plot, t0, h = _time_session()
    _raw, cols = build_columns(session)
    rt.plot_scatterplot(plot, cols, ax)
    num = lambda ms: mdates.date2num(pd.Timestamp(ms, unit="ms", tz="UTC"))  # noqa: E731
    # The wired hours column (origin t0) lands at t0 + 6 h and t0 + 30 h on the date axis.
    assert [vline_x(a) for a in by_gid(ax, 1)["lines"]] == pytest.approx(
        [num(t0 + 6 * h), num(t0 + 30 * h)])
    # A typed position on a time axis is already epoch ms.
    assert vline_x(by_gid(ax, 2)["lines"][0]) == pytest.approx(num(t0 + 30 * h))
    # The legacy night band (no id) is migrated behind the overlays: 12 h from the data
    # minimum t0, every 24 h, clamped to the axis (whose margin reaches past t0 + 48 h).
    night = [a for a in ax.patches if (a.get_gid() or "").startswith("overlay-")]
    lo, hi = ax.get_xlim()
    assert lo < num(t0) and hi > num(t0 + 48 * h)
    assert [p.get_x() for p in night] == pytest.approx(
        [num(t0), num(t0 + 24 * h), num(t0 + 48 * h)])
    assert [p.get_width() for p in night[:2]] == pytest.approx([0.5, 0.5])
    assert night[2].get_x() + night[2].get_width() == pytest.approx(hi)
    assert legend_texts(ax) == ["activity", "alert"]


def test_scatterplot_number_series_counts_hours_from_its_origin_on_a_time_axis(fig_ax):
    fig, ax = fig_ax
    session, plot, t0, h = _time_session()
    session["rawData"]["4"] = [1, 2]
    session["data"].append({"id": 4, "name": "y2", "type": "number", "data": 4})
    plot["plot"]["data"].append({"x": {"refId": 3}, "y": {"refId": 4}, "yAxis": "left",
                                 "line": {}, "points": {}})
    _raw, cols = build_columns(session)
    rt.plot_scatterplot(plot, cols, ax)
    num = lambda ms: mdates.date2num(pd.Timestamp(ms, unit="ms", tz="UTC"))  # noqa: E731
    second = [a for a in ax.lines if a.get_label() == "y2"][0]
    assert list(mdates.date2num(second.get_xdata())) == pytest.approx(
        [num(t0 + 6 * h), num(t0 + 30 * h)])


def test_scatterplot_overlays_read_on_the_right_axis_when_the_left_is_empty():
    fig, ax = plt.subplots()
    try:
        plot, cols = load_demo("demo-tp-crossing", "scatterplot")
        plot["plot"]["data"][0]["yAxis"] = "right"
        plot["plot"]["overlays"] = [ov(1, "line", "horizontal", at=[500])]
        ax_r = ax.twinx()
        rt.plot_scatterplot(plot, cols, ax, ax_r)
        assert counts(ax_r, 1)["lines"] == 1 and counts(ax, 1)["lines"] == 0
        assert ax_r.get_ylim()[1] >= 500
    finally:
        plt.close(fig)


def test_periodogram_overlays_widen_power_but_never_the_period_range(fig_ax):
    fig, ax = fig_ax
    plot, cols = load_demo("demo-periodogram-rhythm", "periodogram")
    inner = plot["plot"]
    del inner["periodlimsIN"]  # default [1, 30] range, and no manual x limits to hide a widening
    inner["overlays"] = [
        ov(1, "line", "vertical", at=[24, 80], label="24 h"),
        ov(2, "band", "vertical", start=[20], end=[28]),
        ov(3, "line", "horizontal", at=[1e6]),
        ov(4, "band", "ribbon", x=[10, 20, 30], lower=[0, 0, 0], upper=[1, 2, 1]),
    ]
    fig2, ax2 = plt.subplots()
    try:
        bare = copy.deepcopy(plot)
        bare["plot"]["overlays"] = []
        rt.plot_periodogram(bare, cols, ax2)
        xlim_without = ax2.get_xlim()
    finally:
        plt.close(fig2)
    rt.plot_periodogram(plot, cols, ax)
    assert [vline_x(a) for a in by_gid(ax, 1)["lines"]] == [24, 80]  # 80 drawn, off-range
    assert ax.get_xlim() == pytest.approx(xlim_without)
    assert counts(ax, 2) == {"lines": 0, "patches": 1, "collections": 0}
    assert ax.get_ylim()[1] >= 1e6
    assert counts(ax, 4)["collections"] == 1
    assert "24 h" in legend_texts(ax)


def test_correlogram_overlays_widen_correlation_only(fig_ax):
    fig, ax = fig_ax
    plot, cols = load_demo("demo-correlogram-rhythm", "correlogram")
    plot["plot"]["overlays"] = [
        ov(1, "line", "vertical", at=[24, 500]),
        ov(2, "band", "horizontal", lower=[-0.2], upper=[0.2], edge=True),
        ov(3, "line", "horizontal", at=[3]),
    ]
    rt.plot_correlogram(plot, cols, ax)
    assert counts(ax, 1)["lines"] == 2
    assert ax.get_xlim()[1] < 500
    assert counts(ax, 2) == {"lines": 2, "patches": 1, "collections": 0}
    assert sorted(hline_y(a) for a in by_gid(ax, 2)["lines"]) == [-0.2, 0.2]
    assert ax.get_ylim()[1] >= 3


def test_correlogram_reads_the_saved_lag_range(fig_ax):
    fig, ax = fig_ax
    plot, cols = load_demo("demo-correlogram-rhythm", "correlogram")
    plot["plot"]["laglimsIN"] = [2, 30]
    rt.plot_correlogram(plot, cols, ax)
    assert ax.get_xlim() == (2, 30)


@pytest.mark.parametrize("show_period", [True, False], ids=["period", "frequency"])
def test_fft_vertical_marks_are_periods_in_both_modes(fig_ax, show_period):
    fig, ax = fig_ax
    plot, cols = load_demo("demo-fft-rhythm", "fft")
    inner = plot["plot"]
    inner["showPeriod"] = show_period
    inner["xlimsIN"] = [4, 30] if show_period else [None, None]
    inner["overlays"] = [
        ov(1, "line", "vertical", at=[24, 0], label="24 h"),
        ov(2, "band", "vertical", start=[20], end=[28]),
        ov(3, "line", "horizontal", at=[5]),
    ]
    rt.plot_fft(plot, cols, ax)
    (line,) = by_gid(ax, 1)["lines"]  # p = 0 has no place on either axis
    (span,) = by_gid(ax, 2)["patches"]
    if show_period:
        assert vline_x(line) == 24
        assert (span.get_x(), span.get_x() + span.get_width()) == pytest.approx((20, 28))
    else:
        assert vline_x(line) == pytest.approx(1 / 24)
        assert (span.get_x(), span.get_x() + span.get_width()) == pytest.approx((1 / 28, 1 / 20))
    assert hline_y(by_gid(ax, 3)["lines"][0]) == 5
    assert "24 h" in legend_texts(ax)


def test_fft_log_scale_is_the_magnitude_axis_and_skips_non_positive_marks(fig_ax):
    fig, ax = fig_ax
    plot, cols = load_demo("demo-fft-rhythm", "fft")
    plot["plot"]["logScale"] = True
    plot["plot"]["overlays"] = [ov(1, "line", "horizontal", at=[0, -1, 2]),
                                ov(2, "band", "horizontal", lower=[0], upper=[1])]
    rt.plot_fft(plot, cols, ax)
    assert ax.get_yscale() == "log" and ax.get_xscale() == "linear"
    assert [hline_y(a) for a in by_gid(ax, 1)["lines"]] == [2]
    assert counts(ax, 2)["patches"] == 0


def test_periodogram_log_scale_is_the_power_axis_and_skips_non_positive_marks(fig_ax):
    fig, ax = fig_ax
    plot, cols = load_demo("demo-periodogram-rhythm", "periodogram")
    plot["plot"]["logScale"] = True
    plot["plot"]["overlays"] = [ov(1, "line", "horizontal", at=[0, -1, 2]),
                                ov(2, "band", "horizontal", lower=[0], upper=[1])]
    rt.plot_periodogram(plot, cols, ax)
    assert ax.get_yscale() == "log" and ax.get_xscale() == "linear"
    assert [hline_y(a) for a in by_gid(ax, 1)["lines"]] == [2]
    assert counts(ax, 2)["patches"] == 0


def test_periodogram_log_scale_off_by_default(fig_ax):
    fig, ax = fig_ax
    plot, cols = load_demo("demo-periodogram-rhythm", "periodogram")
    plot["plot"].pop("logScale", None)
    rt.plot_periodogram(plot, cols, ax)
    assert ax.get_yscale() == "linear"


@pytest.mark.parametrize("label, methods, expected", [
    ("", ["Lomb-Scargle"], "Normalised power"),
    ("", ["Chi-squared", "Chi-squared"], "Chi-squared Qp"),
    ("", ["Enright"], "Enright amplitude (A_p)"),
    ("", ["Lomb-Scargle", "Chi-squared"], "Statistic (mixed methods)"),
    ("Power", ["Chi-squared"], "Power"),  # a stored label (old default included) is kept
    ("My label", ["Enright"], "My label"),
])
def test_periodogram_y_title_names_the_statistic_unless_one_is_stored(fig_ax, label, methods,
                                                                      expected):
    fig, ax = fig_ax
    plot, cols = load_demo("demo-periodogram-rhythm", "periodogram")
    inner = plot["plot"]
    first = inner["data"][0]
    inner["data"] = [dict(copy.deepcopy(first), method=m) for m in methods]
    inner["yAxis"] = dict(inner.get("yAxis") or {}, label=label)
    rt.plot_periodogram(plot, cols, ax)
    assert ax.get_ylabel() == expected


def test_boxplot_draws_horizontal_marks_only(fig_ax):
    fig, ax = fig_ax
    plot, cols = load_demo("demo-boxplot-by-day", "boxplot")
    plot["plot"]["overlays"] = [
        ov(1, "line", "horizontal", at=[40], label="target"),
        ov(2, "band", "horizontal", lower=[10], upper=[20]),
        ov(3, "line", "vertical", at=[150]),  # coerced: Boxplot allows horizontal only
    ]
    rt.plot_boxplot(plot, cols, ax)
    assert hline_y(by_gid(ax, 1)["lines"][0]) == 40
    (span,) = by_gid(ax, 2)["patches"]
    assert (span.get_y(), span.get_y() + span.get_height()) == pytest.approx((10, 20))
    assert hline_y(by_gid(ax, 3)["lines"][0]) == 150
    assert ax.get_ylim()[1] >= 150
    assert legend_texts(ax) == ["target"]


# ---- the whole export path ------------------------------------------------------------

def overlay_session():
    """One session with overlays on every plot type the runtime renders: the demos for
    scatter (demo-tp-crossing, with its Crossing node), periodogram, correlogram, FFT (in
    period AND frequency mode) and boxplot, merged (their column ids never collide)."""
    parts = {sid: json.loads((DEMOS / f"{sid}.json").read_text()) for sid in (
        "demo-tp-crossing", "demo-periodogram-rhythm", "demo-correlogram-rhythm",
        "demo-fft-rhythm", "demo-boxplot-by-day")}
    base = copy.deepcopy(parts["demo-tp-crossing"])
    base["plots"] = [p for p in base["plots"] if p["type"] == "scatterplot"]
    for sid, s in parts.items():
        if sid == "demo-tp-crossing":
            continue
        base["rawData"].update(s["rawData"])
        base["data"] += s["data"]
        base["plots"] += copy.deepcopy(s["plots"])
    fft = next(p for p in base["plots"] if p["type"] == "fft")
    fft_freq = copy.deepcopy(fft)
    fft_freq["name"] = "FFT frequency"
    fft_freq["plot"]["showPeriod"] = False
    fft_freq["plot"]["xlimsIN"] = [None, None]
    # What the app's toggle writes (fftAxis.js: an automatic label follows the mode).
    fft_freq["plot"]["xAxis"]["label"] = "Frequency (cycles/h)"
    base["plots"].append(fft_freq)
    for i, p in enumerate(base["plots"]):
        p["id"] = 900 + i
    add = {
        "scatterplot": [ov(20, "band", "vertical", start=[5], end=[10], label="window"),
                        ov(21, "band", "repeating", nightDurationHours=6)],
        "periodogram": [ov(22, "line", "vertical", at=[24], label="24 h"),
                        ov(23, "band", "vertical", start=[20], end=[28])],
        "correlogram": [ov(24, "line", "vertical", at=[24]),
                        ov(25, "band", "horizontal", lower=[-0.2], upper=[0.2])],
        "fft": [ov(26, "line", "vertical", at=[24], label="24 h"),
                ov(27, "line", "horizontal", at=[5])],
        "boxplot": [ov(28, "line", "horizontal", at=[40], label="target"),
                    ov(29, "band", "horizontal", lower=[10], upper=[20])],
    }
    for p in base["plots"]:
        p["plot"]["overlays"] = (p["plot"].get("overlays") or []) + copy.deepcopy(add[p["type"]])
    return base


def test_render_plots_draws_every_type_with_overlays(tmp_path):
    session = overlay_session()
    cols, _raw, errors = run_session(session)
    assert not errors
    buf = io.StringIO()
    with redirect_stdout(buf):
        written = rt.render_plots(session["plots"], cols, tmp_path)
    log = buf.getvalue()
    assert "error rendering" not in log, log
    assert len(written) == len(session["plots"]) == 6
    assert all(p.stat().st_size > 0 for p in written)


def test_unrendered_overlay_hosts_stay_unrendered():
    """Histogram, Q-Q plot, Mean +/- SEM and CWT carry overlays in the app, but the runtime
    renders none of them (no plot function): confirm, so adding one is a conscious step
    that must also call _draw_overlays."""
    for ptype in ("histogram", "qqplot", "meansem", "cwt"):
        assert ptype not in rt.PLOT_TYPE_DISPATCH
        assert ptype not in rt.OVERLAY_CAPABILITIES
