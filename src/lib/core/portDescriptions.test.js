// @ts-nocheck
// Port descriptions: what every node port expects or produces (portDescriptions.js). Three
// promises, guarded like the output labels (outputLabels.test.js):
//   1. every port of every node type in the manifest (table-processes, column transforms,
//      plots, incl. their metric outputs), every overlay channel, every dynamic statistic key
//      and every out key in the shipped demos has a description;
//   2. the text depends on the node's settings where the meaning does (units of x, phase
//      reference, model);
//   3. the text is short plain prose: sentences, no em-dashes, no raw ids.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
	NODE_PORT_DESCRIPTIONS,
	PROCESS_PORT_DESCRIPTIONS,
	PLOT_PORT_DESCRIPTIONS,
	OVERLAY_CHANNEL_DESCRIPTIONS,
	STAT_DESCRIPTIONS,
	manifestPortDescription,
	outputDescription,
	inputDescription,
	plotOutputDescription,
	statDescription,
	describeNodePort
} from './portDescriptions.js';
import { CHANNEL_TABLE } from '$lib/components/plotbits/overlaySpec.js';
import { getStatKeys as movingStatKeys } from '$lib/utils/movinganalysis.js';
import {
	getStatKeys as rhythmStatKeys,
	getOutputKeys as rhythmOutputKeys
} from '$lib/tableProcesses/RhythmicityAnalysis.svelte';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const manifest = JSON.parse(readFileSync(join(repo, 'static/nodes.json'), 'utf8'));

// Ports that may go without a description. Shrink-only; ideally empty.
const ALLOWED_UNDESCRIBED = new Set([]);

const KIND = { tableProcess: 'tableProcess', process: 'process', plot: 'plot' };
const ok = (d) => typeof d === 'string' && d.trim().length > 0;

// ---------------------------------------------------------------------------------------------
// 1. Coverage.
// ---------------------------------------------------------------------------------------------

describe('guard: every manifest port has a description', () => {
	for (const node of manifest.nodes) {
		for (const dir of ['in', 'out']) {
			for (const p of (dir === 'in' ? node.inputs : node.outputs) ?? []) {
				const tag = `${node.kind} ${node.id}.${dir}.${p.name}`;
				if (ALLOWED_UNDESCRIBED.has(tag)) continue;
				it(tag, () => {
					expect(ok(manifestPortDescription(KIND[node.kind], node.id, p.name, dir)), tag).toBe(
						true
					);
				});
			}
		}
	}

	it('the manifest carries each description (pnpm manifest:gen after a change)', () => {
		const missing = [];
		for (const node of manifest.nodes) {
			for (const p of [...(node.inputs ?? []), ...(node.outputs ?? [])]) {
				if (!ok(p.description)) missing.push(`${node.id}.${p.name}`);
			}
		}
		expect(missing).toEqual([]);
	});

	it('every node type has a table, and no table names a node that does not exist', () => {
		const ids = (kind) =>
			manifest.nodes
				.filter((n) => n.kind === kind)
				.map((n) => n.id)
				.sort();
		expect(Object.keys(NODE_PORT_DESCRIPTIONS).sort()).toEqual(ids('tableProcess'));
		expect(Object.keys(PROCESS_PORT_DESCRIPTIONS).sort()).toEqual(ids('process'));
		expect(Object.keys(PLOT_PORT_DESCRIPTIONS).sort()).toEqual(ids('plot'));
	});

	it('a plot table lists its data fields in the manifest order (x port first, y port second)', () => {
		for (const node of manifest.nodes.filter((n) => n.kind === 'plot')) {
			if (node.id === 'tableplot') continue; // one `series` port, not a data field
			expect(Object.keys(PLOT_PORT_DESCRIPTIONS[node.id].inputs), node.id).toEqual(
				node.inputs.map((i) => i.name)
			);
		}
	});

	it('no table describes a port the node does not have', () => {
		const stray = [];
		for (const node of manifest.nodes) {
			const table =
				node.kind === 'tableProcess'
					? NODE_PORT_DESCRIPTIONS[node.id]
					: node.kind === 'process'
						? PROCESS_PORT_DESCRIPTIONS[node.id]
						: PLOT_PORT_DESCRIPTIONS[node.id];
			const ins = new Set((node.inputs ?? []).map((p) => p.name));
			for (const k of Object.keys(table.inputs ?? {})) {
				if (node.id === 'tableplot' && k === 'series') continue;
				if (!ins.has(k)) stray.push(`${node.id}.in.${k}`);
			}
		}
		expect(stray).toEqual([]);
	});
});

