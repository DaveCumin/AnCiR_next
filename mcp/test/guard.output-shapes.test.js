// Output-shape consistency for EVERY multi-y analysis with one shared x output: each per-y
// output that is plotted against that x has the x's length, and a y's outputs do not change
// length because ANOTHER y has gaps.
//
// Generalises 2026-11-09 bug 9 (multi-y Cosinor curves had different lengths from the shared
// cosinorx; Cosinor.sharedX.svelte.test.js pins that case).
import { describe, expect, it } from 'vitest';
import { AncirSession, ensureRegistry } from '../src/engine/session.js';
import { appConsts } from '$lib/core/core.svelte.js';
import { specOf, importSpecInputs, engineArgs, resolveData } from './guardSupport.js';

// At collection time, so there is one test per registered node.
await ensureRegistry();

// Per-y output families that pair with the INPUT x rather than the shared output x (a residual
// is observed - fitted at every input row), or that are not series at all (a permutation null
// distribution). Everything else with a per-y key is checked against the shared x.
const NOT_ON_SHARED_X = ['resid_', 'permstats_'];

/** Multi-y nodes with a shared x output, from the registry. */
function sharedXNodes() {
	const out = [];
	for (const [name, entry] of appConsts.tableProcessMap) {
		if (!(entry.columnIdFields?.array ?? []).includes('yIN')) continue;
		if (!entry.xOutKey && !(entry.defaults?.get('out') ?? {}).movex) continue;
		out.push(name);
	}
	return out.sort();
}

/** A second y like the spec's, phase-shifted, with a run of missing values when `gappy`. */
function secondY(values, gappy) {
	const n = values.length;
	return values.map((v, i) => {
		if (gappy && i >= Math.floor(n * 0.3) && i < Math.floor(n * 0.45)) return null;
		const j = (i + 3) % n;
		return typeof values[j] === 'number' ? values[j] * 0.8 + 1 : v;
	});
}

async function run(name, gappy) {
	const spec = specOf(name);
	const s = new AncirSession(`shape-${name}-${gappy}`);
	const ids = importSpecInputs(s, spec, 'in');
	const args = engineArgs(spec, ids);
	const y1 = args.yIN[0];
	const yValues = resolveData(spec.inputs[ids.indexOf(y1)].data);
	const [{ id: y2 }] = s.importColumns([{ name: 'y2', values: secondY(yValues, gappy) }]);
	const res = await s.runTableProcess(name, { ...args, yIN: [y1, y2] });
	expect(res.valid, `${name} (${gappy ? 'gappy' : 'clean'} y2): ${res.error}`).toBe(true);
	return { res, y1, y2, lengths: Object.fromEntries(res.outputs.map((o) => [o.key, o.length])) };
}

/** The per-y keys of one y that should pair with the shared x. */
function seriesKeysOf(lengths, y) {
	return Object.keys(lengths).filter((k) => {
		if (NOT_ON_SHARED_X.some((pre) => k.startsWith(pre))) return false;
		return new RegExp(`(^|_)${y}($|_)`).test(k);
	});
}

describe('multi-y outputs line up with their shared x', () => {
	const names = sharedXNodes();
	it('covers the multi-y nodes', () => expect(names.length).toBeGreaterThanOrEqual(8));

	for (const name of names) {
		it(
			name,
			async () => {
				const entry = appConsts.tableProcessMap.get(name);
				const clean = await run(name, false);
				const gappy = await run(name, true);
				const xKey = entry.xOutKey && entry.xOutKey in gappy.lengths ? entry.xOutKey : 'movex';
				if (!(xKey in gappy.lengths)) {
					// A dual-mode node whose shared x exists only in collected mode (Rhythmicity):
					// standalone, each y has its own x-like output, nothing to pair.
					expect(entry.yOutKeyPrefix && !(entry.xOutKey in clean.lengths), name).toBeTruthy();
					return;
				}
				for (const r of [clean, gappy]) {
					for (const y of [r.y1, r.y2]) {
						const keys = seriesKeysOf(r.lengths, y);
						expect(keys.length, `${name}: outputs for y ${y}`).toBeGreaterThan(0);
						for (const k of keys) {
							expect(r.lengths[k], `${name}.${k} vs ${xKey}`).toBe(r.lengths[xKey]);
						}
					}
				}
				// y1's outputs do not depend on gaps in y2.
				for (const k of seriesKeysOf(clean.lengths, clean.y1)) {
					expect(gappy.lengths[k], `${name}.${k} with a gappy other y`).toBe(clean.lengths[k]);
				}
			},
			60000
		);
	}
});
