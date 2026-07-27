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
import { layoutWorkspacePlots } from '$lib/core/workspaceLayout.js';
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
		group: 'Sample data',
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
		id: 'cwt-period-change',
		name: 'Wavelet — a period that changes',
		family: 'Plots',
		description:
			'A scalogram of a signal that runs at 24 h for the first half of the record and 12 h for the second. A periodogram would show both peaks and say nothing about when each applied; the wavelet transform localises them in time. The dashed cone of influence marks the edges, where the transform runs out of data and the values are artefacts.',
		build(mk) {
			const rng = mulberry32(11);
			const dtHrs = 0.5;
			const n = 2 * 24 * 20; // 20 days at 30-minute sampling, uniformly spaced
			const hours = Array.from({ length: n }, (_, i) => i * dtHrs);
			const activity = hours.map((h) => {
				const period = h < (n * dtHrs) / 2 ? 24 : 12;
				return 50 + 30 * Math.sin((2 * Math.PI * h) / period - Math.PI / 2) + normal(rng, 0, 4);
			});
			const xId = mk.col('hour', 'number', hours);
			const yId = mk.col('activity', 'number', activity);
			mk.plot('cwt', 'Wavelet scalogram', { x: xId, y: yId });
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
		id: 'correlationheatmap-matrix',
		name: 'Correlation heatmap',
		family: 'Plots',
		description:
			'Self-contained correlation matrix of four variables — wire the raw columns and it computes and colours the pairwise correlations itself.',
		build(mk) {
			// Four correlated series (24 hourly points) so the matrix shows a range of r.
			const rng = mulberry32(11);
			const n = 24;
			const base = Array.from({ length: n }, (_, h) => Math.sin((2 * Math.PI * h) / 24));
			const sleep = base.map((b) => 50 - 30 * b + normal(rng, 0, 5));
			const activity = base.map((b) => 50 + 30 * b + normal(rng, 0, 5));
			const light = base.map((b) => 40 + 20 * b + normal(rng, 0, 8));
			const temp = Array.from({ length: n }, (_, h) => 36 + 0.5 * h + normal(rng, 0, 0.3));
			const ids = [
				mk.col('sleep', 'number', sleep),
				mk.col('activity', 'number', activity),
				mk.col('light', 'number', light),
				mk.col('temp', 'number', temp)
			];
			const p = mk.plot('correlationheatmap', 'Correlation matrix', { column: ids[0] });
			ids.slice(1).forEach((id) => p.plot.addData({ column: { refId: id } }));
		}
	},
	{
		id: 'pairsplot-matrix',
		name: 'Pairs plot',
		family: 'Plots',
		description:
			'Scatterplot matrix of four variables: histograms on the diagonal, scatter + linear fit above, correlation colour below.',
		build(mk) {
			const rng = mulberry32(12);
			const n = 40;
			const base = Array.from({ length: n }, (_, h) => Math.sin((2 * Math.PI * h) / 24));
			const sleep = base.map((b) => 50 - 30 * b + normal(rng, 0, 6));
			const activity = base.map((b) => 50 + 30 * b + normal(rng, 0, 6));
			const light = base.map((b) => 40 + 20 * b + normal(rng, 0, 9));
			const temp = Array.from({ length: n }, (_, h) => 36 + 0.4 * h + normal(rng, 0, 0.4));
			const ids = [
				mk.col('sleep', 'number', sleep),
				mk.col('activity', 'number', activity),
				mk.col('light', 'number', light),
				mk.col('temp', 'number', temp)
			];
			const p = mk.plot('pairsplot', 'Pairs matrix', { column: ids[0] });
			ids.slice(1).forEach((id) => p.plot.addData({ column: { refId: id } }));
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
		summary: 'Characterise a rest-activity record without assuming a sine shape.',
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
		summary: 'Measure the endogenous period (tau) of a rhythm with no zeitgeber.',
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
		summary: 'Test whether two groups peak at different times of day.',
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
	},

	// ==========================================================================
	// General-statistics workflow templates (discipline-neutral). Each follows the
	// same arc — explore → check assumptions → test/model → visualise → interpret.
	// Analysis nodes that return a result table (DescribeData, NormalityTest,
	// Correlation, ChiSquared, LogisticRegression) write their output columns when
	// the component mounts on LOAD; the demo bakes the wiring and those columns fill
	// when the session opens (same as the single-node demos). Metric/fit ports
	// (GroupComparison statistic/pvalue, TrendFit r2/coef/resid) are written by the
	// func at build time. `RAW`/`FIT` are the app's raw/fitted series colours.
	// ==========================================================================
	{
		id: 'stats-eda',
		summary: 'Get to know a new dataset before running any test.',
		name: 'Workflow — exploratory data analysis (first look)',
		family: 'Workflows',
		description:
			'The universal first pass over a new dataset. Describe Data reports centre / spread / skew, a normality test screens each variable, and a correlation matrix maps the relationships — visualised as faceted histograms, a correlation heatmap and a pairs plot. Read the distributions and the relationship map BEFORE running any inferential test.',
		showcases: ['DescribeData', 'NormalityTest', 'Correlation', 'histogram'],
		async build() {
			const rng = mulberry32(101);
			const N = 80;
			const height = seq(N, () => 170 + normal(rng, 0, 8)); // roughly normal
			const weight = height.map((h) => 0.9 * (h - 170) + 65 + normal(rng, 0, 5)); // correlated with height
			const income = seq(N, () => Math.round(Math.exp(normal(rng, 3.4, 0.5)))); // right-skewed
			const noise = seq(N, () => normal(rng, 0, 1)); // independent
			const ids = [
				mkCol('number', height, 'height'),
				mkCol('number', weight, 'weight'),
				mkCol('number', income, 'income'),
				mkCol('number', noise, 'noise')
			];

			const describeKeys = [
				'variable',
				'n',
				'mean',
				'median',
				'sd',
				'min',
				'max',
				'range',
				'q1',
				'q3',
				'iqr',
				'skewness',
				'kurtosis'
			];
			const describe = new TableProcess(
				{
					name: 'DescribeData',
					args: { yIN: [...ids], out: Object.fromEntries(describeKeys.map((k) => [k, -1])) }
				},
				null
			);
			describe.displayName = 'Describe data';
			pushObj(describe);
			await describe.doProcess();

			const norm = new TableProcess(
				{
					name: 'NormalityTest',
					args: {
						yIN: [...ids],
						method: 'shapiro',
						alpha: 0.05,
						out: { variable: -1, statistic: -1, pvalue: -1, n: -1, normal: -1 }
					}
				},
				null
			);
			norm.displayName = 'Normality test';
			pushObj(norm);
			await norm.doProcess();

			const corr = new TableProcess(
				{
					name: 'Correlation',
					args: {
						yIN: [...ids],
						method: 'auto',
						alpha: 0.05,
						out: { var_i: -1, var_j: -1, r: -1, pvalue: -1, n: -1 }
					}
				},
				null
			);
			corr.displayName = 'Correlation matrix';
			pushObj(corr);
			await corr.doProcess();

			const hist = new Plot({ name: 'Distributions', type: 'histogram' });
			for (const id of ids) hist.plot.addData({ column: { refId: id } });
			hist.facet = true; // one small-multiple histogram per variable
			pushObj(hist);

			const heat = new Plot({ name: 'Correlation heatmap', type: 'correlationheatmap' });
			for (const id of ids) heat.plot.addData({ column: { refId: id } });
			pushObj(heat);

			const pairs = new Plot({ name: 'Pairs plot', type: 'pairsplot' });
			for (const id of ids) pairs.plot.addData({ column: { refId: id } });
			pushObj(pairs);

			tablePlot(
				'Summary statistics',
				['variable', 'mean', 'sd', 'skewness', 'kurtosis'].map((k) => describe.args.out[k])
			);
			tablePlot(
				'Normality',
				['variable', 'statistic', 'pvalue', 'normal'].map((k) => norm.args.out[k])
			);
		}
	},
	{
		id: 'stats-two-group',
		summary: 'Is group A different from group B?',
		name: 'Workflow — compare two groups',
		family: 'Workflows',
		description:
			'The classic two-group question: is the treatment different from control? Compare groups auto-selects the test (Welch t when both groups look normal, Mann-Whitney when they do not) and surfaces the assumption check, and a boxplot with a significance bar shows the difference. Read: which test fired and why, the p-value, and the direction/size of the shift.',
		showcases: ['GroupComparison', 'boxplot'],
		async build() {
			const rng = mulberry32(102);
			const n = 45;
			const groups = [];
			const values = [];
			for (let i = 0; i < n; i++) {
				groups.push('Control');
				values.push(100 + normal(rng, 0, 14));
			}
			for (let i = 0; i < n; i++) {
				groups.push('Treatment');
				values.push(111 + normal(rng, 0, 14));
			}
			const groupId = mkCol('category', groups, 'group');
			const valueId = mkCol('number', values, 'response');

			const gc = new TableProcess(
				{
					name: 'GroupComparison',
					args: {
						xIN: groupId,
						yIN: [valueId],
						method: 'auto',
						alpha: 0.05,
						postHocEnabled: true,
						out: { statistic: -1, pvalue: -1 }
					}
				},
				null
			);
			gc.displayName = 'Compare groups';
			pushObj(gc);
			await gc.doProcess();

			const box = new Plot({ name: 'Response by group', type: 'boxplot' });
			box.plot.addData({ x: { refId: groupId }, y: { refId: valueId } });
			box.plot.showSigBars = true;
			setAxisLabels(box, { x: 'Group', y: 'Response' });
			pushObj(box);

			tablePlot('Test result', [gc.args.out.statistic, gc.args.out.pvalue]);
		}
	},
	{
		id: 'stats-anova',
		summary: 'Do three or more groups differ, and which pairs?',
		name: 'Workflow — compare several groups (ANOVA)',
		family: 'Workflows',
		description:
			'Three or more conditions: do they differ, and which pairs? Compare groups auto-runs a one-way ANOVA (or Kruskal-Wallis if non-normal) with Tukey/Holm post-hoc, a mean ± SEM plot shows the group means, and a boxplot with significance bars shows the pairwise differences. Read the omnibus test FIRST; only interpret the pairwise grid if it is significant.',
		showcases: ['GroupComparison', 'meansem', 'boxplot'],
		async build() {
			const rng = mulberry32(103);
			const n = 30;
			const groups = [];
			const values = [];
			const means = { A: 50, B: 55, C: 62, D: 61 };
			for (const [label, m] of Object.entries(means)) {
				for (let i = 0; i < n; i++) {
					groups.push(label);
					values.push(m + normal(rng, 0, 7));
				}
			}
			const groupId = mkCol('category', groups, 'condition');
			const valueId = mkCol('number', values, 'measure');

			const gc = new TableProcess(
				{
					name: 'GroupComparison',
					args: {
						xIN: groupId,
						yIN: [valueId],
						method: 'auto',
						alpha: 0.05,
						postHocEnabled: true,
						out: { statistic: -1, pvalue: -1 }
					}
				},
				null
			);
			gc.displayName = 'One-way ANOVA + post-hoc';
			pushObj(gc);
			await gc.doProcess();

			const mean = new Plot({ name: 'Group means (± SEM)', type: 'meansem' });
			mean.plot.addData({ x: { refId: groupId }, y: { refId: valueId } });
			setAxisLabels(mean, { x: 'Condition', y: 'Measure' });
			pushObj(mean);

			const box = new Plot({ name: 'Measure by condition', type: 'boxplot' });
			box.plot.addData({ x: { refId: groupId }, y: { refId: valueId } });
			box.plot.showSigBars = true;
			setAxisLabels(box, { x: 'Condition', y: 'Measure' });
			pushObj(box);

			tablePlot('Omnibus test', [gc.args.out.statistic, gc.args.out.pvalue]);
		}
	},
	{
		id: 'stats-correlation',
		summary: 'Which variables move together, and how?',
		name: 'Workflow — correlation & relationships',
		family: 'Workflows',
		description:
			'What moves with what? Correlation computes every pairwise coefficient (auto-choosing Pearson vs Spearman by normality), shown as a heatmap and a pairs plot (scatter + linear fit above the diagonal, distributions on it). Read strength and direction, linear vs monotonic, and watch for multicollinearity — several strongly inter-correlated predictors.',
		showcases: ['Correlation', 'correlationheatmap', 'pairsplot'],
		async build() {
			const rng = mulberry32(104);
			const N = 70;
			const x1 = seq(N, () => normal(rng, 0, 1));
			const x2 = x1.map((v) => 0.85 * v + normal(rng, 0, 0.4)); // strong positive
			const x3 = x1.map((v) => -0.6 * v + normal(rng, 0, 0.7)); // moderate negative
			const x4 = seq(N, () => normal(rng, 0, 1)); // independent
			const x5 = x1.map((v) => Math.sign(v) * v * v + normal(rng, 0, 0.3)); // monotonic-ish (Spearman > Pearson)
			const ids = [
				mkCol('number', x1, 'x1'),
				mkCol('number', x2, 'x2'),
				mkCol('number', x3, 'x3'),
				mkCol('number', x4, 'x4'),
				mkCol('number', x5, 'x5')
			];

			const describe = new TableProcess(
				{
					name: 'DescribeData',
					args: { yIN: [...ids], out: { variable: -1, n: -1, mean: -1, sd: -1, skewness: -1 } }
				},
				null
			);
			describe.displayName = 'Describe data';
			pushObj(describe);
			await describe.doProcess();

			const corr = new TableProcess(
				{
					name: 'Correlation',
					args: {
						yIN: [...ids],
						method: 'auto',
						alpha: 0.05,
						out: { var_i: -1, var_j: -1, r: -1, pvalue: -1, n: -1 }
					}
				},
				null
			);
			corr.displayName = 'Correlation matrix';
			pushObj(corr);
			await corr.doProcess();

			const heat = new Plot({ name: 'Correlation heatmap', type: 'correlationheatmap' });
			for (const id of ids) heat.plot.addData({ column: { refId: id } });
			pushObj(heat);

			const pairs = new Plot({ name: 'Pairs plot', type: 'pairsplot' });
			for (const id of ids) pairs.plot.addData({ column: { refId: id } });
			pushObj(pairs);

			tablePlot(
				'Correlations',
				['var_i', 'var_j', 'r', 'pvalue'].map((k) => corr.args.out[k])
			);
		}
	},
	{
		id: 'stats-regression',
		summary: 'Predict Y from X, then check the model is honest.',
		name: 'Workflow — linear regression + residual diagnostics',
		family: 'Workflows',
		description:
			'Predict Y from X, then check the model is honest. Fit Trend Curves fits the line (slope, intercept, R²), the fitted line is overlaid on the data, and the residuals are plotted against X and screened for normality. The lesson: R² alone is not enough — structure in the residuals (a funnel or a curve) means the model is mis-specified even when R² looks high.',
		showcases: ['TrendFit', 'NormalityTest', 'scatterplot'],
		async build() {
			const rng = mulberry32(105);
			const RAW = '#234154';
			const FIT = '#BE796B';
			const N = 60;
			const x = seq(N, (i) => i * 0.5);
			const y = x.map((v) => 3 + 1.4 * v + normal(rng, 0, 6)); // linear + noise
			const xId = mkCol('number', x, 'x');
			const yId = mkCol('number', y, 'y');

			const tf = new TableProcess(
				{
					name: 'TrendFit',
					args: {
						xIN: xId,
						yIN: [yId],
						model: 'linear',
						polyDegree: 2,
						outputX: -1,
						// Seed the per-Y curve + residual keys so the constructor allocates them and the
						// func writes them at build time (fitted line + residuals are baked, not on-load).
						out: {
							trendx: -1,
							[`trendy_${yId}`]: -1,
							[`resid_${yId}`]: -1,
							r2: -1,
							rmse: -1,
							coef_slope: -1,
							coef_intercept: -1
						}
					}
				},
				null
			);
			tf.displayName = 'Fit linear trend';
			pushObj(tf);
			await tf.doProcess();
			const residId = tf.args.out[`resid_${yId}`];
			const trendyId = tf.args.out[`trendy_${yId}`];
			const trendxId = tf.args.out.trendx;

			const norm = new TableProcess(
				{
					name: 'NormalityTest',
					args: {
						yIN: [residId],
						method: 'shapiro',
						alpha: 0.05,
						out: { variable: -1, statistic: -1, pvalue: -1, n: -1, normal: -1 }
					}
				},
				null
			);
			norm.displayName = 'Residual normality';
			pushObj(norm);
			await norm.doProcess();

			scatterPlot(
				'Linear fit',
				[
					{ x: xId, y: yId, label: 'data', kind: 'points', colour: RAW },
					{ x: trendxId, y: trendyId, label: 'fit', kind: 'line', colour: FIT }
				],
				{ x: 'x', y: 'y' }
			);
			scatterPlot(
				'Residuals vs x',
				[{ x: xId, y: residId, label: 'residuals', kind: 'points', colour: FIT }],
				{ x: 'x', y: 'residual' }
			);
			tablePlot('Fit statistics', [
				tf.args.out.r2,
				tf.args.out.rmse,
				tf.args.out.coef_slope,
				tf.args.out.coef_intercept
			]);
		}
	},
	{
		id: 'stats-logistic',
		summary: 'Model a yes/no outcome and read the odds ratios.',
		name: 'Workflow — logistic regression (binary outcome)',
		family: 'Workflows',
		description:
			'Model a yes/no outcome from predictors. Logistic regression reports each predictor’s odds ratio with a 95% CI and a Wald p-value, plus McFadden pseudo-R² and a likelihood-ratio test. The fit plot shows the predicted probability against the linear predictor (the S-curve, for any number of predictors) with the observed outcomes overlaid. Watch for a non-convergence warning — it usually means separation.',
		showcases: ['LogisticRegression', 'scatterplot'],
		async build() {
			const RAW = '#234154';
			const FIT = '#BE796B';
			const N = 60;
			const x1 = seq(N, (i) => ((i * 7) % 11) + 1);
			const x2 = seq(N, (i) => ((i * 5) % 9) + 1);
			const y = seq(N, (i) => {
				const base = 0.6 * x1[i] - 0.5 * x2[i] - 1 > 0 ? 1 : 0;
				return i % 7 === 0 ? 1 - base : base; // inject noise → non-separable, converges
			});
			const x1Id = mkCol('number', x1, 'dose');
			const x2Id = mkCol('number', x2, 'age_group');
			const yId = mkCol('number', y, 'responded');

			const lr = new TableProcess(
				{
					name: 'LogisticRegression',
					args: {
						yIN: yId,
						xIN: [x1Id, x2Id],
						out: Object.fromEntries(
							[
								'term',
								'coef',
								'se',
								'z',
								'pvalue',
								'oddsRatio',
								'ciLow',
								'ciHigh',
								'outcome',
								'eta',
								'fitted'
							].map((k) => [k, -1])
						)
					}
				},
				null
			);
			lr.displayName = 'Logistic regression';
			pushObj(lr);
			await lr.doProcess();

			// fitted vs the linear predictor η, observed outcomes overlaid (fills on load).
			scatterPlot(
				'Logistic fit',
				[
					{
						x: lr.args.out.eta,
						y: lr.args.out.outcome,
						label: 'observed outcome',
						kind: 'points',
						colour: RAW
					},
					{
						x: lr.args.out.eta,
						y: lr.args.out.fitted,
						label: 'fitted P(y=1)',
						kind: 'points',
						colour: FIT
					}
				],
				{ x: 'linear predictor (η)', y: 'P(y=1)' }
			);
			tablePlot(
				'Coefficients',
				['term', 'coef', 'oddsRatio', 'pvalue'].map((k) => lr.args.out[k])
			);
		}
	},
	{
		id: 'stats-chi-square',
		summary: 'Are two categorical variables related?',
		name: 'Workflow — categorical association (chi-square)',
		family: 'Workflows',
		description:
			'Are two categorical variables related? The chi-squared test of independence cross-tabulates them into a contingency table and tests whether the row and column variables are associated (Yates’ correction on 2×2 tables). Read the statistic / df / p and the table; the node warns when any expected count falls below 5, where the χ² approximation breaks down and Fisher’s exact test is preferable.',
		showcases: ['ChiSquared'],
		async build() {
			const rng = mulberry32(106);
			const treatment = [];
			const outcome = [];
			// Drug improves the odds of "Improved" relative to Placebo → a real association.
			for (let i = 0; i < 120; i++) {
				const drug = i % 2 === 0;
				treatment.push(drug ? 'Drug' : 'Placebo');
				const pImproved = drug ? 0.65 : 0.4;
				outcome.push(rng() < pImproved ? 'Improved' : 'No change');
			}
			const tId = mkCol('category', treatment, 'treatment');
			const oId = mkCol('category', outcome, 'outcome');

			const chi = new TableProcess(
				{
					name: 'ChiSquared',
					args: {
						testType: 'independence',
						// 120 rows of tidy PAIRED data (one row per subject), so state it:
						// the node now defaults to independent groups.
						dataFormat: 'paired',
						xIN: tId,
						yIN: oId,
						correction: true,
						out: { statistic: -1, pvalue: -1, df: -1 }
					}
				},
				null
			);
			chi.displayName = 'Chi-squared (independence)';
			pushObj(chi);
			await chi.doProcess();

			tablePlot('Chi-squared result', [
				chi.args.out.statistic,
				chi.args.out.pvalue,
				chi.args.out.df
			]);
		}
	},
	{
		id: 'stats-fisher-exact',
		summary: 'A table too small for chi-squared.',
		name: "Workflow — small samples (Fisher's exact test)",
		family: 'Workflows',
		description:
			"The same question as the chi-squared workflow — are two categorical variables related? — but on a table small enough that chi-squared should not be trusted. Both tests are run on the SAME 18 animals so you can compare them directly. The chi-squared node reports its own warning that expected counts fall below 5, which is the conventional line at which its large-sample approximation stops being reliable; Fisher's exact test makes no such approximation, conditioning on the margins and summing the exact probability of every table at least as extreme as the one observed. Read the two p-values side by side: they answer the same question, and the exact one is the one to quote here. Note that Fisher's mode reports no statistic and no degrees of freedom — an exact test enumerates the distribution instead of referring a statistic to one — and gives the odds ratio as its effect size instead.",
		showcases: ['ChiSquared'],
		async build() {
			// Hand-built rather than sampled, so the table is EXACTLY [[8,1],[2,7]]:
			// n = 18, expected counts 5/4/5/4, so TWO fall below 5 and the chi-squared
			// node's own warning fires — which is the whole point of the demo. A
			// sampled version would drift and sometimes fail to show it. (An earlier
			// draft used [[9,3],[3,9]], where every expected count is 6 and the
			// warning never appears.)
			const treatment = [];
			const outcome = [];
			const add = (t, o, n) => {
				for (let i = 0; i < n; i++) {
					treatment.push(t);
					outcome.push(o);
				}
			};
			add('Treated', 'Entrained', 8);
			add('Treated', 'Free-running', 1);
			add('Control', 'Entrained', 2);
			add('Control', 'Free-running', 7);

			const tId = mkCol('category', treatment, 'group');
			const oId = mkCol('category', outcome, 'rhythm');

			const chi = new TableProcess(
				{
					name: 'ChiSquared',
					args: {
						testType: 'independence',
						dataFormat: 'paired',
						xIN: tId,
						yIN: oId,
						correction: true,
						out: { statistic: -1, pvalue: -1, df: -1, effectSize: -1 }
					}
				},
				null
			);
			chi.displayName = 'Chi-squared (approximate)';
			pushObj(chi);
			await chi.doProcess();

			const fisher = new TableProcess(
				{
					name: 'ChiSquared',
					args: {
						testType: 'fisher',
						dataFormat: 'paired',
						xIN: tId,
						yIN: oId,
						alternative: 'two-sided',
						out: { statistic: -1, pvalue: -1, df: -1, effectSize: -1 }
					}
				},
				null
			);
			fisher.displayName = "Fisher's exact (exact)";
			pushObj(fisher);
			await fisher.doProcess();

			tablePlot('Chi-squared vs Fisher (p-values)', [chi.args.out.pvalue, fisher.args.out.pvalue]);
		}
	},
	{
		id: 'stats-two-groups-counts',
		summary: 'Two independent groups, different sizes.',
		name: 'Workflow — comparing two independent groups (counts)',
		family: 'Workflows',
		description:
			'Two groups of DIFFERENT sizes, each with its own outcomes: 7 of 10 treated animals became arrhythmic against 2 of 25 controls. This is the layout categorical data usually arrives in, and it is not the paired one — there is no meaningful pairing between the third treated animal and the third control, and the columns are 10 and 25 rows long. The Chi-squared node\'s Input format is set to "Two independent groups", which tabulates each column separately and builds the 2x2 table [[7,3],[2,23]]. Read the p-value with Cramer\'s V beside it: the association is strong (V = 0.64), not merely detectable. A second node runs Fisher\'s exact test on the same data, which is the right choice here because two of the four expected counts fall below 5. Set Input format to "Paired" to see why it matters — the paired reading pairs rows arbitrarily, discards 25 of the 35 observations and reports p = 0.86, hiding a real effect entirely.',
		showcases: ['ChiSquared'],
		async build() {
			// Deliberately unequal columns — that is the whole point of the layout.
			const treated = [...Array(7).fill('arrhythmic'), ...Array(3).fill('rhythmic')];
			const control = [...Array(2).fill('arrhythmic'), ...Array(23).fill('rhythmic')];
			const tId = mkCol('category', treated, 'treated (n=10)');
			const cId = mkCol('category', control, 'control (n=25)');

			const chi = new TableProcess(
				{
					name: 'ChiSquared',
					args: {
						testType: 'independence',
						dataFormat: 'groups',
						xIN: tId,
						yIN: cId,
						correction: true,
						out: { statistic: -1, pvalue: -1, df: -1, effectSize: -1 }
					}
				},
				null
			);
			chi.displayName = 'Chi-squared (two groups)';
			pushObj(chi);
			await chi.doProcess();

			const fisher = new TableProcess(
				{
					name: 'ChiSquared',
					args: {
						testType: 'fisher',
						dataFormat: 'groups',
						xIN: tId,
						yIN: cId,
						alternative: 'two-sided',
						out: { statistic: -1, pvalue: -1, df: -1, effectSize: -1 }
					}
				},
				null
			);
			fisher.displayName = "Fisher's exact (two groups)";
			pushObj(fisher);
			await fisher.doProcess();

			tablePlot('Chi-squared vs Fisher', [
				chi.args.out.pvalue,
				chi.args.out.effectSize,
				fisher.args.out.pvalue
			]);
		}
	},
	{
		id: 'stats-anscombe',
		summary: 'Four datasets, identical statistics, four different stories.',
		name: 'Workflow — Anscombe’s quartet (always plot your data)',
		// Grouped with the interpretation demos, not the statistics ones: the statistics here are
		// beside the point, and the whole lesson is about how the output gets misread.
		group: 'Reading the output',
		family: 'Workflows',
		description:
			'Four small datasets constructed by Anscombe (1973) that share, to two decimals, the same mean and standard deviation of x and y, the same correlation (r = 0.82), and the same least-squares line (y = 3.00 + 0.50x, R² = 0.67). Describe Data confirms the summaries are identical and Fit Trend Curves confirms the regression line is the same for every set — yet the four scatterplots could hardly be more different: a genuine linear relationship, a smooth curve, a perfect line dragged off by a single outlier, and a vertical stack rescued only by one high-leverage point. The lesson is the oldest one in data analysis: look at the picture before you trust the number. The same summary statistics are consistent with wildly different data, so a plot is not decoration, it is part of the analysis.',
		showcases: ['DescribeData', 'TrendFit', 'scatterplot'],
		async build() {
			const RAW = RAW_COLOUR;
			const FIT = FIT_COLOUR;
			// Anscombe, F.J. (1973). Graphs in Statistical Analysis. The American
			// Statistician 27(1):17-21. Sets I–III share the same x; set IV differs.
			const x123 = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5];
			const y1 = [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68];
			const y2 = [9.14, 8.14, 8.74, 8.77, 9.26, 8.1, 6.13, 3.1, 9.13, 7.26, 4.74];
			const y3 = [7.46, 6.77, 12.74, 7.11, 7.81, 8.84, 6.08, 5.39, 8.15, 6.42, 5.73];
			const x4 = [8, 8, 8, 8, 8, 8, 8, 19, 8, 8, 8];
			const y4 = [6.58, 5.76, 7.71, 8.84, 8.47, 7.04, 5.25, 12.5, 5.56, 7.91, 6.89];

			const x123Id = mkCol('number', x123, 'x (sets I–III)');
			const y1Id = mkCol('number', y1, 'Set I');
			const y2Id = mkCol('number', y2, 'Set II');
			const y3Id = mkCol('number', y3, 'Set III');
			const x4Id = mkCol('number', x4, 'x (set IV)');
			const y4Id = mkCol('number', y4, 'Set IV');

			// Identical summary statistics across the four y-columns.
			const describe = new TableProcess(
				{
					name: 'DescribeData',
					args: {
						yIN: [y1Id, y2Id, y3Id, y4Id],
						out: { variable: -1, n: -1, mean: -1, sd: -1, min: -1, max: -1 }
					}
				},
				null
			);
			describe.displayName = 'Describe the four y-columns';
			pushObj(describe);
			await describe.doProcess();

			// Identical least-squares lines. Sets I–III share x, so one fit covers
			// all three; set IV has its own x and needs its own fit.
			const tf123 = new TableProcess(
				{
					name: 'TrendFit',
					args: {
						xIN: x123Id,
						yIN: [y1Id, y2Id, y3Id],
						model: 'linear',
						outputX: -1,
						out: {
							trendx: -1,
							[`trendy_${y1Id}`]: -1,
							[`trendy_${y2Id}`]: -1,
							[`trendy_${y3Id}`]: -1,
							r2: -1,
							coef_slope: -1,
							coef_intercept: -1
						}
					}
				},
				null
			);
			tf123.displayName = 'Linear fit (sets I–III)';
			pushObj(tf123);
			await tf123.doProcess();

			const tf4 = new TableProcess(
				{
					name: 'TrendFit',
					args: {
						xIN: x4Id,
						yIN: [y4Id],
						model: 'linear',
						outputX: -1,
						out: { trendx: -1, [`trendy_${y4Id}`]: -1, r2: -1, coef_slope: -1, coef_intercept: -1 }
					}
				},
				null
			);
			tf4.displayName = 'Linear fit (set IV)';
			pushObj(tf4);
			await tf4.doProcess();

			const tx123 = tf123.args.out.trendx;
			const tx4 = tf4.args.out.trendx;

			// Small-multiple 2x2 grid. The whole point of the quartet is that the four
			// pictures differ while the numbers do not, so the panels are laid out at
			// identical size and pinned to ONE shared domain — x [2, 20], y [2, 14],
			// which frames every set (x spans 4-19 once set IV's leverage point at
			// x = 19 is included; y spans 3.10-12.74). Auto-scaled panels would each
			// choose their own limits and the shapes would no longer be comparable.
			const PANEL_W = 480;
			const PANEL_H = 300;
			const COL_X = [60, 570]; // 480 wide + 30 gutter
			// The demo note sits at (40, 24) and is 360x190, so the grid starts below it.
			const ROW_Y = [255, 630]; // 300 tall + 75 for the title bar
			const XLIMS = [2, 20];
			const YLIMS = [2, 14];
			// Every set's fit line rises left-to-right and no set has data beyond x = 14
			// except set IV's leverage point at (19, 12.5), so the bottom-right corner is
			// empty in all four panels — the one legend position that never covers a mark.
			const panel = (name, series, col, row) => {
				const p = scatterPlot(
					name,
					series,
					{ x: 'x', y: 'y' },
					{
						x: COL_X[col],
						y: ROW_Y[row],
						width: PANEL_W,
						height: PANEL_H,
						xlims: XLIMS,
						ylims: YLIMS
					}
				);
				p.plot.legend.position = 'bottomright';
				return p;
			};

			panel(
				'Set I — a real linear relationship',
				[
					{ x: x123Id, y: y1Id, label: 'Set I', kind: 'points', colour: RAW },
					{ x: tx123, y: tf123.args.out[`trendy_${y1Id}`], label: 'fit', kind: 'line', colour: FIT }
				],
				0,
				0
			);
			panel(
				'Set II — actually a curve',
				[
					{ x: x123Id, y: y2Id, label: 'Set II', kind: 'points', colour: RAW },
					{ x: tx123, y: tf123.args.out[`trendy_${y2Id}`], label: 'fit', kind: 'line', colour: FIT }
				],
				1,
				0
			);
			panel(
				'Set III — a line, plus one outlier',
				[
					{ x: x123Id, y: y3Id, label: 'Set III', kind: 'points', colour: RAW },
					{ x: tx123, y: tf123.args.out[`trendy_${y3Id}`], label: 'fit', kind: 'line', colour: FIT }
				],
				0,
				1
			);
			panel(
				'Set IV — one high-leverage point',
				[
					{ x: x4Id, y: y4Id, label: 'Set IV', kind: 'points', colour: RAW },
					{ x: tx4, y: tf4.args.out[`trendy_${y4Id}`], label: 'fit', kind: 'line', colour: FIT }
				],
				1,
				1
			);

			// The two summary tables sit below the grid, so the four panels read as one figure.
			tablePlot(
				'Identical summaries',
				[describe.args.out.variable, describe.args.out.mean, describe.args.out.sd],
				{
					x: COL_X[0],
					y: 1005,
					width: PANEL_W,
					height: 240
				}
			);
			tablePlot(
				'Identical fits (sets I–III)',
				[tf123.args.out.coef_slope, tf123.args.out.coef_intercept, tf123.args.out.r2],
				{ x: COL_X[1], y: 1005, width: PANEL_W, height: 240 }
			);
		}
	},
	{
		id: 'stats-simpson',
		summary: 'A trend that reverses direction when you pool the groups.',
		name: 'Workflow — Simpson’s paradox (the trend that flips)',
		// See stats-anscombe: an interpretation demo, not a statistics one.
		group: 'Reading the output',
		family: 'Workflows',
		description:
			'Within every group the relationship is positive; pool the groups and it turns negative. Here three hospital wards each show activity rising with dose (a clear within-ward positive trend), but the wards are offset — the ward that runs at the highest dose also has the lowest baseline — so the pooled cloud slopes the other way. The Correlation node run on the pooled data reports a negative coefficient, while the coloured per-ward trend lines all climb. The reversal is real, not a mistake: it means a lurking grouping variable is driving the aggregate, and which answer is correct depends on the question. Pool only when the groups are genuinely exchangeable; otherwise the honest analysis is per-group. This is why "controlling for" a variable can flip a headline result.',
		showcases: ['Correlation', 'scatterplot'],
		async build() {
			const rng = mulberry32(202);
			// (x-centre, intercept). Slope is +1 within every ward, but the intercept
			// FALLS as the ward's dose RISES, so the pooled trend runs the other way.
			const WARDS = [
				{ name: 'Ward A', xc: 2, intc: 8, colour: '#234154' },
				{ name: 'Ward B', xc: 5, intc: 4, colour: '#BE796B' },
				{ name: 'Ward C', xc: 8, intc: 0, colour: '#5B8A72' }
			];
			const SLOPE = 1.0;
			const PER = 25;

			// Two-point least-squares segment spanning a column's x-range.
			const fitLine = (xs, ys) => {
				const n = xs.length;
				const mx = xs.reduce((a, b) => a + b, 0) / n;
				const my = ys.reduce((a, b) => a + b, 0) / n;
				let sxx = 0;
				let sxy = 0;
				for (let i = 0; i < n; i++) {
					sxx += (xs[i] - mx) ** 2;
					sxy += (xs[i] - mx) * (ys[i] - my);
				}
				const slope = sxy / sxx;
				const intercept = my - slope * mx;
				const lo = Math.min(...xs);
				const hi = Math.max(...xs);
				return { x: [lo, hi], y: [intercept + slope * lo, intercept + slope * hi] };
			};

			const xAll = [];
			const yAll = [];
			const pointSeries = [];
			const lineSeries = [];

			for (const w of WARDS) {
				const gx = [];
				const gy = [];
				for (let i = 0; i < PER; i++) {
					const xi = w.xc + normal(rng, 0, 0.7);
					const yi = w.intc + SLOPE * xi + normal(rng, 0, 0.7);
					gx.push(xi);
					gy.push(yi);
					xAll.push(xi);
					yAll.push(yi);
				}
				const gxId = mkCol('number', gx, `${w.name} dose`);
				const gyId = mkCol('number', gy, `${w.name} activity`);
				pointSeries.push({ x: gxId, y: gyId, label: w.name, kind: 'points', colour: w.colour });

				const ln = fitLine(gx, gy);
				const lxId = mkCol('number', ln.x, `${w.name} fit x`);
				const lyId = mkCol('number', ln.y, `${w.name} fit y`);
				lineSeries.push({
					x: lxId,
					y: lyId,
					label: `${w.name} trend`,
					kind: 'line',
					colour: w.colour
				});
			}

			const xAllId = mkCol('number', xAll, 'dose (pooled)');
			const yAllId = mkCol('number', yAll, 'activity (pooled)');

			// Pooled least-squares line — the one that runs the "wrong" way.
			const agg = fitLine(xAll, yAll);
			const aggLine = {
				x: mkCol('number', agg.x, 'pooled fit x'),
				y: mkCol('number', agg.y, 'pooled fit y'),
				label: 'Pooled trend (all wards)',
				kind: 'line',
				colour: '#111111'
			};

			const corr = new TableProcess(
				{
					name: 'Correlation',
					args: {
						yIN: [xAllId, yAllId],
						method: 'pearson',
						alpha: 0.05,
						out: { var_i: -1, var_j: -1, r: -1, pvalue: -1, n: -1 }
					}
				},
				null
			);
			corr.displayName = 'Correlation (pooled)';
			pushObj(corr);
			await corr.doProcess();

			scatterPlot(
				'Within wards (climbing) vs pooled (falling)',
				[...pointSeries, ...lineSeries, aggLine],
				{ x: 'Dose', y: 'Activity' }
			);
			tablePlot('Pooled correlation (negative)', [
				corr.args.out.var_i,
				corr.args.out.var_j,
				corr.args.out.r,
				corr.args.out.pvalue
			]);
		}
	},
	{
		id: 'non24-blind',
		summary: 'A human rhythm free-running through the day over weeks.',
		name: 'Workflow — non-24 sleep-wake (blind participant)',
		family: 'Workflows',
		description:
			'The human counterpart to the free-running mouse. With no light reaching the clock, the rhythm runs at its own tau (here 24.5 h) and drifts steadily later, so the sleep window migrates all the way around the clock over about seven weeks. A double-plotted actogram shows the drift and a Lomb-Scargle periodogram recovers tau. The point is that free-running is not a rodent-only phenomenon: this is a recognised clinical presentation.',
		showcases: ['RhythmicityAnalysis', 'actogram', 'periodogram'],
		async build() {
			const rng = mulberry32(41);
			const TAU = 24.5; // drifts 0.5 h/day → a full lap of the clock in 48 days
			const DAYS = 48;
			const hours = seq(24 * DAYS, (i) => i);
			// Rest-activity keyed to the participant's OWN tau, not to clock time.
			const activity = hours.map((h) => {
				const phase = (h % TAU) / TAU; // 0..1 within the endogenous cycle
				const asleep = phase >= 0.0 && phase < 0.33; // ~8 h sleep window
				return Math.max(0, (asleep ? 3 : 58) + normal(rng, 0, asleep ? 4 : 14));
			});
			const hoursId = mkCol('number', hours, 'hour');
			const actId = mkCol('number', activity, 'activity');

			const acto = new Plot({ name: 'Actogram (double-plotted)', type: 'actogram' });
			acto.plot.addData({ time: { refId: hoursId }, values: { refId: actId } });
			acto.plot.periodHrs = 24;
			acto.plot.doublePlot = 2;
			pushObj(acto);

			const pg = new Plot({ name: 'Lomb-Scargle periodogram', type: 'periodogram' });
			pg.plot.addData({ time: { refId: hoursId }, values: { refId: actId } });
			pg.plot.periodlimsIN = [22, 27];
			pg.plot.periodSteps = 0.02;
			pushObj(pg);

			const ra = new TableProcess(
				{
					name: 'RhythmicityAnalysis',
					args: {
						xIN: hoursId,
						yIN: [actId],
						analysis: 'periodogram',
						pgMethod: 'Lomb-Scargle',
						periodMin: 22,
						periodMax: 27,
						periodStep: 0.02,
						pgBinSize: 0.25,
						pgAlpha: 0.05,
						preProcesses: [],
						out: { stat_peak_period: -1, stat_peak_power: -1 }
					}
				},
				null
			);
			ra.displayName = 'Rhythmicity Analysis — tau';
			pushObj(ra);
			await ra.doProcess();
			tablePlot('Estimated tau', [ra.args.out.stat_peak_period, ra.args.out.stat_peak_power]);
		}
	},
	{
		id: 'arrhythmic',
		group: 'Reading the output',
		summary: 'The negative control: what no rhythm actually looks like.',
		name: 'Workflow — arrhythmic record (negative control)',
		family: 'Workflows',
		description:
			'The single most useful thing to see before over-interpreting your own data. An intact record and an arrhythmic one (as after SCN ablation) are analysed side by side with identical settings. The intact periodogram has an unmistakable peak at 24 h; the arrhythmic one still reports a "peak period", because a periodogram always returns its largest value, but the power is a fraction of the intact case and the actogram shows no band at all. Read the power and the picture, not just the number.',
		showcases: ['RhythmicityAnalysis', 'actogram', 'periodogram'],
		async build() {
			const rng = mulberry32(43);
			const DAYS = 14;
			const hours = seq(24 * DAYS, (i) => i);
			// Intact: a clean nocturnal band. Arrhythmic: the SAME mean activity,
			// redistributed at random — total counts match, structure does not.
			const intact = hours.map((h) => {
				const tod = h % 24;
				const active = tod >= 18 || tod < 6;
				return Math.max(0, (active ? 70 : 5) + normal(rng, 0, active ? 12 : 3));
			});
			const arrhythmic = hours.map(() => Math.max(0, 37 + normal(rng, 0, 26)));

			const hoursId = mkCol('number', hours, 'hour');
			const intactId = mkCol('number', intact, 'intact');
			const lesionId = mkCol('number', arrhythmic, 'arrhythmic');

			const acto = new Plot({ name: 'Actogram — intact vs arrhythmic', type: 'actogram' });
			acto.plot.addData({ time: { refId: hoursId }, values: { refId: intactId } });
			acto.plot.addData({ time: { refId: hoursId }, values: { refId: lesionId } });
			acto.plot.periodHrs = 24;
			acto.plot.doublePlot = 2;
			pushObj(acto);

			const pg = new Plot({ name: 'Periodogram — both records', type: 'periodogram' });
			pg.plot.addData({ time: { refId: hoursId }, values: { refId: intactId } });
			pg.plot.addData({ time: { refId: hoursId }, values: { refId: lesionId } });
			pg.plot.periodlimsIN = [18, 30];
			pg.plot.periodSteps = 0.05;
			pushObj(pg);

			const ra = new TableProcess(
				{
					name: 'RhythmicityAnalysis',
					args: {
						xIN: hoursId,
						yIN: [intactId, lesionId],
						analysis: 'periodogram',
						pgMethod: 'Lomb-Scargle',
						periodMin: 18,
						periodMax: 30,
						periodStep: 0.05,
						pgBinSize: 0.25,
						pgAlpha: 0.05,
						preProcesses: [],
						out: { stat_peak_period: -1, stat_peak_power: -1 }
					}
				},
				null
			);
			ra.displayName = 'Rhythmicity Analysis — peak vs power';
			pushObj(ra);
			await ra.doProcess();
			tablePlot('Peak period and power', [
				ra.args.out.stat_peak_period,
				ra.args.out.stat_peak_power
			]);
		}
	},
	{
		id: 'circatidal',
		summary: 'A 12.4 h tidal rhythm, not a circadian one.',
		name: 'Workflow — circatidal rhythm (12.4 h)',
		family: 'Workflows',
		description:
			'Rhythm analysis is not circadian-only. A coastal invertebrate timed to the tides runs at 12.4 h, with a weaker 24.8 h component as successive tides differ. The periodogram search window is the thing to notice: the default 20-28 h window would find the 24.8 h component and miss the dominant tidal peak entirely. Widen the window and both appear.',
		showcases: ['RhythmicityAnalysis', 'actogram', 'periodogram'],
		async build() {
			const rng = mulberry32(47);
			const TIDAL = 12.42; // lunar semi-diurnal period, h
			const DAYS = 12;
			const hours = seq(24 * DAYS, (i) => i * 0.5); // 30-min epochs
			// Successive tides are unequal, so alternate cycles differ in amplitude.
			// That inequality is what puts power at 24.8 h as well as 12.4 h.
			const activity = hours.map((h) => {
				const cycle = Math.floor(h / TIDAL);
				const phase = (h % TIDAL) / TIDAL;
				const active = phase < 0.4;
				const amp = cycle % 2 === 0 ? 80 : 48; // diurnal inequality
				return Math.max(0, (active ? amp : 4) + normal(rng, 0, active ? 10 : 3));
			});
			const hoursId = mkCol('number', hours, 'hour');
			const actId = mkCol('number', activity, 'activity');

			const acto = new Plot({ name: 'Actogram (24 h grid)', type: 'actogram' });
			acto.plot.addData({ time: { refId: hoursId }, values: { refId: actId } });
			acto.plot.periodHrs = 24;
			acto.plot.doublePlot = 2;
			pushObj(acto);

			const pg = new Plot({ name: 'Periodogram — 6 to 30 h', type: 'periodogram' });
			pg.plot.addData({ time: { refId: hoursId }, values: { refId: actId } });
			pg.plot.periodlimsIN = [6, 30];
			pg.plot.periodSteps = 0.02;
			pushObj(pg);

			const ra = new TableProcess(
				{
					name: 'RhythmicityAnalysis',
					args: {
						xIN: hoursId,
						yIN: [actId],
						analysis: 'periodogram',
						pgMethod: 'Lomb-Scargle',
						periodMin: 6,
						periodMax: 30,
						periodStep: 0.02,
						pgBinSize: 0.25,
						pgAlpha: 0.05,
						preProcesses: [],
						out: { stat_peak_period: -1, stat_peak_power: -1 }
					}
				},
				null
			);
			ra.displayName = 'Rhythmicity Analysis — tidal peak';
			pushObj(ra);
			await ra.doProcess();
			tablePlot('Dominant period', [ra.args.out.stat_peak_period, ra.args.out.stat_peak_power]);
		}
	},
	{
		id: 'reentrainment',
		summary: 'The slow diagonal crawl back into alignment after a time-zone shift.',
		name: 'Workflow — re-entrainment after a time-zone shift',
		family: 'Workflows',
		description:
			'The contrast with an abrupt shift is the lesson. The zeitgeber moves 8 h in one step, but the rhythm does not: it runs at a transient period near 25.3 h for about a week, crawling diagonally across the actogram, before locking on at the new phase. Compare this with a schedule change where the record simply jumps, and the transients are what tell you a real clock is involved rather than direct driving.',
		showcases: ['actogram', 'periodogram'],
		async build() {
			const rng = mulberry32(53);
			const BASELINE = 8; // days on the original schedule
			const TRANSIENT = 7; // days of drifting re-entrainment
			const AFTER = 10; // days settled at the new phase
			const DAYS = BASELINE + TRANSIENT + AFTER;
			const hours = seq(24 * DAYS, (i) => i);

			// Phase of the rhythm's own onset, in hours after midnight. Entrained at
			// 18:00, then an 8 h DELAY imposed at day 8. The rhythm cannot jump: it
			// runs slow (tau ~25.3 h) through the transient, gaining 1.3 h a day
			// until it has covered the 8 h and re-locks.
			const onsetAt = (day) => {
				if (day < BASELINE) return 18;
				if (day < BASELINE + TRANSIENT) return 18 + Math.min(8, 1.3 * (day - BASELINE + 1));
				return 26; // 18 + 8, i.e. 02:00 the next day
			};
			const activity = hours.map((h) => {
				const day = Math.floor(h / 24);
				const onset = onsetAt(day);
				// Active for 11 h from onset, wrapping past midnight.
				const since = (h - day * 24 - onset + 48) % 24;
				const active = since < 11;
				return Math.max(0, (active ? 72 : 4) + normal(rng, 0, active ? 12 : 3));
			});
			const hoursId = mkCol('number', hours, 'hour');
			const actId = mkCol('number', activity, 'activity');

			const acto = new Plot({ name: 'Actogram — transients visible', type: 'actogram' });
			acto.plot.addData({ time: { refId: hoursId }, values: { refId: actId } });
			acto.plot.periodHrs = 24;
			acto.plot.doublePlot = 2;
			pushObj(acto);

			const pg = new Plot({ name: 'Periodogram (whole record)', type: 'periodogram' });
			pg.plot.addData({ time: { refId: hoursId }, values: { refId: actId } });
			pg.plot.periodlimsIN = [20, 28];
			pg.plot.periodSteps = 0.05;
			pushObj(pg);
		}
	},
	{
		id: 'transients',
		summary: 'An immediate delay beside an advance that crawls through transients.',
		name: 'Workflow — transients (phase advance vs delay)',
		family: 'Workflows',
		description:
			'Two free-running records, each given a single phase-shifting stimulus on the same day, showing the two ways a rhythm can take up a new phase. Both free-run at 24.3 h throughout, so the activity band drifts slowly RIGHTWARD (later) even before anything is done to it — the diagonal that marks a clock running on its own period rather than being held by a zeitgeber. The DELAY is immediate: the band steps right in a single cycle and simply resumes its drift from the new phase, which is what strong (Type 0) resetting looks like. The ADVANCE goes through TRANSIENTS: intermediate cycles between the stimulus and the re-attainment of a steady-state phase, crawling LEFTWARD over about eight cycles. Those cycles do not move at a constant rate — each closes a fraction of whatever phase difference is left, so the increment is largest right after the stimulus and shrinks as the rhythm nears its new phase, giving a curved, decelerating approach rather than a straight ramp. Transients being commoner after advances than delays is the classical generalisation. Only the phase reached AFTER they subside is the steady-state shift, which is why a PRC must be scored from post-transient cycles.',
		showcases: ['actogram', 'scatterplot'],
		async build() {
			const STIM = 8; // day the phase-shifting stimulus is given
			const DAYS = 28;
			const SHIFT = 8; // hours of phase shift the stimulus evokes
			const BASE_ONSET = 18; // onset on day 0, hours after midnight
			const TAU = 24.3; // free-running period — just off 24 h
			const hours = seq(24 * DAYS, (i) => i);

			// Free-running baseline: with tau > 24 the onset slides later by
			// (tau - 24) h every cycle, drawing the steady rightward diagonal seen
			// in a record that is not held by a zeitgeber.
			const DRIFT = TAU - 24;
			const freeRun = (day) => BASE_ONSET + DRIFT * day;

			// DELAY — expressed IMMEDIATELY, and to the RIGHT (later). The rhythm is
			// at its new phase on the first cycle after the stimulus: strong (Type 0)
			// resetting, where the pacemaker is thrown straight onto a new isochron
			// and the overt rhythm shows no intermediate cycles at all.
			const onsetDelay = (day) => freeRun(day) + (day < STIM ? 0 : SHIFT);

			// ADVANCE — expressed through TRANSIENTS, to the LEFT (earlier), and
			// asymptotically rather than linearly. Each cycle the stimulus strikes
			// the PRC nearer the phase whose evoked shift equals FRP - T, so the
			// increment it wins shrinks and the approach decelerates. K is set from
			// how many cycles it takes to come within SETTLE hours of the new phase.
			const SETTLE = 0.5; // h — residual small enough to read as "settled"
			const K_ADV = 8 / Math.log(SHIFT / SETTLE); // ~8 transient cycles
			const closed = (day) => (day < STIM ? 0 : SHIFT * (1 - Math.exp(-(day - STIM + 1) / K_ADV)));
			const onsetAdvance = (day) => freeRun(day) - closed(day);

			// 11 h of activity from onset. mod24 rather than a fixed offset because
			// the drifting onset leaves the 0-24 range over a long record.
			const mod24 = (v) => ((v % 24) + 24) % 24;
			const record = (onsetAt, seed) => {
				const rng = mulberry32(seed);
				return hours.map((h) => {
					const day = Math.floor(h / 24);
					const since = mod24(h - day * 24 - onsetAt(day));
					const active = since < 11;
					return Math.max(0, (active ? 72 : 4) + normal(rng, 0, active ? 12 : 3));
				});
			};

			const hoursId = mkCol('number', hours, 'hour');
			const delId = mkCol('number', record(onsetDelay, 73), 'activity_delay');
			const advId = mkCol('number', record(onsetAdvance, 71), 'activity_advance');

			const actoD = new Plot({
				name: 'Delay 8 h — immediate, no transients',
				type: 'actogram'
			});
			actoD.plot.addData({ time: { refId: hoursId }, values: { refId: delId } });
			actoD.plot.periodHrs = 24;
			actoD.plot.doublePlot = 2;
			pushObj(actoD);

			const actoA = new Plot({
				name: 'Advance 8 h — about 8 transient cycles',
				type: 'actogram'
			});
			actoA.plot.addData({ time: { refId: hoursId }, values: { refId: advId } });
			actoA.plot.periodHrs = 24;
			actoA.plot.doublePlot = 2;
			pushObj(actoA);

			// The same story as numbers. Grey is where the rhythm would have gone
			// had nothing been done to it (the unperturbed free-run); the gap
			// between it and each coloured trace is the phase shift, closed in one
			// cycle by the delay and over several by the advance.
			const REF = '#8A9BA8';
			const days = seq(DAYS, (d) => d);
			const dayId = mkCol('number', days, 'day');
			const refId = mkCol('number', days.map(freeRun), 'onset_freerun');
			const rDelId = mkCol('number', days.map(onsetDelay), 'onset_delay');
			const rAdvId = mkCol('number', days.map(onsetAdvance), 'onset_advance');

			scatterPlot(
				'Onset vs day — immediate delay versus advance transients',
				[
					{ x: dayId, y: refId, label: 'Unperturbed free-run', kind: 'line', colour: REF },
					{ x: dayId, y: rDelId, label: 'Delay — immediate', kind: 'line', colour: RAW_COLOUR },
					{ x: dayId, y: rAdvId, label: 'Advance — transients', kind: 'line', colour: FIT_COLOUR }
				],
				{ x: 'Day', y: 'Activity onset (h after midnight)' }
			);
		}
	},
	{
		id: 'split-rhythm',
		summary: 'Constant light splits the activity band into two components.',
		name: 'Workflow — split rhythm under constant light',
		family: 'Workflows',
		description:
			'Under constant light the rhythm can bifurcate: two oscillator components decouple, run at slightly different periods, and re-stabilise roughly 12 h apart. Here the two components are supplied separately (24.8 h and 23.4 h) and their sum is what an actograph would record, so the split is emergent rather than drawn. The periodogram of the sum shows both components, which is the numeric signature of splitting.',
		showcases: ['actogram', 'periodogram', 'RhythmicityAnalysis'],
		async build() {
			const rng = mulberry32(59);
			const TAU_A = 24.8;
			const TAU_B = 23.4; // 1.4 h/day apart → ~12 h separation after ~9 days
			const DAYS = 26;
			const hours = seq(24 * DAYS, (i) => i);
			const component = (h, tau) => {
				const phase = (h % tau) / tau;
				return phase < 0.3 ? 40 : 2;
			};
			const compA = hours.map((h) => Math.max(0, component(h, TAU_A) + normal(rng, 0, 4)));
			const compB = hours.map((h) => Math.max(0, component(h, TAU_B) + normal(rng, 0, 4)));
			const total = hours.map((_, i) => compA[i] + compB[i]);

			const hoursId = mkCol('number', hours, 'hour');
			const aId = mkCol('number', compA, 'component A (24.8 h)');
			const bId = mkCol('number', compB, 'component B (23.4 h)');
			const totalId = mkCol('number', total, 'recorded activity');

			const acto = new Plot({ name: 'Actogram — the recorded sum', type: 'actogram' });
			acto.plot.addData({ time: { refId: hoursId }, values: { refId: totalId } });
			acto.plot.periodHrs = 24;
			acto.plot.doublePlot = 2;
			pushObj(acto);

			const parts = new Plot({ name: 'Actogram — the two components', type: 'actogram' });
			parts.plot.addData({ time: { refId: hoursId }, values: { refId: aId } });
			parts.plot.addData({ time: { refId: hoursId }, values: { refId: bId } });
			parts.plot.periodHrs = 24;
			parts.plot.doublePlot = 2;
			pushObj(parts);

			const pg = new Plot({ name: 'Periodogram — two peaks', type: 'periodogram' });
			pg.plot.addData({ time: { refId: hoursId }, values: { refId: totalId } });
			pg.plot.periodlimsIN = [21, 27];
			pg.plot.periodSteps = 0.02;
			pushObj(pg);

			const ra = new TableProcess(
				{
					name: 'RhythmicityAnalysis',
					args: {
						xIN: hoursId,
						yIN: [totalId],
						analysis: 'periodogram',
						pgMethod: 'Lomb-Scargle',
						periodMin: 21,
						periodMax: 27,
						periodStep: 0.02,
						pgBinSize: 0.25,
						pgAlpha: 0.05,
						preProcesses: [],
						out: { stat_peak_period: -1, stat_peak_power: -1 }
					}
				},
				null
			);
			ra.displayName = 'Rhythmicity Analysis — dominant component';
			pushObj(ra);
			await ra.doProcess();
			tablePlot('Dominant component', [ra.args.out.stat_peak_period, ra.args.out.stat_peak_power]);
		}
	},
	{
		id: 'noise-peak',
		group: 'Reading the output',
		summary: 'Twelve pure-noise records, and the peak that means nothing.',
		name: 'Workflow — the multiple-comparison trap',
		family: 'Workflows',
		description:
			'A periodogram always returns a largest value, whether or not there is a rhythm. Here twelve records of pure noise are analysed with identical settings. Every one reports a "peak period", scattered arbitrarily across the search window, and the most impressive of the twelve looks convincing on its own. Test enough series, or enough windows, and something will always look significant. Read this next to the arrhythmic negative control.',
		showcases: ['RhythmicityAnalysis', 'periodogram', 'DescribeData'],
		async build() {
			const rng = mulberry32(61);
			const N_SERIES = 12;
			const DAYS = 10;
			const hours = seq(24 * DAYS, (i) => i);
			const hoursId = mkCol('number', hours, 'hour');
			// Pure noise. No rhythm of any kind is present in any of these.
			const noiseIds = seq(N_SERIES, (s) =>
				mkCol(
					'number',
					hours.map(() => Math.max(0, 40 + normal(rng, 0, 20))),
					`noise ${s + 1}`
				)
			);

			const pg = new Plot({ name: 'Periodograms of pure noise', type: 'periodogram' });
			for (const id of noiseIds.slice(0, 4)) {
				pg.plot.addData({ time: { refId: hoursId }, values: { refId: id } });
			}
			pg.plot.periodlimsIN = [20, 28];
			pg.plot.periodSteps = 0.05;
			pushObj(pg);

			const ra = new TableProcess(
				{
					name: 'RhythmicityAnalysis',
					args: {
						xIN: hoursId,
						yIN: [...noiseIds],
						analysis: 'periodogram',
						pgMethod: 'Lomb-Scargle',
						periodMin: 20,
						periodMax: 28,
						periodStep: 0.05,
						pgBinSize: 0.25,
						pgAlpha: 0.05,
						preProcesses: [],
						out: { stat_peak_period: -1, stat_peak_power: -1 }
					}
				},
				null
			);
			ra.displayName = 'Rhythmicity Analysis — 12 noise records';
			pushObj(ra);
			await ra.doProcess();

			// The spread of "peak periods" IS the point: they scatter across the
			// whole window, which is what a null result looks like in aggregate.
			const desc = new TableProcess(
				{
					name: 'DescribeData',
					args: {
						yIN: [ra.args.out.stat_peak_period, ra.args.out.stat_peak_power],
						out: {}
					}
				},
				null
			);
			desc.displayName = 'Describe — spread of the "peaks"';
			pushObj(desc);
			await desc.doProcess();

			tablePlot('Peak period per noise record', [
				ra.args.out.stat_peak_period,
				ra.args.out.stat_peak_power
			]);
		}
	},
	{
		id: 'aliasing',
		group: 'Reading the output',
		summary: 'Sample too slowly and a 24 h rhythm disappears.',
		name: 'Workflow — sampling rate and aliasing',
		family: 'Workflows',
		description:
			'A data-literacy card. The same 24 h rhythm is recorded at 30-minute epochs and then re-sampled every 13 hours. Because 13 h is longer than half the period, the rhythm is below the Nyquist limit for that sampling rate and cannot be recovered: the periodogram of the slow record peaks in the wrong place entirely. Check your epoch length against the period you are hoping to find before you conclude anything is absent.',
		showcases: ['periodogram', 'RhythmicityAnalysis'],
		async build() {
			const rng = mulberry32(67);
			const DAYS = 20;
			const fine = seq(DAYS * 48, (i) => i * 0.5); // 30-min epochs
			const signal = (h) => 50 + 40 * Math.sin((2 * Math.PI * h) / 24);
			const fineVals = fine.map((h) => Math.max(0, signal(h) + normal(rng, 0, 6)));
			// Undersampled: one reading every 13 h. Above the Nyquist limit of
			// 26 h for a 13 h interval, so 24 h cannot be resolved.
			const slow = seq(Math.floor((DAYS * 24) / 13), (i) => i * 13);
			const slowVals = slow.map((h) => Math.max(0, signal(h) + normal(rng, 0, 6)));

			const fineTimeId = mkCol('number', fine, 'hour (30 min epochs)');
			const fineId = mkCol('number', fineVals, 'activity (30 min)');
			const slowTimeId = mkCol('number', slow, 'hour (13 h epochs)');
			const slowId = mkCol('number', slowVals, 'activity (13 h)');

			const pgFine = new Plot({ name: 'Periodogram — 30 min epochs', type: 'periodogram' });
			pgFine.plot.addData({ time: { refId: fineTimeId }, values: { refId: fineId } });
			pgFine.plot.periodlimsIN = [10, 40];
			pgFine.plot.periodSteps = 0.05;
			pushObj(pgFine);

			const pgSlow = new Plot({ name: 'Periodogram — 13 h epochs', type: 'periodogram' });
			pgSlow.plot.addData({ time: { refId: slowTimeId }, values: { refId: slowId } });
			pgSlow.plot.periodlimsIN = [10, 40];
			pgSlow.plot.periodSteps = 0.05;
			pushObj(pgSlow);

			const ra = new TableProcess(
				{
					name: 'RhythmicityAnalysis',
					args: {
						xIN: slowTimeId,
						yIN: [slowId],
						analysis: 'periodogram',
						pgMethod: 'Lomb-Scargle',
						periodMin: 10,
						periodMax: 40,
						periodStep: 0.05,
						pgBinSize: 0.25,
						pgAlpha: 0.05,
						preProcesses: [],
						out: { stat_peak_period: -1, stat_peak_power: -1 }
					}
				},
				null
			);
			ra.displayName = 'Rhythmicity Analysis — the undersampled record';
			pushObj(ra);
			await ra.doProcess();
			tablePlot('What the slow record reports', [
				ra.args.out.stat_peak_period,
				ra.args.out.stat_peak_power
			]);
		}
	},
	{
		id: 'crepuscular',
		summary: 'Two activity peaks a day, and why one mean phase misleads.',
		name: 'Workflow — crepuscular (bimodal) activity',
		family: 'Workflows',
		description:
			'Many species are crepuscular, with peaks near dawn and dusk rather than one consolidated bout. The periodogram shows this directly: power at 12 h as well as 24 h. It also breaks a common assumption, because a single circular mean phase for a bimodal distribution lands between the two peaks, at the time of day the animal is least active. Look at the distribution before you summarise it with one number.',
		showcases: ['periodogram', 'actogram', 'RayleighTest'],
		async build() {
			const rng = mulberry32(71);
			const DAYS = 14;
			const hours = seq(24 * DAYS, (i) => i);
			// Peaks centred on 06:00 and 18:00, quiet at midday and midnight.
			const activity = hours.map((h) => {
				const tod = h % 24;
				const dawn = Math.exp(-((tod - 6) ** 2) / 4);
				const dusk = Math.exp(-((tod - 18) ** 2) / 4);
				return Math.max(0, 6 + 70 * (dawn + dusk) + normal(rng, 0, 5));
			});
			const hoursId = mkCol('number', hours, 'hour');
			const actId = mkCol('number', activity, 'activity');

			const acto = new Plot({ name: 'Actogram — two bouts a day', type: 'actogram' });
			acto.plot.addData({ time: { refId: hoursId }, values: { refId: actId } });
			acto.plot.periodHrs = 24;
			acto.plot.doublePlot = 2;
			pushObj(acto);

			const pg = new Plot({ name: 'Periodogram — 24 h and 12 h', type: 'periodogram' });
			pg.plot.addData({ time: { refId: hoursId }, values: { refId: actId } });
			pg.plot.periodlimsIN = [6, 30];
			pg.plot.periodSteps = 0.02;
			pushObj(pg);

			// Time of day, weighted by activity: the circular summary of a bimodal
			// distribution. The resultant is short because the two peaks oppose.
			const todId = mkCol(
				'number',
				hours.map((h) => h % 24),
				'time of day'
			);
			const rayleigh = new TableProcess(
				{
					name: 'RayleighTest',
					args: {
						xIN: todId,
						yIN: [actId],
						period: 24,
						unit: 'hours',
						testType: 'rayleigh',
						out: { R: -1, z: -1, pvalue: -1 }
					}
				},
				null
			);
			rayleigh.displayName = 'Rayleigh — one mean phase for two peaks';
			pushObj(rayleigh);
			await rayleigh.doProcess();
			tablePlot('Circular summary', [
				rayleigh.args.out.R,
				rayleigh.args.out.z,
				rayleigh.args.out.pvalue
			]);
		}
	},
	{
		id: 'masking',
		summary: 'Light driving behaviour directly, versus a clock that has shifted.',
		name: 'Workflow — masking versus true entrainment',
		family: 'Workflows',
		description:
			'Two records that look identical while the light is on, and diverge the moment it goes off. Both animals appear to follow a 6 h shift of the light cycle. Released into constant darkness, the entrained animal keeps the new phase because its clock actually moved, while the masked animal reverts immediately to its original phase because light was only suppressing its behaviour. This is why a shift under a light cycle is not by itself evidence of entrainment: the release is the test.',
		showcases: ['actogram'],
		async build() {
			const rng = mulberry32(73);
			const BASE = 8; // days on the original light cycle
			const SHIFTED = 10; // days after the light cycle advances 6 h
			const RELEASE = 10; // days in constant darkness
			const DAYS = BASE + SHIFTED + RELEASE;
			const hours = seq(24 * DAYS, (i) => i);

			// Nocturnal animals, active for 11 h from onset.
			const band = (h, onset) => {
				const since = (h - onset + 48) % 24;
				return since < 11;
			};
			const ONSET_BASE = 18; // active 18:00 → 05:00
			const ONSET_NEW = 12; // light cycle advanced 6 h → active 12:00 → 23:00

			const make = (trulyEntrained) =>
				hours.map((h) => {
					const day = Math.floor(h / 24);
					let onset;
					if (day < BASE) onset = ONSET_BASE;
					else if (day < BASE + SHIFTED)
						onset = ONSET_NEW; // both follow the light
					// In DD the difference appears: a shifted clock stays shifted;
					// a masked animal was never shifted at all.
					else onset = trulyEntrained ? ONSET_NEW : ONSET_BASE;
					const active = band(h % 24, onset);
					return Math.max(0, (active ? 68 : 4) + normal(rng, 0, active ? 11 : 3));
				});

			const hoursId = mkCol('number', hours, 'hour');
			const entrainedId = mkCol('number', make(true), 'entrained');
			const maskedId = mkCol('number', make(false), 'masked');

			const a1 = new Plot({ name: 'Actogram — truly entrained', type: 'actogram' });
			a1.plot.addData({ time: { refId: hoursId }, values: { refId: entrainedId } });
			a1.plot.periodHrs = 24;
			a1.plot.doublePlot = 2;
			pushObj(a1);

			const a2 = new Plot({ name: 'Actogram — masked only', type: 'actogram' });
			a2.plot.addData({ time: { refId: hoursId }, values: { refId: maskedId } });
			a2.plot.periodHrs = 24;
			a2.plot.doublePlot = 2;
			pushObj(a2);
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
// `opts` optionally places and locks the plot, for small-multiple grids where every
// panel must sit on the same scale:
//   { x, y, width, height, xlims: [min, max], ylims: [min, max] }
// xlims/ylims write the axis OVERRIDES (xlimsIN / ylimsLeftIN), so the panels share
// one domain instead of each auto-scaling to its own data.
function scatterPlot(name, series, axes, opts = {}) {
	const { x, y, width, height, xlims, ylims } = opts;
	const p = new Plot({ name, type: 'scatterplot', x, y, width, height });
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
	if (xlims) p.plot.xlimsIN = [...xlims];
	if (ylims) p.plot.ylimsLeftIN = [...ylims];
	pushObj(p);
	return p;
}

// `opts` optionally places/sizes the table: { x, y, width, height }.
function tablePlot(name, columnRefs, opts = {}) {
	const { x, y, width, height } = opts;
	const p = new Plot({ name, type: 'tableplot', x, y, width, height });
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

/**
 * Grid the session's plots before it is written.
 *
 * Every Plot is born at the same default position, so a demo that adds three without moving them
 * saved all three on top of each other and the workspace opened as one pile.
 *
 * Facet children are NOT baked into a session (syncFacetChildren respawns them from the generator
 * on load), so the child count has to be estimated here to reserve their space. One child per
 * wired series is what facetUnits produces, so the series count is the estimate.
 */
function tidyPlots() {
	const facetChildCounts = {};
	for (const p of core.plots) {
		if (p.facet) facetChildCounts[p.id] = p.plot?.data?.length ?? 0;
	}
	layoutWorkspacePlots(core.plots, { facetChildCounts });
}

/** RFC4180-ish quoting: only quote when the value actually needs it. */
function csvCell(v) {
	if (v == null) return '';
	const str = String(v);
	return /[",\n]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
}

/**
 * The DATA behind a workflow with the analysis stripped out: every column the demo created as a
 * SOURCE, and none of the table-process outputs (those carry a `tableProcessGUId`). This is what
 * feeds Import data → Examples, so someone can practise on a real record without inheriting a
 * pipeline they did not build.
 *
 * Columns are padded to the longest, because a couple of demos deliberately carry two series at
 * different sampling rates (the aliasing example is 30-minute and 13-hour epochs side by side).
 */
function sourceColumnsCsv() {
	const cols = core.data.filter((c) => !c.tableProcessGUId && !c.producerNodeId);
	const data = cols.map((c) => c.getData?.() ?? []);
	const rows = Math.max(0, ...data.map((d) => d.length));
	const lines = [cols.map((c) => csvCell(c.customName ?? c.name)).join(',')];
	for (let r = 0; r < rows; r++) lines.push(data.map((d) => csvCell(d[r])).join(','));
	return { csv: `${lines.join('\n')}\n`, cols: cols.length, rows };
}

/** "Workflow — compare two groups" → "Compare two groups". */
function datasetName(name) {
	const t = (name ?? '').replace(/^Workflow\s*—\s*/, '');
	return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * The CSV's FILE name becomes the name of the imported data group, because the import pipeline
 * derives it from the url. So it is named for a human ("compare-two-groups.csv"), not for the
 * generator ("data-workflow-stats-two-group.csv") — provenance lives in the manifest instead.
 */
function datasetSlug(name) {
	return datasetName(name)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

// Build one searchable manifest entry. `keywords` collapses everything a user
// might type (display name, family, description, showcased node) so the modal
// search behaves like the node palette.
function manifestEntry({ id, name, family, description, summary, group, file, kind, showcases }) {
	return {
		id,
		name,
		family,
		description,
		// One-line card summary. The full `description` is written for the gallery's detail view
		// and is far too long for a card at start-screen density; `summary` is the short form.
		// Falls back to the description's first sentence so non-workflow entries still render.
		summary: summary ?? firstSentence(description),
		// Sub-grouping within a family (the start screen splits Workflows into
		// "Rhythm & circadian" / "General statistics"). Absent for other kinds.
		...(group ? { group } : {}),
		url: `sessions/demos/${file}`,
		kind,
		showcases,
		keywords: [name, description, family, ...showcases].filter(Boolean).join(' ').toLowerCase()
	};
}

/** First sentence of a description, for entries with no explicit `summary`. */
function firstSentence(text) {
	if (!text) return '';
	const m = String(text).match(/^.*?[.!?](?=\s|$)/);
	return (m ? m[0] : String(text)).trim();
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
			tidyPlots();
			const file = `demo-workflow-${wf.id}.json`;

			// The same demo, minus the analysis: a plain CSV of its source columns, listed under
			// Import data → Examples. Written BEFORE the session write, while core still holds the
			// built graph.
			const { csv, cols, rows } = sourceColumnsCsv();
			const csvFile = `${datasetSlug(wf.name)}.csv`;
			writeFileSync(join(OUT_DIR, csvFile), csv, 'utf8');
			manifest.push(
				manifestEntry({
					id: `dataset-workflow-${wf.id}`,
					name: datasetName(wf.name),
					family: 'Sources',
					description: `${wf.summary} Data only — ${cols} columns × ${rows} rows, no analysis.`,
					summary: wf.summary,
					group:
						wf.group ?? (wf.id.startsWith('stats-') ? 'General statistics' : 'Rhythm & circadian'),
					file: csvFile,
					kind: 'dataset',
					showcases: []
				})
			);

			write(
				file,
				manifestEntry({
					id: `workflow-${wf.id}`,
					name: wf.name,
					family: wf.family,
					description: wf.description,
					summary: wf.summary,
					// Sub-heading for the start screen. Explicit when a workflow declares one,
					// otherwise derived from the id convention.
					group:
						wf.group ?? (wf.id.startsWith('stats-') ? 'General statistics' : 'Rhythm & circadian'),
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
			tidyPlots();
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
			tidyPlots();
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
			tidyPlots();
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
		// Builds and writes ~100 sessions, every analysis actually run so its outputs bake in.
		// The 5s default is not a budget this was ever going to meet.
	}, 120_000);
});
