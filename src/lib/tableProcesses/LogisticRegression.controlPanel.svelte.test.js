// Mount tests for the Logistic Regression control panel, mirroring DescribeData.render.test.js.
//
// The panel showed no input picker (every other analysis node lets you add or
// remove its wired columns from the panel), and the results kept stale rows in
// the second of two mounted instances (canvas node + control panel). Both are
// markup/lifecycle defects that no test of the compute function can see, so
// this mounts the component the way TableProcess.svelte and the canvas editor
// panel do.
/* global $state */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: new Map(), data: [], groups: [], plots: [], tableProcesses: [] }
}));
vi.mock('$lib/core/core.svelte.js', () => ({
	core: { rawData: new Map(), data: [], groups: [], plots: [], tableProcesses: [] }
}));
vi.mock('$lib/core/Column.svelte', async () => {
	const actual = await vi.importActual('$lib/core/Column.svelte').catch(() => ({}));
	return { ...actual, getColumnById: (id) => mockColumns[id], default: actual.default };
});

const Node = (await import('./LogisticRegression.svelte')).default;
const { memoClear } = await import('$lib/core/computeMemo.js');
// The picker lists core.data (the mock's, shared with the component), so the
// mocked columns are pushed there too: that is what lets a single-select
// trigger show the column's NAME rather than the placeholder.
const { core } = await import('$lib/core/core.svelte.js');

function mkCol(id, name, data, type = 'number') {
	mockColumns[id] = { id, name, type, getData: () => data, getDataHash: String(data) };
	core.data.push(mockColumns[id]);
	return id;
}

function mkProcess(over = {}) {
	return {
		id: 1,
		name: 'LogisticRegression',
		warnings: [],
		args: { yIN: 3, xIN: [1, 2], out: {}, valid: false, ...over }
	};
}

beforeEach(() => {
	memoClear();
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	core.data.length = 0;
	mkCol(1, 'x1', [0.1, 0.9, 0.2, 0.8, 0.3, 0.7, 0.4, 0.6, 0.5, 0.55, 0.15, 0.85]);
	mkCol(2, 'x2', [1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1]);
	mkCol(3, 'outcome', [0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1]);
});
afterEach(() => cleanup());

const settle = async () => {
	flushSync();
	await tick();
	// The recompute is queued as a microtask from the effect.
	await new Promise((r) => queueMicrotask(r));
	await tick();
};
const triggers = (container) =>
	[...container.querySelectorAll('.control-input .trigger')].map((t) => t.textContent.trim());

describe('LogisticRegression control panel', () => {
	it('renders one picker per input port, labelled and reporting the selection', async () => {
		const { container } = render(Node, { props: { p: mkProcess() } });
		await settle();
		expect(container.textContent).toMatch(/Outcome \(binary\)/);
		expect(container.textContent).toMatch(/Predictors/);
		expect(triggers(container)).toEqual(['outcome ▼', '2 selected ▼']);
	});

	it('hides the pickers when the node is chained (hideInputs), like its siblings', async () => {
		const { container } = render(Node, { props: { p: mkProcess(), hideInputs: true } });
		await settle();
		expect(container.textContent).not.toMatch(/Outcome \(binary\)/);
		expect(container.querySelector('.control-input .trigger')).toBeNull();
	});

	it('keeps two mounted instances (canvas panel + control panel) in step on an input change', async () => {
		const p = $state(mkProcess());
		const a = render(Node, { props: { p, hideInputs: true } });
		const b = render(Node, { props: { p, hideInputs: true } });
		await settle();
		// intercept + one row per predictor
		const rows = (c) => c.container.querySelectorAll('tbody tr').length;
		expect([rows(a), rows(b)]).toEqual([3, 3]);
		p.args.xIN = [1];
		await settle();
		expect([rows(a), rows(b)]).toEqual([2, 2]);
		p.args.xIN = [1, 2];
		await settle();
		expect([rows(a), rows(b)]).toEqual([3, 3]);
	});
});
