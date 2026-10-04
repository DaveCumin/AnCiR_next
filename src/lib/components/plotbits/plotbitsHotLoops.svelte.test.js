/**
 * ROB-9: Line and Points read their props through getters on every sample (x.map with y[i],
 * xscale/yscale inside d3 accessors, pointsData.radius per point). These pin that the number
 * of prop reads no longer grows with the number of samples, and that the drawing is unchanged.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { scaleLinear } from 'd3-scale';
import Line from './Line.svelte';
import Points from './Points.svelte';
import { getPointPath } from './pointShapes.js';

afterEach(() => cleanup());

const xscale = scaleLinear().domain([0, 100]).range([0, 400]);
const yscale = scaleLinear().domain([0, 10]).range([200, 0]);
const N = 1500;
const xs = Array.from({ length: N }, (_, i) => (i * 100) / N);
const ys = xs.map((v, i) => (i % 7 === 3 ? NaN : (v * 13) % 10));

/** Props object whose data/scale props count their reads. */
function countingProps(extra) {
	const values = { x: xs, y: ys, xscale, yscale, xoffset: 3, yoffset: 4 };
	const reads = Object.fromEntries(Object.keys(values).map((k) => [k, 0]));
	const props = { which: 'plot', tooltip: true, ...extra };
	for (const k of Object.keys(values)) {
		Object.defineProperty(props, k, {
			enumerable: true,
			get() {
				reads[k]++;
				return values[k];
			}
		});
	}
	return { props, reads };
}

function expectBounded(reads) {
	for (const [k, n] of Object.entries(reads)) {
		// Before the fix y was read once per sample (1500+) and the scales once per point.
		expect(n, `${k} read ${n} times`).toBeLessThan(30);
	}
}

describe('Line.svelte prop reads', () => {
	it('reads each data/scale prop a bounded number of times and still draws the line', () => {
		const { props, reads } = countingProps({
			lineData: { draw: true, colour: 'red', strokeWidth: 1, joinGaps: false }
		});
		const { container } = render(Line, { props });
		const path = container.querySelector('path');
		expect(path).not.toBeNull();
		const d = path.getAttribute('d');
		// Gaps at the NaN samples split the path into several M segments.
		expect((d.match(/M/g) ?? []).length).toBeGreaterThan(100);
		expect(d.startsWith('M0,200')).toBe(true);
		expectBounded(reads);
	});
});

describe('Points.svelte prop reads', () => {
	it('reads each data/scale prop a bounded number of times and draws every in-range point', () => {
		const { props, reads } = countingProps({
			pointsData: { draw: true, colour: 'blue', radius: 2, shape: 'circle' }
		});
		const { container } = render(Points, { props });
		const d = container.querySelector('path').getAttribute('d');
		let expected = '';
		for (let i = 0; i < N; i++) {
			if (Number.isNaN(ys[i])) continue;
			expected += getPointPath('circle', xscale(xs[i]), yscale(ys[i]), 2) + ' ';
		}
		expect(d.trim()).toBe(expected.trim());
		expectBounded(reads);
	});
});
