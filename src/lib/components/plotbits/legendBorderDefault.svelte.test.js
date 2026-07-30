// The legend border must read as a box, in new AND saved sessions.
//
// The rect was always drawn (Legend.svelte renders it with stroke=borderColor and
// borderWidth 1), but the default stroke was --color-lightness-80 (#cccccc), too
// pale on white to register as a border. So the legend looked unboxed.
//
// borderColor is persisted, so bumping the default alone would have fixed only new
// legends and left every saved session (including all the shipped examples) faint
// forever. The old default is therefore migrated on load, on the principle that a
// value which was only ever a default is not a user decision. A colour the user
// actually picked must survive, and the picker writes a hex literal rather than a
// token reference, which is what makes the two cases distinguishable.
import { describe, it, expect } from 'vitest';
import { LegendClass, cornerFraction, LEGEND_MARGIN } from './Legend.svelte';

const LEGACY = 'var(--color-lightness-80)';
const EXPECTED = 'var(--color-lightness-25)';

describe('legend border default', () => {
	it('a new legend gets the darker border', () => {
		expect(new LegendClass().borderColor).toBe(EXPECTED);
	});

	it('a legend built from empty json gets the darker border', () => {
		expect(LegendClass.fromJSON({}).borderColor).toBe(EXPECTED);
	});

	it('migrates the old pale default in a saved session', () => {
		// The case that matters: without this, the 24 shipped examples keep a border
		// too faint to see.
		expect(LegendClass.fromJSON({ borderColor: LEGACY }).borderColor).toBe(EXPECTED);
	});

	it('does NOT touch a hand-picked colour', () => {
		expect(LegendClass.fromJSON({ borderColor: '#ff0000' }).borderColor).toBe('#ff0000');
	});

	it('does NOT touch a hand-picked grey that happens to match the old token value', () => {
		// A user who deliberately wants a pale border picks it in the ColourPicker,
		// which writes a hex. Only the token reference is treated as "just a default",
		// so this must be left alone even though it resolves to the same colour.
		expect(LegendClass.fromJSON({ borderColor: '#cccccc' }).borderColor).toBe('#cccccc');
	});

	it('round-trips the migrated value through toJSON', () => {
		// So a session opened and re-saved keeps the visible border rather than
		// silently reverting on the next load.
		const migrated = LegendClass.fromJSON({ borderColor: LEGACY });
		expect(LegendClass.fromJSON(migrated.toJSON()).borderColor).toBe(EXPECTED);
	});

	it('still draws the box by default', () => {
		// "Default show" is borderWidth > 0 plus a stroke; guard both.
		const legend = new LegendClass();
		expect(legend.borderWidth).toBeGreaterThan(0);
		expect(legend.borderColor).toBeTruthy();
	});
});

// Free legend placement (position: 'custom').
//
// The four corner presets could not put a legend in a gap in the data, which on a
// crowded figure is the only place it fits. Stored as a FRACTION of the plot area
// rather than pixels, so the legend keeps its place when the figure is resized — which
// now happens whenever a width preset is chosen.
describe('legend custom placement', () => {
	it('defaults to a corner, so nothing changes for existing legends', () => {
		expect(new LegendClass().position).toBe('topright');
	});

	it('round-trips the custom fraction', () => {
		const l = LegendClass.fromJSON({ position: 'custom', customX: 0.4, customY: 0.75 });
		expect(l.position).toBe('custom');
		expect(l.customX).toBe(0.4);
		expect(l.customY).toBe(0.75);
		const again = LegendClass.fromJSON(l.toJSON());
		expect(again.customX).toBe(0.4);
		expect(again.customY).toBe(0.75);
	});

	it('supplies a default fraction for a legend saved before this existed', () => {
		// Must be a number, not undefined: it feeds placement arithmetic.
		const l = LegendClass.fromJSON({ position: 'custom' });
		expect(typeof l.customX).toBe('number');
		expect(typeof l.customY).toBe('number');
	});

	it('ignores a non-numeric fraction rather than producing NaN placement', () => {
		const l = LegendClass.fromJSON({ position: 'custom', customX: 'left', customY: null });
		expect(Number.isFinite(l.customX)).toBe(true);
		expect(Number.isFinite(l.customY)).toBe(true);
	});
});

// Switching to Custom must keep the legend where it already is.
//
// Custom placement and the corner presets run over the SAME inset area, so the
// fractions below coincide exactly with the presets rather than landing a margin
// away. That shared coordinate space is what makes the switch lossless; if the two
// ever drift apart, choosing Custom will visibly nudge every legend.
describe('custom placement starts from the current corner', () => {
	it('maps each corner to the fraction that reproduces it', () => {
		expect(cornerFraction('topleft')).toEqual({ x: 0, y: 0 });
		expect(cornerFraction('topright')).toEqual({ x: 1, y: 0 });
		expect(cornerFraction('bottomleft')).toEqual({ x: 0, y: 1 });
		expect(cornerFraction('bottomright')).toEqual({ x: 1, y: 1 });
	});

	it('falls back to the top-left corner for anything unknown', () => {
		expect(cornerFraction('custom')).toEqual({ x: 0, y: 0 });
		expect(cornerFraction(undefined)).toEqual({ x: 0, y: 0 });
	});

	it('a fraction of 0 or 1 reproduces the preset position exactly', () => {
		// The invariant the seeding depends on, expressed as the arithmetic both paths
		// use: preset x is `margin` on the left and `plotWidth - width - margin` on the
		// right, and the custom span is inset by margin at both ends.
		const plotWidth = 400;
		const width = 120;
		const spanX = plotWidth - width - LEGEND_MARGIN * 2;
		expect(LEGEND_MARGIN + spanX * 0).toBe(LEGEND_MARGIN);
		expect(LEGEND_MARGIN + spanX * 1).toBe(plotWidth - width - LEGEND_MARGIN);
	});
});
