// Scatterplot overlays (reference lines / bands) through add_plot, pinned against the
// app's own OverlayClass so the tool surface cannot drift from the GUI's channel table.
import { beforeAll, describe, expect, it } from 'vitest';
import { AncirSession, ensureRegistry, describeCapabilities } from '../src/engine/session.js';
import {
	normalizeOverlaySpecs,
	describeOverlayForms,
	overlayColumnIds,
	remapOverlayColumnIds
} from '../src/engine/overlays.js';
import { OverlayClass } from '$lib/plots/Scatterplot/Overlay.svelte';

const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));

beforeAll(async () => {
	await ensureRegistry();
});

function sessionWithColumns(id) {
	const s = new AncirSession(id);
	s.importColumns([
		{ name: 'x', values: seq(20, (i) => i) },
		{ name: 'y', values: seq(20, (i) => i * 2) },
		{ name: 'crossing', values: [4, 11] },
		{ name: 'lower limit', values: [3] }
	]);
	return s;
}

describe('capability catalogue advertises overlays where the class supports them', () => {
	it('scatterplot lists the channel table; a plot without overlays does not', () => {
		const caps = describeCapabilities();
		const scatter = caps.plots.find((p) => p.id === 'scatterplot');
		expect(scatter.overlays).toEqual(describeOverlayForms());
		expect(scatter.overlays.line.vertical).toEqual([{ key: 'at', axis: 'x', dynamic: false }]);
		// No channel is dynamic (one column per channel, decision 2026-09-18).
		for (const forms of Object.values(scatter.overlays)) {
			for (const specs of Object.values(forms)) {
				for (const c of specs) expect(c.dynamic).toBe(false);
			}
		}
		expect(scatter.overlays.band.ribbon.map((c) => c.key)).toEqual(['x', 'lower', 'upper']);
		const acto = caps.plots.find((p) => p.id === 'actogram');
		expect(acto.overlays).toBeUndefined();
	});

	it('the advertised table is exactly OverlayClass.channelsFor, form for form', () => {
		const forms = describeOverlayForms();
		for (const [kind, list] of Object.entries(OverlayClass.FORMS)) {
			expect(Object.keys(forms[kind])).toEqual(list);
			for (const form of list) {
				expect(forms[kind][form]).toEqual(
					OverlayClass.channelsFor(kind, form).map(({ key, axis, dynamic }) => ({
						key,
						axis,
						dynamic
					}))
				);
			}
		}
	});
});

