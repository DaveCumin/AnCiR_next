// Plot overlays (reference lines and shaded bands) for add_plot / render_plot.
//
// The tool input mirrors the GUI's Overlays tab one to one; its shape (kinds, forms,
// channels, typed vs wired values, the split of a multi-column line `at`) is documented
// with the normaliser in src/lib/components/plotbits/overlaySpec.js.
//
// kind/form/keys are validated against the overlay spec (src/lib/components/plotbits/
// overlaySpec.js), the same table the GUI panel, OverlayClass and the canvas port emitter
// read, so the tool cannot drift from the app. The spec half (catalogue, normaliser, column
// bundling) is pure and lives there; this module re-exports it and adds what needs the live
// OverlayClass.

import { OverlayClass } from '$lib/components/plotbits/Overlay.svelte';

export {
	describeOverlayForms,
	normalizeOverlaySpecs,
	overlayColumnIds,
	remapOverlayColumnIds
} from '$lib/components/plotbits/overlaySpec.js';

/**
 * Attach overlay JSON to a plot inner that supports overlays (`inner.overlays`),
 * returning a summary per overlay. Throws when the plot type has no overlays.
 */
export function applyOverlays(inner, overlayJsons, plotType = 'plot') {
	if (!overlayJsons?.length) return [];
	if (!inner || !Array.isArray(inner.overlays)) {
		throw new Error(`Plot "${plotType}" does not support overlays (only scatterplot does).`);
	}
	return overlayJsons.map((json) => {
		const ov = OverlayClass.fromJSON(inner, json);
		inner.overlays.push(ov);
		return summarize(ov);
	});
}

function summarize(ov) {
	const channels = {};
	for (const { key } of OverlayClass.channelsFor(ov.kind, ov.form)) {
		channels[key] = { columns: ov.wiredRefIds(key), typed: ov.channels[key]?.typed ?? [] };
	}
	return { id: ov.id, name: ov.name, kind: ov.kind, form: ov.form, label: ov.label, channels };
}
