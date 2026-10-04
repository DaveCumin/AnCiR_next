// Review finding ROB-11 on the Fit trend node: a throw inside the fit must not leave the
// node spinning or claiming the failed hash. Its compute runs through createComputeRunner
// (src/lib/core/asyncCompute.js); this pins that wiring end to end on the component.
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
vi.mock('$lib/utils/trendfit.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		fitTrendSync: (...a) => {
			if (failNext.on) throw new Error('design matrix is singular');
			return actual.fitTrendSync(...a);
		}
	};
});

const Node = (await import('./TrendFit.svelte')).default;
const { memoClear, nodeMemo } = await import('$lib/core/computeMemo.js');

const t = Array.from({ length: 96 }, (_, i) => i);
const y = t.map((v) => 10 + 0.5 * v);
function mkCol(id, name, data) {
	mockColumns[id] = { id, name, type: 'number', getData: () => data, getDataHash: String(id) };
}
const mkProcess = () => ({
	id: 41,
	name: 'TrendFit',
	warnings: [],
	args: { xIN: 1, yIN: [2], model: 'polynomial', polyDegree: 2, out: {}, valid: false }
});

const settle = async () => {
	for (let i = 0; i < 6; i++) {
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
	mkCol(2, 'activity', y);
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('Fit trend compute failure (ROB-11)', () => {
	it('clears the spinner, shows the error on the node, and releases the hash', async () => {
		failNext.on = true;
		const p = mkProcess();
		const { container } = render(Node, { props: { p } });
		await settle();
		expect(container.textContent).not.toMatch(/Running permutation test/);
		expect(container.textContent).toMatch(/The fit failed\./);
		expect(container.textContent).toMatch(/design matrix is singular/);
		expect(p.args.valid).toBe(false);
		expect(p.warnings[0]).toMatch(/design matrix is singular/);
		// The failed hash is not recorded as handled, so a remount tries again.
		expect(nodeMemo(p, 'tableprocess').hash).toBe('');
	});

	it('Try again recomputes the same inputs and shows the result', async () => {
		failNext.on = true;
		const p = mkProcess();
		const { container } = render(Node, { props: { p } });
		await settle();
		failNext.on = false;
		const retry = [...container.querySelectorAll('button')].find(
			(b) => b.textContent.trim() === 'Try again'
		);
		expect(retry).toBeTruthy();
		retry.click();
		await settle();
		expect(container.textContent).not.toMatch(/The fit failed/);
		expect(p.args.valid).toBe(true);
		expect(nodeMemo(p, 'tableprocess').hash).not.toBe('');
	});

	it('a failure after a good fit drops the stale stats and validity', async () => {
		const p = $state(mkProcess());
		const { container } = render(Node, { props: { p } });
		await settle();
		expect(p.args.valid).toBe(true);
		failNext.on = true;
		p.args.polyDegree = 3;
		await settle();
		expect(p.args.valid).toBe(false);
		expect(container.textContent).toMatch(/The fit failed\./);
	});
});