describe('normalizeOverlaySpecs', () => {
	const resolve = (ref) => {
		if (typeof ref === 'number') return ref;
		const t = String(ref).trim();
		if (/^\d+$/.test(t)) return Number(t);
		const names = { crossing: 2, 'lower limit': 3 };
		if (!(t in names)) throw new Error(`No column named "${t}"`);
		return names[t];
	};

	it('numbers are typed values, strings and { column } are wires', () => {
		const [line, band] = normalizeOverlaySpecs(
			[
				{ kind: 'line', form: 'horizontal', channels: { at: 35 }, label: 'limit' },
				{
					kind: 'band',
					form: 'ribbon',
					channels: { x: '0', lower: 'lower limit', upper: { column: 2 } }
				}
			],
			resolve
		);
		expect(line).toMatchObject({
			kind: 'line',
			form: 'horizontal',
			label: 'limit',
			channels: { at: { columns: [], typed: [35] } }
		});
		expect(band.channels).toEqual({
			x: { columns: [{ refId: 0 }], typed: [] },
			lower: { columns: [{ refId: 3 }], typed: [] },
			upper: { columns: [{ refId: 2 }], typed: [] }
		});
	});

	it('an `at` list of several WIRES becomes one Line per column (shared style); several typed values stay one', () => {
		const out = normalizeOverlaySpecs(
			[
				{
					kind: 'line',
					form: 'horizontal',
					name: 'limits',
					label: 'limit',
					colour: '#C0392B',
					stroke: 'none',
					channels: { at: ['crossing', { column: 3 }] }
				},
				{ kind: 'line', channels: { at: [1, 2.5, 4] } }
			],
			resolve
		);
		expect(out).toHaveLength(3); // 2 (split) + 1 (typed)
		const [a, b, typed] = out;
		expect(a).toEqual({
			kind: 'line',
			form: 'horizontal',
			name: 'limits',
			label: 'limit',
			colour: '#C0392B',
			stroke: 'none',
			channels: { at: { columns: [{ refId: 2 }], typed: [] } }
		});
		// The copy shares form, style and label; it has NO name so the class mints
		// the usual "Line N" when it is added.
		expect(b).toEqual({
			kind: 'line',
			form: 'horizontal',
			label: 'limit',
			colour: '#C0392B',
			stroke: 'none',
			channels: { at: { columns: [{ refId: 3 }], typed: [] } }
		});
		expect(typed.form).toBe('vertical'); // default form for a line
		expect(typed.channels.at).toEqual({ columns: [], typed: [1, 2.5, 4] });
	});

	it('a one-entry wire list and the raw { columns } shape with several columns follow the same rule', () => {
		const one = normalizeOverlaySpecs([{ kind: 'line', channels: { at: ['crossing'] } }], resolve);
		expect(one).toHaveLength(1);
		expect(one[0].channels.at).toEqual({ columns: [{ refId: 2 }], typed: [] });
		const raw = normalizeOverlaySpecs(
			[{ kind: 'line', channels: { at: { columns: [{ refId: 2 }, { refId: 3 }] } } }],
			resolve
		);
		expect(raw.map((o) => o.channels.at.columns)).toEqual([[{ refId: 2 }], [{ refId: 3 }]]);
	});

	it('defaults: band → ribbon; no channels → empty channel map; style keys pass through', () => {
		const [band] = normalizeOverlaySpecs(
			[{ kind: 'band', fill: '#00000020', edge: true, name: 'Night', repeatEveryHours: 24 }],
			resolve
		);
		expect(band).toEqual({
			kind: 'band',
			form: 'ribbon',
			channels: {},
			name: 'Night',
			fill: '#00000020',
			edge: true,
			repeatEveryHours: 24
		});
	});

	it('rejects a bad kind, a form of the wrong kind, and a channel the form lacks', () => {
		expect(() => normalizeOverlaySpecs([{ kind: 'arrow' }], resolve)).toThrow(
			/kind must be one of line \| band/
		);
		expect(() => normalizeOverlaySpecs([{ kind: 'line', form: 'ribbon' }], resolve)).toThrow(
			/form for a line must be one of vertical \| horizontal/
		);
		expect(() =>
			normalizeOverlaySpecs([{ kind: 'band', form: 'horizontal', channels: { at: 3 } }], resolve)
		).toThrow(/channels\.at: a band of form "horizontal" has channels lower, upper/);
		expect(() =>
			normalizeOverlaySpecs([{ kind: 'band', form: 'repeating', channels: { start: 3 } }], resolve)
		).toThrow(/has no channels/);
	});

	it('rejects mixed typed/wired lists, several columns on a band channel, and unknown names', () => {
		expect(() =>
			normalizeOverlaySpecs([{ kind: 'line', channels: { at: [3, 'crossing'] } }], resolve)
		).toThrow(/mix of typed values and columns/);
		expect(() =>
			normalizeOverlaySpecs(
				[{ kind: 'band', form: 'ribbon', channels: { lower: ['crossing', '3'] } }],
				resolve
			)
		).toThrow(/takes one column/);
		expect(() =>
			normalizeOverlaySpecs([{ kind: 'line', channels: { at: 'nope' } }], resolve)
		).toThrow(/No column named "nope"/);
	});

	it('every (kind, form) with channels round-trips into OverlayClass with the wires intact', () => {
		for (const [kind, forms] of Object.entries(OverlayClass.FORMS)) {
			for (const form of forms) {
				const specs = OverlayClass.channelsFor(kind, form);
				const channels = Object.fromEntries(specs.map((c, i) => [c.key, String(i)]));
				const [json] = normalizeOverlaySpecs([{ kind, form, channels }], resolve);
				const inner = { data: [], overlays: [] };
				const ov = OverlayClass.fromJSON(inner, json);
				expect(ov.kind).toBe(kind);
				expect(ov.form).toBe(form);
				specs.forEach((c, i) => expect(ov.wiredRefIds(c.key)).toEqual([i]));
			}
		}
	});

	it('overlayColumnIds / remapOverlayColumnIds follow the wires and only the wires', () => {
		const jsons = normalizeOverlaySpecs(
			[
				{ kind: 'line', channels: { at: ['crossing', '7'] } },
				{ kind: 'band', form: 'horizontal', channels: { lower: 1, upper: 2 } }
			],
			resolve
		);
		expect(jsons).toHaveLength(3); // the two-wire `at` split into two lines
		expect(overlayColumnIds(jsons)).toEqual([2, 7]);
		const remapped = remapOverlayColumnIds(
			jsons,
			new Map([
				[2, 0],
				[7, 1]
			])
		);
		expect(remapped[0].channels.at.columns).toEqual([{ refId: 0 }]);
		expect(remapped[1].channels.at.columns).toEqual([{ refId: 1 }]);
		expect(remapped[2].channels).toEqual({
			lower: { columns: [], typed: [1] },
			upper: { columns: [], typed: [2] }
		});
	});
});

