#!/usr/bin/env python3
"""
Review STAT-U5 (2026-10-03): the Python port's Sort permutation called directly, as a guard
for the path the parity fixtures cannot reach (a session load already reads a blank cell of a
number column as None, so `tp-sort-mixed-blank-*` never hands the comparator a '' itself).
Mirrors src/lib/utils/sortRows.test.js: blank and whitespace-only strings are missing (last,
in input order), numbers and numeric text before text, and the order is total.

    tools/.venv/bin/python -m pytest tools/test_sort_mixed.py -q
"""

from __future__ import annotations

import itertools
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ancir_runtime as rt  # noqa: E402

KEY = [10, '', 2, 'b', '1a', None, '9', 'a', 0, ' ']


def test_mixed_and_blank_ascending_and_descending():
    assert rt._sort_permutation(KEY, 'asc') == [8, 2, 6, 0, 4, 7, 3, 1, 5, 9]
    assert rt._sort_permutation(KEY, 'desc') == [3, 7, 4, 0, 6, 2, 8, 1, 5, 9]


def test_blank_is_not_zero():
    assert rt._sort_permutation([1, '', -1, 0]) == [2, 3, 0, 1]


def test_total_order_on_a_mixed_cycle():
    vals = [2, 10, '1a']
    for perm in itertools.permutations(range(3)):
        keys = [vals[i] for i in perm]
        assert [keys[i] for i in rt._sort_permutation(keys)] == [2, 10, '1a']
