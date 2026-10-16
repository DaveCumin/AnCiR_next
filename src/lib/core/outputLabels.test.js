// @ts-nocheck
// Display labels for node outputs (review finding UI-4). Three promises:
//   1. each covered node's outputs read as words with units, not ids;
//   2. keys, column ids and stored names never change, and a name a person chose wins;
//   3. every output the registry declares (and every key the shipped demos carry) resolves to a
//      label, so a new node or key cannot silently fall back to its raw id.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
	outputLabel,
	isAutoOutputName,
	plotOutputLabel,
	createColumnNamer,
	NODE_OUTPUT_LABELS
} from './outputLabels.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const names = { 66: 'A1', 67: 'A2', 12: 'Activity' };
const ctx = (args = {}, ownerId = 5) => ({
	args,
	ownerId,
	colName: (id) => names[id] ?? null
});

describe('outputLabel: per node type', () => {
	it('Cosinor: metrics carry units; per-input curves name their input', () => {
		const c = ctx();
		expect(outputLabel('Cosinor', 'period', c)).toBe('Period (h)');
		expect(outputLabel('Cosinor', 'acrophase', c)).toBe('Acrophase (h)');
		expect(outputLabel('Cosinor', 'rsquared', c)).toBe('R²');
		expect(outputLabel('Cosinor', 'pvalue', c)).toBe('p-value');
		expect(outputLabel('Cosinor', 'perm_pvalue', c)).toBe('Permutation p-value');
		expect(outputLabel('Cosinor', 'mesor', c)).toBe('Mesor');
		expect(outputLabel('Cosinor', 'bathyphase', c)).toBe('Bathyphase (h)');
		expect(outputLabel('Cosinor', 'acrophase_ciLow', c)).toBe('Acrophase CI low (h)');
		expect(outputLabel('Cosinor', 'cosinorx', c)).toBe('Cosinor fit: x');
		expect(outputLabel('Cosinor', 'cosinory_66', c)).toBe('Cosinor fit: A1');
		expect(outputLabel('Cosinor', 'resid_67', c)).toBe('Residuals: A2');
	});

	it('FIT-15: the fixed-period cosinor rmse (sqrt(SS/(n - p))) reads Residual SE', () => {
		expect(outputLabel('Cosinor', 'rmse', ctx({ useFixedPeriod: true }))).toBe('Residual SE');
		expect(outputLabel('Cosinor', 'rmse', ctx({ useFixedPeriod: false }))).toBe('RMSE');
		// Fit waveform model: fixed period is its default; other models' rmse is sqrt(SS/n).
		expect(outputLabel('FitFunction', 'rmse', ctx({ model: 'cosinor' }))).toBe('Residual SE');
		expect(
			outputLabel('FitFunction', 'rmse', ctx({ model: 'cosinor', useFixedPeriod: false }))
		).toBe('RMSE');
		expect(outputLabel('FitFunction', 'rmse', ctx({ model: 'rectangular' }))).toBe('RMSE');
		const fixed = ctx({ analysis: 'cosinor', useFixedPeriod: true });
		expect(outputLabel('MovingAnalysis', '66_rmse', fixed)).toBe('Residual SE: A1');
		expect(outputLabel('MovingAnalysis', '66_rmse', ctx({ analysis: 'cosinor' }))).toBe('RMSE: A1');
		expect(outputLabel('MovingAnalysis', '66_rmse', ctx({ analysis: 'rectfit' }))).toBe('RMSE: A1');
		expect(outputLabel('RectangularWave', 'rmse', ctx())).toBe('RMSE');
	});

	it('FIT-16: the rectangular wave M reads Midline (the key stays mesor)', () => {
		expect(outputLabel('FitFunction', 'mesor', ctx({ model: 'rectangular' }))).toBe('Midline');
		expect(outputLabel('FitFunction', 'mesor', ctx({ model: 'cosinor' }))).toBe('Mesor');
		expect(outputLabel('MovingAnalysis', '66_mesor', ctx({ analysis: 'rectfit' }))).toBe(
			'Midline: A1'
		);
		expect(outputLabel('MovingAnalysis', '66_mesor', ctx({ analysis: 'cosinor' }))).toBe(
			'Mesor: A1'
		);
	});

	it('the fixed-period cosinor rmse_n (sqrt(SS/n)) reads RMSE, beside its Residual SE', () => {
		expect(outputLabel('FitFunction', 'rmse_n', ctx({ model: 'cosinor' }))).toBe('RMSE');
		const fixed = ctx({ analysis: 'cosinor', useFixedPeriod: true });
		expect(outputLabel('MovingAnalysis', '66_rmse_n', fixed)).toBe('RMSE: A1');
		expect(outputLabel('MovingAnalysis', '66_rmse', fixed)).toBe('Residual SE: A1');
	});

	it('the double-logistic M reads Baseline (the key stays mesor)', () => {
		expect(outputLabel('FitFunction', 'mesor', ctx({ model: 'doublelogistic' }))).toBe('Baseline');
		expect(outputLabel('MovingAnalysis', '66_mesor', ctx({ analysis: 'doublelogistic' }))).toBe(
			'Baseline: A1'
		);
	});

	it('SPEC-9: the nodes\u2019 chi-squared peak p is the family-wise one, as on the plot', () => {
		const c = ctx({ analysis: 'periodogram', pgMethod: 'Chi-squared' });
		expect(outputLabel('RhythmicityAnalysis', 'stat_peak_pvalue', c)).toBe('Peak p (family-wise)');
		expect(outputLabel('MovingAnalysis', '66_peak_pvalue', c)).toBe('Peak p (family-wise): A1');
	});

	it('Rayleigh R is the mean vector length, never confused with R²', () => {
		expect(outputLabel('RayleighTest', 'R', ctx())).toBe('Mean vector length (R)');
		expect(outputLabel('RayleighTest', 'ww_pvalue', ctx())).toBe('Watson-Williams p-value');
		expect(outputLabel('RayleighTest', 'F', ctx())).toBe('Watson-Williams F');
	});

	it('Rayleigh acrophase follows the angle unit, and is hours when time-wired', () => {
		expect(outputLabel('RayleighTest', 'acrophase', ctx({ unit: 'degrees' }))).toBe(
			'Acrophase (°)'
		);
		expect(outputLabel('RayleighTest', 'acrophase', ctx({ unit: 'radians' }))).toBe(
			'Acrophase (rad)'
		);
		expect(outputLabel('RayleighTest', 'acrophase', ctx({ unit: 'radians', timeIN: 3 }))).toBe(
			'Acrophase (h)'
		);
	});

	it('Rhythmicity and moving-window stats: stat_ ports and per-input stat columns', () => {
		const c = ctx({ analysis: 'periodogram' });
		expect(outputLabel('RhythmicityAnalysis', 'stat_peak_period', c)).toBe('Peak period (h)');
		expect(outputLabel('RhythmicityAnalysis', 'stat_peak_power', c)).toBe('Peak power');
		expect(outputLabel('RhythmicityAnalysis', '12_period', c)).toBe('Period (h): Activity');
		expect(outputLabel('RhythmicityAnalysis', 'rhythmicityy_66', c)).toBe('Power: A1');
		expect(outputLabel('MovingAnalysis', '66_H1_acrophase', ctx())).toBe('H1 acrophase (h): A1');
		// M10 / L5 keep their keys; the labels follow the configured windows.
		expect(outputLabel('NonparametricRA', 'M10', ctx({ mWindow: 8 }))).toBe(
			'M8 (most active 8 h mean)'
		);
		expect(outputLabel('NonparametricRA', 'L5onset', ctx())).toBe('L5 onset (h)');
		expect(outputLabel('MovingAnalysis', '66_percentile', ctx({ summaryPercentile: 90 }))).toBe(
			'Percentile (P90): A1'
		);
	});

	it('method-aware statistics name the statistic that ran', () => {
		expect(outputLabel('GroupComparison', 'statistic', ctx({ method: 'anova' }))).toBe(
			'Test statistic (F)'
		);
		expect(outputLabel('GroupComparison', 'effectSize', ctx({ method: 'ttest' }))).toBe(
			"Effect size (Cohen's d)"
		);
		expect(outputLabel('ChiSquared', 'effectSize', ctx({ testType: 'goodness' }))).toBe(
			"Effect size (Cohen's w)"
		);
	});

	it('dynamic shapes: split segments, long-to-wide values, stored-value groups', () => {
		expect(outputLabel('Split', '66_2', ctx())).toBe('Segment 2: A1');
		expect(outputLabel('LongToWide', 'value_B', ctx())).toBe('Value: B');
		expect(
			outputLabel('StoredValueGroup', 'group_g1', ctx({ groups: [{ id: 'g1', name: 'Dark' }] }))
		).toBe('Dark');
		expect(outputLabel('TrendFit', 'coef_slope', ctx())).toBe('Slope');
	});

	it('plot metric outputs', () => {
		expect(plotOutputLabel('periodogram', 'peak_period')).toBe('Peak period (h)');
		expect(plotOutputLabel('fft', 'peak_frequency')).toBe('Peak frequency (1/h)');
		expect(plotOutputLabel('scatterplot', 'peak_period')).toBeNull();
	});

	it('uncovered nodes and keys return null (caller keeps the column name)', () => {
		expect(outputLabel('NoSuchNode', 'period', ctx())).toBeNull();
		expect(outputLabel('Cosinor', 'zz_unknown', ctx())).toBeNull();
	});
});

