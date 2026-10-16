// @ts-nocheck
// ROB-22: fields this version does not know survive a load and a save, at every level, and a
// field a migration or a loader consumed never comes back. See unknownFields.js for the rule
// (unknown = never read by the loader). The registry-wide version (every plot and node type)
// is unknownFields.registry.test.js.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { core, appConsts, outputCoreAsJson } from './core.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import {
	trackReads,
	keepUnknownFields,
	mergeUnknown,
	loadKeepingUnknown,
	unknownFieldsOf
} from './unknownFields.js';
import { applyOp, settleGraphMutation } from './operations.js';
import { history } from './opHistory.svelte.js';
import { Plot, removePlotsCascade } from './Plot.svelte';
import { RETIRED_PLOT_FIELDS } from './facetMigration.js';
import { deleteTableProcessCascade } from './TableProcess.svelte';
import { recordGraphMutation } from './operations.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const readJson = (...p) => JSON.parse(readFileSync(join(root, ...p), 'utf8'));
const demo = (name) => readJson('static/sessions/demos', name);
const fixture = (name) => readJson('src/test/fixtures', name);

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	history.init();
}, 120000);

beforeEach(() => history.clear());

/** Load a session, save it, and return the saved file parsed. */
async function loadAndSave(json) {
	await importJson(json);
	return JSON.parse(outputCoreAsJson());
}

describe('trackReads, keepUnknownFields', () => {
	it('lists only the fields the loader never read, deep-copied', () => {
		const json = { a: 1, b: { deep: [1] }, c: 3, d: undefined };
		const t = trackReads(json);
		void t.view.a;
		void ('c' in t.view);
		const unread = t.unread();
		expect(unread).toEqual([['b', { deep: [1] }]]);
		unread[0][1].deep.push(2);
		expect(json.b.deep).toEqual([1]);
	});

	it('a loader that copies the whole object reads every field, so nothing is kept', () => {
		const t = trackReads({ a: 1, b: 2 });
		void { ...t.view };
		expect(t.unread()).toEqual([]);
	});

	it('tracks the elements of a named array separately', () => {
		const t = trackReads({ data: [{ x: 1, extra: 'e' }, { x: 2 }] }, { arrays: ['data'] });
		t.view.data.map((d) => d.x);
		expect(t.elements('data').map((e) => e.unread())).toEqual([[['extra', 'e']], []]);
	});

	it('a kept field never overrides a field the save writes', () => {
		expect(
			mergeUnknown({ a: 'now' }, [
				['a', 'stale'],
				['b', 'kept']
			])
		).toEqual({
			a: 'now',
			b: 'kept'
		});
		// Even a field the save writes as undefined is the save's.
		expect(mergeUnknown({ a: undefined }, [['a', 'stale']])).toEqual({ a: undefined });
	});

	it('a class instance writes its kept fields through its own toJSON', () => {
		class Thing {
			v = 1;
			toJSON() {
				return { v: this.v };
			}
		}
		const thing = loadKeepingUnknown({ v: 5, future: { n: 1 } }, (j) => {
			const t = new Thing();
			t.v = j.v;
			return t;
		});
		expect(JSON.parse(JSON.stringify(thing))).toEqual({ v: 5, future: { n: 1 } });
		expect(unknownFieldsOf(thing)).toEqual({ future: { n: 1 } });
		// The class's own fields still decide: a later write wins.
		thing.v = 7;
		expect(thing.toJSON()).toEqual({ v: 7, future: { n: 1 } });
	});

	it('a plain object gets its kept fields as its own, never over one it has', () => {
		const obj = keepUnknownFields({ name: 'G' }, [
			['name', 'stale'],
			['future', 1]
		]);
		expect(obj).toEqual({ name: 'G', future: 1 });
	});
});

/** A real demo session with an unknown field at every level the session has. */
function injectedCosinorSession() {
	const j = demo('demo-tp-cosinor.json');
	const plot = j.plots.find((p) => p.type === 'scatterplot');
	const colId = j.data[0].id;
	j.futureTop = { a: 1 };
	plot.futurePlot = 'p';
	plot.plot.futureInner = 'i';
	plot.plot.data[0].futureSeries = 's';
	j.tableProcesses[0].futureTp = 't';
	j.tableProcesses[0].args.futureArg = 'a';
	j.data[0].futureCol = 'c';
	j.groups = [{ id: 'group_1', name: 'G', sourceColumnIds: [], futureGroup: 'g' }];
	j.composites = [
		{
			id: 'composite_1',
			name: 'C',
			memberIds: [],
			interface: { inputs: [], outputs: [] },
			futureComp: 'k'
		}
	];
	j.notes = [{ id: 'note_1', text: 'n', futureNote: 'n' }];
	j.orphanProcesses = [{ id: 900, name: 'add', args: { value: 1 }, futureProc: 'o' }];
	return { j, plotId: plot.id, tpId: j.tableProcesses[0].id, colId };
}

