// @ts-nocheck
// When the axis <g> is rebuilt, and when it is redrawn in place.
//
// The {#key} around the axis <g> used a comma expression,
// `{#key (position, height, ..., axisData.gridlines)}`, which evaluates to its LAST operand
// only, so the group was rebuilt when the gridlines were toggled and never when the position
// changed. A d3 axis redrawn in place keeps the attributes of the old orientation: a bottom
// axis's tick lines have `y2`, a left axis's have `x2`, so a bottom axis turned into a left one
// in the same <g> drew diagonal tick marks. Only the position needs a fresh <g>; everything else
// (size, padding, scale, tick count, gridlines) the drawing effect already follows in place.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { scaleLinear } from 'd3-scale';
import Axis, { AxisClass } from '$lib/components/plotbits/Axis.svelte';

afterEach(() => cleanup());

const PAD = { top: 10, right: 10, bottom: 30, left: 40 };

function mount(props = {}) {
	const axisData = new AxisClass({ label: 'Time', gridlines: true, nticks: 5 });
	const base = {
		which: 'plot',
		axisData,
		position: 'bottom',
		scale: scaleLinear().domain([0, 10]).range([0, 200]),
		width: 200,
		height: 100,
		plotPadding: PAD,
		...props
	};
	const r = render(Axis, { props: base });
	return { ...r, axisData, base };
}

const group = (c) => c.querySelector('g[class^="axis-"]');

describe('Axis remounts its <g> only when the position changes', () => {
	it('a new position draws a clean axis of the new orientation', async () => {
		const { container, rerender, base } = mount();
		const before = group(container);
		expect(before.querySelector('.tick line:not(.gridline)').getAttribute('y2')).toBe('6');

		await rerender({
			...base,
			position: 'left',
			scale: scaleLinear().domain([0, 10]).range([100, 0])
		});
		const after = group(container);
		expect(after.getAttribute('class')).toBe('axis-left');
		expect(after).not.toBe(before);
		for (const line of after.querySelectorAll('.tick line:not(.gridline)')) {
			expect(line.getAttribute('x2')).toBe('-6');
			expect(line.hasAttribute('y2')).toBe(false); // no leftover bottom-axis geometry
		}
	});

	it('the tick count updates in place', () => {
		const { container, axisData } = mount();
		const g = group(container);
		const n0 = g.querySelectorAll('.tick').length;
		axisData.nticks = 2;
		flushSync();
		expect(group(container)).toBe(g);
		expect(g.querySelectorAll('.tick').length).toBeLessThan(n0);
	});

	it('gridlines toggle in place', () => {
		const { container, axisData } = mount();
		const g = group(container);
		expect(g.querySelectorAll('.gridline').length).toBeGreaterThan(0);
		axisData.gridlines = false;
		flushSync();
		expect(group(container)).toBe(g);
		expect(g.querySelectorAll('.gridline').length).toBe(0);
		axisData.gridlines = true;
		flushSync();
		expect(g.querySelectorAll('.gridline').length).toBeGreaterThan(0);
	});

	it('a new size moves the axis in place', async () => {
		const { container, rerender, base } = mount();
		const g = group(container);
		await rerender({ ...base, height: 150 });
		expect(group(container)).toBe(g);
		expect(g.style.transform).toContain(`${150 + PAD.top}px`);
	});
});
