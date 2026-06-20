#!/usr/bin/env python3
"""
Deterministic unit tests for the newly ported table processes and the
process-safety behaviour in ancir_runtime.py.

Run directly:
    python3 tools/test_table_processes.py
or with pytest:
    python3 -m pytest tools/test_table_processes.py -q

Expected values are derived from the JS algorithm (cited per test), not from
the Python implementation itself, so the tests are independent verification.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ancir_runtime as rt  # noqa: E402


def _col(cid, name, values, type_='number'):
    """Build a runtime Column backed by an in-memory raw_data dict."""
    raw = {cid: list(values)}
    return rt.Column(id=cid, name=name, type=type_, data=cid, raw_data=raw)


def approx(a, b, tol=1e-9):
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


# ----------------------------------------------------------------------
# StoredValueGroup
# ----------------------------------------------------------------------

def test_storedvaluegroup_buckets_and_outputs():
    # JS storedvaluegroup (StoredValueGroup.svelte:16-69): finite stored values
    # for each group's keys are collected into that group's output column.
    stored = {'a': 1.0, 'b': 2.0, 'c': float('nan'), 'd': 5.0}
    out1 = rt.Column(id=100, name='g1', type='number', data=100, raw_data={})
    out2 = rt.Column(id=101, name='g2', type='number', data=101, raw_data={})
    cols = {100: out1, 101: out2}
    raw_data = {}
    args = {
        'groups': [
            {'id': 'G1', 'name': 'First', 'keys': ['a', 'b', 'c']},   # c is NaN -> dropped
            {'id': 'G2', 'name': 'Second', 'keys': ['d', 'missing']},  # missing key -> skipped
        ],
        'out': {'group_G1': 100, 'group_G2': 101},
    }
    valid = rt.tp_storedvaluegroup(args, cols, raw_data, stored)
    assert valid is True
    assert raw_data[100] == [1.0, 2.0]
    assert raw_data[101] == [5.0]


def test_storedvaluegroup_empty_when_no_finite():
    stored = {'x': float('nan')}
    out = rt.Column(id=200, name='g', type='number', data=200, raw_data={})
    cols = {200: out}
    raw_data = {}
    args = {'groups': [{'id': 'G', 'name': 'G', 'keys': ['x', 'nope']}],
            'out': {'group_G': 200}}
    valid = rt.tp_storedvaluegroup(args, cols, raw_data, stored)
    assert valid is False
    # has_any_out is true (id 200 >= 0) so an empty list is written
    assert raw_data.get(200) == []


# ----------------------------------------------------------------------
# GroupComparison
# ----------------------------------------------------------------------

def test_groupcomparison_welch_ttest():
    # Two groups via a category X column and a numeric Y column.
    # A = [1,2,3,4], B = [2,3,4,5]; mode 'ttest' -> Welch t-test.
    # Hand-derived from welchTTest (GroupComparison.svelte:249-294):
    #   mean A = 2.5, mean B = 3.5, diff = -1.0
    #   var A = var B = 5/3 (sample variance, /(n-1))
    #   a = b = (5/3)/4 = 0.4166666..., se = sqrt(0.8333...) = 0.9128709...
    #   t = diff/se = -1.0954451...
    #   df: num=(a+b)^2=0.6944..., den=2*(a^2/3)=0.11574..., df=6
    x = _col(1, 'grp', ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B'], type_='category')
    y = _col(2, 'val', [1, 2, 3, 4, 2, 3, 4, 5])
    cols = {1: x, 2: y}
    args = {'xIN': 1, 'yIN': [2], 'method': 'ttest', 'alpha': 0.05}
    result, valid = rt.compute_group_comparison(args, cols)
    assert valid is True
    comp = result['comparisons'][2]
    assert comp['test'] == 'Welch t-test'
    assert approx(comp['difference'], -1.0)
    expected_var = 5.0 / 3.0
    a = expected_var / 4.0
    expected_se = math.sqrt(a + a)
    expected_t = -1.0 / expected_se
    assert approx(comp['t'], expected_t, tol=1e-12)
    assert approx(comp['df'], 6.0, tol=1e-12)
    # p two-sided from F(t^2,1,df): compare against scipy directly
    import scipy.stats as ss
    expected_p = 1 - ss.f.cdf(expected_t ** 2, 1, 6.0)
    assert approx(comp['pValue'], expected_p, tol=1e-12)


def test_groupcomparison_anova_three_groups():
    # 3 groups -> auto resolves to one-way ANOVA (resolveMethod :482-488).
    # Groups: A=[1,2,3] B=[4,5,6] C=[7,8,9]; each n=3, means 2,5,8; grand=5.
    # ssBetween = 3*((2-5)^2+(5-5)^2+(8-5)^2)=3*18=54
    # ssWithin = 3 groups * ((-1)^2+0+1^2)=3*2=6
    # dfBetween=2, dfWithin=6, msBetween=27, msWithin=1, F=27
    x = _col(1, 'grp', ['A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'C'],
             type_='category')
    y = _col(2, 'val', [1, 2, 3, 4, 5, 6, 7, 8, 9])
    cols = {1: x, 2: y}
    args = {'xIN': 1, 'yIN': [2], 'method': 'auto'}
    result, valid = rt.compute_group_comparison(args, cols)
    assert valid is True
    comp = result['comparisons'][2]
    assert comp['test'] == 'One-way ANOVA'
    assert approx(comp['ssBetween'], 54.0)
    assert approx(comp['ssWithin'], 6.0)
    assert comp['dfBetween'] == 2 and comp['dfWithin'] == 6
    assert approx(comp['f'], 27.0)
    assert approx(comp['etaSquared'], 54.0 / 60.0)


def test_groupcomparison_mannwhitney_no_ties():
    # mode 'mannwhitney', A=[1,2,3], B=[4,5,6]; ranks 1..6, no ties.
    # rankSumA=1+2+3=6, U1=6-(3*4/2)=0, U2=9-0=9, U=min=0 (mannWhitney :367-405)
    x = _col(1, 'grp', ['A', 'A', 'A', 'B', 'B', 'B'], type_='category')
    y = _col(2, 'val', [1, 2, 3, 4, 5, 6])
    cols = {1: x, 2: y}
    args = {'xIN': 1, 'yIN': [2], 'method': 'mannwhitney'}
    result, valid = rt.compute_group_comparison(args, cols)
    assert valid is True
    comp = result['comparisons'][2]
    assert comp['test'] == 'Mann-Whitney U'
    assert approx(comp['u'], 0.0)


# ----------------------------------------------------------------------
# FitFunction
# ----------------------------------------------------------------------

def test_fitfunction_cosinor_fixed_recovers_perfect_cosine():
    # FitFunction model='cosinor', useFixedPeriod, on a perfect single-harmonic
    # cosine sampled at >= 2*nHarmonics+2 points. A fixed-period cosinor is an
    # ordinary linear least-squares fit, so the fitted values must equal y
    # (up to numerical precision). y = 10 + 3*cos(omega*t) + 2*sin(omega*t).
    period = 24.0
    omega = 2 * math.pi / period
    t = [0.0, 3.0, 6.0, 9.0, 12.0, 15.0, 18.0, 21.0]
    y = [10 + 3 * math.cos(omega * ti) + 2 * math.sin(omega * ti) for ti in t]
    xcol = _col(1, 't', t)
    ycol = _col(2, 'y', y)
    out_x = rt.Column(id=10, name='fitx', type='number', data=10, raw_data={})
    out_y = rt.Column(id=11, name='fity', type='number', data=11, raw_data={})
    cols = {1: xcol, 2: ycol, 10: out_x, 11: out_y}
    raw_data = {}
    args = {
        'xIN': 1, 'yIN': [2], 'model': 'cosinor',
        'useFixedPeriod': True, 'fixedPeriod': period, 'nHarmonics': 1,
        'alpha': 0.05,
        'out': {'fitx': 10, 'fity_2': 11},
    }
    valid = rt.tp_fitfunction(args, cols, raw_data, {})
    assert valid is True
    fitted = raw_data[11]
    assert len(fitted) == len(y)
    for f, yy in zip(fitted, y):
        assert approx(f, yy, tol=1e-8), (f, yy)
    # X output equals the input t (no separate outputX column)
    assert raw_data[10] == t


def test_fitfunction_invalid_when_no_y():
    cols = {1: _col(1, 't', [0, 1, 2])}
    valid = rt.tp_fitfunction({'xIN': 1, 'yIN': [], 'model': 'cosinor'},
                              cols, {}, {})
    assert valid is False


# ----------------------------------------------------------------------
# Safety: unsupported processes must fail loudly
# ----------------------------------------------------------------------

def test_unknown_table_process_raises_in_strict_mode():
    assert rt.STRICT_PROCESSES is True
    raised = False
    try:
        rt.run_table_process('NoSuchProcess', {}, {}, {}, {})
    except rt.UnsupportedProcessError:
        raised = True
    assert raised, "unknown table process should raise in strict mode"


def test_unknown_column_process_raises_in_strict_mode():
    raised = False
    try:
        rt.run_column_process('nosuchcolproc', [1, 2, 3], {}, {})
    except rt.UnsupportedProcessError:
        raised = True
    assert raised, "unknown column process should raise in strict mode"


def test_non_strict_mode_records_instead_of_raising():
    prev = rt.STRICT_PROCESSES
    rt.STRICT_PROCESSES = False
    rt.UNSUPPORTED_PROCESSES.clear()
    try:
        out = rt.run_column_process('nosuchcolproc', [1, 2, 3], {}, {})
        assert out == [1, 2, 3]          # passthrough
        ok = rt.run_table_process('NoSuchProcess', {}, {}, {}, {})
        assert ok is False
        assert ('column', 'nosuchcolproc') in rt.UNSUPPORTED_PROCESSES
        assert ('table', 'NoSuchProcess') in rt.UNSUPPORTED_PROCESSES
    finally:
        rt.STRICT_PROCESSES = prev
        rt.UNSUPPORTED_PROCESSES.clear()


def test_known_table_process_resolves_via_displayname():
    # 'Compare groups (stats)' is the GroupComparison displayName.
    assert rt.DISPLAY_TO_TP.get('Compare groups (stats)') == 'groupcomparison'
    assert rt.DISPLAY_TO_TP.get('Fit Function') == 'fitfunction'
    assert rt.DISPLAY_TO_TP.get('Stored Value Group') == 'storedvaluegroup'


# ----------------------------------------------------------------------
# Coverage self-check
# ----------------------------------------------------------------------

def test_coverage_check_passes():
    import check_tp_coverage as cov
    js = cov.scan_js()
    impl = cov.runtime_keys()
    missing = [k for k in {cov.tp_key(f) for f in js} if k not in impl]
    assert not missing, f"missing TP implementations: {missing}"


def _run_all():
    tests = [v for k, v in sorted(globals().items())
             if k.startswith('test_') and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"FAIL {t.__name__}: {e!r}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
