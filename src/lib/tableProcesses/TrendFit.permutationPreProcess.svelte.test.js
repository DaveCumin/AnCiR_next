// @ts-nocheck
// Fit trend's permutation run must write the same curve as its plain fit: both go through the
// node's pre-processes (which act on the fitted curve the node writes, as in every fit node
// and in tools/ancir_runtime.py tp_trendfit).
//
// REPORTED (vault TODO, port parity pass 2026-10-20): "TrendFit permutation path skips
// preProcesses (app)". Reproduced in the app 2026-10-22 with a linear fit and an Add 1
// pre-process: on load the curve read 3.514, 4.023, ... (the fit + 1); after "Run
// permutation test" it read 2.514, 3.023, ... (the bare fit). The permutation path
// (computeTrend) built its own results and never applied the pre-processes.
//
// Real core, real Columns and the real process registry: nothing mocked.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { mutationService } from '$lib/core/mutationService.js';
import { memoClear } from '$lib/core/computeMemo.js';
import { fitTrendSync } from '$lib/utils/trendfit.js';
import TrendFit from './TrendFit.svelte';

const x = Array.from({ length: 20 }, (_, i) => i);
const y = x.map((v) => 2 + 0.5 * v + ((v * 7) % 5) * 0.3);

function numberColumn(name, values) {
	const c = new Column({ type: 'number' });
	c.name = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	pushObj(c);
	return c.id;
}

const settle = async () => {
	for (let i = 0; i < 10; i++) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 0));
	}
};

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.tableProcessMap = await loadTableProcesses();
});

let xId;
let yId;
beforeEach(() => {
	memoClear();
	core.data = [];
	core.rawData = new Map();
	core.tableProcesses = [];
	core.plots = [];
	xId = numberColumn('x', x);
	yId = numberColumn('y', y);
});
afterEach(() => cleanup());

// A real free node (as the palette adds it), so the component creates its output columns.
function mkProcess(preProcesses) {
	return mutationService.addFreeTableProcess('TrendFit', {
		xIN: xId,
		yIN: [yId],
		model: 'linear',
		permuteTest: true,
		autoPermutations: false,
		nPermutations: 99,
		permutationSeed: 7,
		permutationStatistic: 'rSquared',
		preProcesses,
		out: {}
	});
}

const curveOf = (p) => getColumnById(p.args.out['trendy_' + yId])?.getData() ?? [];

async function runPermutation(container) {
	const btn = [...container.querySelectorAll('button')].find((b) =>
		/run permutation test/i.test(b.textContent)
	);
	expect(btn).toBeTruthy();
	btn.click();
	await settle();
}

describe('Fit trend: the permutation run applies the pre-processes', () => {
	it('Add 1: the curve is the fit + 1 on both paths', async () => {
		const p = mkProcess([{ processName: 'Add', processArgs: { value: 1 } }]);
		const { container } = render(TrendFit, { props: { p } });
		await settle();
		const fitted = fitTrendSync(x, y, 'linear', 2).fitted;
		const plain = [...curveOf(p)];
		expect(plain).toHaveLength(fitted.length);
		plain.forEach((v, i) => expect(v).toBeCloseTo(fitted[i] + 1, 9));

		await runPermutation(container);
		const permStats = getColumnById(p.args.out['permstats_' + yId])?.getData() ?? [];
		expect(permStats.length).toBeGreaterThan(0); // the permutation run did happen
		expect(curveOf(p)).toEqual(plain);
	});

	it('no pre-process: the permutation run still writes the bare fit', async () => {
		const p = mkProcess([]);
		const { container } = render(TrendFit, { props: { p } });
		await settle();
		await runPermutation(container);
		const fitted = fitTrendSync(x, y, 'linear', 2).fitted;
		expect(curveOf(p)).toHaveLength(fitted.length);
		curveOf(p).forEach((v, i) => expect(v).toBeCloseTo(fitted[i], 9));
	});
});
