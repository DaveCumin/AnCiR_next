// A missing ACTIVITY value must stay missing in computeNPCRA, never be read as 0 (ROB-6).
//
// Only t went through the house rule (isInvalidValue); y went through Number(y[i]), and
// Number(null), Number('') and Number(' ') are all 0. A Split segment is full length and
// null-padded outside its window, so a 7-day window of a 14-day record was scored as 7 days
// of rhythm plus 7 days of flat zero: IS 1.000 reported as 0.195 (reviewer's case, below).
//
// The time of a row with a missing value is kept, so the epoch grid (and with it the onset
// times, which are hours after the first sample) does not move; that epoch is simply empty.
import { describe, it, expect } from 'vitest';
import { computeNPCRA } from './npcra.js';

// Reviewer's exact inputs: 14 days hourly, cosine peaking at hour 14, last 7 days missing.
const t = Array.from({ length: 24 * 14 }, (_, i) => i);
const y = t.map((x) => 50 + 40 * Math.cos((2 * Math.PI * (x - 14)) / 24));
const half = 24 * 7;

describe('computeNPCRA with missing activity values', () => {
	const truth = computeNPCRA(t.slice(0, half), y.slice(0, half), {});

	it('the dropped-row reference matches the reviewer (IS 1.000, L5 12.69, M10 79.35)', () => {
		expect(truth.IS).toBeCloseTo(1, 3);
		expect(truth.L5).toBeCloseTo(12.69, 2);
		expect(truth.M10).toBeCloseTo(79.35, 2);
	});

	for (const missing of [null, undefined, '', ' ', 'NA']) {
		it(`a ${JSON.stringify(missing)}-padded segment scores the same as the window alone`, () => {
			const padded = y.map((v, i) => (i < half ? v : missing));
			const got = computeNPCRA(t, padded, {});
			expect(got.IS).toBeCloseTo(truth.IS, 12);
			expect(got.IV).toBeCloseTo(truth.IV, 12);
			expect(got.RA).toBeCloseTo(truth.RA, 12);
			expect(got.L5).toBeCloseTo(truth.L5, 12);
			expect(got.M10).toBeCloseTo(truth.M10, 12);
			expect(got.M10onset).toBe(truth.M10onset);
			expect(got.L5onset).toBe(truth.L5onset);
			// The padded times still define the grid: the missing epochs exist, empty.
			expect(got.nEpochs).toBe(24 * 14);
			expect(got.n).toBe(half);
		});
	}

	it('a leading missing stretch keeps the grid origin (onsets stay hours after the first row)', () => {
		const lead = y.map((v, i) => (i < 24 ? null : v));
		const got = computeNPCRA(t, lead, {});
		const ref = computeNPCRA(t.slice(24), y.slice(24), {});
		// Day 1 missing: 24 h later is the same clock phase, so the onsets agree.
		expect(got.M10onset).toBe(ref.M10onset);
		expect(got.nEpochs).toBe(24 * 14);
		expect(got.n).toBe(24 * 13);
	});

	it('a real zero is data, not missing', () => {
		const withZero = y.slice(0, half).map((v, i) => (i === 14 ? 0 : v));
		expect(computeNPCRA(t.slice(0, half), withZero, {}).n).toBe(half);
		expect(computeNPCRA(t.slice(0, half), withZero, {}).M10).not.toBeCloseTo(truth.M10, 6);
	});

	it('numeric strings are read as their numbers', () => {
		const got = computeNPCRA(t.slice(0, half), y.slice(0, half).map(String), {});
		expect(got.IS).toBeCloseTo(truth.IS, 12);
		expect(got.M10).toBeCloseTo(truth.M10, 12);
	});

	it('all values missing gives null', () => {
		expect(
			computeNPCRA(
				t,
				t.map(() => null),
				{}
			)
		).toBeNull();
	});
});
