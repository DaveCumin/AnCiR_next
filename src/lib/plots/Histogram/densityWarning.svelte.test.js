// A density curve on a single-value series used to fail silently: the automatic
// (Silverman) bandwidth is NaN when the sample SD is 0, so the curve came back empty
// with no message, and a manual bandwidth drew a lone kernel bump instead. Seen on a
// permutation histogram whose observed_statistic column repeats one value.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { core, appState } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import Histogram, { Histogramclass } from './Histogram.svelte';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1, name });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function hist(values, over = {}) {
	const parentBox = { id: 1, width: 400, height: 300, data: [] };
	return new Histogramclass(parentBox, {
		data: [
			{
				column: { refId: mkCol('observed_statistic', values) },
				binSize: 0.05,
				showDensity: true,
				...over
			}
		]
	});
}

const SAME = Array(1000).fill(0.153);

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
});
afterEach(() => {
	cleanup();
	appState.currentControlTab = 'properties';
});

describe('Histogram density curve on a single-value series', () => {
	it('says why there is no curve with the automatic bandwidth', () => {
		const d = hist(SAME).data[0];
		expect(d.density.x).toEqual([]);
		expect(d.densityWarning).toContain('No density curve for "observed_statistic"');
		expect(d.densityWarning).toContain('every value is the same (0.153)');
	});

	it('does not draw a lone bump with a manual bandwidth, and says why', () => {
		const d = hist(SAME, { bandwidth: 0.01 }).data[0];
		expect(d.density.x).toEqual([]);
		expect(d.densityWarning).toContain('manual bandwidth');
	});

	it('still draws (and stays quiet) for a series with a spread', () => {
		const d = hist([0.1, 0.2, 0.2, 0.3]).data[0];
		expect(d.density.x.length).toBeGreaterThan(1);
		expect(d.densityWarning).toBeNull();
	});

	it('is quiet while the density curve is off', () => {
		const d = hist(SAME, { showDensity: false }).data[0];
		expect(d.densityWarning).toBeNull();
	});

	it('shows the note under the density controls on the Data tab', () => {
		const theData = hist(SAME);
		appState.currentControlTab = 'data';
		const { container } = render(Histogram, { props: { theData, which: 'controls' } });
		const notes = [...container.querySelectorAll('.data-warning')].map((n) => n.textContent);
		expect(notes.some((t) => t.includes('every value is the same (0.153)'))).toBe(true);
	});
});