function unknownsIn(out, { plotId, tpId, colId }) {
	const plot = out.plots.find((p) => p.id === plotId);
	const tp = out.tableProcesses.find((t) => t.id === tpId);
	return {
		top: out.futureTop,
		plot: plot?.futurePlot,
		inner: plot?.plot?.futureInner,
		series: plot?.plot?.data?.[0]?.futureSeries,
		tp: tp?.futureTp,
		tpArg: tp?.args?.futureArg,
		col: out.data.find((c) => c.id === colId)?.futureCol,
		group: out.groups[0]?.futureGroup,
		comp: out.composites[0]?.futureComp,
		note: out.notes[0]?.futureNote,
		proc: out.orphanProcesses.find((p) => p.id === 900)?.futureProc
	};
}

const ALL_KEPT = {
	top: { a: 1 },
	plot: 'p',
	inner: 'i',
	series: 's',
	tp: 't',
	tpArg: 'a',
	col: 'c',
	group: 'g',
	comp: 'k',
	note: 'n',
	proc: 'o'
};

describe('a real session keeps unknown fields at every level through load and save', () => {
	it('every level, and again after a second load and save', async () => {
		const s = injectedCosinorSession();
		const first = await loadAndSave(s.j);
		expect(unknownsIn(first, s)).toEqual(ALL_KEPT);
		const second = await loadAndSave(first);
		expect(unknownsIn(second, s)).toEqual(ALL_KEPT);
	});

	it('a session without unknown fields saves exactly as before (no extra keys)', async () => {
		const j = demo('demo-tp-cosinor.json');
		const out = await loadAndSave(JSON.parse(JSON.stringify(j)));
		// `unrestoredPlots` is written by every load (an empty list here); nothing else is new.
		expect(
			Object.keys(out)
				.filter((k) => k !== 'unrestoredPlots')
				.sort()
		).toEqual(Object.keys(j).sort());
		expect(Object.keys(out.plots[0]).sort()).toEqual(Object.keys(j.plots[0]).sort());
		expect(Object.keys(out.plots[0].plot).sort()).toEqual(Object.keys(j.plots[0].plot).sort());
	});

	it('the plot settings and series keep theirs through an undoable plot edit and its undo', async () => {
		const s = injectedCosinorSession();
		await importJson(s.j);
		const plot = core.plots.find((p) => p.id === s.plotId);
		const inner = JSON.parse(JSON.stringify(plot.plot));
		inner.xAxis.label = 'Edited';
		applyOp({ kind: 'setPlotInner', id: plot.id, inner });
		let out = JSON.parse(outputCoreAsJson());
		expect(unknownsIn(out, s)).toMatchObject({ inner: 'i', series: 's' });
		history.undo();
		out = JSON.parse(outputCoreAsJson());
		expect(out.plots.find((p) => p.id === s.plotId).plot.xAxis.label).not.toBe('Edited');
		expect(unknownsIn(out, s)).toMatchObject({ inner: 'i', series: 's' });
	});

	it('a deleted plot and analysis come back with their unknown fields on undo', async () => {
		const s = injectedCosinorSession();
		await importJson(s.j);
		recordGraphMutation(() => removePlotsCascade([s.plotId]));
		settleGraphMutation();
		recordGraphMutation(() =>
			deleteTableProcessCascade(core.tableProcesses.find((t) => t.id === s.tpId))
		);
		settleGraphMutation();
		history.undo();
		history.undo();
		const out = JSON.parse(outputCoreAsJson());
		expect(unknownsIn(out, s)).toMatchObject({
			plot: 'p',
			inner: 'i',
			series: 's',
			tp: 't',
			tpArg: 'a'
		});
	});

	it('a new session drops the previous session top-level unknown fields', async () => {
		await importJson(injectedCosinorSession().j);
		const out = await loadAndSave(demo('demo-tp-cosinor.json'));
		expect(out.futureTop).toBeUndefined();
	});
});

