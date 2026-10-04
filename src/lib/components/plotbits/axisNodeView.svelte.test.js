// @ts-nocheck
// An axis in a workflow-canvas node must be a miniature of the figure's axis.
//
// A node draws the plot at the node's size and shrinks the TYPE by `fontScale` (about 0.46 for
// the shipped demos: a 520 x 300 figure in a 237 x 137 node). The padding a node sees is the
// figure's, scaled the same way (plots/viewBox.js scalePadding). Axis.svelte drew the tick
// marks, the tick-to-label gap and the label-to-title buffer at FULL size on that miniature,
// so the y-axis title ("Count", "Magnitude", "Activity") sat about 3 px left of the node's
// edge and was clipped. It also measured the tick labels in SCREEN pixels, so the title moved
// with the canvas zoom the node happened to mount at.
//
// Text has no layout in happy-dom, so SVG text is measured with a simple, deterministic font
// model (below). The assertions are about Axis's arithmetic, not about any real font.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { scaleLinear } from 'd3-scale';
import Axis, { AxisClass } from '$lib/components/plotbits/Axis.svelte';
import { resolveStyle } from '$lib/plots/figureStyle.js';
import { scalePadding } from '$lib/plots/viewBox.js';

// The scale a default-sized plot node draws at (see legendNodeView.svelte.test.js).
const NODE_SCALE = 237 / 520;

// Font model: glyph advance, line box, and the title's extent either side of its baseline.
const CHAR_EM = 0.6;
const LINE_EM = 1.2;
const ASCENT_EM = 0.8;
const DESCENT_EM = 0.25;

// The CSS zoom of the canvas the plot sits in. A browser reports it twice, consistently: in
// every client rect (screen pixels) and in every element's screen CTM.
let screenZoom = 1;

function fontPxOf(el) {
	for (let n = el; n; n = n.parentElement) {
		const fs = parseFloat(n.style?.fontSize);
		if (Number.isFinite(fs)) return fs;
	}
	return 10;
}
/** A text element's size in SVG units under the font model. */
function localBox(el) {
	const px = fontPxOf(el);
	return { width: (el.textContent ?? '').length * px * CHAR_EM, height: px * LINE_EM };
}

// Patch the concrete <text> and <g> prototypes: happy-dom defines its own (zero-sized) layout
// methods there, which would shadow a patch further up the chain.
const SVG_NS = 'http://www.w3.org/2000/svg';
const textProto = Object.getPrototypeOf(globalThis.document.createElementNS(SVG_NS, 'text'));
const gProto = Object.getPrototypeOf(globalThis.document.createElementNS(SVG_NS, 'g'));
const patches = [
	[
		textProto,
		'getBoundingClientRect',
		function () {
			const b = localBox(this);
			const w = b.width * screenZoom;
			const h = b.height * screenZoom;
			return { x: 0, y: 0, left: 0, top: 0, right: w, bottom: h, width: w, height: h };
		}
	],
	[
		gProto,
		'getScreenCTM',
		function () {
			return { a: screenZoom, b: 0, c: 0, d: screenZoom, e: 0, f: 0 };
		}
	]
];
const saved = [];
beforeAll(() => {
	for (const [proto, name, value] of patches) {
		saved.push([proto, name, Object.getOwnPropertyDescriptor(proto, name)]);
		Object.defineProperty(proto, name, { configurable: true, writable: true, value });
	}
});
afterAll(() => {
	for (const [proto, name, desc] of saved) {
		if (desc) Object.defineProperty(proto, name, desc);
		else delete proto[name];
	}
});
afterEach(() => {
	screenZoom = 1;
	cleanup();
});

// A full-size figure: wide tick labels on the y axes ("20,000") to make the margin matter.
const FIG = { width: 520, height: 300 };
const POSITIONS = ['left', 'bottom', 'right', 'top'];

/**
 * Draw one axis and read back what Axis.svelte placed.
 * @returns {{tickLine: number, tickText: number, titleOffset: number, maxTick: number,
 *   titlePx: number}} `tickLine` and `tickText` are the signed offsets along the axis normal;
 *   `titleOffset` is the title baseline's distance from the axis line, positive outwards.
 */
function drawAxis(position, { fontScale = 1, padding, width, height }) {
	const vertical = position === 'left' || position === 'right';
	const scale = vertical
		? scaleLinear().domain([0, 20000]).range([height, 0])
		: scaleLinear().domain([0, 48]).range([0, width]);
	const { container } = render(Axis, {
		props: {
			which: 'plot',
			axisData: new AxisClass({ label: vertical ? 'Magnitude' : 'Period (hours)' }),
			position,
			scale,
			width,
			height,
			plotPadding: padding,
			figureStyle: fontScale === 1 ? null : { fontScale }
		}
	});
	const g = container.querySelector(`g.axis-${position}`);
	const tick = g.querySelector('.tick');
	const line = tick.querySelector('line:not(.gridline)');
	const text = tick.querySelector('text');
	const title = g.querySelector('.axis-label');
	const coord = vertical ? 'x' : 'y';
	const maxTick = Math.max(
		...[...g.querySelectorAll('.tick text')].map((t) =>
			vertical ? localBox(t).width : localBox(t).height
		)
	);
	const out = {
		tickLine: Number(line.getAttribute(coord + '2')),
		tickText: Number(text.getAttribute(coord)),
		titleOffset: Math.abs(Number(title.getAttribute('y'))),
		maxTick,
		titlePx: parseFloat(title.style.fontSize)
	};
	cleanup();
	return out;
}

