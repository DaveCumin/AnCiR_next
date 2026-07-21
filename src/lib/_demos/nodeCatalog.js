/**
 * nodeCatalog — the single source of truth for "one of every node type".
 *
 * Encodes, for every registered plot, column-process, and table-process, how to
 * construct a valid instance with real input data. Consumed by:
 *   - allNodesCoverage.test.js — asserts every registered node type has a spec,
 *     produces valid output, and wires up in getProcessNodeGraph().
 *   - the cmd-shift-s demo (refresh() in +page.svelte) via buildAllNodes(), so the
 *     loadable demo visibly covers every node.
 *
 * Specs are deterministic (no Math.random) so tests are stable. Each TP spec's
 * `args(ids)` returns the full args object EXCEPT the auto-seeded per-Y output
 * keys (TableProcess seeds those from yOutKeyPrefix); it must seed at least the
 * shared/X output key (or {} for output-less TPs like GroupComparison).
 */
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';

// --- deterministic sample-data helpers ---------------------------------------
const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const N = 50;
export const SAMPLE = {
	index: () => seq(N, (i) => i),
	hours: () => seq(N, (i) => i),
	rhythm: (period = 24, amp = 40, base = 50, phaseHrs = 0) =>
		seq(N, (i) => base + amp * Math.sin((2 * Math.PI * (i - phaseHrs)) / period - Math.PI / 2)),
	linear: (m = 2, c = 1) => seq(N, (i) => m * i + c),
	category3: () => seq(N, (i) => ['A', 'B', 'C'][i % 3]),
	// ISO timestamps, hourly — becomes a 'time' column.
	isoHours: () => seq(N, (i) => new Date(Date.UTC(2024, 0, 1, i)).toISOString())
};

// --- PLOTS -------------------------------------------------------------------
// type = lowercased plot folder name. `wire(plot, ids)` attaches input columns.
// `inputs` lists the source columns to create (in order passed to wire).
export const PLOT_SPECS = [
	{
		type: 'scatterplot',
		inputs: [
			{ type: 'number', data: SAMPLE.index },
			{ type: 'number', data: SAMPLE.linear }
		],
		wire: (p, [x, y]) => p.plot.addData({ x: { refId: x }, y: { refId: y } })
	},
	{
		type: 'boxplot',
		inputs: [
			{ type: 'category', data: SAMPLE.category3 },
			{ type: 'number', data: SAMPLE.rhythm }
		],
		wire: (p, [x, y]) => p.plot.addData({ x: { refId: x }, y: { refId: y } })
	},
	{
		type: 'histogram',
		inputs: [{ type: 'number', data: SAMPLE.rhythm }],
		wire: (p, [c]) => p.plot.addData({ column: { refId: c } })
	},
	{
		type: 'actogram',
		inputs: [
			{ type: 'time', data: SAMPLE.isoHours },
			{ type: 'number', data: SAMPLE.rhythm }
		],
		wire: (p, [t, v]) => p.plot.addData({ time: { refId: t }, values: { refId: v } })
	},
	{
		type: 'periodogram',
		inputs: [
			{ type: 'time', data: SAMPLE.isoHours },
			{ type: 'number', data: SAMPLE.rhythm }
		],
		wire: (p, [t, v]) => p.plot.addData({ time: { refId: t }, values: { refId: v } })
	},
	{
		type: 'correlogram',
		inputs: [
			{ type: 'time', data: SAMPLE.isoHours },
			{ type: 'number', data: SAMPLE.rhythm }
		],
		wire: (p, [t, v]) => p.plot.addData({ time: { refId: t }, values: { refId: v } })
	},
	{
		type: 'fft',
		inputs: [
			{ type: 'time', data: SAMPLE.isoHours },
			{ type: 'number', data: SAMPLE.rhythm }
		],
		wire: (p, [t, v]) => p.plot.addData({ time: { refId: t }, values: { refId: v } })
	},
	{
		type: 'tableplot',
		inputs: [
			{ type: 'number', data: SAMPLE.index },
			{ type: 'category', data: SAMPLE.category3 }
		],
		wire: (p, ids) => {
			p.plot.columnRefs = [...ids];
			p.plot.showCol = ids.map(() => true);
		}
	},
	{
		// DataView is a viewer with no data inputs (wired via sourcePlotId, not
		// addData). Included for completeness; it produces no input edges.
		type: 'dataview',
		inputs: [],
		wire: () => {},
		noInputEdges: true
	},
	{
		type: 'meansem',
		inputs: [
			{ type: 'category', data: SAMPLE.category3 },
			{ type: 'number', data: SAMPLE.rhythm }
		],
		wire: (p, [x, y]) => p.plot.addData({ x: { refId: x }, y: { refId: y } })
	},
	{
		// Time is optional (['time','values']); this spec wires only `values`,
		// leaving time unwired — the plot's legacy/untimed render mode.
		type: 'circularphase',
		inputs: [{ type: 'number', data: [6.9, 7.4, 7.1, 8.0, 7.6, 6.6, 7.9, 7.2] }],
		wire: (p, [v]) => p.plot.addData({ values: { refId: v } })
	},
	{
		// Self-contained: takes the raw columns and computes the matrix itself.
		type: 'correlationheatmap',
		inputs: [
			{ type: 'number', data: () => SAMPLE.rhythm(24, 40, 50) },
			{ type: 'number', data: () => SAMPLE.rhythm(24, 35, 60) },
			{ type: 'number', data: () => SAMPLE.linear(-2, 100) }
		],
		wire: (p, ids) => ids.forEach((id) => p.plot.addData({ column: { refId: id } }))
	},
	{
		// Scatterplot matrix — same self-contained many-column input.
		type: 'pairsplot',
		inputs: [
			{ type: 'number', data: () => SAMPLE.rhythm(24, 40, 50) },
			{ type: 'number', data: () => SAMPLE.rhythm(24, 35, 60) },
			{ type: 'number', data: () => SAMPLE.linear(-2, 100) }
		],
		wire: (p, ids) => ids.forEach((id) => p.plot.addData({ column: { refId: id } }))
	}
];