describe('isAutoOutputName: only seeded names are replaced', () => {
	it('recognises every shape a node seeds', () => {
		expect(isAutoOutputName('Cosinor', 'rsquared', 'rsquared_5', ctx())).toBe(true);
		expect(isAutoOutputName('Cosinor', 'cosinory_66', 'cosinory_66_5', ctx())).toBe(true);
		expect(isAutoOutputName('Cosinor', 'cosinory_66', 'cosinor_A1', ctx())).toBe(true);
		expect(isAutoOutputName('Cosinor', 'resid_66', 'resid_A1', ctx())).toBe(true);
		expect(
			isAutoOutputName('RhythmicityAnalysis', 'stat_peak_period', 'peak_period_3', ctx({}, 3))
		).toBe(true);
		expect(isAutoOutputName('RhythmicityAnalysis', '12_period', 'Activity_period', ctx())).toBe(
			true
		);
		expect(isAutoOutputName('Split', '66_2', 'A1_split2', ctx())).toBe(true);
		expect(isAutoOutputName('Sort', 'sortedy_66', 'A1 sorted', ctx())).toBe(true);
	});

	it('a name a person typed is never auto', () => {
		expect(isAutoOutputName('Cosinor', 'rsquared', 'Fit quality', ctx())).toBe(false);
		expect(isAutoOutputName('Cosinor', 'rsquared', 'rsquared_6', ctx())).toBe(false);
		expect(
			isAutoOutputName('RhythmicityAnalysis', 'stat_peak_period', 'Peak period (h)', ctx({}, 3))
		).toBe(false);
	});
});

