// Plot overlays (reference lines and shaded bands) for add_plot / render_plot, on every plot
// whose class declares `overlayCapabilities` (Scatterplot, Periodogram, Correlogram, ...).
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
import { allowedForms, capabilitiesOf } from '$lib/components/plotbits/overlaySpec.js';
import { appConsts } from '$lib/core/core.svelte.js';

export {
	describeOverlayForms,
	normalizeOverlaySpecs,
	overlayColumnIds,
	overlayDomainAxes,
	remapOverlayColumnIds
} from '$lib/components/plotbits/overlaySpec.js';

/** The plot types that carry overlays (their class declares `overlayCapabilities`), sorted. */
export function overlayHostTypes() {
	return [...(appConsts.plotMap ?? new Map())]
		.filter(([, entry]) => entry?.data?.overlayCapabilities)
		.map(([id]) => id)
		.sort();
}

/**
 * One line naming each host and the forms it allows, for the tool descriptions:
 * "correlogram: line vertical | horizontal, band vertical | horizontal; periodogram: ...".
 * Read from the registry, so a plot that gains overlays is described without editing text.
 */
export function overlayFormsSummary() {
	return overlayHostTypes()
		.map((id) => {
			const caps = appConsts.plotMap.get(id).data.overlayCapabilities;
			const kinds = ['line', 'band']
				.map((kind) => [kind, allowedForms(caps, kind)])
				.filter(([, forms]) => forms.length)
				.map(([kind, forms]) => `${kind} ${forms.join(' | ')}`);
			return `${id}: ${kinds.join(', ')}`;
		})
		.join('; ');
}

/** The error for overlays sent to a plot type that has none, naming the ones that do. */
export function unsupportedOverlaysError(plotType) {
	const hosts = overlayHostTypes();
	return new Error(
		`Plot "${plotType}" does not support overlays. Plots that do: ${hosts.join(', ') || '(none)'} ` +
			'(list_capabilities → plots[].overlays lists the lines and bands each one allows).'
	);
}

/**
 * Attach overlay JSON to a plot inner that is an overlay host, returning a summary per
 * overlay. Throws when the plot has no overlays, or when an overlay's kind or form is not one
 * the plot allows (normalizeOverlaySpecs with the plot's capabilities refuses those first; this
 * guards any other caller, so a disallowed form is never silently coerced into another).
 */
export function applyOverlays(inner, overlayJsons, plotType = 'plot') {
	if (!overlayJsons?.length) return [];
	const caps = capabilitiesOf(inner);
	if (!inner || !Array.isArray(inner.overlays) || !caps) throw unsupportedOverlaysError(plotType);
	overlayJsons.forEach((json, i) => {
		const forms = allowedForms(caps, json?.kind);
		const form = json?.form ?? forms[0];
		if (!forms.includes(form)) {
			throw new Error(
				forms.length
					? `overlays[${i}]: a ${plotType} has no ${json?.kind} of form "${form}" (it allows ${forms.join(' | ')}).`
					: `overlays[${i}]: a ${plotType} has no ${JSON.stringify(json?.kind)} overlays.`
			);
		}
	});
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
