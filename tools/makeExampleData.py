#!/usr/bin/env python3
"""Generate the teaching-example CSVs for AnCiR.

    python3 tools/makeExampleData.py [outdir]      # default: ./example-data

WHY THIS EXISTS
---------------
Six example CSVs were sitting loose on a Desktop with no script and no note, so nobody could
say how they were made or regenerate them. This reproduces that set from a fixed seed, with
each file's teaching point written down beside its parameters.

The parameters were RECOVERED BY MEASURING the originals (sampling interval, span, dominant
period and its Lomb-Scargle power, waveform duty, zero fraction, outlier magnitudes), not
from the original recipe, which is lost. So the files this writes are equivalent in
character and in what they demonstrate, but they are NOT bit-identical to the originals.
Anything that depends on the exact numbers should keep using the originals.

WHAT EACH FILE IS FOR
---------------------
The names are the lesson. Two are deliberately ironic, and the pair that share a period
differ only in how strong the signal is — which is exactly the "is this peak real?"
judgement a reader has to make.

    The_Signal_Of_The_Century   24.00 h, very strong      what a clean circadian rhythm looks like
    Nobel-Worthy                24.81 h, very strong      FREE-RUNNING: the peak is not at 24 h
    Trust_Me_It_Is_Circadian    12.00 h, strong           ironic: strongly rhythmic but ULTRADIAN
    Probably_P-Hacked           24.00 h, weak             a real period, but a peak worth doubting
    Definitely_Significant      none                      ironic: noise, and the honest answer is "no rhythm"
    Test_Data                   irregular                 outlier removal, not rhythm at all

Measured characteristics of the originals, for reference:

    file                        peak (h)   LS power   sampling   span
    The_Signal_Of_The_Century     24.00      1158       6 min     12 d
    Nobel-Worthy                  24.81      1321       6 min     14 d
    Trust_Me_It_Is_Circadian      12.00       973       6 min     12 d
    Probably_P-Hacked             24.00        32       6 min     12 d
    Definitely_Significant         3.36         6       6 min     12 d
    Test_Data                        -          -      15 min     28 d
"""
from __future__ import annotations

import csv
import math
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

# One seed for the whole run, so the set regenerates identically. Change it and EVERY file
# changes together, which is the point: they are a set, not six unrelated files.
SEED = 20260301
START = datetime(2026, 3, 1, 0, 0, 0)
STEP_MIN = 6  # the five rhythm files are 6-minute activity counts


def counts(value: float, rng: random.Random, noise: float) -> int:
    """Turn a model value into an activity COUNT: non-negative integer, noisy.

    Activity counters cannot go below zero, and the floor is where a lot of the character
    comes from — a rhythm clipped at zero looks quite different from a sine, and the rest
    phase is what makes an actogram readable. Poisson-ish scatter via gauss on the mean, then
    clamp; a true Poisson draw would be defensible but harder to tune to a target amplitude.
    """
    v = value + rng.gauss(0, noise)
    return max(0, int(round(v)))


def rhythm(
    n: int,
    period_h: float,
    mesor: float,
    amplitude: float,
    noise: float,
    rng: random.Random,
    duty: float | None = None,
    phase_h: float = 0.0,
) -> list[int]:
    """A rhythmic activity series sampled every STEP_MIN minutes.

    `duty` picks the WAVEFORM. None gives a cosine; a fraction gives a square-ish bout that
    is active for that fraction of each cycle, which is what a nocturnal animal's record
    actually looks like and is why the originals differ in how much time they spend high.
    """
    out = []
    for i in range(n):
        t = i * STEP_MIN / 60.0
        ph = ((t - phase_h) % period_h) / period_h
        if duty is None:
            shape = math.cos(2 * math.pi * ph)
        else:
            # Raised-cosine edges rather than a hard step: a vertical edge is not physiological
            # and makes every smoother and every fit behave badly at the transition.
            edge = 0.06
            if ph < duty:
                rise = min(1.0, ph / edge)
                fall = min(1.0, (duty - ph) / edge)
                shape = min(rise, fall) * 2 - 1
            else:
                shape = -1.0
        out.append(counts(mesor + amplitude * shape, rng, noise))
    return out


def write_csv(path: Path, rows: list[tuple[str, int]], header: tuple[str, str]) -> None:
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)
    print(f"  wrote {path.name:34} {len(rows):5} rows")


