// Exported figures must carry real colours, a real background and a real size.
//
// The defect: plot output referenced CSS custom properties as presentation
// attributes (fill="var(--color-lightness-25)" in CWT, PairsPlot, Actogram,
// CircularPhase; the legend box stroke). Those resolve on screen and in NEITHER
// export path — a standalone SVG has no stylesheet, and an SVG loaded as an <img>
// for rasterising is an isolated document. So a figure that looked right on screen
// exported with unresolved paint, which for a publication feature was the most
// serious thing in the design.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	resolveSvgVars,
	addBackgroundRect,
	setPhysicalSize,
	prepareSvgForExport,
	prepareExport,
	addTitle
} from './exportStyle.js';
import { PX_PER_MM } from './figureStyle.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
let host;

/** A live SVG in the document, so getComputedStyle can resolve against it. */
function mount(markup, vars = { '--tone': 'rgb(51, 51, 51)' }) {
	host = document.createElement('div');
	for (const [k, v] of Object.entries(vars)) host.style.setProperty(k, v);
	host.innerHTML = `<svg xmlns="${SVG_NS}" width="200" height="100">${markup}</svg>`;
	document.body.appendChild(host);
	return host.querySelector('svg');
}

beforeEach(() => {
	host = null;
});
afterEach(() => {
	host?.remove();
});

describe('resolveSvgVars', () => {
	it('replaces a var() fill with the resolved literal', () => {
		const svg = mount('<rect fill="var(--tone)" />');
		const clone = svg.cloneNode(true);
		expect(resolveSvgVars(svg, clone)).toBeGreaterThan(0);
		const out = clone.querySelector('rect').getAttribute('fill');
		expect(out).not.toContain('var(');
		expect(out).toBe('rgb(51, 51, 51)');
	});

	it('replaces a var() stroke too', () => {
		// The legend box, specifically.
		const svg = mount('<rect stroke="var(--tone)" />');
		const clone = svg.cloneNode(true);
		resolveSvgVars(svg, clone);
		expect(clone.querySelector('rect').getAttribute('stroke')).toBe('rgb(51, 51, 51)');
	});

	it('leaves literal colours alone', () => {
		const svg = mount('<rect fill="#ff0000" stroke="black" />');
		const clone = svg.cloneNode(true);
		expect(resolveSvgVars(svg, clone)).toBe(0);
		expect(clone.querySelector('rect').getAttribute('fill')).toBe('#ff0000');
		expect(clone.querySelector('rect').getAttribute('stroke')).toBe('black');
	});

	it('does NOT modify the live tree', () => {
		// The figure on screen must look identical after an export.
		const svg = mount('<rect fill="var(--tone)" />');
		const clone = svg.cloneNode(true);
		resolveSvgVars(svg, clone);
		expect(svg.querySelector('rect').getAttribute('fill')).toBe('var(--tone)');
	});

	it('handles nested elements at depth', () => {
		const svg = mount('<g><g><text fill="var(--tone)">x</text></g></g>');
		const clone = svg.cloneNode(true);
		resolveSvgVars(svg, clone);
		expect(clone.querySelector('text').getAttribute('fill')).toBe('rgb(51, 51, 51)');
	});

	it('bails out rather than mispaint when the trees differ', () => {
		// Resolution is by index, so a shape mismatch would paint elements with a
		// neighbour's colour. Leaving the export unresolved is the lesser failure.
		const svg = mount('<rect fill="var(--tone)" /><rect fill="var(--tone)" />');
		const clone = svg.cloneNode(true);
		clone.removeChild(clone.lastChild);
		expect(resolveSvgVars(svg, clone)).toBe(0);
	});

	it('tolerates missing arguments', () => {
		expect(resolveSvgVars(null, null)).toBe(0);
	});
});

describe('addBackgroundRect', () => {
	it('inserts an opaque rect behind everything', () => {
		const svg = mount('<circle r="5" />');
		const clone = svg.cloneNode(true);
		expect(addBackgroundRect(clone, '#ffffff', 200, 100)).toBe(true);
		expect(clone.firstChild.tagName).toBe('rect');
		expect(clone.firstChild.getAttribute('fill')).toBe('#ffffff');
		expect(clone.firstChild.getAttribute('width')).toBe('200');
	});

	it('does nothing for transparent, which is the default', () => {
		const svg = mount('<circle r="5" />');
		const clone = svg.cloneNode(true);
		expect(addBackgroundRect(clone, 'transparent', 200, 100)).toBe(false);
		expect(clone.querySelector('rect')).toBeNull();
	});

	it('uses a rect, not a CSS background', () => {
		// `background` is not an SVG presentation attribute: it works in an HTML context
		// and vanishes the moment the file is standalone, which is the case that matters.
		const svg = mount('<circle r="5" />');
		const clone = svg.cloneNode(true);
		addBackgroundRect(clone, '#ffffff', 200, 100);
		expect(clone.getAttribute('style') ?? '').not.toContain('background');
	});
});

describe('setPhysicalSize', () => {
	it('declares mm dimensions alongside a px viewBox', () => {
		const svg = mount('<circle r="5" />');
		const clone = svg.cloneNode(true);
		expect(setPhysicalSize(clone, 321.26, 200)).toBe(true);
		expect(clone.getAttribute('viewBox')).toBe('0 0 321.26 200');
		// 321.26 px / (96/25.4) = 85 mm
		expect(parseFloat(clone.getAttribute('width'))).toBeCloseTo(85, 1);
		expect(clone.getAttribute('width').endsWith('mm')).toBe(true);
		expect(clone.getAttribute('height').endsWith('mm')).toBe(true);
	});

	it('refuses nonsensical dimensions rather than emitting a broken file', () => {
		const svg = mount('<circle r="5" />');
		const clone = svg.cloneNode(true);
		expect(setPhysicalSize(clone, 0, 100)).toBe(false);
		expect(setPhysicalSize(clone, NaN, 100)).toBe(false);
	});

	it('round-trips a known width', () => {
		const svg = mount('<circle r="5" />');
		const clone = svg.cloneNode(true);
		setPhysicalSize(clone, 85 * PX_PER_MM, 100);
		expect(parseFloat(clone.getAttribute('width'))).toBeCloseTo(85, 2);
	});
});

describe('prepareSvgForExport', () => {
	it('resolves paint and adds a background in one pass', () => {
		const svg = mount('<rect fill="var(--tone)" />');
		const clone = prepareSvgForExport(svg, {
			width: 200,
			height: 100,
			backgroundColour: '#ffffff'
		});
		expect(clone.firstChild.getAttribute('fill')).toBe('#ffffff');
		expect(clone.querySelectorAll('rect')[1].getAttribute('fill')).toBe('rgb(51, 51, 51)');
	});

	it('only declares physical size when asked (raster path does not want it)', () => {
		const svg = mount('<rect fill="#000" />');
		const raster = prepareSvgForExport(svg, { width: 200, height: 100 });
		expect(raster.getAttribute('width')).toBe('200');
		const vector = prepareSvgForExport(svg, { width: 200, height: 100, physical: true });
		expect(vector.getAttribute('width').endsWith('mm')).toBe(true);
	});

	it('returns null for a missing element rather than throwing mid-export', () => {
		expect(prepareSvgForExport(null, { width: 1, height: 1 })).toBeNull();
	});
});

