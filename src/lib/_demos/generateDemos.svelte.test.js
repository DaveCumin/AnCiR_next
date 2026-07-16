/**
 * Demo-session generator (NOT a normal test).
 *
 * Mints AnCiR-native example sessions using the real Column/Plot/TableProcess
 * classes and the same serialization the app uses (outputCoreAsJson), then
 * writes them to static/sessions/demos/ along with an index.json manifest. The
 * load-session modal fetches that manifest and lists the demos under "examples".
 *
 * Run it explicitly (it is gated so it never runs in the normal suite):
 *   GEN_DEMOS=1 npx vitest run src/lib/_demos/generateDemos.svelte.test.js
 *
 * Design notes
 * ------------
 * Each demo is meant to *show the node doing its job*, not just list numbers:
 *   - Plot demos render one plot on representative data.
 *   - Column-process demos render a before/after scatter so the effect is
 *     visible (input cloud vs processed cloud).
 *   - Analysis (table-process) demos AWAIT the analysis so its outputs are
 *     baked into the session. Curve-fitting analyses (Cosinor, Smooth, Bin,
 *     Trend, Double-logistic, Rectangular wave, Fit function) render the raw
 *     points plus the fitted curve as a line (the pattern users expect); the
 *     rest render a tableplot of real inputs + outputs, or a fitting-specific
 *     plot (boxplot for group comparison).
 *
 * Grouping/wording: families and descriptions come from the real node registry
 * (nodeMeta via processMap / tableProcessMap), so the gallery matches the
 * in-app palette (Arithmetic, Fitting, Analysis, Transform, …) and never uses
 * internal jargon like "table process".
 */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, pushObj, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
// The per-node specs are shared with allNodesCoverage.test.js so the gallery
// covers exactly the registered nodes (one example session per process / TP).
import { PROCESS_SPECS, TP_SPECS, SAMPLE } from './nodeCatalog.js';
// Column-process and table-process demos share builders (Sequence x + y → node,
// with a scatter + table, tidy baked layout) — same as the focused generators.
import { buildProcessDemo, buildTPDemo, addDemoNote } from './nodeDemoBuilders.js';

const OUT_DIR = join(process.cwd(), 'static', 'sessions', 'demos');

// Showcase palette: raw data in navy, derived/fitted curve in terracotta.
const RAW_COLOUR = '#234154';
const FIT_COLOUR = '#BE796B';

// make sure datasets are not lost
const DATASETS = [
	{
		id: 'dataset-testdata',
		name: 'Test data',
		family: 'Sources',
		description: 'Data with two simulated rhythms and outliers',
		url: 'sessions/demos/testData.csv',
		kind: 'dataset',
		keywords: 'test data data with two simulated rhythms and outliers sources csv url example'
	}
];

// Order the gallery the way the node palette is ordered (NodePalette.svelte),
// with the canonical multi-node Workflow templates first — they are the
// "start here" entry points, not single-node reference examples.
const FAMILY_ORDER = [
	'Workflows',
	'Sources',
	'Arithmetic',
	'Filtering',
	'Smoothing',
	'Binning',
	'Fitting',
	'Analysis',
	'Transform',
	'Plots',
	'Other'
];
const familyRank = (f) => {
	const i = FAMILY_ORDER.indexOf(f);
	return i === -1 ? FAMILY_ORDER.length : i;
};

