// Engine invariants, checked for EVERY registered table process and over generated sequences
// of engine calls, so a whole class of session-integrity bug fails here rather than one case.
//
// Generalises 2026-11-09 bugs 1 and 2 (engine.session-integrity.test.js pins the single cases):
//   1. imported column ids collided with analysis output ids, and later analyses silently read
//      the wrong column;
//   2. a second session wiped the first, and output names depended on earlier sessions.
//
// The invariants, after EVERY step of every sequence:
//   · every column id in the store is unique;
//   · every analysis input and plot input still resolves to the column it was wired to (same
//     name, same data), and every output id to the column it was created as;
// and per sequence:
//   · re-running every analysis gives the outputs it gave when it ran (nothing it reads moved);
//   · the export reloads through the app's own importJson keeping every column, analysis and
//     plot id, and every analysis and plot reads and writes the same data there;
//   · the same sequence in a fresh session exports byte-identically (bar the random GUIds).
import { beforeAll, describe, expect, it } from 'vitest';
import { AncirSession, ensureRegistry } from '../src/engine/session.js';
import { core, appConsts, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { seriesChannelRefs } from '$lib/core/seriesChannelRefs.js';
import {
	specOf,
	registeredTableProcesses,
	importSpecInputs,
	engineArgs,
	inputRefs,
	columnFingerprint,
	rng
} from './guardSupport.js';

beforeAll(async () => {
	await ensureRegistry();
}, 120000);

/**
 * A recorded engine build: the steps run, and what every wire pointed at when it was made.
 * `wires` entries: { what, id, fp } — `fp` the column's fingerprint at wiring time.
 */
class Build {
	constructor(id) {
		this.s = new AncirSession(id);
		this.wires = [];
		this.runs = []; // { name, tableProcessId, outputs: Map(key → data json) }
		this.n = 0;
	}
	wire(what, id) {
		this.wires.push({ what, id, fp: columnFingerprint(id) });
	}
	importPair(tag) {
		const t = Array.from({ length: 72 }, (_, i) => i * 0.5);
		const added = this.s.importColumns([
			{ name: `${tag}_t`, values: t },
			{ name: `${tag}_v`, values: t.map((h) => 10 + 3 * Math.cos((2 * Math.PI * (h - 3)) / 24)) }
		]);
		return added.map((a) => a.id);
	}
	async runTP(name, tag) {
		const spec = specOf(name);
		const ids = importSpecInputs(this.s, spec, tag);
		return this.runArgs(name, engineArgs(spec, ids));
	}
	async runArgs(name, args) {
		const res = await this.s.runTableProcess(name, args);
		expect(res.valid, `${name}: ${res.error}`).toBe(true);
		const tp = core.tableProcesses.find((t) => t.id === res.tableProcessId);
		for (const [field, id] of inputRefs(name, tp.args)) this.wire(`${name}.${field}`, id);
		for (const o of res.outputs) this.wire(`${name}.out.${o.key}`, o.columnId);
		this.runs.push({
			name,
			tableProcessId: res.tableProcessId,
			outputs: new Map(res.outputs.map((o) => [o.key, columnFingerprint(o.columnId).data]))
		});
		return res;
	}
	transform(colId) {
		// A column transform changes the column's data in place, so the wire is re-recorded.
		this.s.addColumnProcess(colId, 'Multiply', { value: 2 });
		for (const w of this.wires) if (w.id === colId) w.fp = columnFingerprint(colId);
		// Every analysis reading it now gives different outputs; re-run and re-record them.
		return this.refreshRuns();
	}
	async refreshRuns() {
		for (const r of this.runs) {
			const tp = core.tableProcesses.find((t) => t.id === r.tableProcessId);
			await appConsts.tableProcessMap.get(r.name).func(tp.args);
			for (const [key] of r.outputs) r.outputs.set(key, columnFingerprint(tp.args.out[key]).data);
			for (const w of this.wires)
				if (Object.values(tp.args.out).includes(w.id)) w.fp = columnFingerprint(w.id);
		}
	}
	plot(xId, yId) {
		const r = this.s.addPlot('scatterplot', { x: xId, y: yId });
		this.wire(`plot ${r.plotId}.x`, xId);
		this.wire(`plot ${r.plotId}.y`, yId);
		return r;
	}
}

/** The step invariants: unique ids; every recorded wire still points at its column. */
function assertInvariants(b, step) {
	const ids = core.data.map((c) => c.id);
	const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
	expect(dup, `${step}: duplicate column ids`).toEqual([]);
	for (const w of b.wires) {
		expect(columnFingerprint(w.id), `${step}: ${w.what} → column ${w.id}`).toEqual(w.fp);
	}
	// The live store agrees with the records: each analysis still wires what it was given.
	for (const tp of core.tableProcesses) {
		for (const [field, id] of inputRefs(tp.name, tp.args)) {
			expect(columnFingerprint(id), `${step}: ${tp.name}.${field} → ${id} exists`).not.toBeNull();
		}
	}
	for (const p of core.plots) {
		for (const series of p.plot?.data ?? []) {
			for (const { holder } of seriesChannelRefs(series)) {
				if (typeof holder.refId === 'number' && holder.refId >= 0) {
					expect(columnFingerprint(holder.refId), `${step}: plot ${p.id} ref`).not.toBeNull();
				}
			}
		}
	}
}

/** Re-run every analysis: the same outputs as when it ran. */
async function assertRerunsStable(b) {
	for (const r of b.runs) {
		const tp = core.tableProcesses.find((t) => t.id === r.tableProcessId);
		expect(tp, `${r.name} ${r.tableProcessId} still in the session`).toBeTruthy();
		await appConsts.tableProcessMap.get(r.name).func(tp.args);
		for (const [key, data] of r.outputs) {
			expect(columnFingerprint(tp.args.out[key])?.data, `${r.name}.${key} re-run`).toBe(data);
		}
	}
}

/**
 * The export with each table process's random GUId (a crypto UUID, by design: it names the
 * node across copies) replaced by its order of first appearance; everything else must match
 * byte for byte.
 */
function canonicalGUIds(text) {
	const seen = new Map();
	return text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (u) =>
		seen.has(u) ? seen.get(u) : (seen.set(u, `guid-${seen.size}`), `guid-${seen.size - 1}`)
	);
}

