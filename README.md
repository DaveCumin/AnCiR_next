### Analysis of Chronobiological Rhythms (AnCiR)

This is our 'AnCiR' to the need for a simple-to-use (GUI; no coding) tool for analysis of chronobiological rhythms (and other data). It provides periodicity detection (Sokolove-Bushell chi-squared, Enright, Lomb-Scargle, FFT), cosinor and harmonic-cosinor fitting, non-parametric circadian rhythm analysis (IS, IV, RA, M10, L5), circular statistics, continuous wavelet transforms, smoothing, and inferential statistics with multiple-comparison correction and surrogate or permutation nulls.

This repository also holds the source of **A Handbook of Chronobiological Data Analysis**, an interactive companion text with worked examples and animations that explains the methods and shows how to carry them out in AnCiR. It is published at https://ancir.pages.dev/handbook.html and its source lives under `handbook/`. The handbook is a separate, citable work with its own DOI and its own version history.

AnCiR was financially supported by a University of Auckland Teaching and Learning Development and Innovation Grant (2024) and is written in [Svelte](https://svelte.dev/) by [David Cumin](https://github.com/davecumin) and [Yuxing (Starr) Zhang](https://github.com/yz-329), with help from AI models.

**Please send any bug reports, feature requests, or offers of support to [d.cumin@auckland.ac.nz](mailto:d.cumin@auckland.ac.nz?subject=AnCiR)**

The following packages were used in this project:

- [D3](https://d3js.org/) is used for plotting (ISC licensed).
- [Papaparse](https://www.papaparse.com/) is used for importing the data (MIT licensed).
- [SheetJS](https://www.npmjs.com/package/xlsx) was the basis for a light, custom implementation to import data from xlsx files (Apache 2.0); the actual unzipping is done with [fflate](https://github.com/101arrowz/fflate) (MIT licensed).
- [Moment-guess](https://www.npmjs.com/package/moment-guess) was adapted to guess the time format of data (MIT licensed).
- Stats functions from [stdlib.io](https://github.com/stdlib-js/stdlib) (Apache-2.0 license).
- [Day.js](https://www.npmjs.com/package/dayjs) is used for date manipulation and calculations (MIT licensed).
- Icons are from [FontAwesome](https://github.com/FortAwesome/Font-Awesome) (CC BY 4.0 Licensed) and the [Tabler set](https://icon-sets.iconify.design/tabler) (MIT Licensed).

Default colours for the plots are taken from the [maps designed and curated by Fabio Crameri](https://www.fabiocrameri.ch/colourmaps/) (MIT licensed). See Crameri, F., G.E. Shephard, and P.J. Heron (2020), The misuse of colour in science communication, Nature Communications, 11, 5444.

As such, this software is licensed under the stricter of the above - the [Apache-2.0 license](http://www.apache.org/licenses/).

## Why `.git` is a file, not a directory

On this machine the repository's git directory lives OUTSIDE the working tree, at
`~/gitdirs/AnCiR_next.git`. What sits here is a one-line pointer file
(`gitdir: /Users/dcum007/gitdirs/AnCiR_next.git`), created with:

```bash
git init --separate-git-dir ~/gitdirs/AnCiR_next.git
```

The reason is that `~/Documents/Circadian` is a pCloud sync folder, so pCloud was syncing
`.git` along with the source. Git assumes it owns that directory exclusively; pCloud does
not, and on a conflict it renames the loser to `<name> [conflicted]`. It renamed
`.git/config` at least six times between February and August 2026, which is why the git
remote kept "disappearing", and it had also written into `.git/index` and `.git/objects`,
which risks a corrupt repository rather than merely a lost remote.

Moving the git directory out of every synced path fixes it. The pointer file left behind is
still synced, but it is one line of text: if pCloud ever mangles it, retype it.

Two consequences worth knowing:

- **Push regularly.** The git directory is no longer covered by pCloud, so GitHub is the
  only backup of your history. For a repository that is the better arrangement anyway.
- `git worktree list` labels the main worktree with the git-directory path rather than this
  one. Cosmetic: `git rev-parse --show-toplevel` and every normal command are correct.

If you clone this repository elsewhere, none of the above applies; a normal clone gets a
normal `.git` directory. Only put the git directory outside the synced folders, or the
problem comes straight back.

## Citation

The software and the handbook are archived separately, so please cite whichever you are actually referring to.

| Work | Licence | DOI |
| --- | --- | --- |
| AnCiR (the software) | Apache-2.0 | [10.5281/zenodo.19340642](https://doi.org/10.5281/zenodo.19340642) |
| A Handbook of Chronobiological Data Analysis | CC BY 4.0 | [10.5281/zenodo.21727169](https://doi.org/10.5281/zenodo.21727169) |

Both DOIs are concept DOIs: each resolves to the most recent release, and every release also has its own version DOI if you need to pin one. See `CITATION.cff` for machine-readable metadata.

[![DOI](https://zenodo.org/badge/967164279.svg)](https://doi.org/10.5281/zenodo.19340642)
