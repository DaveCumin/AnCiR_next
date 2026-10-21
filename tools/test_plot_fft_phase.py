#!/usr/bin/env python3
"""
The exported FFT's phase checked against the APP (tools/parity/plot_extras_app.json, the 'fft'
cases of src/lib/_parity/emitPlotExtras.svelte.test.js): the demo FFT with "Show phase" on, in
period and in frequency mode, with the phase line or points switched off, a chosen colour and
width, a manual phase range and a renamed phase axis.

Pinned here:
  - the right-hand phase axis: its ticks (values and labels), gridlines and title, exactly,
    and its domain (the drawn phases padded 10%, or the saved phaseYlimsIN) to 1e-9;
  - each series' phase curve: its x (period or frequency, f = 0 dropped in period mode) and
    phase values to 1e-6 of the app's, and the line / points it is drawn with (colour, width,
    marker, shown or not);
  - the legend's entries: each series' magnitude entry, then "<series> phase".

    tools/.venv/bin/python -m pytest tools/test_plot_fft_phase.py -q
"""

from __future__ import annotations

import pytest

from plot_extras_support import cases_of, close_all, render, rgb255, legend_of

FFT_CASES = cases_of("fft")


@pytest.fixture(autouse=True)
def _reset():
    yield
    close_all()


def phase_axes(fig, ax):
    others = [a for a in fig.axes if a is not ax and a.get_gid() != "colour-key"]
    assert len(others) == 1
    return others[0]


def ticks_on(a, axis):
    lo, hi = sorted(a.get_ylim() if axis == "y" else a.get_xlim())
    ax_ = a.yaxis if axis == "y" else a.xaxis
    eps = 1e-9 * abs(hi - lo)
    return [(loc, lab.get_text()) for loc, lab in zip(ax_.get_ticklocs(), ax_.get_ticklabels())
            if lo - eps <= loc <= hi + eps]


@pytest.mark.parametrize("name", FFT_CASES)
def test_the_phase_axis_is_the_apps(name):
    fig, ax, case = render(name)
    exp = case["expected"]
    tw = phase_axes(fig, ax)
    assert tw.get_ylim() == pytest.approx(exp["fft"]["phaseDomain"], abs=1e-9)
    right = exp["axes"]["right"]
    got = ticks_on(tw, "y")
    assert [lab for _, lab in got] == [t["label"] for t in right["ticks"]], name
    assert [v for v, _ in got] == pytest.approx([t["value"] for t in right["ticks"]], abs=1e-9)
    assert tw.yaxis.label.get_text() == right["label"]
    grid = any(t["grid"] for t in right["ticks"])
    drawn_grid = [ln for ln in ax.get_lines() if ln.get_gid() == "gridline-right"]
    assert bool(drawn_grid) == grid, name
    assert tw.spines["right"].get_visible()


@pytest.mark.parametrize("name", FFT_CASES)
def test_the_other_axes_keep_the_apps_ticks(name):
    _fig, ax, case = render(name)
    for pos, axis in (("bottom", "x"), ("left", "y")):
        want = case["expected"]["axes"][pos]
        got = ticks_on(ax, axis)
        assert [lab for _, lab in got] == [t["label"] for t in want["ticks"]], (name, pos)


@pytest.mark.parametrize("name", FFT_CASES)
def test_each_phase_curve_is_the_apps(name):
    fig, ax, case = render(name)
    tw = phase_axes(fig, ax)
    colours = case["plotJSON"].get("seriesColours") or []
    for i, s in enumerate(case["expected"]["fft"]["series"]):
        if not s["showPhase"]:
            continue
        line = [ln for ln in tw.get_lines() if ln.get_gid() == f"series-{i}-phase-line"]
        pts = [c for c in tw.collections if c.get_gid() == f"series-{i}-phase-points"]
        assert bool(line) == s["phaseLine"]["draw"], name
        assert bool(pts) == s["phasePoints"]["draw"], name
        if line:
            ln = line[0]
            assert list(ln.get_xdata()) == pytest.approx(s["x"], rel=1e-9)
            assert list(ln.get_ydata()) == pytest.approx(s["phase"], abs=1e-6)
            assert rgb255(ln.get_color()) == rgb255(s["phaseLine"]["colour"])
            assert ln.get_linewidth() == pytest.approx(s["phaseLine"]["strokeWidth"] * 0.75)
        if pts:
            off = pts[0].get_offsets()
            assert list(off[:, 0]) == pytest.approx(s["x"], rel=1e-9)
            assert list(off[:, 1]) == pytest.approx(s["phase"], abs=1e-6)
            assert rgb255(pts[0].get_facecolor()[0]) == rgb255(s["phasePoints"]["colour"])
        # An automatic phase colour is the series' own (the colour the app resolved).
        if i < len(colours) and colours[i].get("line") and \
                not (case["plotJSON"]["plot"]["data"][i].get("phaseLine") or {}).get("colour"):
            assert rgb255(s["phaseLine"]["colour"]) == rgb255(colours[i]["line"])


@pytest.mark.parametrize("name", FFT_CASES)
def test_the_legend_lists_magnitude_then_phase(name):
    fig, _ax, case = render(name)
    leg = legend_of(fig)
    exp = case["expected"]["legend"]
    if not case["plotJSON"]["plot"]["legend"].get("show"):
        assert leg is None
        return
    assert [t.get_text() for t in leg.get_texts()] == exp["labels"]
