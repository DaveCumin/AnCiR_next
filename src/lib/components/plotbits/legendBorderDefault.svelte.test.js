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
import { LegendClass } from './Legend.svelte';

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