// A minimal core-shaped session: two inputs, one Cosinor, one periodogram plot metric.
function session() {
	const col = (id, name) => ({ id, name });
	const data = [
		col(66, 'A1'),
		col(67, 'A2'),
		col(100, 'cosinory_66_5'),
		col(101, 'rsquared_5'),
		col(102, 'My amplitude'),
		col(103, 'resid_A1'),
		col(104, 'peak_period_9'),
		col(105, 'mystery_5')
	];
	const tableProcesses = [
		{
			id: 5,
			name: 'Cosinor',
			args: {
				yIN: [66, 67],
				out: { cosinory_66: 100, rsquared: 101, amplitude: 102, resid_66: 103, zz_new: 105 }
			}
		}
	];
	const plots = [{ id: 9, type: 'periodogram', plot: {}, metricOut: { peak_period: 104 } }];
	return { data, tableProcesses, plots };
}

describe('createColumnNamer: display over a session', () => {
	it('autoNameFor: the label text maps back to a seeded name; other text does not', () => {
		const s = session();
		const namer = createColumnNamer(s);
		const col = s.data.find((c) => c.id === 102);
		expect(namer.autoNameFor(col, 'Amplitude')).toBe('amplitude_5');
		expect(namer.autoNameFor(col, ' Amplitude ')).toBe('amplitude_5');
		expect(namer.autoNameFor(col, 'Amplitude (h)')).toBeNull();
		const peak = s.data.find((c) => c.id === 104);
		expect(namer.autoNameFor(peak, 'Peak period (h)')).toBe('peak_period_9');
		expect(
			namer.autoNameFor(
				s.data.find((c) => c.id === 66),
				'A1'
			)
		).toBeNull();
	});
	it('auto names show the label; ids, keys and stored names are unchanged', () => {
		const s = session();
		const before = JSON.stringify(s);
		const namer = createColumnNamer(s);
		const byId = (id) => namer(s.data.find((c) => c.id === id));
		expect(byId(100)).toBe('Cosinor fit: A1');
		expect(byId(101)).toBe('R²');
		expect(byId(103)).toBe('Residuals: A1');
		expect(byId(104)).toBe('Peak period (h)');
		expect(JSON.stringify(s)).toBe(before);
	});

	it('a user-renamed column keeps its name', () => {
		const s = session();
		const namer = createColumnNamer(s);
		expect(namer(s.data.find((c) => c.id === 102))).toBe('My amplitude');
	});

	it('uncovered keys and non-output columns keep their own name', () => {
		const s = session();
		const namer = createColumnNamer(s);
		expect(namer(s.data.find((c) => c.id === 105))).toBe('mystery_5');
		expect(namer(s.data.find((c) => c.id === 66))).toBe('A1');
	});

	it('input names are display-resolved (a residual of a fitted curve)', () => {
		const s = session();
		s.tableProcesses.push({ id: 6, name: 'SmoothedData', args: { out: { resid_100: 106 } } });
		s.data.push({ id: 106, name: 'resid_cosinory_66_5' });
		const namer = createColumnNamer(s);
		expect(namer(s.data.at(-1))).toBe('Residuals: Cosinor fit: A1');
	});
});

