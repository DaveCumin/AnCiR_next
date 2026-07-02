### Analysis of Chronobiological Rhythms (AnCiR)

This is our 'AnCiR' to the need for a simple-to-use (GUI; no coding) tool for analysis of chronobiological rhythms (and other data).

AnCiR was financially supported by a University of Auckland Teaching and Learning Development and Innovation Grant (2024) and is written in [Svelte](https://svelte.dev/) by [DaveCumin](https://github.com/davecumin) and [Yuxing (Starr) Zhang](https://github.com/yz-329), with help from AI models.

**Please feel free to send any bug reports, feature requests, or offers of support to [d.cumin@auckland.ac.nz](mailto:d.cumin@auckland.ac.nz?subject=AnCiR)**

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

[![DOI](https://zenodo.org/badge/967164279.svg)](https://doi.org/10.5281/zenodo.19340642)
