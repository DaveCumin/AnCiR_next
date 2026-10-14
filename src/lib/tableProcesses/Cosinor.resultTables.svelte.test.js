// "View permutations" on Cosinor opens a Table in Node-results mode (plan 2026-10-15 "fold
// Data View into Table", step 1). The node publishes its result tables live; the Table reads
// them from the registry, so it follows a recompute without being mounted itself.
/* global $state */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';

const { mockColumns } = vi.hoisted(() => ({ mockColumns: {} }));
vi.mock('$lib/core/Column.svelte', async () => {
	const actual = await vi.importActual('$lib/core/Column.svelte').catch(() => ({}));
	return {
		...actual,
		getColumnById: (id) => mockColumns[id] ?? actual.getColumnById?.(id),
		default: actual.default
	};
});

const Node = (await import('./Cosinor.svelte')).default;
const { memoClear } = await import('$lib/core/computeMemo.js');
const { readNodeResultTable, listNodeResultTables, clearNodeResultTables } =
	await import('$lib/core/nodeResultTables.svelte.js');
appConsts.plotMap = await loadPlots();

const t = Array.from({ length: 96 }, (_, i) => i);
// A rhythm plus deterministic wobble, so permuted R² values differ from one another.
const y = t.map((v) => 10 + 3 * Math.cos((2 * Math.PI * v) / 24) + Math.sin(v * 1.7));
function mkCol(id, name, data) {
	mockColumns[id] = { id, name, type: 'number', getData: () => data, getDataHash: String(id) };
}
const mkProcess = () => ({
	id: 41,
	name: 'Cosinor',
	warnings: [],
	args: {
		xIN: 1,
		yIN: [2],
		useFixedPeriod: true,
		fixedPeriod: 24,
		permuteTest: true,
		nPermutations: 99,
		permutationSeed: 7,
		out: {},
		valid: false
	}
});

const settle = async () => {
	for (let i = 0; i < 8; i++) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 0));
	}
};

beforeEach(() => {
	memoClear();
	clearNodeResultTables();
	core.plots.length = 0;
	core.tableProcesses = [{ id: 41, name: 'Cosinor', args: {} }];
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mkCol(1, 'time', t);
	mkCol(2, 'activity', y);
});
afterEach(() => cleanup());

describe('Cosinor result tables', () => {
	it('publishes its stats and permutations tables while mounted', async () => {
		const p = $state(mkProcess());
		const { unmount } = render(Node, { props: { p } });
		await settle();
		expect(listNodeResultTables('tableprocess_41').map((x) => x.key)).toEqual([
			'stats',
			'permutations'
		]);
		const perms = readNodeResultTable('tableprocess_41', 'permutations');
		expect(perms.headers).toContain('permuted_statistic');
		expect(perms.rows).toHaveLength(99);
		unmount();
		expect(readNodeResultTable('tableprocess_41', 'permutations')).toBeNull();
	});

	it('View permutations opens a linked Node-results Table that follows a recompute', async () => {
		const p = $state(mkProcess());
		const { container } = render(Node, { props: { p } });
		await settle();
		const button = [...container.querySelectorAll('button')].find(
			(b) => b.textContent.trim() === 'View permutations'
		);
		expect(button).toBeTruthy();
		button.click();
		flushSync();

		expect(core.plots).toHaveLength(1);
		const table = core.plots[0];
		expect(table.type).toBe('tableplot');
		expect(table.sourceNodeId).toBe('tableprocess_41');
		expect(table.plot.source).toBe('node');
		expect(table.plot.resultKey).toBe('permutations');
		expect(table.name).toBe('Cosinor: permutations');
		expect(table.plot.view.status).toBe('live');
		expect(table.plot.view.rows).toHaveLength(99);
		const permutedCol = table.plot.view.headers.indexOf('permuted_statistic');
		const before = table.plot.view.rows.map((r) => r[permutedCol]);

		// The Table is not mounted anywhere; the node recomputes and the Table follows.
		p.args.nPermutations = 199;
		await settle();
		expect(table.plot.view.rows).toHaveLength(199);
		p.args.permutationSeed = 8;
		await settle();
		const after = table.plot.view.rows.map((r) => r[permutedCol]);
		expect(after).toHaveLength(199);
		expect(after.slice(0, 99)).not.toEqual(before);

		// A second click focuses the existing Table instead of adding another.
		button.click();
		flushSync();
		expect(core.plots).toHaveLength(1);
	});
});
