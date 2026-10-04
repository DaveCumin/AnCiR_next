/**
 * ROB-9: Hist.svelte's bar loop read every prop through its getter on every iteration, which
 * made a 50-series actogram freeze the tab for minutes. These tests pin both halves of the fix:
 * the point string is unchanged, and the number of prop reads no longer grows with the bars.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { scaleLinear } from 'd3-scale';
import Hist from './Hist.svelte';
import { histPoints } from './helpers/histPoints.js';

afterEach(() => cleanup());

const xscale = scaleLinear().domain([0, 48]).range([0, 480]);
const yscale = scaleLinear().domain([0, 100]).range([40, 0]);

const r3 = (v) => Math.round(v * 1000) / 1000 || 0;

/**
 * The loop as it was before ROB-9: four corners per bar. `round` gives the compact form's
 * 3-decimal coordinates (what an OUTLINED compact Hist writes).
 */
function legacyPoints(xStart, xEnd, y, xs, ys, round = false) {
	const f = round ? r3 : (v) => v;
	const height = f(ys.range()[0]);
	let out = '';
	for (let i = 0; i < Math.min(xStart.length, xEnd.length, y.length); i++) {
		if (i > 0) out += ' ';
		out += `${f(xs(xStart[i]))},${height} `;
		out += `${f(xs(xStart[i]))},${f(ys(y[i]))} `;
		out += `${f(xs(xEnd[i]))},${f(ys(y[i]))} `;
		out += `${f(xs(xEnd[i]))},${height}`;
	}
	return out;
}

const parse = (s) => s.split(' ').map((p) => p.split(',').map(Number));
/** Shoelace area of the closed polygon the polyline fill paints. */
function area(points) {
	const p = parse(points);
	let a = 0;
	for (let i = 0; i < p.length; i++) {
		const [x1, y1] = p[i];
		const [x2, y2] = p[(i + 1) % p.length];
		a += x1 * y2 - x2 * y1;
	}
	return Math.abs(a) / 2;
}

function bars(n) {
	const xStart = Array.from({ length: n }, (_, i) => i * 0.1);
	const xEnd = xStart.map((v) => v + 0.1);
	const y = xStart.map((_, i) => (i * 37) % 100);
	return { xStart, xEnd, y };
}

