// @ts-nocheck
/**
 * Join Data: which value columns of A and B are the same measurement, and what each output
 * column is called. Pure and import-free, so the node (tableProcesses/JoinData.svelte), the
 * output labels (core/outputLabels.js) and the MCP normalizer (mcp/src/emit/dynamicOut.js)
 * share one rule without an import cycle. The Python and R ports (tools/ancir_runtime.*,
 * join_pairing) implement the same rule.
 *
 * THE RULE (David, 2026-10-19: "assume same-measurement columns")
 *
 *   A B value column is PAIRED with an A value column when their names match after
 *   normalising: surrounding whitespace removed, every run of inner whitespace read as one
 *   space, and case ignored ("Temp", " temp " and "TEMP" match; "temp C" and "tempC" do not).
 *   A paired pair becomes ONE output column: A's values on A's rows, B's values on B's rows.
 *
 *   The panel's per-B-column select overrides the name match: `pairing[bId]` is an A column id
 *   ("same as A: <col>") or -1 ("separate column"). No entry means "by name".
 *
 *   Each A column takes at most one B partner. Overrides are honoured first, in B's order; then
 *   name matches, in B's order, each taking the first A column of that name still free. A B
 *   column that loses out (two B columns named "temp", or an override pointing at an A column
 *   another override already took) is a separate column, and the conflict is reported.
 *
 * OUTPUT KEYS: `joined_<A column id>` for every A value column (paired or not), then
 * `joined_<B column id>` for every unpaired B value column, in input order. `joined_` is in
 * PER_INPUT_PREFIXES (core/reconcileOutputs.js), so the orphan sweep and the style ancestry
 * read each key as describing that input column.
 *
 * LABELS: a paired or A-only column shows the A column's name; a B-only column shows its own
 * (trimmed).
 * When two outputs would read the same (by the normalised name), each one that is not a
 * pairing gets its side, "temp (A)" / "temp (B)"; any still alike after that are numbered in
 * order, "temp (B) 2".
 */

/** The name as it is compared: trimmed, inner whitespace runs as one space, lower case. */
export function normaliseColumnName(name) {
	return String(name ?? '')
		.trim()
		.replace(/\s+/g, ' ')
		.toLowerCase();
}

const toIdList = (v) => {
	const list = Array.isArray(v) ? v : v == null ? [] : [v];
	const out = [];
	for (const raw of list) {
		const id = Number(raw); // Number-ok: column ids, never data cells
		if (Number.isInteger(id) && id >= 0 && !out.includes(id)) out.push(id);
	}
	return out;
};

/** A's and B's value column ids, de-duplicated, in wiring order. */
export function joinValueIds(args) {
	return { aIds: toIdList(args?.aValuesIN), bIds: toIdList(args?.bValuesIN) };
}

/**
 * Decide the pairs.
 * @param {number[]} aIds
 * @param {number[]} bIds
 * @param {(id:number) => string} nameOf  the name each column is compared by
 * @param {Record<string, number>} [pairing]  the panel's overrides
 * @returns {{ pairOf: Record<string, number>, conflicts: {bId:number, aId:number, why:string}[] }}
 *   pairOf maps a paired B id to its A id
 */
export function decidePairs(aIds, bIds, nameOf, pairing = {}) {
	const pairOf = {};
	const taken = new Set();
	const decided = new Set();
	const conflicts = [];
	const overrides = pairing && typeof pairing === 'object' ? pairing : {};

	for (const bId of bIds) {
		if (!Object.hasOwn(overrides, String(bId))) continue;
		const want = Number(overrides[String(bId)]); // Number-ok: a column id from the panel
		if (want === -1) {
			decided.add(bId);
			continue;
		}
		if (!aIds.includes(want)) continue; // a stale override (that A column is gone): by name
		decided.add(bId);
		if (taken.has(want)) {
			conflicts.push({ bId, aId: want, why: 'taken' });
			continue;
		}
		pairOf[bId] = want;
		taken.add(want);
	}

	for (const bId of bIds) {
		if (decided.has(bId)) continue;
		const key = normaliseColumnName(nameOf(bId));
		if (key === '') continue;
		const matches = aIds.filter((aId) => normaliseColumnName(nameOf(aId)) === key);
		const free = matches.find((aId) => !taken.has(aId));
		if (free != null) {
			pairOf[bId] = free;
			taken.add(free);
		} else if (matches.length) {
			conflicts.push({ bId, aId: matches[0], why: 'taken' });
		}
	}
	return { pairOf, conflicts };
}

/**
 * Every output column the join produces, with its key and label.
 * @param {number[]} aIds
 * @param {number[]} bIds
 * @param {Record<string, number>} pairOf  from decidePairs
 * @param {(id:number) => string} nameOf
 * @returns {{ key:string, aId:number|null, bId:number|null, label:string }[]}
 */
