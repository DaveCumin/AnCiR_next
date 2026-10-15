// The overlay spec: which reference LINES and shaded BANDS exist, which channels each
// (kind, form) reads, and which of them a given plot allows. PURE on purpose (no Svelte, no
// $lib imports): the app's OverlayClass (Overlay.svelte), the MCP engine
// (mcp/src/engine/overlays.js) and the Worker's draft normalizer all read this one table,
// so the three cannot drift (overlays plan 2026-10-15, section 2).
//
// A night band is a band of form `repeating`; a 95% CI is a band of form `ribbon`; an alert
// time is a vertical line. What differs between them is only WHICH channels exist, and that
// is decided by (kind, form) below.

/** Position-style channels are collapsed to finite uniques and cut here. */
export const OVERLAY_POSITION_CAP = 50;

// The channel table, in panel/port order. `axis` is the axis the channel is READ on. No
// channel is dynamic (decision 2026-09-18): every channel holds ONE column, so each wired
// source is its own Line overlay with its own colour, stroke and label. The flag stays in
// the spec shape because the port emitter and the MCP catalogue read it; `fromJSONSplit`
// turns a saved multi-column `at` from before that decision into one Line per column.
export const CHANNEL_TABLE = {
	line: {
		vertical: [{ key: 'at', axis: 'x', dynamic: false }],
		horizontal: [{ key: 'at', axis: 'y', dynamic: false }]
	},
	band: {
		ribbon: [
			{ key: 'x', axis: 'x', dynamic: false },
			{ key: 'lower', axis: 'y', dynamic: false },
			{ key: 'upper', axis: 'y', dynamic: false }
		],
		horizontal: [
			{ key: 'lower', axis: 'y', dynamic: false },
			{ key: 'upper', axis: 'y', dynamic: false }
		],
		vertical: [
			{ key: 'start', axis: 'x', dynamic: false },
			{ key: 'end', axis: 'x', dynamic: false }
		],
		repeating: []
	}
};

/** Forms per kind, in the order the panel offers them. */
export const FORMS = {
	line: ['vertical', 'horizontal'],
	band: ['ribbon', 'horizontal', 'vertical', 'repeating']
};

// Channels that are paired element-wise into segments. Uniqueness for these applies to the
// PAIR, not to each channel on its own: deduping `start` and `end` separately would re-pair
// start[i] with the wrong end.
export const PAIRED_FORMS = {
	vertical: ['start', 'end'],
	horizontal: ['lower', 'upper']
};

/**
 * The ordered channel list for a (kind, form), each `{ key, axis: 'x'|'y', dynamic, display }`
 * with display like 'at (x)'. Repeating bands have no channels; an unknown pair gives [].
 */
export function channelsFor(kind, form) {
	const list = CHANNEL_TABLE[kind]?.[form] ?? [];
	return list.map((c) => ({ ...c, display: `${c.key} (${c.axis})` }));
}

// ---- capabilities ---------------------------------------------------------------------
//
// A host plot declares what it supports as `static overlayCapabilities`:
//   { line: [forms], band: [forms], legend: boolean, xTime: boolean, domain?: ['x'|'y'],
//     xNote?: string }
// `line` / `band` list the allowed forms in panel order (an empty or missing list means the
// kind is not offered; the first is the default for a new overlay); `legend: false` hides
// the Label field; `xTime` is true only where x can be a time axis; `domain` lists the axes
// whose AUTOMATIC range an overlay may widen (both when left out). An axis that is also an
// analysis parameter (a periodogram's period range) is left out, so a reference mark can
// never change what is computed. `xNote` (optional) says how an x position is read when that
// is not the axis as shown (an FFT takes periods in hours, also on its frequency axis); the
// Overlays tab shows it on blocks that read x, and the MCP catalogue as `overlayNote`. See overlayHost.js for the rest of the host contract.

/** Everything: the capabilities of the reference host (Scatterplot). */
export const ALL_OVERLAY_FORMS = Object.freeze({
	line: Object.freeze([...FORMS.line]),
	band: Object.freeze([...FORMS.band]),
	legend: true,
	xTime: true,
	domain: Object.freeze(['x', 'y'])
});

/**
 * A host's declared capabilities (`static overlayCapabilities` on its class), or null when it
 * declares none. Null means no restriction, which is what a plain stand-in host in a test
 * gets; every real host declares them.
 */
export function capabilitiesOf(host) {
	return host?.constructor?.overlayCapabilities ?? null;
}

