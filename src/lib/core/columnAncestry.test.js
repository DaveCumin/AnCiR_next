// Walking a column back to the data it came from.
//
// THE THREE MECHANISMS ARE TESTED SEPARATELY ON PURPOSE. A referential column
// (`refId`), a produced column (`producerNodeId` / `producerPort`) and a TableProcess
// output (found by its `args.out` key) reach their input through completely different
// code, and a fixture that only models one of them would let the others ship broken.
// This project has form: five defects have survived a green suite because the fixtures
// mirrored a single case.
//
// The other pairing that matters is fan-out versus fork. Both are nodes with several
// inputs; only ONE of them has a single ancestor per output, and confusing them
// either drops adoption where it should apply or paints a cross-correlation with the
// colour of whichever input happened to be first.
import { describe, it, expect, beforeEach } from 'vitest';
import { core } from '$lib/core/core.svelte';
import { parentColumnId, ancestorColumnIds, sourceColumnId } from './columnAncestry.js';

/** A free process node as producerRuntime finds it: `process_<id>` with args. */
const node = (id, args) => ({ id, args });

/** A TableProcess as core.tableProcesses holds it: inputs in `args`, outputs in `args.out`. */
const tp = (id, args) => ({ id, args });

const setup = ({ columns = [], processes = [], tableProcesses = [] } = {}) => {
	core.data = columns;
	core.orphanProcesses = processes;
	core.tableProcesses = tableProcesses;
};

beforeEach(() => setup());

describe('a column with no ancestry', () => {
	it('a raw column has none', () => {
		setup({ columns: [{ id: 1 }] });
		expect(sourceColumnId(1)).toBeNull();
		expect(ancestorColumnIds(1)).toEqual([]);
	});

	it('a column that does not exist has none', () => {
		expect(sourceColumnId(99)).toBeNull();
	});

	it('null / junk ids are answered, not thrown at', () => {
		expect(sourceColumnId(null)).toBeNull();
		expect(sourceColumnId(undefined)).toBeNull();
		expect(sourceColumnId('nope')).toBeNull();
		expect(ancestorColumnIds(-1)).toEqual([]);
	});
});

describe('the referential path (refId)', () => {
	it('adopts its referent', () => {
		setup({ columns: [{ id: 1 }, { id: 2, refId: 1 }] });
		expect(sourceColumnId(2)).toBe(1);
	});

	it('treats the broken-reference marker as no parent', () => {
		// -1 is Column's "the column I referred to is gone", not column number -1.
		setup({ columns: [{ id: 2, refId: -1 }] });
		expect(sourceColumnId(2)).toBeNull();
	});

	it('stops when the referent no longer exists', () => {
		setup({ columns: [{ id: 2, refId: 7 }] });
		expect(sourceColumnId(2)).toBeNull();
	});

	it('lets refId win over producer fields, as Column.name does', () => {
		setup({
			columns: [{ id: 1 }, { id: 3 }, { id: 2, refId: 1, producerNodeId: 'process_5' }],
			processes: [node(5, { inIN: [3] })]
		});
		expect(sourceColumnId(2)).toBe(1);
	});
});

