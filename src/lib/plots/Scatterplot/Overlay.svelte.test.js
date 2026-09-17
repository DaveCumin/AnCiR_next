/**
 * OverlayClass: the data model behind scatterplot reference lines and shaded
 * bands (plan 2026-09-13, part B). This pins the contract the Overlays tab,
 * the plotbits renderers and the canvas ports all build against: the channel
 * table, in-place form swaps, wired/typed exclusivity, resolution (union,
 * uniques, cap), the warning wording, the geometry shapes, persistence and
 * the NightBand migration.
 *
 * Columns are REAL `Column` instances registered in `core`, so wired
 * resolution goes through the same getData() the renderers use.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { OverlayClass, OVERLAY_POSITION_CAP } from './Overlay.svelte';

function mkCol(values, type = 'number') {
	const c = new Column({ type, data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

/** A stand-in for Scatterplotclass: only what OverlayClass reads. */
function mkParent(extra = {}) {
	return { data: [], overlays: [], ...extra };
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
});

describe('OverlayClass.channelsFor', () => {
	it('returns the ordered channel table from the plan (key, axis, dynamic, display)', () => {
		expect(OverlayClass.channelsFor('line', 'vertical')).toEqual([
			{ key: 'at', axis: 'x', dynamic: true, display: 'at (x)' }
		]);
		expect(OverlayClass.channelsFor('line', 'horizontal')).toEqual([
			{ key: 'at', axis: 'y', dynamic: true, display: 'at (y)' }
		]);
		expect(OverlayClass.channelsFor('band', 'ribbon')).toEqual([
			{ key: 'x', axis: 'x', dynamic: false, display: 'x (x)' },
			{ key: 'lower', axis: 'y', dynamic: false, display: 'lower (y)' },
			{ key: 'upper', axis: 'y', dynamic: false, display: 'upper (y)' }
		]);
		expect(OverlayClass.channelsFor('band', 'horizontal')).toEqual([
			{ key: 'lower', axis: 'y', dynamic: false, display: 'lower (y)' },
			{ key: 'upper', axis: 'y', dynamic: false, display: 'upper (y)' }
		]);
		expect(OverlayClass.channelsFor('band', 'vertical')).toEqual([
			{ key: 'start', axis: 'x', dynamic: false, display: 'start (x)' },
			{ key: 'end', axis: 'x', dynamic: false, display: 'end (x)' }
		]);
		expect(OverlayClass.channelsFor('band', 'repeating')).toEqual([]);
	});

	it('returns [] for an unknown kind/form pair rather than throwing', () => {
		expect(OverlayClass.channelsFor('line', 'ribbon')).toEqual([]);
		expect(OverlayClass.channelsFor('nope', 'vertical')).toEqual([]);
	});

	it('static FORMS lists the forms per kind in panel order', () => {
		expect(OverlayClass.FORMS.line).toEqual(['vertical', 'horizontal']);
		expect(OverlayClass.FORMS.band).toEqual(['ribbon', 'horizontal', 'vertical', 'repeating']);
	});
});

