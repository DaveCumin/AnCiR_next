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
		// 600x400 figure, 240x200 box ⇒ fontScale 0.4, so the 30px side padding that exists to
		// hold full-size labels becomes 12px for labels drawn at 0.4.
		plot.renderBox = { w: 240, h: 200 };
		expect(plot.viewWidth).toBe(240);
		expect(plot.fontScale).toBeCloseTo(0.4, 6);
		expect(plot.plotwidth).toBeCloseTo(240 - 12 - 12, 6);
		expect(plot.plotheight).toBeCloseTo(200 - 6 - 12, 6);
	});

	it('takes ANY shape, which is the whole point', () => {
		// A 3:1 box on a 3:2 figure. Under the old scale-to-fit this letterboxed; now the
		// drawing area really is that shape. fontScale 0.5 halves the padding too.
		plot.renderBox = { w: 600, h: 200 };
		expect(plot.plotwidth).toBeCloseTo(600 - 15 - 15, 6);
		expect(plot.plotheight).toBeCloseTo(200 - 7.5 - 15, 6);
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
		expect(plot.XScale.range()[1]).toBeCloseTo(240 - 12 - 12, 6);
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
		expect(plot.padding).toEqual({ top: 10, right: 20, bottom: 30, left: 40 });
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