// ---------------------------------------------------------------------------------------------
// Guard: every registered output, and every out key the shipped demos carry, resolves.
// ---------------------------------------------------------------------------------------------

// Manifest entries that are not one column with a key shape of their own: bundle ports, and
// manifest placeholders for families whose real keys are listed by the demo sweep below.
const ACCEPTABLE_UNLABELLED = new Set([
	'ColumnSet:set', // a column-set bundle wire, not a column
	'CollectColumns:outCols', // placeholder; real keys are col_<id>
	'MovingAnalysis:stats_*', // placeholder; real keys are <colId>_<stat>
	'Split:segments' // placeholder; real keys are <colId>_<segment>
]);

// A realistic key tail for dynamic families whose tail is not an input column id.
const SAMPLE_SUFFIX = { stat_: 'peak_period', coef_: 'slope', value_: 'A' };

const manifest = JSON.parse(readFileSync(join(repo, 'static/nodes.json'), 'utf8'));
// Labels never carry an underscore; a label equal to its key is an id unless it is a standard
// symbol people read as-is.
const STANDARD_SYMBOLS = new Set(['n']);
const isIdLike = (label, key) =>
	!label || label.includes('_') || (label === key && !STANDARD_SYMBOLS.has(label));

describe('guard: registered outputs resolve to a label', () => {
	const tps = manifest.nodes.filter((n) => n.kind === 'tableProcess');
	for (const node of tps) {
		for (const o of node.outputs ?? []) {
			const tag = `${node.id}:${o.name}`;
			if (ACCEPTABLE_UNLABELLED.has(tag)) continue;
			it(tag, () => {
				const key = o.dynamicPrefix
					? `${o.dynamicPrefix}${SAMPLE_SUFFIX[o.dynamicPrefix] ?? '66'}`
					: o.name;
				const label = outputLabel(node.id, key, ctx({}));
				expect(isIdLike(label, key), `${tag} -> ${label}`).toBe(false);
			});
		}
	}

	for (const node of manifest.nodes.filter((n) => n.kind === 'plot')) {
		for (const o of node.outputs ?? []) {
			if (o.dynamicSuffix) continue; // actogram rules: labelled by the plot's own def
			it(`plot ${node.id}:${o.name}`, () => {
				expect(isIdLike(plotOutputLabel(node.id, o.name), o.name)).toBe(false);
			});
		}
	}

	it('every table-process in the manifest has a label table', () => {
		const missing = tps
			.filter((n) => (n.outputs ?? []).some((o) => !ACCEPTABLE_UNLABELLED.has(`${n.id}:${o.name}`)))
			.map((n) => n.id)
			.filter((id) => !NODE_OUTPUT_LABELS[id]);
		expect(missing).toEqual([]);
	});
});

