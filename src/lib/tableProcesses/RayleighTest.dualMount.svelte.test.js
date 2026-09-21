// Two live instances of one node must both follow an input change.
//
// The canvas editor panel and the control panel each mount the node component,
// and both share one session-lifetime nodeMemo. RayleighTest's compute effect
// is guarded on `hash !== memo.hash` and its recompute is synchronous, so the
// first instance to run claims the hash and the second sees "already handled":
// switch the angle unit, or let the upstream data change, and one of the two
// result tables keeps the old statistics. (Removing a column is NOT the case
// here: the yIN effect recomputes in every instance regardless of the memo.)
// The shared memo's follow() is what brings the second instance up to date.
/* global $state */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';

const mockColumns = {};
// The real core module (StoreValueButton needs its stored-value helpers) with a
// fresh, empty `core` so nothing leaks between tests.
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

const Node = (await import('./RayleighTest.svelte')).default;
const { memoClear } = await import('$lib/core/computeMemo.js');

// Reactive, like a real Column: the node's hash is a $derived over
// getDataHash, and the data-change test flips it in place.
function mkCol(id, name, data) {
	const col = $state({ id, name, type: 'number', getData: () => data, getDataHash: String(data) });
	mockColumns[id] = col;
}
function setData(id, data) {
	mockColumns[id].getData = () => data;
	mockColumns[id].getDataHash = String(data);
}

beforeEach(() => {
	memoClear();
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	// Angles in radians, clustered around 1 rad: a clearly non-uniform sample.
	mkCol(1, 'a', [0.8, 0.9, 1.0, 1.1, 1.2, 0.95, 1.05, 1.3]);
	mkCol(2, 'b', [0.1, 0.2, 2.5, 4.0, 5.5, 3.1, 6.0, 1.7]);
});
afterEach(() => cleanup());

const settle = async () => {
	flushSync();
	await tick();
	// Follow-ups are delivered from a microtask.
	await new Promise((r) => queueMicrotask(r));
	await tick();
};
const tableText = (c) =>
	[...c.container.querySelectorAll('tbody tr')].map((tr) => tr.textContent.replace(/\s+/g, ' '));

function mkProcess() {
	return {
		id: 9,
		name: 'RayleighTest',
		warnings: [],
		args: { yIN: [1, 2], timeIN: -1, unit: 'radians', period: 24, out: {}, valid: false }
	};
}

describe('RayleighTest with two mounted instances (canvas panel + control panel)', () => {
	it('both tables follow a unit switch (a hash change that does not touch yIN)', async () => {
		const p = $state(mkProcess());
		const a = render(Node, { props: { p, hideInputs: true } });
		const b = render(Node, { props: { p, hideInputs: true } });
		await settle();
		const before = tableText(a);
		expect(before.length).toBe(2);
		expect(tableText(b)).toEqual(before);

		p.args.unit = 'degrees';
		await settle();
		const after = tableText(a);
		expect(after).not.toEqual(before);
		expect(tableText(b)).toEqual(after);
	});

	it('both tables follow an upstream data change', async () => {
		const p = $state(mkProcess());
		const a = render(Node, { props: { p, hideInputs: true } });
		const b = render(Node, { props: { p, hideInputs: true } });
		await settle();
		const before = tableText(a);
		expect(tableText(b)).toEqual(before);

		// Column 1's data changes (a new hash); the wiring does not.
		setData(1, [0.1, 1.5, 3.0, 4.5, 6.0, 2.2, 5.1, 0.7]);
		await settle();
		const after = tableText(a);
		expect(after).not.toEqual(before);
		expect(tableText(b)).toEqual(after);
	});
});
