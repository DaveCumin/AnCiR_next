// The overlay HOST contract: what a plot provides so it can carry reference lines and
// shaded bands (overlays plan 2026-10-15, section 2), plus the helpers every host shares.
//
// A host is a plot's inner data object (Scatterplotclass today). OverlayClass, the Overlays
// tab, OverlayLayers and the helpers below read the host ONLY through these members, so a
// new plot gains overlays by meeting this list and nothing else:
//
//   static overlayCapabilities = {
//     line: ['vertical', 'horizontal'],          // allowed forms, panel order
//     band: ['ribbon', 'horizontal', 'vertical', 'repeating'],
//     legend: true,                              // false hides the Label field
//     xTime: false                               // true only where x can be a time
//   };
//   overlays = $state([]);                       // OverlayClass instances, draw order
//   addOverlay(kind, form) / removeOverlay(id)
//   overlayXScale, overlayYScale                 // d3-like; .range() = [0, w] / [h, 0]
//   padding                                      // { left, top }: where the plot area starts
//   overlayContext()                             // { xDomainMin, xDomainMax, xAnchorMin, xIsTime }
//   overlaySeriesColour()                        // ribbon default fill; null falls back
//   overlayXValueFor(column)        (optional)   // x-channel mapper for a wired column, or null
//
// `overlayXValueFor` returns a function `(v) => axisValue` (or null for identity) rather than
// converting one value at a time: resolving a column's time origin walks its reference
// chain, which must happen once per column, not once per value.
//
// `ProcessNode.supportsOverlays` and the canvas wiring key on `Array.isArray(inner.overlays)`;
// the MCP catalogue keys on the class's `overlayCapabilities`.

import { OverlayClass } from './Overlay.svelte';
import { allowedKinds, capabilitiesOf } from './overlaySpec.js';

/**
 * `[lo, hi]` over every enabled overlay's `domainExtension()[axis]`, or null when none
 * contributes. A host merges this into its AUTOMATIC limits, so a reference mark is never
 * silently off-screen; manual limits still win (the host applies them after).
 */
