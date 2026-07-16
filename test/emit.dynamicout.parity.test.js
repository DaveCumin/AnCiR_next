// Parity: the normalizer's ported dynamic-output rules vs AnCiR's real ones.
//
// The normalizer pre-allocates the output columns a node will compute into, so these keys must
// match EXACTLY — a wrong key yields an analysis that silently never fills in (the same class
// of bug as the missing `cosinorx`). The rules are ported (the real ones reach into `core`, and
// getStatKeys lives behind the whole compute stack), so this test is the contract that keeps
// them honest. If upstream changes, this fails and the port must follow it.
import { describe, expect, it } from 'vitest';
import { getStatKeys as realStatKeys } from '$lib/utils/movinganalysis.js';
import { movingStatKeys, dynamicOutKeys } from '../src/emit/dynamicOut.js';

describe('movingStatKeys port is identical to the real getStatKeys', () => {
	const cases = {
		periodogram: { analysis: 'periodogram' },
		fft: { analysis: 'fft' },
		correlogram: { analysis: 'correlogram' },
		rectfit: { analysis: 'rectfit' },
		// parametric branches — key COUNT depends on the params, which is why no static
		// lookup table can express this node
		'cosinor fixed, 1 harmonic': { analysis: 'cosinor', useFixedPeriod: true, nHarmonics: 1 },
		'cosinor fixed, 3 harmonics': { analysis: 'cosinor', useFixedPeriod: true, nHarmonics: 3 },
		'cosinor fixed, harmonics unset': { analysis: 'cosinor', useFixedPeriod: true },
		'cosinor free, 1 curve': { analysis: 'cosinor', useFixedPeriod: false, Ncurves: 1 },
		'cosinor free, 4 curves': { analysis: 'cosinor', useFixedPeriod: false, Ncurves: 4 },
		'doublelogistic periodic': { analysis: 'doublelogistic', dlPeriodic: true },
		'doublelogistic aperiodic': { analysis: 'doublelogistic', dlPeriodic: false },
		'trend linear': { analysis: 'trend', trendModel: 'linear' },
		'trend exponential': { analysis: 'trend', trendModel: 'exponential' },
		'trend logarithmic': { analysis: 'trend', trendModel: 'logarithmic' },
		'trend polynomial deg 2': { analysis: 'trend', trendModel: 'polynomial', trendPolyDegree: 2 },
		'trend polynomial deg 5': { analysis: 'trend', trendModel: 'polynomial', trendPolyDegree: 5 },
		'trend polynomial deg unset': { analysis: 'trend', trendModel: 'polynomial' },
		'trend model unset': { analysis: 'trend' },
		'unknown analysis → no keys': { analysis: 'nope' }
	};
	for (const [name, args] of Object.entries(cases)) {
		it(name, () => expect(movingStatKeys(args)).toEqual(realStatKeys(args)));
	}
});

// The remaining rules are small enough to state directly; they mirror
// engine/session.js synthesizeDynamicOut. Keys exclude the node's own fixed `out` template
// entries (MovingAnalysis' movex, LongToWide's time) — the schema adds those.
describe('dynamicOutKeys mirrors synthesizeDynamicOut', () => {
	it('MovingAnalysis: one key per (y, stat)', () => {
		const { keys } = dynamicOutKeys('MovingAnalysis', { yIN: [3, 4], analysis: 'periodogram' });
		expect(keys).toEqual(['3_peak_period', '3_peak_power', '4_peak_period', '4_peak_power']);
	});

	it('Split: N split points → N+1 segments per y, 1-indexed', () => {
		expect(dynamicOutKeys('Split', { yIN: [7], splitTimes: [10, 20] }).keys).toEqual([
			'7_1', '7_2', '7_3'
		]);
		// no split points is still one segment
		expect(dynamicOutKeys('Split', { yIN: [7] }).keys).toEqual(['7_1']);
	});

	it('CollectColumns / StoredValueGroup key off their own args', () => {
		expect(dynamicOutKeys('CollectColumns', { colIds: [2, 5] }).keys).toEqual(['col_2', 'col_5']);
		expect(dynamicOutKeys('StoredValueGroup', { groups: [{ id: 'a' }, { id: 'b' }] }).keys).toEqual([
			'group_a', 'group_b'
		]);
	});

	it('LongToWide: one key per distinct category, read from the baked column', () => {
		const ctx = { getValues: (id) => (id === 9 ? ['ctrl', 'ko', 'ctrl', 'wt'] : undefined) };
		const { keys, issue } = dynamicOutKeys('LongToWide', { categoryIN: 9 }, ctx);
		expect(issue).toBeUndefined();
		expect(keys).toEqual(['value_ctrl', 'value_ko', 'value_wt']); // de-duplicated, order kept
	});

	it('LongToWide: reports an issue when the category column has no data yet', () => {
		const ctx = { getValues: () => [] }; // e.g. wired to an analysis output (empty at emit)
		const { keys, issue } = dynamicOutKeys('LongToWide', { categoryIN: 9 }, ctx);
		expect(keys).toEqual([]);
		expect(issue).toMatch(/no data at emit time/);
	});

	it('yIN accepts a bare id and de-duplicates', () => {
		expect(dynamicOutKeys('Split', { yIN: 5, splitTimes: [] }).keys).toEqual(['5_1']);
		expect(dynamicOutKeys('MovingAnalysis', { yIN: [2, 2], analysis: 'fft' }).keys).toEqual([
			'2_peak_period', '2_peak_frequency', '2_peak_magnitude'
		]);
	});

	it('a node with no computed outputs returns null', () => {
		expect(dynamicOutKeys('Cosinor', { yIN: [1] })).toBeNull();
	});
});
