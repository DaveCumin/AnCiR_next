#!/usr/bin/env python3
"""
Review STAT-U6 (2026-10-03): GroupComparison's Holm step in the Python port (and, through
Rscript when it is installed, the R port) leaves a non-finite pair p out of the family, as R
p.adjust does for NA. Reference: R 4.5.2, p.adjust(c(0.01, NA, 0.04, 0.03), "holm") =
0.03, NA, 0.06, 0.06. The app's side is src/lib/tableProcesses/GroupComparison.holm.test.js
(no node input reaches a non-finite pair p, so there is no parity fixture).

    tools/.venv/bin/python -m pytest tools/test_holm_nonfinite.py -q
"""

from __future__ import annotations

import math
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import ancir_runtime as rt  # noqa: E402

R_REFERENCE = [0.03, None, 0.06, 0.06]


def test_python_holm_leaves_nan_out_of_n():
    pairs = [{'groupA': f'g{i}', 'pValue': p} for i, p in enumerate([0.01, math.nan, 0.04, 0.03])]
    out = rt._gc_holm_adjust(pairs)
    assert [p['groupA'] for p in out] == ['g0', 'g1', 'g2', 'g3']
    for got, want in zip((p['pAdjusted'] for p in out), R_REFERENCE):
        if want is None:
            assert math.isnan(got)
        else:
            assert got == pytest.approx(want, abs=1e-15)


@pytest.mark.skipif(shutil.which('Rscript') is None, reason='Rscript not installed')
def test_r_holm_leaves_na_out_of_n():
    code = (
        f'source("{HERE / "ancir_runtime.R"}"); '
        'pairs <- lapply(c(0.01, NaN, 0.04, 0.03), function(p) list(pValue = p)); '
        'cat(vapply(gc_holm_adjust(pairs), function(p) format(p$pAdjusted, digits = 17), ""))'
    )
    out = subprocess.run(['Rscript', '-e', code], capture_output=True, text=True, check=True)
    vals = out.stdout.split()
    assert len(vals) == 4
    for got, want in zip(vals, R_REFERENCE):
        if want is None:
            assert got == 'NA'
        else:
            assert float(got) == pytest.approx(want, abs=1e-15)
