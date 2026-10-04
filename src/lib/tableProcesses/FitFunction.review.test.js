// @ts-nocheck
/**
 * Review findings FIT-1 and FIT-5 on the Fit waveform model node, with the REAL fitting
 * modules (the same records as waveformFits.review.test.js, which covers the dedicated
 * Rectangular wave and Double logistic nodes).
 *
 * FIT-1: the node did not pass minPeriod / maxPeriod to its rectangular-wave and
 * double-logistic models, and showed no period-range warnings for them.
 * FIT-5: no block permutation scheme, and no warning that the shuffle test (and the
 * fixed-period cosinor F-test) assume exchangeable observations.
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
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import { fitFunction, definition } from './FitFunction.svelte';
import { recommendPermutations } from '$lib/utils/permutationTest.js';

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

const base = { xIN: 1, yIN: [2], outputX: -1, preProcesses: [], out: { fitx: -1 } };

describe('Fit waveform model: period range for every free-period model (FIT-1)', () => {
	it('rectangular: the free period is bounded and the at-bound warning shows', async () => {
		const { t, y } = slowSquare();
		setColumns(t, y);
		const [res, valid] = await fitFunction({ ...base, model: 'rectangular' });
		expect(valid).toBe(true);
		expect(res.y_results[2].fitResult.period).toBeCloseTo(48, 6);
		expect(res.warnings.join(' ')).toMatch(
			/rectangular-wave fit for "y" stopped at the upper limit of the period range: 48 h/
		);
	});

	it('rectangular: the node passes its own range through', async () => {
		const { t, y } = slowSquare();
		setColumns(t, y);
		const [res] = await fitFunction({
			...base,
			model: 'rectangular',
			minPeriod: 10,
			maxPeriod: 30
		});
		// Unpassed, the model's own default range (up to 48 h) applied and it fitted 48 h.
		const period = res.y_results[2].fitResult.period;
		expect(period).toBeLessThanOrEqual(30 + 1e-9);
		expect(period).toBeGreaterThanOrEqual(10 - 1e-9);
	});

	it('double logistic: bounded, with the at-bound warning', async () => {
		const { t, y } = slowSquare();
		setColumns(t, y);
		const [res, valid] = await fitFunction({ ...base, model: 'doublelogistic' });
		expect(valid).toBe(true);
		expect(res.y_results[2].fitResult.parameters.T).toBeCloseTo(48, 6);
		expect(res.warnings.join(' ')).toMatch(
			/double-logistic fit for "y" stopped at the upper limit/
		);
	});

	it('an empty range says why, for each model; a fixed period never warns', async () => {
		const { t, y } = slowSquare();
		setColumns(t, y);
		for (const model of ['rectangular', 'doublelogistic', 'cosinor']) {
			const [res] = await fitFunction({
				...base,
				model,
				useFixedPeriod: false,
				minPeriod: 30,
				maxPeriod: 20
			});
			expect(res.warnings.join(' ')).toMatch(/Period range 30 to 20 h is empty/);
		}
		const [rect] = await fitFunction({
			...base,
			model: 'rectangular',
			fixOmega: true,
			minPeriod: 30,
			maxPeriod: 20
		});
		expect(rect.warnings.join(' ')).not.toMatch(/Period range/);
		const [dl] = await fitFunction({
			...base,
			model: 'doublelogistic',
			fixPeriod: true,
			minPeriod: 30,
			maxPeriod: 20
		});
		expect(dl.warnings.join(' ')).not.toMatch(/Period range/);
	});
});

describe('Fit waveform model: exchangeability (FIT-5)', () => {
	it('defaults the scheme to shuffle', () => {
		expect(definition.defaults.get('permutationScheme')?.val).toBe('shuffle');
	});

	it('shuffle on autocorrelated residuals warns; block does not, and runs', async () => {
		const { t, y } = redNoise();
		setColumns(t, y);
		const args = {
			...base,
			model: 'rectangular',
			fixOmega: true,
			fixedPeriod: 24,
			permuteTest: true,
			nPermutations: 9
		};
		const [shuf] = await fitFunction(args);
		expect(shuf.warnings.join(' ')).toMatch(
			/The permutation p-value for "y" assumes independent \(exchangeable\) observations/
		);
		expect(shuf.y_results[2].fitResult.permScheme).toBe('shuffle');
		const [blk] = await fitFunction({ ...args, permutationScheme: 'block' });
		expect(blk.warnings.join(' ')).not.toMatch(/assumes independent/);
		expect(blk.y_results[2].fitResult.permScheme).toBe('block');
		expect(blk.y_results[2].fitResult.permBlockLength).toBe(24);
		expect(Number.isFinite(blk.y_results[2].fitResult.pValue)).toBe(true);
	});

	it('the fixed-period cosinor F-test is flagged even with no permutation test', async () => {
		const { t, y } = redNoise();
		setColumns(t, y);
		const [res] = await fitFunction({ ...base, model: 'cosinor', useFixedPeriod: true });
		expect(res.warnings.join(' ')).toMatch(/The F-test p-value for "y" assumes independent/);
	});

	it('honours autoPermutations on the headless path, as the panel does', async () => {
		const { t, y } = redNoise();
		const tt = t.slice(0, 40);
		setColumns(tt, y.slice(0, 40));
		const [res] = await fitFunction({
			...base,
			model: 'cosinor',
			useFixedPeriod: true,
			permuteTest: true,
			autoPermutations: true,
			nPermutations: 5
		});
		expect(res.y_results[2].fitResult.permutedStats).toHaveLength(recommendPermutations(40));
	});
});