describe('the producer path (producerNodeId / producerPort)', () => {
	it('follows a legacy single-output port to the node’s input', () => {
		setup({
			columns: [{ id: 1 }, { id: 10, producerNodeId: 'process_5', producerPort: 'output' }],
			processes: [node(5, { inIN: 1 })]
		});
		expect(sourceColumnId(10)).toBe(1);
	});

	it('defaults a missing port to the single-output behaviour', () => {
		setup({
			columns: [{ id: 1 }, { id: 10, producerNodeId: 'process_5' }],
			processes: [node(5, { inIN: [1] })]
		});
		expect(sourceColumnId(10)).toBe(1);
	});

	it('gives each FAN-OUT output its own ancestor', () => {
		// One op added to two columns at once: several inputs, but each output port
		// names the one it derives from, so both must still adopt.
		setup({
			columns: [
				{ id: 1 },
				{ id: 2 },
				{ id: 10, producerNodeId: 'process_5', producerPort: 'out_1' },
				{ id: 11, producerNodeId: 'process_5', producerPort: 'out_2' }
			],
			processes: [node(5, { inIN: [1, 2] })]
		});
		expect(sourceColumnId(10)).toBe(1);
		expect(sourceColumnId(11)).toBe(2);
	});

	it('refuses a FORK: two inputs into one output has no single ancestor', () => {
		// A cross-correlation of a and b is not a. Port 0 would be a confident wrong
		// answer, so the caller falls back to a fresh index instead.
		setup({
			columns: [{ id: 1 }, { id: 2 }, { id: 10, producerNodeId: 'process_5' }],
			processes: [node(5, { inIN: [1, 2] })]
		});
		expect(sourceColumnId(10)).toBeNull();
	});

	it('refuses a fork spread across differently named input args', () => {
		setup({
			columns: [{ id: 1 }, { id: 2 }, { id: 10, producerNodeId: 'process_5' }],
			processes: [node(5, { xIN: 1, yIN: 2 })]
		});
		expect(sourceColumnId(10)).toBeNull();
	});

	it('counts the SAME column wired twice as one input', () => {
		setup({
			columns: [{ id: 1 }, { id: 10, producerNodeId: 'process_5' }],
			processes: [node(5, { xIN: 1, yIN: [1] })]
		});
		expect(sourceColumnId(10)).toBe(1);
	});

	it('ignores unwired slots and non-column args', () => {
		setup({
			columns: [{ id: 1 }, { id: 10, producerNodeId: 'process_5' }],
			processes: [node(5, { inIN: [1], xIN: -1, MIN: 2, period: 24, label: 'x' })]
		});
		expect(sourceColumnId(10)).toBe(1);
	});

	it('has no ancestor when the producing node is gone', () => {
		setup({ columns: [{ id: 1 }, { id: 10, producerNodeId: 'process_5' }] });
		expect(sourceColumnId(10)).toBeNull();
	});

	it('has no ancestor when nothing is wired in', () => {
		setup({
			columns: [{ id: 10, producerNodeId: 'process_5' }],
			processes: [node(5, { inIN: [] })]
		});
		expect(sourceColumnId(10)).toBeNull();
	});
});

