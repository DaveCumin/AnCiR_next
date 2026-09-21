// Mount tests for the Categorical tests (chi-squared / Fisher) control panel, mirroring DescribeData.render.test.js.
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

const Node = (await import('./ChiSquared.svelte')).default;
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
		name: 'ChiSquared',
		warnings: [],
		args: {
			testType: 'independence',
			xIN: 1,
			yIN: 2,
			dataFormat: 'groups',
			correction: true,
			alternative: 'two-sided',
			out: {},
			valid: false,
			...over
		}
	};
}

beforeEach(() => {
	memoClear();
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	core.data.length = 0;
	mkCol(1, 'ctrl', ['yes', 'no', 'no', 'yes', 'no', 'no', 'no', 'yes'], 'category');
	mkCol(2, 'drug', ['yes', 'yes', 'yes', 'no', 'yes', 'yes', 'no', 'yes'], 'category');
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

describe('ChiSquared control panel', () => {
	it('renders one picker per input port, labelled and reporting the selection', async () => {
		const { container } = render(Node, { props: { p: mkProcess() } });
		await settle();
		// Labels follow the test and input format: two independent groups by default.
		expect(container.textContent).toMatch(/Group 1/);
		expect(container.textContent).toMatch(/Group 2/);
		expect(triggers(container)).toEqual(['ctrl ▼', 'drug ▼']);
	});

	it('relabels the ports for the paired reading and drops the second for goodness-of-fit', async () => {
		const p = $state(mkProcess({ dataFormat: 'paired' }));
		const { container } = render(Node, { props: { p } });
		await settle();
		expect(container.textContent).toMatch(/Variable 1 \(rows\)/);
		expect(container.textContent).toMatch(/Variable 2 \(columns\)/);
		p.args.testType = 'goodness';
		await settle();
		expect(container.textContent).toMatch(/Column to test/);
		expect(container.textContent).not.toMatch(/Variable 2/);
		expect(triggers(container)).toEqual(['ctrl ▼']);
	});

	it('hides the pickers when the node is chained (hideInputs), like its siblings', async () => {
		const { container } = render(Node, { props: { p: mkProcess(), hideInputs: true } });
		await settle();
		expect(container.textContent).not.toMatch(/Group 1/);
		expect(container.querySelector('.control-input .trigger')).toBeNull();
	});

	it('keeps two mounted instances (canvas panel + control panel) in step on an input change', async () => {
		const p = $state(mkProcess());
		const a = render(Node, { props: { p, hideInputs: true } });
		const b = render(Node, { props: { p, hideInputs: true } });
		await settle();
		const stat = (c) => /χ² = /.test(c.container.textContent);
		expect([stat(a), stat(b)]).toEqual([true, true]);
		p.args.yIN = -1;
		await settle();
		expect([stat(a), stat(b)]).toEqual([false, false]);
		p.args.yIN = 2;
		await settle();
		expect([stat(a), stat(b)]).toEqual([true, true]);
	});
});
