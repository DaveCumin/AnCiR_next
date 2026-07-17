// @ts-nocheck
//
// planEdit is the trust boundary: it turns a model's proposal into a plan, and everything it
// lets through gets applied to the user's open session by an op engine with no rollback. So
// these tests are mostly about what it REFUSES.
import { describe, it, expect } from 'vitest';
import { planEdit, summariseSession } from './aiEdit.js';

// Registry facts as the live registry reports them (see registryFacts).
const FACTS = {
	tps: {
		Cosinor: {
			scalar: ['xIN'],
			array: ['yIN'],
			yOutKeyPrefix: 'cosinory_',
			fixedOut: ['cosinorx', 'period', 'rsquared'],
			params: ['useFixedPeriod', 'fixedPeriod', 'nHarmonics']
		},
		Periodogram: {
			scalar: ['xIN'],
			array: ['yIN'],
			yOutKeyPrefix: null,
			fixedOut: ['pgx', 'pgy'],
			params: ['method']
		}
	},
	plots: {
		scatterplot: { inputs: ['x', 'y'] },
		actogram: { inputs: ['time', 'values'] },
		histogram: { inputs: ['column'] },
		tableplot: { inputs: [] }
	}
};

const SUMMARY = {
	columns: [
		{ id: 0, name: 'time', type: 'time' },
		{ id: 1, name: 'values', type: 'number' }
	],
	analyses: [{ id: 3, name: 'Cosinor', args: { xIN: 0, yIN: [1], fixedPeriod: 24 } }],
	plots: []
};

const plan = (spec, summary = SUMMARY) => planEdit(spec, { summary, facts: FACTS });

describe('planEdit — resolving what the model wrote', () => {
	it('resolves column names to ids and keeps known params', () => {
		const p = plan({
			analyses: [
				{ name: 'Cosinor', args: { xIN: 'time', yIN: ['values'], fixedPeriod: 12 } }
			]
		});
		expect(p.errors).toEqual([]);
		expect(p.analyses[0]).toMatchObject({
			tpType: 'Cosinor',
			inputs: { xIN: 0, yIN: [1] },
			params: { fixedPeriod: 12 }
		});
	});

	it('accepts a scalar where an array is expected, and matches names case-insensitively', () => {
		const p = plan({ analyses: [{ name: 'Cosinor', args: { xIN: 'Time', yIN: 'values' } }] });
		expect(p.errors).toEqual([]);
		expect(p.analyses[0].inputs).toEqual({ xIN: 0, yIN: [1] });
	});

	it('flattens a nested inputs/params wrapper, which models emit despite the flat contract', () => {
		const p = plan({
			analyses: [
				{ name: 'Cosinor', args: { inputs: { xIN: 'time', yIN: ['values'] }, params: { fixedPeriod: 8 } } }
			]
		});
		expect(p.errors).toEqual([]);
		expect(p.analyses[0].inputs).toEqual({ xIN: 0, yIN: [1] });
		expect(p.analyses[0].params).toEqual({ fixedPeriod: 8 });
	});

	it("plots a new analysis's fit by the name the model was taught, before the column exists", () => {
		// `cosinory_values` is prefix + Y NAME — the model can't know the id-keyed real name.
		// It must survive as a symbolic ref for phase 2 to resolve.
		const p = plan({
			analyses: [{ name: 'Cosinor', args: { xIN: 'time', yIN: ['values'] } }],
			plots: [
				{
					type: 'scatterplot',
					name: 'fit',
					series: [
						{ x: 'time', y: 'values', kind: 'points' },
						{ x: 'cosinorx', y: 'cosinory_values', kind: 'line' }
					]
				}
			]
		});
		expect(p.errors).toEqual([]);
		const [raw, fit] = p.plots[0].series;
		expect(raw.refs).toEqual({ x: { colId: 0 }, y: { colId: 1 } });
		// Analysis 0 of THIS plan, keyed by id — `cosinory_1`, not `cosinory_values`.
		expect(fit.refs).toEqual({
			x: { analysis: 0, outKey: 'cosinorx' },
			y: { analysis: 0, outKey: 'cosinory_1' }
		});
	});

	it("stores a plot's series under the fields the plot class actually reads", () => {
		// An actogram advertises time/values but persists x/y; writing the port name unwires it.
		const p = plan({ plots: [{ type: 'actogram', series: [{ time: 'time', values: 'values' }] }] });
		expect(p.errors).toEqual([]);
		expect(Object.keys(p.plots[0].series[0].refs)).toEqual(['x', 'y']);
		// A single-input plot keeps its own field name instead.
		const h = plan({ plots: [{ type: 'histogram', series: [{ column: 'values' }] }] });
		expect(Object.keys(h.plots[0].series[0].refs)).toEqual(['column']);
	});

	it('accepts the single-series `inputs` shorthand', () => {
		const p = plan({ plots: [{ type: 'scatterplot', inputs: { x: 'time', y: 'values' } }] });
		expect(p.errors).toEqual([]);
		expect(p.plots[0].series).toHaveLength(1);
	});

	it('changes a param on an existing analysis', () => {
		const p = plan({ changes: [{ analysis: 3, set: { fixedPeriod: 12 } }] });
		expect(p.errors).toEqual([]);
		expect(p.changes).toEqual([{ tpId: 3, key: 'fixedPeriod', value: 12 }]);
	});

	it('previews every change in words, so the user approves what will happen', () => {
		const p = plan({
			analyses: [{ name: 'Cosinor', args: { xIN: 'time', yIN: ['values'] } }],
			plots: [{ type: 'scatterplot', name: 'fit', series: [{ x: 'time', y: 'values' }] }]
		});
		expect(p.preview).toEqual([
			'Add analysis: Cosinor (xIN=time; yIN=values)',
			'Add plot: scatterplot — "fit" (1 series)'
		]);
	});
});

