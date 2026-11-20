// NPCRA must not depend on an epoch that is finer than the data. For regular records at
// several sampling intervals, an epoch equal to the sampling interval and any shorter epoch
// (a whole fraction of it or not) must give the same IS and IV, with nothing blank, with and
// without Full days, at an offset start, with missing samples and with rounded times. The
// same holds through every caller of computeNPCRA: the Moving Analysis windows here, and the
// Nonparametric RA and CFI nodes through the parity fixtures (tp-npcra-epoch-finer,
// tp-npcra-epoch-finer-gaps, tp-cfi-epoch-finer).
//
// Generalises the 2026-11-15 bug: 0.25 h epochs on hourly data read IS 0.247 for 0.988 and
// left IV blank, because the three empty epochs in four counted as bins of the day and no
// two samples were ever in adjacent epochs.
import { describe, it, expect } from 'vitest';
import {
	computeNPCRA,
	epochFinerThanSampling,
	epochFinerWarning,
	missingEpochWarning
} from './npcra.js';
import { computeMovingWindows, getStatKeys, movingWindowStarts } from './movinganalysis.js';

/** Deterministic noise (mulberry32). */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const DTS = [
	['10 min', 1 / 6],
	['30 min', 0.5],
	['1 h', 1],
	['2 h', 2]
];
// Epoch as a share of the sampling interval. Every one divides the 24 h period at every DT.
const WHOLE = [1 / 2, 1 / 4, 1 / 5, 1 / 10];
const RATIOS = [...WHOLE, 0.3, 0.75];

/** `days` of a noisy 12:12 rest-activity record sampled every `dt` h from `start`. */
function series(dt, { days = 7.5, start = 0, seed = 1 } = {}) {
	const r = rng(seed);
	const n = Math.round((days * 24) / dt);
	const t = Array.from({ length: n }, (_, k) => start + k * dt);
	const y = t.map((_, k) => {
		const hod = (k * dt) % 24;
		return (hod >= 8 && hod < 20 ? 80 : 5) + 20 * r();
	});
	return { t, y };
}

const wholeSamples = (hours, dt) => Math.abs(hours / dt - Math.round(hours / dt)) < 1e-9;

const STATS = ['IS', 'IV', 'RA', 'M10', 'L5', 'M10onset', 'L5onset'];

describe('NPCRA: an epoch finer than the sampling interval changes nothing', () => {
	for (const [label, dt] of DTS) {
		for (const fullDays of [false, true]) {
			for (const start of [0, 3.2]) {
				it(`${label} data${fullDays ? ', full days' : ''}, start ${start}`, () => {
					const { t, y } = series(dt, { start, seed: 11 });
					const ref = computeNPCRA(t, y, { epochHours: dt, fullDays });
					for (const k of STATS) expect(Number.isFinite(ref[k]), k).toBe(true);
					for (const ratio of RATIOS) {
						const res = computeNPCRA(t, y, { epochHours: dt * ratio, fullDays });
						const at = `epoch = ${ratio} x sampling`;
						// Nothing blank.
						for (const k of STATS) expect(Number.isFinite(res[k]), `${k}, ${at}`).toBe(true);
						expect(res.IS, `IS, ${at}`).toBeCloseTo(ref.IS, 9);
						expect(res.IV, `IV, ${at}`).toBeCloseTo(ref.IV, 9);
						expect(res.fullDaysKept, at).toBe(ref.fullDaysKept);
						expect(res.pValid, at).toBe(ref.p);
						expect(res.missingEpochFraction, at).toBeCloseTo(0, 9);
						// The windows hold the same samples when the epoch divides the sampling
						// interval and the sampling interval divides the windows (2 h data cannot
						// fill a 5 h window the same way at 1 h and 2 h epochs); otherwise a
						// window's edge can fall one sample either way, and an onset is known to
						// within one epoch.
						if (WHOLE.includes(ratio) && wholeSamples(5, dt)) {
							for (const k of ['RA', 'M10', 'L5', 'M10onset', 'L5onset'])
								expect(res[k], `${k}, ${at}`).toBeCloseTo(ref[k], 9);
						} else {
							expect(Math.abs(res.M10onset - ref.M10onset), at).toBeLessThanOrEqual(dt);
						}
					}
				});
			}
		}
	}

	it('a missing sample still breaks an IV pair, as an empty epoch does', () => {
		const { t, y } = series(1, { seed: 5 });
		// Every third sample missing (value absent, time kept) and a 9 h hole (rows absent).
		const yGap = y.map((v, i) => (i % 3 === 1 ? null : v));
		const keep = t.map((h) => h < 50 || h >= 59);
		const tHole = t.filter((_, i) => keep[i]);
		const yHole = y.filter((_, i) => keep[i]);
		for (const [tt, yy] of [
			[t, yGap],
			[tHole, yHole]
		]) {
			const ref = computeNPCRA(tt, yy, { epochHours: 1 });
			for (const ratio of RATIOS) {
				const res = computeNPCRA(tt, yy, { epochHours: ratio });
				expect(res.IS, `IS at ${ratio}`).toBeCloseTo(ref.IS, 9);
				expect(res.IV, `IV at ${ratio}`).toBeCloseTo(ref.IV, 9);
				expect(res.missingEpochFraction).toBeCloseTo(ref.missingEpochFraction, 2);
			}
		}
	});

	it('times rounded as a CSV of hours writes them', () => {
		const { t, y } = series(1 / 6, { seed: 3 });
		const rounded = t.map((x) => Math.round(x * 1e4) / 1e4);
		const ref = computeNPCRA(t, y, { epochHours: 1 / 6 });
		// An epoch equal to the sampling interval is not "finer" because of the rounding.
		const same = computeNPCRA(rounded, y, { epochHours: 1 / 6 });
		expect(epochFinerThanSampling(1 / 6, same.samplingInterval)).toBe(false);
		const fine = computeNPCRA(rounded, y, { epochHours: 1 / 60 });
		expect(fine.IS).toBeCloseTo(ref.IS, 9);
		expect(fine.IV).toBeCloseTo(ref.IV, 9);
	});

	it('Moving Analysis windows (computeNPCRA per window)', () => {
		const { t, y } = series(1, { days: 14, seed: 9 });
		const base = { analysis: 'npcra', npcraPeriod: 24, npcraMWindow: 10, npcraLWindow: 5 };
		const run = (npcraEpochHours) => {
			const args = { ...base, npcraEpochHours };
			return computeMovingWindows({
				tAll: t,
				ys: [y],
				starts: movingWindowStarts(t, 168, 24),
				windowSize: 168,
				statKeys: getStatKeys(args),
				args
			})[0];
		};
		const ref = run(1);
		const fine = run(0.25);
		expect(ref.IS.length).toBeGreaterThan(3);
		for (const k of ['IS', 'IV', 'RA', 'L5', 'M10', 'M10onset']) {
			expect(fine[k].every(Number.isFinite), k).toBe(true);
			fine[k].forEach((v, i) => expect(v, `${k}[${i}]`).toBeCloseTo(ref[k][i], 9));
		}
	});
});