// --- synthetic data helpers (deterministic; no Math.random) -------------------
function mulberry32(seed) {
	return function () {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
// Box–Muller normal from a uniform generator
function normal(rng, mean = 0, sd = 1) {
	const u = Math.max(rng(), 1e-12);
	const v = rng();
	return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));

/**
 * A demo spec returns the list of plots to build given a `mk` toolkit:
 *   mk.col(name, type, values)  -> creates a Column with rawData, returns its id
 *   mk.plot(type, name, inputs) -> new Plot wired to the given {inputKey: colId}
 */
const DEMOS = [
	{
		id: 'scatter-rhythm',
		name: 'Scatter — activity vs hour',
		family: 'Plots',
		description:
			'A simple scatterplot of a noisy ~24 h rhythmic signal against hours since start (7 days, hourly).',
		build(mk) {
			const rng = mulberry32(1);
			const hours = Array.from({ length: 24 * 7 }, (_, i) => i);
			const activity = hours.map(
				(h) => 50 + 40 * Math.sin((2 * Math.PI * h) / 24 - Math.PI / 2) + normal(rng, 0, 6)
			);
			const xId = mk.col('hour', 'number', hours);
			const yId = mk.col('activity', 'number', activity);
			mk.plot('scatterplot', 'Activity vs hour', { x: xId, y: yId }, { x: 'Hour', y: 'Activity' });
		}
	},
	{
		id: 'histogram-normal',
		name: 'Histogram — distribution',
		family: 'Plots',
		description: 'Histogram of 500 samples drawn from a normal distribution (mean 100, sd 15).',
		build(mk) {
			const rng = mulberry32(2);
			const samples = Array.from({ length: 500 }, () => normal(rng, 100, 15));
			const cId = mk.col('measurement', 'number', samples);
			mk.plot(
				'histogram',
				'Measurement distribution',
				{ column: cId },
				{ x: 'Measurement', y: 'Count' }
			);
		}
	},
	{
		id: 'boxplot-by-day',
		name: 'Boxplot — activity by day',
		family: 'Plots',
		description:
			'Boxplot of daily activity values grouped by day index (7 days × 24 hourly points).',
		build(mk) {
			const rng = mulberry32(3);
			const day = [];
			const value = [];
			for (let d = 1; d <= 7; d++) {
				for (let h = 0; h < 24; h++) {
					day.push(d);
					value.push(50 + 40 * Math.sin((2 * Math.PI * h) / 24 - Math.PI / 2) + normal(rng, 0, 8));
				}
			}
			const xId = mk.col('day', 'number', day);
			const yId = mk.col('activity', 'number', value);
			mk.plot('boxplot', 'Activity by day', { x: xId, y: yId }, { x: 'Day', y: 'Activity' });
		}
	},
	{
		id: 'meansem-by-day',
		name: 'Mean ± SEM — activity by day',
		family: 'Plots',
		description: 'Per-day mean activity with standard-error whiskers (7 days × 24 hourly points).',
		build(mk) {
			const rng = mulberry32(3);
			const day = [];
			const value = [];
			for (let d = 1; d <= 7; d++) {
				for (let h = 0; h < 24; h++) {
					day.push(d);
					value.push(50 + 40 * Math.sin((2 * Math.PI * h) / 24 - Math.PI / 2) + normal(rng, 0, 8));
				}
			}
			const xId = mk.col('day', 'number', day);
			const yId = mk.col('activity', 'number', value);
			mk.plot(
				'meansem',
				'Activity by day (mean ± SEM)',
				{ x: xId, y: yId },
				{ x: 'Day', y: 'Activity' }
			);
		}
	},
	{
		id: 'circular-phase-two-groups',
		name: 'Circular phase plot — two groups',
		family: 'Plots',
		description:
			'Two untimed phase groups on a 24 h clock (raw onset phases near 7 h and 19 h), each with its Rayleigh mean-resultant vector and a significant Watson-Williams test comparing mean directions — plus a third, timed activity series wired as a value-radius clock (point radius = value) with its amplitude-weighted acrophase vector.',
		build(mk) {
			const rng = mulberry32(8);
			// Untimed groups: raw onset phases, tightly clustered ~12 h apart → significant WW.
			const groupA = seq(18, () => 7 + normal(rng, 0, 0.6));
			const groupB = seq(18, () => 19 + normal(rng, 0, 0.6));
			const aId = mk.col('Group A phase', 'number', groupA);
			const bId = mk.col('Group B phase', 'number', groupB);
			// Timed series: 3 days hourly activity peaking near hour 7 → value-radius clock,
			// weighted acrophase ≈ 7 h. Not part of the Watson-Williams comparison (that test
			// is for untimed, unweighted event angles — see the plot's `ww` derived).
			const hours = Array.from({ length: 24 * 3 }, (_, i) => i);
			const activity = hours.map((h) =>
				Math.max(0, 20 + 40 * Math.cos((2 * Math.PI * (h - 7)) / 24) + normal(rng, 0, 6))
			);
			const t = mk.col('hour', 'number', hours);
			const v = mk.col('activity', 'number', activity);

			const p = new Plot({ name: 'Circular phase plot', type: 'circularphase' });
			p.plot.addData({ values: { refId: aId }, label: 'Group A (untimed, ~7h)' });
			p.plot.addData({ values: { refId: bId }, label: 'Group B (untimed, ~19h)' });
			p.plot.addData({ time: { refId: t }, values: { refId: v }, label: 'Activity (timed)' });
			p.plot.showWatsonWilliams = true;
			pushObj(p);
		}
	},
	{
		id: 'actogram-rhythm',
		name: 'Actogram — multi-day activity',
		family: 'Plots',
		description: 'Actogram of a noisy ~24 h rhythm over 7 days (hourly samples).',
		build(mk) {
			const rng = mulberry32(4);
			const hours = Array.from({ length: 24 * 7 }, (_, i) => i);
			const activity = hours.map((h) =>
				Math.max(0, 60 * Math.sin((2 * Math.PI * h) / 24 - Math.PI / 2) + normal(rng, 10, 8))
			);
			const t = mk.col('hour', 'number', hours);
			const v = mk.col('activity', 'number', activity);
			mk.plot('actogram', 'Activity actogram', { time: t, values: v });
		}
	},
	{
		id: 'periodogram-rhythm',
		name: 'Periodogram — period detection',
		family: 'Plots',
		description: 'Lomb–Scargle periodogram of a ~24 h rhythm (7 days, hourly).',
		build(mk) {
			const rng = mulberry32(5);
			const hours = Array.from({ length: 24 * 7 }, (_, i) => i);
			const activity = hours.map(
				(h) => 50 + 40 * Math.sin((2 * Math.PI * h) / 24) + normal(rng, 0, 6)
			);
			const t = mk.col('hour', 'number', hours);
			const v = mk.col('activity', 'number', activity);
			mk.plot('periodogram', 'Activity periodogram', { time: t, values: v });
		}
	},
	{
		id: 'correlogram-rhythm',
		name: 'Correlogram — autocorrelation',
		family: 'Plots',
		description: 'Autocorrelogram of a ~24 h rhythm (7 days, hourly).',
		build(mk) {
			const rng = mulberry32(6);
			const hours = Array.from({ length: 24 * 7 }, (_, i) => i);
			const activity = hours.map(
				(h) => 50 + 40 * Math.cos((2 * Math.PI * h) / 24) + normal(rng, 0, 6)
			);
			const t = mk.col('hour', 'number', hours);
			const v = mk.col('activity', 'number', activity);
			mk.plot('correlogram', 'Activity correlogram', { time: t, values: v });
		}
	},
	{
		id: 'fft-rhythm',
		name: 'FFT — frequency spectrum',
		family: 'Plots',
		description: 'Fourier spectrum of a 12 h + 24 h composite rhythm (8 days, hourly).',
		build(mk) {
			const rng = mulberry32(7);
			const hours = Array.from({ length: 24 * 8 }, (_, i) => i);
			const activity = hours.map(
				(h) =>
					50 +
					30 * Math.sin((2 * Math.PI * h) / 24) +
					15 * Math.sin((2 * Math.PI * h) / 12) +
					normal(rng, 0, 4)
			);
			const t = mk.col('hour', 'number', hours);
			const v = mk.col('signal', 'number', activity);
			mk.plot('fft', 'Signal FFT', { time: t, values: v });
		}
	},
	{
		id: 'table-columns',
		name: 'Table — raw columns',
		family: 'Plots',
		description: 'A tableplot listing an hour index alongside two derived signals.',
		build(mk) {
			const hours = Array.from({ length: 48 }, (_, i) => i);
			const a = hours.map((h) => Math.round(50 + 40 * Math.sin((2 * Math.PI * h) / 24)));
			const b = hours.map((h) => Math.round(20 + 10 * Math.cos((2 * Math.PI * h) / 24)));
			const hId = mk.col('hour', 'number', hours);
			const aId = mk.col('signalA', 'number', a);
			const bId = mk.col('signalB', 'number', b);
			mk.plot('tableplot', 'Signal table', { columnRefs: [hId, aId, bId] });
		}
	}
];

/**
 * WORKFLOW templates: canonical multi-node pipelines from the chronobiology
 * literature, shipped as ready-to-open starting points (as opposed to the
 * single-node reference demos above). Each `build` is ASYNC because it awaits
 * the analysis nodes so their outputs are baked into the saved session.
 *
 * Note text lives in nodeNotes.js under `workflow-<id>`.
 */
const WORKFLOWS = [
	{
		id: 'rest-activity',
		name: 'Workflow — actigraphy rest-activity profile',
		family: 'Workflows',
		description:
			'Characterise a rest-activity record without assuming a sine shape. Nonparametric RA reports IS / IV / RA / M10 / L5 per subject (one value per y-input, so each port is that group’s distribution), a Cosinor adds the model-based amplitude and acrophase, an actogram shows a consolidated vs a fragmented subject, and Compare groups tests whether rhythm robustness (RA) differs.',
		showcases: ['NonparametricRA', 'Cosinor', 'GroupComparison', 'actogram'],
		async build() {
			const rng = mulberry32(21);
			const N_SUBJECTS = 6;
			const DAYS = 7;
			const hours = seq(24 * DAYS, (i) => i);
			const hoursId = mkCol('number', hours, 'hour');

			// Two contrasting rest-activity phenotypes, hourly epochs.
			//  • consolidated: a solid 08:00-18:00 active block, quiet nights
			//    → IS high, IV low, RA near 1.
			//  • fragmented: weaker daytime block, frequent dropouts and night-time
			//    bouts → IS lower, IV higher, RA lower.
			const makeSubjects = (label, consolidated) =>
				seq(N_SUBJECTS, (s) => {
					const values = hours.map((h) => {
						const tod = h % 24;
						const awake = tod >= 8 && tod < 18;
						if (consolidated) {
							return awake
								? Math.max(0, 85 + normal(rng, 0, 8))
								: Math.max(0, 2 + normal(rng, 0, 2));
						}
						// Fragmented: daytime naps (random dropouts) + night-time bouts.
						const nap = rng() < 0.3;
						const nightBout = rng() < 0.35;
						if (awake) return Math.max(0, (nap ? 12 : 45) + normal(rng, 0, 12));
						return Math.max(0, (nightBout ? 28 : 4) + normal(rng, 0, 6));
					});
					return mkCol('number', values, `${label}${s + 1}`);
				});
			const consolidatedIds = makeSubjects('Consolidated', true);
			const fragmentedIds = makeSubjects('Fragmented', false);

			// --- Step 1: nonparametric RA per group. The metric ports emit one
			// value per subject → each port IS that group's distribution.
			const npcra = async (name, yIds, tag) => {
				const tp = new TableProcess(
					{
						name: 'NonparametricRA',
						args: {
							xIN: hoursId,
							yIN: [...yIds],
							epochHours: 1,
							period: 24,
							mWindow: 10,
							lWindow: 5,
							// Seed the metric keys we consume (see the Cosinor note below).
							out: { IS: -1, IV: -1, RA: -1, M10: -1, L5: -1 }
						}
					},
					null
				);
				tp.displayName = `Nonparametric RA — ${name}`;
				pushObj(tp);
				await tp.doProcess();
				const nameCol = (id, n) => {
					const c = core.data.find((cc) => cc.id === id);
					if (c) c.customName = n;
				};
				for (const k of ['IS', 'IV', 'RA', 'M10', 'L5']) nameCol(tp.args.out[k], `${tag} ${k}`);
				return tp;
			};
			const npA = await npcra('consolidated', consolidatedIds, 'Consolidated');
			const npB = await npcra('fragmented', fragmentedIds, 'Fragmented');

			// --- Step 2: model-based view alongside the nonparametric one.
			const cos = new TableProcess(
				{
					name: 'Cosinor',
					args: {
						xIN: hoursId,
						yIN: [...consolidatedIds, ...fragmentedIds],
						Ncurves: 1,
						useFixedPeriod: true,
						fixedPeriod: 24,
						nHarmonics: 1,
						outputX: -1,
						out: { cosinorx: -1, amplitude: -1, acrophase: -1 }
					}
				},
				null
			);
			cos.displayName = 'Cosinor — amplitude + acrophase';
			pushObj(cos);
			await cos.doProcess();

			// --- Step 3: does rhythm robustness differ? Two RA columns, no group
			// column → Compare groups treats each column as one group.
			const gc = new TableProcess(
				{
					name: 'GroupComparison',
					args: {
						xIN: -1,
						yIN: [npA.args.out.RA, npB.args.out.RA],
						method: 'auto',
						alpha: 0.05,
						postHocEnabled: true,
						out: { statistic: -1, pvalue: -1 }
					}
				},
				null
			);
			gc.displayName = 'Compare groups — RA';
			pushObj(gc);
			await gc.doProcess();

			// Actogram: one representative subject per phenotype, so the numbers
			// have a picture.
			const acto = new Plot({ name: 'Representative actograms', type: 'actogram' });
			acto.plot.addData({ time: { refId: hoursId }, values: { refId: consolidatedIds[0] } });
			acto.plot.addData({ time: { refId: hoursId }, values: { refId: fragmentedIds[0] } });
			if (acto.plot.data[1]) acto.plot.data[1].colour = '#bf796b91';
			pushObj(acto);

			tablePlot('Rest-activity metrics', [
				npA.args.out.IS,
				npA.args.out.IV,
				npA.args.out.RA,
				npB.args.out.IS,
				npB.args.out.IV,
				npB.args.out.RA,
				gc.args.out.pvalue
			]);
		}
	},
	{
		id: 'free-running',
		name: 'Workflow — free-running period',
		family: 'Workflows',
		description:
			'Measure the endogenous period (tau) of a rhythm running without a zeitgeber. A double-plotted actogram shows the rhythm drifting against the 24 h grid, a Lomb-Scargle periodogram estimates tau, and the Rhythmicity Analysis node reports the peak period as a wireable number. Includes the literature caveat to avoid the chi-square periodogram.',
		showcases: ['RhythmicityAnalysis', 'actogram', 'periodogram'],
		async build() {
			const rng = mulberry32(31);
			const TAU = 24.8; // endogenous period, h — drifts ~0.8 h/day vs a 24 h grid
			const DAYS = 14;
			const hours = seq(24 * DAYS, (i) => i);
			// Free-running locomotor activity: active during the subjective day of
			// its OWN tau, so the band drifts steadily against clock time.
			const activity = hours.map((h) => {
				const phase = (h % TAU) / TAU; // 0..1 within the endogenous cycle
				const active = phase < 0.42;
				return Math.max(0, (active ? 75 : 3) + normal(rng, 0, active ? 12 : 3));
			});
			const hoursId = mkCol('number', hours, 'hour');
			const actId = mkCol('number', activity, 'activity');

			// Step 1: the diagnostic view — double-plotted against a 24 h grid, so
			// tau != 24 shows as a drifting band.
			const acto = new Plot({ name: 'Actogram (double-plotted)', type: 'actogram' });
			acto.plot.addData({ time: { refId: hoursId }, values: { refId: actId } });
			acto.plot.periodHrs = 24;
			acto.plot.doublePlot = 2;
			pushObj(acto);

			// Step 2: the numeric estimate — Lomb-Scargle over a 20-28 h window.
			const pg = new Plot({ name: 'Lomb-Scargle periodogram', type: 'periodogram' });
			pg.plot.addData({ time: { refId: hoursId }, values: { refId: actId } });
			pg.plot.periodlimsIN = [20, 28];
			pg.plot.periodSteps = 0.05;
			pushObj(pg);

			// Step 3: the peak as a wireable number (the plot draws the spectrum;
			// this node emits the value other nodes can consume).
			const ra = new TableProcess(
				{
					name: 'RhythmicityAnalysis',
					args: {
						xIN: hoursId,
						yIN: [actId],
						analysis: 'periodogram',
						pgMethod: 'Lomb-Scargle',
						periodMin: 20,
						periodMax: 28,
						periodStep: 0.05,
						pgBinSize: 0.25,
						pgAlpha: 0.05,
						preProcesses: [],
						// Seed the stat_* metric keys we consume.
						out: { stat_peak_period: -1, stat_peak_power: -1 }
					}
				},
				null
			);
			ra.displayName = 'Rhythmicity Analysis — periodogram';
			pushObj(ra);
			await ra.doProcess();
			const nameCol = (id, n) => {
				const c = core.data.find((cc) => cc.id === id);
				if (c) c.customName = n;
			};
			nameCol(ra.args.out.stat_peak_period, 'Peak period (h)');
			nameCol(ra.args.out.stat_peak_power, 'Peak power');

			tablePlot('Free-running period', [ra.args.out.stat_peak_period, ra.args.out.stat_peak_power]);
		}
	},
	{
		id: 'phase-groups',
		name: 'Workflow — group phase comparison',
		family: 'Workflows',
		description:
			'Do two groups peak at different times of day? Per-subject phase is extracted by Cosinor (its acrophase port emits one peak time per subject, i.e. the group’s phase distribution), shown on a 24 h circular plot with each group’s Rayleigh vector, and tested with Rayleigh (is each group clustered?) plus Watson-Williams (do the groups differ in mean phase?).',
		showcases: ['Cosinor', 'RayleighTest', 'circularphase'],
		async build() {
			const rng = mulberry32(11);
			const N_SUBJECTS = 8;
			const DAYS = 4;
			// Shared sampling grid: hourly over 4 days — comfortably above the
			// >=2 samples/h x >=2 cycles design floor for a 24 h rhythm.
			const hours = seq(24 * DAYS, (i) => i);
			const hoursId = mkCol('number', hours, 'hour');

			// Two groups of subjects, each a noisy 24 h rhythm. Group A peaks near
			// 08:00, group B near 14:00 — a 6 h phase shift with realistic
			// between-subject scatter, so Rayleigh is significant within each group
			// and Watson-Williams separates them.
			const makeGroup = (label, peakHr, jitterSd) =>
				seq(N_SUBJECTS, (s) => {
					const subjectPeak = peakHr + normal(rng, 0, jitterSd);
					const values = hours.map(
						(h) => 60 + 35 * Math.cos((2 * Math.PI * (h - subjectPeak)) / 24) + normal(rng, 0, 5)
					);
					return mkCol('number', values, `${label}${s + 1}`);
				});
			const groupAIds = makeGroup('A', 8, 0.8);
			const groupBIds = makeGroup('B', 14, 0.8);

			// --- Step 1: extract phase. One Cosinor per group. The scalar metric
			// ports emit one value per Y input, so `acrophase` IS the group's
			// per-subject phase column.
			const fitGroup = async (name, yIds) => {
				const tp = new TableProcess(
					{
						name: 'Cosinor',
						args: {
							xIN: hoursId,
							yIN: [...yIds],
							Ncurves: 1,
							useFixedPeriod: true,
							fixedPeriod: 24,
							nHarmonics: 1,
							outputX: -1,
							// Seed the metric out-keys we consume. The TableProcess
							// constructor mints one column per key present in `out`;
							// the rest are normally added by the node component's
							// onMount reconcile, which never runs in this headless
							// generator — so `acrophase` must be requested here.
							out: { cosinorx: -1, acrophase: -1 }
						}
					},
					null
				);
				tp.displayName = name;
				pushObj(tp);
				await tp.doProcess();
				return tp;
			};
			const cosA = await fitGroup('Cosinor — group A', groupAIds);
			const cosB = await fitGroup('Cosinor — group B', groupBIds);
			const acroA = cosA.args.out.acrophase;
			const acroB = cosB.args.out.acrophase;
			const nameCol = (id, n) => {
				const c = core.data.find((cc) => cc.id === id);
				if (c) c.customName = n;
			};
			nameCol(acroA, 'Group A acrophase');
			nameCol(acroB, 'Group B acrophase');

			// --- Step 2: circular plot. Each group's acrophases on a 24 h clock.
			const cp = new Plot({ name: 'Phase by group', type: 'circularphase' });
			cp.plot.addData({ values: { refId: acroA }, label: 'Group A (~8 h)' });
			cp.plot.addData({ values: { refId: acroB }, label: 'Group B (~14 h)' });
			cp.plot.showWatsonWilliams = true;
			pushObj(cp);

			// --- Step 3: the statistics. Rayleigh always runs (per group);
			// Watson-Williams compares the two mean directions.
			const rt = new TableProcess(
				{
					name: 'RayleighTest',
					args: {
						yIN: [acroA, acroB],
						timeIN: -1,
						unit: 'hours',
						period: 24,
						showWatsonWilliams: true,
						// Seed every metric out-key (see the Cosinor note above):
						// R/z/pvalue are per-group Rayleigh, F/ww_pvalue the single
						// Watson-Williams result.
						out: { R: -1, z: -1, pvalue: -1, F: -1, ww_pvalue: -1, acrophase: -1 }
					}
				},
				null
			);
			rt.displayName = 'Rayleigh + Watson-Williams';
			pushObj(rt);
			await rt.doProcess();

			// Read the headline numbers into a table so the session opens with the
			// answer visible, not just the plot.
			tablePlot('Circular statistics', [
				rt.args.out.R,
				rt.args.out.pvalue,
				rt.args.out.F,
				rt.args.out.ww_pvalue
			]);
		}
	}
];

// Reset core to a clean slate between demos.
function resetCore() {
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.notes = [];
	core.nodeNotes = {};
	core.orphanProcesses = [];
	core.storedValues = {};
	core.rawData = new Map();
	// Clear the baked workflow layout too, so a note's reserve-a-lane placement
	// (addDemoNote) never carries a previous demo's node/note positions forward.
	core.nodeLayout = {};
}

const resolve = (d) => (typeof d === 'function' ? d() : d);

// Column auto-ids share the global Column counter, so columns created here never
// collide with output columns the TableProcess constructor allocates.
function mkCol(type, values, name) {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	if (type === 'time') c.timeFormat = 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]';
	core.data.push(c);
	return c.id;
}

