import { describe, it, expect } from 'vitest';
import { getIconRaw, hasIcon, iconHtml } from './iconRegistry.js';

describe('iconRegistry — shared single source of inline icons', () => {
	it('loads known icons and normalises colour fills to currentColor', () => {
		expect(getIconRaw('process')).toContain('<svg');
		expect(getIconRaw('process')).toContain('</svg>');
		expect(hasIcon('process')).toBe(true);
		// Colour fills are recoloured to currentColor…
		expect(getIconRaw('align-bottom')).toContain('fill="currentColor"');
		// …but fill="none" outlines are preserved.
		expect(getIconRaw('actogram')).toContain('fill="none"');
	});

	it('reports unknown icons without throwing', () => {
		expect(hasIcon('definitely-not-an-icon')).toBe(false);
		expect(getIconRaw('definitely-not-an-icon')).toBe('');
		expect(iconHtml('definitely-not-an-icon')).toBe('');
	});

	it('iconHtml injects baseline sizing onto the <svg> for {@html} use', () => {
		const html = iconHtml('process');
		expect(html).toMatch(/^<svg\b/);
		expect(html).toContain('width:1em');
		expect(html).toContain('height:1em');
		expect(html).toContain('aria-hidden="true"');
	});

	it('iconHtml honours a custom size', () => {
		expect(iconHtml('process', { size: '20px' })).toContain('width:20px');
	});
});
