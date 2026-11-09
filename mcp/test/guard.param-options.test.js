// Option coverage for EVERY node: each enum-like parameter (a select in the node's editor, or a
// string-valued default) either has legal values the engine can read from the node
// (src/engine/paramOptions.js) and so refuses a value the node does not offer, or is on the
// commented allowlist below. Then, for every checkable param of every node, an invalid value is
// refused by run_table_process / add_column_process rather than running to no output.
//
// Generalises 2026-11-09 bug 4 (`analysis: "Periodogram"` ran to no outputs; pinned in
// engine.session-integrity.test.js): a new select the reader cannot follow, or a new enum param
// edited by a custom control, fails here until it is made checkable or listed with a reason.
import { beforeAll, describe, expect, it } from 'vitest';
import { AncirSession, ensureRegistry } from '../src/engine/session.js';
import { selectOptionsOf, selectOptionsFromSource } from '../src/engine/paramOptions.js';
import { appConsts } from '$lib/core/core.svelte.js';
import { specOf, importSpecInputs, engineArgs } from './guardSupport.js';

beforeAll(async () => {
	await ensureRegistry();
}, 120000);

// Params that are deliberately NOT checked, each with why. `kind:Node.param`.
const UNCHECKED = {
	// Bookkeeping set by the app (the collected-mode family name), never by a caller.
	'*.collectedType': 'internal bookkeeping, not a user choice',
	// Free text.
	'tableProcess:ColumnSet.pattern': 'free-text name/label filter',
	// Phase reference: "start", or a clock time / column-derived reference the
	// PhaseReferenceSelect control builds; open-ended, resolved by utils/phaseReference.js.
	'*.phaseReference': 'open-ended (start or a clock reference), set by PhaseReferenceSelect',
	// Output x mode: set by OutputXControl (components/inputs), whose modes are code constants,
	// not markup the reader can follow.
	'*.outputXMode': 'set by the OutputXControl component, not a select in the node',
	// The permutation statistic on nodes whose permutation panel is a shared component
	// (FitFunction and TrendFit have a plain select, so they are checked).
	'tableProcess:Cosinor.permutationStatistic': 'set by the shared permutation component',
	'tableProcess:DoubleLogistic.permutationStatistic': 'set by the shared permutation component',
	'tableProcess:RectangularWave.permutationStatistic': 'set by the shared permutation component',
	// Numeric selects (alpha levels, a column id): numbers are not string-checked.
	'tableProcess:Cosinor.alpha': 'numeric select',
	'tableProcess:Sort.sortOnId': 'a column reference (resolved and checked as a column)'
};

const unwrap = (v) => (v && typeof v === 'object' && 'val' in v ? v.val : v);

function allowlisted(kind, name, param) {
	return UNCHECKED[`${kind}:${name}.${param}`] ?? UNCHECKED[`*.${param}`] ?? null;
}

/** Every enum-like param of every node: [kind, name, param, options|null, default]. */
function enumParams() {
	const rows = [];
	for (const [kind, map] of [
		['tableProcess', appConsts.tableProcessMap],
		['process', appConsts.processMap]
	]) {
		for (const [name, entry] of map) {
			const opts = selectOptionsOf(kind, name);
			const defaults = entry.defaults ?? new Map();
			const params = new Set([
				...opts.keys(),
				...[...defaults].filter(([, v]) => typeof unwrap(v) === 'string').map(([k]) => k)
			]);
			for (const param of params) {
				rows.push([kind, name, param, opts.get(param) ?? null, unwrap(defaults.get(param))]);
			}
		}
	}
	return rows;
}

/** Checked by assertSelectOptions: readable string options on a string (or unset) default. */
const checkable = (options, dflt) =>
	Array.isArray(options) && options.length > 0 && (dflt == null || typeof dflt === 'string');

