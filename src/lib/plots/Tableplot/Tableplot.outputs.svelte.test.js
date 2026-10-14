// @ts-nocheck
/* global $state */
// Output ports on a "Node results" Table (plan 2026-10-15 "fold Data View into Table", step 2).
//
// The node that publishes a result table DECLARES which of its columns are outputs
// (core/nodeResultTables `outputs`); a Table showing that table carries one output port per
// declared column, each backed by a real column holding the WHOLE table column (not one value
// per series as the other plot metric ports). Keys come from the declaration, never from the
// headers, so a header that comes and goes, or a provider that is briefly unmounted, cannot
// re-mint a column and strand the wires on it. "View stats" tables (no declaration), plot-data
// Tables and Columns Tables have no ports.
//
// The metric hook is `syncPlotMetricColumns` then `writePlotMetricOutputs` in a microtask;
// `sync` below calls the two directly. The mounted `which="compute"` instance is at the end.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { mutationService } from '$lib/core/mutationService.js';
import {
	getCachedProcessNodeGraph,
	clearProcessNodeGraphCache
} from '$lib/core/ProcessNode.svelte.js';
import {
	registerNodeResultTables,
	clearNodeResultTables
} from '$lib/core/nodeResultTables.svelte.js';
import { clearPlotInputs } from '$lib/core/nodeClipboard.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { loadProcesses } from '$test/processRegistry.js';
import {
	plotMetricKeys,
	plotMetricLabel,
	plotMetricColumnName,
	plotHasOutputs,
	syncPlotMetricColumns,
	writePlotMetricOutputs,
	plotMetricManifestOutputs
} from '$lib/plots/plotMetricOutputs.svelte.js';
import { PERMUTATION_TABLE_OUTPUTS } from '$lib/tableProcesses/permutationSupport.js';
import { computeTargets } from '$lib/components/views/NodeComputeHost.svelte';
import Tableplot from './Tableplot.svelte';

const NODE = 'tableprocess_5';
const HEADERS = [
	'series',
	'statistic',
	'permutation',
	'permuted_statistic',
	'observed_statistic',
	'p_value',
	'scheme'
];
const row = (s, i, v) => [s, 'rSquared', i, v, 0.9, 0.01, 'shuffle'];
const KEYS = ['series', 'permutation', 'permuted_statistic'];

/** A Cosinor-like provider: live permutation rows (reactive), and a stats table. */
function provide(state) {
	return registerNodeResultTables(NODE, {
		stats: { title: 'Cosinor stats', get: () => ({ headers: ['column', 'r2'], rows: [['a', 1]] }) },
		permutations: {
			title: 'Cosinor: permutations',
			get: () =>
				state.rows.length ? { headers: state.headers ?? HEADERS, rows: state.rows } : null,
			outputs: PERMUTATION_TABLE_OUTPUTS
		}
	});
}

function resultsTable(resultKey = 'permutations', extra = {}) {
	const plot = mutationService.addPlot({
		type: 'tableplot',
		name: 'Cosinor: permutations',
		sourceNodeId: NODE,
		plot: { source: 'node', resultKey },
		...extra
	});
	return plot;
}

function sync(plot) {
	syncPlotMetricColumns(plot);
	writePlotMetricOutputs(plot);
}
const col = (plot, key) => core.rawData.get(plot.metricOut[key]);
const graph = () => {
	clearProcessNodeGraphCache();
	return getCachedProcessNodeGraph(core, appConsts);
};

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
});
beforeEach(() => {
	history.init();
	history.clear();
	clearNodeResultTables();
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.tableProcesses = [{ id: 5, name: 'Cosinor', args: { out: {} } }];
});
afterEach(() => cleanup());

describe('which Tables have output ports', () => {
	it('a permutations Table: the three declared keys, labelled and named', () => {
		const st1 = $state({ rows: [] });
		provide(st1);
		const t = resultsTable();
		expect(plotMetricKeys(t)).toEqual(KEYS);
		expect(KEYS.map((k) => plotMetricLabel(t, k))).toEqual(KEYS);
		expect(plotMetricColumnName(t, 'permuted_statistic')).toBe(
			`permutations_permuted_statistic_${t.id}`
		);
		expect(plotHasOutputs(t)).toBe(true);
	});

	it('a View stats Table, a plot-data Table and a Columns Table: none', () => {
		const st2 = $state({ rows: [] });
		provide(st2);
		const stats = resultsTable('stats');
		const plotData = mutationService.addPlot({
			type: 'tableplot',
			name: 'Data',
			plot: { source: 'plot', sourcePlotId: 99 }
		});
		const columns = mutationService.addPlot({ type: 'tableplot', name: 'T', plot: {} });
		for (const t of [stats, plotData, columns]) {
			expect(plotMetricKeys(t)).toEqual([]);
			expect(plotHasOutputs(t)).toBe(false);
			sync(t);
			expect(t.metricOut).toEqual({});
		}
	});

	it('the manifest and the MCP schema list no Table outputs (the engine cannot make one)', () => {
		expect(plotMetricManifestOutputs('tableplot')).toEqual([]);
	});
});