/** How far the title reaches outward from the axis line, glyphs included. */
function titleReach(position, a) {
	// A bottom title hangs BELOW its baseline by the descent; the others are rotated or above,
	// so their far edge is the ascent beyond the baseline.
	return a.titleOffset + a.titlePx * (position === 'bottom' ? DESCENT_EM : ASCENT_EM);
}

/** The tightest figure padding that holds every title: what autoScalePadding converges to. */
function tightFigurePadding() {
	const base = { top: 40, right: 40, bottom: 40, left: 40 };
	const pad = {};
	for (const pos of POSITIONS) {
		const a = drawAxis(pos, {
			padding: base,
			width: FIG.width - 80,
			height: FIG.height - 80
		});
		pad[pos] = Math.ceil(titleReach(pos, a));
	}
	return pad;
}

describe('axis geometry at full size (workspace and export)', () => {
	it('is unchanged: 6 px ticks, 4 px gap, 16 px title buffer', () => {
		const padding = { top: 40, right: 40, bottom: 53, left: 60 };
		for (const pos of POSITIONS) {
			const a = drawAxis(pos, { padding, width: 430, height: 232 });
			const sign = pos === 'left' || pos === 'top' ? -1 : 1;
			expect(a.tickLine, pos).toBe(6 * sign);
			expect(a.tickText, pos).toBe(10 * sign);
			expect(a.titleOffset, pos).toBeCloseTo(4 + a.maxTick + 16, 9);
			// The style string carries a rounded px value.
			expect(a.titlePx, pos).toBeCloseTo(resolveStyle(null).sizes.axisLabel, 5);
		}
	});

	it('keeps the measured bytes when the screen scale is 1 within layout noise', () => {
		// Chrome reports a CTM of 0.9999957 for a workspace plot on its first frame. That is
		// layout settling, not a zoom: the title must sit exactly where the unscaled client rect
		// puts it, as it always has, or every workspace axis and export changes in the 4th decimal.
		const padding = { top: 40, right: 40, bottom: 53, left: 60 };
		screenZoom = 0.9999956550371322;
		for (const pos of POSITIONS) {
			const a = drawAxis(pos, { padding, width: 430, height: 232 });
			expect(a.titleOffset, pos).toBe(4 + a.maxTick * screenZoom + 16);
		}
	});
});

describe('axis titles in a workflow node', () => {
	it('stay inside the plot svg at the shipped node scale, on every side', () => {
		const figPad = tightFigurePadding();
		const nodePad = scalePadding(figPad, NODE_SCALE);
		const w = FIG.width * NODE_SCALE - nodePad.left - nodePad.right;
		const h = FIG.height * NODE_SCALE - nodePad.top - nodePad.bottom;
		for (const pos of POSITIONS) {
			const a = drawAxis(pos, { fontScale: NODE_SCALE, padding: nodePad, width: w, height: h });
			expect(
				titleReach(pos, a),
				`${pos} title reach vs ${nodePad[pos]} px of padding`
			).toBeLessThanOrEqual(nodePad[pos]);
		}
	});

	it('are the figure axis scaled down: ticks, gap and title offset alike', () => {
		const padding = { top: 40, right: 40, bottom: 53, left: 60 };
		for (const pos of POSITIONS) {
			const full = drawAxis(pos, { padding, width: 430, height: 232 });
			const node = drawAxis(pos, {
				fontScale: NODE_SCALE,
				padding: scalePadding(padding, NODE_SCALE),
				width: 430 * NODE_SCALE,
				height: 232 * NODE_SCALE
			});
			expect(node.tickLine, pos).toBeCloseTo(full.tickLine * NODE_SCALE, 9);
			expect(node.tickText, pos).toBeCloseTo(full.tickText * NODE_SCALE, 9);
			// Font sizes reach the DOM as rounded px strings, hence 5 places.
			expect(node.titleOffset, pos).toBeCloseTo(full.titleOffset * NODE_SCALE, 5);
		}
	});

	it('do not move with the canvas zoom the node mounted at', () => {
		// The tick labels are measured in screen pixels and the zoom divided back out, so a node
		// mounted while the canvas is zoomed to 1.3x (three zoom-in clicks) places its title exactly
		// where it would at 1x.
		const padding = scalePadding({ top: 40, right: 40, bottom: 53, left: 60 }, NODE_SCALE);
		const args = { fontScale: NODE_SCALE, padding, width: 196, height: 106 };
		for (const pos of POSITIONS) {
			const at1 = drawAxis(pos, args);
			screenZoom = 1.3;
			const at2 = drawAxis(pos, args);
			screenZoom = 1;
			expect(at2.titleOffset, pos).toBeCloseTo(at1.titleOffset, 9);
		}
	});
});
