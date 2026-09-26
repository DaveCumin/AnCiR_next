// @ts-nocheck
// One-way migration of legacy facet CHILD plots (plan docs/plans/2026-09-26-facets-as-views.md,
// sections 2.1 and 2.2).
//
// Before v77 a faceted plot was a generator plus N real child plots (`facetParent` = the
// generator id, `facetKey` = `${gen.id}:${i}:${ref}`), saved into the session by
// `outputCoreAsJson`. Under views the children do not exist; whatever a user had set on a
// child either becomes a per-unit override on the generator (axis limits in Phase 1), is
// moved where it can only live (actogram phase markers), or is reported and dropped.
//
// Pure: parsed session JSON in, `{ json, warnings }` out. The input is never mutated (the
// result is a deep copy when there is work to do, the SAME object when there is not).
// Idempotent: the output has no children, so a second run returns it unchanged. No `core`,
// no Svelte, no plot registry: it runs in `importJson` before any Plot is built, and the
// column ids it reads need not exist yet. `importJson` is the only caller that toasts
// (`addNotification(w, 'warning', 0)` per warning).
//
// Three rules the captured fixtures (src/test/fixtures/facet-*.json, README there) forced on
// top of the plan's six steps:
//
// 1. A child that matches the reconcile's DEFAULTS is not "its own value". A child was a
//    fresh Plot whose series came from `addData`, so it carried empty labels, automatic
//    colours and the default stroke width no matter how the generator's series were styled
//    (fixture 2 shows 33 such lines on three untouched children). With `opts.childDefaults`
//    (facetMigrationDefaults.js, built from the registry by importJson) a difference is
//    reported only when the child's value differs from the generator AND from the default.
//    Without the hook (pure JSON tests) every difference is reported.
// 2. `padding.left` and `padding.bottom` are never compared: every point plot re-fits those
//    two sides from its rendered axis labels (`autoScalePadding`), so they differ between a
//    child and its generator on every session (fixture 1: 57, 51, 51, 60 against 60). Top
//    and right are compared (fixture 2, child 54). The actogram's `paddingIN` is not
//    autoscaled and is compared on all four sides.
// 3. Two children with the SAME legacy key: reloading a saved session at v76.4 minted a
//    second child set mid-import (README, "Reload behaviour"), so a session saved twice
//    carries the file's edited children and a default duplicate of each. The lowest id is
//    the file's own child (ids are monotonic and the duplicates were minted after the file's
//    ids were reserved); it is kept, the rest are dropped with a warning.
import { COLUMN_BASED_FACET_TYPES } from '$lib/core/facetTypes.js';
import { isOverridablePath } from '$lib/core/facetOverrides.js';

const deepCopy = (v) => JSON.parse(JSON.stringify(v));
const fmt = (v) => JSON.stringify(v === undefined ? null : v);
const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isLeaf = (v) => v == null || typeof v !== 'object';

/** `xlimsIN` -> "Xlims", `yLogScaleLeft` -> "Y Log Scale Left"; the sharedControls rule. */
function titleCase(key) {
	const stripped = String(key).endsWith('IN') ? String(key).slice(0, -2) : String(key);
	return stripped
		.replace(/([A-Z])/g, ' $1')
		.replace(/^./, (c) => c.toUpperCase())
		.trim();
}

// Top-level inner keys that are never shared properties (sharedControls.TOP_LEVEL_SKIP plus
// overlays, which are generator-owned and replicated, plan 1.6).
const TOP_LEVEL_SKIP = new Set(['data', 'annotations', 'parentBox', 'overlays']);
// Series keys that are wiring or handled separately, never a per-series style difference.
const SERIES_SKIP = new Set(['x', 'y', 'column', 'phaseMarkers']);
// `padding` leaves the point plots re-fit from the rendered axis labels (rule 2 above).
const AUTOSCALED_PADDING = new Set(['left', 'bottom']);

