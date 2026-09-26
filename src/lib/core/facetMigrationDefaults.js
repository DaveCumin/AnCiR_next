// @ts-nocheck
// What a legacy facet CHILD looked like before anyone touched it, per plot type, built from
// the plot registry the way the v76.4 child reconcile built a child: `new Plot({ type })` gave the
// class's constructor defaults for the whole-plot properties, and `child.plot.addData(...)`
// gave each series the class's default style. The migration (facetMigration.js) compares a
// child's values against these so the reconcile's own defaults (empty labels, automatic
// colours, the default stroke width) are never reported as the user's per-panel edits.
//
// Kept out of facetMigration.js so that module stays free of the registry and pure on JSON;
// `importJson` builds the hook with `childDefaultsFromRegistry(appConsts.plotMap)` and passes
// it as `opts.childDefaults`. Never call this inside a running effect: the instances construct
// `Column` wrappers (the derived_inert rule, see plotMetricOutputs.svelte.js).
import { COLUMN_BASED_FACET_TYPES } from '$lib/core/facetTypes.js';

const snapshot = (v) =>
	JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x)));

/**
 * The default child of a plot type: `{ inner, series }` as JSON (`inner` without `data`,
 * `series` the one default series), or null when the type is unknown or cannot be built.
 * @param {Map<string, any>} plotMap the plot registry (appConsts.plotMap)
 * @param {string} type
 */
export function defaultChildFor(plotMap, type) {
	const entry = plotMap?.get?.(type);
	if (typeof entry?.data?.fromJSON !== 'function') return null;
	try {
		const inst = entry.data.fromJSON(null, undefined);
		const stub = COLUMN_BASED_FACET_TYPES.has(type)
			? { column: { refId: -1 } }
			: { x: { refId: -1 }, y: { refId: -1 } };
		if (typeof inst?.addData === 'function') inst.addData(stub);
		const json = snapshot(inst);
		const { data, ...inner } = json ?? {};
		return { inner, series: Array.isArray(data) ? (data[0] ?? null) : null };
	} catch {
		return null;
	}
}

/**
 * The `childDefaults` hook for `migrateFacetChildren`, memoised per type.
 * @param {Map<string, any>} plotMap
 * @returns {(type: string) => ({ inner: object, series: object|null } | null)}
 */
export function childDefaultsFromRegistry(plotMap) {
	const cache = Object.create(null);
	return (type) => {
		if (!(type in cache)) cache[type] = defaultChildFor(plotMap, type);
		return cache[type];
	};
}
