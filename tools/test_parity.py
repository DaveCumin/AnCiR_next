#!/usr/bin/env python3
"""
JS↔Python parity tests.

For every fixture in tools/parity/fixtures.json this runs the analysis through
ancir_runtime.py and asserts the result matches the JS engine's output
(tools/parity/js_results.json) within tolerance — the cross-language check that
the Python port has NOT drifted from the JS source of truth.

The JS emitter also writes the (possibly seeded-generated) INPUT data into
js_results.json, so this side analyses the identical numbers.

Workflow:
    GEN_PARITY=1 npx vitest run src/lib/_parity/emitParity.svelte.test.js
    tools/.venv/bin/python -m pytest tools/test_parity.py -q
    # or: tools/.venv/bin/python tools/test_parity.py   (plain PASS/FAIL list)

Add a case by appending to fixtures.json and re-running the emitter.
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import ancir_runtime as rt  # noqa: E402

PARITY_DIR = HERE / "parity"
FIXTURES = json.loads((PARITY_DIR / "fixtures.json").read_text())
TOL = FIXTURES.get("tolerance", 1e-6)


# --- helpers ----------------------------------------------------------------

def _is_nan(v):
    return v is None or (isinstance(v, float) and math.isnan(v))


def nums_match(x, y, tol):
    # A category output (Correlation's var_i / var_j) compares as text.
    if isinstance(x, str) or isinstance(y, str):
        return str(x) == str(y)
    if _is_nan(x) and _is_nan(y):
        return True
    if _is_nan(x) or _is_nan(y):
        return False
    return abs(x - y) <= tol * max(1.0, abs(x), abs(y))


def arrays_match(a, b, tol):
    if a is None or b is None or len(a) != len(b):
        return False, f"length {None if a is None else len(a)} vs {None if b is None else len(b)}"
    for i, (x, y) in enumerate(zip(a, b)):
        if not nums_match(x, y, tol):
            return False, f"index {i}: {x!r} vs {y!r}"
    return True, ""


def resolve_tokens(value, id_map):
    if isinstance(value, str) and value.startswith("@"):
        ref = value[1:]
        if ref not in id_map:
            raise KeyError(f"unknown input ref @{ref}")
        return id_map[ref]
    if isinstance(value, list):
        return [resolve_tokens(v, id_map) for v in value]
    if isinstance(value, dict):
        return {k: resolve_tokens(v, id_map) for k, v in value.items()}
    return value


# --- build runtime columns from the emitter's INPUT data --------------------

def _build_cols(js):
    """js['inputs'] is { ref: { type, values } } (written by the JS emitter)."""
    raw_data, cols, id_map = {}, {}, {}
    next_id = 1
    for ref, spec in js["inputs"].items():
        cid = next_id
        next_id += 1
        id_map[ref] = cid
        raw_data[cid] = list(spec["values"])
        cols[cid] = rt.Column(id=cid, name=ref, type=spec.get("type", "number"),
                              data=cid, raw_data=raw_data)
    return raw_data, cols, id_map, next_id


# --- runners ----------------------------------------------------------------

def run_column_process(fx, js):
    out = rt.run_column_process(fx["pyFunc"], list(js["input"]), fx.get("args", {}), {})
    return {"value": list(out)}


def run_table_process(fx, js):
    raw_data, cols, id_map, next_id = _build_cols(js)
    args = resolve_tokens(fx["args"], id_map)

    # The JS engine auto-allocates outputs; the Python runtime reads ids from
    # args['out']. Register BOTH a static key (e.g. 'cosinorx') and the per-y
    # dynamic key (e.g. 'cosinory_<yid>'); the TP writes whichever it looks up.
    y_ids = args.get("yIN", [])
    if not isinstance(y_ids, list):
        y_ids = [y_ids]
    out_ids = {}
    args.setdefault("out", {})
    for k in fx.get("compareOutputs", []):
        static_id, dyn_id = 1000 + next_id, 2000 + next_id
        next_id += 1
        args["out"][k] = static_id
        for yid in y_ids:
            args["out"][f"{k}_{yid}"] = dyn_id
            # Split names its outputs the other way round, "<yId>_<segment>"
            # (Split.svelte:103), so register that form too or it is untestable.
            args["out"][f"{yid}_{k}"] = dyn_id
        for oid, nm in ((static_id, k), (dyn_id, f"{k}_dyn")):
            cols[oid] = rt.Column(id=oid, name=nm, type="number", data=oid, raw_data=raw_data)
        out_ids[k] = (static_id, dyn_id)

    fn = getattr(rt, f"tp_{fx['pyFunc']}", None)
    if fn is None:
        raise AssertionError(f"no Python tp_{fx['pyFunc']} in ancir_runtime")
    # `storedValues` ({key: value}) arrive in the saved-session entry shape, as the app saves
    # them, so the port's own unwrapping is exercised too.
    stored = {k: {"staticValue": v} for k, v in (fx.get("storedValues") or {}).items()}
    valid = fn(args, cols, raw_data, stored)
    if "valid" in js:
        # A `recordValid` fixture pins the node's validity itself (a refusal, typically).
        assert bool(valid) == js["valid"], \
            f"{fx['id']}: Python tp_{fx['pyFunc']} valid={bool(valid)}, JS valid={js['valid']}"
    else:
        assert valid, f"{fx['id']}: Python tp_{fx['pyFunc']} returned invalid"

    # Compare what the column READS (getData on the JS side), not what it stores: a 'bin'
    # column stores bin starts and reads bin centres.
    outputs = {}
    for k, (static_id, dyn_id) in out_ids.items():
        oid = dyn_id if raw_data.get(dyn_id) else static_id
        outputs[k] = cols[oid].get_data() if raw_data.get(oid) is not None else None
        # A refused node writes nothing; the JS output column then reads back empty.
        # So does a valid node that wrote nothing for this key (e.g. a non-binary outcome).
        if outputs[k] is None and (js.get("valid") is False or js["outputs"].get(k) == []):
            outputs[k] = []
    return outputs


def run_plot_compute(fx, js):
    """Call a plot-compute function (compute_fft / compute_autocorrelation) with
    the SAME seeded inputs the JS emitter used, and return the arrays to compare.
    Inputs come straight from js['inputs'] — no Column build needed."""
    fn = getattr(rt, fx["pyFunc"], None)
    if fn is None:
        raise AssertionError(f"no Python {fx['pyFunc']} in ancir_runtime")
    t = js["inputs"][fx["xRef"]]["values"]
    y = js["inputs"][fx["yRef"]]["values"]
    res = fn(t, y, *fx.get("extraArgs", []))
    return {k: res.get(k) for k in fx.get("compareArrays", [])}


def run_actogram_download(fx, js):
    """The actogram's plot-data rows through the Python EXPORT path: real Columns built from
    the arrays the JS emitter recorded, a plot dict shaped like the saved session's, and
    the same builder `export_plot_data` calls, in the recorded display zone."""
    fn = getattr(rt, fx["pyFunc"], None)
    if fn is None:
        raise AssertionError(f"no Python {fx['pyFunc']} in ancir_runtime")
    inp = js["inputs"]
    raw_data, cols, data = {}, {}, []

    def new_col(name, values, ctype, bin_width=None, origin_time_ms=None):
        cid = len(cols) + 1
        raw_data[cid] = None if values is None else list(values)
        col = rt.Column(id=cid, name=name, type=ctype, data=cid, raw_data=raw_data,
                        bin_width=bin_width)
        # An imported bin column's origin, as the session JSON carries it.
        col.origin_time_ms = origin_time_ms
        cols[cid] = col
        return cid

    for i, s in enumerate(inp["series"]):
        x_id = new_col(f"x{i}", s["x"], s["xType"], s.get("binWidth"), s.get("originTime_ms"))
        y_id = new_col(f"y{i}", s["y"], "number")
        binned = inp.get("binned")
        if binned:
            # The actogram plots a BinnedData node's outputs: run the port's own node, so
            # the columns carry whatever metadata IT writes.
            bx, by = new_col(f"bx{i}", None, "number"), new_col(f"by{i}", None, "number")
            args = {**binned, "xIN": x_id, "yIN": [y_id],
                    "out": {"binnedx": bx, f"binnedy_{y_id}": by}}
            assert rt.tp_binneddata(args, cols, raw_data, {}), f"{fx['id']}: BinnedData failed"
            x_id, y_id = bx, by
        data.append({"x": {"refId": x_id}, "y": {"refId": y_id}})
    plot = {"type": "actogram", "plot": {"periodHrs": inp["periodHrs"], "data": data}}
    headers, rows = fn(plot, cols, zone=inp.get("zone", "utc"))
    return {"headers": headers, "rows": rows}


def run_correlogram_download(fx, js):
    """The correlogram's plot-data rows through the Python EXPORT path: real Columns built
    from the arrays the JS emitter recorded (a bin column with its binWidth), optionally run
    through the port's own BinnedData node, a plot dict shaped like the saved session's
    (maxLag / minLag on each series), and the builder `export_plot_data` calls."""
    fn = getattr(rt, fx["pyFunc"], None)
    if fn is None:
        raise AssertionError(f"no Python {fx['pyFunc']} in ancir_runtime")
    inp = js["inputs"]
    raw_data, cols, data = {}, {}, []

    def new_col(name, values, ctype, bin_width=None, origin_time_ms=None):
        cid = len(cols) + 1
        raw_data[cid] = None if values is None else list(values)
        col = rt.Column(id=cid, name=name, type=ctype, data=cid, raw_data=raw_data,
                        bin_width=bin_width)
        col.origin_time_ms = origin_time_ms
        cols[cid] = col
        return cid

    for i, s in enumerate(inp["series"]):
        x_id = new_col(f"x{i}", s["x"], s["xType"], s.get("binWidth"), s.get("originTime_ms"))
        y_id = new_col(f"y{i}", s["y"], "number")
        binned = inp.get("binned")
        if binned:
            bx, by = new_col(f"bx{i}", None, "number"), new_col(f"by{i}", None, "number")
            args = {**binned, "xIN": x_id, "yIN": [y_id],
                    "out": {"binnedx": bx, f"binnedy_{y_id}": by}}
            assert rt.tp_binneddata(args, cols, raw_data, {}), f"{fx['id']}: BinnedData failed"
            x_id, y_id = bx, by
        data.append({"x": {"refId": x_id}, "y": {"refId": y_id},
                     "maxLag": s.get("maxLag"), "minLag": s.get("minLag", 0)})
    headers, rows = fn({"type": "correlogram", "plot": {"data": data}}, cols)
    return {"headers": headers, "rows": rows}


def run_pure_util(fx, js):
    """Call a pure numeric util (dispatched by name via getattr) with the SAME
    input arrays the JS emitter used, plus any extra positional pyArgs. Returns
    the raw result (dict of arrays, list of dicts, or dict of scalars)."""
    fn = getattr(rt, fx["pyFunc"], None)
    if fn is None:
        raise AssertionError(f"no Python {fx['pyFunc']} in ancir_runtime")
    arg_refs = fx.get("argRefs") or [fx.get("valuesRef")]
    pos = [js["inputs"][r]["values"] for r in arg_refs]
    return fn(*pos, *fx.get("pyArgs", []))


def run_time_column(fx, js):
    """Build one time column exactly as the JS emitter did and read it back.

    No analysis in between: this checks the parser and the hours-since-start
    baseline on their own. It matters because the three languages do not share an
    approach here — JS parses strictly against the stored `timeFormat`, Python
    ignores that format (a Luxon format string is not valid Python) and lets
    pandas auto-detect, and R tries a short list of formats. Agreement between
    three different parsers is an assumption until something checks it.
    """
    spec = js["column"]
    raw_data = {}
    # AWD columns store {start, step, length}; the expansion is under test, so the
    # raw payload goes in untouched rather than being pre-expanded here.
    raw_data[1] = spec["awd"] if spec.get("awd") is not None else list(spec["values"])
    col = rt.Column(id=1, name=fx["id"], type=spec.get("type", "time"), data=1,
                    raw_data=raw_data, time_format=spec.get("timeFormat"),
                    compression=spec.get("compression"))
    out = {}
    for k in fx.get("compareArrays", []):
        out[k] = list(col.hours_since_start if k == "hoursSinceStart" else col.get_data())
    return out


def run_actogram_markers(fx, js):
    """Rebuild the fixture's actogram from the plain arrays the JS emitter recorded and
    compute every rule on every series, with all intermediates."""
    fn = getattr(rt, fx["pyFunc"], None)
    if fn is None:
        raise AssertionError(f"no Python {fx['pyFunc']} in ancir_runtime")
    inp = js["inputs"]
    return fn(inp["inner"], inp["series"], inp.get("zone", "utc"))


def run_session_migration(fx, js):
    """The legacy Enright bin-size migration through the Python port: the same session JSON
    (series as saved, under the recorded version), migrate_legacy_enright_bins, then per
    series the bin size it computes with (periodogram_series_bin_size over its whole x) and
    the peak period over periodlimsIN, on the arrays the JS emitter recorded."""
    inp = js["inputs"]
    session = {"version": inp["version"], "plots": [{
        "type": "periodogram",
        "plot": {"data": [dict(s["saved"]) for s in inp["series"]]}}]}
    migrated_session, migrated = rt.migrate_legacy_enright_bins(session)
    lo, hi = inp["periodlimsIN"]
    out = []
    for saved, s in zip(migrated_session["plots"][0]["plot"]["data"], inp["series"]):
        dt = rt.periodogram_series_bin_size(saved, s["x"])
        res = rt.run_periodogram_calculation({
            "t": s["x"], "y": s["y"], "method": saved.get("method") or "Lomb-Scargle",
            "minPeriod": lo, "maxPeriod": hi, "stepSize": inp["periodSteps"], "dt": dt})
        ys = res["y"]
        out.append({"binSizeAuto": saved.get("binSizeAuto") is True, "binSize": dt,
                    "peakPeriod": res["x"][ys.index(max(ys))]})
    return {"migrated": migrated, "series": out}


def _deep_diff(py, want, tol, path="$"):
    """First difference between a port's nested result and the JS record, or None. Every
    key the JS recorded must be present and equal (numbers within tol, NaN == null)."""
    if isinstance(want, dict):
        if not isinstance(py, dict):
            return f"{path}: expected an object, got {py!r}"
        for k, w in want.items():
            d = _deep_diff(py.get(k), w, tol, f"{path}.{k}")
            if d:
                return d
        return None
    if isinstance(want, list):
        if not isinstance(py, list) or len(py) != len(want):
            return f"{path}: length {None if not isinstance(py, list) else len(py)} vs {len(want)}"
        for i, (p, w) in enumerate(zip(py, want)):
            d = _deep_diff(p, w, tol, f"{path}[{i}]")
            if d:
                return d
        return None
    if isinstance(want, (bool, str)) or isinstance(py, (bool, str)):
        return None if py == want else f"{path}: {py!r} vs {want!r}"
    if isinstance(py, dict):
        return f"{path}: got an object, expected {want!r}"
    return None if nums_match(py, want, tol) else f"{path}: {py!r} vs {want!r}"


def run_table_process_result(fx, js):
    raw_data, cols, id_map, _ = _build_cols(js)
    args = resolve_tokens(fx["args"], id_map)
    result, valid = rt.compute_group_comparison(args, cols)
    # `allowInvalid` fixtures pin a refusal (a non-computable statistic); they compare the
    # comparison's own `valid` field instead.
    if not fx.get("allowInvalid"):
        assert valid, f"{fx['id']}: compute_group_comparison returned invalid"
    comps = result["comparisons"]
    key = next((k for k in comps if k != "multiY"), next(iter(comps)))
    comp = comps[key]
    return {f: comp.get(f) for f in fx.get("compareFields", [])}


# --- the parity check -------------------------------------------------------

def _check_fixture(fx, js_results):
    js = js_results.get(fx["id"])
    assert js is not None, f"{fx['id']}: missing from js_results.json (re-run the emitter)"
    tol = fx.get("tolerance", TOL)

    if fx["kind"] == "columnProcess":
        py = run_column_process(fx, js)
        ok, why = arrays_match(py["value"], js["outputs"]["value"], tol)
        assert ok, f"{fx['id']} output 'value' differs: {why}"

    elif fx["kind"] == "plotCompute" and fx.get("jsFn") == "actogramDownloadData":
        py = run_actogram_download(fx, js)
        diff = _deep_diff(py, js["outputs"], tol)
        assert diff is None, f"{fx['id']} differs at {diff}"

    elif fx["kind"] == "plotCompute" and fx.get("jsFn") == "correlogramDownloadData":
        py = run_correlogram_download(fx, js)
        diff = _deep_diff(py, js["outputs"], tol)
        assert diff is None, f"{fx['id']} differs at {diff}"

    elif fx["kind"] == "plotCompute":
        py = run_plot_compute(fx, js)
        for key in fx.get("compareArrays", []):
            ok, why = arrays_match(py.get(key), js["outputs"].get(key), tol)
            assert ok, f"{fx['id']} array '{key}' differs: {why}"

    elif fx["kind"] == "timeColumn":
        py = run_time_column(fx, js)
        for key in fx.get("compareArrays", []):
            ok, why = arrays_match(py.get(key), js["outputs"].get(key), tol)
            assert ok, f"{fx['id']} array '{key}' differs: {why}"

    elif fx["kind"] == "pureUtil":
        res = run_pure_util(fx, js)
        if "compareArrays" in fx:
            for key in fx["compareArrays"]:
                ok, why = arrays_match(res.get(key), js["outputs"].get(key), tol)
                assert ok, f"{fx['id']} array '{key}' differs: {why}"
        elif "compareFields" in fx:
            for f in fx["compareFields"]:
                py_arr = [row.get(f) if isinstance(row, dict) else None for row in res]
                js_arr = js["outputs"].get(f)
                assert js_arr is not None and len(py_arr) == len(js_arr), (
                    f"{fx['id']} field '{f}' length {len(py_arr)} vs "
                    f"{None if js_arr is None else len(js_arr)}")
                for i, (pv, jv) in enumerate(zip(py_arr, js_arr)):
                    if isinstance(jv, str) or isinstance(pv, str):
                        assert pv == jv, f"{fx['id']} field '{f}' index {i}: {pv!r} vs {jv!r}"
                    else:
                        assert nums_match(pv, jv, tol), \
                            f"{fx['id']} field '{f}' index {i}: {pv!r} vs {jv!r}"
        elif "compareScalars" in fx:
            for key in fx["compareScalars"]:
                pv, jv = res.get(key), js["outputs"].get(key)
                if isinstance(jv, str) or isinstance(pv, str):
                    assert pv == jv, f"{fx['id']} scalar '{key}' differs: {pv!r} vs {jv!r}"
                else:
                    assert nums_match(pv, jv, tol), \
                        f"{fx['id']} scalar '{key}' differs: {pv!r} vs {jv!r}"

    elif fx["kind"] == "sessionMigration":
        py = run_session_migration(fx, js)
        diff = _deep_diff(py, js["outputs"], tol)
        assert diff is None, f"{fx['id']} differs at {diff}"

    elif fx["kind"] == "actogramMarkers":
        py = run_actogram_markers(fx, js)
        diff = _deep_diff(py, js["outputs"], tol)
        assert diff is None, f"{fx['id']} differs at {diff}"

    elif fx["kind"] == "tableProcessResult":
        py = run_table_process_result(fx, js)
        js_res = js["result"]
        for f in fx.get("compareFields", []):
            pv, jv = py.get(f), js_res.get(f)
            if isinstance(jv, str) or isinstance(pv, str):
                assert pv == jv, f"{fx['id']} field '{f}' differs: {pv!r} vs {jv!r}"
            else:
                assert nums_match(pv, jv, tol), f"{fx['id']} field '{f}' differs: {pv!r} vs {jv!r}"

    else:  # tableProcess (column outputs)
        py = run_table_process(fx, js)
        # A hostile-payload fixture names the file its payload would create if the port
        # executed it (SEC-2). Its absence after the run is the proof that nothing ran.
        if fx.get("mustNotCreate"):
            assert not Path(fx["mustNotCreate"]).exists(), \
                f"{fx['id']}: the payload RAN (it created {fx['mustNotCreate']})"
        for key in fx.get("compareOutputs", list(js["outputs"].keys())):
            ok, why = arrays_match(py.get(key), js["outputs"].get(key), tol)
            assert ok, f"{fx['id']} output '{key}' differs: {why}"


# pytest entry point (one test per fixture) ----------------------------------
try:
    import pytest

    @pytest.mark.parametrize("fx", FIXTURES["fixtures"], ids=lambda f: f["id"])
    def test_parity(fx):
        js_results = json.loads((PARITY_DIR / "js_results.json").read_text())
        _check_fixture(fx, js_results)
except ImportError:  # pragma: no cover
    pass


def _run_all():
    js_results = json.loads((PARITY_DIR / "js_results.json").read_text())
    failed = 0
    for fx in FIXTURES["fixtures"]:
        try:
            _check_fixture(fx, js_results)
            print(f"PASS {fx['id']}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {e}")
    total = len(FIXTURES["fixtures"])
    print(f"\n{total - failed}/{total} fixtures match JS")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