describe('guard: every overlay channel has a description', () => {
	for (const [kind, forms] of Object.entries(CHANNEL_TABLE)) {
		for (const [form, channels] of Object.entries(forms)) {
			for (const { key } of channels) {
				it(`${kind}.${form}.${key}`, () => {
					expect(ok(OVERLAY_CHANNEL_DESCRIPTIONS[`${kind}.${form}.${key}`])).toBe(true);
				});
			}
		}
	}
});

// Every analysis/setting combination the per-stat families can emit.
const MOVING_ARGS = [
	{ analysis: 'summary' },
	{ analysis: 'periodogram', pgMethod: 'Lomb-Scargle' },
	{ analysis: 'periodogram', pgMethod: 'Chi-squared' },
	{ analysis: 'periodogram', pgMethod: 'Enright' },
	{ analysis: 'npcra' },
	{ analysis: 'cosinor', useFixedPeriod: true, nHarmonics: 3 },
	{ analysis: 'cosinor', useFixedPeriod: false, Ncurves: 2 },
	{ analysis: 'fft' },
	{ analysis: 'correlogram' },
	{ analysis: 'rectfit' },
	{ analysis: 'doublelogistic', dlPeriodic: true },
	{ analysis: 'trend', trendModel: 'linear' },
	{ analysis: 'trend', trendModel: 'exponential' },
	{ analysis: 'trend', trendModel: 'logarithmic' },
	{ analysis: 'trend', trendModel: 'polynomial', trendPolyDegree: 3 }
];
const RHYTHM_ARGS = [
	{ analysis: 'periodogram', pgMethod: 'Lomb-Scargle' },
	{ analysis: 'periodogram', pgMethod: 'Chi-squared' },
	{ analysis: 'periodogram', pgMethod: 'Enright' },
	{ analysis: 'fft' },
	{ analysis: 'correlogram' }
];

describe('guard: every dynamic statistic key has a description', () => {
	it('Moving window: <colId>_<stat> for every analysis', () => {
		const bad = [];
		for (const args of MOVING_ARGS) {
			for (const stat of movingStatKeys(args)) {
				if (!ok(outputDescription('MovingAnalysis', `66_${stat}`, { args })))
					bad.push(`${args.analysis}:${stat}`);
			}
		}
		expect(bad).toEqual([]);
	});
	it('Rhythmicity: stat_<stat> and the standalone <colId>_<key> arrays', () => {
		const bad = [];
		for (const args of RHYTHM_ARGS) {
			for (const stat of rhythmStatKeys(args)) {
				if (!ok(outputDescription('RhythmicityAnalysis', `stat_${stat}`, { args })))
					bad.push(`stat_${stat}`);
			}
			for (const key of rhythmOutputKeys(args)) {
				if (!ok(outputDescription('RhythmicityAnalysis', `66_${key}`, { args }))) bad.push(key);
			}
		}
		expect(bad).toEqual([]);
	});
	it('Fit trend coef_<name> for every model', () => {
		for (const c of ['slope', 'intercept', 'a', 'b', 'c0', 'c4']) {
			expect(ok(outputDescription('TrendFit', `coef_${c}`, {})), c).toBe(true);
		}
	});
	it('actogram rule outputs for any rule id', () => {
		for (const s of ['tau', 'phi', 'r2', 'rmse', 'n']) {
			expect(ok(plotOutputDescription('actogram', `r7_${s}`)), s).toBe(true);
		}
	});
});

describe('guard: every out key in the shipped demos has a description', () => {
	const dir = join(repo, 'static/sessions/demos');
	const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
	it.each(files)('%s', (file) => {
		const s = JSON.parse(readFileSync(join(dir, file), 'utf8'));
		const types = new Map((s.data ?? []).map((c) => [c.id, c.type]));
		const bad = [];
		for (const tp of s.tableProcesses ?? []) {
			for (const key of Object.keys(tp.args?.out ?? {})) {
				const d = outputDescription(tp.name, key, {
					args: tp.args,
					colType: (id) => types.get(id) ?? null
				});
				if (!ok(d)) bad.push(`${tp.name}.${key}`);
			}
		}
		for (const plot of s.plots ?? []) {
			for (const key of Object.keys(plot.metricOut ?? {})) {
				if (!ok(plotOutputDescription(plot.type, key))) bad.push(`${plot.type}.${key}`);
			}
		}
		expect(bad).toEqual([]);
	});
});

// ---------------------------------------------------------------------------------------------
// 2. Meaning follows the settings.
// ---------------------------------------------------------------------------------------------

