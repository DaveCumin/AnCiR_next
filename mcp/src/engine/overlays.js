// Scatterplot overlays (reference lines and shaded bands) for add_plot / render_plot.
//
// The tool input mirrors the GUI's Overlays tab one to one:
//
//   overlays: [{ kind: 'line'|'band', form?, name?, label?, enabled?,
//                channels?: { <key>: <value> },
//                colour?, strokeWidth?, stroke?,            // lines
//                fill?, edge?, edgeColour?, edgeWidth?,      // bands
//                repeatEveryHours?, nightDurationHours?, startTimeHours?, useDataMin? }]
//
// A channel value is either TYPED or WIRED, never both (the class enforces it):
//   number            → one typed value                (`at: 35`)
//   number[]          → typed values                   (`at: [35, 55.6]`)
//   string            → a column, by NAME or "id"      (`lower: "lower limit"`)
//   { column: ref }   → a column, by id or name        (`x: { column: 3 }`)
//   string[] / {column}[] → several columns on a line's `at` ONLY, and then the
//                       spec is SPLIT into one Line overlay per column (same
//                       form, style and label; the name goes to the first, the
//                       rest get the usual "Line N"). A channel holds one column
//                       (decision 2026-09-18), so this mirrors what the GUI does
//                       with a legacy multi-column `at` on load.
// A bare number is a VALUE, never a column id: a reference line at y = 3 and a line wired
// to column 3 are both common, so the two must not share a spelling.
//
// kind/form/keys are validated against `OverlayClass.channelsFor`, the same table the
// GUI panel and the canvas port emitter read, so the tool cannot drift from the app.

import { OverlayClass } from '$lib/plots/Scatterplot/Overlay.svelte';