describe('a field a loader or a migration consumed does not come back', () => {
	it('legacy tables[] (now groups) and a Scatterplot nightBands (now overlays)', async () => {
		const j = readJson('test', 'testJSON.json');
		expect(j.tables.length).toBeGreaterThan(0);
		const scatter = j.plots.find((p) => p.type === 'scatterplot');
		scatter.plot.nightBands = [{ name: 'Night', mode: 'repeating' }];
		const out = await loadAndSave(j);
		expect(out.tables).toBeUndefined();
		const saved = out.plots.find((p) => p.id === scatter.id);
		expect(saved.plot.nightBands).toBeUndefined();
		expect(saved.plot.overlays.length).toBeGreaterThan(0);
	});

	it('the v72.1 colour/shape/dash maps (now seriesAppearance)', async () => {
		const j = demo('demo-tp-cosinor.json');
		j.seriesColours = { [j.data[0].id]: '#ff0000' };
		j.seriesShapes = { [j.data[0].id]: 'square' };
		j.seriesDashes = { [j.data[0].id]: 'dashed' };
		const out = await loadAndSave(j);
		expect(out.seriesColours).toBeUndefined();
		expect(out.seriesShapes).toBeUndefined();
		expect(out.seriesDashes).toBeUndefined();
	});

	it('a plot `plotid`, a Column `provenance`, a pre-xAxis Scatterplot `xlabel`', async () => {
		const j = demo('demo-tp-cosinor.json');
		const scatter = j.plots.find((p) => p.type === 'scatterplot');
		scatter.plotid = scatter.id;
		delete scatter.plot.xAxis;
		scatter.plot.xlabel = 'Old x label';
		j.data[0].provenance = 'refers to something';
		const out = await loadAndSave(j);
		const saved = out.plots.find((p) => p.id === scatter.id);
		expect(saved.plotid).toBeUndefined();
		expect(saved.plot.xlabel).toBeUndefined();
		expect(saved.plot.xAxis.label).toBe('Old x label');
		expect(out.data.find((c) => c.id === j.data[0].id).provenance).toBeUndefined();
	});

	it('Data View fields (the plot is now a Table)', async () => {
		const j = fixture('dataview-legacy-handmade.json');
		const out = await loadAndSave(j);
		const text = JSON.stringify(out);
		expect(text).not.toContain('"dataview"');
		for (const key of ['sourceType', 'staticHeaders', 'staticRows']) {
			for (const p of out.plots) expect(p.plot?.[key], `${p.id}.${key}`).toBeUndefined();
		}
	});

	it('facet child plots and the fields that tied them to their generator', async () => {
		const [parentKey] = RETIRED_PLOT_FIELDS;
		const j = fixture('facet-eda-children.json');
		expect(j.plots.some((p) => p[parentKey] != null)).toBe(true);
		const out = await loadAndSave(j);
		for (const key of RETIRED_PLOT_FIELDS) expect(out.plots.some((p) => key in p)).toBe(false);
		expect(out.plots.map((p) => p.id)).not.toContain(13);
	});

	it('a retired facet field reaching Plot.fromJSON outside a session load is dropped', () => {
		const json = { id: 5, name: 'Dist', type: 'histogram', plot: { data: [] } };
		for (const key of RETIRED_PLOT_FIELDS) json[key] = 'stray';
		const saved = JSON.parse(JSON.stringify(Plot.fromJSON(json)));
		for (const key of RETIRED_PLOT_FIELDS) expect(saved).not.toHaveProperty(key);
	});
});

// A live plot's inner must be rebuilt through plotInnerFromJSON, or that route drops the fields
// this version does not know (an undo, a recorded plot edit). The only direct calls allowed are
// the helper itself, a plot built in code, the facet panels (derived views, never saved) and the
// migration's defaults probe.
describe('every live plot-inner load goes through plotInnerFromJSON', () => {
	const ALLOWED = {
		'src/lib/core/Plot.svelte': 3,
		'src/lib/core/facetPanels.svelte.js': 2,
		'src/lib/core/facetMigrationDefaults.js': 1
	};
	it('no other file calls a plot type data.fromJSON directly', async () => {
		const { readdirSync, statSync } = await import('node:fs');
		const found = {};
		const walk = (dir) => {
			for (const name of readdirSync(dir)) {
				const p = join(dir, name);
				if (statSync(p).isDirectory()) walk(p);
				else if (/\.(js|svelte)$/.test(name) && !/\.test\.|conflicted/.test(name)) {
					const n = (readFileSync(p, 'utf8').match(/\bdata\.fromJSON\(/g) ?? []).length;
					if (n) found[p.slice(root.length + 1)] = n;
				}
			}
		};
		walk(join(root, 'src'));
		expect(found).toEqual(ALLOWED);
	});
});