function setAxisLabels(p, axes) {
	if (!axes) return;
	// Axis objects vary by plot type (scatter has xAxis/yAxisLeft; others differ).
	if (axes.x != null && p.plot.xAxis) p.plot.xAxis.label = axes.x;
	if (axes.y != null && p.plot.yAxisLeft) p.plot.yAxisLeft.label = axes.y;
	if (axes.y != null && !p.plot.yAxisLeft && p.plot.yAxis) p.plot.yAxis.label = axes.y;
}

// Build a scatterplot from explicit series. Each series:
//   { x, y, label, kind: 'points'|'line', colour }
function scatterPlot(name, series, axes) {
	const p = new Plot({ name, type: 'scatterplot' });
	for (const s of series) {
		const isLine = s.kind === 'line';
		p.plot.addData({
			x: { refId: s.x },
			y: { refId: s.y },
			label: s.label,
			line: { colour: s.colour, draw: isLine, strokeWidth: isLine ? 2.5 : 2, stroke: 'solid' },
			points: { colour: s.colour, draw: !isLine, radius: 3, shape: 'circle' }
		});
	}
	setAxisLabels(p, axes);
	pushObj(p);
	return p;
}

function tablePlot(name, columnRefs) {
	const p = new Plot({ name, type: 'tableplot' });
	p.plot.columnRefs = [...columnRefs];
	p.plot.showCol = columnRefs.map(() => true);
	pushObj(p);
	return p;
}