describe('histPoints', () => {
	it('by default, is exactly the legacy four-corner string (full precision)', () => {
		const { xStart, xEnd, y } = bars(250);
		expect(histPoints(xStart, xEnd, y, xscale, yscale)).toBe(
			legacyPoints(xStart, xEnd, y, xscale, yscale)
		);
	});

	it('draws only as many bars as the shortest array', () => {
		const { xStart, xEnd, y } = bars(10);
		const s = histPoints(xStart, xEnd.slice(0, 7), y, xscale, yscale);
		expect(s.split(' ')).toHaveLength(7 * 4);
		expect(s).toBe(legacyPoints(xStart, xEnd.slice(0, 7), y, xscale, yscale));
	});

	it('compact: touching bars step from top to top and paint the same area', () => {
		const { xStart, xEnd, y } = bars(250);
		const merged = histPoints(xStart, xEnd, y, xscale, yscale, { compact: true });
		const full = legacyPoints(xStart, xEnd, y, xscale, yscale);
		// One run: bottom-left, two tops per bar, bottom-right.
		expect(parse(merged)).toHaveLength(250 * 2 + 2);
		expect(area(merged)).toBeCloseTo(area(full), 6);
		const base = yscale.range()[0];
		expect(merged.startsWith(`0,${base} 0,${r3(yscale(y[0]))}`)).toBe(true);
		expect(merged.endsWith(`,${base}`)).toBe(true);
	});

	it('compact: a gap between bars still drops to the baseline', () => {
		const xStart = [0, 1, 5];
		const xEnd = [1, 2, 6];
		const y = [10, 20, 30];
		const merged = histPoints(xStart, xEnd, y, xscale, yscale, { compact: true });
		const b = r3(yscale.range()[0]);
		const X = (v) => r3(xscale(v));
		const Y = (v) => r3(yscale(v));
		expect(merged).toBe(
			`${X(0)},${b} ${X(0)},${Y(10)} ${X(1)},${Y(10)} ${X(1)},${Y(20)} ${X(2)},${Y(20)} ${X(2)},${b} ` +
				`${X(5)},${b} ${X(5)},${Y(30)} ${X(6)},${Y(30)} ${X(6)},${b}`
		);
		expect(area(merged)).toBeCloseTo(area(legacyPoints(xStart, xEnd, y, xscale, yscale)), 6);
	});

	it('compact: writes at most 3 decimal places; outlined keeps the four corners', () => {
		const odd = scaleLinear().domain([0, 3]).range([0, 1]);
		const s = histPoints([0, 1], [1, 2], [1, 2], odd, odd, { compact: true });
		for (const n of s.split(/[ ,]/)) expect(n.split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
		expect(s).toContain('0.333');
		const { xStart, xEnd, y } = bars(30);
		expect(histPoints(xStart, xEnd, y, xscale, yscale, { compact: true, outlined: true })).toBe(
			legacyPoints(xStart, xEnd, y, xscale, yscale, true)
		);
	});

	it('returns an empty string for missing or empty input', () => {
		expect(histPoints([], [], [], xscale, yscale)).toBe('');
		expect(histPoints(null, [], [], xscale, yscale)).toBe('');
		expect(histPoints([1], [2], [3], null, yscale)).toBe('');
	});
});

describe('Hist.svelte prop reads', () => {
	it('reads each data prop a bounded number of times, however many bars there are', () => {
		const N = 2000;
		const { xStart, xEnd, y } = bars(N);
		const reads = { xStart: 0, xEnd: 0, y: 0, xscale: 0, yscale: 0 };
		const values = { xStart, xEnd, y, xscale, yscale };
		const props = { colour: 'red' };
		for (const k of Object.keys(reads)) {
			Object.defineProperty(props, k, {
				enumerable: true,
				get() {
					reads[k]++;
					return values[k];
				}
			});
		}
		const { container } = render(Hist, { props });
		const poly = container.querySelector('polyline');
		expect(poly.getAttribute('points')).toBe(legacyPoints(xStart, xEnd, y, xscale, yscale));
		// Before the fix every bar cost several reads of each (y alone: 2 per bar = 4000).
		for (const [k, n] of Object.entries(reads)) {
			expect(n, `${k} read ${n} times`).toBeLessThan(20);
		}
	});
});

describe('Hist.svelte compact', () => {
	it('compact fill-only bars are merged', () => {
		const { xStart, xEnd, y } = bars(20);
		const { container } = render(Hist, {
			props: { xStart, xEnd, y, xscale, yscale, colour: 'red', compact: true }
		});
		expect(container.querySelector('polyline')?.getAttribute('points')).toBe(
			histPoints(xStart, xEnd, y, xscale, yscale, { compact: true })
		);
	});

	it('compact outlined bars keep every corner', () => {
		const { xStart, xEnd, y } = bars(20);
		const { container } = render(Hist, {
			props: {
				xStart,
				xEnd,
				y,
				xscale,
				yscale,
				colour: 'red',
				stroke: 'black',
				strokeWidth: 1,
				compact: true
			}
		});
		expect(container.querySelector('polyline')?.getAttribute('points')).toBe(
			legacyPoints(xStart, xEnd, y, xscale, yscale, true)
		);
	});

	it('is off by default: the full-precision four-corner string', () => {
		const { xStart, xEnd, y } = bars(20);
		const { container } = render(Hist, { props: { xStart, xEnd, y, xscale, yscale } });
		expect(container.querySelector('polyline')?.getAttribute('points')).toBe(
			legacyPoints(xStart, xEnd, y, xscale, yscale)
		);
	});
});
