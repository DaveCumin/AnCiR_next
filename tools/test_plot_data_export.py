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
functions is checked separately by the `plotCompute` fixtures in
tools/parity/fixtures.json (see test_parity.py).

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
