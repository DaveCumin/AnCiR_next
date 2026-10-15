// Display-side reads of an overlay HOST (overlays plan 2026-10-15, step 2): what the plot
// layer and an Overlays-tab block need beyond the model itself. Pure functions over the host
// contract (overlayHost.js) plus the wrapper's `parentBox.id`; no Svelte, and no import of
// Overlay.svelte, so the component can use them without an import cycle through overlayHost.js.

import { capabilitiesOf, channelsFor } from './overlaySpec.js';

/**
 * The prefix for an overlay's clip-path ids: the plot (its wrapper's id) and the overlay.
 *
 * Clip ids used to be keyed on geometry alone, so two overlays on one plot, or two plots of
 * the same size (every facet panel), wrote the same id twice into one document: invalid SVG,
 * and harmless only because the rects happened to be equal. A facet panel's id is a string
 * like `12:y112#0`; anything but letters, digits, `_` and `-` becomes `_`, since `#` would end
 * the `url(#...)` reference.
 */
export function overlayClipPrefix(inner, overlay) {
	const plotId = inner?.parentBox?.id;
	const plot = plotId == null ? '' : `p${String(plotId).replace(/[^A-Za-z0-9_-]/g, '_')}-`;
	return `${plot}ov${overlay?.id ?? 0}-`;
}

const fmtNumber = (v) => String(Number(Number(v).toPrecision(4)));
const fmtTime = (v) => new Date(v).toISOString().slice(0, 16).replace('T', ' ');

/**
 * A note for an overlay block when what it would draw falls (partly) outside the plot's
 * visible range, or null. Hosts widen only their automatic range on the axes they allow
 * (`overlayCapabilities.domain`), and never one the user fixed, so a mark can sit off-screen:
 * on a periodogram, a 40 h line beyond a 1 to 30 h period range (decision Q7). The host may
 * add a remedy per axis with `overlayRangeHint(axis)`.
 */
export function overlayRangeNote(inner, overlay) {
	if (!overlay?.enabled) return null;
	const ext = overlay.domainExtension();
	const isTime = !!inner?.overlayContext?.()?.xIsTime;
	const notes = [];
	for (const axis of ['x', 'y']) {
		const e = ext?.[axis];
		const scale = axis === 'x' ? inner?.overlayXScale : inner?.overlayYScale;
		if (!e || typeof scale?.domain !== 'function') continue;
		const [d0, d1] = scale.domain();
		const lo = Math.min(d0, d1);
		const hi = Math.max(d0, d1);
		if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
		const tol = (hi - lo) * 1e-9;
		if (e[0] >= lo - tol && e[1] <= hi + tol) continue;
		const fmt = axis === 'x' && isTime ? fmtTime : fmtNumber;
		const range = `the visible ${axis} range (${fmt(lo)} to ${fmt(hi)})`;
		const all = e[1] < lo - tol || e[0] > hi + tol;
		let note = all ? `Outside ${range}, so it is not drawn.` : `Partly outside ${range}.`;
		const hint = inner?.overlayRangeHint?.(axis);
		if (hint) note += ` ${hint}`;
		notes.push(note);
	}
	return notes.length ? notes.join(' ') : null;
}

/**
 * 'Legend is off (Properties)' for a labelled overlay on a plot whose legend is hidden (a
 * periodogram's legend is off by default), else null. Silent on a host without a legend.
 */
export function overlayLegendNote(inner, overlay) {
	if (capabilitiesOf(inner)?.legend === false) return null;
	if (!(overlay?.label ?? '').trim()) return null;
	return inner?.legend && inner.legend.show === false ? 'Legend is off (Properties)' : null;
}

/**
 * The host's `overlayCapabilities.xNote` for an overlay that reads an x value (a vertical line,
 * a vertical band, a ribbon), else null. It says how a typed or wired x is read when that is
 * not the axis as shown: an FFT takes vertical positions as periods in hours, also while its
 * axis shows frequency (decision Q3).
 */
export function overlayXNote(inner, overlay) {
	const note = capabilitiesOf(inner)?.xNote;
	if (typeof note !== 'string' || !note) return null;
	return channelsFor(overlay?.kind, overlay?.form).some((c) => c.axis === 'x') ? note : null;
}
