#!/usr/bin/env python3
"""
check_tp_coverage.py — keep the Python table-process runtime in sync with JS.

The JS engine registers one table process per Svelte file in
``src/lib/tableProcesses/*.svelte``; the *filename* is the canonical key
(e.g. ``Cosinor`` -> ``cosinor``) and ``const displayName = '...'`` is the
human-facing name AnCiR stores in ``table.processes[].name``.

This script (stdlib only, no Node) does two jobs:

1. COVERAGE CHECK — assert every JS table process has an implementation in
   ``tools/ancir_runtime.py``'s ``TABLE_PROCESS_MAP`` (accounting for the
   ``name.lower().replace(' ', '')`` normalization the runtime uses). Prints
   the missing ones and exits non-zero if coverage is incomplete.

2. GENERATE DISPLAY_TO_TP — rewrite the AUTO-GENERATED ``DISPLAY_TO_TP`` block
   in ``ancir_runtime.py`` from the scanned displayNames + filename keys, so
   the display-name->key map can no longer drift from the JS sources by hand.

Usage:
    python3 tools/check_tp_coverage.py            # check + regenerate map
    python3 tools/check_tp_coverage.py --check    # check only (no file writes)

Exit code 0 = coverage complete, non-zero = missing implementations.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
TP_DIR = REPO / "src" / "lib" / "tableProcesses"
RUNTIME = HERE / "ancir_runtime.py"

GEN_START = "# >>> AUTO-GENERATED DISPLAY_TO_TP (do not edit by hand) >>>"
GEN_END = "# <<< AUTO-GENERATED DISPLAY_TO_TP <<<"

# Legacy / extra display-name aliases preserved across regeneration so older
# session files that used a different `name` string still resolve. Keys are the
# alias string AnCiR may have stored; values are the canonical tp-key.
MANUAL_ALIASES = {
    "SimulateData": "simulateddata",
    "Binned Data": "binneddata",
    "Blank Column": "blankcolumn",
    "Column Functions": "columnfunctions",
    "Smoothed Data": "smootheddata",
    "Trend Fit": "trendfit",
    "Long to Wide": "longtowide",
    "Wide to Long": "widetolong",
}

DISPLAY_RE = re.compile(r"const\s+displayName\s*=\s*'([^']*)'")


def tp_key(name: str) -> str:
    """Mirror runtime normalization: lower-case, strip spaces."""
    return name.lower().replace(" ", "")


def scan_js() -> dict[str, str]:
    """Return {filename_key: displayName} for every JS table process."""
    if not TP_DIR.is_dir():
        print(f"error: {TP_DIR} not found", file=sys.stderr)
        sys.exit(2)
    result = {}
    for path in sorted(TP_DIR.glob("*.svelte")):
        file_key = path.stem  # e.g. "Cosinor", "FitFunction"
        m = DISPLAY_RE.search(path.read_text())
        display = m.group(1) if m else file_key
        result[file_key] = display
    return result


def runtime_keys() -> set[str]:
    """Pull the keys registered in TABLE_PROCESS_MAP from the runtime source."""
    src = RUNTIME.read_text()
    m = re.search(r"TABLE_PROCESS_MAP\s*=\s*\{(.*?)\n\}", src, re.DOTALL)
    if not m:
        print("error: could not locate TABLE_PROCESS_MAP in runtime",
              file=sys.stderr)
        sys.exit(2)
    return set(re.findall(r"'([^']+)'\s*:", m.group(1)))


def build_map(js: dict[str, str]) -> dict[str, str]:
    """Build displayName/filename -> tp-key, including manual aliases."""
    mapping: dict[str, str] = {}
    for file_key, display in sorted(js.items()):
        key = tp_key(file_key)
        mapping[display] = key       # AnCiR `displayName`
        mapping[file_key] = key      # filename key (lower/no-space == tp-key)
    for alias, key in MANUAL_ALIASES.items():
        mapping.setdefault(alias, key)
    return mapping


def render_block(mapping: dict[str, str]) -> str:
    lines = [GEN_START, "DISPLAY_TO_TP = {"]
    for name in sorted(mapping):
        lines.append(f"    {name!r}: {mapping[name]!r},")
    lines.append("}")
    lines.append(GEN_END)
    return "\n".join(lines)


def regenerate(mapping: dict[str, str]) -> bool:
    """Rewrite the AUTO-GENERATED block in the runtime. Returns True if changed."""
    src = RUNTIME.read_text()
    if GEN_START not in src or GEN_END not in src:
        print(f"error: generation markers not found in {RUNTIME.name}",
              file=sys.stderr)
        sys.exit(2)
    new_block = render_block(mapping)
    pattern = re.compile(re.escape(GEN_START) + r".*?" + re.escape(GEN_END),
                         re.DOTALL)
    new_src = pattern.sub(new_block, src)
    if new_src != src:
        RUNTIME.write_text(new_src)
        return True
    return False


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="check coverage only; do not regenerate the map")
    args = ap.parse_args(argv)

    js = scan_js()
    impl = runtime_keys()

    expected = {tp_key(fk) for fk in js}
    missing = sorted(k for k in expected if k not in impl)

    print(f"[tp-coverage] JS table processes: {len(js)}")
    print(f"[tp-coverage] runtime TABLE_PROCESS_MAP keys: {len(impl)}")

    if missing:
        print(f"[tp-coverage] MISSING implementations ({len(missing)}):",
              file=sys.stderr)
        for k in missing:
            # report the source filename for clarity
            fk = next((f for f in js if tp_key(f) == k), k)
            print(f"    - {fk} (expected tp-key {k!r})", file=sys.stderr)
    else:
        print("[tp-coverage] OK: every JS table process is implemented.")

    if not args.check:
        mapping = build_map(js)
        changed = regenerate(mapping)
        print(f"[tp-coverage] DISPLAY_TO_TP "
              f"{'regenerated (file updated)' if changed else 'already up to date'} "
              f"({len(mapping)} entries).")

    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
