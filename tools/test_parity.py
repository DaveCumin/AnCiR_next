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
        for oid, nm in ((static_id, k), (dyn_id, f"{k}_dyn")):
            cols[oid] = rt.Column(id=oid, name=nm, type="number", data=oid, raw_data=raw_data)
        out_ids[k] = (static_id, dyn_id)

    fn = getattr(rt, f"tp_{fx['pyFunc']}", None)
    if fn is None:
        raise AssertionError(f"no Python tp_{fx['pyFunc']} in ancir_runtime")
    valid = fn(args, cols, raw_data, {})
    assert valid, f"{fx['id']}: Python tp_{fx['pyFunc']} returned invalid"

    outputs = {}
    for k, (static_id, dyn_id) in out_ids.items():
        dyn = raw_data.get(dyn_id)
        outputs[k] = dyn if dyn else raw_data.get(static_id)
    return outputs


def run_table_process_result(fx, js):
    raw_data, cols, id_map, _ = _build_cols(js)
    args = resolve_tokens(fx["args"], id_map)
    result, valid = rt.compute_group_comparison(args, cols)
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
