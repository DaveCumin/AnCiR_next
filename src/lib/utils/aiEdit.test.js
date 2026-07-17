// @ts-nocheck
//
// planEdit is the trust boundary: it turns a model's proposal into a plan, and everything it
// lets through gets applied to the user's open session by an op engine with no rollback. So
// these tests are mostly about what it REFUSES.
import { describe, it, expect } from 'vitest';
import { planEdit, summariseSession, bandDuration, firstBandStart, plotProps } from './aiEdit.js';

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
		scatterplot: { inputs: ['x', 'y'], supportsBands: true },
		actogram: { inputs: ['time', 'values'], supportsBands: false },
		histogram: { inputs: ['column'], supportsBands: false },
		tableplot: { inputs: [], supportsBands: false }
	}
};

const SUMMARY = {
	columns: [
		{ id: 0, name: 'time', type: 'time' },
		{ id: 1, name: 'values', type: 'number' }
	],
	analyses: [{ id: 3, name: 'Cosinor', args: { xIN: 0, yIN: [1], fixedPeriod: 24 } }],
	plots: [
		{
			id: 2,
			type: 'scatterplot',
			name: 'Raw',
			// As getSharedSchema reports them: `input` is INFERRED from the current value, so a
			// null-defaulted axis limit says 'text' even though it wants a number.
			props: [
				{ path: 'width', label: 'Width', input: 'number', value: 420 },
				{ path: 'plot.ylimsLeftIN[0]', label: 'Y min', input: 'text', value: null },
				{ path: 'plot.xLogScale', label: 'X Log Scale', input: 'boolean', value: false },
				{
					path: 'plot.sigMethod',
					label: 'Method',
					input: 'select',
					options: ['auto', 'tukey'],
					value: 'auto'
				},
				// Per-series, from getSharedDataSchema — where colours actually live.
				{ path: 'plot.data[0].line.colour', label: 'signal: Line Colour', input: 'text', value: '#234154' },
				{ path: 'plot.data[1].line.colour', label: 'signal fit: Line Colour', input: 'text', value: '#BE796B' }
			]
		},
		{ id: 5, type: 'actogram', name: 'Acto', props: [] }
	]
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

// "add shading to the scatterplot to indicate times between 6pm and 6am each day" — a plain
// chronobiology request (the dark phase of a light/dark cycle) that AnCiR has always supported
// via the plot's Bands tab, but which the AI had no verb for and simply refused.
describe('planEdit — shading a time-of-day window', () => {
	it('turns clock hours into a band, wrapping midnight', () => {
		const p = plan({ bands: [{ plot: 2, fromHour: 18, toHour: 6 }] });
		expect(p.errors).toEqual([]);
		// 18:00 → 06:00 is 12 h, not -12.
		expect(p.bands).toEqual([{ plotId: 2, fromHour: 18, durationHours: 12, label: 'Night' }]);
		expect(p.preview).toEqual(['Shade scatterplot "Raw": 18:00–06:00 each day']);
	});

	it('handles a window inside one day, and a half hour', () => {
		expect(plan({ bands: [{ plot: 2, fromHour: 8, toHour: 20 }] }).bands[0].durationHours).toBe(12);
		expect(plan({ bands: [{ plot: 2, fromHour: 22.5, toHour: 6 }] }).bands[0]).toMatchObject({
			fromHour: 22.5,
			durationHours: 7.5
		});
	});

	it('refuses a plot type that cannot shade, rather than pretending', () => {
		const p = plan({ bands: [{ plot: 5, fromHour: 18, toHour: 6 }] });
		expect(p.bands).toEqual([]);
		expect(p.errors[0]).toMatch(/actogram doesn't support shading/);
	});

	it('refuses nonsense hours and zero-width windows', () => {
		expect(plan({ bands: [{ plot: 2, fromHour: 18, toHour: 18 }] }).errors[0]).toMatch(/covers nothing/);
		expect(plan({ bands: [{ plot: 2, fromHour: 25, toHour: 6 }] }).errors[0]).toMatch(/clock hours 0–24/);
		expect(plan({ bands: [{ plot: 2, fromHour: '6pm', toHour: 6 }] }).errors[0]).toMatch(/clock hours 0–24/);
		expect(plan({ bands: [{ plot: 99, fromHour: 18, toHour: 6 }] }).errors[0]).toMatch(/no such plot/);
	});
});

// Restyling an existing plot — "set the y axis to 0", "use a log x axis". The paths and the
// allow-list are the app's own (getSharedSchema, the same reflection behind the shared-options
// panel), so the AI is offered exactly what a user can change by hand.
describe('planEdit — restyling a plot', () => {
	it('sets a property by its descriptor path', () => {
		const p = plan({ changes: [{ plot: 2, set: { 'plot.xLogScale': true } }] });
		expect(p.errors).toEqual([]);
		expect(p.changes).toEqual([{ plotId: 2, path: 'plot.xLogScale', value: true }]);
		// The preview speaks the UI's own label, not the path.
		expect(p.preview).toEqual(['Restyle scatterplot "Raw": X Log Scale = true']);
	});

	it('accepts a number for a limit that is currently null', () => {
		// The crux of the leniency: `input` is inferred from the value, and every axis limit
		// defaults to null → 'text'. Refusing a number here would reject the most ordinary
		// request there is.
		const p = plan({ changes: [{ plot: 2, set: { 'plot.ylimsLeftIN[0]': 0 } }] });
		expect(p.errors).toEqual([]);
		expect(p.changes[0]).toEqual({ plotId: 2, path: 'plot.ylimsLeftIN[0]', value: 0 });
	});

	it('allows null to hand an axis back to auto-scaling', () => {
		const p = plan({ changes: [{ plot: 2, set: { 'plot.ylimsLeftIN[0]': null } }] });
		expect(p.errors).toEqual([]);
		expect(p.changes[0].value).toBeNull();
	});

	it('sets several properties on one plot, and mixes with an analysis change', () => {
		const p = plan({
			changes: [
				{ plot: 2, set: { 'plot.xLogScale': true, width: 800 } },
				{ analysis: 3, set: { fixedPeriod: 12 } }
			]
		});
		expect(p.errors).toEqual([]);
		expect(p.changes).toEqual([
			{ plotId: 2, path: 'plot.xLogScale', value: true },
			{ plotId: 2, path: 'width', value: 800 },
			{ tpId: 3, key: 'fixedPeriod', value: 12 }
		]);
	});

	// "change the colour of the actogram" did nothing: a colour isn't a property of the PLOT,
	// it's a property of a SERIES, and only the plot-level schema was on offer.
	it('changes a series colour, and can tell one series from another', () => {
		const p = plan({
			changes: [{ plot: 2, set: { 'plot.data[1].line.colour': '#ff0000' } }]
		});
		expect(p.errors).toEqual([]);
		expect(p.changes).toEqual([
			{ plotId: 2, path: 'plot.data[1].line.colour', value: '#ff0000' }
		]);
		// The label names the series, so a user reading the preview knows WHICH one moved.
		expect(p.preview).toEqual(['Restyle scatterplot "Raw": signal fit: Line Colour = "#ff0000"']);
	});

	it('refuses an invented path rather than writing it somewhere', () => {
		const p = plan({ changes: [{ plot: 2, set: { 'plot.makeItPretty': true } }] });
		expect(p.changes).toEqual([]);
		expect(p.errors[0]).toMatch(/"plot.makeItPretty" isn't a property of this plot/);
	});

	it('refuses a plot that does not exist, and one with no properties', () => {
		expect(plan({ changes: [{ plot: 99, set: { width: 10 } }] }).errors[0]).toMatch(/no such plot/);
		expect(plan({ changes: [{ plot: 5, set: { width: 10 } }] }).errors[0]).toMatch(/isn't a property/);
	});

	it('type-checks what is genuinely checkable', () => {
		expect(plan({ changes: [{ plot: 2, set: { 'plot.xLogScale': 'yes' } }] }).errors[0]).toMatch(
			/must be true or false/
		);
		expect(plan({ changes: [{ plot: 2, set: { 'plot.sigMethod': 'magic' } }] }).errors[0]).toMatch(
			/must be one of auto, tukey/
		);
		expect(plan({ changes: [{ plot: 2, set: { width: 'wide' } }] }).errors[0]).toMatch(/must be a number/);
		expect(plan({ changes: [{ plot: 2, set: { width: { a: 1 } } }] }).errors[0]).toMatch(
			/must be a single value/
		);
	});
});

describe('bandDuration', () => {
	it('wraps midnight and rejects a zero-width window', () => {
		expect(bandDuration(18, 6)).toBe(12);
		expect(bandDuration(6, 18)).toBe(12);
		expect(bandDuration(23, 1)).toBe(2);
		expect(bandDuration(0, 12)).toBe(12);
		expect(bandDuration(12, 12)).toBeNull();
	});
});

// The trap that makes shading more than "set a property": NightBandClass.startTimeHours means
// the clock hour on a numeric axis, but an absolute epoch-ms on a TIME axis (the plot's own UI
// swaps a number box for a date-time picker on the same field). Passing 18 to a time axis would
// put the first band 18 ms after 1970.
describe('firstBandStart', () => {
	const numericAxis = { anyXdataTime: false, xlims: [0, 96] };
	// 2026-07-17T02:00:00Z — data starting at 2am UTC.
	const t0 = Date.UTC(2026, 6, 17, 2, 0, 0);
	const timeAxis = { anyXdataTime: true, xlims: [t0, t0 + 4 * 24 * 3600_000] };

	it('is the clock hour itself on a numeric axis', () => {
		expect(firstBandStart(numericAxis, 18, 'utc')).toBe(18);
	});

	it('is the first 18:00 at or after the data starts, on a time axis', () => {
		const got = firstBandStart(timeAxis, 18, 'utc');
		expect(got).toBe(Date.UTC(2026, 6, 17, 18, 0, 0)); // same day, 18:00 — not 18 ms
		expect(got).toBeGreaterThan(timeAxis.xlims[0]);
	});

	it('rolls to the next day when the hour has already passed', () => {
		// Data starts at 20:00; the first 18:00 at-or-after is TOMORROW's.
		const late = Date.UTC(2026, 6, 17, 20, 0, 0);
		const axis = { anyXdataTime: true, xlims: [late, late + 4 * 24 * 3600_000] };
		expect(firstBandStart(axis, 18, 'utc')).toBe(Date.UTC(2026, 6, 18, 18, 0, 0));
	});

	it('reads 18:00 in the session timezone, not UTC', () => {
		// 18:00 in Auckland (UTC+12 in July) is 06:00 UTC — using UTC would silently shift the
		// shading by the offset, which looks perfectly plausible on screen.
		const got = firstBandStart(timeAxis, 18, 'Pacific/Auckland');
		expect(got).toBe(Date.UTC(2026, 6, 17, 6, 0, 0));
		expect(got).not.toBe(firstBandStart(timeAxis, 18, 'utc'));
	});
});

// The tests above use a hand-written props list, so this pins that list against a REAL plot:
// the allow-list the planner trusts has to be the app's own reflection, or the whole scheme is
// just a second source of truth waiting to drift.
describe('plotProps (against a live plot class)', () => {
	it('reports the same paths the shared-options panel offers, with current values', async () => {
		const { loadPlots } = await import('$lib/plots/plotMap.js');
		const { getSharedSchema } = await import('$lib/plots/sharedControls.js');
		const entry = (await loadPlots()).get('scatterplot');
		const wrapper = {
			id: 1,
			type: 'scatterplot',
			plot: entry.data.fromJSON(null, { data: [] }),
			width: 420,
			height: 300
		};

		const props = plotProps(wrapper);
		const schemaPaths = getSharedSchema(wrapper).map((f) => f.path);

		// Same source, so every prop is a real field; only object-valued ones are dropped.
		expect(props.length).toBeGreaterThan(5);
		for (const p of props) expect(schemaPaths).toContain(p.path);

		// The values are the plot's actual state, which is how the model reads types off it.
		expect(props.find((p) => p.path === 'width').value).toBe(420);
		const yMin = props.find((p) => p.path.startsWith('plot.ylims'));
		expect(yMin, 'a scatterplot has an axis limit').toBeTruthy();
		// Nothing object-valued survives — a model can't set one in a single assignment. null is
		// fine and meaningful (an axis limit of null is auto-scaled), despite typeof null.
		for (const p of props) {
			expect(p.value === null || typeof p.value !== 'object', `${p.path} is settable`).toBe(true);
		}
	});

	it('offers each series its own colour path, named so they can be told apart', async () => {
		const { loadPlots } = await import('$lib/plots/plotMap.js');
		const entry = (await loadPlots()).get('scatterplot');
		const inner = entry.data.fromJSON(null, {
			data: [
				{ x: { refId: 0 }, y: { refId: 1 }, label: 'signal', line: { colour: '#234154' } },
				{ x: { refId: 2 }, y: { refId: 3 }, label: 'signal fit', line: { colour: '#BE796B' } }
			]
		});
		const props = plotProps({ id: 1, type: 'scatterplot', plot: inner, width: 420, height: 300 });

		const colours = props.filter((p) => /\.colour$/.test(p.path));
		expect(colours.length, 'colours are offered at all').toBeGreaterThan(0);
		// Absolute, per-series paths — the panel's own paths are relative to a selected row.
		expect(colours.map((c) => c.path)).toContain('plot.data[0].line.colour');
		expect(colours.map((c) => c.path)).toContain('plot.data[1].line.colour');
		// Current values, so the model can see what it's changing.
		expect(props.find((p) => p.path === 'plot.data[1].line.colour').value).toBe('#BE796B');
		// Labelled by series, or "make the fit red" can't pick one.
		expect(props.find((p) => p.path === 'plot.data[1].line.colour').label).toMatch(/signal fit/);

		// Wiring is NOT on offer: rewiring a plot by writing a raw column id isn't a restyle.
		expect(props.some((p) => /refId/.test(p.path))).toBe(false);
	});

	it('offers only the wrapper fields when there is no inner, and never throws', () => {
		// getSharedSchema falls back to WRAPPER_FIELDS — width/height belong to the wrapper, so
		// they're still legitimately settable.
		expect(plotProps({ id: 1, type: 'x', plot: null }).map((p) => p.path)).toEqual([
			'width',
			'height'
		]);
		expect(() => plotProps(null)).not.toThrow();
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
