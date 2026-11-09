// @ts-nocheck
// The Correlogram's "Standard ACF" option: every lag over N (R acf, MATLAB autocorr) instead of
// each lag's own pair count (utils/correlogram.js `normalization`, as the Rhythmicity and Moving
// analysis nodes' `corrBiased`). Off by default, so a saved correlogram is unchanged; saved and
// restored with the series.
import { describe, it, expect, beforeEach } from 'vitest';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Correlogramclass } from './Correlogram.svelte';
import { computeAutocorrelation } from '$lib/utils/correlogram.js';

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

describe('Correlogram standard (biased) ACF', () => {
	it('is off by default and draws the pair-count ACF exactly as before', () => {
		const c = Correlogramclass.fromJSON(wrapper(), {
			data: [{ x: { refId: mkCol('t', T) }, y: { refId: mkCol('y', Y) } }]
		});
		const d = c.data[0];
		expect(d.biased).toBe(false);
		expect(d.acfData.correlations).toEqual(computeAutocorrelation(T, Y).correlations);
	});

	it('divides every lag by N when on, and is saved and restored', () => {
		const c = Correlogramclass.fromJSON(wrapper(), {
			data: [{ x: { refId: mkCol('t', T) }, y: { refId: mkCol('y', Y) } }]
		});
		const d = c.data[0];
		d.biased = true;
		const want = computeAutocorrelation(T, Y, null, null, 0, { normalization: 'biased' });
		expect(d.acfData.correlations).toEqual(want.correlations);
		// The biased ACF shrinks with lag (the factor (N - k) / N) against the pair-count one.
		const pairs = computeAutocorrelation(T, Y).correlations;
		expect(Math.abs(d.acfData.correlations[48])).toBeLessThan(Math.abs(pairs[48]));
		const json = JSON.parse(JSON.stringify(c.toJSON()));
		expect(json.data[0].biased).toBe(true);
		const back = Correlogramclass.fromJSON(wrapper(), json);
		expect(back.data[0].biased).toBe(true);
		expect(back.data[0].acfData.correlations).toEqual(want.correlations);
	});
});