/** True when a default is known for this path and the child's value equals it. */
function equalsDefault(defaults, path, childValue) {
	if (!isPlainObject(defaults)) return false;
	const segs = path.match(/[^.[\]]+/g) ?? [];
	let cur = defaults;
	for (const seg of segs) {
		if (cur == null || typeof cur !== 'object' || !(seg in cur)) return false;
		cur = cur[seg];
	}
	return isLeaf(cur) && fmt(cur) === fmt(childValue);
}

/**
 * The legacy unit list of a generator, from its JSON alone: mirrors `facetUnits` (Plot.svelte)
 * without the column-existence check (the columns are not built yet). Each unit carries the
 * legacy key, the role/ref of the new identity, its primary index `i`, and the generator data
 * indices its series come from.
 */
function legacyUnitsFromJson(gen) {
	const data = Array.isArray(gen?.plot?.data) ? gen.plot.data : [];
	if (COLUMN_BASED_FACET_TYPES.has(gen.type)) {
		const units = [];
		data.forEach((dp, di) => {
			const ref = dp?.column?.refId ?? -1;
			if (ref < 0) return;
			const i = units.length;
			units.push({ legacyKey: `${gen.id}:${i}:${ref}`, role: 'c', ref, i, seriesIdx: [di] });
		});
		return units;
	}
	const sets = [];
	data.forEach((dp, di) => {
		const xRef = dp?.x?.refId ?? -1;
		const yRef = dp?.y?.refId ?? -1;
		let s = sets.find((ss) => ss.xRefId === xRef);
		if (!s) {
			s = { xRefId: xRef, ys: [], idx: [] };
			sets.push(s);
		}
		if (yRef >= 0) {
			s.ys.push(yRef);
			s.idx.push(di);
		}
	});
	const primary = sets[0] ?? { ys: [], idx: [] };
	return primary.ys.map((ref, i) => {
		const seriesIdx = [primary.idx[i]];
		for (let k = 1; k < sets.length; k++) if (i < sets[k].ys.length) seriesIdx.push(sets[k].idx[i]);
		return { legacyKey: `${gen.id}:${i}:${ref}`, role: 'y', ref, i, seriesIdx };
	});
}

/**
 * Leaf paths where a child's inner differs from the generator's, on the paths
 * `getSharedSchema` would expose, reflected over the JSON: scalar keys, plain objects to one
 * level of scalar leaves (paddings, axes, legends), arrays of primitives by index. Series
 * rows (`data`), overlays and annotations are excluded. A key the child lacks is not a
 * difference.
 * @returns {{ path: string, label: string, childValue: any, genValue: any }[]}
 */
function sharedPathDiffs(childInner, genInner) {
	const out = [];
	if (!isPlainObject(genInner) || !isPlainObject(childInner)) return out;
	for (const [key, gv] of Object.entries(genInner)) {
		if (TOP_LEVEL_SKIP.has(key)) continue;
		if (!(key in childInner)) continue;
		const cv = childInner[key];
		const label = titleCase(key);
		if (isLeaf(gv)) {
			if (isLeaf(cv) && fmt(cv) !== fmt(gv))
				out.push({ path: key, label, childValue: cv, genValue: gv });
			continue;
		}
		if (Array.isArray(gv)) {
			if (!Array.isArray(cv) || !gv.every(isLeaf)) continue; // arrays of objects are rows
			gv.forEach((leaf, i) => {
				const c = cv[i];
				if (i < cv.length && isLeaf(c) && fmt(c) !== fmt(leaf)) {
					out.push({
						path: `${key}[${i}]`,
						label: `${label} [${i}]`,
						childValue: c,
						genValue: leaf
					});
				}
			});
			continue;
		}
		if (!isPlainObject(cv)) continue;
		for (const [leafKey, leaf] of Object.entries(gv)) {
			if (key === 'padding' && AUTOSCALED_PADDING.has(leafKey)) continue;
			if (!isLeaf(leaf) || !(leafKey in cv) || !isLeaf(cv[leafKey])) continue;
			if (fmt(cv[leafKey]) !== fmt(leaf)) {
				out.push({
					path: `${key}.${leafKey}`,
					label: `${label} ${titleCase(leafKey)}`,
					childValue: cv[leafKey],
					genValue: leaf
				});
			}
		}
	}
	return out;
}

