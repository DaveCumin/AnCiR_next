// @ts-nocheck
// The chi-squared periodogram's short-record warning reaches the nodes (decision 2026-11-01):
// Rhythmicity Analysis shows it under the series, Moving Analysis once for the node (every
// window has the same length). Real periodogram, only the column store mocked. The Periodogram
// plot's own warning is in plots/Periodogram/Periodogram.shortRecord.svelte.test.js.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
const core = { rawData: { set: vi.fn(), get: vi.fn(), has: vi.fn(), delete: vi.fn() } };
vi.mock('$lib/core/core.svelte', () => ({
	core,
	appConsts: { processMap: new Map() },
	pushObj: vi.fn()
}));
vi.mock('$lib/core/core.svelte.js', () => ({
	core,
	appConsts: { processMap: new Map() },
	pushObj: vi.fn()
}));
vi.mock('$lib/core/Column.svelte', () => ({
	Column: class {},
	getColumnById: (id) => mockColumns[id],
	removeColumn: vi.fn()
}));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/StoreValueButton.svelte', () => ({ default: {} }));
vi.mock('$lib/components/plotbits/Table.svelte', () => ({ default: {} }));
vi.mock('$lib/components/LoadingSpinner.svelte', () => ({ default: {} }));
vi.mock('$lib/components/plotbits/helpers/save.svelte.js', () => ({
	showNodeResultTable: vi.fn(),
	saveStaticDataAsCSV: vi.fn()
}));
vi.mock('$lib/utils/time/TimeUtils.js', () => ({ formatTimeFromUNIX: (ms) => String(ms) }));

const { rhythmicityanalysis } = await import('./RhythmicityAnalysis.svelte');
const { movinganalysis } = await import('./MovingAnalysis.svelte');

const SHORT = /the chi-squared test is very conservative and can miss a rhythm/;

function wire(days, type = 'time') {
	const t = Array.from({ length: 24 * days }, (_, i) => i);
	const y = t.map((h) => 10 + 3 * Math.cos((2 * Math.PI * h) / 24) + Math.sin(h * 1.3));
	mockColumns[1] =
		type === 'time'
			? { type: 'time', hoursSinceStart: t, getData: () => t }
			: { type: 'number', getData: () => t };
	mockColumns[2] = { getData: () => y };
}

const RA = {
	xIN: 1,
	yIN: [2],
	analysis: 'periodogram',
	pgMethod: 'Chi-squared',
	periodMin: 20,
	periodMax: 28,
	periodStep: 1,
	pgBinSize: 1,
	pgAlpha: 0.05,
	out: {}
};

beforeEach(() => {
	for (const k of Object.keys(mockColumns)) delete mockColumns[k];
});

describe('Rhythmicity Analysis: chi-squared on a short record', () => {
	it('3 days: the series carries the warning, in days, at the longest period tested', async () => {
		wire(3);
		const [res] = await rhythmicityanalysis(RA);
		expect(res.y_results[2].notice).toMatch(SHORT);
		expect(res.y_results[2].notice).toMatch(
			/^With only 3 days of data \(2\.6 cycles of the longest period tested, 28 h\)/
		);
	});

	it('8 days (6.9 cycles of 28 h) still warns; 9 days does not; Lomb-Scargle never does', async () => {
		wire(8);
		expect((await rhythmicityanalysis(RA))[0].y_results[2].notice).toMatch(SHORT);
		wire(9);
		expect((await rhythmicityanalysis(RA))[0].y_results[2].notice).toBe('');
		wire(3);
		const [ls] = await rhythmicityanalysis({ ...RA, pgMethod: 'Lomb-Scargle' });
		expect(ls.y_results[2].notice).toBe('');
	});

	it('a number x names cycles, not days', async () => {
		wire(3, 'number');
		const [res] = await rhythmicityanalysis(RA);
		expect(res.y_results[2].notice).toMatch(
			/^With only 2\.6 cycles of the longest period tested, 28,/
		);
	});
});

describe('Moving Analysis: chi-squared windows', () => {
	const MA = {
		xIN: 1,
		yIN: [2],
		analysis: 'periodogram',
		pgMethod: 'Chi-squared',
		periodMin: 20,
		periodMax: 28,
		periodStep: 1,
		pgBinSize: 1,
		pgAlpha: 0.05,
		stepSize: 24,
		binLabel: 'start',
		out: { movex: -1 }
	};

	it('3-day windows: one warning for the node, about each window', async () => {
		wire(10);
		const [res] = await movinganalysis({ ...MA, windowSize: 72 });
		const hits = res.warnings.filter((w) => SHORT.test(w));
		expect(hits).toEqual([
			'With each window holding only 3 days of data (2.6 cycles of the longest period tested, 28 h), ' +
				'the chi-squared test is very conservative and can miss a rhythm that is there; consider ' +
				'Lomb-Scargle or a longer window (at least 7 cycles).'
		]);
	});

	it('long enough windows, or another method, say nothing', async () => {
		wire(12);
		expect(
			(await movinganalysis({ ...MA, windowSize: 196 }))[0].warnings.some((w) => SHORT.test(w))
		).toBe(false);
		expect(
			(await movinganalysis({ ...MA, windowSize: 72, pgMethod: 'Lomb-Scargle' }))[0].warnings.some(
				(w) => SHORT.test(w)
			)
		).toBe(false);
	});
});
