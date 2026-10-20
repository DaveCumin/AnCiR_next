// @ts-nocheck
/**
 * Fit waveform model refuses a series with fewer valid rows than its model's parameters + 1,
 * the same rule (and message) as the Cosinor node (utils/fitMinPoints.js). Before this, the
 * free-period cosinor put 4 parameters through 2 points and reported them as a result, and
 * the rectangular-wave and double-logistic fits did the same with 6 and 7 parameters.
 * Real fitting modules.
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

import { fitFunction } from './FitFunction.svelte';
import { fitModelParameters, fitMinPoints } from '$lib/utils/fitMinPoints.js';

const HOURS = 48;
const t = Array.from({ length: HOURS }, (_, i) => i);
/** A 24 h cosine with only the first n rows valid (null after). */
const sparse = (n) => t.map((v, i) => (i < n ? 10 + 5 * Math.cos((2 * Math.PI * v) / 24) : null));

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mockColumns[1] = { type: 'number', name: 'x', getData: () => t, hoursSinceStart: t };
});

const base = { xIN: 1, yIN: [2], outputX: -1, preProcesses: [], out: { fitx: -1 } };

describe('fitModelParameters: the parameter count of every model', () => {
	it.each([
		['cosinor', { useFixedPeriod: true, nHarmonics: 1 }, 3],
		['cosinor', { useFixedPeriod: true, nHarmonics: 2 }, 5],
		['cosinor', { useFixedPeriod: false, Ncurves: 1 }, 4],
		['cosinor', { useFixedPeriod: false, Ncurves: 2 }, 7],
		['rectangular', {}, 6],
		['rectangular', { fixOmega: true }, 5],
		['rectangular', { fixOmega: true, fixKappa: true, fixDutyCycle: true }, 3],
		['doublelogistic', { periodic: true }, 7],
		['doublelogistic', { periodic: true, fixPeriod: true }, 6],
		['doublelogistic', { periodic: false }, 6],
		['doublelogistic', { periodic: false, fixK1: true, fixK2: true }, 4]
	])('%s %o: %i parameters', (model, o, n) => {
		expect(fitModelParameters(model, o).nParams).toBe(n);
		expect(fitMinPoints(model, o)).toBe(n + 1);
	});
});

describe('Fit waveform model: too few valid rows is refused, as on the Cosinor node', () => {
	const cases = [
		// [label, args, nParams, a refused n, phrase]
		[
			'free-period cosinor',
			{ model: 'cosinor', useFixedPeriod: false },
			4,
			2,
			/A free-period cosinor with 1 curve/
		],
		[
			'fixed-period cosinor',
			{ model: 'cosinor', useFixedPeriod: true },
			3,
			2,
			/A fixed-period cosinor with 1 harmonic/
		],
		[
			'free-period rectangular wave',
			{ model: 'rectangular' },
			6,
			4,
			/A free-period rectangular wave/
		],
		[
			'free-period double logistic',
			{ model: 'doublelogistic' },
			7,
			5,
			/A free-period double logistic/
		]
	];
	for (const [name, args, nParams, nLow, phrase] of cases) {
		it(`${name}: ${nLow} rows -> no fit and a warning; ${nParams + 1} rows -> a fit`, async () => {
			const fitName =
				args.model === 'cosinor'
					? 'cosinor'
					: args.model === 'rectangular'
						? 'rectangular-wave'
						: 'double-logistic';
			mockColumns[2] = { type: 'number', name: 'sparse', getData: () => sparse(nLow) };
			const [r, valid] = await fitFunction({ ...base, minPeriod: 1, maxPeriod: 48, ...args });
			expect(valid).toBe(false);
			expect(r.y_results[2]).toBeUndefined();
			const msg = r.warnings.find((w) => w.startsWith(`No ${fitName} fit for "sparse"`));
			expect(msg).toMatch(new RegExp(`has only ${nLow} rows where both x and y have a value`));
			expect(msg).toMatch(phrase);
			expect(msg).toMatch(
				new RegExp(`estimates ${nParams} parameters, so it needs at least ${nParams + 1}`)
			);
			// The refusal replaces the old "interpolating" sample warning; it is not doubled up.
			expect(r.warnings.some((w) => /interpolating/.test(w))).toBe(false);

			mockColumns[2] = { type: 'number', name: 'sparse', getData: () => sparse(nParams + 1) };
			const [r2] = await fitFunction({ ...base, minPeriod: 1, maxPeriod: 48, ...args });
			expect(r2.y_results[2]).toBeDefined();
			expect(r2.warnings.some((w) => w.startsWith('No '))).toBe(false);
		});
	}

	it('a y with no valid rows says so (it used to be skipped silently)', async () => {
		mockColumns[2] = { type: 'number', name: 'sparse', getData: () => sparse(0) };
		const [r] = await fitFunction({ ...base, model: 'cosinor', useFixedPeriod: false });
		expect(r.warnings.find((w) => w.startsWith('No cosinor fit for "sparse"'))).toMatch(
			/has no rows where both x and y have a value/
		);
	});

	it('a series with enough rows next to a sparse one still fits, and outputs are written', async () => {
		mockColumns[2] = { type: 'number', name: 'full', getData: () => sparse(HOURS) };
		mockColumns[3] = { type: 'number', name: 'sparse', getData: () => sparse(2) };
		const [r, valid] = await fitFunction({
			...base,
			yIN: [2, 3],
			model: 'cosinor',
			useFixedPeriod: false,
			minPeriod: 12,
			maxPeriod: 36
		});
		expect(valid).toBe(true);
		expect(r.y_results[2].fitResult.parameters.cosines[0].amplitude).toBeCloseTo(5, 3);
		expect(r.y_results[3]).toBeUndefined();
		expect(r.warnings.some((w) => w.startsWith('No cosinor fit for "sparse"'))).toBe(true);
	});
});
