// Colour by / Size by through the engine's add_plot (colour-by plan 2026-10-20, section 3.9).
//
// The rules are the app's (src/lib/components/plotbits/encodingSpec.js), the same ones a session
// draft and the app's AI edit use, so add_plot accepts the same `colourBy` / `sizeBy` syntax and
// refuses the same things in the same words. The difference is only in what a refusal costs: a
// draft keeps the series and drops the encoding, while add_plot validates BEFORE committing the
// plot (like its inputs and overlays) and adds nothing, so a retry does not leave a duplicate.
//
// The facts are read live from the app's encodings.js / colormaps.js and each plot class's
// `encodingCapabilities` (the Worker reads the same facts baked into its generated catalogue).

import { appConsts, core } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import * as encodingsLib from '$lib/components/plotbits/encodings.js';
import { COLORMAP_META } from '$lib/components/plotbits/colormaps.js';
import {
	encodingFacts,
	encodingCapsOf,
	encodingColumnKind,
	draftSeriesEncodings,
	draftAsksForEncoding,
	applySeriesEncodings,
	describePlotEncodings
} from '$lib/components/plotbits/encodingSpec.js';

/** plots[type].encodings for every registered plot (null entries for non-hosts are omitted). */
export function encodingPlotSchemas() {
	const out = {};
	for (const [type, entry] of appConsts.plotMap ?? new Map()) {
		const caps = encodingCapsOf(entry.data?.encodingCapabilities);
		out[type] = caps ? { encodings: caps } : {};
	}
	return out;
}

/** The live facts (modes, the modes per kind of column, colormaps, radius defaults). */
export function liveEncodingFacts() {
	return encodingFacts(encodingsLib, COLORMAP_META);
}

/** The plot types that can colour (and size) their marks by a column, for the tool text. */
export function encodingHostsSummary() {
	const schemas = encodingPlotSchemas();
	const hosts = (ch) =>
		Object.entries(schemas)
			.filter(([, s]) => s.encodings?.[ch])
			.map(([t]) => t)
			.sort();
	const facts = liveEncodingFacts();
	const maps = Object.entries(facts.colormaps);
	const mapsOf = (cyclic) =>
		maps
			.filter(([, k]) => (k === 'cyclic') === cyclic)
			.map(([m]) => m)
			.join('|');
	return {
		colourHosts: hosts('colour'),
		sizeHosts: hosts('size'),
		modes: facts.modes,
		sizeModes: facts.sizeModes,
		cyclicModes: facts.cyclicModes,
		sequentialMaps: mapsOf(false),
		cyclicMaps: mapsOf(true)
	};
}

/**
 * Check a plot's `colourBy` / `sizeBy` for its ONE series and return the series fields to
 * apply, or throw (nothing committed) with the shared refusal text.
 *
 * @param {string} type  plot type
 * @param {{colourBy?: any, colorBy?: any, sizeBy?: any}} spec
 * @param {(ref:any)=>number} resolveColRef  name / id to a column id (throws when unknown)
 * @returns {{ fields: object, warnings: string[] }}
 */
export function plotEncodingFields(type, spec, resolveColRef) {
	if (!spec || !draftAsksForEncoding(spec)) return { fields: {}, warnings: [] };
	const errors = [];
	const warnings = [];
	const descriptor = (col) => ({
		id: col.id,
		name: col.name,
		type: col.type,
		originTime_ms: col.originTime_ms
	});
	const fields = draftSeriesEncodings(spec, 0, {
		plotType: type,
		plotSchemas: encodingPlotSchemas(),
		encodings: liveEncodingFacts(),
		resolveRef: (ref) => {
			try {
				const id = resolveColRef(ref);
				return getColumnById(id) ? id : null;
			} catch {
				return null; // the shared message names what IS available
			}
		},
		data: core.data.map(descriptor),
		columnOf: (id) => {
			const col = getColumnById(id);
			return col ? descriptor(col) : null;
		},
		kindOf: (col) => {
			let n = 0;
			try {
				n = getColumnById(col.id)?.getData?.()?.length ?? 0;
			} catch {
				n = 0;
			}
			return encodingColumnKind(col, n > 0);
		},
		where: `add_plot ${type}:`,
		dropNote: 'Nothing was added.',
		errors,
		warnings
	});
	if (errors.length) throw new Error(errors.join(' '));
	return { fields, warnings };
}

/** Write checked fields onto a live series (its setters take the saved JSON). */
export function applyPlotEncodingFields(series, fields) {
	if (series && fields && Object.keys(fields).length) applySeriesEncodings(series, fields);
}

/** The plot's encodings by column name, for a tool result. */
export function plotEncodingSummary(plotWrapper) {
	const inner = plotWrapper?.plot?.toJSON?.() ?? plotWrapper?.plot;
	return describePlotEncodings({ plot: inner }, (id) => getColumnById(id)?.name ?? null);
}
