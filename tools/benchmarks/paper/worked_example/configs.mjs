// Which original session to load and which (already-loaded) columns to analyse.
// Column ids are the ids the CURRENT app assigns after migrating each legacy session
// (discovered with explore.mjs). Ranges/steps are the session's own plot settings, the
// app's defaults (Periodogram plot: 1-30 h, step 0.25 h, bin 0.25 h, alpha 0.05), and a
// fine 0.01 h lattice so peak positions are not grid-limited.
const PAPER = '/Users/dcum007/Documents/Circadian/RACiR/Paper';

const DEFAULT_GRID = { step: 0.25, binSize: 0.25, appCalcRange: true }; // plot defaults
const FINE = (binSize) => ({ step: 0.01, binSize });

export const CONFIGS = [
	{
		name: 'simulated_SimulatedExample',
		session: `${PAPER}/Archive/SimulatedExample.json`,
		series: [
			// 'Before' / 'After' = values_0 duplicated then FilterByOtherCol at 2020-01-15T00:00Z
			{ label: 'Before', x: 0, y: 84, range: [1, 30], grids: [DEFAULT_GRID, FINE(0.25)] },
			{ label: 'After', x: 0, y: 83, range: [1, 30], grids: [DEFAULT_GRID, FINE(0.25)] }
		],
		actogram: [
			{ label: 'Before series', plot: 'Actogram', series: 2, daySets: [{ label: 'all days with data' }] },
			{ label: 'After series', plot: 'Actogram', series: 1, daySets: [{ label: 'all days with data' }] }
		]
	},
	{
		name: 'simulated_session_Simulated',
		session: `${PAPER}/Archive/session_Simulated.json`,
		series: [],
		actogram: []
	},
	{
		name: 'drosophila',
		session: `${PAPER}/DrosophilaData/session.json`,
		series: [
			// Session pipeline: AverageColumns(38 flies) -> BinnedData(0.15 h, mean)
			{
				label: 'Session binned mean (0.15 h)',
				x: 46,
				y: 41,
				range: [10, 30],
				grids: [{ step: 0.15, binSize: 0.15, appCalcRange: true }, FINE(0.15)]
			},
			// Unbinned 5-min group mean (AverageColumns output)
			{
				label: 'Group mean, 5-min',
				x: 0,
				y: 39,
				range: [10, 30],
				grids: [
					{ step: 0.25, binSize: 0.25, appCalcRange: true },
					FINE(0.25),
					{ step: 0.1, binSize: 5 / 60 } // ClockLab-like: 0.1 h steps, bin = 5-min epoch
				]
			}
		],
		actogram: [{ label: 'Session actogram', plot: 'Actogram_6', series: 0, daySets: [{ label: 'all days' }] }]
	},
	{
		name: 'drosophila_HHfix',
		session: new URL('../results/worked_example/inputs/drosophila_session_HHfix.json', import.meta.url).pathname,
		series: null, // filled below from 'drosophila'
		actogram: null
	},
	{
		name: 'scyphax',
		session: `${PAPER}/Scyphax data/FORJAMES R code from Rachel/session.json`,
		series: [
			// Session pipeline: time -> Add (session transform) ; BinnedData(0.25 h, mean) of summed counts
			{
				label: 'Binned 0.25 h, 1-30 h',
				x: 22,
				y: 6,
				range: [1, 30],
				grids: [{ step: 0.01, binSize: 0.25, appCalcRange: true }, DEFAULT_GRID]
			},
			{
				label: 'Binned 0.25 h, 10-14 h',
				x: 22,
				y: 6,
				range: [10, 14],
				grids: [FINE(0.25)]
			},
			// Un-binned 1-min summed counts (session's 'time -> Add' x), finer chi-squared bins
			{
				label: 'Raw 1-min, 10-14 h',
				x: 21,
				y: 1,
				range: [10, 14],
				grids: [{ step: 0.01, binSize: 1 / 60 }]
			}
		],
		actogram: [
			{ label: 'Session actogram (24 h rows)', plot: 'actogram_1', series: 0, daySets: [{ label: 'all days' }] },
			{
				label: 'Actogram replotted at 12 h rows',
				plot: 'actogram_1',
				series: 0,
				periodHrs: 12,
				daySets: [{ label: 'all rows' }]
			}
		]
	}
];

const dro = CONFIGS.find((c) => c.name === 'drosophila');
const fix = CONFIGS.find((c) => c.name === 'drosophila_HHfix');
fix.series = dro.series;
fix.actogram = dro.actogram;
