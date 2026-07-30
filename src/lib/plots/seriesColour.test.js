// seriesColumnId: which column a plot series is bound to.
//
// The per-COLUMN colour tests that used to live here moved with the code they covered —
// colour, shape and dash identity is one merged record now, tested in
// appearanceIdentity.svelte.test.js. What is left is the lookup every appearance path needs
// and neither map owns.
//
// A golden-value guard cannot cover this — colour is not in the demo metric
// snapshot — so the precedence rules are pinned directly.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/components/inputs/ColourPicker.svelte', () => ({
	// A small deterministic palette, so "next entry" is checkable.
	getPaletteColor: (n) => ['#aa0000', '#00bb00', '#0000cc', '#dddd00'][n % 4]
}));

const { core } = await import('$lib/core/core.svelte');
const { seriesColumnId } = await import('./seriesColour.js');

beforeEach(() => {
	core.seriesColours = {};
	// Slot claiming only counts pins whose column still exists, so the columns these tests
	// name have to be present. Register a generous range rather than per-test bookkeeping.
	core.data = Array.from({ length: 20 }, (_, id) => ({ id }));
});

describe('seriesColumnId', () => {
	it('reads the y ref for the per-series shape', () => {
		expect(seriesColumnId({ y: { refId: 4 } })).toBe(4);
	});

	it('reads the single-column shape used by Histogram and CircularPhase', () => {
		expect(seriesColumnId({ column: { refId: 9 } })).toBe(9);
	});

	it('treats an unwired ref as no column, not as column -1', () => {
		expect(seriesColumnId({ y: { refId: -1 } })).toBeNull();
		expect(seriesColumnId(undefined)).toBeNull();
	});
});
