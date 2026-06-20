#!/usr/bin/env python3
"""
End-to-end SESSION parity — Python side.

Loads every session under static/sessions/{demos,classroom}/ through
ancir_runtime.py (build columns → run table processes), then compares each
column's final data, by column id, against the JS engine's output
(tools/parity/session_js_results.json, written by the vitest emitter).

Workflow:
    GEN_SESSION_PARITY=1 npx vitest run src/lib/_parity/emitSessionParity.svelte.test.js
    tools/.venv/bin/python tools/test_session_parity.py        # summary + per-column diffs
    tools/.venv/bin/python tools/test_session_parity.py -v     # also list matching columns

This is the whole-session check that the Python port reproduces the JS engine for
real shipped sessions (one per node, plus the classroom lessons).
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import ancir_runtime as rt  # noqa: E402

JS_RESULTS = HERE / "parity" / "session_js_results.json"
SESSION_DIRS = [ROOT / "static" / "sessions" / "demos",
                ROOT / "static" / "sessions" / "classroom"]
TOL = 1e-6


def _is_nan(v):
    return v is None or (isinstance(v, float) and math.isnan(v))


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def compare_column(js_col, py_values, tol=TOL):
    """Return (ok, reason). Category/time columns compare as strings; numeric
    columns within tolerance. None/NaN are equal to each other."""
    a = js_col["values"]
    b = py_values
    if b is None:
        return False, "python produced no data"
    if len(a) != len(b):
        return False, f"length {len(a)} vs {len(b)}"
    ctype = js_col.get("type")
    for i, (x, y) in enumerate(zip(a, b)):
        xm = x is None or (isinstance(x, float) and math.isnan(x))
        ym = y is None or (isinstance(y, float) and math.isnan(y))
        if xm and ym:
            continue
        if xm != ym:
            return False, f"index {i}: {x!r} vs {y!r} (one missing)"
        if ctype in ("category",):
            if str(x) != str(y):
                return False, f"index {i}: {x!r} vs {y!r}"
            continue
        # numeric / time: compare numerically when possible
        nx, ny = _num(x), _num(y)
        if _is_nan(nx) and _is_nan(ny):
            continue
        if nx is None or ny is None:
            # non-numeric (e.g. time ISO strings) — fall back to string equality
            if str(x) != str(y):
                return False, f"index {i}: {x!r} vs {y!r}"
            continue
        if _is_nan(nx) or _is_nan(ny):
            return False, f"index {i}: {x!r} vs {y!r} (one NaN)"
        if abs(nx - ny) > tol * max(1.0, abs(nx), abs(ny)):
            return False, f"index {i}: {nx!r} vs {ny!r} (diff {abs(nx - ny):.3e})"
    return True, ""


def build_columns(session):
    raw = {}
    for k, v in session.get("rawData", {}).items():
        key = int(k) if str(k).lstrip("-").isdigit() else k
        raw[key] = v
    cols = {}
    for c in session.get("data", []):
        cid = c.get("id")
        cols[cid] = rt.Column(
            id=cid, name=c.get("name"), type=c.get("type", "number"),
            data=c.get("data"), raw_data=raw, time_format=c.get("timeFormat"),
            bin_width=c.get("binWidth", 1.0), compression=c.get("compression"),
            ref_id=c.get("refId"), columns_index=None, processes=c.get("processes", []),
        )
    for col in cols.values():
        col.columns_index = cols
    return raw, cols


def run_session(session):
    """Returns (columns_index, raw_data, errors[])."""
    raw, cols = build_columns(session)
    stored = dict(session.get("storedValues", {}) or {})
    errors = []
    for tp in session.get("tableProcesses", []):
        try:
            rt.run_table_process(tp.get("name"), tp.get("args", {}), cols, raw, stored)
        except Exception as e:  # noqa: BLE001
            errors.append(f"TP {tp.get('name')}: {e}")
    return cols, raw, errors


def iter_sessions():
    for d in SESSION_DIRS:
        if not d.exists():
            continue
        for f in sorted(d.glob("*.json")):
            if f.name == "index.json":
                continue
            yield f.stem, f


# Sessions whose JS output depends on an unseeded RNG (Random's seeded @stdlib
# PRNG isn't ported; noisy SimulatedData uses Math.random) — not parity-checkable.
NONDETERMINISTIC = {"demo-tp-random", "learn-hidden-rhythm"}

# Relaxed relative tolerance for analyses where JS and Python use *different*
# numerical implementations, so bit-equality isn't expected. Each value is the
# investigated residual, not a guess:
#  - movinganalysis / rhythmicityanalysis: after lengthening the demos to 14-day
#    inputs (7+ cycles/window), the periodogram peak PERIOD now matches exactly
#    (the broad-peak argmax flip is gone). The ≤1% residual is a Lomb–Scargle peak
#    POWER normalization difference between the JS and Python implementations.
#  - rectangularwave: LM optimizer converges to the same-quality minimum
#    (RMSE-vs-data 5.52 vs 5.54); ≤2.4% pointwise.
#  - doublelogistic: fit converges to JS's exact minimum (a free-period init bug
#    was fixed); residual is pure LM stopping-point precision (~1e-5 rel).
SESSION_TOLERANCE = {
    "demo-tp-movinganalysis": 0.01,
    "demo-tp-rhythmicityanalysis": 0.02,
    "demo-tp-rectangularwave": 0.05,
    "demo-tp-doublelogistic": 1e-3,
}

# Specific columns whose JS BASELINE is itself degenerate (a JS-engine headless
# limitation, NOT a Python-port bug) — excluded from comparison, reason noted:
#  - filterbyothercol col 58: the FilterByOtherCol process is not applied during
#    headless column reconstruction (the column stays unfiltered) even though
#    getColumnById resolves the reference column. The Python port filters correctly.
#  - widetolong col 196 (time_21): the output time column stores raw epoch ms but
#    is typed 'time', and JS get_data returns all-None (cannot re-parse numeric
#    ms). The Python port emits the correct ms values.
SKIP_COLUMNS = {
    "demo-process-filterbyothercol": {58},
    "demo-tp-widetolong": {196},
}


def check_session(sid, path, js_results, verbose=False):
    if sid in NONDETERMINISTIC:
        return {"status": "skip", "reason": "non-deterministic (unseeded RNG)", "diffs": []}
    js = js_results.get(sid)
    if js is None or not js.get("ok"):
        return {"status": "skip", "reason": "no JS result", "diffs": []}
    session = json.loads(path.read_text())
    try:
        cols, raw, errors = run_session(session)
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "reason": str(e), "diffs": []}

    tol = SESSION_TOLERANCE.get(sid, TOL)
    skip_cols = SKIP_COLUMNS.get(sid, set())
    diffs = []
    matched = 0
    for cid_str, js_col in js["columns"].items():
        cid = int(cid_str)
        if cid in skip_cols:
            continue
        col = cols.get(cid)
        try:
            py_values = col.get_data() if col is not None else None
        except Exception as e:  # noqa: BLE001
            diffs.append((cid, js_col.get("name"), f"python get_data raised: {e}"))
            continue
        ok, reason = compare_column(js_col, py_values, tol)
        if ok:
            matched += 1
        else:
            diffs.append((cid, js_col.get("name"), reason))

    status = "match" if not diffs and not errors else ("mismatch" if not errors else "tp-error")
    return {"status": status, "matched": matched, "total": len(js["columns"]),
            "errors": errors, "diffs": diffs}


def main(argv):
    verbose = "-v" in argv
    js_results = json.loads(JS_RESULTS.read_text())
    rows = []
    for sid, path in iter_sessions():
        rows.append((sid, check_session(sid, path, js_results, verbose)))

    counts = {}
    for sid, r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
        mark = {"match": "✓", "mismatch": "✗", "tp-error": "E", "error": "E", "skip": "-"}[r["status"]]
        detail = ""
        if r["status"] in ("mismatch", "tp-error"):
            detail = f"  ({r.get('matched')}/{r.get('total')} cols match)"
        print(f"  {mark} {sid:34} {r['status']}{detail}")
        for e in r.get("errors", []) or []:
            print(f"        ! {e}")
        for cid, name, reason in r.get("diffs", [])[:4]:
            print(f"        Δ col {cid} ({name}): {reason}")

    print("\nsummary:", ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    return 0 if counts.get("mismatch", 0) == 0 and counts.get("tp-error", 0) == 0 \
        and counts.get("error", 0) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
