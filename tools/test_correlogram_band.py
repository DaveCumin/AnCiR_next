#!/usr/bin/env python3
"""
The Correlogram's significance band (decision 2026-11-01), Python side.

  - correlogram_band('bartlett') is pinned to statsmodels' acf(bartlett_confint=True), the band
    statsmodels.graphics.tsaplots.plot_acf draws (Bartlett 1946, J. R. Statist. Soc. Suppl.
    8:27-41). statsmodels' z is norm.ppf(1 - alpha / 2); the app keeps the 1.96 it has always
    used, so standard errors are compared;
  - 'nk' is z / sqrt(N - k), 'white' z / sqrt(N);
  - which band a saved series draws (correlogram_band_method, as the app's
    correlogramBandMethodOf);
  - the exported figure draws the series' band (the bound lines' y data).

The JS side (utils/correlogram.js) is held to the same numbers by the parity fixtures
plot-correlogram-band-* and utils/correlogram.band.test.js.

    tools/.venv/bin/python -m pytest tools/test_correlogram_band.py -q
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from scipy.stats import norm  # noqa: E402
from statsmodels.tsa.stattools import acf as sm_acf  # noqa: E402

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ancir_runtime as rt  # noqa: E402


def ar1(n, phi, seed, amp=0.0):
    rng = np.random.default_rng(seed)
    e, out = 0.0, []
    for i in range(n):
        e = phi * e + rng.normal()
        out.append(e + amp * math.cos(2 * math.pi * i / 24))
    return out


@pytest.mark.parametrize("n,phi,amp,seed", [(60, 0.6, 0.0, 1), (240, 0.5, 0.8, 2),
                                            (168, 0.0, 0.0, 3), (96, 0.9, 1.5, 4)])
def test_bartlett_matches_statsmodels(n, phi, amp, seed):
    y = ar1(n, phi, seed, amp)
    t = list(range(n))
    nlags = n // 2 - 1
    ac = rt.compute_autocorrelation(t, y, None, nlags)
    band = rt.correlogram_band(ac, "bartlett", 0.95)
    _, conf = sm_acf(np.array(y), nlags=nlags, alpha=0.05, bartlett_confint=True, fft=False)
    r_sm = sm_acf(np.array(y), nlags=nlags, fft=False)
    sm_se = (conf[:, 1] - r_sm) / norm.ppf(0.975)
    assert math.isnan(band[0])
    for k in range(1, nlags + 1):
        assert band[k] / 1.96 == pytest.approx(sm_se[k], rel=1e-10, abs=1e-14), k


def test_bartlett_with_a_min_lag_sums_from_lag_one():
    y = ar1(120, 0.6, 9)
    t = list(range(120))
    full = rt.compute_autocorrelation(t, y, None, 40)
    win = rt.compute_autocorrelation(t, y, None, 40, 10)
    assert win["lags"][0] == 10
    assert rt.correlogram_band(win, "bartlett", full=full)[-1] == pytest.approx(
        rt.correlogram_band(full, "bartlett")[-1], rel=1e-14)


def test_nk_and_white():
    y = ar1(100, 0.3, 5)
    ac = rt.compute_autocorrelation(list(range(100)), y, None, 30)
    nk = rt.correlogram_band(ac, "nk", 0.99)
    assert nk[30] == pytest.approx(2.576 / math.sqrt(70), rel=1e-15)
    white = rt.correlogram_band(ac, "white", 0.95, n_white=100)
    assert set(white) == {1.96 / math.sqrt(100)}
    assert set(rt.correlogram_band(ac, "white", 0.95, n_white=1)) == {0.0}


def test_band_method_of_a_saved_series():
    for m in rt.CORRELOGRAM_BAND_METHODS:
        assert rt.correlogram_band_method({"bandMethod": m, "showConfidenceBounds": True}) == m
    assert rt.correlogram_band_method({"showConfidenceBounds": True}) == "white"
    assert rt.correlogram_band_method({"showConfidenceBounds": False}) == "white"
    assert rt.correlogram_band_method({"x": {"refId": 1}, "y": {"refId": 2}}) == "bartlett"


def _plot(series_extra):
    raw = {1: list(range(120)), 2: ar1(120, 0.5, 11, 1.0)}
    cols = {1: rt.Column(id=1, name="t", type="number", data=1, raw_data=raw),
            2: rt.Column(id=2, name="y", type="number", data=2, raw_data=raw)}
    series = {"x": {"refId": 1}, "y": {"refId": 2}, **series_extra}
    return {"type": "correlogram", "plot": {"data": [series]}}, cols


@pytest.mark.parametrize("extra,method", [({}, "bartlett"),
                                          ({"showConfidenceBounds": True}, "white"),
                                          ({"bandMethod": "nk"}, "nk")])
def test_exported_figure_draws_the_series_band(extra, method):
    plot, cols = _plot(extra)
    fig, ax = plt.subplots()
    try:
        rt.plot_correlogram(plot, cols, ax)
        bounds = [ln for ln in ax.lines if ln.get_gid() == "confidence-0"]
        assert len(bounds) == 2
        ac = rt.correlogram_series_acf(plot["plot"]["data"][0], cols)
        want = rt.correlogram_band(ac, method, 0.95, n_white=120)
        got = list(bounds[0].get_ydata())
        assert len(got) == len(want)
        for g, w in zip(got, want):
            assert (math.isnan(g) and math.isnan(w)) or g == pytest.approx(w, rel=1e-15)
        assert list(bounds[1].get_ydata())[5] == pytest.approx(-want[5])
    finally:
        plt.close(fig)
