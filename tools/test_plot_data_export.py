#!/usr/bin/env python3
"""
Plot computed-data export tests (Python side).

For each calculating-plot demo session, build the runtime columns and run the
matching plot-data builder in ancir_runtime.py. Assert the CSV contract:
headers match the app's `getDownloadData()` exactly (Actogram/Periodogram/
FFT/Correlogram .svelte), every row has the right arity, and the derived
numbers are finite and land where the seeded 24 h rhythm says they should.

This is the end-to-end check of the Python export path (including the ported
actogram binning). Numeric JS↔Python parity for the FFT/correlogram compute
functions and for the actogram's rows (several series starting on different
days, a non-UTC display zone, a mid-day start) is checked separately by the
`plotCompute` fixtures in tools/parity/fixtures.json (see test_parity.py).

    tools/.venv/bin/python -m pytest tools/test_plot_data_export.py -q
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import ancir_runtime as rt  # noqa: E402
from test_session_parity import build_columns  # noqa: E402

DEMOS = ROOT / "static" / "sessions" / "demos"

# demo file -> (plot type, exact headers the JS getDownloadData produces)
CASES = {
    "demo-periodogram-rhythm": (
        "periodogram", ["DataSeries", "Period (hours)", "Power"]),
    "demo-fft-rhythm": (
        "fft", ["DataSeries", "Frequency (cycles/hr)", "Period (hours)", "Magnitude"]),
    "demo-correlogram-rhythm": (
        "correlogram", ["DataSeries", "Lag (hours)", "Autocorrelation"]),
    "demo-actogram-rhythm": (
        "actogram", ["DataSeries", "Period", "BinStart (hrs)", "BinEnd (hrs)", "Value"]),
}


def _load(sid):
    session = json.loads((DEMOS / f"{sid}.json").read_text())
    _, cols = build_columns(session)
    plot = next(p for p in session["plots"] if p.get("type") == CASES[sid][0])
    return plot, cols


def _finite(v):
    return isinstance(v, (int, float)) and not (isinstance(v, float) and math.isnan(v))


@pytest.mark.parametrize("sid", list(CASES), ids=list(CASES))
def test_headers_and_shape(sid):
    ptype, want_headers = CASES[sid]
    plot, cols = _load(sid)
    headers, rows = rt.PLOT_DATA_BUILDERS[ptype](plot, cols)
    assert headers == want_headers, f"{sid}: headers {headers} != {want_headers}"
    assert rows, f"{sid}: no rows produced"
    for r in rows:
        assert len(r) == len(headers), f"{sid}: row arity {len(r)} != {len(headers)}"
        assert r[0] == 0, f"{sid}: single-series demo should be series 0"


def test_periodogram_peaks_at_24h():
    plot, cols = _load("demo-periodogram-rhythm")
    _, rows = rt.periodogram_download_data(plot, cols)
    peak = max(rows, key=lambda r: r[2])
    assert abs(peak[1] - 24.0) < 1.0, f"periodogram peak at {peak[1]} h, expected ~24"


def test_periodogram_uses_each_series_method_and_bin_size():
    """Method, bin size and alpha live on the SERIES (PeriodogramDataclass), and the range is
    periodlimsIN widened by 25% each side. The export used to read a plot-level method the
    app never stores, so every exported periodogram was Lomb-Scargle on 1 to 48 h."""
    plot, cols = _load("demo-periodogram-rhythm")
    series = plot["plot"]["data"][0]
    series["method"], series["binSize"] = "Enright", 1
    headers, rows = rt.periodogram_download_data(plot, cols)
    assert headers == ["DataSeries", "Period (hours)", "Power"]
    lo, hi = plot["plot"]["periodlimsIN"]
    span = hi - lo
    periods = [r[1] for r in rows]
    # One point per whole-hour fold inside the buffered range [max(0.01, lo - span/4), hi + span/4],
    # except the 1-column fold, which has no spread to measure.
    assert periods == list(range(2, int(hi + span / 4) + 1))
    assert all(r[2] >= 0 for r in rows), "Enright's A_p is never negative"
    assert max(rows, key=lambda r: r[2])[1] == 24
    series["method"] = "Chi-squared"
    headers, rows = rt.periodogram_download_data(plot, cols)
    assert headers[-2:] == ["Threshold", "P-value"]


def _legacy_periodogram_session(version, **series_fields):
    """The hourly periodogram demo (saved by β.72.29) with its one series edited."""
    session = json.loads((DEMOS / "demo-periodogram-rhythm.json").read_text())
    if version is not None:
        session["version"] = version
    series = next(p for p in session["plots"] if p["type"] == "periodogram")["plot"]["data"][0]
    for k, v in series_fields.items():
        if v is None:
            series.pop(k, None)
        else:
            series[k] = v
    return session


def _migrated_rows(session):
    """migrate_legacy_enright_bins, then the plot's data rows, as the exported script runs."""
    session, n = rt.migrate_legacy_enright_bins(session)
    _, cols = build_columns(session)
    plot = next(p for p in session["plots"] if p["type"] == "periodogram")
    _, rows = rt.periodogram_download_data(plot, cols)
    return n, plot["plot"]["data"][0], rows


@pytest.mark.parametrize("bin_size", [0.25, None], ids=["at-0.25", "no-bin-size"])
def test_legacy_enright_series_migrates_to_the_sampling_interval(bin_size):
    """v81.0: a pre-v81 Enright series at the hidden 0.25 h follows its x (the app's
    enrightBinMigration.js), so on hourly data it folds at whole hours and peaks at 24 h."""
    session = _legacy_periodogram_session(None, method="Enright", binSize=bin_size)
    assert session["version"] == "β.72.29"
    n, series, rows = _migrated_rows(session)
    assert n == 1
    assert series["binSizeAuto"] is True
    assert all(float(r[1]).is_integer() for r in rows), "1 h bins fold at whole hours"
    assert max(rows, key=lambda r: r[2])[1] == 24


