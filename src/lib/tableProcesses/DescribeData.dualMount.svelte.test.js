// Two live instances of one node must both follow an input change.
//
// The canvas editor panel and the control panel each mount the node component,
// and both share one session-lifetime nodeMemo. The old effect guard was
// `hash === memo.hash`: the first instance to run claimed the hash, so the
// second instance saw "already handled" and kept its old rows. Seen as: remove
// a column in the control panel's picker, the canvas table drops to one row
// while the panel's own Summary still shows two.
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

const DescribeData = (await import('./DescribeData.svelte')).default;
const { memoClear } = await import('$lib/core/computeMemo.js');

function mkCol(id, name, data) {
	mockColumns[id] = { id, name, type: 'number', getData: () => data, getDataHash: String(data) };
}

beforeEach(() => {
	memoClear();
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mkCol(1, 'a', [10, 20, 30, 40, 50]);
	mkCol(2, 'b', [1, 2, 3, 4, 5]);
});
afterEach(() => cleanup());

const rowsIn = (container) => container.querySelectorAll('tbody tr').length;
const settle = async () => {
	flushSync();
	await tick();
	// The recompute is queued as a microtask from the effect.
	await new Promise((r) => queueMicrotask(r));
	await tick();
};

describe('DescribeData with two mounted instances (canvas panel + control panel)', () => {
	it('updates both tables when a column is removed from the inputs', async () => {
		const p = $state({ id: 7, name: 'DescribeData', warnings: [], args: { yIN: [1, 2], out: {} } });
		const a = render(DescribeData, { props: { p, hideInputs: true } });
		const b = render(DescribeData, { props: { p, hideInputs: true } });
		await settle();
		expect(rowsIn(a.container)).toBe(2);
		expect(rowsIn(b.container)).toBe(2);

		p.args.yIN = [2];
		await settle();
		expect(rowsIn(a.container)).toBe(1);
		expect(rowsIn(b.container)).toBe(1);

		p.args.yIN = [1, 2];
		await settle();
		expect(rowsIn(a.container)).toBe(2);
		expect(rowsIn(b.container)).toBe(2);
	});
});
