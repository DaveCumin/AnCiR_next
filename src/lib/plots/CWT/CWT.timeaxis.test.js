// The CWT's period parameters are all in HOURS, so its x axis has to be too.
//
// A `time` column's raw data is epoch MILLISECONDS. Reading it with getData()
// (as this plot originally did) makes dt 1.8e6 and reports every period in ms —
// a 24 h rhythm comes out as 86,400,000, and with the default 1-48 h period
// range the plot instead shows "no scales fall inside the requested period
// range". Periodogram and FFT avoid this by reading `hoursSinceStart`; this
// pins the CWT to the same accessor.
import { describe, it, expect } from 'vitest';
import { CWTClass } from './CWT.svelte';

const STEP_HRS = 0.5;
const N = 512;

/**
 * A stand-in for a wired Column whose raw data and hoursSinceStart DIFFER,
 * which is exactly the situation a time column creates.
 */
function stubColumn({ raw, hours }) {
	return { getData: () => raw, hoursSinceStart: hours, name: 'stub' };
}

function rhythm(n, periodHrs = 24) {
	return Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * i * STEP_HRS) / periodHrs));
}

/** Build a CWT plot with the given x/y stubs already wired. */
function plotWith(xCol, yCol) {
	const p = CWTClass.fromJSON({ width: 600, height: 400 }, { data: [{}] });
	p.data[0].x = xCol;
	p.data[0].y = yCol;
	return p;
}

describe('CWT accepts a TIME column on x', () => {
	const epochMs = Array.from(
		{ length: N },
		(_, i) => Date.UTC(2024, 0, 1) + i * STEP_HRS * 3600000
	);
	const hours = epochMs.map((ms) => (ms - epochMs[0]) / 3600000);
	const y = rhythm(N);

	it('recovers a 24 h rhythm from a time column', () => {
		const p = plotWith(stubColumn({ raw: epochMs, hours }), stubColumn({ raw: y, hours: y }));
		const tr = p.transform;
		expect(tr.valid).toBe(true);
		// dt must be in HOURS (0.5), not milliseconds (1.8e6).
		expect(tr.dt).toBeCloseTo(STEP_HRS, 9);

		const mid = Math.floor(N / 2);
		let best = 0;
		for (let j = 1; j < tr.power.length; j++) if (tr.power[j][mid] > tr.power[best][mid]) best = j;
		expect(Math.abs(tr.periods[best] / 24 - 1)).toBeLessThan(0.1);
	});

	it('reports its period axis in hours, inside the default 1-48 h range', () => {
		const p = plotWith(stubColumn({ raw: epochMs, hours }), stubColumn({ raw: y, hours: y }));
		expect(p.transform.periods.length).toBeGreaterThan(0);
		expect(Math.max(...p.transform.periods)).toBeLessThanOrEqual(48);
		expect(Math.min(...p.transform.periods)).toBeGreaterThanOrEqual(1);
	});

	it('exposes times in hours, so the x axis labels read as hours', () => {
		const p = plotWith(stubColumn({ raw: epochMs, hours }), stubColumn({ raw: y, hours: y }));
		expect(p.transform.times[0]).toBeCloseTo(0, 9);
		expect(p.transform.times.at(-1)).toBeCloseTo((N - 1) * STEP_HRS, 6);
	});

	it('would FAIL on the raw epoch values — the regression this guards', () => {
		// Same column, but hoursSinceStart deliberately returns the raw epoch ms.
		// This is what the plot used to do, and it must not look valid-and-correct.
		const bad = plotWith(
			stubColumn({ raw: epochMs, hours: epochMs }),
			stubColumn({ raw: y, hours: y })
		);
		expect(bad.transform.valid).toBe(false);
		expect(bad.transform.reason).toMatch(/period range/);
	});
});

describe('CWT still accepts a plain NUMBER column on x', () => {
	it('works when hours are already numeric', () => {
		const hours = Array.from({ length: N }, (_, i) => i * STEP_HRS);
		const y = rhythm(N);
		const p = plotWith(stubColumn({ raw: hours, hours }), stubColumn({ raw: y, hours: y }));
		expect(p.transform.valid).toBe(true);
		expect(p.transform.dt).toBeCloseTo(STEP_HRS, 9);
	});

	it('re-bases an x axis that does not start at zero', () => {
		// hoursSinceStart subtracts the minimum, so a series starting at hour 1000
		// is analysed identically to one starting at 0.
		const hours = Array.from({ length: N }, (_, i) => i * STEP_HRS);
		const shifted = hours.map((h) => h + 1000);
		const y = rhythm(N);
		const a = plotWith(stubColumn({ raw: hours, hours }), stubColumn({ raw: y, hours: y }));
		const b = plotWith(
			stubColumn({ raw: shifted, hours }), // hoursSinceStart re-bases to 0
			stubColumn({ raw: y, hours: y })
		);
		expect(b.transform.dt).toBeCloseTo(a.transform.dt, 9);
		expect(b.transform.periods.length).toBe(a.transform.periods.length);
	});
});

describe('CWT with no x column wired', () => {
	it('reports "no data" rather than throwing', () => {
		const p = CWTClass.fromJSON({ width: 600, height: 400 }, { data: [] });
		expect(p.transform.valid).toBe(false);
		expect(p.transform.reason).toBe('no data');
	});
});
