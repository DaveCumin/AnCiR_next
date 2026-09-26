// @ts-nocheck
// The per-panel override map (plan 2026-09-26-facets-as-views, section 1.6), Phase 1 scope.
//
// A facet generator carries `facetOverrides = { [unitKey]: { [path]: value } }`, keyed by the
// unit key (`y112#0`, `c241#0`) so a series reorder keeps an override with its panel and a
// rewire orphans it. `path` is a dotted path INTO THE INNER (`'xlimsIN[0]'`, `'ylimsLeftIN'`,
// later `'paddingIN.top'`), i.e. the shared-panel path with its `plot.` head removed. A whole
// array (`'ylimsLeftIN'`) and a single leaf (`'ylimsLeftIN[1]'`) are both valid, because the
// brush-zoom writes whole arrays and the migration writes leaves.
//
// Phase 1 admits exactly one key group, the axis limits, because brush-zoom on a panel writes
// x+y to the brushed panel and x to its siblings (as it did to the child plots before views),
// and that per-panel y has nowhere else to live. The editor UI and the general key set are
// Phase 2.
//
// Pure: no Svelte, no `core`. The migration runs this on session JSON.
import { setByPath } from '$lib/utils/objectPath.js';

/**
 * The overridable inner keys per plot type in Phase 1: every axis-limit field the type's
 * `fromJSON` reads, which is also what its zoom adapter writes (plots/zoomAdapters.js) and
 * what its controls' limit inputs edit. Listed per type so a new limit field on a plot is a
 * visible one-line addition here.
 *
 * - scatterplot: xlimsIN, ylimsLeftIN, ylimsRightIN (Scatterplot.svelte, applyLinkedZoom)
 * - histogram: xlimsIN, ylimsIN (Histogram.svelte; not zoom-capable, limit inputs only)
 * - actogram: ylimsIN (Actogram.svelte; not zoom-capable, the Y-lims inputs)
 * - correlogram: laglimsIN, ylimsIN (correlogramAdapter)
 * - periodogram: periodlimsIN, ylimsIN (periodogramAdapter)
 * - fft: xlimsIN, ylimsIN, phaseYlimsIN (fftAdapter)
 */
export const OVERRIDABLE_PHASE1 = Object.freeze({
	scatterplot: Object.freeze(['xlimsIN', 'ylimsLeftIN', 'ylimsRightIN']),
	histogram: Object.freeze(['xlimsIN', 'ylimsIN']),
	actogram: Object.freeze(['ylimsIN']),
	correlogram: Object.freeze(['laglimsIN', 'ylimsIN']),
	periodogram: Object.freeze(['periodlimsIN', 'ylimsIN']),
	fft: Object.freeze(['xlimsIN', 'ylimsIN', 'phaseYlimsIN'])
});

/** The first segment of a dotted/indexed path: `'xlimsIN[0]'` and `'paddingIN.top'` give their roots. */
export function overridePathRoot(path) {
	const m = /^[^.[\]]+/.exec(String(path ?? ''));
	return m ? m[0] : '';
}

/** Whether `path` (leaf or whole key) is overridable for a plot type in this phase. */
export function isOverridablePath(type, path) {
	const keys = OVERRIDABLE_PHASE1[type];
	if (!keys) return false;
	const root = overridePathRoot(path);
	return root !== '' && keys.includes(root);
}

const isPlainObject = (v) =>
	v != null &&
	typeof v === 'object' &&
	!Array.isArray(v) &&
	Object.getPrototypeOf(v) === Object.prototype;

const isPrimitive = (v) =>
	v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';

/** An override value is a primitive or a flat array of primitives (an axis-limit pair). */
export function isValidOverrideValue(v) {
	return isPrimitive(v) || (Array.isArray(v) && v.every(isPrimitive));
}

/**
 * Validate the whole map: a plain object whose values are plain objects of valid override
 * values under non-empty path keys. Returns the reason string for the first violation, or
 * null when the shape is right. Shared by `sanitiseOverrides` and `isValidOverrideMap` so
 * the two can never disagree.
 */
function overrideMapProblem(value) {
	if (value === undefined) return null;
	if (!isPlainObject(value)) return `facetOverrides must be an object, got ${describe(value)}`;
	for (const [unitKey, entry] of Object.entries(value)) {
		if (!isPlainObject(entry)) {
			return `facetOverrides['${unitKey}'] must be an object of paths, got ${describe(entry)}`;
		}
		for (const [path, v] of Object.entries(entry)) {
			if (path === '') return `facetOverrides['${unitKey}'] has an empty path`;
			if (!isValidOverrideValue(v)) {
				return `facetOverrides['${unitKey}']['${path}'] must be a primitive or an array of primitives, got ${describe(v)}`;
			}
		}
	}
	return null;
}

function describe(v) {
	if (v === null) return 'null';
	if (Array.isArray(v)) return 'an array';
	return typeof v === 'object' ? 'an object' : typeof v;
}

/** The shape guard `Plot.fromJSON` and plotFromJSONRobustness use. */
export function isValidOverrideMap(value) {
	return value !== undefined && overrideMapProblem(value) === null;
}

/**
 * A safe copy of an override map. Any wrong shape, anywhere in it, yields `{}` and a reason
 * (the load path turns the reason into a warning); a missing map is `{}` with no reason.
 * @returns {{ overrides: object, reason: string|null }}
 */
export function sanitiseOverrides(value) {
	const reason = overrideMapProblem(value);
	if (reason) return { overrides: {}, reason };
	const overrides = {};
	for (const [unitKey, entry] of Object.entries(value ?? {})) {
		overrides[unitKey] = {};
		for (const [path, v] of Object.entries(entry)) {
			overrides[unitKey][path] = Array.isArray(v) ? [...v] : v;
		}
	}
	return { overrides, reason: null };
}

/**
 * Set each override path on a projected inner JSON, before `fromJSON` builds the panel
 * instance. Malformed entries are skipped, arrays are copied.
 * @returns {string[]} the paths written, in map order
 */
export function applyOverride(json, override) {
	if (!json || !isPlainObject(override)) return [];
	const written = [];
	for (const [path, v] of Object.entries(override)) {
		if (path === '' || !isValidOverrideValue(v)) continue;
		setByPath(json, path, Array.isArray(v) ? [...v] : v);
		written.push(path);
	}
	return written;
}

/**
 * Whether `path` is overridden in a unit's map: exactly, by a whole-key override above it,
 * or (for a root key) by any leaf below it.
 */
export function isOverridden(override, path) {
	if (!isPlainObject(override) || !path) return false;
	if (Object.prototype.hasOwnProperty.call(override, path)) return true;
	const root = overridePathRoot(path);
	if (root === '') return false;
	if (path !== root && Object.prototype.hasOwnProperty.call(override, root)) return true;
	if (path === root) {
		return Object.keys(override).some((k) => overridePathRoot(k) === root);
	}
	return false;
}
