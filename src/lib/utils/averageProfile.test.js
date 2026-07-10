import { describe, it, expect } from 'vitest';
import { averageDailyProfile } from './averageProfile.js';

describe('averageDailyProfile', () => {
	it('returns empty arrays for invalid parameters', () => {
		expect(averageDailyProfile([0, 1], [1, 2], { period: 0, nBins: 4 })).toEqual({
			binCentres: [],
			profile: [],
			sem: [],
			n: []
		});
		expect(averageDailyProfile([0, 1], [1, 2], { period: 24, nBins: 0 })).toEqual({
			binCentres: [],
			profile: [],
			sem: [],
			n: []
		});
	});

	it('produces correct bin centres', () => {
		const { binCentres } = averageDailyProfile([0], [1], { period: 24, nBins: 4 });
		expect(binCentres).toEqual([3, 9, 15, 21]);
	});

	it('folds two identical days onto one profile and averages per bin', () => {
		// nBins=4 over period 4 → bin width 1. Two "days" (period=4) of values.
		const t = [0, 1, 2, 3, 4, 5, 6, 7];
		const y = [10, 20, 30, 40, 12, 22, 32, 42];
		const { binCentres, profile, sem, n } = averageDailyProfile(t, y, { period: 4, nBins: 4 });
		expect(binCentres).toEqual([0.5, 1.5, 2.5, 3.5]);
		// bin b collects hour-b of both days: mean of {10,12}, {20,22}, {30,32}, {40,42}
		expect(profile).toEqual([11, 21, 31, 41]);
		expect(n).toEqual([2, 2, 2, 2]);
		// SEM of {10,12}: sd = sqrt(2) (unbiased, n-1=1), sem = sqrt(2)/sqrt(2) = 1.
		for (const s of sem) expect(s).toBeCloseTo(1, 12);
	});

	it('uses the earliest time as the fold origin (t0 offset)', () => {
		// Start at t=100. timeOfDay = (t-100) mod 4.
		const t = [100, 101, 102, 103];
		const y = [5, 6, 7, 8];
		const { profile, n } = averageDailyProfile(t, y, { period: 4, nBins: 4 });
		expect(profile).toEqual([5, 6, 7, 8]);
		expect(n).toEqual([1, 1, 1, 1]);
	});

	it('marks empty bins as NaN with n=0 and single-point bins with NaN SEM', () => {
		// Only two of four bins populated, each with a single point.
		const t = [0, 2];
		const y = [10, 30];
		const { profile, sem, n } = averageDailyProfile(t, y, { period: 4, nBins: 4 });
		expect(profile[0]).toBe(10);
		expect(profile[2]).toBe(30);
		expect(Number.isNaN(profile[1])).toBe(true);
		expect(Number.isNaN(profile[3])).toBe(true);
		expect(n).toEqual([1, 0, 1, 0]);
		// single point → SEM undefined; empty bin → SEM undefined
		expect(sem.every((s) => Number.isNaN(s))).toBe(true);
	});

	it('skips non-finite times and values', () => {
		const t = [0, NaN, 1, 2, null];
		const y = [10, 5, NaN, 30, 40];
		const { profile, n } = averageDailyProfile(t, y, { period: 4, nBins: 4 });
		// t=0→bin0 (y=10 finite), t=NaN skipped, t=1 y=NaN skipped, t=2→bin2 (y=30),
		// t=null skipped.
		expect(profile[0]).toBe(10);
		expect(profile[2]).toBe(30);
		expect(n).toEqual([1, 0, 1, 0]);
	});

	it('returns all-empty stats but valid bin centres when there is no usable data', () => {
		const { binCentres, profile, sem, n } = averageDailyProfile([], [], { period: 24, nBins: 3 });
		expect(binCentres).toEqual([4, 12, 20]);
		expect(profile).toEqual([NaN, NaN, NaN]);
		expect(sem).toEqual([NaN, NaN, NaN]);
		expect(n).toEqual([0, 0, 0]);
	});

	it('places a sample exactly at the period boundary into the last bin', () => {
		// timeOfDay of t=4 is 0 (folds to bin 0), t just under 4 → last bin.
		const { n } = averageDailyProfile([0, 3.999999], [1, 2], { period: 4, nBins: 4 });
		expect(n[0]).toBe(1); // t=0
		expect(n[3]).toBe(1); // t≈3.999999
	});

	it('matches a hand-computed SEM for a three-point bin', () => {
		// One bin, three values {1,2,6}: mean=3, sample var = ((1-3)^2+(2-3)^2+(6-3)^2)/2
		// = (4+1+9)/2 = 7, sd=sqrt(7), sem = sqrt(7)/sqrt(3).
		const t = [0, 0.1, 0.2];
		const y = [1, 2, 6];
		const { profile, sem, n } = averageDailyProfile(t, y, { period: 4, nBins: 1 });
		expect(profile[0]).toBeCloseTo(3, 12);
		expect(n[0]).toBe(3);
		expect(sem[0]).toBeCloseTo(Math.sqrt(7) / Math.sqrt(3), 12);
	});
});
