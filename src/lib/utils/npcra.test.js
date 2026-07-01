import { describe, it, expect } from 'vitest';
import { computeNPCRA } from './npcra.js';

// Build a time vector (hours) and matching activity for `days` days at `epoch` h bins.
function buildDays(days, epoch, valueForHourOfDay) {
	const t = [];
	const y = [];
	const perDay = Math.round(24 / epoch);
	for (let d = 0; d < days; d++) {
		for (let k = 0; k < perDay; k++) {
			const hod = k * epoch;
			t.push(d * 24 + hod);
			y.push(valueForHourOfDay(hod));
		}
	}
	return { t, y };
}

// Active 08:00–18:00 (10 h) high, rest low — a clean square rest-activity rhythm.
const squareDay = (hod) => (hod >= 8 && hod < 18 ? 100 : 0);

describe('computeNPCRA', () => {
	it('gives IS≈1 and RA≈1 for a perfectly repeated square-wave rhythm', () => {
		const { t, y } = buildDays(7, 1, squareDay);
		const r = computeNPCRA(t, y, { epochHours: 1, period: 24, mWindow: 10, lWindow: 5 });
		expect(r.IS).toBeCloseTo(1, 6);
		expect(r.RA).toBeCloseTo(1, 6); // L5 sits in the all-zero rest → (100-0)/(100+0)=1
		expect(r.IV).toBeLessThan(0.5); // few transitions per day → low fragmentation
		expect(r.p).toBe(24);
	});

	it('places M10 on the active block and L5 in the rest block', () => {
		const { t, y } = buildDays(7, 1, squareDay);
		const r = computeNPCRA(t, y, { epochHours: 1, period: 24, mWindow: 10, lWindow: 5 });
		expect(r.M10).toBeCloseTo(100, 6); // whole active window is 100
		expect(r.L5).toBeCloseTo(0, 6);
		expect(r.M10onset).toBeCloseTo(8, 6); // active starts at 08:00
	});

	it('RA=0 for a constant signal', () => {
		const { t, y } = buildDays(5, 1, () => 42);
		const r = computeNPCRA(t, y, { epochHours: 1, period: 24 });
		expect(r.RA).toBeCloseTo(0, 6);
	});

	it('IS→0 and IV≈2 for white noise', () => {
		// Deterministic LCG so the test is stable.
		let s = 123456789;
		const rand = () => {
			s = (1103515245 * s + 12345) & 0x7fffffff;
			return s / 0x7fffffff;
		};
		const t = [];
		const y = [];
		for (let k = 0; k < 24 * 30; k++) {
			t.push(k);
			y.push(rand());
		}
		const r = computeNPCRA(t, y, { epochHours: 1, period: 24 });
		expect(r.IS).toBeLessThan(0.15); // ~1/days for noise
		expect(r.IV).toBeGreaterThan(1.5);
		expect(r.IV).toBeLessThan(2.5);
	});

	it('handles missing epochs (gaps) without crashing', () => {
		const { t, y } = buildDays(7, 1, squareDay);
		// Drop a whole day's worth of samples in the middle → those epochs become empty.
		const t2 = [];
		const y2 = [];
		for (let i = 0; i < t.length; i++) {
			if (t[i] >= 72 && t[i] < 96) continue; // remove day 4
			t2.push(t[i]);
			y2.push(y[i]);
		}
		const r = computeNPCRA(t2, y2, { epochHours: 1, period: 24 });
		expect(Number.isFinite(r.IS)).toBe(true);
		expect(r.IS).toBeGreaterThan(0.5); // still a strong stable rhythm
	});

	it('supports a non-1h epoch and non-24 period', () => {
		const { t, y } = buildDays(6, 0.5, squareDay); // half-hour bins
		const r = computeNPCRA(t, y, { epochHours: 0.5, period: 24, mWindow: 10, lWindow: 5 });
		expect(r.p).toBe(48);
		expect(r.IS).toBeCloseTo(1, 6);
		expect(r.RA).toBeCloseTo(1, 6);
	});
});
