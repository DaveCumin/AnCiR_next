/**
 * sortRows — pure, dependency-free row-sorting helpers.
 *
 * Shared by the Sort table-process node and the import modal so there is a
 * single source of truth for "what order should these rows be in". Time columns
 * are sorted by passing their numeric form (e.g. a column's `hoursSinceStart`,
 * or parsed epoch-ms) as `keyValues` — this module never parses dates itself,
 * which keeps it free of Svelte/app/time dependencies and easy to test.
 *
 * Rules (match the legacy single-column Sort process and the import sort):
 *  - Missing values (null/undefined, NaN numbers, and blank or whitespace-only
 *    strings, the house missing-value rule) always sort LAST, in both asc and
 *    desc directions, preserving their original relative order. A blank cell
 *    used to read as Number('') = 0 and sort among the zeros (review STAT-U5).
 *  - Numbers and numeric strings compare numerically, text lexicographically
 *    (localeCompare). In a MIXED column every number comes before every text
 *    value (ascending; after it descending). The old rule compared a pair as
 *    strings whenever either side was text and numerically otherwise, which is
 *    not transitive (2 < 10 numerically, "10" < "1a" < "2" as text), so the
 *    result depended on the engine's sort algorithm (review STAT-U5).
 *  - The sort is STABLE: equal keys keep their original relative order.
 * Mirrored in tools/ancir_runtime.py (_sort_permutation) and .R (sort_permutation).
 */

/** @param {any} v */
function isMissing(v) {
	return (
		v == null ||
		(typeof v === 'number' && Number.isNaN(v)) ||
		(typeof v === 'string' && v.trim() === '')
	);
}

/** The comparable key of a present value: a number, or a string for text. */
function keyOf(v) {
	const num = Number(v);
	return Number.isNaN(num) ? String(v) : num;
}

/** Total order on keys: numbers (numerically) before strings (localeCompare). */
function compareKeys(a, b) {
	const aStr = typeof a === 'string';
	const bStr = typeof b === 'string';
	if (aStr !== bStr) return aStr ? 1 : -1;
	if (aStr) return /** @type {string} */ (a).localeCompare(/** @type {string} */ (b));
	return /** @type {number} */ (a) - /** @type {number} */ (b);
}

/**
 * Compute the row order (array of original indices) that sorts `keyValues`.
 *
 * @param {ReadonlyArray<any>} keyValues  values to sort by (time pre-converted to numbers)
 * @param {{ direction?: 'asc' | 'desc' }} [opts]
 * @returns {number[]} indices into `keyValues` in sorted order
 */
export function sortPermutation(keyValues, opts = {}) {
	const direction = opts.direction === 'desc' ? 'desc' : 'asc';
	const dir = direction === 'desc' ? -1 : 1;
	const n = keyValues.length;

	const decorated = new Array(n);
	for (let i = 0; i < n; i++) {
		const v = keyValues[i];
		if (isMissing(v)) {
			decorated[i] = { i, missing: true, key: null };
		} else {
			decorated[i] = { i, missing: false, key: keyOf(v) };
		}
	}

	decorated.sort((a, b) => {
		// Missing always last, regardless of direction; stable among themselves.
		if (a.missing && b.missing) return a.i - b.i;
		if (a.missing) return 1;
		if (b.missing) return -1;

		const cmp = compareKeys(a.key, b.key);
		if (cmp !== 0) return dir * cmp;
		return a.i - b.i; // stable tie-break
	});

	return decorated.map((d) => d.i);
}

/**
 * Reorder an array by a permutation produced by {@link sortPermutation}.
 * Returns a new array; the input is not mutated.
 *
 * @template T
 * @param {ReadonlyArray<T>} arr
 * @param {ReadonlyArray<number>} indices
 * @returns {T[]}
 */
export function applyPermutation(arr, indices) {
	const out = new Array(indices.length);
	for (let k = 0; k < indices.length; k++) {
		out[k] = arr[indices[k]];
	}
	return out;
}

/**
 * Convenience: return `keyValues` sorted directly (key column case). Equivalent
 * to `applyPermutation(keyValues, sortPermutation(keyValues, opts))`.
 *
 * @param {ReadonlyArray<any>} keyValues
 * @param {{ direction?: 'asc' | 'desc' }} [opts]
 */
export function sortValues(keyValues, opts = {}) {
	return applyPermutation(keyValues, sortPermutation(keyValues, opts));
}

/**
 * Cheap O(n) check: is `keyValues` already in `direction` order (ignoring
 * trailing missing values)? Useful for deciding whether a sort is needed and
 * for future "data looks out of order" hints. Pure; time pre-converted to numbers.
 *
 * @param {ReadonlyArray<any>} keyValues
 * @param {{ direction?: 'asc' | 'desc' }} [opts]
 * @returns {boolean}
 */
export function isSorted(keyValues, opts = {}) {
	const dir = opts.direction === 'desc' ? -1 : 1;
	let prev = null;
	let started = false;
	for (let i = 0; i < keyValues.length; i++) {
		const v = keyValues[i];
		if (isMissing(v)) continue; // trailing/interspersed missing ignored for the order check
		const key = keyOf(v);
		if (started && dir * compareKeys(prev, key) > 0) return false; // prev should not come after key
		prev = key;
		started = true;
	}
	return true;
}
