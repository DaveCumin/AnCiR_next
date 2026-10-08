// @ts-nocheck
// The Scatterplot tells its x-axis panel what the axis shows, so the Manual ticks choice is
// offered on a numeric x, disabled on a time x, and absent on a categorical x.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { core, appState } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import Scatterplot, { Scatterplotclass } from './Scatterplot.svelte';

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	appState.currentControlTab = 'properties';
});
afterEach(() => cleanup());

function mkCol(type, values) {
	const c = new Column({ type, data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function xAxisSelect(type, xValues) {
	const wrapper = { id: 1, type: 'scatterplot', name: 'p', width: 600, height: 400, plot: null };
	const s = new Scatterplotclass(wrapper, null);
	wrapper.plot = s;
	s.addData({ x: { refId: mkCol(type, xValues) }, y: { refId: mkCol('number', [1, 2, 3]) } });
	const { container } = render(Scatterplot, { props: { theData: s, which: 'controls' } });
	// The x-axis block is the one titled "X-Axis".
	const block = [...container.querySelectorAll('.control-component')].find(
		(b) => b.querySelector('.control-component-title p')?.textContent.trim() === 'X-Axis'
	);
	expect(block).toBeTruthy();
	return block.querySelector('select[aria-label="Tick placement"]');
}

describe('Scatterplot x-axis tick placement', () => {
	it('a numeric x offers Auto/Manual', () => {
		const sel = xAxisSelect('number', [0, 1, 2]);
		expect(sel).not.toBeNull();
		expect(sel.disabled).toBe(false);
	});

	it('a time x keeps Auto (disabled)', () => {
		const t0 = Date.UTC(2026, 0, 1);
		const sel = xAxisSelect('time', [t0, t0 + 3.6e6, t0 + 7.2e6]);
		expect(sel).not.toBeNull();
		expect(sel.disabled).toBe(true);
	});

	it('a categorical x has no tick placement control', () => {
		expect(xAxisSelect('category', ['a', 'b', 'c'])).toBeNull();
	});
});
