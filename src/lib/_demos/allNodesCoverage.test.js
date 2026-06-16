/**
 * Coverage guard: every registered node type (plot, column-process, table-process)
 * must (1) have a construction spec in nodeCatalog, (2) wire up in the workflow
 * graph, and (3) produce valid output from its func. This is the enforceable
 * embodiment of "the demos cover all nodes and are correct + connected" — if a new
 * node is added without a catalog entry, or a node stops wiring/producing output,
 * this test fails.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { core, appConsts, getProcessNodeGraph } from '$lib/core/core.svelte.js';
import { clearProcessNodeGraphCache } from '$lib/core/ProcessNode.svelte.js';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { PLOT_SPECS, PROCESS_SPECS, TP_SPECS, buildAllNodes } from './nodeCatalog.js';

let graph;
let built;

function resetCore() {
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.notes = [];
	core.orphanProcesses = [];
	core.storedValues = {};
	core.rawData = new Map();
}

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	resetCore();
	clearProcessNodeGraphCache();
	built = buildAllNodes();
	graph = getProcessNodeGraph();
});

describe('every registered node type has a catalog spec (completeness)', () => {
	it('covers every plot type', () => {
		expect(new Set(PLOT_SPECS.map((s) => s.type))).toEqual(new Set([...appConsts.plotMap.keys()]));
	});
	it('covers every column process', () => {
		expect(new Set(PROCESS_SPECS.map((s) => s.name))).toEqual(
			new Set([...appConsts.processMap.keys()])
		);
	});
	it('covers every table process', () => {
		expect(new Set(TP_SPECS.map((s) => s.name))).toEqual(
			new Set([...appConsts.tableProcessMap.keys()])
		);
	});
});

describe('every built node appears + wires in the workflow graph (connectivity)', () => {
	const nodeIds = () => new Set(graph.nodes.map((n) => n.id));
	const incoming = (id) => graph.connections.filter((c) => c.toId === id);

	it('emits a node for every plot, process, and table process', () => {
		const ids = nodeIds();
		for (const pid of built.plotIds) expect(ids.has(`plot_${pid}`), `plot_${pid}`).toBe(true);
		for (const pid of built.processIds)
			expect(ids.has(`process_${pid}`), `process_${pid}`).toBe(true);
		for (const tid of built.tpIds)
			expect(ids.has(`tableprocess_${tid}`), `tableprocess_${tid}`).toBe(true);
	});

	it('wires every column process from its source column', () => {
		for (const pid of built.processIds) {
			expect(incoming(`process_${pid}`).length, `process_${pid} has an input edge`).toBeGreaterThan(
				0
			);
		}
	});

	it('wires every input-bearing plot from its data', () => {
		const noEdge = new Set(PLOT_SPECS.filter((s) => s.noInputEdges).map((s) => s.type));
		for (const spec of PLOT_SPECS) {
			const pid = built.plotIds[PLOT_SPECS.indexOf(spec)];
			if (noEdge.has(spec.type)) continue;
			expect(
				incoming(`plot_${pid}`).length,
				`${spec.type} (plot_${pid}) has input edges`
			).toBeGreaterThan(0);
		}
	});

	it('wires every input-bearing table process from its inputs', () => {
		for (let i = 0; i < TP_SPECS.length; i++) {
			const spec = TP_SPECS[i];
			const tid = built.tpIds[i];
			if (spec.inputs.length === 0) continue; // generators / stored-value TPs have no column inputs
			expect(
				incoming(`tableprocess_${tid}`).length,
				`${spec.name} (tableprocess_${tid}) has input edges`
			).toBeGreaterThan(0);
		}
	});
});

describe('every table process produces valid output (correctness)', () => {
	for (const spec of TP_SPECS) {
		it(`${spec.name} func returns valid`, async () => {
			const tp = core.tableProcesses.find((t) => t.name === spec.name);
			expect(tp, `${spec.name} was built`).toBeTruthy();
			const entry = appConsts.tableProcessMap.get(spec.name);
			expect(entry?.func, `${spec.name} has a func`).toBeTruthy();
			let res = entry.func(tp.args);
			if (spec.isAsync) res = await res;
			const validAt = spec.validAt ?? 1;
			const valid = Array.isArray(res) ? res[validAt] : undefined;
			expect(valid, `${spec.name} valid flag`).toBe(true);
		});
	}
});

describe('every column process transforms its data (correctness)', () => {
	for (const spec of PROCESS_SPECS) {
		it(`${spec.name} runs and returns an array`, () => {
			// Find the built process + its parent column, run the func directly.
			let parent, proc;
			for (const c of core.data) {
				const p = (c.processes ?? []).find((pp) => pp.name === spec.name);
				if (p) {
					parent = c;
					proc = p;
					break;
				}
			}
			expect(proc, `${spec.name} was built`).toBeTruthy();
			const entry = appConsts.processMap.get(spec.name);
			expect(entry?.func, `${spec.name} has a func`).toBeTruthy();
			// getData() on the parent runs the full chain (incl. this process).
			const result = parent.getData();
			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBeGreaterThan(0);
		});
	}
});