describe('construction defaults', () => {
	it('names count overlays of the same kind already in the parent', () => {
		const parent = mkParent();
		const l1 = new OverlayClass(parent, { kind: 'line' });
		parent.overlays.push(l1);
		const b1 = new OverlayClass(parent, { kind: 'band' });
		parent.overlays.push(b1);
		const l2 = new OverlayClass(parent, { kind: 'line' });
		expect(l1.name).toBe('Line 1');
		expect(b1.name).toBe('Band 1');
		expect(l2.name).toBe('Line 2');
	});

	it('line defaults: vertical form, dashed 1.5px stroke, an explicit colour', () => {
		const l = new OverlayClass(mkParent(), { kind: 'line' });
		expect(l.kind).toBe('line');
		expect(l.form).toBe('vertical');
		expect(l.enabled).toBe(true);
		expect(l.label).toBe('');
		expect(l.strokeWidth).toBe(1.5);
		expect(l.stroke).toBe('5, 5');
		expect(l.colour).toMatch(/^#[0-9a-fA-F]{6}$/);
		expect(Object.keys(l.channels)).toEqual(['at']);
	});

	it('band defaults: ribbon form, NightBand grey fill, no edge; repeating fields as NightBand', () => {
		const b = new OverlayClass(mkParent(), { kind: 'band', form: 'vertical' });
		expect(b.fill).toBe('#2C2C2C30');
		expect(b.edge).toBe(false);
		expect(b.edgeWidth).toBe(1);
		expect(b.repeatEveryHours).toBe(24);
		expect(b.nightDurationHours).toBe(12);
		expect(b.startTimeHours).toBe(0);
		expect(b.useDataMin).toBe(true);
		expect(Object.keys(b.channels)).toEqual(['start', 'end']);
		expect(new OverlayClass(mkParent(), { kind: 'band' }).form).toBe('ribbon');
	});

	it('ribbon fill defaults to the first series line colour at ~20% alpha when resolvable', () => {
		const parent = mkParent({ data: [{ line: { colour: '#1F77B4' } }] });
		const b = new OverlayClass(parent, { kind: 'band', form: 'ribbon' });
		expect(b.fill).toBe('#1F77B433');
		const lonely = new OverlayClass(mkParent(), { kind: 'band', form: 'ribbon' });
		expect(lonely.fill).toBe('#4682B430');
	});

	it('ids are monotonic across instances', () => {
		const a = new OverlayClass(mkParent(), { kind: 'line' });
		const b = new OverlayClass(mkParent(), { kind: 'line' });
		expect(b.id).toBeGreaterThan(a.id);
	});
});

describe('setForm swaps channel keys in place', () => {
	it('keeps surviving keys with their content and drops the rest', () => {
		const b = new OverlayClass(mkParent(), { kind: 'band', form: 'ribbon' });
		const lowerId = mkCol([1, 2, 3]);
		b.setWire('lower', lowerId);
		b.setTyped('x', [0, 1, 2]);
		b.setTyped('upper', '4, 5, 6');
		const before = b.channels;

		b.setForm('horizontal');
		expect(b.form).toBe('horizontal');
		expect(b.channels).toBe(before); // same object: swapped in place, not replaced
		expect(Object.keys(b.channels)).toEqual(['lower', 'upper']);
		expect(b.wiredRefIds('lower')).toEqual([lowerId]);
		expect(b.channels.upper.typed).toEqual([4, 5, 6]);
		expect(b.channels.x).toBeUndefined();

		b.setForm('vertical');
		expect(Object.keys(b.channels)).toEqual(['start', 'end']);
		expect(b.channels.start).toEqual({ columns: [], typed: [] });

		b.setForm('repeating');
		expect(Object.keys(b.channels)).toEqual([]);
	});

	it('rejects a form that does not belong to the kind', () => {
		const l = new OverlayClass(mkParent(), { kind: 'line' });
		l.setForm('ribbon');
		expect(l.form).toBe('vertical');
		expect(Object.keys(l.channels)).toEqual(['at']);
	});

	it('swaps the default fill when the form changes and the fill is untouched, but keeps a chosen one', () => {
		const parent = mkParent({ data: [{ line: { colour: '#1F77B4' } }] });
		const b = new OverlayClass(parent, { kind: 'band', form: 'vertical' });
		expect(b.fill).toBe('#2C2C2C30');
		b.setForm('ribbon');
		expect(b.fill).toBe('#1F77B433');
		b.fill = '#FF000080';
		b.setForm('vertical');
		expect(b.fill).toBe('#FF000080');
	});
});

describe('wiring API', () => {
	it('a channel is wired OR typed: wiring clears typed, typing clears wires', () => {
		const l = new OverlayClass(mkParent(), { kind: 'line' });
		const id = mkCol([10, 20]);
		l.setTyped('at', [1, 2]);
		expect(l.values('at')).toEqual([1, 2]);
		l.setWire('at', id);
		expect(l.channels.at.typed).toEqual([]);
		expect(l.values('at')).toEqual([10, 20]);
		l.setTyped('at', '3');
		expect(l.channels.at.columns).toEqual([]);
		expect(l.wiredRefIds('at')).toEqual([]);
		expect(l.values('at')).toEqual([3]);
	});

	it('setTyped accepts a number, an array or a comma-separated string and ignores junk', () => {
		const l = new OverlayClass(mkParent(), { kind: 'line' });
		l.setTyped('at', 7);
		expect(l.channels.at.typed).toEqual([7]);
		l.setTyped('at', ' 35, 55.6 ,, abc, 0, -2 ');
		expect(l.channels.at.typed).toEqual([35, 55.6, 0, -2]);
		l.setTyped('at', [1, NaN, null, '4', Infinity]);
		expect(l.channels.at.typed).toEqual([1, 4]);
		l.setTyped('at', '');
		expect(l.channels.at.typed).toEqual([]);
	});

	it('addWire appends on the dynamic channel (union of columns), removeWire drops one', () => {
		const l = new OverlayClass(mkParent(), { kind: 'line' });
		const a = mkCol([1, 2]);
		const b = mkCol([3, 4]);
		l.addWire('at', a);
		l.addWire('at', b);
		l.addWire('at', a); // duplicate ignored
		expect(l.wiredRefIds('at')).toEqual([a, b]);
		expect(l.values('at')).toEqual([1, 2, 3, 4]);
		l.removeWire('at', a);
		expect(l.wiredRefIds('at')).toEqual([b]);
		expect(l.values('at')).toEqual([3, 4]);
	});

	it('addWire on a non-dynamic channel replaces, like setWire', () => {
		const b = new OverlayClass(mkParent(), { kind: 'band', form: 'ribbon' });
		const a = mkCol([1]);
		const c = mkCol([2]);
		b.addWire('lower', a);
		b.addWire('lower', c);
		expect(b.wiredRefIds('lower')).toEqual([c]);
	});

	it('wiring an unknown channel key is a no-op', () => {
		const l = new OverlayClass(mkParent(), { kind: 'line' });
		l.setWire('lower', mkCol([1]));
		l.setTyped('lower', 1);
		expect(l.channels.lower).toBeUndefined();
		expect(l.values('lower')).toEqual([]);
	});

	it('wires hold ColumnClass wrappers with refId only', () => {
		const l = new OverlayClass(mkParent(), { kind: 'line' });
		const id = mkCol([1]);
		l.setWire('at', id);
		const col = l.channels.at.columns[0];
		expect(col).toBeInstanceOf(Column);
		expect(col.refId).toBe(id);
	});
});

describe('resolution: values / positions / capped', () => {
	it('skips null, blank and NaN in wired data (isInvalidValue semantics)', () => {
		const l = new OverlayClass(mkParent(), { kind: 'line' });
		l.setWire('at', mkCol([1, null, '', NaN, 2, undefined, 3]));
		expect(l.values('at')).toEqual([1, 2, 3]);
	});

	it('positions on `at` are finite uniques capped at 50, and capped() reports it', () => {
		const l = new OverlayClass(mkParent(), { kind: 'line' });
		l.setTyped('at', [5, 5, 3, 3, 5]);
		expect(l.positions('at')).toEqual([5, 3]);
		expect(l.capped('at')).toEqual({ shown: 2, total: 2 });

		const many = Array.from({ length: 120 }, (_, i) => i);
		l.setWire('at', mkCol([...many, ...many]));
		expect(l.positions('at')).toHaveLength(OVERLAY_POSITION_CAP);
		expect(l.positions('at')).toEqual(many.slice(0, 50));
		expect(l.capped('at')).toEqual({ shown: 50, total: 120 });
		expect(l.warning).toBe('Line 1 has 120 positions; showing the first 50');
	});

	it('ribbon channels are neither deduped nor capped', () => {
		const b = new OverlayClass(mkParent(), { kind: 'band', form: 'ribbon' });
		b.setTyped('x', [0, 0, 1]);
		b.setTyped('lower', [1, 1, 1]);
		b.setTyped('upper', [2, 2, 2]);
		expect(b.positions('x')).toEqual([0, 0, 1]);
		expect(b.geometry({})).toEqual({
			kind: 'band',
			form: 'ribbon',
			x: [0, 0, 1],
			lower: [1, 1, 1],
			upper: [2, 2, 2]
		});

		const n = OVERLAY_POSITION_CAP + 30;
		const xs = Array.from({ length: n }, (_, i) => i);
		b.setWire('x', mkCol(xs));
		b.setTyped(
			'lower',
			xs.map(() => 0)
		);
		b.setTyped(
			'upper',
			xs.map(() => 1)
		);
		expect(b.positions('x')).toHaveLength(n);
		expect(b.capped('x')).toEqual({ shown: n, total: n });
		expect(b.geometry({}).x).toHaveLength(n);
		expect(b.warning).toBeNull();
	});

	it('an x-axis channel wired to an hours-from-origin column converts like series x', () => {
		const origin = Date.UTC(2024, 0, 1);
		const parent = mkParent({
			anyXdataTime: true,
			xOriginFor: (col) => (col.type === 'time' ? null : origin)
		});
		const l = new OverlayClass(parent, { kind: 'line', form: 'vertical' });
		l.setWire('at', mkCol([0, 1.5]));
		expect(l.values('at')).toEqual([origin, origin + 1.5 * 3600000]);
		// A y channel never goes through the time conversion.
		const h = new OverlayClass(parent, { kind: 'line', form: 'horizontal' });
		h.setWire('at', mkCol([0, 1.5]));
		expect(h.values('at')).toEqual([0, 1.5]);
	});
});

describe('geometry', () => {
	it('lines: orientation follows the form, positions from `at`', () => {
		const v = new OverlayClass(mkParent(), { kind: 'line', form: 'vertical' });
		v.setTyped('at', [2, 1]);
		expect(v.geometry({})).toEqual({ kind: 'line', orientation: 'vertical', positions: [2, 1] });
		const h = new OverlayClass(mkParent(), { kind: 'line', form: 'horizontal' });
		h.setTyped('at', 7);
		expect(h.geometry({})).toEqual({ kind: 'line', orientation: 'horizontal', positions: [7] });
	});

	it('vertical band pairs start[i] with end[i], ignores extras and empty pairs, dedupes pairs', () => {
		const b = new OverlayClass(mkParent(), { kind: 'band', form: 'vertical' });
		b.setTyped('start', [0, 10, 0, 30, 40]);
		b.setTyped('end', [5, 10, 5, 35]);
		expect(b.geometry({})).toEqual({
			kind: 'band',
			form: 'vertical',
			segments: [
				{ x0: 0, x1: 5 },
				{ x0: 30, x1: 35 }
			]
		});
	});

	it('vertical band orders a reversed pair so x0 <= x1', () => {
		const b = new OverlayClass(mkParent(), { kind: 'band', form: 'vertical' });
		b.setTyped('start', [9]);
		b.setTyped('end', [4]);
		expect(b.geometry({}).segments).toEqual([{ x0: 4, x1: 9 }]);
	});

	it('horizontal band pairs lower[i]/upper[i] into y segments', () => {
		const b = new OverlayClass(mkParent(), { kind: 'band', form: 'horizontal' });
		b.setTyped('lower', [1, 3]);
		b.setTyped('upper', [2, 4]);
		expect(b.geometry({})).toEqual({
			kind: 'band',
			form: 'horizontal',
			segments: [
				{ y0: 1, y1: 2 },
				{ y0: 3, y1: 4 }
			]
		});
	});

	it('ribbon with mismatched lengths draws nothing', () => {
		const b = new OverlayClass(mkParent(), { kind: 'band', form: 'ribbon' });
		b.setTyped('x', [0, 1, 2]);
		b.setTyped('lower', [1, 1]);
		b.setTyped('upper', [2, 2, 2]);
		expect(b.geometry({})).toEqual({ kind: 'band', form: 'ribbon', x: [], lower: [], upper: [] });
	});

	// Pinned from NightBandClass (`bands` → {startTime, endTime}) for these
	// exact fields/xlims BEFORE NightBand.svelte was deleted (2026-09-17), so the
	// ported maths stays byte-identical to what night bands used to draw.
	const NIGHTBAND_PINNED = {
		'useDataMin,numeric': [
			[3, 15],
			[27, 39],
			[51, 63],
			[75, 87],
			[99, 100]
		],
		'explicitStart,time': [
			[36000000, 50400000],
			[93600000, 122400000],
			[165600000, 194400000],
			[237600000, 266400000],
			[309600000, 338400000]
		],
		'edges,numeric': [
			[12, 20],
			[22, 30],
			[32, 35]
		]
	};
	function nightBandSegments(key) {
		return NIGHTBAND_PINNED[key].map(([x0, x1]) => ({ x0, x1 }));
	}

	it('repeating segments are identical to NightBandClass (useDataMin, numeric x)', () => {
		const fields = {
			repeatEveryHours: 24,
			nightDurationHours: 12,
			startTimeHours: 0,
			useDataMin: true
		};
		const o = new OverlayClass(mkParent(), { kind: 'band', form: 'repeating', ...fields });
		const got = o.geometry({ xDomainMin: 3, xDomainMax: 100, xIsTime: false });
		expect(got.kind).toBe('band');
		expect(got.form).toBe('repeating');
		expect(got.segments.length).toBeGreaterThan(2);
		expect(got.segments).toEqual(nightBandSegments('useDataMin,numeric'));
	});

	it('repeating segments are identical to NightBandClass (explicit start, time x in ms)', () => {
		const H = 3600000;
		const fields = {
			repeatEveryHours: 20,
			nightDurationHours: 8,
			startTimeHours: 6 * H,
			useDataMin: false
		};
		const o = new OverlayClass(mkParent(), { kind: 'band', form: 'repeating', ...fields });
		const got = o.geometry({ xDomainMin: 10 * H, xDomainMax: 95 * H, xIsTime: true });
		expect(got.segments.length).toBeGreaterThan(2);
		expect(got.segments).toEqual(nightBandSegments('explicitStart,time'));
	});

	it('repeating segments are identical to NightBandClass at the domain edges (band ending exactly on xmin)', () => {
		// start 2, width 8: the first band ends exactly at xmin=10 and must NOT
		// produce a zero-width segment; the last band is clipped at xmax.
		const fields = {
			repeatEveryHours: 10,
			nightDurationHours: 8,
			startTimeHours: 2,
			useDataMin: false
		};
		const o = new OverlayClass(mkParent(), { kind: 'band', form: 'repeating', ...fields });
		const got = o.geometry({ xDomainMin: 10, xDomainMax: 35, xIsTime: false });
		expect(got.segments).toEqual([
			{ x0: 12, x1: 20 },
			{ x0: 22, x1: 30 },
			{ x0: 32, x1: 35 }
		]);
		expect(got.segments).toEqual(nightBandSegments('edges,numeric'));
	});

	it('repeating falls back to the parent xlims/anyXdataTime when ctx omits them', () => {
		const parent = mkParent({ data: [1], xlims: [0, 48], anyXdataTime: false });
		const o = new OverlayClass(parent, { kind: 'band', form: 'repeating' });
		expect(o.geometry({}).segments).toEqual([
			{ x0: 0, x1: 12 },
			{ x0: 24, x1: 36 }
		]);
		expect(o.geometry({ xDomainMin: 0, xDomainMax: 24 }).segments).toEqual([{ x0: 0, x1: 12 }]);
	});

	it('repeating with no usable domain draws nothing', () => {
		const o = new OverlayClass(mkParent(), { kind: 'band', form: 'repeating' });
		expect(o.geometry({}).segments).toEqual([]);
	});
});

describe('warning', () => {
	it('is null for a pristine overlay (nothing wired, nothing typed), like an unwired series', () => {
		expect(new OverlayClass(mkParent(), { kind: 'line' }).warning).toBeNull();
		expect(new OverlayClass(mkParent(), { kind: 'band', form: 'ribbon' }).warning).toBeNull();
	});

	it('names the channel that has no values once any channel has input', () => {
		const b = new OverlayClass(mkParent(), { kind: 'band', form: 'ribbon' });
		b.setTyped('x', [1, 2]);
		expect(b.warning).toBe('Band 1 cannot be drawn: lower has no values');
		b.setTyped('lower', [1, 2]);
		expect(b.warning).toBe('Band 1 cannot be drawn: upper has no values');
	});

	it('a wired column that resolves to nothing counts as having no values', () => {
		const l = new OverlayClass(mkParent(), { kind: 'line' });
		l.setWire('at', mkCol([null, '']));
		expect(l.warning).toBe('Line 1 cannot be drawn: at has no values');
		l.setWire('at', 99999); // broken reference: getData() degrades to []
		expect(l.warning).toBe('Line 1 cannot be drawn: at has no values');
	});

	it('ribbon length mismatch uses the requirement/actual wording', () => {
		const b = new OverlayClass(mkParent(), { kind: 'band', form: 'ribbon' });
		b.setTyped('x', [0, 1, 2]);
		b.setTyped('lower', [1, 1]);
		b.setTyped('upper', [2, 2, 2, 2]);
		expect(b.warning).toBe(
			'Band 1 cannot be drawn: x, lower and upper must provide the same number of values, but x has 3, lower has 2 and upper has 4'
		);
	});

	it('unequal start/end lengths note that extras are ignored', () => {
		const b = new OverlayClass(mkParent(), { kind: 'band', form: 'vertical' });
		b.setTyped('start', [0, 10, 20]);
		b.setTyped('end', [5]);
		expect(b.warning).toBe('Band 1: start has 3 values and end has 1; extra values are ignored');
	});

	it('repeating never warns', () => {
		const o = new OverlayClass(mkParent(), { kind: 'band', form: 'repeating' });
		expect(o.warning).toBeNull();
	});

	it('uses the current name', () => {
		const l = new OverlayClass(mkParent(), { kind: 'line' });
		l.name = 'alert';
		l.setWire('at', mkCol([]));
		expect(l.warning).toBe('alert cannot be drawn: at has no values');
	});
});

describe('domainExtension', () => {
	it('vertical line extends x only; horizontal line extends y only', () => {
		const v = new OverlayClass(mkParent(), { kind: 'line', form: 'vertical' });
		v.setTyped('at', [5, -2, 9]);
		expect(v.domainExtension()).toEqual({ x: [-2, 9], y: null });
		const h = new OverlayClass(mkParent(), { kind: 'line', form: 'horizontal' });
		h.setTyped('at', [0]);
		expect(h.domainExtension()).toEqual({ x: null, y: [0, 0] });
	});

	it('ribbon extends both axes from x and the lower/upper edges', () => {
		const b = new OverlayClass(mkParent(), { kind: 'band', form: 'ribbon' });
		b.setTyped('x', [1, 2, 3]);
		b.setTyped('lower', [-1, 0, 0]);
		b.setTyped('upper', [4, 5, 6]);
		expect(b.domainExtension()).toEqual({ x: [1, 3], y: [-1, 6] });
	});

	it('vertical band extends x from its segments; horizontal band extends y', () => {
		const v = new OverlayClass(mkParent(), { kind: 'band', form: 'vertical' });
		v.setTyped('start', [10]);
		v.setTyped('end', [20]);
		expect(v.domainExtension()).toEqual({ x: [10, 20], y: null });
		const h = new OverlayClass(mkParent(), { kind: 'band', form: 'horizontal' });
		h.setTyped('lower', [-3]);
		h.setTyped('upper', [3]);
		expect(h.domainExtension()).toEqual({ x: null, y: [-3, 3] });
	});

	it('is empty when disabled, when nothing resolves, or for repeating', () => {
		const v = new OverlayClass(mkParent(), { kind: 'line' });
		expect(v.domainExtension()).toEqual({ x: null, y: null });
		v.setTyped('at', [1]);
		v.enabled = false;
		expect(v.domainExtension()).toEqual({ x: null, y: null });
		const r = new OverlayClass(mkParent(), { kind: 'band', form: 'repeating' });
		expect(r.domainExtension()).toEqual({ x: null, y: null });
	});
});

describe('getLegendItem', () => {
	it('is null when the label is empty', () => {
		const l = new OverlayClass(mkParent(), { kind: 'line' });
		expect(l.getLegendItem()).toBeNull();
		l.label = '   ';
		expect(l.getLegendItem()).toBeNull();
	});

	it('lines contribute a line swatch in their own style', () => {
		const l = new OverlayClass(mkParent(), { kind: 'line' });
		l.label = 'alert';
		l.colour = '#AA0000';
		l.strokeWidth = 2;
		l.stroke = '2, 2';
		expect(l.getLegendItem()).toEqual({
			label: 'alert',
			elements: [{ type: 'line', color: '#AA0000', strokeWidth: 2, stroke: '2, 2' }]
		});
	});

	it('bands contribute a filled rect swatch (Legend.svelte rect type), edge only when on', () => {
		const b = new OverlayClass(mkParent(), { kind: 'band', form: 'vertical' });
		b.label = '95% CI';
		expect(b.getLegendItem()).toEqual({
			label: '95% CI',
			elements: [{ type: 'boxplot', fillColor: '#2C2C2C30', fillOpacity: 1, color: 'none' }]
		});
		b.edge = true;
		b.edgeColour = '#123456';
		expect(b.getLegendItem().elements[0].color).toBe('#123456');
	});
});

describe('toJSON / fromJSON', () => {
	it('round-trips every field, channels as {columns:[{refId}], typed}', () => {
		const parent = mkParent();
		const id = mkCol([1, 2]);
		const b = new OverlayClass(parent, { kind: 'band', form: 'ribbon' });
		b.name = 'CI';
		b.label = '95% CI';
		b.enabled = false;
		b.fill = '#11223344';
		b.edge = true;
		b.edgeColour = '#000000';
		b.edgeWidth = 0;
		b.setWire('x', id);
		b.setTyped('lower', [0, 0]);
		b.setTyped('upper', [1, 1]);
		const json = JSON.parse(JSON.stringify(b.toJSON()));
		expect(json.channels).toEqual({
			x: { columns: [{ refId: id }], typed: [] },
			lower: { columns: [], typed: [0, 0] },
			upper: { columns: [], typed: [1, 1] }
		});
		expect(json.kind).toBe('band');
		expect(json.form).toBe('ribbon');
		expect(json.edgeWidth).toBe(0);

		const back = OverlayClass.fromJSON(parent, json);
		expect(back.name).toBe('CI');
		expect(back.label).toBe('95% CI');
		expect(back.enabled).toBe(false);
		expect(back.fill).toBe('#11223344');
		expect(back.edge).toBe(true);
		expect(back.edgeColour).toBe('#000000');
		expect(back.edgeWidth).toBe(0); // `??` guard: 0 survives
		expect(back.wiredRefIds('x')).toEqual([id]);
		expect(back.channels.x.columns[0]).toBeInstanceOf(Column);
		expect(back.values('x')).toEqual([1, 2]);
		expect(back.channels.lower.typed).toEqual([0, 0]);
		// The id round-trips too: it names the canvas ports (`ov<id>_<key>`).
		expect(back.id).toBe(b.id);
		expect(back.toJSON()).toEqual(b.toJSON());
	});

	it('keeps a saved id across fromJSON and lifts the counter above it (no collision)', () => {
		const parent = mkParent();
		const fresh = new OverlayClass(parent, { kind: 'line' });
		const restored = OverlayClass.fromJSON(parent, { kind: 'line', id: fresh.id + 100 });
		expect(restored.id).toBe(fresh.id + 100);
		const next = new OverlayClass(parent, { kind: 'band' });
		expect(next.id).toBeGreaterThan(restored.id);
		// Repeated replay (history does this twice per wire) is a fixed point.
		const again = OverlayClass.fromJSON(parent, JSON.parse(JSON.stringify(restored.toJSON())));
		expect(again.id).toBe(restored.id);
	});

	it('mints a fresh id when the saved id is missing or not a non-negative integer', () => {
		const parent = mkParent();
		const a = OverlayClass.fromJSON(parent, { kind: 'line' });
		const b = OverlayClass.fromJSON(parent, { kind: 'line', id: '7' });
		const c = OverlayClass.fromJSON(parent, { kind: 'line', id: -1 });
		const d = OverlayClass.fromJSON(parent, { kind: 'line', id: 1.5 });
		const ids = [a.id, b.id, c.id, d.id];
		expect(ids.every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
		expect(new Set(ids).size).toBe(4);
	});

	it('round-trips a line with zero-valued style fields intact', () => {
		const parent = mkParent();
		const l = new OverlayClass(parent, { kind: 'line', form: 'horizontal' });
		l.strokeWidth = 0;
		l.colour = '#ABCDEF';
		l.stroke = 'solid';
		l.setTyped('at', [0]);
		const back = OverlayClass.fromJSON(parent, JSON.parse(JSON.stringify(l.toJSON())));
		expect(back.form).toBe('horizontal');
		expect(back.strokeWidth).toBe(0);
		expect(back.colour).toBe('#ABCDEF');
		expect(back.stroke).toBe('solid');
		expect(back.channels.at.typed).toEqual([0]);
	});

	it('repeating fields survive with 0 and false intact', () => {
		const parent = mkParent();
		const r = new OverlayClass(parent, { kind: 'band', form: 'repeating' });
		r.startTimeHours = 0;
		r.useDataMin = false;
		r.repeatEveryHours = 12;
		r.nightDurationHours = 0.5;
		const back = OverlayClass.fromJSON(parent, JSON.parse(JSON.stringify(r.toJSON())));
		expect(back.startTimeHours).toBe(0);
		expect(back.useDataMin).toBe(false);
		expect(back.repeatEveryHours).toBe(12);
		expect(back.nightDurationHours).toBe(0.5);
		expect(Object.keys(back.channels)).toEqual([]);
	});

	it('fromJSON tolerates undefined, {} and partial json (defaults fill the rest)', () => {
		const parent = mkParent();
		const a = OverlayClass.fromJSON(parent, undefined);
		expect(a.kind).toBe('line');
		expect(a.form).toBe('vertical');
		const b = OverlayClass.fromJSON(parent, {});
		expect(b.channels.at).toEqual({ columns: [], typed: [] });
		const c = OverlayClass.fromJSON(parent, {
			kind: 'band',
			form: 'vertical',
			channels: { start: { typed: [1] } }
		});
		expect(c.channels.start).toEqual({ columns: [], typed: [1] });
		expect(c.channels.end).toEqual({ columns: [], typed: [] });
		// A saved channel that does not belong to the saved form is dropped.
		const d = OverlayClass.fromJSON(parent, {
			kind: 'band',
			form: 'vertical',
			channels: { lower: { typed: [1] } }
		});
		expect(Object.keys(d.channels)).toEqual(['start', 'end']);
	});

	it('an unknown form in json falls back to the kind default', () => {
		const l = OverlayClass.fromJSON(mkParent(), { kind: 'line', form: 'ribbon' });
		expect(l.form).toBe('vertical');
	});
});

describe('fromLegacyNightBand', () => {
	it('migrates a repeating night band to a repeating band overlay', () => {
		const parent = mkParent();
		const o = OverlayClass.fromLegacyNightBand(parent, {
			id: 3,
			name: 'Night',
			mode: 'repeating',
			colour: '#2C2C2C99',
			enabled: false,
			repeatEveryHours: 24,
			nightDurationHours: 10,
			startTimeHours: 0,
			useDataMin: false,
			customBands: []
		});
		expect(o.kind).toBe('band');
		expect(o.form).toBe('repeating');
		expect(o.name).toBe('Night');
		expect(o.fill).toBe('#2C2C2C99');
		expect(o.enabled).toBe(false);
		expect(o.repeatEveryHours).toBe(24);
		expect(o.nightDurationHours).toBe(10);
		expect(o.startTimeHours).toBe(0);
		expect(o.useDataMin).toBe(false);
		expect(o.warning).toBeNull();
	});

	it('migrates custom bands to a vertical band with typed start/end (durationHours form)', () => {
		const parent = mkParent({ anyXdataTime: false });
		const o = OverlayClass.fromLegacyNightBand(parent, {
			name: 'Dark',
			mode: 'custom',
			colour: '#00000040',
			enabled: true,
			customBands: [
				{ label: 'a', startTime: 10, durationHours: 5 },
				{ label: 'b', startTime: 30, durationHours: 0 }, // zero duration: NightBand skipped it
				{ label: 'c', startTime: null, durationHours: 2 }, // no start: skipped
				{ label: 'd', startTime: 40, endTime: 44 } // legacy endTime form
			]
		});
		expect(o.form).toBe('vertical');
		expect(o.channels.start.typed).toEqual([10, 40]);
		expect(o.channels.end.typed).toEqual([15, 44]);
		expect(o.fill).toBe('#00000040');
		expect(o.geometry({}).segments).toEqual([
			{ x0: 10, x1: 15 },
			{ x0: 40, x1: 44 }
		]);
	});

	it('custom bands on a time axis convert durationHours to ms like NightBand did', () => {
		const H = 3600000;
		const parent = mkParent({ anyXdataTime: true });
		const o = OverlayClass.fromLegacyNightBand(parent, {
			mode: 'custom',
			customBands: [{ startTime: 100 * H, durationHours: 12 }]
		});
		expect(o.channels.start.typed).toEqual([100 * H]);
		expect(o.channels.end.typed).toEqual([112 * H]);
	});

	it('tolerates undefined json (a repeating band with NightBand defaults)', () => {
		const o = OverlayClass.fromLegacyNightBand(mkParent(), undefined);
		expect(o.form).toBe('repeating');
		expect(o.name).toBe('Night');
		expect(o.fill).toBe('#2C2C2C30');
	});
});