// Outputs whose VALUES are the input columns' names: after a reload a transformed input is the
// derived column `<name> → Multiply`, so the label changes while the numbers do not.
const NAME_VALUED_OUTPUTS = { DescribeData: ['variable'] };

/** What each plot series draws, as data (refs may legitimately move to a derived column). */
function plotSeriesData() {
	return core.plots.map((p) =>
		(p.plot?.data ?? []).map((series) =>
			seriesChannelRefs(series).map(({ holder }) => columnFingerprint(holder.refId)?.data ?? null)
		)
	);
}

/**
 * Export → the app's own importJson → the same session, as data. On load the app migrates a
 * column's inline transforms (what add_column_process writes) into a transform node and a
 * derived column, and repoints the column's readers to it (core/dataflowMigration.js), so ids
 * are compared for what the engine exported, and every analysis and plot is compared by the
 * data it reads and writes.
 */
async function assertReloads(b) {
	const exported = b.s.exportSessionObject();
	const plotsBefore = plotSeriesData();
	await importJson(structuredClone(exported));
	const again = JSON.parse(outputCoreAsJson());
	const ids = core.data.map((c) => c.id);
	expect(
		ids.filter((id, i) => ids.indexOf(id) !== i),
		'duplicate ids after reload'
	).toEqual([]);
	// Every exported column keeps its id and name.
	const byId = new Map(again.data.map((c) => [c.id, c.name]));
	for (const c of exported.data) expect(byId.get(c.id), `column ${c.id} after reload`).toBe(c.name);
	expect(again.tableProcesses.map((t) => [t.id, t.name])).toEqual(
		exported.tableProcesses.map((t) => [t.id, t.name])
	);
	expect(again.plots.map((p) => p.id)).toEqual(exported.plots.map((p) => p.id));
	// Every analysis, re-run in the loaded app, writes what the engine reported.
	for (const r of b.runs) {
		const tp = core.tableProcesses.find((t) => t.id === r.tableProcessId);
		await appConsts.tableProcessMap.get(r.name).func(tp.args);
		for (const [key, data] of r.outputs) {
			if (NAME_VALUED_OUTPUTS[r.name]?.includes(key)) continue;
			expect(columnFingerprint(tp.args.out[key])?.data, `reloaded ${r.name}.${key}`).toBe(data);
		}
	}
	expect(plotSeriesData(), 'plots draw the same data after reload').toEqual(plotsBefore);
	return exported;
}

// ---------------------------------------------------------------------------------------------