// --- COLUMN PROCESSES --------------------------------------------------------
// Attached via column.addProcess(name). `setup(proc, ctx)` overrides args.
// ctx = { selfId, otherId } (otherId is a sibling column for cross-col procs).
export const PROCESS_SPECS = [
	{ name: 'Add', colType: 'number', data: SAMPLE.index, setup: (a) => (a.value = 5) },
	{
		name: 'Sub',
		colType: 'number',
		data: SAMPLE.index,
		// find=5 → replace=10 actually substitutes a value (the sample data is 0,1,2,…),
		// so the before/after scatter shows a visible change. (find=0/replace=0 was a
		// no-op: it "replaced 0 with 0".)
		setup: (a) => ((a.find = 5), (a.replace = 10))
	},
	{ name: 'Multiply', colType: 'number', data: SAMPLE.index, setup: (a) => (a.value = 2) },
	{
		name: 'EditValue',
		colType: 'number',
		data: SAMPLE.index,
		setup: (a) => (a.edits = [{ position: 2, value: 99 }])
	},
	{
		name: 'FilterByOtherCol',
		colType: 'number',
		data: SAMPLE.index,
		needsOther: true,
		setup: (a, ctx) => {
			a.parentColId = ctx.selfId;
			a.conditions = [{ byColId: ctx.otherId, isOperator: '>', byColValue: 2 }];
		}
	},
	{
		name: 'OutlierRemoval',
		colType: 'number',
		data: () => [...SAMPLE.index(), 1000],
		setup: () => {}
	},
	{ name: 'RemoveTrend', colType: 'number', data: SAMPLE.linear, setup: () => {} },
	{ name: 'normalize', colType: 'number', data: SAMPLE.index, setup: () => {} },
	{ name: 'FrequencyFilter', colType: 'number', data: SAMPLE.rhythm, setup: () => {} }
];