describe('descriptions follow the node settings', () => {
	const types = { 5: 'number', 6: 'time' };
	const c = (args) => ({ args, colType: (id) => types[id] ?? null });

	it('units of x: hours for a time x, x units for a number x, both when unknown', () => {
		expect(outputDescription('Cosinor', 'period', c({ xIN: 6, useFixedPeriod: false }))).toMatch(
			/in hours\./
		);
		expect(outputDescription('Cosinor', 'period', c({ xIN: 5, useFixedPeriod: false }))).toMatch(
			/in x units\./
		);
		expect(outputDescription('Cosinor', 'period', c({}))).toMatch(/x units for a number x/);
	});

	it('phase frame: hours after the first sample, or clock time of day', () => {
		expect(outputDescription('Cosinor', 'acrophase', c({ xIN: 6 }))).toMatch(
			/after the first sample/
		);
		expect(
			outputDescription('Cosinor', 'acrophase', c({ xIN: 6, phaseReference: 'clock' }))
		).toMatch(/clock time of day/);
		expect(outputDescription('NonparametricRA', 'M10onset', c({ mWindow: 8 }))).toMatch(
			/most active 8 h/
		);
	});

	it('model-aware meanings (mesor, rmse, amplitude) and family-wise vs per-test p', () => {
		expect(outputDescription('FitFunction', 'mesor', c({ model: 'rectangular' }))).toMatch(
			/Midline/
		);
		expect(outputDescription('FitFunction', 'mesor', c({ model: 'doublelogistic' }))).toMatch(
			/Baseline/
		);
		expect(outputDescription('FitFunction', 'rmse', c({ model: 'cosinor' }))).toMatch(
			/Residual standard error/
		);
		expect(outputDescription('FitFunction', 'rmse', c({ model: 'rectangular' }))).toMatch(
			/sqrt\(SS \/ n\)/
		);
		expect(
			outputDescription('Cosinor', 'amplitude', c({ useFixedPeriod: true, nHarmonics: 2 }))
		).toMatch(/whole fitted waveform/);
		expect(outputDescription('Correlation', 'padj', {})).toMatch(/family-wise/);
		expect(outputDescription('Correlation', 'pvalue', {})).toMatch(/not corrected/);
		expect(
			outputDescription('RhythmicityAnalysis', 'stat_peak_pvalue', c({ analysis: 'periodogram' }))
		).toMatch(/Family-wise/);
	});

	it('metric outputs say they hold one value per wired y column', () => {
		expect(outputDescription('Cosinor', 'rsquared', {})).toMatch(/One value per wired y column\.$/);
		expect(outputDescription('MovingAnalysis', '66_mean', c({ analysis: 'summary' }))).toMatch(
			/One row per window\.$/
		);
	});

	it('inputs say what fits and what happens when left empty', () => {
		expect(inputDescription('Cosinor', 'xIN', {})).toMatch(/time column.*Required/);
		expect(inputDescription('RayleighTest', 'timeIN', {})).toMatch(/Optional.*Empty/);
		expect(inputDescription('GroupComparison', 'xIN', {})).toMatch(/Empty: each y column/);
	});
});

describe('describeNodePort: one resolver for every node card', () => {
	const col = (id) => ({ 3: { id: 3, type: 'time' }, 4: { id: 4, type: 'category' } })[id] ?? null;
	const env = { col, colType: (id) => col(id)?.type ?? null };

	it('table-process inputs and outputs (output port col_<id> resolves its key)', () => {
		const node = {
			type: 'tableprocess',
			tpName: 'Cosinor',
			tpObj: { id: 2, name: 'Cosinor', args: { xIN: 3, phaseReference: 'clock' } },
			outputColumns: [{ key: 'acrophase', colId: 40, port: 'col_40' }]
		};
		expect(describeNodePort(node, { name: 'xIN' }, 'in', env)).toMatch(/^One time column/);
		expect(describeNodePort(node, { name: 'col_40' }, 'out', env)).toMatch(/clock time of day/);
	});

	it('plots: series x/y ports, the data port, overlays, passthroughs and metrics', () => {
		const node = {
			type: 'plot',
			plotObj: {
				type: 'periodogram',
				plot: { overlays: [{ id: 3, kind: 'band', form: 'vertical' }] }
			},
			outputColumns: [{ key: 'peak_period', colId: 9, port: 'col_9' }]
		};
		expect(describeNodePort(node, { name: 'x1' }, 'in', env)).toBe(
			PLOT_PORT_DESCRIPTIONS.periodogram.inputs.time
		);
		expect(describeNodePort(node, { name: 'ys2' }, 'in', env)).toBe(
			PLOT_PORT_DESCRIPTIONS.periodogram.inputs.values
		);
		expect(describeNodePort(node, { name: 'ov3_start' }, 'in', env)).toMatch(/Start of each/);
		expect(describeNodePort(node, { name: 'ovnew_line' }, 'in', env)).toMatch(/reference line/);
		expect(describeNodePort(node, { name: 'col_9' }, 'out', env)).toMatch(/^Period of/);
		expect(describeNodePort(node, { name: 'col_5', passthrough: true }, 'out', env)).toMatch(
			/passed on/
		);
		const hist = { type: 'plot', plotObj: { type: 'histogram', plot: {} } };
		expect(describeNodePort(hist, { name: 'data' }, 'in', env)).toMatch(/histogram/);
		const table = { type: 'plot', plotObj: { type: 'tableplot', plot: {} } };
		expect(describeNodePort(table, { name: 'series' }, 'in', env)).toMatch(/table/);
	});

	it('column transforms, groups, data nodes and composites', () => {
		const proc = { type: 'process', processName: 'Multiply' };
		expect(describeNodePort(proc, { name: 'input' }, 'in', env)).toBe('A number column.');
		expect(describeNodePort(proc, { name: 'out_7' }, 'out', env)).toMatch(/times the value/);
		expect(describeNodePort({ type: 'group' }, { name: 'col_3' }, 'out', env)).toMatch(
			/time column/
		);
		expect(describeNodePort({ type: 'data', refId: 4 }, { name: 'column' }, 'out', env)).toMatch(
			/category \(text\) column/
		);
		expect(
			describeNodePort({ meta: { type: 'composite' } }, { name: 'in:a|b' }, 'in', env)
		).toMatch(/inside this composite/);
	});
});