describe('every enum-like node param is checkable or allowlisted', () => {
	it('has legal values the engine reads, or a reason on the allowlist', () => {
		const rows = enumParams();
		expect(rows.length).toBeGreaterThan(40);
		const unexplained = rows
			.filter(
				([kind, name, param, options, d]) =>
					!checkable(options, d) && !allowlisted(kind, name, param)
			)
			.map(([kind, name, param]) => `${kind}:${name}.${param}`);
		expect(unexplained).toEqual([]);
	});

	it('every allowlist entry is still needed', () => {
		const rows = enumParams();
		const stale = Object.keys(UNCHECKED).filter((key) => {
			const hits = rows.filter(
				([kind, name, param]) => key === `${kind}:${name}.${param}` || key === `*.${param}`
			);
			return hits.length === 0 || hits.every(([, , , o, d]) => checkable(o, d));
		});
		expect(stale).toEqual([]);
	});

	it("each checkable param's default is one of its options", () => {
		const bad = enumParams()
			.filter(([, , , o, d]) => checkable(o, d) && d != null && !o.includes(d))
			.map(([kind, name, param, o, d]) => `${kind}:${name}.${param} = ${d} not in ${o}`);
		expect(bad).toEqual([]);
	});
});

describe('the option reader', () => {
	it('follows an {#each} over a declared list and a one-way value with onchange', async () => {
		const src = `
			const kinds = [{ value: 'z-score', label: 'Z' }, { value: 'min-max', label: 'M' }];
			const plain = ['a', 'b'];
			<select bind:value={p.args.kind}>{#each kinds as k (k.value)}<option value={k.value}>{k.label}</option>{/each}</select>
			<select bind:value={p.args.letter}>{#each plain as l}<option value={l}>{l}</option>{/each}</select>
			<select value={p.args.field ?? 'x'} onchange={(e) => (p.args.field = e.currentTarget.value)}>
				<option value="x">X</option><option value="y">Y</option>
			</select>
			<select bind:value={p.args.mixed}><option value="q">Q</option>{#each plain as l}<option value={l}>{l}</option>{/each}</select>`;
		const o = await selectOptionsFromSource(src);
		expect(o.get('kind')).toEqual(['z-score', 'min-max']);
		expect(o.get('letter')).toEqual(['a', 'b']);
		expect(o.get('field')).toEqual(['x', 'y']);
		expect(o.get('mixed')).toBeNull();
	});

	it('keys a node by its registryKey (Normalize.svelte is "normalize")', () => {
		expect(selectOptionsOf('process', 'normalize').get('normalizationType')).toContain('z-score');
	});
});

describe('an invalid value is refused for every checkable param', () => {
	it('table processes', async () => {
		let n = 0;
		for (const [kind, name, param, options, d] of enumParams()) {
			if (kind !== 'tableProcess' || !checkable(options, d)) continue;
			const s = new AncirSession(`bad-${name}-${param}`);
			const ids = importSpecInputs(s, specOf(name), 'in');
			const args = { ...engineArgs(specOf(name), ids), [param]: '__not_an_option__' };
			await expect(s.runTableProcess(name, args), `${name}.${param}`).rejects.toThrow(
				new RegExp(`${name}: "${param}" must be one of`)
			);
			expect(s.exportSessionObject().tableProcesses, `${name}.${param} left a node`).toEqual([]);
			n++;
		}
		expect(n).toBeGreaterThan(30);
	}, 60000);

	it('column transforms', () => {
		let n = 0;
		for (const [kind, name, param, options, d] of enumParams()) {
			if (kind !== 'process' || !checkable(options, d)) continue;
			const s = new AncirSession(`bad-${name}-${param}`);
			s.importColumns([{ name: 'v', values: [1, 2, 3, 4, 5] }]);
			expect(() => s.addColumnProcess('v', name, { [param]: '__not_an_option__' })).toThrow(
				new RegExp(`${name}: "${param}" must be one of`)
			);
			n++;
		}
		expect(n).toBeGreaterThan(3);
	});
});