// Pre-set customName on referencial plot-wrapper columns so the `name` $derived
// short-circuits instead of mutating state during serialization (the app builds
// in production where that DEV-only guard is off; the generator runs under DEV).
function prewarmWrapperNames() {
	for (const plot of core.plots) {
		for (const series of plot.plot?.data ?? []) {
			for (const field of ['x', 'y', 'column', 'time', 'values']) {
				const w = series?.[field];
				if (w && typeof w === 'object' && 'refId' in w && w.customName == null) {
					const real = core.data.find((c) => c.id === w.refId);
					w.customName = real ? `${real.name}` : 'col';
				}
			}
		}
	}
}

// Build one searchable manifest entry. `keywords` collapses everything a user
// might type (display name, family, description, showcased node) so the modal
// search behaves like the node palette.
function manifestEntry({ id, name, family, description, file, kind, showcases }) {
	return {
		id,
		name,
		family,
		description,
		url: `sessions/demos/${file}`,
		kind,
		showcases,
		keywords: [name, description, family, ...showcases].filter(Boolean).join(' ').toLowerCase()
	};
}

describe.runIf(process.env.GEN_DEMOS)('generate demo sessions', () => {
	it('writes demo JSON + index.json', async () => {
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();
		appConsts.tableProcessMap = await loadTableProcesses();

		const manifest = [...DATASETS]; //make sure not to lose datasets
		const write = (file, entry) => {
			writeFileSync(join(OUT_DIR, file), outputCoreAsJson(), 'utf8');
			manifest.push(entry);
		};

		// --- Workflow templates (canonical multi-node pipelines) -------------
		// Written with kind 'workflow' so the gallery lists them as their own
		// "Workflows" family and the per-kind node-coverage assertions in
		// demos.validate.test.js (which require an EXACT match against the
		// process / tableProcess registries) stay driven by the single-node
		// reference demos below.
		for (const wf of WORKFLOWS) {
			resetCore();
			await wf.build();
			addDemoNote(`workflow-${wf.id}`);
			prewarmWrapperNames();
			const file = `demo-workflow-${wf.id}.json`;
			write(
				file,
				manifestEntry({
					id: `workflow-${wf.id}`,
					name: wf.name,
					family: wf.family,
					description: wf.description,
					file,
					kind: 'workflow',
					showcases: wf.showcases
				})
			);
		}

		// --- Plot demos (hand-crafted, richer narrative) ---------------------
		for (const demo of DEMOS) {
			resetCore();
			const mk = {
				col: (name, type, values) => mkCol(type, values, name),
				plot(type, name, inputs, axes) {
					const p = new Plot({ name, type });
					if (type === 'tableplot') {
						p.plot.columnRefs = [...(inputs.columnRefs ?? [])];
						p.plot.showCol = p.plot.columnRefs.map(() => true);
					} else {
						const data = {};
						for (const [k, colId] of Object.entries(inputs)) data[k] = { refId: colId };
						p.plot.addData(data);
						setAxisLabels(p, axes);
					}
					pushObj(p);
					return p;
				}
			};
			demo.build(mk);
			// Explanatory note for the showcased plot type (first non-facet plot).
			const showcasedType = core.plots.find((p) => p.facetParent == null)?.type;
			if (showcasedType) addDemoNote(showcasedType);
			prewarmWrapperNames();
			write(
				`demo-${demo.id}.json`,
				manifestEntry({
					id: demo.id,
					name: demo.name,
					family: demo.family,
					description: demo.description,
					file: `demo-${demo.id}.json`,
					kind: 'plot',
					showcases: [...new Set(core.plots.map((p) => p.type))]
				})
			);
		}

		// --- Column-process demos -------------------------------------------
		// Every process demo is built the same way (Sequence x + one y source →
		// process node → result, with a Before/After scatter + a table). See
		// buildProcessDemo in nodeDemoBuilders.js.
		for (const spec of PROCESS_SPECS) {
			resetCore();
			const entry = appConsts.processMap.get(spec.name);
			const display = entry?.displayName ?? spec.name;
			await buildProcessDemo(spec, display);
			const file = `demo-process-${spec.name.toLowerCase()}.json`;
			write(
				file,
				manifestEntry({
					id: `process-${spec.name.toLowerCase()}`,
					name: display,
					family: entry?.family ?? 'Other',
					description:
						entry?.description || `Showcases the ${spec.name} process applied to sample data.`,
					file,
					kind: 'process',
					showcases: [spec.name]
				})
			);
		}

		// --- Analysis (table-process) demos ----------------------------------
		// Analysis TPs (fits + windowed/scalar) get a Sequence x + y → node shape
		// with a scatter + table; other TPs keep their natural viz. All get a tidy
		// baked layout. See buildTPDemo in nodeDemoBuilders.js.
		for (const spec of TP_SPECS) {
			resetCore();
			const entry = appConsts.tableProcessMap.get(spec.name);
			const display = entry?.displayName ?? spec.name;
			await buildTPDemo(spec, entry, display);
			const file = `demo-tp-${spec.name.toLowerCase()}.json`;
			write(
				file,
				manifestEntry({
					id: `tp-${spec.name.toLowerCase()}`,
					name: display,
					family: entry?.family ?? 'Other',
					description: entry?.description || `Showcases the ${spec.name} analysis on sample data.`,
					file,
					kind: 'tableProcess',
					showcases: [spec.name]
				})
			);
		}

		// Order the gallery like the palette (Sources → … → Plots), keeping each
		// family's members in their generation order.
		manifest.sort((a, b) => familyRank(a.family) - familyRank(b.family));

		const index = { version: 1, count: manifest.length, sessions: manifest };
		writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
		// eslint-disable-next-line no-console
		console.log(`GENERATED ${manifest.length} demos -> ${OUT_DIR}`);
	});
});
