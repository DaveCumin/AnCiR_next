// @ts-nocheck
// ROB-27: a registry-wide plot round trip. For EVERY plot type in the registry (so a new plot is
// covered without anyone remembering this file): build the plot with a representative wired
// series, save it (toJSON), load it (fromJSON), save it again, and require the two saves to be
// equal. A field a class writes but does not read back (or reads into a different place) shows
// up here as a difference, which is a session that changes every time it is saved and loaded.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadPlots } from '$test/plotRegistry.js';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';

const PLOT_TYPES = [...(await loadPlots()).keys()];

const N = 72;
const seq = (f) => Array.from({ length: N }, (_, i) => f(i));

function mkCol(name, values, type = 'number') {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

/** The saved form, as a session file holds it. */
const save = (plot) => JSON.parse(JSON.stringify(plot));

/**
 * The inner a plot is created with: one wired series in the shape its class stores (`column`
 * for single-column plots, `x`/`y` otherwise), or the Table's column list.
 */
function representativeInner(key, entry) {
	const t = mkCol(
		't',
		seq((i) => i)
	);
	const v = mkCol(
		'v',
		seq((i) => 50 + 30 * Math.cos((2 * Math.PI * i) / 24))
	);
	const w = mkCol(
		'w',
		seq((i) => 10 + (i % 7))
	);
	if (key === 'tableplot') return { columnRefs: [t, v], showCol: [true, true] };
	const inputs = entry.defaultInputs ?? [];
	if (inputs.length === 1 && inputs[0] === 'column') {
		return { data: [{ column: { refId: v } }, { column: { refId: w } }] };
	}
	return { data: [{ x: { refId: t }, y: { refId: v } }] };
}

let registry;
beforeAll(async () => {
	registry = await loadPlots();
	appConsts.plotMap = registry;
});
beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.tableProcesses = [];
});

describe('every plot type survives save, load, save unchanged', () => {
	it('the registry has the plot types this test expects to cover', () => {
		expect(registry.size).toBeGreaterThanOrEqual(14);
	});

	it.each(PLOT_TYPES)('%s', (key) => {
		const entry = registry.get(key);
		const plot = new Plot({ type: key, name: `${key} 1`, plot: representativeInner(key, entry) });
		core.plots.push(plot);
		const first = save(plot);
		// The series really is wired: a round trip of an empty plot proves little.
		if (key === 'tableplot') expect(first.plot.columnRefs).toHaveLength(2);
		else expect(first.plot.data?.length ?? 0, `${key}: no series was created`).toBeGreaterThan(0);

		const loaded = Plot.fromJSON(first);
		const second = save(loaded);
		expect(second).toEqual(first);
	});
});

// A round trip at the defaults cannot see a field whose loader falls back to the default: the
// Actogram read a series' `draw` with `if (dataIN?.draw)`, so a series the user hid came back
// visible after every save and load, and the default-valued round trip above passed. So change
// every scalar setting the save holds (flip a boolean, step a number, swap a hex colour), load
// it, and require the changed value back.
function leaves(o, path = '', out = []) {
	if (o == null || typeof o !== 'object') {
		out.push([path, o]);
		return out;
	}
	if (Array.isArray(o)) o.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
	else for (const k of Object.keys(o)) leaves(o[k], path ? `${path}.${k}` : k, out);
	return out;
}
const parts = (path) => path.match(/[^.[\]]+/g);
function setPath(o, path, v) {
	const ps = parts(path);
	let cur = o;
	for (const p of ps.slice(0, -1)) cur = cur[p];
	cur[ps.at(-1)] = v;
}
const getPath = (o, path) => parts(path).reduce((cur, p) => cur?.[p], o);

function changed(value) {
	if (typeof value === 'boolean') return !value;
	if (typeof value === 'number') return value + 1;
	if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) return '#123456';
	return undefined;
}

describe('every scalar setting a plot saves, it loads back', () => {
	it.each(PLOT_TYPES)('%s', (key) => {
		const plot = new Plot({
			type: key,
			name: `${key} 1`,
			plot: representativeInner(key, registry.get(key))
		});
		core.plots.push(plot);
		const lost = [];
		for (const [path, value] of leaves(save(plot).plot)) {
			if (/(^|\.)(refId|id)$/.test(path)) continue; // identities, not settings
			const next = changed(value);
			if (next === undefined) continue;
			const edited = save(plot);
			setPath(edited.plot, path, next);
			const back = getPath(save(Plot.fromJSON(edited)).plot, path);
			if (back !== next)
				lost.push(`${path}: saved ${JSON.stringify(next)}, loaded ${JSON.stringify(back)}`);
		}
		expect(lost, `${key} loses settings on load`).toEqual([]);
	});
});
