// Shared helpers for the registry-wide guard tests (guard.*.test.js). These tests run in BOTH
// suites: mcp's own vitest (test/**) and the app's root vitest, whose include lists
// `mcp/test/guard.*.test.js` so the release gate (scripts/releaseGate.mjs) runs them too.
//
// The per-node input data and args come from the app's one catalogue of "a valid instance of
// every node" (src/lib/_demos/nodeCatalog.js TP_SPECS), which allNodesCoverage.test.js keeps
// complete: every registered table process has a spec there.
import { core, appConsts } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { TP_SPECS } from '$lib/_demos/nodeCatalog.js';

export const resolveData = (d) => (typeof d === 'function' ? d() : d);

/** The catalogue spec of a registered table process (throws if the catalogue lacks it). */
export function specOf(name) {
	const spec = TP_SPECS.find((s) => s.name === name);
	if (!spec) throw new Error(`nodeCatalog TP_SPECS has no spec for registered node "${name}"`);
	return spec;
}

/** Every registered table-process name, from the registry (not a hand list). */
export const registeredTableProcesses = () => [...appConsts.tableProcessMap.keys()].sort();

/** Stored values a StoredValueGroup spec reads (as buildAllNodes seeds them). */
export function seedStoredValues() {
	core.storedValues.demoSV1 = { staticValue: 12, source: 'manual' };
	core.storedValues.demoSV2 = { staticValue: 34, source: 'manual' };
}

/**
 * Import a spec's input columns into an engine session, named uniquely by `tag`.
 * @returns {number[]} the imported column ids, in spec order
 */
export function importSpecInputs(session, spec, tag) {
	if (spec.needsStoredValues) seedStoredValues();
	if (!spec.inputs.length) return [];
	const added = session.importColumns(
		spec.inputs.map((inp, i) => ({
			name: `${tag}_${inp.name ?? 'in'}${i}`,
			type: inp.type,
			values: resolveData(inp.data)
		}))
	);
	return added.map((a) => a.id);
}

/** A spec's args for the engine: its own args, with `out` left for the engine to seed. */
export function engineArgs(spec, ids) {
	const a = spec.args(ids);
	delete a.out;
	delete a.preProcesses;
	return a;
}

/** The input column ids a table process's args wire, per field (registry columnIdFields). */
export function inputRefs(name, args) {
	const cif = appConsts.tableProcessMap.get(name)?.columnIdFields ?? {};
	const refs = [];
	for (const f of cif.scalar ?? []) {
		const v = args[f];
		if (typeof v === 'number' && v >= 0) refs.push([f, v]);
	}
	for (const f of cif.array ?? []) {
		const list = Array.isArray(args[f]) ? args[f] : args[f] != null ? [args[f]] : [];
		for (const v of list) if (typeof v === 'number' && v >= 0) refs.push([f, v]);
	}
	return refs;
}

/** name + data of a column now, for "still the same column" checks. */
export function columnFingerprint(id) {
	const c = getColumnById(id);
	if (!c) return null;
	let data;
	try {
		data = c.getData() ?? [];
	} catch (e) {
		data = `threw: ${e?.message}`;
	}
	return { name: c.name, type: c.type, data: JSON.stringify(data) };
}

/** A small deterministic PRNG (mulberry32), so generated sequences are reproducible. */
export function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
