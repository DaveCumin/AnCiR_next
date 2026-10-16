// @ts-nocheck
// ROB-22, registry-wide: for EVERY plot type and EVERY node type (one of each, built by the node
// catalog, so a new plot or node is covered without anyone remembering this file), a field this
// version does not know survives a session load and save at every level: the plot, its inner
// settings, each series, each analysis node and its args, each column, each column process.
// And no loader keeps the read-tracking view it was given (unknownFields.trackReads), which would
// leave a live object wrapped around the saved file.
import { describe, it, expect, beforeAll } from 'vitest';
import { core, appConsts, outputCoreAsJson } from './core.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { buildAllNodes, PLOT_SPECS, TP_SPECS } from '$lib/_demos/nodeCatalog.js';
import { isTrackingView } from './unknownFields.js';

let saved; // the catalog session after one load and save (its canonical saved form)
let injected; // the same with an unknown field at every level
let resaved; // `injected` loaded and saved

const save = () => JSON.parse(outputCoreAsJson());

function inject(json) {
	const j = JSON.parse(JSON.stringify(json));
	j.zzTop = { level: 'top' };
	for (const p of j.plots) {
		p.zzPlot = `plot ${p.id}`;
		p.plot.zzInner = `inner ${p.id}`;
		(p.plot.data ?? []).forEach((s, i) => (s.zzSeries = `series ${p.id}.${i}`));
	}
	for (const tp of j.tableProcesses) {
		tp.zzTp = `tp ${tp.id}`;
		tp.args.zzArg = `arg ${tp.id}`;
	}
	for (const c of j.data) {
		c.zzCol = `col ${c.id}`;
		for (const p of c.processes ?? []) p.zzProc = `proc ${p.id}`;
	}
	for (const p of j.orphanProcesses ?? []) {
		p.zzProc = `proc ${p.id}`;
		p.args.zzArg = `arg ${p.id}`;
	}
	return j;
}

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.orphanProcesses = [];
	core.rawData = new Map();
	buildAllNodes();
	await importJson(save());
	saved = save();
	injected = inject(saved);
	await importJson(injected);
	resaved = save();
}, 120000);

describe('the catalog session covers every type', () => {
	it('one plot of every plot type, one node of every analysis type', () => {
		expect(new Set(saved.plots.map((p) => p.type))).toEqual(new Set(PLOT_SPECS.map((s) => s.type)));
		expect(new Set(saved.tableProcesses.map((t) => t.name))).toEqual(
			new Set(TP_SPECS.map((s) => s.name))
		);
		expect(saved.orphanProcesses.length + saved.data.flatMap((c) => c.processes).length).toBe(
			appConsts.processMap.size
		);
	});
});

describe('every level keeps an unknown field through load and save', () => {
	it('the top level', () => {
		expect(resaved.zzTop).toEqual({ level: 'top' });
	});

	it.each(PLOT_SPECS.map((s) => s.type))('plot %s: wrapper, settings and every series', (type) => {
		const before = injected.plots.find((p) => p.type === type);
		const after = resaved.plots.find((p) => p.id === before.id);
		expect(after.zzPlot).toBe(before.zzPlot);
		expect(after.plot.zzInner).toBe(before.plot.zzInner);
		expect((after.plot.data ?? []).map((s) => s.zzSeries)).toEqual(
			(before.plot.data ?? []).map((s) => s.zzSeries)
		);
	});

	it.each(TP_SPECS.map((s) => s.name))('analysis %s: the node and its args', (name) => {
		const before = injected.tableProcesses.find((t) => t.name === name);
		const after = resaved.tableProcesses.find((t) => t.id === before.id);
		expect(after.zzTp).toBe(before.zzTp);
		expect(after.args.zzArg).toBe(before.args.zzArg);
	});

	it('every column process: the node and its args', () => {
		const procs = (j) => [...(j.orphanProcesses ?? []), ...j.data.flatMap((c) => c.processes)];
		const want = procs(injected).map((p) => [p.id, p.zzProc, p.args.zzArg ?? null]);
		expect(want.length).toBe(appConsts.processMap.size);
		const got = procs(resaved).map((p) => [p.id, p.zzProc, p.args.zzArg ?? null]);
		expect(got).toEqual(want);
	});

	it('every column', () => {
		const want = injected.data.map((c) => [c.id, c.zzCol]);
		expect(resaved.data.map((c) => [c.id, c.zzCol])).toEqual(want);
	});

	it('the kept fields are written once each, in the same saved form, on a second round', async () => {
		await importJson(resaved);
		// appState carries load counters (viewportEpoch, settleLayoutRequest) that every load bumps.
		const withoutAppState = (j) => ({ ...j, appState: undefined });
		expect(withoutAppState(save())).toEqual(withoutAppState(resaved));
	});
});

describe('no loader keeps the read-tracking view', () => {
	it('nothing reachable from the loaded session is a tracking view', async () => {
		await importJson(injected);
		const seen = new Set();
		const found = [];
		const walk = (v, path, depth) => {
			if (v == null || typeof v !== 'object' || depth > 8 || seen.has(v)) return;
			seen.add(v);
			if (isTrackingView(v)) {
				found.push(path);
				return;
			}
			// A class keeps its $state fields behind prototype accessors, so walk those too.
			const keys = new Set(Object.keys(v));
			for (let proto = Object.getPrototypeOf(v); proto && proto !== Object.prototype; ) {
				for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(proto)))
					if (d.get) keys.add(k);
				proto = Object.getPrototypeOf(proto);
			}
			for (const k of keys) {
				let child;
				try {
					child = v[k];
				} catch {
					continue;
				}
				walk(child, `${path}.${k}`, depth + 1);
			}
		};
		for (const key of ['data', 'plots', 'tableProcesses', 'orphanProcesses', 'groups', 'notes'])
			walk(core[key], key, 0);
		for (const p of core.plots) walk(p.plot, `plot ${p.id}`, 0);
		expect(found).toEqual([]);
	});
});
