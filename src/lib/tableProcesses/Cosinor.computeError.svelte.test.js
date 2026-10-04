// Review finding ROB-11 on the Cosinor node: its deferred compute set memo.hash before the
// await and had no try/finally. When the fit threw, the spinner stayed up forever over the
// previous result, and the claimed hash meant the same inputs were never tried again. It
// now runs through createComputeRunner (src/lib/core/asyncCompute.js).
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
vi.mock('$lib/utils/cosinor.worker-task.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		cosinorFitMany: (payload) => {
			if (failNext.on) throw new Error('design matrix is singular');
			return actual.cosinorFitMany(payload);
		}
	};
});

const Node = (await import('./Cosinor.svelte')).default;
const { memoClear, nodeMemo } = await import('$lib/core/computeMemo.js');

const t = Array.from({ length: 96 }, (_, i) => i);
const y = t.map((v) => 10 + 3 * Math.cos((2 * Math.PI * v) / 24));
function mkCol(id, name, data) {
	mockColumns[id] = { id, name, type: 'number', getData: () => data, getDataHash: String(id) };
}
const mkProcess = () => ({
	id: 41,
	name: 'Cosinor',
	warnings: [],
	args: { xIN: 1, yIN: [2], useFixedPeriod: true, fixedPeriod: 24, out: {}, valid: false }
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

describe('Cosinor compute failure (ROB-11)', () => {
	it('clears the spinner, shows the error on the node, and releases the hash', async () => {
		failNext.on = true;
		const p = mkProcess();
		const { container } = render(Node, { props: { p } });
		await settle();
		expect(container.textContent).not.toMatch(/Fitting cosinor/);
		expect(container.textContent).toMatch(/The cosinor fit failed\./);
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
		expect(container.textContent).not.toMatch(/failed/);
		expect(p.args.valid).toBe(true);
		expect(nodeMemo(p, 'tableprocess').hash).not.toBe('');
	});

	it('a failure after a good fit drops the stale stats and validity', async () => {
		const p = $state(mkProcess());
		const { container } = render(Node, { props: { p } });
		await settle();
		expect(p.args.valid).toBe(true);
		expect(container.textContent).toMatch(/View stats/);
		failNext.on = true;
		p.args.fixedPeriod = 23;
		await settle();
		expect(p.args.valid).toBe(false);
		expect(container.textContent).not.toMatch(/View stats/);
		expect(container.textContent).toMatch(/The cosinor fit failed/);
	});
});
