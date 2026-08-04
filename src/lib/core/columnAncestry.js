// src/lib/core/columnAncestry.js
// @ts-nocheck
//
// Where a column's DATA came from, as column ids.
//
// A processed column is a NEW column with a NEW id, so nothing keyed on id
// (`core.seriesAppearance`, most obviously) knows that `a → Detrend` is still `a`.
// This module answers "which column did this one come from?", so a lookup that
// misses can walk up and try the source instead.
//
// WHY NOT SHARE THE WALK IN Column.svelte
//
// `columnBaseName` / `producerBaseName` (Column.svelte:92-119) already walk exactly
// this ancestry, to build names like "HR → Add → Normalize". Sharing that code was
// the first choice and was rejected for two reasons:
//
//   1. Neither function is exported, and both are inside a `<script module>` block of
//      a .svelte COMPONENT. Importing a component from a plain module that plot
//      rendering reaches would drag the component graph into every consumer, and
//      Column.svelte already imports half of core; producerRuntime.js carries an
//      explicit "must NOT import Column.svelte" note for the cycle it would create.
//   2. They carry a different payload. They fold a column's OWN processes into the
//      name ("… → Normalize"), which is a string concern; ancestry only needs the id
//      of the previous column, and must stop at a fork rather than pick one.
//
// So this is a small independent walk that reuses the SAME two mechanisms, through
// the same helpers Column.svelte uses (`producerInputColId`, `getProducerProcess`),
// so the two cannot drift on how a producer's input is found.
//
// THE THREE MECHANISMS
//
//   refId          a referential column: it reads another column and applies its own
//                  processes on top. `refId === -1` is the broken-reference marker
//                  used throughout Column, so it means "no parent", not "column -1".
//   producerNodeId a dataflow column: it is a handle on one output port of a free
//                  process node. The port names the input it derives from.
//   args.out       a TableProcess output column: an ordinary column that some
//                  analysis node (Cosinor, FitFunction, Split, …) created in a
//                  reconcile and writes into. It carries NO back-pointer at all, so
//                  it has to be found by searching the nodes for the one whose
//                  `args.out` maps a key to this id.
//
// refId is checked first, matching Column.svelte, which only takes the producer path
// when `refId == null`. The TableProcess search runs only when NEITHER field is
// present, which is exactly the shape a TP output has (`new Column({})`, then written
// by tableProcesses/outputColumns.js). Deliberately not a fallback for a producer
// column that answered null: that null is the fork rule REFUSING, and a refusal must
// not be talked out of by a second mechanism.
//
// WHY THE OUT KEY, AND NOT A NEW FIELD
//
// Stamping `sourceColumnId` on every TP output at creation time was the first idea and
// was rejected: there are ~20 nodes with bespoke reconciles, each would have to
// remember, and sessions already saved would carry nothing. The out KEY already
// encodes the answer, and reconcileOutputs.js already had to state precisely how (it
// deletes outputs by reading the same keys), so this reuses that statement rather than
// adding a second, drifting one.
//
// The three key shapes, in the order they are tried:
//
//   1. per-input   `<prefix><inputColumnId>` for a prefix in PER_INPUT_PREFIXES
//                  (`fity_12`, `cosinory_12`, `resid_12`, `col_12`). One output per
//                  input, so each names its own ancestor; this is the TP equivalent of
//                  a free process's `out_<id>` fan-out port, and the fork rule below
//                  never applies to it.
//   2. id-prefixed `<inputColumnId>_<suffix>`, the shape where the id comes FIRST. Split
//                  writes `400_1`, MovingAnalysis `400_mean`, RhythmicityAnalysis
//                  `400_period`. The suffix is unconstrained; the leading id must be a
//                  live input, which is what keeps this from swallowing anything else.
//   3. whole node  any other key, when the node has exactly ONE input. A periodogram's
//                  `period`/`power` pair is not per-input, but with one Y wired there
//                  is still only one column it can have come from.
//
// THE LongToWide TRAP
//
// PER_INPUT_PREFIXES is IMPORTED, never re-derived, and that is the whole safety
// argument. LongToWide names its outputs `value_<category>` where the category is a
// DATA VALUE, so `value_1` is "the column for hive 1", not "column 1's output".
// Inferring per-input-ness from the shape of the key (`ends in _<digits>`) once caused
// data loss in reconcileOutputs; here it would only mis-colour a series, but it would
// be the same wrong inference from the same wrong reasoning, so it is refused the same
// way. `value_` is not a per-input prefix, `value_1` does not START with digits (rule 2
// reads the id from the FRONT, which is the direction that matters here), and LongToWide
// wires three inputs, so all three cases decline and the answer is null.
//
// THE FORK RULE
//
// A node with more than one distinct input column has no single ancestor. A
// cross-correlation of `a` and `b` is not `a`, and taking whichever column sits on
// port 0 would paint it confidently as `a` — worse than not answering, because a
// wrong answer looks deliberate. So the chain STOPS there and the caller falls back.
//
// A fan-out node is the case that must NOT be caught by that rule: one operation
// added to several columns at once produces one output per input, each on its own
// `out_<inputColId>` port. Such a node has several inputs, but each OUTPUT still has
// exactly one, named by its own port. So a port of that shape answers directly and
// the fork rule never applies to it; only the legacy single-output ports
// ("output"/"column"), which have to consult the node's inputs, can fork.
//
// Spec: docs/superpowers/specs/2026-07-30-style-config-scope.md
//       ("Following the data back to its source column")
import { core } from './core.svelte.js';
import { getProducerProcess, producerInputColId } from './producerRuntime.js';
// Safe to import: reconcileOutputs.js is deliberately pure and dependency-free (it
// imports nothing at all), so there is no cycle back to here or to core.
import { liveInputIds, PER_INPUT_PREFIXES } from './reconcileOutputs.js';