// --- TABLE PROCESSES ---------------------------------------------------------
// `inputs` = source columns to create. `args(ids)` returns the full args object
// (input refs + scalar params + `out` seed). For yOutKeyPrefix TPs the per-Y out
// keys are auto-seeded by the TableProcess constructor, so only the X key is set.
// `isAsync` / `validAt` describe how the func reports validity (for correctness).
const T = (type, data) => ({ type, data });
export const TP_SPECS = [
	{
		name: 'BinnedData',
		inputs: [T('number', SAMPLE.index), T('number', SAMPLE.rhythm)],
		args: ([x, y]) => ({
			xIN: x,
			yIN: [y],
			binMode: 'uniform',
			binSize: 2,
			binStart: 0,
			stepSize: 2,
			diffStep: false,
			cuts: [],
			aggFunction: 'mean',
			preProcesses: [],
			out: { binnedx: -1 }
		})
	},
	{
		name: 'Interpolate',
		inputs: [T('number', SAMPLE.index), T('number', SAMPLE.rhythm)],
		args: ([x, y]) => ({
			xIN: x,
			yIN: [y],
			mode: 'resample',
			method: 'linear',
			step: 2,
			start: null,
			end: null,
			out: { interpx: -1 }
		})
	},
	{
		name: 'Sort',
		// Two inputs (a reversed index + a rhythm); sort on the index so both columns
		// visibly reorder together.
		inputs: [T('number', () => SAMPLE.index().reverse()), T('number', SAMPLE.rhythm)],
		args: ([key, y]) => ({
			yIN: [key, y],
			sortOnId: key,
			direction: 'asc',
			preProcesses: [],
			out: {}
		})
	},
	{
		name: 'BlankColumn',
		inputs: [],
		args: () => ({ N: 10, storedValueRefs: {}, out: { result: -1 } })
	},
	{
		name: 'CollectColumns',
		inputs: [T('number', SAMPLE.index), T('number', SAMPLE.linear)],
		args: ([c1, c2]) => ({
			colIds: [c1, c2],
			preProcesses: [],
			aggregates: [],
			out: { [`col_${c1}`]: -1, [`col_${c2}`]: -1 }
		})
	},
	{
		name: 'ColumnSet',
		inputs: [T('number', SAMPLE.index), T('number', SAMPLE.linear)],
		// Curate a subset of the two candidate columns by a name/label rule; empty
		// pattern selects both. No output columns — the `set` port carries the ids.
		args: ([c1, c2]) => ({ colsIN: [c1, c2], pattern: '', matchField: 'either', out: {} })
	},
	{
		name: 'ColumnFunctions',
		inputs: [T('number', SAMPLE.index), T('number', SAMPLE.linear)],
		args: ([c1, c2]) => ({ func: 'add', xsIN: [c1, c2], out: { result: -1 } })
	},
	{
		name: 'Cosinor',
		isAsync: true,
		inputs: [T('number', SAMPLE.hours), T('number', () => SAMPLE.rhythm(24))],
		args: ([t, y]) => ({
			xIN: t,
			yIN: [y],
			Ncurves: 1,
			outputX: -1,
			useFixedPeriod: true,
			fixedPeriod: 24,
			nHarmonics: 1,
			alpha: 0.05,
			preProcesses: [],
			out: { cosinorx: -1 }
		})
	},
	{
		name: 'DoubleLogistic',
		isAsync: true,
		inputs: [
			T('number', SAMPLE.hours),
			T('number', () =>
				seq(N, (i) => 25 + 50 / (1 + Math.exp(-(i - 12))) - 50 / (1 + Math.exp(-(i - 36))))
			)
		],
		args: ([t, y]) => ({
			xIN: t,
			yIN: [y],
			outputX: -1,
			fixK1: false,
			fixedK1: 0.5,
			fixK2: false,
			fixedK2: 0.5,
			fixPeriod: false,
			fixedPeriod: 24,
			out: { dlogx: -1 }
		})
	},
	{
		name: 'FitFunction',
		isAsync: true,
		inputs: [T('number', SAMPLE.hours), T('number', () => SAMPLE.rhythm(24))],
		args: ([t, y]) => ({
			xIN: t,
			yIN: [y],
			model: 'cosinor',
			outputX: -1,
			useFixedPeriod: true,
			fixedPeriod: 24,
			Ncurves: 1,
			nHarmonics: 1,
			alpha: 0.05,
			periodic: true,
			fixK1: false,
			fixedK1: 0.5,
			fixK2: false,
			fixedK2: 0.5,
			fixKappa: false,
			fixedKappa: 5,
			fixOmega: false,
			fixDutyCycle: false,
			fixedDutyCycle: 0.5,
			permuteTest: false,
			autoPermutations: false,
			nPermutations: 999,
			permutationSeed: 12345,
			permutationStatistic: 'rSquared',
			preProcesses: [],
			out: { fitx: -1 }
		})
	},
	{
		name: 'FormulaColumn',
		inputs: [
			T('number', () => seq(N, (i) => i + 1)),
			T('number', () => seq(N, (i) => (i + 1) * 10))
		],
		args: ([c1, c2]) => ({
			tokens: [
				{ type: 'col', id: c1 },
				{ type: 'text', value: ' + ' },
				{ type: 'col', id: c2 }
			],
			out: { result: -1 }
		})
	},
	{
		name: 'GroupComparison',
		inputs: [
			T('category', SAMPLE.category3),
			T('number', () => seq(N, (i) => (i % 3) * 5 + (i % 7)))
		],
		args: ([g, y]) => ({
			xIN: g,
			yIN: [y],
			method: 'auto',
			alpha: 0.05,
			postHocEnabled: true,
			out: {}
		}),
		noOutputs: true
	},
	{
		name: 'DescribeData',
		inputs: [
			T('number', () => SAMPLE.rhythm(24, 40, 50)),
			T('number', () => SAMPLE.linear(2, 1))
		],
		args: ([a, b]) => ({ yIN: [a, b], out: {} }),
		noOutputs: true
	},
	{
		name: 'LogisticRegression',
		// Two numeric predictors and a binary outcome driven by them with injected noise (every
		// 7th label flipped) so the fit is non-separable and converges.
		inputs: [
			T('number', () => seq(60, (i) => ((i * 7) % 11) + 1)),
			T('number', () => seq(60, (i) => ((i * 5) % 9) + 1)),
			T('number', () =>
				seq(60, (i) => {
					const x1 = ((i * 7) % 11) + 1;
					const x2 = ((i * 5) % 9) + 1;
					const base = 0.6 * x1 - 0.5 * x2 - 1 > 0 ? 1 : 0;
					return i % 7 === 0 ? 1 - base : base;
				})
			)
		],
		args: ([x1, x2, y]) => ({ yIN: y, xIN: [x1, x2], out: {} }),
		noOutputs: true
	},
	{
		name: 'ChiSquared',
		// Two categorical columns with a mild association, for a test of independence.
		inputs: [
			T('category', () => seq(90, (i) => ['ctrl', 'drug'][i % 2])),
			T('category', () => seq(90, (i) => (i % 5 === 0 ? 'responder' : 'non-responder')))
		],
		args: ([g, o]) => ({ testType: 'independence', xIN: g, yIN: o, correction: true, out: {} }),
		noOutputs: true
	},
	{
		name: 'CrossCorrelation',
		// Series B is series A shifted, so the demo shows a clear off-zero peak.
		inputs: [
			T('number', () => SAMPLE.rhythm(24, 40, 50)),
			T('number', () => SAMPLE.rhythm(24, 40, 50, 6)) // 6 h phase shift
		],
		args: ([a, b]) => ({ xIN: a, yIN: b, maxLag: 12, method: 'pearson', out: {} }),
		noOutputs: true
	},
	{
		name: 'NormalityTest',
		// One roughly-normal column and one strongly right-skewed column, so the demo shows both a
		// pass and a fail.
		inputs: [
			T('number', () => SAMPLE.rhythm(24, 40, 50)),
			T('number', () => seq(50, (i) => Math.exp(((i * 37) % 50) / 12)))
		],
		args: ([a, b]) => ({ yIN: [a, b], method: 'dagostino', alpha: 0.05, out: {} }),
		noOutputs: true
	},
	{
		name: 'Correlation',
		// Three columns with a real correlation structure so the demo shows a range of r:
		// b tracks a (positive), c opposes a (negative).
		inputs: [
			T('number', () => SAMPLE.rhythm(24, 40, 50)),
			T('number', () => SAMPLE.rhythm(24, 35, 60)),
			T('number', () => SAMPLE.linear(-2, 100))
		],
		args: ([a, b, c]) => ({
			yIN: [a, b, c],
			method: 'auto',
			alpha: 0.05,
			out: {}
		}),
		noOutputs: true
	},
	{
		name: 'LongToWide',
		inputs: [
			T('category', () => seq(60, (i) => ['A', 'B', 'C'][i % 3])),
			T('number', () => seq(60, (i) => Math.floor(i / 3))),
			T('number', () => seq(60, (i) => (i % 3) * 100 + Math.floor(i / 3)))
		],
		args: ([cat, time, val]) => ({
			categoryIN: cat,
			timeIN: time,
			valueIN: val,
			preProcesses: [],
			out: { time: -1, value_A: -1, value_B: -1, value_C: -1 }
		})
	},
	{
		name: 'MovingAnalysis',
		isAsync: true,
		inputs: [
			// 14 days hourly; a 7-day (168 h) window holds ~7 cycles of the 24 h
			// rhythm so the Lomb–Scargle peak is sharp (a 48 h / ~2-cycle window
			// gives a broad, poorly-resolved peak).
			T('number', () => seq(336, (i) => i)),
			T('number', () => seq(336, (i) => Math.cos((2 * Math.PI * i) / 24)))
		],
		args: ([x, y]) => ({
			xIN: x,
			yIN: [y],
			windowSize: 168,
			stepSize: 24,
			binLabel: 'center',
			analysis: 'periodogram',
			pgMethod: 'Lomb-Scargle',
			periodMin: 20,
			periodMax: 28,
			periodStep: 0.5,
			pgBinSize: 0.25,
			pgAlpha: 0.05,
			useFixedPeriod: true,
			fixedPeriod: 24,
			nHarmonics: 1,
			Ncurves: 1,
			alpha: 0.05,
			preProcesses: [],
			out: { movex: -1, [`${y}_peak_period`]: -1, [`${y}_peak_power`]: -1 }
		})
	},
	{
		name: 'Random',
		inputs: [],
		args: () => ({
			N: 50,
			offset: 0,
			multiply: 10,
			seed: 12345,
			distribution: 'uniform',
			out: { result: -1 }
		})
	},
	{
		name: 'RectangularWave',
		inputs: [
			T('number', () => seq(48, (i) => i)),
			T('number', () => seq(48, (i) => (i % 24 < 12 ? 75 : 25)))
		],
		args: ([x, y]) => ({
			xIN: x,
			yIN: [y],
			outputX: -1,
			fixKappa: false,
			fixedKappa: 5,
			fixOmega: false,
			fixedPeriod: 24,
			fixDutyCycle: false,
			fixedDutyCycle: 0.5,
			preProcesses: [],
			out: { rectwavex: -1 }
		})
	},
	{
		name: 'RhythmicityAnalysis',
		isAsync: true,
		inputs: [
			// 14 days hourly (~14 cycles of the 24 h rhythm) so the Lomb–Scargle
			// peak is sharply resolved instead of broad.
			T('number', () => seq(336, (i) => i)),
			T('number', () => seq(336, (i) => Math.cos((2 * Math.PI * i) / 24)))
		],
		args: ([x, y]) => ({
			xIN: x,
			yIN: [y],
			analysis: 'periodogram',
			pgMethod: 'Lomb-Scargle',
			periodMin: 20,
			periodMax: 28,
			periodStep: 0.5,
			pgBinSize: 0.25,
			pgAlpha: 0.05,
			fftFreqStep: 0,
			corrMinLag: 0,
			corrMaxLag: 0,
			preProcesses: [],
			out: { [`${y}_period`]: -1, [`${y}_power`]: -1 }
		})
	},
	{
		name: 'NonparametricRA',
		isAsync: true,
		inputs: [
			// 14 days hourly, a clean square rest-activity rhythm (active 08:00–18:00)
			// → IS≈1, RA≈1, low IV.
			T('number', () => seq(336, (i) => i)),
			T('number', () => seq(336, (i) => (i % 24 >= 8 && i % 24 < 18 ? 100 : 0)))
		],
		args: ([x, y]) => ({
			xIN: x,
			yIN: [y],
			epochHours: 1,
			period: 24,
			mWindow: 10,
			lWindow: 5,
			preProcesses: [],
			out: {
				npcrax: -1,
				[`npcray_${y}`]: -1,
				IS: -1,
				IV: -1,
				RA: -1,
				M10: -1,
				L5: -1,
				M10onset: -1,
				L5onset: -1
			}
		})
	},
	{
		name: 'SequenceColumn',
		inputs: [],
		args: () => ({ seqType: 'number', start: 0, step: 1, count: 50, end: 49, out: { result: -1 } })
	},
	{
		name: 'SimulatedData',
		validAt: 2,
		inputs: [],
		args: () => ({
			startTime: new Date(Date.UTC(2024, 0, 1)).toISOString(),
			sections: [
				{
					duration_hours: 48,
					rhythmPeriod_hours: 24,
					rhythmPhase_hours: 0,
					rhythmAmplitude: 100,
					noiseEnabled: false,
					noiseMode: 'multiply',
					noiseAmplitude: 1
				}
			],
			samplingPeriod_hours: 1,
			out: { time: -1, values: -1 }
		})
	},
	{
		name: 'SmoothedData',
		isAsync: true,
		inputs: [
			T('number', SAMPLE.index),
			T('number', () => seq(N, (i) => 10 + Math.sin(i) + (i % 2 ? 1 : -1)))
		],
		args: ([x, y]) => ({
			xIN: x,
			yIN: [y],
			smootherType: 'moving',
			whittakerLambda: 100,
			whittakerOrder: 2,
			savitzkyWindowSize: 5,
			savitzkyPolyOrder: 2,
			loessBandwidth: 0.3,
			movingAvgWindowSize: 5,
			movingAvgType: 'simple',
			preProcesses: [],
			out: { smoothedx: -1 }
		})
	},
	{
		name: 'Split',
		inputs: [T('number', () => seq(N, (i) => i)), T('number', () => seq(N, (i) => i * 10))],
		args: ([x, y]) => ({
			xIN: x,
			yIN: [y],
			splitTimes: [15, 30],
			out: { [`${y}_1`]: -1, [`${y}_2`]: -1, [`${y}_3`]: -1 }
		})
	},
	{
		name: 'StoredValueGroup',
		inputs: [],
		needsStoredValues: true,
		args: () => ({
			groups: [{ id: 'g1', name: 'GroupA', keys: ['demoSV1', 'demoSV2'] }],
			out: { group_g1: -1 }
		})
	},
	{
		name: 'TrendFit',
		isAsync: true,
		inputs: [T('number', SAMPLE.index), T('number', SAMPLE.linear)],
		args: ([x, y]) => ({
			xIN: x,
			yIN: [y],
			model: 'linear',
			polyDegree: 2,
			outputX: -1,
			preProcesses: [],
			out: { trendx: -1 }
		})
	},
	{
		name: 'WideToLong',
		inputs: [
			T('time', SAMPLE.isoHours),
			T('number', () => seq(N, (i) => 10 + i)),
			T('number', () => seq(N, (i) => 100 - i))
		],
		args: ([t, v1, v2]) => ({
			timeIN: t,
			valueColIds: [v1, v2],
			out: { time: -1, category: -1, value: -1 }
		})
	},
	{
		name: 'AverageProfile',
		inputs: [
			T('number', () => seq(96, (i) => i)),
			T('number', () => seq(96, (i) => 50 + 40 * Math.sin((2 * Math.PI * i) / 24 - Math.PI / 2)))
		],
		args: ([x, y]) => ({
			xIN: x,
			yIN: [y],
			period: 24,
			nBins: 24,
			preProcesses: [],
			out: { avgprofx: -1, [`avgprof_${y}`]: -1 }
		})
	},
	{
		name: 'RayleighTest',
		// Two clustered angle samples with DIFFERENT mean directions so the demo
		// showcases both the always-on Rayleigh test (each column is non-uniform)
		// and the optional Watson-Williams test (the two means differ).
		inputs: [
			T('number', () => seq(20, (i) => 0.4 + Math.cos(i * 1.3) * 0.35)),
			T('number', () => seq(20, (i) => 2.2 + Math.cos(i * 1.3) * 0.35))
		],
		args: ([a, b]) => ({
			yIN: [a, b],
			unit: 'radians',
			period: 24,
			showWatsonWilliams: true,
			out: {}
		}),
		noOutputs: true
	},
	{
		name: 'CircadianFunctionIndex',
		isAsync: true,
		inputs: [
			T('number', () => seq(336, (i) => i)),
			T('number', () => seq(336, (i) => (i % 24 >= 8 && i % 24 < 18 ? 100 : 0)))
		],
		args: ([x, y]) => ({
			xIN: x,
			yIN: [y],
			epochHours: 1,
			period: 24,
			mWindow: 10,
			lWindow: 5,
			preProcesses: [],
			out: { CFI: -1, IS: -1, IV: -1, RA: -1 }
		})
	}
];

