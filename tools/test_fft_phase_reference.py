#!/usr/bin/env python3
"""
SPEC-U4 (2026-10-03 review): the FFT phase of the Python port checked against numpy directly
(the parity fixtures only compare it with the app). Mirrors src/lib/utils/fft.phase.test.js:
compute_fft's phases are angle(numpy.fft.fft(y - mean(y)))[k] at even and odd lengths, a
cosine A cos(2 pi t / 24 + phi) reads phi at its bin and from fft_peak, and the origin is the
first sample.

    tools/.venv/bin/python -m pytest tools/test_fft_phase_reference.py -q
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ancir_runtime as rt  # noqa: E402


def _wrap(a):
    return math.atan2(math.sin(a), math.cos(a))


@pytest.mark.parametrize('n', [72, 71, 240])
def test_phases_equal_numpy_fft(n):
    y = np.round(np.random.default_rng(7).normal(size=n), 4)
    r = rt.compute_fft(list(range(n)), y.tolist())
    X = np.fft.fft(y - y.mean())
    for i, ph in enumerate(r['phases']):
        k = i + 1
        assert r['frequencies'][i] == pytest.approx(k / n, abs=1e-12)
        assert ph == pytest.approx(float(np.angle(X[k])), abs=1e-10)
        assert r['magnitudes'][i] == pytest.approx(2 * abs(X[k]) / n, abs=1e-12)


def test_known_cosine_phase_on_and_off_bin():
    t = list(range(240))
    phi = 0.7
    r = rt.compute_fft(t, [2 * math.cos(2 * math.pi * x / 24 + phi) + 5 for x in t])
    k = next(i for i, f in enumerate(r['frequencies']) if abs(1 / f - 24) < 1e-9)
    assert r['phases'][k] == pytest.approx(phi, abs=1e-10)
    pk = rt.fft_peak(r)
    assert pk['phase'] == pytest.approx(phi, abs=1e-6)
    phi = -2.1
    pk = rt.fft_peak(rt.compute_fft(t, [math.cos(2 * math.pi * x / 25.3 + phi) for x in t]))
    assert pk['period'] == pytest.approx(25.3, abs=1e-3)
    assert _wrap(pk['phase'] - phi) == pytest.approx(0, abs=1e-3)


def test_phase_origin_is_first_sample():
    t = [100 + i for i in range(240)]
    phi = 0.4
    r = rt.compute_fft(t, [math.cos(2 * math.pi * x / 24 + phi) for x in t])
    k = next(i for i, f in enumerate(r['frequencies']) if abs(1 / f - 24) < 1e-9)
    assert _wrap(r['phases'][k] - (phi + 2 * math.pi * 100 / 24)) == pytest.approx(0, abs=1e-10)
