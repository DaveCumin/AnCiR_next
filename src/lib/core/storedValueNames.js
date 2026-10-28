// @ts-nocheck
// Default names for stored values that describe one column (v82.34).
//
// A "store this value" button names its value after the column it describes:
// `cosinor_rmse_<column>`. That part used to be the column's raw `name`, which for a node
// output is its internal name (`groupcmp_ttest_p_joined_483_38`), and for some nodes the
// OUTPUT column's internal name (`cosinor_rmse_cosinory_5_7`). It is now the column's
// DISPLAY name (core/columnLabels.js displayNameOf), made into one word: runs of spaces and
// punctuation become `_` (`groupcmp_ttest_p_amplitude`, `trend_r2_Binned_temperature`).
//
// The default name is also the value's identity (storedValueClaims.js: `<owner>|<default>`),
// so every button passes the names older versions used as `legacyNames`; a session saved
// before keeps its value, re-keyed, and a value still under its old default name takes the
// plain name, with every formula using it rewritten (David, 2026-10-25). A name the user
// chose is kept.
import { getColumnById } from './Column.svelte';
import { displayNameOf } from './columnLabels.js';

/** Text as one name part: letters, digits, `_`, `.` and `²` kept; anything else runs to `_`. */
export function storedValueSlug(text) {
	return String(text ?? '')
		.trim()
		.replace(/[^\p{L}\p{N}_.²]+/gu, '_')
		.replace(/^_+|_+$/g, '');
}

const columnOf = (col) =>
	typeof col === 'number' || (typeof col === 'string' && /^\d+$/.test(col))
		? (getColumnById(Number(col)) ?? null)
		: (col ?? null);

/**
 * `{ defaultName, legacyNames, subject }` for a StoreValueButton whose value describes `col`
 * (`subject`, the described column's id, only when there is one).
 * @param {string} prefix  e.g. 'cosinor_rmse'
 * @param {object|number|string|null} col  the column (or a plot's wrapper, or an id)
 * @param {{ suffix?: string, fallback?: string, legacy?: string[] }} [opts]
 *   suffix: appended after the column part (`_2`, `_H1`); fallback: the column part when
 *   there is no column (a plot's `data1`); legacy: other column parts older versions used
 *   (e.g. the output column's internal name).
 */
export function storedValueNames(prefix, col, { suffix = '', fallback = '', legacy = [] } = {}) {
	const c = columnOf(col);
	const shown = c ? displayNameOf(c) : '';
	const part = storedValueSlug(shown) || storedValueSlug(fallback) || String(col ?? '');
	const defaultName = `${prefix}_${part}${suffix}`;
	// What older versions embedded: the column's own name (a wrapper's frozen copy, or the
	// referenced name with its `*`), the referenced column's name, the unsanitised display
	// name (v82.32 Group Comparison), the fallback, and any caller-supplied names.
	const parts = [c?.name, c?.refColumn?.name, shown, fallback, ...legacy];
	const legacyNames = [];
	for (const p of parts) {
		if (p == null || p === '') continue;
		const n = `${prefix}_${p}${suffix}`;
		if (n !== defaultName && !legacyNames.includes(n)) legacyNames.push(n);
	}
	// The input column the value describes (a plot's wrapper names the column it references):
	// a value whose node stops using it reads missing (storedValueClaims.js).
	const subjectId =
		typeof col === 'number' || (typeof col === 'string' && /^\d+$/.test(col))
			? Number(col)
			: c?.refId != null && Number(c.refId) >= 0
				? Number(c.refId)
				: c?.id;
	return Number(subjectId) >= 0
		? { defaultName, legacyNames, subject: Number(subjectId) }
		: { defaultName, legacyNames };
}
