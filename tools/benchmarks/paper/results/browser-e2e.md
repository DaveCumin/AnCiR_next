# Browser end-to-end benchmark (median of reps)

Chromium 147.0.7727.15 (Playwright 1.59.1, headless), Apple M3, 16 GB. Production build via `vite preview`. 2026-09-25T18:53:02.655Z. "Settled" = last DOM mutation/long task before a 1500 ms quiet window.

## CSV import, binning switched OFF (raw rows kept)

| metric | 10k | 20k | 100k | 250k | 500k | 1M |
|---|---:|---:|---:|---:|---:|---:|
| file chosen -> preview ready | 112 ms | 134 ms | 114 ms | 224 ms | 257 ms | 456 ms |
| Confirm -> UI settled | 1.13 s | 1.75 s | 5.98 s | 3.54 s | 6.10 s | 11.27 s |
| total (file -> settled) | 1.26 s | 1.95 s | 6.16 s | 3.81 s | 6.45 s | 11.74 s |
| longest main-thread block | 299 ms | 584 ms | 2.77 s | 1.67 s | 3.11 s | 6.12 s |
| total blocking time | 462 ms | 1.01 s | 5.27 s | 2.79 s | 5.36 s | 10.57 s |
| JS heap after (MB) | 22 | 31 | 76 | 76 | 318 | 623 |
| reps ok / run | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |

## CSV import, default binning (15 min; offered only above 15,000 rows)

| metric | 10k | 20k | 100k | 250k | 500k | 1M |
|---|---:|---:|---:|---:|---:|---:|
| file chosen -> preview ready | 129 ms | 133 ms | 109 ms | 204 ms | 269 ms | 421 ms |
| Confirm -> UI settled | 1.16 s | 837 ms | 1.51 s | 3.46 s | 6.39 s | 12.65 s |
| total (file -> settled) | 1.30 s | 973 ms | 1.62 s | 3.67 s | 6.67 s | 13.08 s |
| longest main-thread block | 298 ms | 141 ms | 655 ms | 1.94 s | 3.92 s | 8.12 s |
| JS heap after (MB) | 22 | 22 | 65 | 21 | 215 | 406 |
| reps ok / run | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |

## Session load with one Actogram (bars, canvas node preview)

| metric | 10k | 20k | 100k | 250k | 500k | 1M |
|---|---:|---:|---:|---:|---:|---:|
| file -> actogram drawn & settled | 551 ms | 593 ms | 1.00 s | 1.89 s | 2.92 s | 5.23 s |
| longest main-thread block | 55 ms | 102 ms | 400 ms | 1.08 s | 1.95 s | 3.75 s |
| change Period 24 -> 24.5 -> settled | 29 ms | 44 ms | 205 ms | 501 ms | 1.39 s | 2.85 s |
| longest block during update | 0 ms | 0 ms | 201 ms | 490 ms | 1.32 s | 2.71 s |
| JS heap after (MB) | 26 | 46 | 187 | 458 | 906 | 1806 |
| reps ok / run | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |

## Session load with one Lomb-Scargle Periodogram (1-30 h, step 0.25 h)

| metric | 10k | 20k | 100k | 250k | 500k | 1M |
|---|---:|---:|---:|---:|---:|---:|
| file -> periodogram drawn & settled | 570 ms | 593 ms | 1.06 s | 2.07 s | 3.81 s | 7.28 s |
| longest main-thread block | 0 ms | 0 ms | 85 ms | 183 ms | 345 ms | 680 ms |
| change Period Step 0.25 -> 0.2 -> settled | 341 ms | 411 ms | 1.01 s | 2.10 s | 3.94 s | 7.67 s |
| longest block during update | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms |
| JS heap after (MB) | 8 | 10 | 15 | 27 | 34 | 68 |
| reps ok / run | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |

