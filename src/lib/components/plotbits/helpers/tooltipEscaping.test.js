/**
 * Tooltip content is an HTML STRING rendered with `{@html}` (PlotTooltip.svelte), and
 * the values `buildAggregatedContent` interpolates into it are not developer copy:
 * series labels come from imported CSV column headers and from label fields the user
 * types into, and sessions travel between researchers as files. A header like
 * `<img src=x onerror=...>` therefore used to execute on hover, in the reader's
 * session, with no warning.
 *
 * Two halves are pinned here, and both matter:
 *   1. hostile values come back ESCAPED, with no executable markup left;
 *   2. ordinary labels keep their deliberate formatting (the colour dot, the bold
 *      label, the value), because over-escaping would visibly break every tooltip.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { buildAggregatedContent, escapeHtml, safeColour } from './tooltipHelpers.js';
import PlotTooltip from '../PlotTooltip.svelte';

afterEach(() => cleanup());

const XSS = `<img src=x onerror="window.__pwned=1">`;

/** Parse the built string and report which ELEMENTS it actually creates. */
function elementsIn(html) {
	const host = document.createElement('div');
	host.innerHTML = html;
	return [...new Set([...host.querySelectorAll('*')].map((e) => e.tagName))].sort();
}

/** Any `on*` handler attribute that survived, on any element. */
function handlerAttrsIn(html) {
	const host = document.createElement('div');
	host.innerHTML = html;
	return [...host.querySelectorAll('*')].flatMap((e) =>
		[...e.attributes].map((a) => a.name).filter((n) => n.startsWith('on'))
	);
}

describe('escapeHtml', () => {
	it('escapes every character that can break out of text or an attribute', () => {
		expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
	});

	it('escapes the ampersand first, so an escape is not double-decoded', () => {
		// '&lt;' typed literally must survive as text, not decode back to '<'.
		expect(escapeHtml('&lt;')).toBe('&amp;lt;');
	});

	it('renders non-strings and nullish values without throwing', () => {
		expect(escapeHtml(null)).toBe('');
		expect(escapeHtml(undefined)).toBe('');
		expect(escapeHtml(12.5)).toBe('12.5');
	});
});

describe('safeColour', () => {
	it('passes through the colour shapes the app actually produces', () => {
		for (const c of [
			'#234154',
			'#fbe67280',
			'#abc',
			'#abcd',
			'rgb(1, 2, 3)',
			'rgba(1, 2, 3, 0.5)',
			'hsl(210 50% 40%)',
			'rgb(0 0 0 / 50%)',
			'red',
			'currentColor',
			'transparent'
		]) {
			expect(safeColour(c)).toBe(c);
		}
	});

	it('rejects a value that would keep painting but smuggle extra declarations', () => {
		// The app's other colour validators test only a `rgb(` PREFIX, so this shape
		// reaches the tooltip. Inside `style="background:…"` the semicolon ends the
		// declaration and everything after it is attacker CSS.
		expect(safeColour('rgb(0,0,0);position:fixed;inset:0')).toBe('currentColor');
	});

	it('rejects a value that would close the style attribute', () => {
		expect(safeColour('red" onmouseover="alert(1)')).toBe('currentColor');
		expect(safeColour('#fff;"><script>alert(1)</script>')).toBe('currentColor');
	});

	it('falls back for nullish, empty and non-string input', () => {
		expect(safeColour(null)).toBe('currentColor');
		expect(safeColour('')).toBe('currentColor');
		expect(safeColour({})).toBe('currentColor');
	});
});

describe('buildAggregatedContent escaping', () => {
	it('escapes a series label containing < > " \' and &', () => {
		const html = buildAggregatedContent({
			xLabel: 'x',
			xValue: 1,
			series: [{ label: `a<b>&"'c`, colour: '#234154', yValue: 2 }]
		});
		expect(html).toContain('a&lt;b&gt;&amp;&quot;&#39;c');
		expect(html).not.toContain('<b>');
	});

	it('leaves no executable markup when the label is an XSS payload', () => {
		const html = buildAggregatedContent({
			xValue: 1,
			series: [{ label: XSS, colour: '#234154', yValue: 2 }]
		});
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img src=x onerror=&quot;window.__pwned=1&quot;&gt;');
		// The substring "onerror" survives as TEXT, which is correct; what must not
		// survive is an element or a handler attribute, so parse rather than grep.
		expect(elementsIn(html)).toEqual(['BR', 'SPAN', 'STRONG']);
		expect(handlerAttrsIn(html)).toEqual([]);
	});

	it('escapes the x-axis label, which is a user-editable field too', () => {
		const html = buildAggregatedContent({
			xLabel: XSS,
			xValue: 1,
			series: [{ label: 'ok', colour: '#234154', yValue: 2 }]
		});
		expect(html).not.toContain('<img');
	});

	it('escapes a non-numeric x value, which passes through safeFormat unchanged', () => {
		// safeFormat returns a non-number as-is, so a text/category column's value
		// lands in the markup verbatim.
		const html = buildAggregatedContent({
			xValue: XSS,
			series: [{ label: 'ok', colour: '#234154', yValue: 2 }]
		});
		expect(html).not.toContain('<img');
	});

	it('escapes a non-numeric y value for the same reason', () => {
		const html = buildAggregatedContent({
			xValue: 1,
			series: [{ label: 'ok', colour: '#234154', yValue: XSS }]
		});
		expect(html).not.toContain('<img');
	});

	it('honours a custom xFormatter but still escapes what it returns', () => {
		const html = buildAggregatedContent({
			xValue: 1,
			xFormatter: () => XSS,
			series: [{ label: 'ok', colour: '#234154', yValue: 2 }]
		});
		expect(html).not.toContain('<img');
	});

	it('neutralises a colour crafted to close the style attribute', () => {
		const html = buildAggregatedContent({
			xValue: 1,
			series: [{ label: 'ok', colour: `red" onmouseover="alert(1)`, yValue: 2 }]
		});
		expect(html).not.toContain('onmouseover');
		expect(html).toContain('background:currentColor;');
	});

	it('keeps the dot, the bold label and the value for an ordinary series', () => {
		const html = buildAggregatedContent({
			xLabel: 'time',
			xValue: 10,
			series: [{ label: 'activity', colour: '#234154', yValue: 8.04 }]
		});
		expect(html).toContain('<span style="opacity:0.7">time:</span> 10.000');
		expect(html).toContain('background:#234154;');
		expect(html).toContain('<strong>activity:</strong> 8.040');
		expect(html).toContain('<br/>');
	});
});

describe('PlotTooltip rendering', () => {
	/** The tooltip portals itself to <body>, so that is where it must be read back. */
	const tip = () => document.body.querySelector('.plot-tooltip');

	it('shows a markup label as visible text, not as an element', () => {
		render(PlotTooltip, {
			props: {
				visible: true,
				x: 0,
				y: 0,
				content: buildAggregatedContent({
					xValue: 10,
					series: [{ label: XSS, colour: '#234154', yValue: 8.04 }]
				})
			}
		});
		const el = tip();
		expect(el).toBeTruthy();
		expect(el.querySelectorAll('img')).toHaveLength(0);
		expect(el.textContent).toContain(XSS);
	});

	it('still renders the swatch and the bold label for an ordinary series', () => {
		render(PlotTooltip, {
			props: {
				visible: true,
				x: 0,
				y: 0,
				content: buildAggregatedContent({
					xLabel: 'time',
					xValue: 10,
					series: [{ label: 'activity', colour: '#234154', yValue: 8.04 }]
				})
			}
		});
		const el = tip();
		const strong = el.querySelector('strong');
		expect(strong.textContent).toBe('activity:');
		// The dot is the only span carrying a background.
		const dot = [...el.querySelectorAll('span')].find((s) =>
			s.getAttribute('style')?.includes('background')
		);
		expect(dot.getAttribute('style')).toContain('#234154');
		expect(el.textContent).toContain('time: 10.000');
		expect(el.textContent).toContain('activity: 8.040');
	});
});