// A TableProcess output column carries NO back-pointer: no refId, no producerNodeId.
// It is found by searching the nodes for the one whose `args.out` maps a key to its id,
// and the KEY says which input it came from. Three key shapes, three rules, and one
// shape that must be refused; each gets its own fixture.
describe('the TableProcess path (args.out)', () => {
	it('resolves a per-input fit output to the column it was fitted to', () => {
		setup({
			columns: [{ id: 7 }, { id: 20 }],
			tableProcesses: [tp(1, { yIN: [7], out: { fity_7: 20 } })]
		});
		expect(sourceColumnId(20)).toBe(7);
	});

	it('gives each per-input output of a multi-Y node its own ancestor', () => {
		// The TP equivalent of a fan-out: several inputs, but each output key names one.
		setup({
			columns: [{ id: 7 }, { id: 8 }, { id: 20 }, { id: 21 }, { id: 22 }],
			tableProcesses: [tp(1, { yIN: [7, 8], out: { cosinory_7: 20, cosinory_8: 21, resid_7: 22 } })]
		});
		expect(sourceColumnId(20)).toBe(7);
		expect(sourceColumnId(21)).toBe(8);
		expect(sourceColumnId(22)).toBe(7);
	});

	it('reads CollectColumns’ col_<id> keys off its bespoke colIds input array', () => {
		// `colIds`, not `yIN`. liveInputIds is imported precisely so this keeps working.
		setup({
			columns: [{ id: 3 }, { id: 4 }, { id: 30 }],
			tableProcesses: [tp(1, { colIds: [3, 4], out: { col_3: 30 } })]
		});
		expect(sourceColumnId(30)).toBe(3);
	});

	it('does NOT invent a parent when a per-input suffix is not a live input', () => {
		// An orphaned output (the Y was swapped, reconcileOutputs has not swept yet).
		// Column 9 is not wired in, so `fity_9` must not claim it.
		setup({
			columns: [{ id: 7 }, { id: 8 }, { id: 9 }, { id: 20 }],
			tableProcesses: [tp(1, { yIN: [7, 8], out: { fity_9: 20 } })]
		});
		expect(sourceColumnId(20)).toBeNull();
	});

	// THE LongToWide TRAP, stated as a test because it is the exact bug
	// PER_INPUT_PREFIXES exists to prevent. `value_<category>` keys carry a DATA VALUE,
	// and numeric categories are entirely normal (hive 1, 2, 3). Reading `value_1` as
	// "column 1's output" once deleted user data in reconcileOutputs; here it would
	// silently paint the wide column with hive 1's colour.
	it('does not read a numeric CATEGORY in a value_<category> key as a column id', () => {
		setup({
			columns: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 40 }],
			tableProcesses: [
				tp(1, { categoryIN: 1, timeIN: 2, valueIN: 3, out: { value_1: 40, value_2: 41 } })
			]
		});
		expect(sourceColumnId(40)).toBeNull();
	});

	it('refuses a FORK: a whole-node output of a multi-input node has no ancestor', () => {
		setup({
			columns: [{ id: 1 }, { id: 2 }, { id: 50 }],
			tableProcesses: [tp(1, { xIN: 1, yIN: [2], out: { period: 50, power: 51 } })]
		});
		expect(sourceColumnId(50)).toBeNull();
	});

	it('resolves a whole-node output when the node has exactly ONE input', () => {
		setup({
			columns: [{ id: 1 }, { id: 50 }],
			tableProcesses: [tp(1, { yIN: [1], out: { period: 50, power: 51 } })]
		});
		expect(sourceColumnId(50)).toBe(1);
	});

	it('counts the same column wired into two ports as one input', () => {
		setup({
			columns: [{ id: 1 }, { id: 50 }],
			tableProcesses: [tp(1, { xIN: 1, yIN: [1], out: { period: 50 } })]
		});
		expect(sourceColumnId(50)).toBe(1);
	});

	it('has no ancestor when the node has nothing wired in', () => {
		setup({
			columns: [{ id: 50 }],
			tableProcesses: [tp(1, { yIN: [], out: { period: 50 } })]
		});
		expect(sourceColumnId(50)).toBeNull();
	});

	it('resolves a Split segment, where the id is the PREFIX of the key', () => {
		// Split.svelte:263 builds `${yId}_${seg}`, which no per-input prefix matches.
		setup({
			columns: [{ id: 799 }, { id: 60 }, { id: 61 }],
			tableProcesses: [tp(1, { yIN: [799], out: { '799_1': 60, '799_2': 61 } })]
		});
		expect(sourceColumnId(60)).toBe(799);
		expect(sourceColumnId(61)).toBe(799);
	});

	it('resolves each Y of a multi-Y Split to its own input', () => {
		// The case that proves the split rule is doing the work rather than the
		// single-input fallback standing in for it.
		setup({
			columns: [{ id: 799 }, { id: 800 }, { id: 60 }, { id: 61 }],
			tableProcesses: [tp(1, { yIN: [799, 800], out: { '799_1': 60, '800_1': 61 } })]
		});
		expect(sourceColumnId(60)).toBe(799);
		expect(sourceColumnId(61)).toBe(800);
	});

	it('does not read a split-shaped key whose leading id is not an input', () => {
		setup({
			columns: [{ id: 799 }, { id: 55 }, { id: 60 }],
			tableProcesses: [tp(1, { yIN: [799], colIds: [], out: { '55_1': 60 } })]
		});
		// 55 is not wired in; the single-input fallback answers 799 instead of pretending
		// the key named a parent.
		expect(sourceColumnId(60)).toBe(799);
	});

	it('ignores an unwired out port rather than reading null as column 0', () => {
		// Number(null) is 0 and 0 is a valid column id, so an unguarded coercion would
		// give every unwired port the ancestry of the session's first column.
		setup({
			columns: [{ id: 0 }, { id: 5 }],
			tableProcesses: [tp(1, { yIN: [5], out: { fity_5: null, resid_5: -1 } })]
		});
		expect(sourceColumnId(0)).toBeNull();
	});

	it('accepts an out id stored as a numeric string, as loaded sessions can carry', () => {
		setup({
			columns: [{ id: 7 }, { id: 20 }],
			tableProcesses: [tp(1, { yIN: ['7'], out: { fity_7: '20' } })]
		});
		expect(sourceColumnId(20)).toBe(7);
	});

	it('finds the owning node among several', () => {
		setup({
			columns: [{ id: 1 }, { id: 2 }, { id: 20 }],
			tableProcesses: [
				tp(1, { yIN: [1], out: { fity_1: 90 } }),
				tp(2, { yIN: [2], out: { fity_2: 20 } })
			]
		});
		expect(sourceColumnId(20)).toBe(2);
	});

	it('has no ancestor when no node claims the column', () => {
		setup({ columns: [{ id: 20 }], tableProcesses: [tp(1, { yIN: [1], out: { fity_1: 21 } })] });
		expect(sourceColumnId(20)).toBeNull();
	});
});