describe('planEdit — what it refuses', () => {
	it('rejects an invented analysis rather than passing it to the op engine', () => {
		const p = plan({ analyses: [{ name: 'MagicFit', args: {} }] });
		expect(p.analyses).toEqual([]);
		expect(p.errors[0]).toMatch(/Unknown analysis "MagicFit"/);
	});

	it('rejects a column that does not exist instead of guessing', () => {
		const p = plan({ analyses: [{ name: 'Cosinor', args: { xIN: 'time', yIN: ['activity'] } }] });
		expect(p.analyses).toEqual([]);
		expect(p.errors[0]).toMatch(/can't resolve yIN = "activity"/);
	});

	it('drops an invented parameter but keeps the node', () => {
		const p = plan({
			analyses: [{ name: 'Cosinor', args: { xIN: 'time', yIN: ['values'], wobble: 3 } }]
		});
		expect(p.analyses[0].params).toEqual({});
		expect(p.errors[0]).toMatch(/ignored unknown parameter "wobble"/);
	});

	it('never lets the model set `out` — output wiring is not its business', () => {
		const p = plan({
			analyses: [{ name: 'Cosinor', args: { xIN: 'time', yIN: ['values'], out: { cosinorx: 99 } } }]
		});
		expect(p.analyses[0].params).not.toHaveProperty('out');
		expect(p.errors).toEqual([]);
	});

	it('refuses to feed one new analysis from another new analysis in the same edit', () => {
		// Would need ordering + mid-phase re-resolution; wiring it to the wrong column is worse.
		const p = plan({
			analyses: [
                { name: 'Cosinor', args: { xIN: 'time', yIN: ['values'] } },
				{ name: 'Periodogram', args: { xIN: 'cosinorx', yIN: ['values'] } }
			]
		});
		expect(p.analyses).toHaveLength(1);
		expect(p.errors[0]).toMatch(/can't resolve xIN = "cosinorx"/);
	});

	it('rejects an unknown plot type and an unresolvable series', () => {
		expect(plan({ plots: [{ type: 'nope', series: [{ x: 'time', y: 'values' }] }] }).errors[0]).toMatch(
			/Unknown plot type "nope"/
		);
		expect(plan({ plots: [{ type: 'scatterplot', series: [{ x: 'time', y: 'ghost' }] }] }).plots).toEqual(
			[]
		);
	});

	it('rejects a plot type with no wireable inputs rather than adding an empty one', () => {
		const p = plan({ plots: [{ type: 'tableplot', series: [{}] }] });
		expect(p.plots).toEqual([]);
		expect(p.errors[0]).toMatch(/isn't supported for AI edits yet/);
	});

	it('refuses to change a node that is not there, or a param that does not exist', () => {
		expect(plan({ changes: [{ analysis: 99, set: { fixedPeriod: 1 } }] }).errors[0]).toMatch(
			/no such node/
		);
		expect(plan({ changes: [{ analysis: 3, set: { bogus: 1 } }] }).changes).toEqual([]);
	});

	it('has no delete vocabulary at all — deletions in a spec are simply not actioned', () => {
		const p = plan({ remove: [{ analysis: 3 }], delete: ['plot_1'] });
		expect(p).toMatchObject({ analyses: [], plots: [], changes: [] });
		expect(p.preview).toEqual([]);
	});

	it('survives junk without throwing — a model can emit anything', () => {
		expect(() => plan({})).not.toThrow();
		expect(() => plan({ analyses: null, plots: 'nope' })).not.toThrow();
		expect(() => plan({ analyses: [null, 42] })).not.toThrow();
		expect(() => plan({ plots: [{ type: 'scatterplot' }] })).not.toThrow();
	});
});

describe('summariseSession', () => {
	it('describes structure and never ships the data', () => {
		const s = summariseSession({
			data: [{ id: 0, name: 'time', type: 'time', data: 0 }],
			tableProcesses: [{ id: 3, name: 'Cosinor', args: { xIN: 0, out: { cosinorx: 5 } } }],
			plots: [{ id: 1, type: 'scatterplot', name: 'p' }],
			rawData: new Map([[0, [1, 2, 3]]])
		});
		expect(s.columns).toEqual([{ id: 0, name: 'time', type: 'time' }]);
		// `out` is ours to manage — exposing it invites the model to try to set it.
		expect(s.analyses[0].args).toEqual({ xIN: 0 });
		expect(JSON.stringify(s)).not.toMatch(/rawData/);
	});
});
