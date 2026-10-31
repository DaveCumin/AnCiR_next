// @ts-nocheck
// The Correlogram's significance band (decision 2026-11-01): a NEW series draws Bartlett's band
// (utils/correlogram.js correlogramBand), a series saved before the band was a choice keeps the
// +/- z / sqrt(N) it always drew, and the choice is saved. The band arithmetic itself is pinned
// to statsmodels in utils/correlogram.band.test.js.
import { describe, it, expect, beforeEach } from 'vitest';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Correlogramclass } from './Correlogram.svelte';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

const T = Array.from({ length: 120 }, (_, i) => i);
const Y = T.map((t) => Math.cos((2 * Math.PI * t) / 24) + 0.3 * Math.sin(t * 1.7));
const wrapper = () => ({ id: 1, type: 'correlogram', name: 'c', width: 400, height: 300 });

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
});

describe('Correlogram band', () => {
	it('a new series (palette, quick plot, MCP: columns only) draws the Bartlett band', () => {
		const x = mkCol('t', T);
		const y = mkCol('y', Y);
		const c = Correlogramclass.fromJSON(wrapper(), {
			data: [{ x: { refId: x }, y: { refId: y } }]
		});
		const d = c.data[0];
		expect(d.bandMethod).toBe('bartlett');
		const { upper, lower } = d.confidenceBounds;
		expect(upper).toHaveLength(d.acfData.lags.length);
		// Bartlett widens with lag on a rhythmic series and is missing at lag 0.
		expect(upper[0]).toBeNaN();
		expect(upper[1]).toBeCloseTo(1.96 / Math.sqrt(120), 12);
		expect(upper[48]).toBeGreaterThan(2 * upper[1]);
		expect(lower[48]).toBe(-upper[48]);
		const added = new Correlogramclass(wrapper(), null);
		added.addData({ x: { refId: x }, y: { refId: y } });
		expect(added.data[0].bandMethod).toBe('bartlett');
	});

	it('a series saved before the choice keeps +/- 1.96 / sqrt(n) at every lag, exactly as before', () => {
		// One missing time: the old band counted the y values present (120), not the pairs (119).
		const x = mkCol(
			't',
			T.map((t) => (t === 7 ? null : t))
		);
		const y = mkCol('y', Y);
		const saved = {
			data: [
				{
					x: { refId: x },
					y: { refId: y },
					maxLag: null,
					minLag: 0,
					showConfidenceBounds: true,
					confidenceLevel: 0.95
				}
			]
		};
		const d = Correlogramclass.fromJSON(wrapper(), saved).data[0];
		expect(d.bandMethod).toBe('white');
		const old = 1.96 / Math.sqrt(120); // the old confidenceBounds
		for (const v of d.confidenceBounds.upper) expect(v).toBe(old);
		expect(d.toJSON().bandMethod).toBe('white');
	});

	it('the choice is saved and restored', () => {
		const x = mkCol('t', T);
		const y = mkCol('y', Y);
		const c = new Correlogramclass(wrapper(), null);
		c.addData({ x: { refId: x }, y: { refId: y } });
		c.data[0].bandMethod = 'nk';
		const json = JSON.parse(JSON.stringify(c.data[0].toJSON()));
		expect(json.bandMethod).toBe('nk');
		const back = Correlogramclass.fromJSON(wrapper(), { data: [json] }).data[0];
		expect(back.bandMethod).toBe('nk');
		expect(back.confidenceBounds.upper[59]).toBeCloseTo(1.96 / Math.sqrt(120 - 59), 12);
	});
});
