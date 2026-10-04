// Review STAT-6 follow-up on the Histogram plot: its value filter was
// `v != null && !isNaN(v)`, which lets '' and ' ' through (isNaN('') is false). A blank
// cell then pulled the automatic bin start down to 0 (Number('') is 0), was counted in the
// bins and the KDE, and was exported as a "raw" value.
import { describe, it, expect } from 'vitest';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Histogramclass } from './Histogram.svelte';

function mkCol(values) {
	const c = new Column({ type: 'number', data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function hist(values, over = {}) {
	const parentBox = { id: 1, width: 400, height: 300, data: [] };
	const h = new Histogramclass(parentBox, {
		data: [{ column: { refId: mkCol(values) }, label: 'S', binSize: 1, ...over }]
	});
	return h;
}

const VALUES = [3, '', ' ', '4', 4.5, null, 'n/a', 5];

describe('Histogram: blank and text cells are missing', () => {
	it('the automatic bin start ignores blanks', () => {
		expect(hist(VALUES).data[0].autoBinStart).toBe(3);
	});

	it('the export lists only present values, as numbers', () => {
		const { rows } = hist(VALUES).getDownloadData();
		const raw = rows.filter((r) => r[1] === 'raw').map((r) => r[2]);
		expect(raw).toEqual([3, 4, 4.5, 5]);
	});

	it('the bins count only present values', () => {
		const { rows } = hist(VALUES).getDownloadData();
		const total = rows.filter((r) => r[1] === 'bin').reduce((n, r) => n + r[4], 0);
		expect(total).toBe(4);
	});
});
