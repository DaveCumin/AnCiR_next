#!/usr/bin/env python3
"""
The port prints what the app SAYS about time zones (plan
ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, section 5f): the daylight-saving
warnings of a clock phase (Cosinor, Moving Analysis, ...), Bin Data's and the actogram's DST
notes, Join Data's zone summary and warning, and a zoned column's skipped / out-of-order hour
warnings, each as a console warning on stderr (`WARNING: <node>: <text>`), as the Sequence
Column limit is printed. The texts themselves are pinned against the app by the `clockZone`
parity fixtures (test_parity.py); this checks they are printed, once, and only when the app
would show them.

    tools/.venv/bin/python -m pytest tools/test_zone_warnings.py -q
"""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from test_session_parity import run_session  # noqa: E402
import ancir_runtime as rt  # noqa: E402

SESSION = json.loads((Path(__file__).resolve().parent / "parity" / "sessions"
                      / "parity-zoned-time.json").read_text())


def _err_lines(capsys):
    return [ln for ln in capsys.readouterr().err.splitlines() if ln.startswith("WARNING: ")]


def test_a_zoned_session_prints_the_apps_node_messages(capsys):
    _cols, _raw, errors = run_session(copy.deepcopy(SESSION))
    assert errors == []
    err = _err_lines(capsys)
    # Join Data: hive (Pacific/Auckland) joined with zone-less weather.
    assert "WARNING: Join Data: Joined times are in A's zone (Pacific/Auckland)." in err
    assert any(ln.startswith("WARNING: Join Data: B's times have no zone, so they are read as "
                             "UTC. If they were recorded in Pacific/Auckland time") for ln in err)
    # Clock phase across the end of NZDT (Cosinor) and BST's start (the AWD Cosinor).
    assert ("WARNING: Cosinor: Clock time uses the first sample's offset (UTC+13:00, "
            "Pacific/Auckland) for the whole record. Daylight saving ended on 7 Apr 2024, so "
            "phases after it read 1 h later than the local clock.") in err
    assert any(ln.startswith("WARNING: Cosinor: Clock time uses the first sample's offset "
                             "(UTC, Europe/London)") for ln in err)
    assert ("WARNING: Moving Analysis: Daylight saving ended on 7 Apr 2024 in Pacific/Auckland; "
            "each window's clock time uses the offset in force at its centre.") in err
    # Hourly bins and a 1 h change: the bins keep their clock times, so no note.
    assert not any(ln.startswith("WARNING: Bin Data:") for ln in err)


def test_daily_bins_print_the_bin_note(capsys):
    session = copy.deepcopy(SESSION)
    session["tableProcesses"] = [tp for tp in session["tableProcesses"]
                                 if tp["name"] == "BinnedData"]
    session["tableProcesses"][0]["args"]["binSize"] = 24
    run_session(session)
    err = _err_lines(capsys)
    notes = [ln for ln in err if ln.startswith("WARNING: Bin Data:")]
    assert len(notes) == 1
    assert re.fullmatch(r"WARNING: Bin Data: Daylight saving ended on 7 Apr 2024 in "
                        r"Pacific/Auckland\. Bins are 24 h of elapsed time, so bins after it "
                        r"start at \d\d:\d\d local time\.", notes[0])


def test_no_zone_prints_nothing(capsys):
    session = copy.deepcopy(SESSION)
    for c in session["data"]:
        c.pop("timeZone", None)
    run_session(session)
    assert _err_lines(capsys) == []


def _gap_column():
    raw = {1: ["2024-09-29 01:00", "2024-09-29 01:30", "2024-09-29 02:00", "2024-09-29 02:30",
               "2024-09-29 03:00", "2024-09-29 03:30"]}
    col = rt.Column(id=1, name="logger", type="time", data=1, raw_data=raw,
                    time_format="YYYY-MM-DD HH:mm", time_zone="Pacific/Auckland")
    col.columns_index = {1: col}
    return col


def test_a_column_in_the_skipped_hour_warns_once(capsys):
    col = _gap_column()
    col.get_data()
    col.get_data()
    assert _err_lines(capsys) == [
        'WARNING: Column "logger": 2 times fall in the hour skipped when daylight saving began '
        "in Pacific/Auckland, so they do not exist there; they are moved forward by the change "
        "(02:30 reads 03:30 after a 1 h change). This logger may not follow daylight saving: "
        "try a fixed offset."]


def test_the_actogram_prints_its_dst_note(capsys):
    cols, _raw, _ = run_session(copy.deepcopy(SESSION))
    capsys.readouterr()
    plot = {"name": "Hive", "type": "actogram",
            "plot": {"periodHrs": 24, "data": [{"x": {"refId": 1}, "y": {"refId": 2}}]}}
    fig, ax = plt.subplots()
    try:
        rt.plot_actogram(plot, cols, ax)
    finally:
        plt.close(fig)
    assert _err_lines(capsys) == [
        'WARNING: Actogram "Hive": Daylight saving ended on 7 Apr 2024 in Pacific/Auckland. '
        "Rows are 24 h of elapsed time, so rows after it start at 23:00 local time."]
