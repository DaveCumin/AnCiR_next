// The canvas node and the control panel each mount the node component, so each
// of its StoreValueButtons is mounted twice. Both copies must be ONE stored value:
// opening the control panel used to add a `_2` copy of every value (120 extra
// entries for the rest-activity demo's Cosinor), which a formula could pick and
// lose when the panel closed.
/* global $state */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';

const mockColumns = {};
const freshCore = () => ({
	rawData: new Map(),
	data: [],
	groups: [],
	plots: [],
	tableProcesses: [],
	storedValues: {}
});
// The REAL core (reactive), emptied: a rename must reach every mounted button.
vi.mock('$lib/core/core.svelte.js', async (importOriginal) => {
	const actual = await importOriginal();
	Object.assign(actual.core, freshCore());
	return actual;
});
vi.mock('$lib/core/Column.svelte', async () => {
	const actual = await vi.importActual('$lib/core/Column.svelte').catch(() => ({}));
	return { ...actual, getColumnById: (id) => mockColumns[id], default: actual.default };
});

const Node = (await import('./RayleighTest.svelte')).default;
const { core, renameStoredValue, getStoredValue } = await import('$lib/core/core.svelte.js');
const { memoClear } = await import('$lib/core/computeMemo.js');
const { resetStoredValueClaimsForTest } = await import('$lib/core/storedValueClaims.js');

function mkCol(id, name, data) {
	const col = $state({ id, name, type: 'number', getData: () => data, getDataHash: String(data) });
	mockColumns[id] = col;
}

beforeEach(() => {
	memoClear();
	resetStoredValueClaimsForTest();
	for (const k of Object.keys(core.storedValues)) delete core.storedValues[k];
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mkCol(1, 'a', [0.8, 0.9, 1.0, 1.1, 1.2, 0.95, 1.05, 1.3]);
	mkCol(2, 'b', [0.1, 0.2, 2.5, 4.0, 5.5, 3.1, 6.0, 1.7]);
});
afterEach(() => cleanup());

const settle = async () => {
	flushSync();
	await tick();
	await new Promise((r) => queueMicrotask(r));
	await tick();
};
const mkProcess = (id = 9) => ({
	id,
	name: 'RayleighTest',
	warnings: [],
	args: { yIN: [1, 2], timeIN: -1, unit: 'radians', period: 24, out: {}, valid: false }
});
const keys = () => Object.keys(core.storedValues).sort();
const buttonNames = (c) =>
	[...c.container.querySelectorAll('button[aria-label^="Rename stored value"]')].map((b) =>
		b.getAttribute('aria-label')
	);

describe('stored values with two mounted copies of a node', () => {
	it('mounting the node twice registers each value once', async () => {
		const p = $state(mkProcess());
		const a = render(Node, { props: { p, hideInputs: true } });
		await settle();
		const once = keys();
		expect(once.length).toBeGreaterThan(0);
		expect(buttonNames(a).length).toBe(once.length);

		const b = render(Node, { props: { p, hideInputs: true } });
		await settle();
		expect(keys()).toEqual(once);
		expect(buttonNames(b)).toEqual(buttonNames(a));
		expect(once.some((k) => /_2$/.test(k))).toBe(false);
	});

	it('closing either copy keeps the value; closing both removes it', async () => {
		const p = $state(mkProcess());
		const a = render(Node, { props: { p, hideInputs: true } });
		const b = render(Node, { props: { p, hideInputs: true } });
		await settle();
		const names = keys();
		const before = names.map(getStoredValue);
		a.unmount();
		await settle();
		expect(keys()).toEqual(names);
		expect(names.map(getStoredValue)).toEqual(before);
		b.unmount();
		await settle();
		expect(keys()).toEqual([]);
	});

	it('a rename in one copy shows in the other, and survives the renaming copy closing', async () => {
		const p = $state(mkProcess());
		const a = render(Node, { props: { p, hideInputs: true } });
		const b = render(Node, { props: { p, hideInputs: true } });
		await settle();
		const [first] = keys();
		renameStoredValue(first, 'my_value');
		await settle();
		expect(buttonNames(b)).toContain('Rename stored value my_value');
		expect(buttonNames(a)).toContain('Rename stored value my_value');
		a.unmount();
		await settle();
		expect(keys()).toContain('my_value');
		expect(keys()).not.toContain(first);
	});

	it('two DIFFERENT nodes on the same columns still get distinct names', async () => {
		const p1 = $state(mkProcess(9));
		const p2 = $state(mkProcess(10));
		render(Node, { props: { p: p1, hideInputs: true } });
		await settle();
		const one = keys().length;
		const b = render(Node, { props: { p: p2, hideInputs: true } });
		await settle();
		expect(buttonNames(b).length).toBe(one);
		expect(keys().length).toBe(2 * one);
	});
});