export function joinOutputs(aIds, bIds, pairOf, nameOf) {
	const partnerOf = {};
	for (const [bId, aId] of Object.entries(pairOf ?? {})) partnerOf[aId] = Number(bId); // Number-ok: object key
	const outs = [];
	for (const aId of aIds) {
		const bId = partnerOf[aId] ?? null;
		outs.push({
			key: `joined_${aId}`,
			aId,
			bId,
			label: String(nameOf(aId) ?? aId).trim(),
			side: 'A'
		});
	}
	for (const bId of bIds) {
		if (Object.hasOwn(pairOf ?? {}, String(bId))) continue;
		outs.push({
			key: `joined_${bId}`,
			aId: null,
			bId,
			label: String(nameOf(bId) ?? bId).trim(),
			side: 'B'
		});
	}

	const count = (labels) => {
		const n = new Map();
		for (const l of labels) n.set(normaliseColumnName(l), (n.get(normaliseColumnName(l)) ?? 0) + 1);
		return n;
	};
	let seen = count(outs.map((o) => o.label));
	for (const o of outs) {
		const paired = o.aId != null && o.bId != null;
		if (!paired && seen.get(normaliseColumnName(o.label)) > 1) o.label = `${o.label} (${o.side})`;
	}
	seen = new Map();
	for (const o of outs) {
		const k = normaliseColumnName(o.label);
		const n = (seen.get(k) ?? 0) + 1;
		seen.set(k, n);
		if (n > 1) o.label = `${o.label} ${n}`;
	}
	return outs.map(({ key, aId, bId, label }) => ({ key, aId, bId, label }));
}

/**
 * The whole plan from the node's args: pairs (the baked `_resolvedPairs` when the node has
 * written them, else decided from the names) and outputs.
 * @param {object} args
 * @param {(id:number) => string} nameOf
 * @param {{ useBaked?: boolean }} [opts]  useBaked: trust args._resolvedPairs (labels, ports)
 */
export function joinPlan(args, nameOf, { useBaked = false } = {}) {
	const { aIds, bIds } = joinValueIds(args);
	let pairOf;
	let conflicts = [];
	const baked = args?._resolvedPairs;
	if (useBaked && baked && typeof baked === 'object') {
		pairOf = {};
		for (const [b, a] of Object.entries(baked)) {
			const bId = Number(b); // Number-ok: object key
			const aId = Number(a); // Number-ok: column id
			if (bIds.includes(bId) && aIds.includes(aId)) pairOf[bId] = aId;
		}
	} else {
		({ pairOf, conflicts } = decidePairs(aIds, bIds, nameOf, args?.pairing));
	}
	return { aIds, bIds, pairOf, conflicts, outputs: joinOutputs(aIds, bIds, pairOf, nameOf) };
}

/**
 * The node's mode, from the time wiring alone (David, 2026-10-19):
 *   'time'  both time inputs wired: one time column, sorted (utils/joinData.js joinData).
 *   'stack' neither wired: A's rows in their order, then B's (utils/joinData.js stackData).
 *   'one'   only one wired: refused ("Wire a time for both datasets, or for neither.").
 * A time input counts as wired when it holds a column id (a non-negative integer); -1, null
 * and an absent key are unwired.
 */
export function joinMode(args) {
	const wired = (v) => {
		const id = v == null || v === '' ? NaN : Number(v); // Number-ok: a column id, never a data cell
		return Number.isInteger(id) && id >= 0;
	};
	const a = wired(args?.aTimeIN);
	const b = wired(args?.bTimeIN);
	if (a && b) return 'time';
	return a || b ? 'one' : 'stack';
}

/**
 * Is the Source output on? `sourceColumn` true or false is the user's choice and always wins;
 * anything else (null, the default, or absent) follows the mode: ON when stacking (the Source
 * column is then the group factor), OFF when joining by time. Sessions saved by v82.31 store
 * false, which reads as before.
 */
export function joinSourceOn(args) {
	const v = args?.sourceColumn;
	if (typeof v === 'boolean') return v;
	return joinMode(args) === 'stack';
}

/**
 * Every out key the node has for these args: the time, each value column, the source.
 *  - `jointime` whenever a time is wired (time mode, and the one-time refusal, so a time
 *    column wired downstream survives while the user rewires); never when stacking, where
 *    there is no time.
 *  - `source` when joinSourceOn, once anything is wired (a fresh node has no outputs).
 */
export function joinOutKeys(args, nameOf, opts) {
	const mode = joinMode(args);
	const values = joinPlan(args, nameOf, opts).outputs.map((o) => o.key);
	const keys = mode === 'stack' ? values : ['jointime', ...values];
	if (joinSourceOn(args) && keys.length) keys.push('source');
	return keys;
}
