// REPORTED 2026-10-17: selecting a Double Logistic node deleted its stored values, and every
// formula using them broke. Two causes, both covered here:
//   1. The node's results panel came back EMPTY after a remount (a view switch, the hand-over
//      to the hidden compute instance): `dlData` started as null, and the "mirror into the
//      memo" effect, which runs before onMount, wrote that null over the cached result, so
//      onMount restored null and the stats (with their buttons) only showed under "View stats".
//   2. A stored value lived only while one of its buttons was mounted. It now belongs to the
//      node (storedValueClaims.js): kept while the node exists, released when it is deleted.
/* global $state */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';

const mockColumns = {};
vi.mock('$lib/core/core.svelte.js', async (importOriginal) => {
	const actual = await importOriginal();
	Object.assign(actual.core, {
		rawData: new Map(),
		data: [],
		groups: [],
		plots: [],
		tableProcesses: [],
		storedValues: {}
	});
	return actual;
});
vi.mock('$lib/core/Column.svelte', async () => {
	const actual = await vi.importActual('$lib/core/Column.svelte').catch(() => ({}));
	return {
		...actual,
		getColumnById: (id) => mockColumns[id] ?? actual.getColumnById?.(id),
		default: actual.default
	};
});

const Node = (await import('./DoubleLogistic.svelte')).default;
const { core, getStoredValue, renameStoredValue } = await import('$lib/core/core.svelte.js');
const { memoClear } = await import('$lib/core/computeMemo.js');
const { resetStoredValueClaimsForTest } = await import('$lib/core/storedValueClaims.js');
const { parseFormula, evaluateFormula } = await import('$lib/utils/formulaExpression.js');

const N = 50;
const X = Array.from({ length: N }, (_, i) => i);
// A clean on-then-off pulse: rest 25, active 75 between t = 12 and t = 36.
const Y = X.map((t) => 25 + 50 / (1 + Math.exp(-(t - 12))) - 50 / (1 + Math.exp(-(t - 36))));

function mkCol(id, name, data) {
	const col = $state({ id, name, type: 'number', getData: () => data, getDataHash: String(data) });
	mockColumns[id] = col;
}

beforeEach(() => {
	memoClear();
	resetStoredValueClaimsForTest();
	for (const k of Object.keys(core.storedValues)) delete core.storedValues[k];
	core.tableProcesses.length = 0;
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mkCol(1, 'x', X);
	mkCol(2, 'y', Y);
});
afterEach(() => cleanup());

const settle = async () => {
	flushSync();
	await tick();
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
	await tick();
};
const buttons = (c) => c.container.querySelectorAll('button[aria-label^="Rename stored value"]');
async function untilButtons(c) {
	for (let i = 0; i < 200 && buttons(c).length === 0; i++) await settle();
	return buttons(c).length;
}
const names = () => Object.keys(core.storedValues).sort();

function mkNode() {
	const p = $state({
		id: 21,
		name: 'DoubleLogistic',
		warnings: [],
		args: { xIN: 1, yIN: [2], outputX: -1, out: {}, valid: false }
	});
	core.tableProcesses.push(p);
	return p;
}

/** The value a formula `#name` gives, as FormulaColumn evaluates it. */
function formula(name) {
	const ast = parseFormula([{ type: 'stored', key: name }]);
	return evaluateFormula(ast, { column: () => [], stored: (k) => getStoredValue(k) }, 1)[0];
}

describe('a Double Logistic node owns its stored values', () => {
	it('its results and buttons come back when the panel mounts again', async () => {
		const p = mkNode();
		const a = render(Node, { props: { p, hideInputs: true } });
		const n = await untilButtons(a);
		expect(n).toBeGreaterThan(5);
		a.unmount();
		await settle();
		const b = render(Node, { props: { p, hideInputs: true } });
		await settle();
		expect(buttons(b).length).toBe(n);
	});

	it('unmounting every button keeps the values, renamed names and formulas working', async () => {
		const p = mkNode();
		const a = render(Node, { props: { p, hideInputs: true } });
		await untilButtons(a);
		const before = names();
		expect(before).toContain('dlog_period_y');
		renameStoredValue('dlog_period_y', 'tau');
		await settle();
		const tau = getStoredValue('tau');
		expect(tau).toBeGreaterThan(1);
		expect(formula('tau')).toBeCloseTo(tau, 10);

		a.unmount(); // deselected, collapsed or a view switch: no button mounted at all
		await settle();
		expect(names()).toEqual(before.map((k) => (k === 'dlog_period_y' ? 'tau' : k)).sort());
		expect(getStoredValue('tau')).toBe(tau);
		expect(formula('tau')).toBeCloseTo(tau, 10);

		const b = render(Node, { props: { p, hideInputs: true } });
		await settle();
		expect(names()).toContain('tau');
		expect(names()).not.toContain('dlog_period_y');
		expect(b.container.querySelector('[aria-label="Rename stored value tau"]')).not.toBeNull();
	});

	it('deleting the node releases its values', async () => {
		const p = mkNode();
		const a = render(Node, { props: { p, hideInputs: true } });
		await untilButtons(a);
		a.unmount();
		await settle();
		expect(names().length).toBeGreaterThan(5);
		core.tableProcesses.splice(core.tableProcesses.indexOf(p), 1);
		await settle();
		expect(names()).toEqual([]);
	});

	it('deleting the node while its panel is open releases them too', async () => {
		const p = mkNode();
		const a = render(Node, { props: { p, hideInputs: true } });
		await untilButtons(a);
		core.tableProcesses.splice(core.tableProcesses.indexOf(p), 1);
		a.unmount();
		await settle();
		expect(names()).toEqual([]);
	});
});
