// Mount tests for the Normality Test control panel, mirroring DescribeData.render.test.js.
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

const Node = (await import('./NormalityTest.svelte')).default;
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
		name: 'NormalityTest',
		warnings: [],
		args: { yIN: [1, 2], method: 'shapiro', alpha: 0.05, out: {}, valid: false, ...over }
	};
}

beforeEach(() => {
	memoClear();
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	core.data.length = 0;
	mkCol(1, 'a', [10, 20, 30, 41, 55, 60, 72, 80]);
	mkCol(2, 'b', [1, 2, 3, 4, 5, 6, 7, 9]);
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

describe('NormalityTest control panel', () => {
	it('renders one picker per input port, labelled and reporting the selection', async () => {
		const { container } = render(Node, { props: { p: mkProcess() } });
		await settle();
		expect(container.textContent).toMatch(/Columns to test/);
		expect(triggers(container)).toEqual(['2 selected ▼']);
	});

	it('hides the pickers when the node is chained (hideInputs), like its siblings', async () => {
		const { container } = render(Node, { props: { p: mkProcess(), hideInputs: true } });
		await settle();
		expect(container.textContent).not.toMatch(/Columns to test/);
		expect(container.querySelector('.control-input .trigger')).toBeNull();
	});

	it('keeps two mounted instances (canvas panel + control panel) in step on an input change', async () => {
		const p = $state(mkProcess());
		const a = render(Node, { props: { p, hideInputs: true } });
		const b = render(Node, { props: { p, hideInputs: true } });
		await settle();
		const rows = (c) => c.container.querySelectorAll('tbody tr').length;
		expect([rows(a), rows(b)]).toEqual([2, 2]);
		p.args.yIN = [2];
		await settle();
		expect([rows(a), rows(b)]).toEqual([1, 1]);
		p.args.yIN = [1, 2];
		await settle();
		expect([rows(a), rows(b)]).toEqual([2, 2]);
	});
});