/**
 * The axes whose automatic range a host widens to fit its overlays (`caps.domain`): both
 * when the host does not say, and never anything but 'x' / 'y'.
 */
export function overlayDomainAxes(caps) {
	if (!Array.isArray(caps?.domain)) return ['x', 'y'];
	return ['x', 'y'].filter((axis) => caps.domain.includes(axis));
}

/** The overlay kinds, in catalogue order. */
export const OVERLAY_KINDS = Object.freeze(Object.keys(FORMS));

/**
 * The forms of `kind` a host allows, in the host's order. `caps` null/undefined means no
 * restriction (every form, as the app behaved before capabilities existed); an unknown kind
 * or a form the table does not know is never allowed.
 */
export function allowedForms(caps, kind) {
	const known = FORMS[kind];
	if (!known) return [];
	if (caps == null) return known.slice();
	const list = Array.isArray(caps[kind]) ? caps[kind] : [];
	return list.filter((f) => known.includes(f));
}

/** The kinds a host allows (those with at least one allowed form). */
export function allowedKinds(caps) {
	return OVERLAY_KINDS.filter((kind) => allowedForms(caps, kind).length > 0);
}

/** The form a new overlay of `kind` starts with on this host, or null when the kind is not allowed. */
export function defaultFormFor(caps, kind) {
	return allowedForms(caps, kind)[0] ?? null;
}

/**
 * `form` when the host allows it for `kind`, else the host's default form for the kind, else
 * null (the kind itself is not allowed).
 */
export function coerceForm(caps, kind, form) {
	const allowed = allowedForms(caps, kind);
	return allowed.includes(form) ? form : (allowed[0] ?? null);
}

/**
 * The channel table as the MCP catalogue advertises it, restricted to what `caps` allows:
 * `{ line: { vertical: [{key, axis, dynamic}], … }, band: { … } }`. A kind with no allowed
 * form is left out.
 */
export function describeOverlayForms(caps) {
	const out = {};
	for (const kind of allowedKinds(caps)) {
		out[kind] = {};
		for (const form of allowedForms(caps, kind)) {
			out[kind][form] = channelsFor(kind, form).map(({ key, axis, dynamic }) => ({
				key,
				axis,
				dynamic
			}));
		}
	}
	return out;
}

// ---- spec normaliser ------------------------------------------------------------------
//
// The tool / draft input mirrors the GUI's Overlays tab one to one:
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
 * Validate and normalise tool `overlays` into OverlayClass JSON (the shape
 * `OverlayClass.fromJSON` and the session file use): channels become
 * `{ columns: [{ refId }], typed: [] }`. A line whose `at` lists several
 * columns yields several JSONs (see splitLine), so the output may be longer
 * than the input; order is kept.
 *
 * @param {Array<object>} overlays  tool input (may be undefined)
 * @param {(ref: string|number) => number} resolveCol  column name/id → id; throws if unknown
 * @param {object} [caps]  the host's overlayCapabilities; omitted means every kind and form
 * @param {{ plot?: string }} [opts]  `plot`: the plot type, named in kind/form errors so a
 *   caller can tell which plot refused an overlay ("a line on a periodogram must be ...")
 * @returns {Array<object>}  overlay JSON, in input order, one per resulting overlay
 */
export function normalizeOverlaySpecs(overlays, resolveCol, caps, { plot = null } = {}) {
	if (overlays == null) return [];
	if (!Array.isArray(overlays)) throw new Error('`overlays` must be an array.');
	return overlays.flatMap((spec, i) => splitLine(normalizeOne(spec, i, resolveCol, caps, plot)));
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

function normalizeOne(spec, i, resolveCol, caps, plot) {
	const where = `overlays[${i}]`;
	if (!spec || typeof spec !== 'object') throw new Error(`${where}: expected an object.`);
	const onPlot = plot ? ` on a ${plot}` : '';

	const kinds = allowedKinds(caps);
	const kind = spec.kind;
	if (!kinds.includes(kind)) {
		throw new Error(
			`${where}.kind${onPlot} must be one of ${kinds.join(' | ')} (got ${JSON.stringify(kind)}).`
		);
	}
	const forms = allowedForms(caps, kind);
	const form = spec.form ?? defaultFormFor(caps, kind);
	if (!forms.includes(form)) {
		throw new Error(
			`${where}.form for a ${kind}${onPlot} must be one of ${forms.join(' | ')} (got ${JSON.stringify(spec.form)}).`
		);
	}

	const specs = channelsFor(kind, form);
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
