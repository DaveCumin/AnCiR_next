// The scatterplot's view-local render size.
//
// A workflow node's box has nothing to do with the figure's published dimensions, but the
// canvas used to draw the real plot at the FIGURE's size and CSS-scale it down. That is why a
// plot node could only be resized along the plot's own aspect ratio: any other shape
// letterboxed. `renderBox` lets the plot lay out to the box instead, so the axes and legend
// arrange for that shape and the text stays at full size.
import { describe, it, expect, beforeEach } from 'vitest';
import { Scatterplotclass } from './Scatterplot.svelte';

/** A plot wired to nothing; only its geometry is under test. */
function plotOfSize(w, h) {
	const p = new Scatterplotclass({ id: 1, width: w, height: h }, null);
	p.parentBox = { id: 1, width: w, height: h };
	return p;
}

describe('renderBox', () => {
	let plot;
	beforeEach(() => {
		plot = plotOfSize(600, 400);
		plot.padding = { top: 15, right: 30, bottom: 30, left: 30 };
	});

	it('defaults to the figure size, so nothing changes until a view asks', () => {
		expect(plot.renderBox).toBeNull();
		expect(plot.viewWidth).toBe(600);
		expect(plot.viewHeight).toBe(400);
		expect(plot.plotwidth).toBe(600 - 30 - 30);
		expect(plot.plotheight).toBe(400 - 15 - 30);
	});

	it('lays out to the box when one is set, with padding scaled to match the type', () => {
		// 600x400 figure, 240x200 box ⇒ fontScale 0.4. Only the TEXT-dependent part of the
		// padding shrinks; the fixed tick chrome (10px on left/bottom, 4px top/right) is held
		// back, so left becomes 10 + (30-10)*0.4 = 18 rather than 12.
		plot.renderBox = { w: 240, h: 200 };
		expect(plot.viewWidth).toBe(240);
		expect(plot.fontScale).toBeCloseTo(0.4, 6);
		expect(plot.plotwidth).toBeCloseTo(240 - 18 - 14.4, 6);
		expect(plot.plotheight).toBeCloseTo(200 - 8.4 - 18, 6);
	});

	it('takes ANY shape, which is the whole point', () => {
		// A 3:1 box on a 3:2 figure. Under the old scale-to-fit this letterboxed; now the
		// drawing area really is that shape. fontScale 0.5 halves the padding too.
		plot.renderBox = { w: 600, h: 200 };
		expect(plot.plotwidth).toBeCloseTo(600 - 20 - 17, 6);
		expect(plot.plotheight).toBeCloseTo(200 - 9.5 - 20, 6);
	});

	it('leaves the FIGURE untouched, so the workspace layout is unaffected', () => {
		plot.renderBox = { w: 240, h: 200 };
		expect(plot.parentBox.width).toBe(600);
		expect(plot.parentBox.height).toBe(400);
	});

	it('restores the figure size when cleared', () => {
		// EmbeddedPlot clears this on teardown. If it ever stopped, switching back to the
		// workspace would show the figure at the node's shape.
		plot.renderBox = { w: 240, h: 200 };
		plot.renderBox = null;
		expect(plot.viewWidth).toBe(600);
		expect(plot.viewHeight).toBe(400);
	});

	it('moves the x scale range with the box, not just the reported width', () => {
		// The scales are what actually place the data; a width that changed without them
		// would draw the old layout at a new size.
		plot.renderBox = { w: 240, h: 200 };
		expect(plot.XScale.range()[1]).toBeCloseTo(240 - 18 - 14.4, 6);
	});

	it('is not serialised — it describes a view, not the figure', () => {
		plot.renderBox = { w: 240, h: 200 };
		expect('renderBox' in plot.toJSON()).toBe(false);
	});

	it('is feature-detectable, which is how the canvas decides how to draw', () => {
		// EmbeddedPlot and WorkflowEditor both test `'renderBox' in plot` rather than keeping
		// a list of migrated plot types, so migrating the next plot touches only that plot.
		expect('renderBox' in plot).toBe(true);
		expect('renderBox' in { width: 1, height: 1 }).toBe(false);
	});
});