describe('addTitle', () => {
	const font = { fontFamily: 'Georgia, serif', fontSize: 16 };

	it('draws the title as a <text> at the top-left, inside the padding', () => {
		const svg = mount('<circle r="5" />');
		const clone = svg.cloneNode(true);
		const out = addTitle(clone, { text: 'Activity by day', width: 200, height: 100, ...font });
		const text = clone.querySelector('text.export-title');
		expect(text).not.toBeNull();
		expect(text.textContent).toBe('Activity by day');
		expect(parseFloat(text.getAttribute('x'))).toBeGreaterThan(0);
		expect(parseFloat(text.getAttribute('x'))).toBeLessThan(20);
		expect(text.getAttribute('font-family')).toBe('Georgia, serif');
		expect(text.getAttribute('font-size')).toBe('16');
		expect(out.width).toBe(200);
	});

	it('shifts the existing content down by the band instead of overlaying it', () => {
		const svg = mount('<circle r="5" />');
		const clone = svg.cloneNode(true);
		const { height } = addTitle(clone, { text: 'T', width: 200, height: 100, ...font });
		const band = height - 100;
		expect(band).toBeGreaterThan(16);
		const wrapper = clone.querySelector('g.export-content');
		expect(wrapper.getAttribute('transform')).toBe(`translate(0, ${band})`);
		expect(wrapper.querySelector('circle')).not.toBeNull();
		// The svg itself grew by the same amount, and the viewBox follows.
		expect(parseFloat(clone.getAttribute('height'))).toBe(height);
		expect(clone.getAttribute('viewBox')).toBe(`0 0 200 ${height}`);
	});

	it('wraps a long title onto a second line and ellipsises past that', () => {
		const svg = mount('<circle r="5" />');
		const clone = svg.cloneNode(true);
		const long =
			'A very long title that will not fit on a single line of this narrow figure at all';
		const { height } = addTitle(clone, { text: long, width: 200, height: 100, ...font });
		const spans = clone.querySelectorAll('text.export-title tspan');
		expect(spans.length).toBe(2);
		expect(spans[1].textContent.endsWith('…')).toBe(true);
		// Two lines reserve a taller band than one.
		const one = svg.cloneNode(true);
		const short = addTitle(one, { text: 'Short', width: 200, height: 100, ...font });
		expect(height).toBeGreaterThan(short.height);
	});

	it('draws a bold panel label ahead of the title, or alone', () => {
		const svg = mount('<circle r="5" />');
		const both = svg.cloneNode(true);
		addTitle(both, { text: 'Title', label: 'a', width: 200, height: 100, ...font });
		const label = both.querySelector('tspan.export-panel-label');
		expect(label.textContent).toBe('a');
		expect(label.getAttribute('font-weight')).toBe('700');
		expect(both.querySelector('text.export-title').textContent).toContain('Title');

		const alone = svg.cloneNode(true);
		const out = addTitle(alone, { text: '', label: 'b', width: 200, height: 100, ...font });
		expect(alone.querySelector('tspan.export-panel-label').textContent).toBe('b');
		expect(out.height).toBeGreaterThan(100);
	});

	it('does nothing when there is neither a title nor a label', () => {
		const svg = mount('<circle r="5" />');
		const clone = svg.cloneNode(true);
		expect(addTitle(clone, { text: '', width: 200, height: 100, ...font })).toBeNull();
		expect(clone.querySelector('text.export-title')).toBeNull();
		expect(clone.querySelector('g.export-content')).toBeNull();
	});

	it('leaves <defs> at the top level so clip paths keep resolving', () => {
		const svg = mount('<defs><clipPath id="c"><rect /></clipPath></defs><circle r="5" />');
		const clone = svg.cloneNode(true);
		addTitle(clone, { text: 'T', width: 200, height: 100, ...font });
		expect(clone.querySelector(':scope > defs')).not.toBeNull();
		expect(clone.querySelector('g.export-content > defs')).toBeNull();
	});
});

describe('prepareExport with a title', () => {
	it('puts the background behind the enlarged figure and sizes it physically', () => {
		const svg = mount('<circle r="5" />');
		const { svg: clone, height } = prepareExport(svg, {
			width: 200,
			height: 100,
			backgroundColour: '#ffffff',
			physical: true,
			title: { text: 'Hello', fontFamily: 'sans-serif', fontSize: 14 }
		});
		expect(height).toBeGreaterThan(100);
		const bg = clone.firstChild;
		expect(bg.tagName.toLowerCase()).toBe('rect');
		expect(parseFloat(bg.getAttribute('height'))).toBe(height);
		expect(clone.getAttribute('viewBox')).toBe(`0 0 200 ${height}`);
		expect(clone.getAttribute('height').endsWith('mm')).toBe(true);
	});

	it('reports the original size when the title is off', () => {
		const svg = mount('<circle r="5" />');
		const out = prepareExport(svg, { width: 200, height: 100, title: null });
		expect(out.height).toBe(100);
		expect(out.svg.querySelector('text.export-title')).toBeNull();
	});
});