@pytest.mark.parametrize("version,fields,bin_size", [
    (None, {"method": "Enright", "binSize": 0.5}, 0.5),
    (None, {"method": "Chi-squared", "binSize": 0.25}, 0.25),
    ("v81.0", {"method": "Enright", "binSize": 0.25}, 0.25),
    ("β.80.0", {"method": "Enright", "binSize": 0.25, "binSizeAuto": False}, 0.25),
], ids=["enright-own-bin", "chi-squared", "v81-session", "has-binSizeAuto"])
def test_other_series_keep_their_bin_size(version, fields, bin_size):
    n, series, rows = _migrated_rows(_legacy_periodogram_session(version, **fields))
    assert n == 0
    assert "binSizeAuto" not in series or series["binSizeAuto"] is False
    assert 24 + bin_size in [r[1] for r in rows], f"folds at {bin_size} h steps"


def test_a_session_with_no_version_is_legacy():
    session = _legacy_periodogram_session(None, method="Enright", binSize=0.25)
    del session["version"]
    n, series, _ = _migrated_rows(session)
    assert n == 1 and series["binSizeAuto"] is True


def test_only_periodogram_plots_migrate():
    session = {"version": "β.79.0", "plots": [
        {"type": "actogram", "plot": {"data": [{"method": "Enright", "binSize": 0.25}]}}]}
    migrated, n = rt.migrate_legacy_enright_bins(session)
    assert n == 0 and migrated is session


def test_the_png_renderer_uses_the_migrated_bin_size():
    """plot_periodogram (the exported PNG) computes with the same bin size as the CSV."""
    session, _ = rt.migrate_legacy_enright_bins(
        _legacy_periodogram_session(None, method="Enright", binSize=0.25))
    _, cols = build_columns(session)
    plot = next(p for p in session["plots"] if p["type"] == "periodogram")

    class Ax:
        def __init__(self):
            self.lines = []

        def plot(self, x, y, **_kw):
            self.lines.append((list(x), list(y)))

        def __getattr__(self, _name):
            return lambda *a, **k: None

    ax = Ax()
    rt.plot_periodogram(plot, cols, ax)
    x, y = ax.lines[0]
    assert all(float(p).is_integer() for p in x)
    assert x[y.index(max(y))] == 24


def test_a_script_emitted_from_a_legacy_session_migrates_it(tmp_path):
    """tools/ancir_to_python.py run directly on a legacy session file: the emitted script
    migrates the series before plotting, so its plot data peaks at 24 h on whole hours."""
    import csv
    import subprocess
    import ancir_to_python
    src = tmp_path / "legacy.json"
    src.write_text(json.dumps(
        _legacy_periodogram_session(None, method="Enright", binSize=0.25)))
    script = tmp_path / "legacy.py"
    ancir_to_python.emit(src, script)
    subprocess.run([sys.executable, str(script)], check=True, capture_output=True,
                   cwd=tmp_path)
    (data,) = (tmp_path / "legacy_output").glob("*_periodogram_data.csv")
    rows = [(float(r[1]), float(r[2])) for r in list(csv.reader(data.open()))[1:]]
    assert all(p.is_integer() for p, _ in rows)
    assert max(rows, key=lambda r: r[1])[0] == 24


def test_migration_does_not_mutate_its_input():
    session = _legacy_periodogram_session(None, method="Enright", binSize=0.25)
    before = json.dumps(session)
    migrated, n = rt.migrate_legacy_enright_bins(session)
    assert n == 1 and migrated is not session
    assert json.dumps(session) == before


def test_median_sampling_interval_matches_the_app():
    """periodogram.js medianSamplingInterval: sorted usable x, positive gaps, even-count mean."""
    assert rt.median_sampling_interval([0, 1, 2, 3]) == 1
    assert rt.median_sampling_interval([3, None, 0, "", 1, 1, 2.5]) == 1
    assert rt.median_sampling_interval([0, 1, 3, 6]) == 2
    assert rt.median_sampling_interval([0, 0.5, 1.5, 2.0, 4.0]) == 0.75
    assert math.isnan(rt.median_sampling_interval([5, 5]))
    assert math.isnan(rt.median_sampling_interval([]))


def test_fft_peaks_near_24h():
    plot, cols = _load("demo-fft-rhythm")
    _, rows = rt.fft_download_data(plot, cols)
    # period column may be '' for the DC bin — skip those
    withper = [r for r in rows if _finite(r[2])]
    peak = max(withper, key=lambda r: r[3])
    assert abs(peak[2] - 24.0) < 3.0, f"FFT peak at {peak[2]} h, expected ~24"


def test_actogram_bins_are_left_edge_and_tiled_by_period():
    plot, cols = _load("demo-actogram-rhythm")
    period_hrs = float(plot["plot"].get("periodHrs", 24) or 24)
    _, rows = rt.actogram_download_data(plot, cols)
    for _, per, x_start, x_end, val in rows:
        assert per >= 1, "periods are numbered from 1"
        assert x_end > x_start, "bin end must exceed bin start"
        assert _finite(val), "bin value must be finite"
        # each bin lives within (or clipped to) its period's window
        assert (per - 1) * period_hrs - 1e-9 <= x_start < per * period_hrs + 1e-9


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
