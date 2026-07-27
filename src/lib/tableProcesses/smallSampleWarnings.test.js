// Per-node small-sample warnings. Each node owns its own check (deliberately not
// a shared util), so this file asserts the behaviour node by node.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: new Map(), data: [], tableProcesses: [] }
}));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));

const { describedata } = await import('./DescribeData.svelte');
const { fdrcorrection } = await import('./FDRCorrection.svelte');
const { cosinor } = await import('./Cosinor.svelte');

function mkCol(id, name, data, type = 'number') {
	mockColumns[id] = { id, name, type, getData: () => data, getDataHash: String(data) };
	return id;
}

beforeEach(() => Object.keys(mockColumns).forEach((k) => delete mockColumns[k]));

describe('DescribeData — shape statistics need n', () => {
	it('warns that skewness/kurtosis are uninformative below n = 20', () => {
		mkCol(1, 'x', [1, 2, 3, 4, 100]);
		const [res] = describedata({ yIN: [1], out: {} });
		expect(res.warnings.some((w) => /Skewness and kurtosis/.test(w))).toBe(true);
		expect(res.warnings.some((w) => /n ≥ 20/.test(w))).toBe(true);
	});

	it('quotes the standard error so the warning is quantitative', () => {
		mkCol(1, 'x', [1, 2, 3, 4, 100]);
		const [res] = describedata({ yIN: [1], out: {} });
		// SE(skew) ~ sqrt(6/5) = 1.10
		expect(res.warnings.join(' ')).toMatch(/1\.10/);
	});

	it('adds a separate, blunter warning below n = 5', () => {
		mkCol(1, 'x', [1, 2, 3]);
		const [res] = describedata({ yIN: [1], out: {} });
		expect(res.warnings.some((w) => /Very small samples/.test(w))).toBe(true);
		expect(res.warnings.some((w) => /mean and SD/.test(w))).toBe(true);
	});

	it('is silent at n >= 20', () => {
		mkCol(
			1,
			'x',
			Array.from({ length: 25 }, (_, i) => i)
		);
		const [res] = describedata({ yIN: [1], out: {} });
		expect(res.warnings).toEqual([]);
	});

	it('names only the small columns when mixed', () => {
		mkCol(
			1,
			'big',
			Array.from({ length: 40 }, (_, i) => i)
		);
		mkCol(2, 'small', [1, 2, 3]);
		const [res] = describedata({ yIN: [1, 2], out: {} });
		expect(res.warnings.join(' ')).toMatch(/small/);
		expect(res.warnings.join(' ')).not.toMatch(/big \(/);
	});
});

describe('FDRCorrection — family size', () => {
	it('warns when the family is tiny', () => {
		mkCol(1, 'p', [0.01, 0.2]);
		const [res] = fdrcorrection({ xIN: 1, method: 'benjamini-hochberg', alpha: 0.05, out: {} });
		expect(res.warnings.some((w) => /Only 2 p-values/.test(w))).toBe(true);
		expect(res.warnings.some((w) => /correct them together/.test(w))).toBe(true);
	});

	it('is silent for a reasonable family', () => {
		mkCol(1, 'p', [0.01, 0.02, 0.2, 0.3, 0.4, 0.5]);
		const [res] = fdrcorrection({ xIN: 1, method: 'benjamini-hochberg', alpha: 0.05, out: {} });
		expect(res.warnings.some((w) => /Only \d+ p-value/.test(w))).toBe(false);
	});

	it('reports entries excluded for not being usable p-values', () => {
		mkCol(1, 'p', [0.01, null, 'x', 0.2, 0.3, 0.4, 0.5, 0.6]);
		const [res] = fdrcorrection({ xIN: 1, method: 'holm', alpha: 0.05, out: {} });
		expect(res.warnings.some((w) => /were not usable p-values/.test(w))).toBe(true);
	});
});

describe('Cosinor — cycles and sampling density', () => {
	const base = {
		xIN: 1,
		yIN: [2],
		useFixedPeriod: true,
		fixedPeriod: 24,
		nHarmonics: 1,
		Ncurves: 1,
		alpha: 0.05,
		outputX: -1,
		out: { cosinorx: -1 }
	};
	const wave = (t) => 50 + 20 * Math.cos((2 * Math.PI * t) / 24);

	it('warns when fewer than 2 cycles are recorded', async () => {
		const t = Array.from({ length: 30 }, (_, i) => i * 1); // 30 h = 1.25 cycles
		mkCol(1, 'time', t);
		mkCol(2, 'y', t.map(wave));
		const [res] = await cosinor({ ...base });
		expect(res.warnings.some((w) => /Short record/.test(w))).toBe(true);
		expect(res.warnings.some((w) => /interpolating a single bump/.test(w))).toBe(true);
	});

	it('warns when sampling is too sparse for the harmonics requested', async () => {
		const t = Array.from({ length: 12 }, (_, i) => i * 24); // 1 point per cycle
		mkCol(1, 'time', t);
		mkCol(2, 'y', t.map(wave));
		const [res] = await cosinor({ ...base });
		expect(res.warnings.some((w) => /Sparse sampling/.test(w))).toBe(true);
	});

	it('is silent on a well-sampled multi-day record', async () => {
		const t = Array.from({ length: 24 * 7 }, (_, i) => i); // 7 days, hourly
		mkCol(1, 'time', t);
		mkCol(2, 'y', t.map(wave));
		const [res] = await cosinor({ ...base });
		expect(res.warnings).toEqual([]);
	});

	it('demands more points when more harmonics are requested', async () => {
		const t = Array.from({ length: 5 * 6 }, (_, i) => i * 4); // 6 points/cycle, 5 cycles
		mkCol(1, 'time', t);
		mkCol(2, 'y', t.map(wave));
		const one = await cosinor({ ...base, nHarmonics: 1 });
		const three = await cosinor({ ...base, nHarmonics: 3 });
		expect(one[0].warnings.some((w) => /Sparse sampling/.test(w))).toBe(false);
		expect(three[0].warnings.some((w) => /Sparse sampling/.test(w))).toBe(true);
	});
});