describe('walking transitively', () => {
	it('reaches the root through two producer hops', () => {
		setup({
			columns: [
				{ id: 1 },
				{ id: 2, producerNodeId: 'process_5', producerPort: 'out_1' },
				{ id: 3, producerNodeId: 'process_6', producerPort: 'out_2' }
			],
			processes: [node(5, { inIN: [1] }), node(6, { inIN: [2] })]
		});
		expect(sourceColumnId(3)).toBe(1);
		expect(ancestorColumnIds(3)).toEqual([2, 1]);
	});

	it('mixes the two mechanisms in one chain', () => {
		setup({
			columns: [
				{ id: 1 },
				{ id: 2, refId: 1 },
				{ id: 3, producerNodeId: 'process_5', producerPort: 'out_2' }
			],
			processes: [node(5, { inIN: [2] })]
		});
		expect(ancestorColumnIds(3)).toEqual([2, 1]);
		expect(sourceColumnId(3)).toBe(1);
	});

	it('mixes all THREE mechanisms in one chain', () => {
		// raw 1 → free process (column 2) → refId (column 3) → Cosinor fit (column 20).
		// The one fixture that proves the new rule composes with the walk rather than
		// only working from a standing start.
		setup({
			columns: [
				{ id: 1 },
				{ id: 2, producerNodeId: 'process_5', producerPort: 'out_1' },
				{ id: 3, refId: 2 },
				{ id: 20 }
			],
			processes: [node(5, { inIN: [1] })],
			tableProcesses: [tp(1, { yIN: [3], out: { cosinory_3: 20 } })]
		});
		expect(ancestorColumnIds(20)).toEqual([3, 2, 1]);
		expect(sourceColumnId(20)).toBe(1);
	});

	it('walks a TP output whose input is another TP’s output', () => {
		setup({
			columns: [{ id: 1 }, { id: 20 }, { id: 30 }],
			tableProcesses: [
				tp(1, { yIN: [1], out: { smoothedy_1: 20 } }),
				tp(2, { yIN: [20], out: { fity_20: 30 } })
			]
		});
		expect(sourceColumnId(30)).toBe(1);
	});

	it('stops at a fork part-way up rather than skipping past it', () => {
		// 3 ← 2 (single input) ← a two-input node. The chain ends at 2; there is no root.
		setup({
			columns: [
				{ id: 1 },
				{ id: 9 },
				{ id: 2, producerNodeId: 'process_6' },
				{ id: 3, producerNodeId: 'process_5', producerPort: 'out_2' }
			],
			processes: [node(5, { inIN: [2] }), node(6, { xIN: 1, yIN: 9 })]
		});
		expect(ancestorColumnIds(3)).toEqual([2]);
		expect(sourceColumnId(3)).toBe(2);
	});
});

describe('malformed graphs terminate', () => {
	it('a two-column reference cycle does not hang', () => {
		setup({
			columns: [
				{ id: 1, refId: 2 },
				{ id: 2, refId: 1 }
			]
		});
		expect(ancestorColumnIds(1)).toEqual([2]);
		expect(sourceColumnId(1)).toBe(2);
	});

	it('a column referring to itself has no ancestry', () => {
		setup({ columns: [{ id: 1, refId: 1 }] });
		expect(ancestorColumnIds(1)).toEqual([]);
	});

	it('a producer cycle does not hang', () => {
		setup({
			columns: [
				{ id: 1, producerNodeId: 'process_5', producerPort: 'out_2' },
				{ id: 2, producerNodeId: 'process_6', producerPort: 'out_1' }
			],
			processes: [node(5, { inIN: [2] }), node(6, { inIN: [1] })]
		});
		expect(sourceColumnId(1)).toBe(2);
	});

	it('a TableProcess cycle does not hang', () => {
		// Two nodes each taking the other's output. Nothing builds this, but a hand-edited
		// or partially remapped session can, and a render must not be what discovers it.
		setup({
			columns: [{ id: 1 }, { id: 2 }],
			tableProcesses: [
				tp(1, { yIN: [2], out: { fity_2: 1 } }),
				tp(2, { yIN: [1], out: { fity_1: 2 } })
			]
		});
		expect(ancestorColumnIds(1)).toEqual([2]);
		expect(sourceColumnId(1)).toBe(2);
	});

	it('a long chain is bounded rather than walked forever', () => {
		// 200 hops, over the depth guard. The point is that it RETURNS.
		const columns = [{ id: 0 }];
		for (let i = 1; i < 200; i++) columns.push({ id: i, refId: i - 1 });
		setup({ columns });
		expect(ancestorColumnIds(199).length).toBeLessThanOrEqual(64);
	});
});

describe('parentColumnId', () => {
	it('is one hop, where sourceColumnId is all of them', () => {
		setup({ columns: [{ id: 1 }, { id: 2, refId: 1 }, { id: 3, refId: 2 }] });
		expect(parentColumnId(3)).toBe(2);
		expect(sourceColumnId(3)).toBe(1);
	});
});
