import { describe, it, expect, vi } from 'vitest';

// The module script imports Svelte UI components that the pure logic doesn't
// need; mock them so the module loads cleanly (same as OutlierRemoval.test.js).
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ControlInput.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import { frequencyfilter, frequencyfilterWarnings, definition } from './FrequencyFilter.svelte';

describe('frequencyfilter — empty passband is real (documents the silent case)', () => {
	it('a band-pass with low > high zeroes every frequency', () => {
		const x = Array.from({ length: 16 }, (_, i) => Math.sin((2 * Math.PI * i) / 8) + 5);
		const out = frequencyfilter(x, { type: 'band', low: 0.9, high: 0.1 });
		out.forEach((v) => expect(Math.abs(v)).toBeLessThan(1e-9));
	});
});

// ─── empty-passband warning (free-process warnings channel) ──────────────────
// Cutoffs with low > high keep NO frequencies, so the output is silently all
// zeros. The compute is unchanged; frequencyfilterWarnings →
// definition.getWarnings says so on the node's ⚠ badge (processWarnings.js).

describe('frequencyfilterWarnings', () => {
	it('warns when a band-pass has its low cutoff above its high cutoff', () => {
		const w = frequencyfilterWarnings({ type: 'band', low: 0.5, high: 0.2 });
		expect(w).toHaveLength(1);
		expect(w[0]).toContain('0.5'); // the offending low
		expect(w[0]).toContain('0.2'); // the offending high
		expect(w[0]).toContain('zeros'); // what actually happens
	});

	it('is silent for a valid band and for low/high-pass types', () => {
		expect(frequencyfilterWarnings({ type: 'band', low: 0.1, high: 0.4 })).toEqual([]);
		expect(frequencyfilterWarnings({ type: 'low', high: 0.4 })).toEqual([]);
		expect(frequencyfilterWarnings({ type: 'high', low: 0.1 })).toEqual([]);
		// Equal cutoffs keep exactly that frequency — not empty, no warning.
		expect(frequencyfilterWarnings({ type: 'band', low: 0.3, high: 0.3 })).toEqual([]);
	});
});

describe('definition.getWarnings — node warnings channel', () => {
	it('reads the args off the live process (no input data needed)', () => {
		const w = definition.getWarnings({ args: { type: 'band', low: 0.6, high: 0.3 } });
		expect(w).toHaveLength(1);
	});

	it('returns [] for a process with no args yet', () => {
		expect(definition.getWarnings({})).toEqual([]);
	});
});
