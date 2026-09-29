// A missing FIRST or LAST x must not reach the SurrogateTest sampling step or its statistic.
//
// The node computed dt = (t[n-1] - t[0]) / (n-1) over `times.map(Number)`, and Number(null)
// is 0, so a missing end was read as time 0. The step converts `blockLengthHours` into a
// block length in SAMPLES for the bootstrap, and the same zero-filled times went into the
// FFT behind the observed statistic. The correct answer for a series with a missing end is
// the answer for the same series with that row dropped: the step is (t_j - t_i) / (j - i)
// over the first and last VALID rows (utils/validPairs.js meanSpacing, shared with the
// Correlogram), and the statistic is computed on the valid (x, y) pairs only.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const columns = new Map();
const rawData = new Map();

vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => columns.get(Number(id)) ?? null
}));
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData } }));

// Spy on the engine so the test can read the block length the node handed it.
vi.mock('$lib/utils/surrogates.js', async (importOriginal) => {
	const mod = await importOriginal();
	return { ...mod, surrogateTest: vi.fn(mod.surrogateTest) };
});

const { surrogatetest } = await import('./SurrogateTest.svelte');
const { surrogateTest } = await import('$lib/utils/surrogates.js');

const DT = 0.25;
const N = 1024;
const OUT = { pvalue: 900, observed: 901 };

function mkColumn(id, data, extra = {}) {
	columns.set(id, { id, getData: () => data, name: `col${id}`, getDataHash: '', ...extra });
}

function rhythmic(n) {
	let s = 3;
	const rand = () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 2147483648;
	};
	return Array.from(
		{ length: n },
		(_, i) => 5 * Math.cos((2 * Math.PI * i * DT) / 24) + (rand() - 0.5)
	);
}

const args = {
	xIN: 1,
	yIN: 2,
	method: 'block',
	nSurrogates: 49,
	seed: 1,
	blockLengthHours: 24,
	periodMin: 20,
	periodMax: 28,
	out: OUT
};

/** Run the node and return its result plus the block length it gave the bootstrap. */
function run() {
	surrogateTest.mockClear();
	const [res, valid] = surrogatetest(args);
	const blockLength = surrogateTest.mock.calls[0]?.[2]?.blockLength;
	return { res, valid, blockLength, observedOut: rawData.get(901)?.[0] };
}

/** The same x/y with a row removed: the reference answer for a missing end. */
function runTrimmed(x, y, drop, extra = {}) {
	const keep = (_, i) => i !== drop;
	mkColumn(1, x.filter(keep), extra.trimX ?? {});
	mkColumn(2, y.filter(keep));
	return run();
}

beforeEach(() => {
	columns.clear();
	rawData.clear();
	columns.set(900, { id: 900 });
	columns.set(901, { id: 901 });
});

describe('SurrogateTest with a missing end on x', () => {
	// A NUMBER x from 100 h, every 0.25 h, so a 24 h block is 96 samples.
	const x = Array.from({ length: N }, (_, i) => 100 + i * DT);
	const y = rhythmic(N);

	it('a missing FIRST x keeps the 96-sample block and the statistic of the trimmed series', () => {
		const ref = runTrimmed(x, y, 0);
		expect(ref.blockLength).toBe(96);

		mkColumn(1, [null, ...x.slice(1)]);
		mkColumn(2, y);
		const got = run();
		// Old: dt = (355.75 - 0) / 1023 = 0.348 h, so the "24 h" block was 69 samples, and
		// the FFT's extra point at t = 0 dropped observed to 0.62 (about 4.2) and p to 1: a
		// clear 24 h rhythm reported as not significant.
		expect(got.blockLength).toBe(96);
		expect(got.valid).toBe(true);
		expect(got.res.observed).toBe(ref.res.observed);
		expect(got.observedOut).toBe(ref.observedOut);
		expect(got.res.pValue).toBe(ref.res.pValue);
	});

	it('a missing LAST x keeps the 96-sample block and a real band statistic', () => {
		const ref = runTrimmed(x, y, N - 1);
		expect(ref.blockLength).toBe(96);
		expect(ref.res.observed).toBeGreaterThan(1);

		mkColumn(1, [...x.slice(0, -1), null]);
		mkColumn(2, y);
		const got = run();
		// Old: dt = (0 - 100) / 1023 < 0, so the block fell back to 24 samples (6 h), and the
		// FFT saw a last time of 0, bailed on its negative step and reported observed = 0
		// (p = 1).
		expect(got.blockLength).toBe(96);
		expect(got.res.observed).toBe(ref.res.observed);
		expect(got.observedOut).toBe(ref.observedOut);
		expect(got.res.pValue).toBe(ref.res.pValue);
	});

	it('a blank-string end is absence, like null', () => {
		const ref = runTrimmed(x, y, N - 1);
		mkColumn(1, [...x.slice(0, -1), '']);
		mkColumn(2, y);
		const got = run();
		expect(got.blockLength).toBe(96);
		expect(got.res.observed).toBe(ref.res.observed);
	});

	it('a TIME x with a missing first timestamp matches the trimmed series', () => {
		// hoursSinceStart is measured from the first VALID time, so the missing row is null
		// and the rest start at 0. The old step was 0.25 * (N - 2) / (N - 1) and the FFT got
		// a duplicate time 0 carrying the missing row's y.
		const hours = Array.from({ length: N - 1 }, (_, i) => i * DT);
		const ref = runTrimmed([0, ...hours], y, 0, {
			trimX: { type: 'time', hoursSinceStart: hours }
		});
		mkColumn(1, [null, ...hours], { type: 'time', hoursSinceStart: [null, ...hours] });
		mkColumn(2, y);
		const got = run();
		expect(got.blockLength).toBe(96);
		expect(got.res.observed).toBe(ref.res.observed);
		expect(got.res.pValue).toBe(ref.res.pValue);
	});

	it('both ends present: the step is unchanged', () => {
		mkColumn(1, x);
		mkColumn(2, y);
		expect(run().blockLength).toBe(96);
	});
});
