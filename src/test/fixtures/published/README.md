# Published datasets (regression goldens)

Small published datasets whose published results AnCiR reproduces, pinned by
`mcp/test/guard.published-goldens.test.js`. Each folder says where its files came from, under
what licence, and which published numbers the test pins.

Only data whose licence allows inclusion in this Apache-2.0 repository are here:

| Folder                  | Source                                                | Licence  |
| ----------------------- | ----------------------------------------------------- | -------- |
| `goh2024-sheep/`        | Goh et al. 2024, Dryad doi:10.5061/dryad.1g1jwsv46    | CC0 1.0  |
| `moskon2020-cosinorpy/` | Moškon 2020, github.com/mmoskon/CosinorPy (MIT files) | MIT, CC0 |

Considered and left out: Geissmann et al. 2019 (rethomics; data Zenodo doi:10.5281/zenodo.1172980)
is CC BY-SA 4.0. Share-alike would bind the derived files to CC BY-SA, which is not compatible
with shipping them under Apache-2.0, so it is not included.

The files were copied from the exemplar analyses in
`Circadian/RACiR/Exemplar Published Data Analysis/` (01 and 05), where the download URLs, dates
and the checksums of the original deposits are recorded.
