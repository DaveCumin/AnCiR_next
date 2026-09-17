/**
 * plotbits/Band.svelte renders an OverlayClass `geometry()` result: rect
 * segments (vertical / horizontal / repeating) and a ribbon (d3 area with
 * `.defined` on finite lower/upper), plus an optional edge stroke. It absorbed
 * NightBand's rect rendering, so the time-axis case (ms positions on a UTC
 * scale) is pinned here too.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { scaleLinear, scaleUtc } from 'd3-scale';
import Band from './Band.svelte';

afterEach(() => cleanup());

const xscale = scaleLinear().domain([0, 100]).range([0, 200]);
const yscale = scaleLinear().domain([0, 10]).range([100, 0]);

function style(overrides = {}) {
	return {
		id: 1,
		fill: '#2C2C2C30',
		edge: false,
		edgeColour: '#2C2C2C',
		edgeWidth: 1,
		...overrides
	};
}

function mount(geometry, overlay = style(), extra = {}) {
	// An <svg> host so the SVG elements have a namespace to live in.
	const { container } = render(Band, {
		props: { overlay, geometry, xscale, yscale, xoffset: 10, yoffset: 5, ...extra }
	});
	return container;
}

describe('Band: vertical segments', () => {
	it('draws one full-height rect per segment at the scaled x, filled with the overlay fill', () => {
		const c = mount({
			kind: 'band',
			form: 'vertical',
			segments: [
				{ x0: 10, x1: 30 },
				{ x0: 50, x1: 60 }
			]
		});
		const rects = c.querySelectorAll('rect.band-rect');
		expect(rects).toHaveLength(2);
		expect(Number(rects[0].getAttribute('x'))).toBeCloseTo(10 + 20);
		expect(Number(rects[0].getAttribute('width'))).toBeCloseTo(40);
		expect(Number(rects[0].getAttribute('y'))).toBeCloseTo(5);
		expect(Number(rects[0].getAttribute('height'))).toBeCloseTo(100);
		expect(rects[0].getAttribute('fill')).toBe('#2C2C2C30');
		expect(Number(rects[1].getAttribute('x'))).toBeCloseTo(10 + 100);
		expect(Number(rects[1].getAttribute('width'))).toBeCloseTo(20);
		// No edge unless asked for.
		expect(c.querySelectorAll('.band-edge')).toHaveLength(0);
	});

	it('edge: true strokes the two vertical edges of each segment (not the plot top/bottom)', () => {
		const c = mount(
			{ kind: 'band', form: 'vertical', segments: [{ x0: 10, x1: 30 }] },
			style({ edge: true, edgeColour: '#FF0000', edgeWidth: 2 })
		);
		const edges = c.querySelectorAll('line.band-edge');
		expect(edges).toHaveLength(2);
		expect(Number(edges[0].getAttribute('x1'))).toBeCloseTo(30);
		expect(Number(edges[0].getAttribute('x2'))).toBeCloseTo(30);
		expect(Number(edges[1].getAttribute('x1'))).toBeCloseTo(70);
		expect(edges[0].getAttribute('stroke')).toBe('#FF0000');
		expect(edges[0].getAttribute('stroke-width')).toBe('2');
	});

	it('time axis: ms segments on a UTC scale land where NightBand put them', () => {
		const t0 = Date.UTC(2026, 0, 1);
		const H = 3600000;
		const tscale = scaleUtc()
			.domain([t0, t0 + 48 * H])
			.range([0, 480]);
		const c = mount(
			{
				kind: 'band',
				form: 'repeating',
				segments: [
					{ x0: t0, x1: t0 + 12 * H },
					{ x0: t0 + 24 * H, x1: t0 + 36 * H }
				]
			},
			style(),
			{ xscale: tscale, xoffset: 0, yoffset: 0 }
		);
		const rects = c.querySelectorAll('rect.band-rect');
		expect(rects).toHaveLength(2);
		expect(Number(rects[0].getAttribute('x'))).toBeCloseTo(0);
		expect(Number(rects[0].getAttribute('width'))).toBeCloseTo(120);
		expect(Number(rects[1].getAttribute('x'))).toBeCloseTo(240);
		expect(Number(rects[1].getAttribute('width'))).toBeCloseTo(120);
	});
});

describe('Band: horizontal segments', () => {
	it('draws full-width rects between the scaled y edges (y grows downward)', () => {
		const c = mount(
			{ kind: 'band', form: 'horizontal', segments: [{ y0: 2, y1: 4 }] },
			style({ edge: true })
		);
		const rect = c.querySelector('rect.band-rect');
		expect(Number(rect.getAttribute('x'))).toBeCloseTo(10);
		expect(Number(rect.getAttribute('width'))).toBeCloseTo(200);
		expect(Number(rect.getAttribute('y'))).toBeCloseTo(5 + 60); // upper edge y=4 → 60
		expect(Number(rect.getAttribute('height'))).toBeCloseTo(20);
		const edges = c.querySelectorAll('line.band-edge');
		expect(edges).toHaveLength(2);
		expect(Number(edges[0].getAttribute('y1'))).toBeCloseTo(85);
		expect(Number(edges[1].getAttribute('y1'))).toBeCloseTo(65);
	});
});

describe('Band: ribbon', () => {
	it('draws one area path between lower and upper, broken where either is not finite', () => {
		const c = mount({
			kind: 'band',
			form: 'ribbon',
			x: [0, 10, 20, 30],
			lower: [1, 1, NaN, 1],
			upper: [3, 3, 3, 3]
		});
		const path = c.querySelector('path.band-ribbon');
		expect(path).not.toBeNull();
		expect(path.getAttribute('fill')).toBe('#2C2C2C30');
		const d = path.getAttribute('d');
		// Two separate closed areas (the gap at index 2 splits the ribbon).
		expect((d.match(/M/g) ?? []).length).toBe(2);
		// The first area starts at the scaled (x=0, upper=3): x 10+0, y 5+70.
		expect(d.startsWith('M10,75')).toBe(true);
	});

	it('edge: true adds lower and upper edge paths', () => {
		const c = mount(
			{ kind: 'band', form: 'ribbon', x: [0, 10], lower: [1, 1], upper: [3, 3] },
			style({ edge: true, edgeColour: '#0000FF' })
		);
		const edges = c.querySelectorAll('path.band-edge');
		expect(edges).toHaveLength(2);
		expect(edges[0].getAttribute('stroke')).toBe('#0000FF');
		expect(edges[0].getAttribute('fill')).toBe('none');
	});

	it('renders nothing for an empty ribbon or an empty segment list', () => {
		const a = mount({ kind: 'band', form: 'ribbon', x: [], lower: [], upper: [] });
		expect(a.querySelectorAll('path, rect').length).toBe(0);
		const b = mount({ kind: 'band', form: 'vertical', segments: [] });
		expect(b.querySelectorAll('path, rect').length).toBe(0);
	});
});
