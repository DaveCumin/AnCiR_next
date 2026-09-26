// plotZoom.js
//
// Applying brush-zoom limits to a plot or a facet PANEL, with the facet "link-zoom".
//
// A faceted plot is one generator plus N derived panels (core/facetPanels.svelte.js). Small
// multiples share the X axis (typically time) but each panel shows a DIFFERENT series, so
// the Y range is meaningful per panel. Link-zoom therefore writes the x-limits ONCE, on the
// generator's inner (every panel projects it), and the y-limits to the brushed panel's
// override (`generator.facetOverrides[unitKey]`, plan 1.6), which only that panel's
// projection applies. A standalone plot gets everything on its own inner, as before.
//
// Plain writes, not history ops: brush and wheel zoom were never undo steps (they write the
// same *IN limit overrides the axis inputs edit, and a wheel tick per step would flood the
// stack), and a half-recorded zoom (y on the stack, x not) would be worse than neither.
// The control panel's per-panel editor (Phase 2) records through the setFacetOverride op.
//
// No `core` import: a ref carries everything (a panel knows its generator), so this stays
// unit-testable on stand-ins.
import { overridePathRoot } from '$lib/core/facetOverrides.js';

/**
 * @typedef {{ xlims?: (number|null)[], ylimsLeft?: (number|null)[]|null, ylimsRight?: (number|null)[]|null }} Limits
 */

const isPanel = (ref) => ref != null && typeof ref === 'object' && ref.generator != null;
const isReset = (pair) => Array.isArray(pair) && pair.every((v) => v == null);

/**
 * Write one axis-limit key for a ref.
 *
 * - a plot: `ref.plot[key] = value`;
 * - a panel, `shared` (an x axis): the generator's inner, so every panel follows;
 * - a panel, not shared (a y axis): the panel's override entry. An all-null pair REMOVES the
 *   override (the panel falls back to the generator's value), so a reset leaves no trace.
 *
 * @param {any} ref a Plot or a FacetPanel
 * @param {string} key an inner limit key ('xlimsIN', 'ylimsLeftIN', 'periodlimsIN', ...)
 * @param {(number|null)[]} value copied, never aliased
 * @param {{ shared?: boolean }} [opts]
 */
export function writeAxisLimit(ref, key, value, { shared = false } = {}) {
	if (!ref || !Array.isArray(value)) return;
	if (!isPanel(ref)) {
		if (ref.plot) ref.plot[key] = [...value];
		return;
	}
	const gen = ref.generator;
	if (shared) {
		if (gen.plot) gen.plot[key] = [...value];
		return;
	}
	if (!gen.facetOverrides || typeof gen.facetOverrides !== 'object') gen.facetOverrides = {};
	const map = gen.facetOverrides;
	// Every path under this key goes: the whole-key form and any leaf form (`ylimsLeftIN[0]`,
	// which the migration writes). A brush supersedes both, and a reset must leave neither.
	const entry = map[ref.unitKey];
	if (entry) {
		for (const path of Object.keys(entry)) if (overridePathRoot(path) === key) delete entry[path];
		if (Object.keys(entry).length === 0) delete map[ref.unitKey];
	}
	if (isReset(value)) return;
	if (!map[ref.unitKey]) map[ref.unitKey] = {};
	map[ref.unitKey][key] = [...value];
}

/**
 * Apply scatterplot zoom limits to `ref` (a plot or a panel). On a panel the x-range is
 * shared across the whole facet set and the y-limits stay with the brushed panel.
 * Missing keys are skipped; a null pair resets that axis.
 * @param {any} ref   the plot or panel the user brushed
 * @param {Limits} limits
 */
export function applyLinkedZoom(ref, limits) {
	if (!ref || !limits) return;
	if (limits.xlims) writeAxisLimit(ref, 'xlimsIN', limits.xlims, { shared: true });
	if (limits.ylimsLeft) writeAxisLimit(ref, 'ylimsLeftIN', limits.ylimsLeft);
	if (limits.ylimsRight) writeAxisLimit(ref, 'ylimsRightIN', limits.ylimsRight);
}