/** Same reflection over one series row (style slots such as `points.radius`, scalars such as `label`). */
function seriesDiffs(childSeries, genSeries) {
	const out = [];
	if (!isPlainObject(genSeries) || !isPlainObject(childSeries)) return out;
	for (const [key, gv] of Object.entries(genSeries)) {
		if (SERIES_SKIP.has(key) || !(key in childSeries)) continue;
		const cv = childSeries[key];
		const label = titleCase(key);
		if (isLeaf(gv)) {
			if (isLeaf(cv) && fmt(cv) !== fmt(gv))
				out.push({ path: key, label, childValue: cv, genValue: gv });
			continue;
		}
		if (!isPlainObject(gv) || !isPlainObject(cv)) continue;
		for (const [leafKey, leaf] of Object.entries(gv)) {
			if (!isLeaf(leaf) || !(leafKey in cv) || !isLeaf(cv[leafKey])) continue;
			if (fmt(cv[leafKey]) !== fmt(leaf)) {
				out.push({
					path: `${key}.${leafKey}`,
					label: `${label} ${titleCase(leafKey)}`,
					childValue: cv[leafKey],
					genValue: leaf
				});
			}
		}
	}
	return out;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Migrate legacy facet children in a parsed session.
 * @param {object} jsonData parsed session JSON
 * @param {{ childDefaults?: (type: string) => ({ inner: object, series: object|null } | null) }} [opts]
 *   `childDefaults`: the reconcile's default child per type (facetMigrationDefaults.js).
 *   Differences equal to a default are not the user's and are not reported (rule 1 above).
 * @returns {{ json: object, warnings: string[], mapping: { plotId: any, generatorId: any, unitKey: string }[] }}
 *   `json` is the input object itself when there was nothing to migrate; `warnings` has one
 *   entry per generator (lines joined with '\n'), in order of the generator's first child in
 *   the file; `mapping` records which unit key each migrated child became (audit only).
 */
export function migrateFacetChildren(jsonData, opts = {}) {
	const childDefaults = typeof opts?.childDefaults === 'function' ? opts.childDefaults : () => null;
	const plotsIn = Array.isArray(jsonData?.plots) ? jsonData.plots : null;
	if (!plotsIn || !plotsIn.some((p) => p && p.facetParent != null)) {
		return { json: jsonData, warnings: [], mapping: [] };
	}

	const json = deepCopy(jsonData);
	const plots = json.plots;
	const byId = new Map(plots.map((p) => [p?.id, p]));
	const children = plots.filter((p) => p && p.facetParent != null);

	// One group per generator id (or per missing id), in order of first appearance.
	const groups = new Map();
	const mapping = [];
	const report = (genId, line) => {
		if (!groups.has(genId)) groups.set(genId, []);
		groups.get(genId).push(line);
	};

	// Legacy unit lists per generator, and which children are valid panels of them.
	const unitsOf = new Map();
	const unitFor = (gen, child) => {
		if (!unitsOf.has(gen.id)) unitsOf.set(gen.id, legacyUnitsFromJson(gen));
		return unitsOf.get(gen.id).find((u) => u.legacyKey === child.facetKey) ?? null;
	};

	// Rule 3: of several children on one legacy key, the lowest id is the file's own child.
	const keeper = new Map(); // `${genId}|${facetKey}` -> child
	for (const child of children) {
		const k = `${child.facetParent}|${child.facetKey}`;
		const cur = keeper.get(k);
		if (!cur || Number(child.id) < Number(cur.id)) keeper.set(k, child);
	}
	const isDuplicate = (child) => keeper.get(`${child.facetParent}|${child.facetKey}`) !== child;

	for (const child of children) {
		const gen = byId.get(child.facetParent);
		if (!gen || gen.facet !== true) {
			// Step 1 (and step 6 for a parent that is no longer a generator).
			report(
				child.facetParent,
				`Plot '${child.name}' was a facet panel of a plot that no longer exists; it was dropped`
			);
			continue;
		}
		const unit = unitFor(gen, child);
		if (!unit) {
			// Step 6: a key the generator's series no longer produce (a previous reconcile would have pruned it).
			report(
				gen.id,
				`Plot '${child.name}' was a stale facet panel of '${gen.name}' (its series is no longer wired to the plot); it was dropped`
			);
			continue;
		}
		if (isDuplicate(child)) {
			const kept = keeper.get(`${child.facetParent}|${child.facetKey}`);
			report(
				gen.id,
				`Plot '${child.name}' (id ${child.id}) was a duplicate facet panel of '${gen.name}' (the same series as plot ${kept.id}); it was dropped`
			);
			continue;
		}

		// Step 2: the new identity. Ordinal = earlier VALID children of this generator on the same column.
		const ordinal = children.filter((c) => {
			if (c === child || c.facetParent !== gen.id || isDuplicate(c)) return false;
			const u = unitFor(gen, c);
			return u != null && u.ref === unit.ref && u.i < unit.i;
		}).length;
		const unitKey = `${unit.role}${unit.ref}#${ordinal}`;
		mapping.push({ plotId: child.id, generatorId: gen.id, unitKey });
		const defaults = childDefaults(gen.type);

		// Step 3: whole-plot differences. Limits carry as overrides; the rest is reported
		// unless it is what the reconcile gave every child (rule 1).
		for (const d of sharedPathDiffs(child.plot, gen.plot)) {
			if (isOverridablePath(gen.type, d.path)) {
				gen.facetOverrides ??= {};
				gen.facetOverrides[unitKey] ??= {};
				gen.facetOverrides[unitKey][d.path] = deepCopy(d.childValue);
			} else if (!equalsDefault(defaults?.inner, d.path, d.childValue)) {
				report(
					gen.id,
					`Panel '${child.name}' of '${gen.name}' had its own ${d.label} (${fmt(d.childValue)}); facets now share the plot's value (${fmt(d.genValue)})`
				);
			}
		}

		// Step 4: per-series differences, child series j against generator series seriesIdx[j].
		const childData = Array.isArray(child.plot?.data) ? child.plot.data : [];
		unit.seriesIdx.forEach((gi, j) => {
			const cs = childData[j];
			const gs = gen.plot?.data?.[gi];
			if (!isPlainObject(cs) || !isPlainObject(gs)) return;
			const n = gi + 1;

			const cm = Array.isArray(cs.phaseMarkers) ? cs.phaseMarkers : [];
			const gm = Array.isArray(gs.phaseMarkers) ? gs.phaseMarkers : [];
			if (cm.length > 0 && gm.length === 0) {
				// Per-panel data by construction, with nowhere else to live: moved, not dropped.
				gs.phaseMarkers = deepCopy(cm);
				report(
					gen.id,
					`Panel '${child.name}' of '${gen.name}' had ${plural(cm.length, 'phase marker block')}; it was moved onto the plot's series ${n}`
				);
			} else if (cm.length > 0 && fmt(cm) !== fmt(gm)) {
				report(
					gen.id,
					`Panel '${child.name}' of '${gen.name}' had its own phase markers (${plural(cm.length, 'block')}); facets now use the plot's series ${n} markers (${plural(gm.length, 'block')})`
				);
			}

			for (const d of seriesDiffs(cs, gs)) {
				if (equalsDefault(defaults?.series, d.path, d.childValue)) continue;
				report(
					gen.id,
					`Panel '${child.name}' of '${gen.name}' had its own series ${n} ${d.label} (${fmt(d.childValue)}); facets now share the plot's value (${fmt(d.genValue)})`
				);
			}
		});
	}

	// Step 5: drop every child; strip the legacy fields from every plot.
	json.plots = plots.filter((p) => !(p && p.facetParent != null));
	for (const p of json.plots) {
		if (!p || typeof p !== 'object') continue;
		delete p.facetParent;
		delete p.facetKey;
	}

	const warnings = [...groups.values()]
		.filter((lines) => lines.length > 0)
		.map((lines) => lines.join('\n'));
	return { json, warnings, mapping };
}