describe('add_plot with overlays', () => {
	it('embeds the overlays in the exported scatterplot, wired by column NAME', () => {
		const s = sessionWithColumns('plot-overlays');
		const res = s.addPlot('scatterplot', { x: 'x', y: 'y' }, [
			{ kind: 'line', form: 'vertical', channels: { at: 'crossing' }, label: 'alert' },
			{ kind: 'line', form: 'horizontal', channels: { at: 'lower limit' } },
			{ kind: 'band', form: 'horizontal', channels: { lower: 1.5, upper: 3 }, fill: '#FF000020' }
		]);
		expect(res.overlays).toHaveLength(3);
		expect(res.overlays[0]).toMatchObject({
			kind: 'line',
			form: 'vertical',
			name: 'Line 1',
			label: 'alert',
			channels: { at: { columns: [2], typed: [] } }
		});
		expect(res.overlays[1]).toMatchObject({ name: 'Line 2', channels: { at: { columns: [3] } } });
		expect(res.overlays[2]).toMatchObject({
			kind: 'band',
			name: 'Band 1',
			channels: { lower: { columns: [], typed: [1.5] }, upper: { columns: [], typed: [3] } }
		});

		const exported = s.exportSessionObject();
		const inner = exported.plots[0].plot;
		expect(inner.overlays).toHaveLength(3);
		expect(inner.overlays[0].channels.at.columns).toEqual([{ refId: 2 }]);
		expect(inner.overlays[2].fill).toBe('#FF000020');
		expect(inner.nightBands).toBeUndefined();
	});

	it('add_plot with a two-column `at` reports TWO lines, "Line N" named, same style, one column each', () => {
		const s = sessionWithColumns('plot-overlays-split');
		const res = s.addPlot('scatterplot', { x: 'x', y: 'y' }, [
			{
				kind: 'line',
				form: 'vertical',
				label: 'alert',
				colour: '#C0392B',
				channels: { at: ['crossing', 'lower limit'] }
			}
		]);
		expect(res.overlays).toHaveLength(2);
		expect(res.overlays[0]).toMatchObject({
			name: 'Line 1',
			label: 'alert',
			channels: { at: { columns: [2], typed: [] } }
		});
		expect(res.overlays[1]).toMatchObject({
			name: 'Line 2',
			label: 'alert',
			channels: { at: { columns: [3], typed: [] } }
		});
		expect(res.overlays[1].id).not.toBe(res.overlays[0].id);
		const inner = s.exportSessionObject().plots[0].plot;
		expect(inner.overlays.map((o) => o.colour)).toEqual(['#C0392B', '#C0392B']);
		expect(inner.overlays.map((o) => o.channels.at.columns)).toEqual([
			[{ refId: 2 }],
			[{ refId: 3 }]
		]);
	});

	it('a plot without overlays returns no overlays key', () => {
		const s = sessionWithColumns('plot-no-overlays');
		const res = s.addPlot('scatterplot', { x: 0, y: 1 });
		expect(res.overlays).toBeUndefined();
	});

	it('rejects overlays on a plot type without them, before committing the plot', () => {
		const s = sessionWithColumns('plot-overlay-type');
		expect(() =>
			s.addPlot('actogram', { time: 0, values: 1 }, [{ kind: 'line', channels: { at: 3 } }])
		).toThrow(/does not support overlays/);
		expect(s.exportSessionObject().plots.length).toBe(0);
	});

	it('rejects an unknown column in an overlay channel, before committing the plot', () => {
		const s = sessionWithColumns('plot-overlay-badcol');
		expect(() =>
			s.addPlot('scatterplot', { x: 0, y: 1 }, [{ kind: 'line', channels: { at: 'missing' } }])
		).toThrow(/No column named "missing"/);
		expect(() =>
			s.addPlot('scatterplot', { x: 0, y: 1 }, [{ kind: 'line', channels: { at: '99' } }])
		).toThrow(/No column with id 99/);
		expect(s.exportSessionObject().plots.length).toBe(0);
	});
});
