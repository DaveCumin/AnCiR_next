// Deleting a dataset must take its derived outputs with it.
//
// Reported 2026-07-29: delete a source column and the downstream node's output
// columns stayed, still holding data and still drawn by any plot reading them.
//
// The cleanup used to live in each node's syncYColumns(), driven by an $effect on
// args.yIN — so it only ran if that node's component was MOUNTED. A collapsed node
// renders through CompactNode and never mounts its editor, so nothing cleaned up.
// Re-expanding did not help either: useMultiYTP seeds prevYIds from the CURRENT
// args.yIN, so an instance mounted after the scrub sees no transition and concludes
// there is nothing to do. The staleness was permanent.
//
// These tests deliberately never mount a component. That is the whole point: the
// invariant is that deletion cleans up on its own, whatever is or is not on screen.
import { describe, it, expect, beforeEach } from 'vitest';

const { core } = await import('$lib/core/core.svelte');
const { Column, removeColumn, getColumnById } = await import('$lib/core/Column.svelte');

function mkCol(name, values) {
	const c = new Column({});
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c;
}

/**
 * A table process shaped like the real thing: yIN inputs, per-Y output keys.
 *
 * Returns a LIVE view rather than the object pushed in. core.tableProcesses is
 * `$state`, and Svelte 5's proxy keeps values in signals rather than on the raw
 * object — so holding the original reference reads stale values and makes a working
 * scrub look like it did nothing.
 */
function mkTP(id, yIds, outs) {
	core.tableProcesses.push({
		id,
		name: 'SmoothedData',
		args: { xIN: -1, yIN: [...yIds], out: { ...outs } }
	});
	return core.tableProcesses[core.tableProcesses.length - 1];
}

beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.groups = [];
	core.tableProcesses = [];
	core.rawData = new Map();
});

describe('deleting a source column removes the outputs derived from it', () => {
	it('drops the per-Y output column, with no component mounted', () => {
		const y = mkCol('hive A', [1, 2, 3]);
		const out = mkCol('smoothedy', [1.1, 2.1, 3.1]);
		const tp = mkTP(1, [y.id], { ['smoothedy_' + y.id]: out.id });

		removeColumn(y.id);

		expect(tp.args.yIN, 'the input ref should be scrubbed').toEqual([]);
		expect(tp.args.out['smoothedy_' + y.id], 'the out KEY should be gone').toBeUndefined();
		expect(getColumnById(out.id), 'the output COLUMN should be gone').toBeFalsy();
		expect(core.rawData.has(out.id), 'its data should be gone').toBe(false);
	});

	it('removes every per-Y output of that Y, not just the first', () => {
		// SmoothedData emits both a smoothed series and a residual per Y.
		const y = mkCol('hive A', [1, 2, 3]);
		const sm = mkCol('smoothedy', [1, 2, 3]);
		const rs = mkCol('resid', [0, 0, 0]);
		mkTP(1, [y.id], { ['smoothedy_' + y.id]: sm.id, ['resid_' + y.id]: rs.id });

		removeColumn(y.id);

		expect(getColumnById(sm.id)).toBeFalsy();
		expect(getColumnById(rs.id)).toBeFalsy();
	});

	it('leaves the OTHER inputs’ outputs alone', () => {
		// The failure that would matter most: deleting one hive wiping another's results.
		const a = mkCol('hive A', [1, 2, 3]);
		const b = mkCol('hive B', [4, 5, 6]);
		const outA = mkCol('smoothedy_A', [1, 2, 3]);
		const outB = mkCol('smoothedy_B', [4, 5, 6]);
		const tp = mkTP(1, [a.id, b.id], {
			['smoothedy_' + a.id]: outA.id,
			['smoothedy_' + b.id]: outB.id
		});

		removeColumn(a.id);

		expect(tp.args.yIN).toEqual([b.id]);
		expect(getColumnById(outA.id), "A's output should go").toBeFalsy();
		expect(getColumnById(outB.id), "B's output must survive").toBeTruthy();
		expect(core.rawData.get(outB.id)).toEqual([4, 5, 6]);
	});

	it('does not touch a shared, non-per-Y output', () => {
		// smoothedx is shared across all Ys and keyed without a column id, so it must
		// not be matched by the suffix rule while another Y still needs it.
		const a = mkCol('hive A', [1, 2, 3]);
		const b = mkCol('hive B', [4, 5, 6]);
		const x = mkCol('smoothedx', [0, 1, 2]);
		const tp = mkTP(1, [a.id, b.id], { smoothedx: x.id });

		removeColumn(a.id);

		expect(tp.args.out.smoothedx).toBe(x.id);
		expect(getColumnById(x.id)).toBeTruthy();
	});

	it('an output that is itself deleted still clears its out key', () => {
		// The pre-existing behaviour, which must survive the change.
		const y = mkCol('hive A', [1, 2, 3]);
		const out = mkCol('smoothedy', [1, 2, 3]);
		const tp = mkTP(1, [y.id], { ['smoothedy_' + y.id]: out.id });

		removeColumn(out.id);

		expect(tp.args.out['smoothedy_' + y.id]).not.toBe(out.id);
		expect(getColumnById(out.id)).toBeFalsy();
	});

	it("does not mistake Split's <yId>_<segment> keys for a per-Y output", () => {
		// Split names its outputs the other way round, so "799_1" ends with "_1" and a
		// bare suffix test would delete another series' first segment when column 1 goes.
		const other = mkCol('hive B', [1, 2, 3]);
		const seg = mkCol('hive B segment 1', [1, 2, 3]);
		const victim = mkCol('unrelated', [7]);
		const tp = mkTP(1, [other.id], { [other.id + '_1']: seg.id });

		removeColumn(victim.id);
		expect(getColumnById(seg.id), "Split's segment must survive").toBeTruthy();

		// And the same key must survive deletion of the column whose id it ENDS with.
		const one = core.data.find((c) => c.id === 1);
		if (one) {
			removeColumn(1);
			expect(getColumnById(seg.id), 'still not a per-Y output of column 1').toBeTruthy();
			expect(tp.args.out[other.id + '_1']).toBe(seg.id);
		}
	});

	it('still matches a real per-Y key whose prefix has letters', () => {
		const y = mkCol('hive A', [1, 2, 3]);
		const out = mkCol('smoothedy', [1, 2, 3]);
		mkTP(1, [y.id], { ['smoothedy_' + y.id]: out.id });
		removeColumn(y.id);
		expect(getColumnById(out.id)).toBeFalsy();
	});
});