// A malformed graph must not hang a render. The cycle guard below already covers a
// closed loop; this covers a pathologically long (or adversarially generated) chain.
const MAX_DEPTH = 64;

function findColumn(id) {
	if (id == null) return null;
	return (core.data ?? []).find((c) => c.id === id) ?? null;
}

/** A plausible column id: ids are non-negative integers, and -1 means "broken". */
function isColumnId(v) {
	return Number.isInteger(v) && v >= 0;
}

/**
 * Every column id a free process node takes as input, deduplicated.
 *
 * Input args are named by the `…IN` convention (`inIN`, `xIN`, `yIN`, `xsIN`), scalar
 * or array. The pattern requires a LOWERCASE letter before `IN` so a numeric arg that
 * merely ends in those letters (a `MIN`, say) cannot be mistaken for a wire.
 */
function inputColumnIds(args) {
	const out = new Set();
	for (const [key, value] of Object.entries(args ?? {})) {
		if (!/[a-z]IN$/.test(key)) continue;
		for (const v of Array.isArray(value) ? value : [value]) {
			if (isColumnId(v)) out.add(v);
		}
	}
	return [...out];
}

/**
 * The column feeding a producer-sourced column, or null when there is no single one.
 *
 * @param {any} col a Column (or the plain `{id, …}` stand-in the tests use)
 */
function producerParentId(col) {
	const port = col.producerPort || 'output';
	// A per-input port names its own input, so a fan-out node resolves cleanly here
	// and never reaches the fork rule below.
	if (/^out_(\d+)$/.test(port)) return producerInputColId(col.producerNodeId, port);

	const proc = getProducerProcess(col.producerNodeId);
	if (!proc) return null;
	const ids = inputColumnIds(proc.args);
	// 0: nothing wired. >1: a fork, so there is no single ancestor — see the header.
	return ids.length === 1 ? ids[0] : null;
}

/**
 * An `args.out` value read back as a column id, or null.
 *
 * `Number(null)` is 0 and 0 is a perfectly good column id, so an unwired port stored
 * as null would otherwise claim to be column 0 and hand every whole-node output of an
 * unwired node the appearance of the session's first column. (The same coercion trap
 * cost a p-value in the surrogate work.) Only a real number or an all-digits string
 * counts.
 */
function outValueToColumnId(v) {
	if (typeof v === 'number') return isColumnId(v) ? v : null;
	if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
	return null;
}

/**
 * The TableProcess that owns this column as an output, and the key it is stored under.
 *
 * A linear scan of a flat list. TPs number in the tens and the walk is at most
 * MAX_DEPTH hops, so an index would be a cache to invalidate for no measurable gain;
 * core.tableProcesses is `$state`, and a derived index over it would have to be
 * rebuilt on every arg edit anyway.
 */
function findTPOutput(columnId) {
	for (const tp of core.tableProcesses ?? []) {
		const out = tp?.args?.out;
		if (!out || typeof out !== 'object') continue;
		for (const [key, value] of Object.entries(out)) {
			if (outValueToColumnId(value) === columnId) return { tp, key };
		}
	}
	return null;
}

/**
 * The input column a TableProcess output derives from, or null.
 *
 * The three key shapes are described in the header, along with why the per-input list
 * is imported rather than inferred. Each case declines to the next, so a per-input key
 * whose id is no longer wired (an orphan reconcileOutputs has not swept yet) does not
 * invent an ancestor; it just gets whatever the later, weaker rules can prove.
 */