describe('guard: every out key in the shipped demos resolves, keys unchanged', () => {
	const dir = join(repo, 'static/sessions/demos');
	const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
	it.each(files)('%s', (file) => {
		const s = JSON.parse(readFileSync(join(dir, file), 'utf8'));
		const before = JSON.stringify(s);
		const namer = createColumnNamer(s);
		const bad = [];
		for (const tp of s.tableProcesses ?? []) {
			for (const [key, colId] of Object.entries(tp.args?.out ?? {})) {
				if (typeof colId !== 'number' || colId < 0) continue;
				const col = (s.data ?? []).find((c) => c.id === colId);
				if (!col) continue;
				const shown = namer(col);
				// A demo author's own name (e.g. "Peak period (h)") is kept verbatim.
				if (
					!isAutoOutputName(tp.name, key, col.name, {
						args: tp.args,
						ownerId: tp.id,
						colName: () => ''
					})
				) {
					expect(shown).toBe(col.name);
					continue;
				}
				if (isIdLike(shown, key)) bad.push(`${tp.name}.${key} -> ${shown}`);
			}
		}
		expect(bad).toEqual([]);
		// The namer never writes: the session serialises identically.
		expect(JSON.stringify(s)).toBe(before);
	});
});

describe('phase outputs say which reference they use (review FIT-9, FIT-13)', () => {
	it('Cosinor: default labels unchanged; clock time and overall waveform say so', () => {
		expect(outputLabel('Cosinor', 'acrophase', ctx({ phaseReference: 'clock' }))).toBe(
			'Acrophase (clock time, h)'
		);
		expect(outputLabel('Cosinor', 'acrophase_ciLow', ctx({ phaseReference: 'clock' }))).toBe(
			'Acrophase CI low (clock time, h)'
		);
		const multi = { useFixedPeriod: true, nHarmonics: 2 };
		expect(outputLabel('Cosinor', 'amplitude', ctx(multi))).toBe('Overall amplitude');
		expect(outputLabel('Cosinor', 'acrophase', ctx(multi))).toBe('Orthophase, overall peak (h)');
		expect(outputLabel('Cosinor', 'bathyphase', ctx(multi))).toBe('Bathyphase, overall trough (h)');
		expect(outputLabel('Cosinor', 'acrophase_h1', ctx(multi))).toBe('H1 acrophase (h)');
		expect(outputLabel('Cosinor', 'amplitude_h1', ctx(multi))).toBe('H1 amplitude');
		expect(outputLabel('Cosinor', 'amplitude_ciLow', ctx(multi))).toBe('H1 amplitude CI low');
		// Free period: nHarmonics does not apply.
		expect(outputLabel('Cosinor', 'amplitude', ctx({ useFixedPeriod: false, nHarmonics: 2 }))).toBe(
			'Amplitude'
		);
	});
	it('NonparametricRA, AverageProfile, FitFunction and Moving analysis', () => {
		const clock = { phaseReference: 'clock' };
		expect(outputLabel('NonparametricRA', 'M10onset', ctx(clock))).toBe(
			'M10 onset (clock time, h)'
		);
		expect(outputLabel('NonparametricRA', 'npcrax', ctx(clock))).toBe(
			'Average day: time (clock time, h)'
		);
		expect(outputLabel('AverageProfile', 'avgprofx', ctx())).toBe('Profile time (h)');
		expect(outputLabel('FitFunction', 'onset', ctx(clock))).toBe('Onset (clock time, h)');
		expect(outputLabel('MovingAnalysis', '66_C1_acrophase', ctx(clock))).toBe(
			'C1 acrophase (clock time, h): A1'
		);
		// C<c>_phase is the model phase angle, in radians, not a time of peak.
		expect(outputLabel('MovingAnalysis', '66_C1_phase', ctx())).toBe('C1 phase φ (rad): A1');
		// Moving analysis names its NPCRA windows npcraMWindow / npcraLWindow.
		expect(outputLabel('MovingAnalysis', '66_M10onset', ctx({ npcraMWindow: 6 }))).toBe(
			'M6 onset (h): A1'
		);
	});
});