// --- builder -----------------------------------------------------------------
function mkCol(type, values, name) {
	const c = new Column({ type, data: -1, provenance: 'nodeCatalog demo' });
	// `name` is a $derived getter; set the backing customName so reads are stable
	// and don't enter the mutating (referencial) branch of the derived.
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	if (type === 'time') c.timeFormat = 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]';
	core.data.push(c);
	return c.id;
}

// Pre-set customName on referencial plot-wrapper columns so reading their `name`
// later (e.g. inside makeProcessNodeHash's JSON.stringify while building the
// graph) short-circuits instead of mutating state — which trips
// state_unsafe_mutation in dev and silently blanks the canvas edges. Mirrors the
// prewarm in Setting.svelte and generateDemos.svelte.test.js.
function prewarmWrapperNames() {
	for (const plot of core.plots) {
		for (const series of plot.plot?.data ?? []) {
			for (const field of ['x', 'y', 'z', 'column']) {
				const w = series?.[field];
				if (w && typeof w === 'object' && 'refId' in w && w.customName == null) {
					const real = core.data.find((c) => c.id === w.refId);
					w.customName = real ? `${real.name}` : 'col';
				}
			}
		}
	}
}

function resolve(d) {
	return typeof d === 'function' ? d() : d;
}

/**
 * Build one of every node type into core, laid out in a grid. Caller is
 * responsible for clearing core first if a clean slate is wanted.
 * Returns { plotIds, processIds, tpIds, columnIds } for assertions/inspection.
 */