function tableProcessParentId(columnId) {
	const found = findTPOutput(columnId);
	if (!found) return null;
	const { tp, key } = found;
	const live = liveInputIds(tp);

	// (a) per-input: `<prefix><inputColumnId>`, one output per input.
	const prefix = PER_INPUT_PREFIXES.find((p) => key.startsWith(p));
	if (prefix) {
		const rest = key.slice(prefix.length);
		// Exactly a column id, and one this node still takes: "resid_1_2" and
		// "col_12a" only look like per-input outputs.
		if (/^\d+$/.test(rest) && live.has(Number(rest))) return Number(rest);
	}

	// (b) ID-AS-PREFIX: `<inputColumnId>_<suffix>`. Three nodes build keys this way and the
	// suffix is not always a number:
	//
	//   Split               `${yId}_${seg + 1}`   → "400_1"
	//   MovingAnalysis      `${yId}_${k}`         → "400_mean"
	//   RhythmicityAnalysis `${yId}_${k}`         → "400_period", "400_power"
	//
	// This rule first required BOTH halves to be digits, which covered Split and missed the
	// other two entirely. The tests passed because their fixtures were `fity_7`-shaped; the
	// gap only showed up when a real session's `args.out` was read in the browser. So the
	// suffix is now unconstrained.
	//
	// That does NOT reopen the LongToWide trap, and the direction is the whole reason. The
	// inference that destroys data is "ends in _<digits>", which reads `value_1` (category
	// 1, a DATA VALUE) as column 1's output. This reads LEADING digits, and `value_<x>`
	// always begins with the literal `value_`. The two shapes cannot collide.
	//
	// The leading id must still be a LIVE INPUT of this node, which is what stops a key that
	// merely looks like this shape from inventing an ancestor. Checked against the whole
	// registry: no fixed output key in nodes.json begins with digits followed by `_`.
	const idPrefixed = /^(\d+)_/.exec(key);
	if (idPrefixed && live.has(Number(idPrefixed[1]))) return Number(idPrefixed[1]);

	// (c) whole-node output on a single-input node. Not per-input, but with one column
	// wired in there is only one thing it can descend from.
	// 0 inputs: nothing to descend from. >1: a fork, and see the header — a confident
	// wrong answer is worse than none.
	return live.size === 1 ? [...live][0] : null;
}

/** The column one hop up, or null. */
export function parentColumnId(columnId) {
	const col = findColumn(columnId);
	if (!col) return null;
	// Mirrors Column.svelte: a referential column is described by its ref even if it
	// also carries producer fields.
	if (col.refId != null) return isColumnId(col.refId) ? col.refId : null;
	if (col.producerNodeId != null) return producerParentId(col);
	// A TP output carries neither field, so this is reached only for columns the first
	// two mechanisms have nothing to say about at all — never to second-guess a fork.
	return tableProcessParentId(columnId);
}

/**
 * Every ancestor of a column, nearest first, ending at the root it derives from.
 *
 * Empty when the column is itself a root, when its parent no longer exists, or when
 * the walk immediately meets a fork. Cycle-guarded: a graph where `a` derives from
 * `b` and `b` from `a` returns the ancestors found before the loop closed rather
 * than spinning.
 *
 * @param {number|string|null} columnId
 * @returns {number[]}
 */
export function ancestorColumnIds(columnId) {
	const start = columnId == null ? null : Number(columnId);
	if (!isColumnId(start)) return [];

	const chain = [];
	const seen = new Set([start]);
	let current = start;
	for (let depth = 0; depth < MAX_DEPTH; depth++) {
		const next = parentColumnId(current);
		if (next == null) break;
		// A column that no longer exists ends the chain: nothing above it can be read.
		if (seen.has(next) || !findColumn(next)) break;
		seen.add(next);
		chain.push(next);
		current = next;
	}
	return chain;
}

/**
 * The single root column a column derives from, or null.
 *
 * Transitive: `a → Detrend → Smooth` answers `a`, not the intermediate. Callers that
 * want to stop at the nearest USEFUL ancestor (one that carries a record, say) should
 * walk `ancestorColumnIds` instead; this is the "where did this data ultimately come
 * from" answer.
 *
 * @param {number|string|null} columnId
 * @returns {number|null}
 */
export function sourceColumnId(columnId) {
	const chain = ancestorColumnIds(columnId);
	return chain.length ? chain[chain.length - 1] : null;
}
