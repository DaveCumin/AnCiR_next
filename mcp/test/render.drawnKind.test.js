// render_plot waits for what a plot actually draws (engine/renderPlot.js drawnKind): the svg
// the GUI's export reads for a chart, an HTML table for the Table. It used to wait for
// `#app svg`, which a tableplot never draws, so every tableplot render timed out.
import { afterEach, describe, expect, it } from 'vitest';
import { drawnKind } from '../src/engine/renderPlot.js';

afterEach(() => {
	document.body.innerHTML = '';
	delete window.__ancirPlotId;
});

describe('drawnKind', () => {
	it("is 'svg' once the plot's export svg (#plot<id>) exists", () => {
		window.__ancirPlotId = 4;
		document.body.innerHTML = '<div id="app"><svg id="plot4"></svg></div>';
		expect(drawnKind()).toBe('svg');
	});

	it("is 'html' for a plot that draws elements and no svg (the Table's CSS grid)", () => {
		window.__ancirPlotId = 4;
		document.body.innerHTML =
			'<div id="app"><div class="tableplot-layout"><div class="tp-th">y</div></div></div>';
		expect(drawnKind()).toBe('html');
	});

	it('is null while nothing is drawn (comment anchors only) and while a chart has an svg but not yet its export svg', () => {
		window.__ancirPlotId = 4;
		document.body.innerHTML = '<div id="app"><!----></div>';
		expect(drawnKind()).toBe(null);
		document.body.innerHTML =
			'<div id="app"><div class="wrap"><svg class="icon"></svg></div></div>';
		expect(drawnKind()).toBe(null);
	});

	it("reads the export svg of THIS plot only (another plot's id does not count)", () => {
		window.__ancirPlotId = 2;
		document.body.innerHTML = '<div id="app"><div><svg id="plot7"></svg></div></div>';
		expect(drawnKind()).toBe(null);
		document.body.innerHTML = '<div id="app"><div><svg id="plot2"></svg></div></div>';
		expect(drawnKind()).toBe('svg');
	});
});