export function buildAllNodes({ x0 = 40, y0 = 40, colW = 320, rowH = 240 } = {}) {
	const out = { plotIds: [], processIds: [], tpIds: [], columnIds: [] };
	let col = 0;
	const place = (obj) => {
		obj.x = x0 + (col % 5) * colW;
		obj.y = y0 + Math.floor(col / 5) * rowH;
		col++;
	};

	// Stored values for StoredValueGroup.
	core.storedValues = core.storedValues ?? {};
	core.storedValues.demoSV1 = { staticValue: 12, source: 'manual' };
	core.storedValues.demoSV2 = { staticValue: 34, source: 'manual' };

	// Column processes — each on its own fresh source column.
	for (const spec of PROCESS_SPECS) {
		const selfId = mkCol(spec.colType, resolve(spec.data), `${spec.name} src`);
		const otherId = spec.needsOther ? mkCol('number', SAMPLE.index(), `${spec.name} other`) : -1;
		const colObj = core.data.find((c) => c.id === selfId);
		colObj.addProcess(spec.name);
		const proc = colObj.processes[colObj.processes.length - 1];
		spec.setup?.(proc.args, { selfId, otherId });
		out.processIds.push(proc.id);
		out.columnIds.push(selfId);
	}

	// Table processes.
	for (const spec of TP_SPECS) {
		const ids = spec.inputs.map((inp) => mkCol(inp.type, resolve(inp.data), `${spec.name} in`));
		out.columnIds.push(...ids);
		const tp = new TableProcess({ name: spec.name, args: spec.args(ids) }, null);
		core.tableProcesses.push(tp);
		out.tpIds.push(tp.id);
	}

	// Plots.
	for (const spec of PLOT_SPECS) {
		const ids = spec.inputs.map((inp) => mkCol(inp.type, resolve(inp.data), `${spec.type} in`));
		out.columnIds.push(...ids);
		const p = new Plot({ name: spec.type, type: spec.type });
		spec.wire(p, ids);
		place(p);
		core.plots.push(p);
		out.plotIds.push(p.id);
	}

	prewarmWrapperNames();
	return out;
}
