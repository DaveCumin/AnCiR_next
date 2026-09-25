#!/usr/bin/env bash
# Reproduce the AnCiR simulation-based accuracy study (studies A-E) end to end.
# Run from anywhere; takes ~3-5 min on an Apple M3 (16 GB).
# Prerequisites: pnpm install (repo), tools/.venv with accuracy_refs/requirements.txt,
# R >= 4.5 with nparACT 0.9.1 (install.packages("nparACT")).
# Never runs `pnpm build` (that triggers a production deploy).
set -euo pipefail
cd "$(dirname "$0")/../../.."
RUN_PAPER_BENCH=1 pnpm vitest run --config tools/benchmarks/paper/vitest.config.js
node tools/benchmarks/paper/summarise_accuracy.mjs > tools/benchmarks/paper/results/accuracy/summary_stdout.txt
Rscript tools/benchmarks/paper/accuracy_refs/compare_npcra_nparACT.R
tools/.venv/bin/python tools/benchmarks/paper/accuracy_refs/compare_reference.py
