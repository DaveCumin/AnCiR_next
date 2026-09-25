# Browser end-to-end benchmark (median of reps)

Chromium 147.0.7727.15 (Playwright 1.59.1, headless), Apple M3, 16 GB. Production build via `vite preview`. 2026-09-24T23:54:46.068Z. "Settled" = last DOM mutation/long task before a 1500 ms quiet window.

## CSV import, binning switched OFF (raw rows kept)

| metric | 10k | 20k | 100k | 250k | 500k | 1M |
|---|---:|---:|---:|---:|---:|---:|
| file chosen -> preview ready | 80 ms | 85 ms | 108 ms | 214 ms | 259 ms | 393 ms |
| Confirm -> UI settled | 1.17 s | 1.72 s | 5.87 s | 3.37 s | 6.10 s | 11.09 s |
| total (file -> settled) | 1.25 s | 1.85 s | 6.02 s | 3.60 s | 6.41 s | 11.51 s |
| longest main-thread block | 288 ms | 563 ms | 2.70 s | 1.54 s | 3.05 s | 6.02 s |
| total blocking time | 443 ms | 982 ms | 5.15 s | 2.63 s | 5.34 s | 10.38 s |
| JS heap after (MB) | 22 | 31 | 77 | 70 | 317 | 623 |
| reps ok / run | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |

## CSV import, default binning (15 min; offered only above 15,000 rows)

| metric | 10k | 20k | 100k | 250k | 500k | 1M |
|---|---:|---:|---:|---:|---:|---:|
| file chosen -> preview ready | 130 ms | 135 ms | 122 ms | 205 ms | 257 ms | 397 ms |
| Confirm -> UI settled | 1.16 s | 778 ms | 1.50 s | 3.49 s | 6.45 s | 12.33 s |
| total (file -> settled) | 1.29 s | 919 ms | 1.62 s | 3.70 s | 6.71 s | 12.73 s |
| longest main-thread block | 288 ms | 136 ms | 642 ms | 1.94 s | 3.93 s | 7.90 s |
| JS heap after (MB) | 23 | 22 | 65 | 38 | 215 | 406 |
| reps ok / run | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |

## Session load with one Actogram (bars, canvas node preview)

| metric | 10k | 20k | 100k | 250k | 500k | 1M |
|---|---:|---:|---:|---:|---:|---:|
| file -> actogram drawn & settled | 585 ms | 594 ms | 1.02 s | 1.68 s | 2.81 s | 5.10 s |
| longest main-thread block | 57 ms | 100 ms | 420 ms | 932 ms | 1.86 s | 3.67 s |
| change Period 24 -> 24.5 -> settled | 39 ms | 64 ms | 241 ms | 532 ms | 1.11 s | 2.91 s |
| longest block during update | 0 ms | 54 ms | 231 ms | 521 ms | 1.10 s | 2.77 s |
| JS heap after (MB) | 26 | 46 | 185 | 457 | 906 | 1805 |
| reps ok / run | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |

## Session load with one Lomb-Scargle Periodogram (1-30 h, step 0.25 h)

| metric | 10k | 20k | 100k | 250k | 500k | 1M |
|---|---:|---:|---:|---:|---:|---:|
| file -> periodogram drawn & settled | 584 ms | 596 ms | 1.04 s | 2.03 s | 3.63 s | 6.98 s |
| longest main-thread block | 0 ms | 0 ms | 88 ms | 184 ms | 340 ms | 710 ms |
| change Period Step 0.25 -> 0.2 -> settled | 353 ms | 421 ms | 991 ms | 2.06 s | 3.84 s | 7.52 s |
| longest block during update | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms |
| JS heap after (MB) | 10 | 10 | 15 | 21 | 32 | 67 |
| reps ok / run | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |

