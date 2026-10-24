"""
Shared by the tools/test_plot_*.py suites that check the export's remaining plot features
(FFT phase, the 'auto' legend, the actogram's extras, the wavelet scalogram) against what the
APP draws: tools/parity/plot_extras_app.json, written by
src/lib/_parity/emitPlotExtras.svelte.test.js (regenerate:
GEN_PLOT_EXTRAS=1 pnpm vitest run src/lib/_parity/emitPlotExtras.svelte.test.js).

Each case is a real demo session with one plot edited the way the app's controls edit it; the
fixture carries the plot as the app saves (and so exports) it once loaded, the colours the app
resolved for its series and what the mounted component drew.
"""

from __future__ import annotations

import copy
import json
import sys
from contextlib import contextmanager
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.colors import to_rgba  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import ancir_runtime as rt  # noqa: E402
from test_session_parity import run_session  # noqa: E402

FIXTURE = json.loads((HERE / "parity" / "plot_extras_app.json").read_text())
CASES = {c["name"]: c for c in FIXTURE["cases"]}
DEMOS = ROOT / "static" / "sessions" / "demos"
_SESSIONS = {}


def cases_of(kind):
    return sorted(n for n, c in CASES.items() if c["kind"] == kind)


@contextmanager
def estimated_label_widths():
    """Label widths as the app's tests measure them (no canvas in jsdom: 0.55 em a
    character), so a legend box is the fixture's to the last digit."""
    old = rt.LEGEND_LABEL_WIDTHS
    rt.LEGEND_LABEL_WIDTHS = "estimate"
    try:
        yield
    finally:
        rt.LEGEND_LABEL_WIDTHS = old


def columns_for(case):
    """The demo's columns after its analyses run, with the app's names for node outputs, plus
    any columns the case added to the demo (`addedColumns`: a zoned time axis, say)."""
    added = case.get("addedColumns")
    key = (case["demo"], case["name"] if added else None)
    if key not in _SESSIONS:
        session = json.loads((DEMOS / f"{case['demo']}.json").read_text())
        if added:
            session["data"] = list(session.get("data") or []) + list(added["data"])
            session["rawData"] = {**(session.get("rawData") or {}), **added["rawData"]}
        cols, _raw, errors = run_session(session)
        assert not errors, errors
        _SESSIONS[key] = cols
    cols = _SESSIONS[key]
    for cid, label in (case.get("columnLabels") or {}).items():
        if int(cid) in cols:
            cols[int(cid)].label = label
    return cols


def render(name, *, estimate=True):
    """One case's plot as the exported script draws it (the saved padding, as the emitter's
    jsdom lays it out): (fig, ax, case)."""
    case = CASES[name]
    cols = columns_for(case)
    rt.set_display_timezone(case.get("zone") or "utc")
    plot = copy.deepcopy(case["plotJSON"])
    if estimate:
        with estimated_label_widths():
            fig, ax = rt.render_plot_figure(plot, cols, auto_pad=False)
    else:
        fig, ax = rt.render_plot_figure(plot, cols, auto_pad=False)
    fig.canvas.draw()
    return fig, ax, case


def close_all():
    rt.set_display_timezone("utc")
    plt.close("all")


def app_px_of_display(fig, x, y):
    """A display point (matplotlib px, y up) in the app's plot px (x right, y down from the
    plot's own top left, below the export's title band)."""
    g = fig._ancir_geometry
    k = rt._FIG_PX_PER_IN / fig.dpi
    return x * k, g["fig_h"] - y * k - g["band"]


def app_bbox(fig, artist):
    """An artist's window extent as (left, top, right, bottom) in the app's plot px."""
    bb = artist.get_window_extent(fig.canvas.get_renderer())
    x0, y1 = app_px_of_display(fig, bb.x0, bb.y0)
    x1, y0 = app_px_of_display(fig, bb.x1, bb.y1)
    return x0, y0, x1, y1


def data_to_app(ax, x, y):
    """A data point on `ax` in the app's plot px."""
    dx, dy = ax.transData.transform((x, y))
    return app_px_of_display(ax.figure, dx, dy)


def rgb255(c):
    if isinstance(c, str) and c.startswith("rgb"):
        c = rt._mpl_colour(c)
    r, g, b, a = to_rgba(c)
    return (round(r * 255), round(g * 255), round(b * 255), round(a * 255))


def rle_decode(rle, n):
    out = bytearray(n)
    k, v = 0, 0
    for run in rle:
        if v:
            out[k:k + run] = b"\x01" * run
        k += run
        v ^= 1
    return out


def legend_of(fig):
    """The figure's legend, on whichever axes carries it (the top-most of twinned axes)."""
    for a in fig.axes:
        if a.get_legend() is not None:
            return a.get_legend()
    return None
