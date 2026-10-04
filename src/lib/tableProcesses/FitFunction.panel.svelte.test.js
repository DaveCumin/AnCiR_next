// The Fit waveform model PANEL (the mounted component), for two review findings.
//
// Permutation p: the panel ran permutationTestAsync with an ASYNC fit function, so every
// statistic was a Promise's undefined `rSquared`, nothing counted as extreme and every p
// was 1 / (n + 1): "p = 0.0100, significant" on pure noise at 99 permutations, while the
// headless engine reported the real p for the same session.
//
// ROB-11: a fit that threw left the spinner up forever over the previous result, and the
// claimed memo hash meant the same inputs were never retried.
/* global $state */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';

const { mockColumns, failNext } = vi.hoisted(() => ({ mockColumns: {}, failNext: { on: false } }));
const freshCore = () => ({
	rawData: new Map(),
	data: [],
	groups: [],
	plots: [],
	tableProcesses: [],
	storedValues: {}
});
vi.mock('$lib/core/core.svelte', async (importOriginal) => ({
	...(await importOriginal()),
	core: freshCore()
}));
vi.mock('$lib/core/core.svelte.js', async (importOriginal) => ({
	...(await importOriginal()),
	core: freshCore()
}));
vi.mock('$lib/core/Column.svelte', async () => {
	const actual = await vi.importActual('$lib/core/Column.svelte').catch(() => ({}));
	return { ...actual, getColumnById: (id) => mockColumns[id], default: actual.default };
});
vi.mock('$lib/utils/fitFunction.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		fitCurveModel: (...a) => {
			if (failNext.on) throw new Error('optimiser diverged');
			return actual.fitCurveModel(...a);
		}
	};
});

const Node = (await import('./FitFunction.svelte')).default;
const { memoClear, nodeMemo } = await import('$lib/core/computeMemo.js');
const { fitPermutationPValue } = await import('$lib/utils/fitFunction.js');

function lcg(seed) {
	let s = seed;
	return () => {
		s = (1103515245 * s + 12345) % 2147483648;
		return s / 2147483648;
	};
}
const rnd = lcg(7);
const t = Array.from({ length: 96 }, (_, i) => i);
const noise = t.map(() => rnd() - 0.5);
function mkCol(id, name, data) {
	mockColumns[id] = { id, name, type: 'number', getData: () => data, getDataHash: String(id) };
}
const mkProcess = (over = {}) => ({
	id: 52,
	name: 'FitFunction',
	warnings: [],
	args: {
		xIN: 1,
		yIN: [2],
		model: 'cosinor',
		useFixedPeriod: true,
		fixedPeriod: 24,
		// fitx unwired: the panel shows its preview, with the per-series stats.
		out: { fitx: -1 },
		valid: false,
		...over
	}
});

const settle = async (n = 8) => {
	for (let i = 0; i < n; i++) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 0));
	}
};

beforeEach(() => {
	memoClear();
	failNext.on = false;
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mkCol(1, 'time', t);
	mkCol(2, 'noise', noise);
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('Fit waveform model panel: permutation p', () => {
	it('matches the headless p on pure noise (was 1 / (n + 1) whatever the data)', async () => {
		const perm = { permuteTest: true, nPermutations: 99, permutationSeed: 3 };
		const { container } = render(Node, { props: { p: mkProcess(perm) } });
		await settle(40);
		const expected = fitPermutationPValue(
			t,
			noise,
			'cosinor',
			{ useFixedPeriod: true, fixedPeriod: 24, nHarmonics: 1, Ncurves: 1, alpha: 0.05 },
			{ ...perm, permutationStatistic: 'rSquared' }
		);
		expect(expected.pValue).toBeGreaterThan(0.05);
		expect(container.textContent).toContain(`Perm p-value: ${expected.pValue.toFixed(4)}`);
		expect(container.textContent).not.toContain('Perm p-value: 0.0100');
		expect(container.textContent).toMatch(/99 permutations \(single values shuffled\)/);
	});
});

describe('Fit waveform model panel: compute failure (ROB-11)', () => {
	it('clears the spinner, shows the error, releases the hash; Retry recovers', async () => {
		failNext.on = true;
		const p = $state(mkProcess());
		const { container } = render(Node, { props: { p } });
		await settle();
		expect(container.textContent).not.toMatch(/Fitting model/);
		expect(container.textContent).toMatch(/The cosinor fit failed: optimiser diverged/);
		expect(p.args.valid).toBe(false);
		expect(nodeMemo(p, 'tableprocess').hash).toBe('');
		// Failed once, and not retried in a loop by the compute effect.
		expect(console.error).toHaveBeenCalledTimes(1);
		failNext.on = false;
		[...container.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Retry').click();
		await settle();
		expect(container.textContent).not.toMatch(/failed/);
		expect(p.args.valid).toBe(true);
		expect(nodeMemo(p, 'tableprocess').hash).not.toBe('');
	});

	it('a failure after a good fit drops the stale stats and validity', async () => {
		const p = $state(mkProcess());
		const { container } = render(Node, { props: { p } });
		await settle();
		expect(p.args.valid).toBe(true);
		expect(container.textContent).toMatch(/R²: /);
		failNext.on = true;
		p.args.fixedPeriod = 23;
		await settle();
		expect(p.args.valid).toBe(false);
		expect(container.textContent).not.toMatch(/R²: /);
		expect(container.textContent).toMatch(/The cosinor fit failed/);
	});
});
