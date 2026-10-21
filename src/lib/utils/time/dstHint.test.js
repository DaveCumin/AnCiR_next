// The import dialog's daylight-saving hint (per-column time zone, phase 3; plan 3.3 point 3
// and 3.10 row 3). Wall clocks are the text read as UTC, in file order.
import { describe, it, expect } from 'vitest';
import { dstPatternHint } from './dstHint.js';

const NZ = 'Pacific/Auckland';
const MIN = 60000;
const W = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
const run = (from, to, stepMin) => {
	const out = [];
	for (let w = from; w <= to; w += stepMin * MIN) out.push(w);
	return out;
};

describe('a logger that follows daylight saving', () => {
	it('spring, every 10 min: the clock skips from 01:50 to 03:00 at the change', () => {
		const walls = [
			...run(W(2024, 9, 28, 20), W(2024, 9, 29, 1, 50), 10),
			...run(W(2024, 9, 29, 3), W(2024, 9, 29, 9), 10)
		];
		const h = dstPatternHint(walls, NZ);
		expect(h.kind).toBe('follows');
		expect(h.change).toEqual({ at: Date.UTC(2024, 8, 28, 14), before: 720, after: 780 });
		expect(h.intervalMs).toBe(10 * MIN);
	});

	it('autumn, every 10 min: the clock steps back from 02:50 to 02:00', () => {
		const walls = [
			...run(W(2024, 4, 6, 20), W(2024, 4, 7, 2, 50), 10),
			...run(W(2024, 4, 7, 2), W(2024, 4, 7, 9), 10)
		];
		expect(dstPatternHint(walls, NZ).kind).toBe('follows');
	});

	it('autumn, hourly: 02:00 written twice', () => {
		const walls = [
			...run(W(2024, 4, 6, 12), W(2024, 4, 7, 2), 60),
			...run(W(2024, 4, 7, 2), W(2024, 4, 7, 12), 60)
		];
		expect(dstPatternHint(walls, NZ).kind).toBe('follows');
	});

	it('London, every 30 min across the March change', () => {
		const walls = [
			...run(W(2024, 3, 30, 20), W(2024, 3, 31, 0, 30), 30),
			...run(W(2024, 3, 31, 2), W(2024, 3, 31, 8), 30)
		];
		expect(dstPatternHint(walls, 'Europe/London').kind).toBe('follows');
	});
});

describe('a logger that never changes its clock', () => {
	it('spring: values inside the skipped hour', () => {
		const walls = run(W(2024, 9, 28, 20), W(2024, 9, 29, 9), 10);
		expect(dstPatternHint(walls, NZ).kind).toBe('fixed');
	});
	it('autumn: the repeated hour passed once at the regular interval', () => {
		const walls = run(W(2024, 4, 6, 20), W(2024, 4, 7, 9), 10);
		expect(dstPatternHint(walls, NZ).kind).toBe('fixed');
	});
});

describe('no hint', () => {
	it('a record that does not cross a change', () => {
		expect(dstPatternHint(run(W(2024, 6, 1, 0), W(2024, 6, 3, 0), 10), NZ)).toBeNull();
	});
	it('irregular sampling', () => {
		const walls = run(W(2024, 9, 28, 20), W(2024, 9, 29, 9), 10).filter(
			(_, i) => i % 3 !== 1 && i % 7 !== 2
		);
		expect(dstPatternHint(walls, NZ)).toBeNull();
	});
	it('too few values, utc, a fixed offset, or an unknown zone', () => {
		const walls = run(W(2024, 9, 28, 20), W(2024, 9, 29, 9), 10);
		expect(dstPatternHint(walls.slice(0, 5), NZ)).toBeNull();
		expect(dstPatternHint(walls, 'utc')).toBeNull();
		expect(dstPatternHint(walls, '+12:00')).toBeNull();
		expect(dstPatternHint(walls, 'Mars/Base')).toBeNull();
	});
	it('a gap of a whole hour away from the change is not a hint', () => {
		const walls = [
			...run(W(2024, 9, 28, 20), W(2024, 9, 28, 22), 10),
			...run(W(2024, 9, 28, 23, 10), W(2024, 9, 29, 1, 50), 10),
			...run(W(2024, 9, 29, 3), W(2024, 9, 29, 5), 10)
		];
		// The 01:50 to 03:00 skip still sits on the change, so this one follows; move it off:
		const off = walls.map((v) => v - 5 * 3600000);
		expect(dstPatternHint(off, NZ)).toBeNull();
	});
});
