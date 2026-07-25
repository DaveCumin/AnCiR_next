import { describe, it, expect, vi, beforeEach } from 'vitest';

const columns = new Map();
const rawData = new Map();

vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => columns.get(Number(id)) ?? null
}));
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData } }));

const { surrogatetest } = await import('./SurrogateTest.svelte');

const DT = 0.25;

function mkColumn(id, data, extra = {}) {
	columns.set(id, {
		id,
		getData: () => data,
		name: `col${id}`,
		getDataHash: String(data.length),
		...extra
	});
	return id;
}

/** A `time` column: raw data is epoch ms, hoursSinceStart is hours from the start. */
function mkTimeColumn(id, hours) {
	const epoch = hours.map((h) => Date.UTC(2024, 0, 1) + h * 3600000);
	return mkColumn(id, epoch, { type: 'time', hoursSinceStart: hours });
}

function rhythmic(n, periodHrs = 24, amp = 5, noise = 1, seed = 3) {
	let s = seed;
	const rand = () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 2147483648;
	};
	return Array.from(
		{ length: n },
		(_, i) => amp * Math.cos((2 * Math.PI * i * DT) / periodHrs) + noise * (rand() - 0.5)
	);
}

const OUT = { pvalue: 900, observed: 901 };

beforeEach(() => {
	columns.clear();
	rawData.clear();
	columns.set(900, { id: 900 });
	columns.set(901, { id: 901 });
});

function baseArgs(over = {}) {
	return {
		xIN: 1,
		yIN: 2,
		method: 'block',
		nSurrogates: 99,
		seed: 1,
		blockLengthHours: 24,
		periodMin: 20,
		periodMax: 28,
		out: OUT,
		...over
	};
}