// ---------------------------------------------------------------------------------------------
// 3. Style.
// ---------------------------------------------------------------------------------------------

function allTexts() {
	const out = [];
	const ctxs = [
		{},
		{
			args: { phaseReference: 'clock', useFixedPeriod: true, nHarmonics: 2, model: 'rectangular' }
		},
		{ args: { analysis: 'correlogram', pgMethod: 'Chi-squared', model: 'doublelogistic' } }
	];
	const push = (tag, v) => {
		for (const ctx of ctxs) out.push([tag, typeof v === 'function' ? v(ctx) : v]);
	};
	for (const [n, t] of Object.entries(NODE_PORT_DESCRIPTIONS)) {
		for (const [k, v] of Object.entries(t.inputs ?? {})) push(`${n}.in.${k}`, v);
		for (const [k, v] of Object.entries(t.outputs ?? {})) push(`${n}.out.${k}`, v);
	}
	for (const [n, t] of Object.entries({
		...PROCESS_PORT_DESCRIPTIONS,
		...PLOT_PORT_DESCRIPTIONS
	})) {
		for (const [k, v] of Object.entries({ ...t.inputs, ...t.outputs })) push(`${n}.${k}`, v);
	}
	for (const [k, v] of Object.entries(OVERLAY_CHANNEL_DESCRIPTIONS)) push(k, v);
	for (const k of Object.keys(STAT_DESCRIPTIONS))
		push(`stat.${k}`, (ctx) => statDescription(k, ctx));
	for (const k of ['H2_amplitude', 'H2_acrophase', 'C1_period', 'C1_phase', 'C1_acrophase', 'c3'])
		push(`stat.${k}`, (ctx) => statDescription(k, ctx));
	return out;
}

describe('style: short plain sentences', () => {
	const texts = allTexts();
	it('no em-dashes', () => {
		expect(texts.filter(([, t]) => /—/.test(t)).map(([k]) => k)).toEqual([]);
	});
	it('each is one or two short sentences ending in a full stop', () => {
		const bad = texts
			.filter(([, t]) => !/\.$/.test(t) || t.length > 200)
			.map(([k, t]) => `${k} (${t.length})`);
		expect(bad).toEqual([]);
	});
	it('no raw argument names or ids leak into the prose', () => {
		const bad = texts
			.filter(([, t]) => /\b\w+IN\b|_\w|undefined|null|NaN/.test(t))
			.map(([k, t]) => `${k}: ${t}`);
		expect(bad).toEqual([]);
	});
});

describe('metric outputs say how many values they hold', () => {
	// The canvas tooltip drops its generic "(one value per series)" when a description is
	// given (portLabels.js), so the description must state the shape itself.
	const SHAPE = /one value|one row|per (wired y column|series|window|pair|term|column)/i;
	for (const node of manifest.nodes) {
		for (const o of (node.outputs ?? []).filter((x) => x.metric)) {
			it(`${node.id}.${o.name}`, () => {
				expect(manifestPortDescription(KIND[node.kind], node.id, o.name, 'out')).toMatch(SHAPE);
			});
		}
	}
});