describe('every registered table process, run headless on its catalogue data', () => {
	it('runs valid with every column id unique and every wire on its column', async () => {
		const names = registeredTableProcesses();
		expect(names.length).toBeGreaterThan(30);
		const b = new Build('every-tp');
		for (const name of names) {
			await b.runTP(name, name);
			assertInvariants(b, `after ${name}`);
		}
		// Data imported after every analysis is fresh, and an analysis on it reads it.
		const [t, v] = b.importPair('late');
		b.wire('late t', t);
		b.wire('late v', v);
		assertInvariants(b, 'after a late import');
		await b.runArgs('Cosinor', { xIN: t, yIN: [v], useFixedPeriod: true, fixedPeriod: 24 });
		assertInvariants(b, 'after a late Cosinor');
		await assertRerunsStable(b);
		await assertReloads(b);
	}, 120000);
});

// The ops a generated sequence draws from. Each returns a description for failure messages.
const OPS = {
	import: (b, k) => {
		const [t, v] = b.importPair(`imp${k}`);
		b.wire(`imp${k} t`, t);
		b.wire(`imp${k} v`, v);
		return 'import';
	},
	analysis: async (b, k, pick) => {
		const name = pick(registeredTableProcesses());
		await b.runTP(name, `a${k}`);
		return `analysis ${name}`;
	},
	// An analysis of an earlier analysis's outputs (or of imported data): a chain.
	chain: async (b, k, pick) => {
		const numeric = core.data.filter((c) => {
			if (c.type !== 'number') return false;
			const d = columnFingerprint(c.id).data;
			return d.startsWith('[') && JSON.parse(d).filter((x) => typeof x === 'number').length > 30;
		});
		if (numeric.length < 2) return OPS.import(b, k);
		const x = pick(numeric);
		const y = pick(numeric.filter((c) => c !== x && c.getData().length === x.getData().length));
		if (!y) return OPS.import(b, k);
		const name = pick(['BinnedData', 'SmoothedData', 'TrendFit', 'DescribeData']);
		const args =
			name === 'DescribeData'
				? { yIN: [x.id, y.id] }
				: { xIN: x.id, yIN: [y.id], ...(name === 'BinnedData' ? { binSize: 2 } : {}) };
		await b.runArgs(name, args);
		return `chain ${name}(${x.name}, ${y.name})`;
	},
	transform: async (b, k, pick) => {
		const imported = core.data.filter((c) => /^imp\d+_v$/.test(c.name));
		if (!imported.length) return OPS.import(b, k);
		const col = pick(imported);
		await b.transform(col.id);
		return `transform ${col.name}`;
	},
	plot: (b, k, pick) => {
		const pairs = core.data.filter((c) => /^imp\d+_t$/.test(c.name));
		if (!pairs.length) return OPS.import(b, k);
		const t = pick(pairs);
		const v = core.data.find((c) => c.name === t.name.replace(/_t$/, '_v'));
		b.plot(t.id, v.id);
		return `plot ${t.name}`;
	}
};

async function runSequence(seed, steps, id) {
	const rand = rng(seed);
	const pick = (list) => list[Math.floor(rand() * list.length)];
	const b = new Build(id);
	const opNames = Object.keys(OPS);
	const log = [];
	for (let k = 0; k < steps; k++) {
		const op = pick(opNames);
		log.push(await OPS[op](b, k, pick));
		assertInvariants(b, `seed ${seed} step ${k} (${log.join(' → ')})`);
	}
	return { b, log };
}

describe('generated sequences of import / analysis / chain / transform / plot', () => {
	for (const seed of [1, 2, 3, 4, 5, 6]) {
		it(`seed ${seed}: invariants hold after every step; re-runs, reload and rebuild agree`, async () => {
			const { b, log } = await runSequence(seed, 9, `seq-${seed}`);
			await assertRerunsStable(b);
			const first = b.s.exportSession();

			// The same sequence in a fresh session exports byte-identically (no counter or
			// state carried from the build before it).
			const { b: b2, log: log2 } = await runSequence(seed, 9, `seq-${seed}-again`);
			expect(log2).toEqual(log);
			expect(canonicalGUIds(b2.s.exportSession())).toBe(canonicalGUIds(first));

			// And reloads through the app with the same ids.
			await assertReloads(b2);
		}, 120000);
	}
});

describe('the app continues a reloaded engine session without reusing an id', () => {
	it('a column the app makes after loading takes a fresh id', async () => {
		const b = new Build('reload-continue');
		const [t, v] = b.importPair('r');
		await b.runArgs('Cosinor', { xIN: t, yIN: [v], useFixedPeriod: true, fixedPeriod: 24 });
		const exported = await assertReloads(b);
		const before = new Set(exported.data.map((c) => c.id));
		const { Column } = await import('$lib/core/Column.svelte');
		const fresh = new Column({ type: 'number' });
		expect(before.has(fresh.id), `new column id ${fresh.id} is already taken`).toBe(false);
	});
});
