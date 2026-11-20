// @ts-nocheck
// Port descriptions on the LIVE canvas graph. portDescriptions.test.js guards the manifest
// (static/nodes.json); this guard builds one of every registered node from the node catalogue
// (_demos/nodeCatalog.js, the same source allNodesCoverage.test.js uses), plus a group, a
// loose data column, a column set and a collapsed composite, and asks describeNodePort for
// every port the canvas cards render, by the names the cards use (x1/ys1, enc<id>_colour,
// col_<id>, out_<id>, composite interface ids). A port that renders without a description
// fails here, even when the manifest is complete.
import { describe, it, expect, beforeAll } from 'vitest';
import { core, appConsts, getProcessNodeGraph } from '$lib/core/core.svelte.js';
import { clearProcessNodeGraphCache } from '$lib/core/ProcessNode.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { computeInterface } from '$lib/core/composite.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { buildAllNodes } from '$lib/_demos/nodeCatalog.js';
import { describeNodePort, portEnv } from './portDescriptions.js';

const env = portEnv(getColumnById);
const ok = (d) => typeof d === 'string' && d.trim().length > 0;

/** Every port a card renders for `node`, as [dir, port, key?] (the cards' own enumeration). */
function renderedPorts(node) {
	const out = [];
	for (const p of node.ports?.inputs ?? []) out.push(['in', p]);
	if (node.type === 'tableprocess') {
		// TableProcessNode: one row per output column (keyed by its args.out key), plus the
		// bundle dots (a column set's `set`), which are not columns.
		for (const o of node.outputColumns ?? []) {
			out.push(['out', { name: o.port ?? `col_${o.colId}`, metric: o.metric }, o.key]);
		}
		for (const p of node.ports?.outputs ?? []) {
			if (p.artifactKind && p.artifactKind !== 'column') out.push(['out', p, p.name]);
		}
	} else {
		for (const p of node.ports?.outputs ?? []) out.push(['out', p]);
	}
	return out;
}

let graph;
let composite;

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.composites = [];
	core.notes = [];
	core.orphanProcesses = [];
	core.storedValues = {};
	core.rawData = new Map();
	clearProcessNodeGraphCache();
	const built = buildAllNodes();

	// A group absorbing two of the catalogue's columns (GroupNode: one col_<id> port each).
	const [g1, g2] = built.columnIds.slice(0, 2);
	core.groups.push({ id: 'group_live', name: 'Live group', sourceColumnIds: [g1, g2] });

	// A collapsed composite of a fit node and the plot it feeds, so its interface carries
	// table-process inputs, outputs and plot ports.
	clearProcessNodeGraphCache();
	const pre = getProcessNodeGraph();
	const cosinor = pre.nodes.find((n) => n.type === 'tableprocess' && n.tpName === 'Cosinor');
	const members = [cosinor.id];
	composite = {
		id: 'composite_live',
		name: 'Live composite',
		memberIds: members,
		collapsed: true,
		interface: computeInterface(members, pre.rawConnections ?? pre.connections)
	};
	// Something downstream of the fit, so the composite has an output port too.
	const fitOut = cosinor.outputColumns?.[0];
	if (fitOut) {
		composite.interface.outputs.push({
			id: `out:${cosinor.id}|${fitOut.port}`,
			name: fitOut.port,
			member: cosinor.id,
			port: fitOut.port
		});
	}
	core.composites.push(composite);
	clearProcessNodeGraphCache();
	graph = getProcessNodeGraph();
}, 120_000);

describe('guard: every port on every canvas node has a description', () => {
	it('the graph covers every kind of card', () => {
		const types = new Set(graph.nodes.map((n) => n.type));
		for (const t of ['tableprocess', 'process', 'plot', 'group', 'data', 'composite']) {
			expect(types.has(t), t).toBe(true);
		}
	});

	it('no rendered port is left undescribed', () => {
		const missing = [];
		let count = 0;
		for (const node of graph.nodes) {
			if (node.type === 'note') continue;
			for (const [dir, port, key] of renderedPorts(node)) {
				count++;
				const d = describeNodePort(node, port, dir, key ? { ...env, key } : env);
				if (!ok(d)) {
					const kind = node.tpName ?? node.processName ?? node.plotObj?.type ?? node.type;
					missing.push(`${kind} ${dir} ${port.name}${key ? ` (${key})` : ''}`);
				}
			}
		}
		expect(missing).toEqual([]);
		expect(count).toBeGreaterThan(200);
	});

	it('a composite port says what its member port expects, not only that it passes through', () => {
		const node = graph.nodes.find((n) => n.id === 'composite_live');
		expect(node, 'the composite is on the canvas').toBeTruthy();
		const inPort = node.ports.inputs.find((p) => p.memberPort === 'xIN');
		expect(describeNodePort(node, inPort, 'in', env)).toMatch(/^One time column/);
		// Named as its member's card names it (x), not by the stored port name (xIN).
		expect(inPort.display).toBe('x');
		const outPort = node.ports.outputs[0];
		expect(describeNodePort(node, outPort, 'out', env)).not.toMatch(/inside this composite/);
	});
});
