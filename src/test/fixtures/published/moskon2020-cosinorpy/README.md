# Moškon 2020: CosinorPy test data and supplementary tables

Moškon, M. (2020). CosinorPy: a python package for cosinor-based rhythmometry. _BMC
Bioinformatics_, 21, 485. https://doi.org/10.1186/s12859-020-03830-w

Code and data: https://github.com/mmoskon/CosinorPy, **MIT licence** (`LICENSE.txt`, copied
unchanged, as the licence requires). The paper (CC BY 4.0) also states a CC0 waiver for its data.

## Files

- `paper_data_long.csv` (sha256 `0c0a22af05f4dc8bb6dde2f6c0acf12a68f35d874f3c2f5b7035391922667636`):
  the repository's `test_data/data.xlsx` (sha256
  `cc024022a331f870b444d3e4034f64150f0165ef9fb31aec2921c8b0492a72e3`, unchanged since commit
  `ed35017e`, 2020-02-05), the data behind the paper's results, one row per time and replicate:
  `time_h, replicate, test1..test4`. test1 and test2 are sampled every 2 h (their other rows are
  blank), test3 and test4 every hour; 3 replicates each. Synthetic data with known truth
  (paper Table 2).
- `supp_table_1.csv`, `supp_table_2.csv`: the paper's Additional files 1 and 2, from the
  repository's `supp_tables/` at commit `1d0f0cda` (2020-10-22), unchanged.

## Published results pinned

Cosinor with a fixed 24 h period, replicates pooled (the paper's "independent measurements"
case):

- Supplementary Table 1, 1 to 3 components (AnCiR's `nHarmonics`), every scenario: R² to 1e-9,
  amplitude to 1e-4 relative (CosinorPy finds multi-component amplitudes on a time grid).
- Supplementary Table 2, 1 component: the zero-amplitude F-test p-value to 1e-6 relative, the
  amplitude to 1e-9 relative, and the peak time (acrophase[h] mod 24) to 1e-6 h.