describe('NPCRA: a bin of the day that is never observed', () => {
	it('IS divides by the bins that hold data, at an ordinary epoch too', () => {
		// Recorded 08:00 to 20:00 only, the same every day: perfectly stable, IS 1.
		const t = [];
		const y = [];
		for (let d = 0; d < 7; d++) {
			for (let h = 8; h < 20; h++) {
				t.push(d * 24 + h);
				y.push(10 + ((h * 7) % 13));
			}
		}
		const res = computeNPCRA(t, y, { epochHours: 1 });
		expect(res.p).toBe(24);
		expect(res.pValid).toBe(12);
		expect(res.IS).toBeCloseTo(1, 9);
	});
});

describe('the notices', () => {
	it('epochFinerThanSampling has a 1% tolerance and needs a known interval', () => {
		expect(epochFinerThanSampling(0.25, 1)).toBe(true);
		expect(epochFinerThanSampling(1, 1)).toBe(false);
		expect(epochFinerThanSampling(2, 1)).toBe(false);
		expect(epochFinerThanSampling(1 / 60, 0.0167)).toBe(false); // 1-min data to 4 dp
		expect(epochFinerThanSampling(0.25, NaN)).toBe(false);
		expect(epochFinerThanSampling(0.25, undefined)).toBe(false);
	});

	it('epochFinerWarning names both lengths, and is null otherwise', () => {
		expect(epochFinerWarning(1, 1)).toBeNull();
		expect(epochFinerWarning(0.25, NaN)).toBeNull();
		expect(epochFinerWarning(0.25, 1)).toBe(
			"The 0.25 h epoch is shorter than the data's sampling interval (about 1 h), so most epochs are empty. The results are no finer than the data: they are the same as with a 1 h epoch."
		);
		expect(epochFinerWarning(0.05, 1 / 6)).toContain('(about 0.167 h)');
	});

	it('missingEpochWarning counts missing samples, not the epochs no sample could fill', () => {
		const { t, y } = series(1, { seed: 2 });
		const full = computeNPCRA(t, y, { epochHours: 0.25 });
		expect(
			missingEpochWarning('a', full.missingEpochFraction, 0.25, full.samplingInterval)
		).toBeNull();
		const yGap = y.map((v, i) => (i % 3 === 1 ? null : v));
		const gap = computeNPCRA(t, yGap, { epochHours: 0.25 });
		expect(missingEpochWarning('a', gap.missingEpochFraction, 0.25, gap.samplingInterval)).toMatch(
			/^"a": about 33% of the samples expected at the 1 h sampling interval are missing\./
		);
		// The ordinary text is unchanged.
		expect(missingEpochWarning('a', 0.25, 1, 1)).toMatch(
			/^"a": 25% of the 1 h epochs have no data\./
		);
	});
});