export function overlayExtentOf(overlays, axis) {
	let lo = Infinity;
	let hi = -Infinity;
	for (const o of overlays ?? []) {
		const ext = o.domainExtension()[axis];
		if (!ext) continue;
		if (ext[0] < lo) lo = ext[0];
		if (ext[1] > hi) hi = ext[1];
	}
	return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

/** The legend items of every enabled, labelled overlay, in draw order. */
export function overlayLegendItems(overlays) {
	const items = [];
	for (const overlay of overlays ?? []) {
		if (!overlay.enabled) continue;
		const item = overlay.getLegendItem();
		if (item) items.push(item);
	}
	return items;
}

/** The saved form of a host's overlays. */
export function overlaysToJSON(overlays) {
	return (overlays ?? []).map((overlay) => overlay.toJSON());
}

/**
 * Restore saved overlays onto `host.overlays`, in order. Call it after the host's series are
 * restored: a legacy night band reads the host's time axis, and a ribbon's default fill reads
 * its series colour.
 *
 * - `json.overlays` goes through `OverlayClass.fromJSONSplit`, so a Line saved with several
 *   `at` columns (before 2026-09-18) becomes one Line per column, pushed in order so the
 *   copies' "Line N" names count the lines already restored.
 * - With `legacyNightBands`, `json.nightBands` (the pre-overlay NightBand list) is migrated
 *   to band overlays behind them (Scatterplot only).
 * - An overlay whose kind the host does not allow is dropped with a warning; a form the host
 *   does not allow is coerced by the class to the host's first form of that kind.
 */
export function overlaysFromJSON(host, json, { legacyNightBands = false } = {}) {
	const kinds = allowedKinds(capabilitiesOf(host));
	const keep = (o) => {
		if (kinds.includes(o.kind)) return true;
		console.warn(
			`Overlay "${o.name}" (${o.kind}) dropped: this plot does not support ${o.kind} overlays.`
		);
		return false;
	};
	for (const o of json?.overlays ?? []) {
		for (const ov of OverlayClass.fromJSONSplit(host, o)) {
			if (keep(ov)) host.overlays.push(ov);
		}
	}
	if (legacyNightBands) {
		for (const nb of json?.nightBands ?? []) {
			const ov = OverlayClass.fromLegacyNightBand(host, nb);
			if (keep(ov)) host.overlays.push(ov);
		}
	}
	return host.overlays;
}

/**
 * The CSV columns for a host's download: each enabled overlay's resolved positions/edges,
 * under its name. `isoX` formats an x value (an ISO string on a time axis).
 *
 * @returns {{ headers: string[], columns: Array<Array<number|string>> }}
 */
export function overlayDownloadColumns(overlays, ctx, isoX = (v) => v) {
	const headers = [];
	const columns = [];
	for (const overlay of overlays ?? []) {
		if (!overlay.enabled) continue;
		const g = overlay.geometry(ctx);
		if (g.kind === 'line') {
			headers.push(`${overlay.name}_at`);
			columns.push(g.orientation === 'vertical' ? g.positions.map(isoX) : g.positions);
		} else if (g.form === 'ribbon') {
			headers.push(`${overlay.name}_x`, `${overlay.name}_lower`, `${overlay.name}_upper`);
			columns.push(g.x.map(isoX), g.lower, g.upper);
		} else if (g.form === 'horizontal') {
			headers.push(`${overlay.name}_lower`, `${overlay.name}_upper`);
			columns.push(
				g.segments.map((seg) => seg.y0),
				g.segments.map((seg) => seg.y1)
			);
		} else {
			headers.push(`${overlay.name}_start`, `${overlay.name}_end`);
			columns.push(
				g.segments.map((seg) => isoX(seg.x0)),
				g.segments.map((seg) => isoX(seg.x1))
			);
		}
	}
	return { headers, columns };
}

const REQUIRED_METHODS = ['addOverlay', 'removeOverlay', 'overlayContext', 'overlaySeriesColour'];
const CONTEXT_KEYS = ['xDomainMin', 'xDomainMax', 'xAnchorMin', 'xIsTime'];

/**
 * Throw, naming every missing member, unless `inner` meets the host contract above. For
 * tests: a host that misses a member would otherwise fall back silently (for example a
 * repeating band with no anchor draws nothing).
 */
export function assertOverlayHost(inner) {
	const missing = [];
	const caps = capabilitiesOf(inner);
	if (!caps) missing.push('static overlayCapabilities');
	else {
		for (const k of ['line', 'band']) {
			if (!Array.isArray(caps[k])) missing.push(`overlayCapabilities.${k}`);
		}
		for (const k of ['legend', 'xTime']) {
			if (typeof caps[k] !== 'boolean') missing.push(`overlayCapabilities.${k}`);
		}
	}
	if (!Array.isArray(inner?.overlays)) missing.push('overlays');
	for (const m of REQUIRED_METHODS) {
		if (typeof inner?.[m] !== 'function') missing.push(`${m}()`);
	}
	for (const s of ['overlayXScale', 'overlayYScale']) {
		const scale = inner?.[s];
		if (typeof scale !== 'function' || typeof scale.range !== 'function') missing.push(s);
	}
	if (!Number.isFinite(inner?.padding?.left) || !Number.isFinite(inner?.padding?.top)) {
		missing.push('padding.left/top');
	}
	if (inner?.overlayXValueFor != null && typeof inner.overlayXValueFor !== 'function') {
		missing.push('overlayXValueFor() (optional, but must be a function when present)');
	}
	if (typeof inner?.overlayContext === 'function') {
		const ctx = inner.overlayContext() ?? {};
		for (const k of CONTEXT_KEYS) if (!(k in ctx)) missing.push(`overlayContext().${k}`);
	}
	if (missing.length) {
		throw new Error(`Not an overlay host; missing: ${missing.join(', ')}`);
	}
	return true;
}
