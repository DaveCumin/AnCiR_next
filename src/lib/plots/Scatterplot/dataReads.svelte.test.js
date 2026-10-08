/**
 * Mount test: a render reads each series column once. The markup used to call
 * getData() inline for every prop that passed the data on (the guard, the x mapping,
 * Line's y, Points' y), and the plot's limits and render geometry read it again; now
 * every reader shares the series' xData / yData, so a column is read once per data
 * change and not at all for a change that is not to its data.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import { render, cleanup } from '@testing-library/svelte';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import Scatterplot, { Scatterplotclass } from './Scatterplot.svelte';

function mkCol(values, type = 'number') {
	const c = new Column({ type, data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function mkPlot() {
	const wrapper = { id: 1, type: 'scatterplot', name: 'p', width: 400, height: 300, plot: null };
	const s = new Scatterplotclass(wrapper, null);
	s.padding = { top: 20, right: 30, bottom: 30, left: 50 };
	s.addData({ x: { refId: mkCol([0, 2, 4, 6, 8, 10]) }, y: { refId: mkCol([1, 3, 2, 5, 4, 6]) } });
	s.addData({ x: { refId: mkCol([0, 1, 2, 3]) }, y: { refId: mkCol([2, NaN, 4, 1]) } });
	wrapper.plot = s;
	return { wrapper, s };
}

/** Spy on every series column's getData; returns the spies in [x0, y0, x1, y1] order. */
function spyReads(s) {
	return s.data.flatMap((d) => [vi.spyOn(d.x, 'getData'), vi.spyOn(d.y, 'getData')]);
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
});
afterEach(() => cleanup());

describe('Scatterplot data reads', () => {
	it('reads each series column once to render the plot', () => {
		const { wrapper, s } = mkPlot();
		const spies = spyReads(s);
		const { container } = render(Scatterplot, { props: { theData: wrapper, which: 'plot' } });
		// Both series drew (the NaN in the second one is a gap, not a reason to skip it).
		expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
		expect(spies.map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1, 1]);
	});

	it('does not read the data again for a change that is not to the data', () => {
		const { wrapper, s } = mkPlot();
		const spies = spyReads(s);
		render(Scatterplot, { props: { theData: wrapper, which: 'plot' } });
		spies.forEach((spy) => spy.mockClear());
		s.data[0].points.radius = 7;
		s.data[1].line.draw = true;
		flushSync();
		expect(spies.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0, 0]);
	});
});
