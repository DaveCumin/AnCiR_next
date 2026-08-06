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

	it('lays out to the box when one is set', () => {
		plot.renderBox = { w: 240, h: 200 };
		expect(plot.viewWidth).toBe(240);
		expect(plot.plotwidth).toBe(240 - 30 - 30);
		expect(plot.plotheight).toBe(200 - 15 - 30);
	});

	it('takes ANY shape, which is the whole point', () => {
		// A 3:1 box on a 3:2 figure. Under the old scale-to-fit this letterboxed; now the
		// drawing area really is that shape.
		plot.renderBox = { w: 600, h: 200 };
		expect(plot.plotwidth / plot.plotheight).toBeCloseTo(540 / 155, 5);
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
		expect(plot.XScale.range()).toEqual([0, 240 - 60]);
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
