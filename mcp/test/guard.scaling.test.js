// Scaling guard for EVERY analysis that takes many y columns: the work it does grows at most
// linearly in the number of y columns. Work is COUNTED, not timed (timing tests flake): every
// getColumnById call, every column-namer build weighted by the columns it indexes, and every
// element a namer reads off the store's column list (a linear find per label is O(columns)).
//
// Generalises 2026-11-09 bug 8: Cosinor was O(n^2) in its y columns (a namer rebuilt per
// series; Cosinor.manySeries.svelte.test.js pins that one node).
import { describe, expect, it, vi } from 'vitest';

const work = vi.hoisted(() => ({ lookups: 0, namers: 0, namerCost: 0, reads: 0 }));

vi.mock('$lib/core/outputLabels.js', async (importOriginal) => {
	const real = await importOriginal();
	// The store a namer sees, with every read of a column off its `data` list counted.
	const counted = (state) =>
		new Proxy(state, {
			get(target, key) {
				const v = Reflect.get(target, key);
				if (key !== 'data' || !Array.isArray(v)) return v;
				return new Proxy(v, {
					get(arr, i) {
						if (typeof i === 'string' && /^\d+$/.test(i)) work.reads++;
						return Reflect.get(arr, i);
					}
				});
			}
		});
	return {
		...real,
		createColumnNamer: (state, ...rest) => {
			work.namers++;
			// A namer indexes every column owner in the store when it is built: O(columns).
			work.namerCost += state?.data?.length ?? 0;
			return real.createColumnNamer(state ? counted(state) : state, ...rest);
		}
	};
});

vi.mock('$lib/core/Column.svelte', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		getColumnById: (...a) => {
			work.lookups++;
			return real.getColumnById(...a);
		}
	};
});

const { AncirSession, ensureRegistry } = await import('../src/engine/session.js');
const { appConsts } = await import('$lib/core/core.svelte.js');
const { specOf, importSpecInputs, engineArgs, resolveData } = await import('./guardSupport.js');

await ensureRegistry();

// Nodes left out, with why. Every other node with a many-y input is checked.
const SKIP = {
	// Fits each y in each of many windows: correct but too slow at 40 series for the unit suite.
	MovingAnalysis: 'slow at 40 series (a periodogram per window per y)',
	// Its crossing rule names one y column (groups[].target), so extra ys change the rule.
	Crossing: 'the rule targets one named y'
};

const multiY = [...appConsts.tableProcessMap]
	.filter(([, e]) => (e.columnIdFields?.array ?? []).includes('yIN'))
	.map(([name]) => name)
	.filter((name) => !SKIP[name])
	// Nodes whose catalogue instance wires its y input (ColumnFunctions reads xsIN).
	.filter((name) => specOf(name).args(specOf(name).inputs.map((_, i) => i)).yIN != null)
	.sort();

/** The work of one run with `n` y columns (copies of the catalogue's y, each scaled). */
async function workFor(name, n) {
	const spec = specOf(name);
	const s = new AncirSession(`scale-${name}-${n}`);
	const ids = importSpecInputs(s, spec, 'in');
	const args = engineArgs(spec, ids);
	const y0 = (Array.isArray(args.yIN) ? args.yIN : [args.yIN])[0];
	const yValues = resolveData(spec.inputs[ids.indexOf(y0)].data);
	const added = s.importColumns(
		Array.from({ length: n }, (_, k) => ({
			name: `y${k}`,
			type: spec.inputs[ids.indexOf(y0)].type,
			values: yValues.map((v) => (typeof v === 'number' ? v * (1 + k / 100) : v))
		}))
	);
	work.lookups = work.namers = work.namerCost = work.reads = 0;
	const res = await s.runTableProcess(name, { ...args, yIN: added.map((a) => a.id) });
	expect(res.valid, `${name} with ${n} y: ${res.error}`).toBe(true);
	return { ...work, total: work.lookups + work.reads + work.namerCost };
}

describe('multi-y analyses do linear work in the number of y columns', () => {
	it('covers the multi-y nodes', () => expect(multiY.length).toBeGreaterThanOrEqual(15));

	for (const name of multiY) {
		it(
			name,
			async () => {
				const a = await workFor(name, 20);
				const b = await workFor(name, 40);
				const detail = `20 y: ${JSON.stringify(a)}; 40 y: ${JSON.stringify(b)}`;
				// Twice the columns, at most ~twice the work (a quadratic term makes it ~4x).
				expect(b.total, detail).toBeLessThanOrEqual(2.2 * a.total + 50);
			},
			60000
		);
	}
});
