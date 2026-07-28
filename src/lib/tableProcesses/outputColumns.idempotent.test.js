// Rewriting a column with the SAME data must not invalidate its consumers.
//
// WHY THIS EXISTS
//
// `Column.getDataHash` is the invalidation token the whole pipeline runs on:
// every analysis node memoises on the hashes of its inputs, and recomputes when
// one changes. It is a monotonic counter, so it carries no information about the
// data itself — it only says "a dependency of mine was touched".
//
// `writeOutputColumn` touched two of those dependencies unconditionally:
// `core.rawData.set(...)` and `col.tableProcessGUId = processHash`, where every
// caller generates processHash with a fresh `crypto.randomUUID()` per run. So a
// node that recomputed and produced byte-identical output still stamped a new
// random id on its output columns, which changed their hash, which recomputed
// everything downstream, which stamped new ids on ITS outputs, and so on.
//
// That is why the v69.2 compute memo only got a session from 6 recomputes per
// view switch down to 2 rather than to 0: the memo stopped a node recomputing,
// but any node that DID run re-invalidated the entire chain below it for no
// reason. The fix is to make the write idempotent — identical data in, no
// invalidation out — which is the one place in the system where the content is
// actually known and comparing it is free relative to the write itself.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fakeCore } = vi.hoisted(() => ({
	fakeCore: { data: [], rawData: new Map(), tables: [], plots: [] }
}));
vi.mock('$lib/core/core.svelte', () => ({ core: fakeCore, appConsts: {}, appState: {} }));
vi.mock('$lib/core/core.svelte.js', () => ({ core: fakeCore, appConsts: {}, appState: {} }));

/** A stand-in for the bits of Column that writeOutputColumn touches. */
function fakeColumn(id) {
	return { id, data: null, type: 'number', timeFormat: undefined, tableProcessGUId: null };
}

const columns = new Map();
vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => columns.get(id)
}));

const { writeOutputColumn } = await import('./outputColumns.js');

beforeEach(() => {
	columns.clear();
	fakeCore.rawData.clear();
});

describe('an identical rewrite does not invalidate downstream', () => {
	it('leaves tableProcessGUId alone when the data is unchanged', () => {
		const col = fakeColumn(7);
		columns.set(7, col);
		writeOutputColumn(7, [1, 2, 3], { processHash: 'run-1' });
		expect(col.tableProcessGUId).toBe('run-1');

		// A second run of the same analysis on the same inputs. Every caller passes
		// a fresh random processHash here; stamping it would change the column's
		// getDataHash and recompute everything downstream for no reason.
		writeOutputColumn(7, [1, 2, 3], { processHash: 'run-2' });
		expect(col.tableProcessGUId).toBe('run-1');
	});

	it('does not replace the stored array when the data is unchanged', () => {
		// Identity matters: `core.rawData.set` on a Map is itself a reactive write.
		const col = fakeColumn(7);
		columns.set(7, col);
		const first = [1, 2, 3];
		writeOutputColumn(7, first, { processHash: 'run-1' });
		writeOutputColumn(7, [1, 2, 3], { processHash: 'run-2' });
		expect(fakeCore.rawData.get(7)).toBe(first);
	});

	it('still reports success, so callers cannot mistake a skip for a failure', () => {
		// The return value means "the column existed and holds your data", not
		// "I performed a write". Callers use it to decide whether a port is wired.
		const col = fakeColumn(7);
		columns.set(7, col);
		writeOutputColumn(7, [1, 2, 3], { processHash: 'run-1' });
		expect(writeOutputColumn(7, [1, 2, 3], { processHash: 'run-2' })).toBe(true);
	});
});

describe('a real change still propagates', () => {
	// The half that stops this being a memo that never invalidates anything.
	it('stamps the new hash when a value changed', () => {
		const col = fakeColumn(7);
		columns.set(7, col);
		writeOutputColumn(7, [1, 2, 3], { processHash: 'run-1' });
		writeOutputColumn(7, [1, 2, 4], { processHash: 'run-2' });
		expect(col.tableProcessGUId).toBe('run-2');
		expect(fakeCore.rawData.get(7)).toEqual([1, 2, 4]);
	});

	it('stamps the new hash when the length changed', () => {
		const col = fakeColumn(7);
		columns.set(7, col);
		writeOutputColumn(7, [1, 2, 3], { processHash: 'run-1' });
		writeOutputColumn(7, [1, 2], { processHash: 'run-2' });
		expect(col.tableProcessGUId).toBe('run-2');
	});

	it('treats NaN as equal to NaN, since analyses emit it for gaps', () => {
		// `===` says NaN !== NaN, so a plain comparison would report every column
		// containing a gap as changed on every run — exactly the columns that
		// analyses produce most often.
		const col = fakeColumn(7);
		columns.set(7, col);
		writeOutputColumn(7, [1, NaN, 3], { processHash: 'run-1' });
		writeOutputColumn(7, [1, NaN, 3], { processHash: 'run-2' });
		expect(col.tableProcessGUId).toBe('run-1');
	});

	it('does not treat a type change as unchanged', () => {
		const col = fakeColumn(7);
		columns.set(7, col);
		writeOutputColumn(7, [1, 2, 3], { processHash: 'run-1', type: 'number' });
		writeOutputColumn(7, [1, 2, 3], { processHash: 'run-2', type: 'time' });
		expect(col.type).toBe('time');
		expect(col.tableProcessGUId).toBe('run-2');
	});

	it('does not treat a timeFormat change as unchanged', () => {
		const col = fakeColumn(7);
		columns.set(7, col);
		writeOutputColumn(7, [1, 2, 3], { processHash: 'run-1', timeFormat: 'HH:mm' });
		writeOutputColumn(7, [1, 2, 3], { processHash: 'run-2', timeFormat: null });
		expect(col.timeFormat).toBe(null);
		expect(col.tableProcessGUId).toBe('run-2');
	});

	it('writes when the column had no data at all', () => {
		const col = fakeColumn(7);
		columns.set(7, col);
		expect(writeOutputColumn(7, [1, 2, 3], { processHash: 'run-1' })).toBe(true);
		expect(fakeCore.rawData.get(7)).toEqual([1, 2, 3]);
		expect(col.data).toBe(7);
	});
});