describe('columns: whole table columns, typed, kept current', () => {
	it('one column per declared key, holding that header’s whole column', () => {
		const state = $state({ rows: [row('a', 1, 0.1), row('a', 2, 0.2), row('b', 1, 0.3)] });
		provide(state);
		const t = resultsTable();
		sync(t);
		expect(Object.keys(t.metricOut)).toEqual(KEYS);
		expect(col(t, 'series')).toEqual(['a', 'a', 'b']);
		expect(col(t, 'permutation')).toEqual([1, 2, 1]);
		expect(col(t, 'permuted_statistic')).toEqual([0.1, 0.2, 0.3]);
		expect(getColumnById(t.metricOut.series).type).toBe('category');
		expect(getColumnById(t.metricOut.permuted_statistic).type).toBe('number');
		expect(getColumnById(t.metricOut.permuted_statistic).name).toBe(
			`permutations_permuted_statistic_${t.id}`
		);
	});

	it('follows the node: a recompute rewrites the same columns', () => {
		const state = $state({ rows: [row('a', 1, 0.1)] });
		provide(state);
		const t = resultsTable();
		sync(t);
		const ids = { ...t.metricOut };
		state.rows = [row('a', 1, 0.5), row('a', 2, 0.6)];
		sync(t);
		expect(t.metricOut).toEqual(ids);
		expect(col(t, 'permuted_statistic')).toEqual([0.5, 0.6]);
	});

	it('before the node has a result the ports exist; the columns fill once it has one', () => {
		const state = $state({ rows: [] });
		provide(state);
		const t = resultsTable();
		sync(t);
		expect(Object.keys(t.metricOut)).toEqual(KEYS);
		state.rows = [row('a', 1, 0.7)];
		sync(t);
		expect(col(t, 'permuted_statistic')).toEqual([0.7]);
	});
});

describe('key churn cannot strand a wire', () => {
	it('the provider unmounting (hand-over, reload) keeps every column and its values', () => {
		const state = $state({ rows: [row('a', 1, 0.1)] });
		const off = provide(state);
		const t = resultsTable();
		sync(t);
		const ids = { ...t.metricOut };
		off();
		// Keys are unknown now, not empty: nothing is deleted.
		expect(plotHasOutputs(t)).toBe(false);
		sync(t);
		expect(t.metricOut).toEqual(ids);
		for (const id of Object.values(ids)) expect(getColumnById(id)).toBeTruthy();
		expect(col(t, 'permuted_statistic')).toEqual([0.1]);
		// Back again (the hidden instance mounted): the same columns, no re-mint.
		provide(state);
		sync(t);
		expect(t.metricOut).toEqual(ids);
	});

	it('reordered headers, and a declared header missing for a while, keep the same ids', () => {
		const state = $state({ rows: [row('a', 1, 0.1)] });
		provide(state);
		const t = resultsTable();
		sync(t);
		const ids = { ...t.metricOut };
		// Reordered: still read by header.
		state.headers = [...HEADERS].reverse();
		state.rows = [[...row('a', 3, 0.9)].reverse()];
		sync(t);
		expect(t.metricOut).toEqual(ids);
		expect(col(t, 'permuted_statistic')).toEqual([0.9]);
		expect(col(t, 'permutation')).toEqual([3]);
		// A declared header absent: its column is emptied, not deleted or re-minted.
		state.headers = HEADERS.filter((h) => h !== 'permutation');
		state.rows = [row('a', 1, 0.4).filter((_, i) => i !== 2)];
		sync(t);
		expect(t.metricOut).toEqual(ids);
		expect(col(t, 'permutation')).toEqual([]);
		expect(col(t, 'permuted_statistic')).toEqual([0.4]);
	});

	it('switching to a table without outputs, or out of Node results, removes the ports', () => {
		const st3 = $state({ rows: [row('a', 1, 0.1)] });
		provide(st3);
		const t = resultsTable();
		sync(t);
		const ids = Object.values(t.metricOut);
		// Still listed for a compute instance until its columns are cleaned up.
		t.plot.resultKey = 'stats';
		expect(plotHasOutputs(t)).toBe(true);
		sync(t);
		expect(t.metricOut).toEqual({});
		for (const id of ids) expect(getColumnById(id)).toBeFalsy();
		expect(plotHasOutputs(t)).toBe(false);

		t.plot.resultKey = 'permutations';
		sync(t);
		expect(Object.keys(t.metricOut)).toEqual(KEYS);
		t.plot.setSource('columns');
		sync(t);
		expect(t.metricOut).toEqual({});
	});
});

