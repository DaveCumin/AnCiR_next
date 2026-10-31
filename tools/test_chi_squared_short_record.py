#!/usr/bin/env python3
"""
The chi-squared periodogram's short-record warning (decision 2026-11-01), Python side: the
same text as the app's utils/chiSquaredShortRecord.js (whose tests pin the wording), printed
by Rhythmicity Analysis, Moving Analysis and the exported Periodogram plot.

    tools/.venv/bin/python -m pytest tools/test_chi_squared_short_record.py -q
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ancir_runtime as rt  # noqa: E402

THREE_DAYS_30 = ('With only 3 days of data (2.4 cycles of the longest period tested, 30 h), the '
                 'chi-squared test is very conservative and can miss a rhythm that is there; '
                 'consider Lomb-Scargle or a longer record (at least 7 cycles).')


def test_text_matches_the_app():
    assert rt.chi_squared_record_length(list(range(72))) == 72
    assert rt.chi_squared_short_record_warning(72, 30) == THREE_DAYS_30
    assert rt.chi_squared_short_record_warning(7 * 28, 28) == ''
    assert rt.chi_squared_short_record_warning(7 * 28 - 1, 28) != ''
    assert rt.chi_squared_short_record_warning(50, 10, hours=False) == (
        'With only 5 cycles of the longest period tested, 10, the chi-squared test is very '
        'conservative and can miss a rhythm that is there; consider Lomb-Scargle or a longer '
        'record (at least 7 cycles).')
    assert rt.chi_squared_short_record_warning(72, 28, per_window=True) == (
        'With each window holding only 3 days of data (2.6 cycles of the longest period '
        'tested, 28 h), the chi-squared test is very conservative and can miss a rhythm that '
        'is there; consider Lomb-Scargle or a longer window (at least 7 cycles).')
    assert rt.chi_squared_short_record_warning(24, 24).startswith(
        'With only 1 day of data (1 cycle of')
    assert rt.chi_squared_short_record_warning(math.nan, 30) == ''


def _cols(days):
    t = list(range(24 * days))
    raw = {1: t, 2: [10 + 3 * math.cos(2 * math.pi * h / 24) + math.sin(h * 1.3) for h in t]}
    return {1: rt.Column(id=1, name='t', type='number', data=1, raw_data=raw),
            2: rt.Column(id=2, name='y', type='number', data=2, raw_data=raw)}, raw


def test_nodes_and_plot_print_it(capsys):
    cols, raw = _cols(3)
    args = {'xIN': 1, 'yIN': [2], 'analysis': 'periodogram', 'pgMethod': 'Chi-squared',
            'periodMin': 20, 'periodMax': 28, 'periodStep': 1, 'pgBinSize': 1, 'out': {}}
    rt.tp_rhythmicityanalysis(dict(args), cols, raw, {})
    err = capsys.readouterr().err
    assert ('WARNING: Rhythmicity Analysis: With only 2.6 cycles of the longest period tested, '
            '28, the chi-squared test') in err
    cols, raw = _cols(10)
    rt.tp_movinganalysis({**args, 'windowSize': 72, 'stepSize': 24, 'binLabel': 'start',
                          'out': {}}, cols, raw, {})
    err = capsys.readouterr().err
    assert err.count('WARNING: Moving Analysis: With each window holding only 2.6 cycles') == 1
    rt.tp_rhythmicityanalysis({**args, 'pgMethod': 'Lomb-Scargle'}, cols, raw, {})
    assert 'chi-squared test is very conservative' not in capsys.readouterr().err
    cols, raw = _cols(3)
    plot = {'name': 'P', 'type': 'periodogram',
            'plot': {'data': [{'x': {'refId': 1}, 'y': {'refId': 2}, 'method': 'Chi-squared',
                               'binSize': 1}]}}
    fig, ax = plt.subplots()
    try:
        rt.plot_periodogram(plot, cols, ax)
    finally:
        plt.close(fig)
    assert 'WARNING: Periodogram "P": With only 2.4 cycles of the longest period tested, 30,' in \
        capsys.readouterr().err