describe('free-period fits label periods and phases in the units of their x (v80.1)', () => {
	// x column 5 is a number column (an x in days, say), 6 a time column.
	const types = { 5: 'number', 6: 'time' };
	const fitCtx = (xIN, args = {}) => ({
		args: { xIN, ...args },
		ownerId: 9,
		colName: () => null,
		colType: (id) => types[id] ?? null
	});

	it('a number x reads "x units"; a time x, or an unknown one, keeps hours', () => {
		for (const [key, name] of [
			['period', 'Period'],
			['acrophase', 'Acrophase'],
			['bathyphase', 'Bathyphase'],
			['acrophase_h1', 'H1 acrophase'],
			['bathyphase_h1', 'H1 bathyphase'],
			['acrophase_ciLow', 'Acrophase CI low'],
			['phase_angle', 'Phase angle']
		]) {
			expect(outputLabel('Cosinor', key, fitCtx(5)), key).toBe(`${name} (x units)`);
			expect(outputLabel('Cosinor', key, fitCtx(6)), key).toBe(`${name} (h)`);
			expect(outputLabel('Cosinor', key, fitCtx(-1)), key).toBe(`${name} (h)`);
			expect(outputLabel('Cosinor', key, ctx()), key).toBe(`${name} (h)`);
		}
		for (const [key, name] of [
			['period', 'Period'],
			['acrophase', 'Acrophase'],
			['onset', 'Onset'],
			['offset', 'Offset']
		]) {
			expect(outputLabel('FitFunction', key, fitCtx(5)), key).toBe(`${name} (x units)`);
			expect(outputLabel('FitFunction', key, fitCtx(6)), key).toBe(`${name} (h)`);
		}
		expect(outputLabel('FitFunction', 'k1', fitCtx(5))).toBe('Rise rate k1 (1/x unit)');
		expect(outputLabel('FitFunction', 'k2', fitCtx(6))).toBe('Fall rate k2 (1/h)');
	});

	it('clock time (a time x only) stays hours of the clock', () => {
		expect(outputLabel('Cosinor', 'acrophase', fitCtx(6, { phaseReference: 'clock' }))).toBe(
			'Acrophase (clock time, h)'
		);
	});

	it('the session namer passes the x column type through', () => {
		const state = {
			data: [
				{ id: 5, name: 'Time (days)', type: 'number' },
				{ id: 20, name: 'period_9', type: 'number' }
			],
			tableProcesses: [{ id: 9, name: 'Cosinor', args: { xIN: 5, out: { period: 20 } } }],
			plots: []
		};
		const namer = createColumnNamer(state);
		expect(namer(state.data[1])).toBe('Period (x units)');
		state.data[0].type = 'time';
		expect(createColumnNamer(state)(state.data[1])).toBe('Period (h)');
	});
});