def iso_stamps(n: int, step_min: int = STEP_MIN, start: datetime = START) -> list[str]:
    return [(start + timedelta(minutes=i * step_min)).strftime("%Y-%m-%d %H:%M:%S")
            for i in range(n)]


def main(outdir: Path) -> None:
    outdir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)
    print(f"Generating example data into {outdir}/ (seed {SEED})")

    # --- 1. A clean, strong circadian rhythm -------------------------------------------
    # The reference case: if a reader cannot see this one, nothing else will help.
    n = 12 * 24 * 60 // STEP_MIN
    write_csv(outdir / "The_Signal_Of_The_Century.csv",
              list(zip(iso_stamps(n), rhythm(n, 24.0, 140, 138, 14, rng, phase_h=14))),
              ("time", "activity"))

    # --- 2. Free-running ---------------------------------------------------------------
    # 24.81 h, so the onset drifts ~50 min later each day. The whole point is that the peak
    # is NOT at 24: a periodogram restricted to exactly 24 h would call this weaker than it is.
    n = 14 * 24 * 60 // STEP_MIN
    write_csv(outdir / "Nobel-Worthy.csv",
              list(zip(iso_stamps(n), rhythm(n, 24.81, 105, 108, 13, rng, duty=0.45, phase_h=10))),
              ("time", "activity"))

    # --- 3. Ironic: strongly rhythmic, but ULTRADIAN ------------------------------------
    # 12 h, not 24. Named to catch the reader who assumes "rhythmic" means "circadian" —
    # the periodogram peak is unmistakable and at the wrong period.
    n = 12 * 24 * 60 // STEP_MIN
    write_csv(outdir / "Trust_Me_It_Is_Circadian.csv",
              list(zip(iso_stamps(n), rhythm(n, 12.0, 66, 74, 11, rng, duty=0.33, phase_h=3))),
              ("time", "activity"))

    # --- 4. A real 24 h period, but a weak one ------------------------------------------
    # Same period as #1 with a small FRACTION of its power. What matters is the RATIO to
    # #1, not the absolute number: the originals sit at roughly 1158 vs 32, about 36x, and
    # that gap is the lesson. Tuned to land near it — amplitude 10 against noise 45 gives
    # ~34. An earlier draft used amplitude 22 and reached 168, only 8x weaker than #1, which
    # made this file look reasonably convincing and quietly destroyed the point of it.
    n = 12 * 24 * 60 // STEP_MIN
    write_csv(outdir / "Probably_P-Hacked.csv",
              list(zip(iso_stamps(n), rhythm(n, 24.0, 63, 10, 45, rng, phase_h=8))),
              ("time", "activity"))

    # --- 5. Ironic: no rhythm at all ----------------------------------------------------
    # Pure noise with a slow wander, so a periodogram still shows SOMETHING and the honest
    # reading is "nothing here". The negative control for every method in the app.
    n = 12 * 24 * 60 // STEP_MIN
    vals = []
    drift = 0.0
    for i in range(n):
        drift += rng.gauss(0, 0.35)
        drift = max(-25, min(25, drift))  # bounded, or it becomes a trend rather than noise
        vals.append(counts(56 + drift, rng, 30))
    write_csv(outdir / "Definitely_Significant.csv",
              list(zip(iso_stamps(n), vals)), ("time", "activity"))

    # --- 6. Test_Data: outliers, not rhythm ---------------------------------------------
    # A different animal from the other five: 15-minute sampling, 2024, and its real feature
    # is two absurd spikes (~74k and ~89k against a mean near 77) — a sensor glitch, the case
    # outlier removal exists for. Kept in its original column name and date format so
    # existing sessions built on it still line up.
    step, n = 15, 28 * 24 * 60 // 15
    start24 = datetime(2024, 8, 6, 0, 0, 0)
    vals = rhythm(n, 24.0, 80, 78, 18, rng, duty=0.5, phase_h=13)
    # Two glitches, deliberately placed away from the edges so trimming the ends cannot hide
    # them, and orders of magnitude out so they are unmistakable once plotted.
    vals[len(vals) // 3] = 74382
    vals[2 * len(vals) // 3] = 89246
    stamps = [(start24 + timedelta(minutes=i * step)).strftime("%-m/%-d/%Y, %-I:%M:%S %p")
              for i in range(n)]
    write_csv(outdir / "Test_Data.csv",
              list(zip(stamps, vals)), ("Time", "My example data"))

    print("\nDone. These are equivalent in character to the originals, not bit-identical:")
    print("the original recipe was lost, and these parameters were recovered by measurement.")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path("example-data"))