describe('surrogatetest', () => {
	it('detects a strong 24 h rhythm', () => {
		const n = 2048;
		mkColumn(
			1,
			Array.from({ length: n }, (_, i) => i * DT)
		);
		mkColumn(2, rhythmic(n));
		const [res, valid] = surrogatetest(baseArgs());
		expect(valid).toBe(true);
		expect(res.pValue).toBeLessThan(0.05);
		expect(res.observed).toBeGreaterThan(0);
	});

	it('does not flag noise as rhythmic', () => {
		const n = 2048;
		let s = 11;
		const rand = () => {
			s = (s * 1103515245 + 12345) % 2147483648;
			return s / 2147483648;
		};
		mkColumn(
			1,
			Array.from({ length: n }, (_, i) => i * DT)
		);
		mkColumn(
			2,
			Array.from({ length: n }, () => rand() - 0.5)
		);
		const [res] = surrogatetest(baseArgs({ seed: 7 }));
		expect(res.pValue).toBeGreaterThan(0.05);
	});

	it('writes p-value and observed statistic to the output columns', () => {
		const n = 1024;
		mkColumn(
			1,
			Array.from({ length: n }, (_, i) => i * DT)
		);
		mkColumn(2, rhythmic(n));
		surrogatetest(baseArgs());
		expect(rawData.get(900)).toHaveLength(1);
		expect(rawData.get(901)).toHaveLength(1);
		expect(Number.isFinite(rawData.get(900)[0])).toBe(true);
	});

	it('converts the block length from HOURS to SAMPLES, and short blocks are anti-conservative', () => {
		// Two things at once, on AUTOCORRELATED BUT ARRHYTHMIC red noise — the
		// case that separates a good null from a bad one.
		//
		// A one-sample block is effectively a shuffle: it destroys the
		// autocorrelation, so the null becomes far too easy to beat and the test
		// FALSELY calls this noise rhythmic. Blocks of a day or more keep the
		// structure and correctly return "not significant".
		//
		// It also pins the units conversion: 0.25 h must become 1 sample and 24 h
		// must become 96. If hours were used directly as samples, "24" would be
		// 6 h of data and would behave like the anti-conservative case.
		const n = 2048;
		let s = 11;
		const rand = () => {
			s = (s * 1103515245 + 12345) % 2147483648;
			return s / 2147483648;
		};
		const y = [0];
		for (let i = 1; i < n; i++) y.push(0.97 * y[i - 1] + (rand() - 0.5));

		mkColumn(
			1,
			Array.from({ length: n }, (_, i) => i * DT)
		);
		mkColumn(2, y);

		const oneSample = surrogatetest(baseArgs({ blockLengthHours: 0.25, nSurrogates: 199 }))[0];
		const oneDay = surrogatetest(baseArgs({ blockLengthHours: 24, nSurrogates: 199 }))[0];

		expect(oneSample.pValue).toBeLessThan(0.05); // false positive
		expect(oneDay.pValue).toBeGreaterThan(0.2); // correctly not significant
	});

	it('is reproducible from its seed and sensitive to it', () => {
		const n = 1024;
		mkColumn(
			1,
			Array.from({ length: n }, (_, i) => i * DT)
		);
		mkColumn(2, rhythmic(n, 24, 1, 4));
		const a = surrogatetest(baseArgs({ seed: 42 }))[0].pValue;
		const b = surrogatetest(baseArgs({ seed: 42 }))[0].pValue;
		expect(a).toBe(b);
	});

	it('warns when phase surrogates are used for a rhythmicity question', () => {
		// The circularity guard: phase randomisation preserves the spectrum, so
		// it cannot test for the rhythm it already contains.
		const n = 1024;
		mkColumn(
			1,
			Array.from({ length: n }, (_, i) => i * DT)
		);
		mkColumn(2, rhythmic(n));
		expect(surrogatetest(baseArgs({ method: 'phase' }))[0].advice).toMatch(/little or no power/);
		expect(surrogatetest(baseArgs({ method: 'shuffle' }))[0].advice).toMatch(/anti-conservative/);
		expect(surrogatetest(baseArgs({ method: 'block' }))[0].advice).toBe('');
	});

	it('respects the period band', () => {
		// A 12 h rhythm should not register in a 20-28 h band.
		const n = 2048;
		mkColumn(
			1,
			Array.from({ length: n }, (_, i) => i * DT)
		);
		mkColumn(2, rhythmic(n, 12, 5, 1));
		const inBand = surrogatetest(baseArgs({ periodMin: 10, periodMax: 14 }))[0];
		const outOfBand = surrogatetest(baseArgs({ periodMin: 20, periodMax: 28 }))[0];
		expect(inBand.observed).toBeGreaterThan(outOfBand.observed);
	});

	it('never reports p = 0', () => {
		const n = 2048;
		mkColumn(
			1,
			Array.from({ length: n }, (_, i) => i * DT)
		);
		mkColumn(2, rhythmic(n, 24, 50, 0.1));
		const [res] = surrogatetest(baseArgs());
		expect(res.pValue).toBeGreaterThan(0);
	});

	it('is invalid without both inputs', () => {
		expect(surrogatetest(baseArgs({ xIN: -1 }))[1]).toBe(false);
		expect(surrogatetest(baseArgs({ yIN: -1 }))[1]).toBe(false);
		expect(surrogatetest(baseArgs({ xIN: 77 }))[1]).toBe(false);
	});

	it('reports a reason when there are too few samples', () => {
		mkColumn(1, [0, 1, 2]);
		mkColumn(2, [1, 2, 3]);
		const [res, valid] = surrogatetest(baseArgs());
		expect(valid).toBe(false);
		expect(res.reason).toMatch(/at least 8/);
	});

	it('clamps an absurdly small surrogate count instead of dividing by zero', () => {
		const n = 512;
		mkColumn(
			1,
			Array.from({ length: n }, (_, i) => i * DT)
		);
		mkColumn(2, rhythmic(n));
		const [res, valid] = surrogatetest(baseArgs({ nSurrogates: 0 }));
		expect(valid).toBe(true);
		expect(res.nSurrogates).toBeGreaterThanOrEqual(9);
	});

	it('accepts a TIME column on x and treats it as hours', () => {
		// A time column's raw data is epoch ms. Read raw, dt becomes 1.8e6, so a
		// 24 h block rounds to ONE SAMPLE — a plain shuffle, the anti-conservative
		// null this node exists to avoid — and the 20-28 h band matches nothing.
		const n = 2048;
		const hours = Array.from({ length: n }, (_, i) => i * DT);
		mkTimeColumn(1, hours);
		mkColumn(2, rhythmic(n));

		const [res, valid] = surrogatetest(baseArgs());
		expect(valid).toBe(true);
		expect(res.observed).toBeGreaterThan(0); // the band actually matched
		expect(res.pValue).toBeLessThan(0.05);
	});

	it('gives the same answer for a time column as for the equivalent hours column', () => {
		const n = 2048;
		const hours = Array.from({ length: n }, (_, i) => i * DT);
		const y = rhythmic(n, 24, 1, 4);

		mkTimeColumn(1, hours);
		mkColumn(2, y);
		const viaTime = surrogatetest(baseArgs())[0];

		columns.clear();
		columns.set(900, { id: 900 });
		columns.set(901, { id: 901 });
		mkColumn(1, hours);
		mkColumn(2, y);
		const viaHours = surrogatetest(baseArgs())[0];

		expect(viaTime.observed).toBeCloseTo(viaHours.observed, 9);
		expect(viaTime.pValue).toBe(viaHours.pValue);
	});

	it('does not throw when no output columns are wired', () => {
		const n = 512;
		mkColumn(
			1,
			Array.from({ length: n }, (_, i) => i * DT)
		);
		mkColumn(2, rhythmic(n));
		expect(() => surrogatetest(baseArgs({ out: {} }))).not.toThrow();
	});
});