const STYLE_KEYS = [
	'enabled',
	'label',
	'colour',
	'strokeWidth',
	'stroke',
	'fill',
	'edge',
	'edgeColour',
	'edgeWidth',
	'repeatEveryHours',
	'nightDurationHours',
	'startTimeHours',
	'useDataMin'
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isColRef = (v) =>
	typeof v === 'string' || (v && typeof v === 'object' && !Array.isArray(v) && 'column' in v);

/**
 * The channel table as the catalogue advertises it:
 * `{ line: { vertical: [{key, axis, dynamic}], … }, band: { … } }`.
 */
export function describeOverlayForms() {
	const out = {};
	for (const [kind, forms] of Object.entries(OverlayClass.FORMS)) {
		out[kind] = {};
		for (const form of forms) {
			out[kind][form] = OverlayClass.channelsFor(kind, form).map(({ key, axis, dynamic }) => ({
				key,
				axis,
				dynamic
			}));
		}
	}
	return out;
}

/**
 * Validate and normalise tool `overlays` into OverlayClass JSON (the shape
 * `OverlayClass.fromJSON` and the session file use): channels become
 * `{ columns: [{ refId }], typed: [] }`. A line whose `at` lists several
 * columns yields several JSONs (see splitLine), so the output may be longer
 * than the input; order is kept.
 *
 * @param {Array<object>} overlays  tool input (may be undefined)
 * @param {(ref: string|number) => number} resolveCol  column name/id → id; throws if unknown
 * @returns {Array<object>}  overlay JSON, in input order, one per resulting overlay
 */
export function normalizeOverlaySpecs(overlays, resolveCol) {
	if (overlays == null) return [];
	if (!Array.isArray(overlays)) throw new Error('`overlays` must be an array.');
	return overlays.flatMap((spec, i) => splitLine(normalizeOne(spec, i, resolveCol)));
}

/**
 * One Line per wired `at` column: the first JSON keeps the name, the copies
 * drop it (the class then names them "Line N") and share everything else. A
 * line with one or no wire, a typed line and every band pass through as `[json]`.
 */
function splitLine(json) {
	const cols = json.channels?.at?.columns ?? [];
	if (json.kind !== 'line' || cols.length <= 1) return [json];
	const shared = { ...json };
	delete shared.name;
	return cols.map((c, i) => ({
		...(i === 0 ? json : shared),
		channels: { at: { columns: [{ refId: c.refId }], typed: [] } }
	}));
}

function normalizeOne(spec, i, resolveCol) {
	const where = `overlays[${i}]`;
	if (!spec || typeof spec !== 'object') throw new Error(`${where}: expected an object.`);

	const kinds = Object.keys(OverlayClass.FORMS);
	const kind = spec.kind;
	if (!kinds.includes(kind)) {
		throw new Error(
			`${where}.kind must be one of ${kinds.join(' | ')} (got ${JSON.stringify(kind)}).`
		);
	}
	const forms = OverlayClass.FORMS[kind];
	const form = spec.form ?? OverlayClass.defaultForm(kind);
	if (!forms.includes(form)) {
		throw new Error(
			`${where}.form for a ${kind} must be one of ${forms.join(' | ')} (got ${JSON.stringify(spec.form)}).`
		);
	}

	const specs = OverlayClass.channelsFor(kind, form);
	const validKeys = specs.map((c) => c.key);
	const channels = {};
	for (const [key, value] of Object.entries(spec.channels ?? {})) {
		const cspec = specs.find((c) => c.key === key);
		if (!cspec) {
			throw new Error(
				`${where}.channels.${key}: a ${kind} of form "${form}" has ${
					validKeys.length ? `channels ${validKeys.join(', ')}` : 'no channels'
				}.`
			);
		}
		channels[key] = normalizeChannel(value, cspec, `${where}.channels.${key}`, resolveCol);
	}

	const json = { kind, form, channels };
	if (spec.name != null) json.name = String(spec.name);
	for (const k of STYLE_KEYS) if (spec[k] !== undefined) json[k] = spec[k];
	return json;
}

function normalizeChannel(value, cspec, where, resolveCol) {
	// Raw storage shape ({ columns, typed }) is accepted as-is, resolved.
	if (value && typeof value === 'object' && !Array.isArray(value) && !('column' in value)) {
		if (!('columns' in value) && !('typed' in value)) {
			throw new Error(
				`${where}: expected a number, a column name/id string, { column }, or a list.`
			);
		}
		const cols = (value.columns ?? []).map((c) => resolveCol(c?.refId ?? c?.column ?? c));
		const typed = (value.typed ?? []).filter(isNum);
		if (cols.length && typed.length)
			throw new Error(`${where}: a channel is wired OR typed, not both.`);
		if (cols.length > 1 && !isLineAt(cspec)) {
			throw new Error(`${where}: takes one column.`);
		}
		return { columns: cols.map((refId) => ({ refId })), typed };
	}

	const list = Array.isArray(value) ? value : [value];
	if (list.length === 0) return { columns: [], typed: [] };
	const allNum = list.every(isNum);
	const allCol = list.every(isColRef);
	if (!allNum && !allCol) {
		throw new Error(
			`${where}: mix of typed values and columns. Use numbers for typed values, and column names/"ids" or { column } for wires.`
		);
	}
	if (allNum) return { columns: [], typed: list.slice() };
	if (list.length > 1 && !isLineAt(cspec)) {
		throw new Error(
			`${where}: takes one column (only a line's \`at\` accepts a list, which makes one line per column).`
		);
	}
	const ids = list.map((v) => resolveCol(typeof v === 'string' ? v : v.column));
	return { columns: ids.map((refId) => ({ refId })), typed: [] };
}

// The one channel whose LIST of columns is accepted (and then split): a line's
// `at`, the only channel of that key in the table. Decided by key rather than
// by a dynamic flag, because no channel is dynamic any more.
function isLineAt(cspec) {
	return cspec.key === 'at';
}

/** Every column id an overlay JSON list wires (for render_plot's column bundle). */
export function overlayColumnIds(overlayJsons) {
	const ids = [];
	for (const o of overlayJsons ?? []) {
		for (const ch of Object.values(o.channels ?? {})) {
			for (const c of ch.columns ?? []) if (isNum(c?.refId)) ids.push(c.refId);
		}
	}
	return ids;
}

/** The same JSON with every wired refId mapped through `idMap` (render_plot renumbers). */
export function remapOverlayColumnIds(overlayJsons, idMap) {
	return (overlayJsons ?? []).map((o) => ({
		...o,
		channels: Object.fromEntries(
			Object.entries(o.channels ?? {}).map(([k, ch]) => [
				k,
				{
					columns: (ch.columns ?? []).map((c) => ({ refId: idMap.get(c.refId) ?? c.refId })),
					typed: (ch.typed ?? []).slice()
				}
			])
		)
	}));
}

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
