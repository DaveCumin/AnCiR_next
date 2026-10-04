// @ts-nocheck
/**
 * Node-level checks for review findings FIT-1 (bounded free period, with the cosinor's
 * at-bound / range warnings) and FIT-5 (exchangeability warning and block permutation) on
 * the Rectangular wave and Double logistic nodes, with the REAL fitting modules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns } = vi.hoisted(() => ({ mockColumns: {} }));
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: new Map(), tableProcesses: [], storedValues: {} },
	appConsts: { processMap: new Map() }
}));
vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => mockColumns[id],
	removeColumn: vi.fn(),
	Column: class {}
}));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));

import { rectangularwave } from './RectangularWave.svelte';
import { doublelogistic } from './DoubleLogistic.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});

function setColumns(t, y) {
	mockColumns[1] = { type: 'number', name: 'x', getData: () => t, hoursSinceStart: t };
	mockColumns[2] = { type: 'number', name: 'y', getData: () => y };
}

/** 150 h square wave, levels 5 and 15, 10 days hourly: past the default 48 h bound. */
function slowSquare() {
	const t = Array.from({ length: 240 }, (_, i) => i);
	return { t, y: t.map((i) => ((i % 150) / 150 < 0.5 ? 15 : 5)) };
}

/** AR(1) phi 0.7 noise plus a weak 24 h square wave, 7 days hourly. */
function redNoise() {
	let s = 5;
	const rnd = () => {
		s = (1103515245 * s + 12345) % 2147483648;
		return s / 2147483648;
	};
	const t = Array.from({ length: 168 }, (_, i) => i);
	let e = 0;
	const y = t.map((i) => {
		e = 0.7 * e + Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
		return e + (i % 24 < 12 ? 0.5 : 0);
	});
	return { t, y };
}

const base = { xIN: 1, yIN: [2], outputX: -1, preProcesses: [] };

describe('Rectangular wave node', () => {
	it('warns when the free period stops on the range bound (was a silent 2,243 h fit)', () => {
		const { t, y } = slowSquare();
		setColumns(t, y);
		const [res, valid] = rectangularwave({ ...base, out: { rectwavex: -1 } });
		expect(valid).toBe(true);
		expect(res.y_results[2].fitResult.period).toBeCloseTo(48, 6);
		expect(res.warnings.join(' ')).toMatch(
			/"y" stopped at the upper limit of the period range: 48 h, range 2 to 48 h/
		);
	});

	it('a fixed period never warns about the range; an empty range says why', () => {
		const { t, y } = slowSquare();
		setColumns(t, y);
		const [fixed] = rectangularwave({
			...base,
			fixOmega: true,
			fixedPeriod: 24,
			out: { rectwavex: -1 }
		});
		expect(fixed.warnings.join(' ')).not.toMatch(/period range/);
		const [empty, valid] = rectangularwave({
			...base,
			minPeriod: 30,
			maxPeriod: 20,
			out: { rectwavex: -1 }
		});
		expect(valid).toBe(false);
		expect(empty.warnings.join(' ')).toMatch(/Period range 30 to 20 h is empty/);
	});

	it('shuffle permutation on autocorrelated residuals warns and points to the Surrogate Test', () => {
		const { t, y } = redNoise();
		setColumns(t, y);
		const args = {
			...base,
			fixOmega: true,
			fixedPeriod: 24,
			permuteTest: true,
			nPermutations: 19,
			out: { rectwavex: -1 }
		};
		const [shuf] = rectangularwave(args);
		expect(shuf.warnings.join(' ')).toMatch(
			/The permutation p-value for "y" assumes independent \(exchangeable\) observations.*Surrogate Test/
		);
		const [blk] = rectangularwave({ ...args, permutationScheme: 'block' });
		expect(blk.warnings.join(' ')).not.toMatch(/assumes independent/);
		expect(Number.isFinite(blk.y_results[2].pValue)).toBe(true);
	});
});

describe('Double logistic node', () => {
	it('warns when the free period stops on the range bound (was a silent 111 h fit)', async () => {
		const { t, y } = slowSquare();
		setColumns(t, y);
		const [res, valid] = await doublelogistic({ ...base, out: { dlogx: -1 } });
		expect(valid).toBe(true);
		expect(res.y_results[2].fitResult.parameters.T).toBeCloseTo(48, 6);
		expect(res.warnings.join(' ')).toMatch(
			/double-logistic fit for "y" stopped at the upper limit/
		);
	});

	it('block permutation runs and the shuffle warning is not raised', async () => {
		const { t, y } = redNoise();
		setColumns(t, y);
		const args = {
			...base,
			fixPeriod: true,
			fixedPeriod: 24,
			permuteTest: true,
			nPermutations: 9,
			out: { dlogx: -1 }
		};
		const [shuf] = await doublelogistic(args);
		expect(shuf.warnings.join(' ')).toMatch(/assumes independent/);
		const [blk] = await doublelogistic({ ...args, permutationScheme: 'block' });
		expect(blk.warnings.join(' ')).not.toMatch(/assumes independent/);
		expect(Number.isFinite(blk.y_results[2].pValue)).toBe(true);
	});
});