// Type scales WITH the box, or a small node is mostly axis labels.
//
// The old scaled thumbnail shrank the text along with everything else. Laying out to the box
// keeps the text at its printed size, which is right for a figure and wrong for a 240px node,
// so the view passes a multiplier down through the figure style.
describe('fontScale', () => {
	let plot;
	beforeEach(() => {
		plot = plotOfSize(600, 400);
	});

	it('is 1 at figure size, so the workspace is untouched', () => {
		expect(plot.fontScale).toBe(1);
		// And the style object handed down is the figure's own, not a copy.
		expect(plot.viewStyle).toBe(plot.parentBox.style);
	});

	it('follows the box down', () => {
		plot.renderBox = { w: 300, h: 200 };
		expect(plot.fontScale).toBeCloseTo(0.5, 6);
	});

	it('takes the SMALLER ratio, so text cannot overflow the tighter dimension', () => {
		// A wide, short node: plenty of width, very little height. Sizing off the width would
		// fill the box with labels.
		plot.renderBox = { w: 900, h: 100 };
		expect(plot.fontScale).toBeCloseTo(0.25, 6);
	});

	it('never exceeds 1: a big node shows more plot, not bigger words', () => {
		plot.renderBox = { w: 1200, h: 800 };
		expect(plot.fontScale).toBe(1);
	});

	it('has a floor, so type degrades rather than disappearing', () => {
		plot.renderBox = { w: 12, h: 8 };
		expect(plot.fontScale).toBe(0.2);
	});

	it('is 1 again once the box is cleared', () => {
		plot.renderBox = { w: 300, h: 200 };
		plot.renderBox = null;
		expect(plot.fontScale).toBe(1);
	});
});

// Padding exists to make room for TEXT, so it has to travel with the type size. Left alone, a
// 240px node spent ~40% of its width on margins holding labels drawn at half size.
describe('padding in a view', () => {
	let plot;
	beforeEach(() => {
		plot = plotOfSize(600, 400);
		plot.padding = { top: 20, right: 40, bottom: 60, left: 80 };
	});

	it("is the figure's own when drawing at figure size", () => {
		expect(plot.padding).toEqual({ top: 20, right: 40, bottom: 60, left: 80 });
	});

	it('scales with the type when drawing to a box', () => {
		plot.renderBox = { w: 300, h: 200 };
		expect(plot.fontScale).toBeCloseTo(0.5, 6);
		// chrome + (figure - chrome) * 0.5, per side.
		expect(plot.padding).toEqual({ top: 12, right: 22, bottom: 35, left: 45 });
	});

	it("SAVES the figure's padding, never the view's", () => {
		// A session saved while the canvas is showing must not bake a node's margins into the
		// figure. This is the one that would quietly ruin a paper's figures.
		plot.renderBox = { w: 300, h: 200 };
		expect(plot.toJSON().padding).toEqual({ top: 20, right: 40, bottom: 60, left: 80 });
	});

	it("returns to the figure's padding when the box is cleared", () => {
		plot.renderBox = { w: 300, h: 200 };
		plot.renderBox = null;
		expect(plot.padding).toEqual({ top: 20, right: 40, bottom: 60, left: 80 });
	});

	it('keeps object identity at figure size, so nothing re-renders on every read', () => {
		expect(plot.padding).toBe(plot.padding);
	});

	it('refuses to auto-measure while drawing to a box', () => {
		// Padding is a FIGURE property; a node measures its own smaller render, so letting it
		// write would redefine the figure's margins from whichever view mounted last.
		plot.renderBox = { w: 300, h: 200 };
		plot.autoScalePadding('all');
		expect(plot.toJSON().padding).toEqual({ top: 20, right: 40, bottom: 60, left: 80 });
	});
});

// The clipping this scaling had to be corrected for.
describe('padding keeps room for the fixed axis chrome', () => {
	let plot;
	beforeEach(() => {
		plot = plotOfSize(600, 400);
	});

	it('holds back the tick mark and gap, which do not scale with the type', () => {
		// The measured case: a 500x320 figure in a 240x153.6 node, fontScale 0.48. Axis.svelte
		// draws ticks at 6px and the tick gap at 4px whatever the font size. Scaling the WHOLE
		// padding squeezed those out: a "20,000" label measured 25.4px and the axis needed
		// 35.4px, but a figure padding of 72 scaled to 34.56 — so the labels hung off the left
		// edge and the node's overflow:hidden cut them in half. 10 + 62 x 0.48 = 39.76 fits.
		const p = plotOfSize(500, 320);
		p.padding = { top: 15, right: 30, bottom: 36, left: 72 };
		p.renderBox = { w: 240, h: 153.6 };
		expect(p.fontScale).toBeCloseTo(0.48, 6);
		expect(p.padding.left).toBeGreaterThan(35.4);
	});

	it('never returns less room than the chrome needs', () => {
		plot.padding = { top: 15, right: 30, bottom: 36, left: 72 };
		plot.renderBox = { w: 24, h: 16 }; // absurdly small: fontScale floors at 0.2
		expect(plot.padding.left).toBeGreaterThanOrEqual(10);
		expect(plot.padding.bottom).toBeGreaterThanOrEqual(10);
	});

	it('leaves a padding already smaller than the chrome alone', () => {
		// The caller asked for less room than the ticks need; scaling is not the place to
		// overrule them, and growing it would move the plot on them.
		plot.padding = { top: 2, right: 2, bottom: 3, left: 3 };
		plot.renderBox = { w: 300, h: 200 };
		expect(plot.padding).toEqual({ top: 2, right: 2, bottom: 3, left: 3 });
	});
});