describe('on the canvas', () => {
	it('the Table node shows one plain output port per declared column and no inputs', () => {
		const st4 = $state({ rows: [row('a', 1, 0.1)] });
		provide(st4);
		const t = resultsTable();
		sync(t);
		const node = graph().nodes.find((n) => n.id === `plot_${t.id}`);
		expect(node.ports.inputs).toEqual([]);
		expect(node.ports.outputs.map((p) => p.name)).toEqual(KEYS.map((k) => `col_${t.metricOut[k]}`));
		expect(node.ports.outputs.map((p) => p.display)).toEqual(KEYS);
		// Whole columns, not one value per series: plain output ports, not metric ports.
		expect(node.ports.outputs.every((p) => p.metric !== true)).toBe(true);
		expect(node.outputColumns.map((o) => [o.key, o.metric])).toEqual(KEYS.map((k) => [k, false]));
	});

	it('a View stats Table node has no ports at all', () => {
		const st5 = $state({ rows: [] });
		provide(st5);
		const t = resultsTable('stats');
		sync(t);
		const node = graph().nodes.find((n) => n.id === `plot_${t.id}`);
		expect(node.ports.inputs).toEqual([]);
		expect(node.ports.outputs).toEqual([]);
	});

	it('the compute host covers a permutations Table, not a stats, plot-data or Columns Table', () => {
		const st6 = $state({ rows: [] });
		provide(st6);
		const perms = resultsTable();
		const stats = resultsTable('stats');
		const columns = mutationService.addPlot({ type: 'tableplot', name: 'T', plot: {} });
		const keys = computeTargets(core).map((x) => x.key);
		expect(keys).toContain(`plot_${perms.id}`);
		expect(keys).not.toContain(`plot_${stats.id}`);
		expect(keys).not.toContain(`plot_${columns.id}`);
	});
});

describe('save, load and paste', () => {
	it('a saved Table keeps its output columns; the loaded copy reuses them', () => {
		const state = $state({ rows: [row('a', 1, 0.1)] });
		provide(state);
		const t = resultsTable();
		sync(t);
		const ids = { ...t.metricOut };
		const json = JSON.parse(JSON.stringify(t));
		expect(json.metricOut).toEqual(ids);
		core.plots = [];
		const back = Plot.fromJSON(json);
		core.plots.push(back);
		sync(back);
		expect(back.metricOut).toEqual(ids);
		expect(col(back, 'permuted_statistic')).toEqual([0.1]);
	});

	it("a pasted Table mints its own columns and never writes into the original's", () => {
		const state = $state({ rows: [row('a', 1, 0.1)] });
		provide(state);
		const t = resultsTable();
		sync(t);
		const ids = { ...t.metricOut };
		const cloned = JSON.parse(JSON.stringify(t.toJSON()));
		delete cloned.id;
		const copy = mutationService.addPlot({ ...clearPlotInputs(cloned), x: 5, y: 5 });
		sync(copy);
		expect(Object.keys(copy.metricOut)).toEqual(KEYS);
		for (const id of Object.values(copy.metricOut)) expect(Object.values(ids)).not.toContain(id);
		expect(t.metricOut).toEqual(ids);
	});
});

describe('the mounted compute instance', () => {
	const settle = async () => {
		for (let i = 0; i < 4; i++) {
			flushSync();
			await tick();
			await new Promise((r) => setTimeout(r, 0));
		}
	};

	it('renders nothing, writes the columns, and follows the node', async () => {
		const state = $state({ rows: [row('a', 1, 0.1)] });
		provide(state);
		const t = resultsTable();
		const { container } = render(Tableplot, { props: { theData: t, which: 'compute' } });
		await settle();
		expect(container.innerHTML.replace(/<!---->/g, '').trim()).toBe('');
		expect(col(t, 'permuted_statistic')).toEqual([0.1]);
		state.rows = [row('a', 1, 0.2), row('b', 1, 0.3)];
		await settle();
		expect(col(t, 'permuted_statistic')).toEqual([0.2, 0.3]);
		expect(col(t, 'series')).toEqual(['a', 'b']);
	});

	it('the on-screen instance writes too; the panel instance never does', async () => {
		const st7 = $state({ rows: [row('a', 1, 0.1)] });
		provide(st7);
		const t = resultsTable();
		render(Tableplot, { props: { theData: t.plot, which: 'controls' } });
		await settle();
		expect(t.metricOut).toEqual({});
		render(Tableplot, { props: { theData: t, which: 'plot' } });
		await settle();
		expect(col(t, 'permuted_statistic')).toEqual([0.1]);
	});
});
