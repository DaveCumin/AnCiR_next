// Figure style: the single source of truth for a figure's typography and
// physical size.
//
// WHY PHYSICAL UNITS
//
// "A font size appropriate for the figure" has no meaning in pixels. What
// journals specify is a point size at final printed width, so a figure declares a
// real width in mm, type is in points, and pixels are DERIVED for screen. Once
// that holds, `s`/`m`/`l` is well defined and two figures in the same paper match
// each other instead of matching whatever pixel size their canvas happened to be.
//
// ONE KNOB, FIXED RATIOS
//
// A single base point size drives every role (tick labels, axis labels, legend,
// significance bars, annotations), each at a fixed ratio of the base. That is what
// makes a three-way size choice meaningful and keeps a figure internally
// consistent. `roleScale` exists for the case where one role genuinely needs
// nudging, and is normally null.
//
// SCOPE OF THIS MODULE
//
// Deliberately pure and dependency-free: no `core`, no `appState`, no DOM. Colour
// resolution is NOT here, because it needs the live palette; that lands with
// `resolveSeriesAppearance` alongside the palette-slot work. Keeping this module
// pure is what lets every branch below be tested without a browser.
//
// Design spec: docs/superpowers/specs/2026-07-30-figure-style-system-design.md

/** px per mm at CSS reference resolution (96 dpi). */
export const PX_PER_MM = 96 / 25.4;
/** px per typographic point (72 pt per inch, 96 px per inch). */
export const PX_PER_PT = 96 / 72;

/** Base point size for each named step. */
export const BASE_PT = { s: 7, m: 8.5, l: 10 };

/**
 * Each role's size as a multiple of the base.
 *
 * Axis labels and the legend ARE the base (they are the figure's "body" text).
 * Tick labels and significance-bar text sit slightly below, annotations lower
 * still. Adding a role here is all that is needed for it to be sized.
 */
export const ROLE_RATIOS = {
	axisLabel: 1,
	legend: 1,
	tick: 0.9,
	sigBar: 0.9,
	annotation: 0.8
};

/**
 * Figure widths in mm.
 *
 * NOT verified publisher requirements. Single-column width differs between
 * publishers (commonly somewhere in the 85 to 90 mm range), so these are starting
 * defaults that the Settings panel exposes, with `widthPreset: 'custom'` for
 * anything else. Seeding real per-journal values with citations is a follow-up.
 */
export const WIDTH_PRESET_MM = { single: 85, double: 170 };

export const FONT_STACKS = {
	sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
	serif: 'Georgia, "Times New Roman", Times, serif'
};

/**
 * TRANSITIONAL DEFAULT, and why it is not `m`.
 *
 * Before this system existed, Axis.svelte hardcoded 16px axis labels and 15px
 * tick labels. The named steps above are point sizes at FINAL PRINTED WIDTH, and
 * `m` (8.5 pt) resolves to 11.3px, so adopting `m` as the default would shrink
 * the type on every existing figure by about 30% the moment Axis started reading
 * this module.
 *
 * That shrink is not wrong once a figure declares a physical width: a 500px-wide
 * plot rendered at 85mm is 321px, and the type scales with it. But the physical
 * width work lands later, so in between the two are not comparable and adopting
 * `m` now would just make every plot in every saved session look smaller for no
 * benefit.
 *
 * So the shipped default reproduces the historical pixels exactly:
 *   12 pt * 96/72          = 16px  axis label  (was 16)
 *   12 pt * 0.9375 * 96/72 = 15px  tick label  (was 15)
 *
 * This is a default, not a constraint. The named steps are fully available from
 * the control, and the intended change once physical width exists is to make `m`
 * the default and delete this. Kept as one named function so that is a one-line
 * change rather than a hunt.
 */
export const TRANSITIONAL_PT = 12;
export const TRANSITIONAL_TICK_RATIO = 0.9375;

/** Smallest type we will emit, in points. Guards a hand-typed 0 or negative. */
const MIN_PT = 1;
/** Smallest figure width we will emit, in mm. */
const MIN_MM = 1;

/**
 * THE REGISTRY.
 *
 * Every style field is declared exactly once, here. `newFigureStyle`,
 * `normaliseFigureStyle` and `applyStyleToAll` all derive from this list rather
 * than naming fields themselves.
 *
 * This matters because of a deliberate design decision: the global style is a
 * TEMPLATE copied into new plots, and existing plots are only updated when the
 * user presses "Apply to all". That model's known weakness is that a newly added
 * field must join the copy logic or it silently never applies. Driving all three
 * functions off one list removes the chance to forget, and
 * `figureStyle.test.js` fails if the list and the functions drift apart.
 *
 * `values` makes a field an enum (anything else is rejected on load).
 * `type` is checked for the non-enum fields. `nullable` allows an explicit null,
 * which several fields use to mean "not overridden".
 */
export const FIGURE_STYLE_FIELDS = [
	{ key: 'fontFamily', default: 'sans', values: ['sans', 'serif'] },
	{ key: 'fontSize', default: 'm', values: ['s', 'm', 'l', 'custom'] },
	{ key: 'fontSizePt', default: null, type: 'number', nullable: true },
	{ key: 'widthPreset', default: 'single', values: ['single', 'double', 'custom'] },
	{ key: 'widthMm', default: null, type: 'number', nullable: true },
	{ key: 'exportDpi', default: 300, type: 'number' },
	// null = use whatever the app's current default palette is. Stored rather than
	// resolved so a session records the palette it was authored with.
	{ key: 'palette', default: null, type: 'string', nullable: true },
	{ key: 'monochrome', default: false, type: 'boolean' },
	{ key: 'varyMarkers', default: false, type: 'boolean' },
	{ key: 'backgroundColour', default: 'transparent', type: 'string' },
	{ key: 'legendBox', default: true, type: 'boolean' },
	// Advanced per-role multipliers, e.g. { tick: 0.8 }. null = use ROLE_RATIOS.
	{ key: 'roleScale', default: null, type: 'object', nullable: true }
];

/** Field keys, in registry order. */
export const FIGURE_STYLE_KEYS = FIGURE_STYLE_FIELDS.map((f) => f.key);

/** @param {any} v @param {{key:string,default:any,values?:string[],type?:string,nullable?:boolean}} field */
function isValid(v, field) {
	if (v === null || v === undefined) return false; // handled by the caller as "absent"
	if (field.values) return field.values.includes(v);
	if (field.type === 'number') return typeof v === 'number' && Number.isFinite(v);
	if (field.type === 'boolean') return typeof v === 'boolean';
	if (field.type === 'string') return typeof v === 'string';
	if (field.type === 'object') return typeof v === 'object' && !Array.isArray(v);
	return false;
}

/**
 * A complete style object.
 *
 * @param {Record<string, any> | null} [template] copy values from here where they
 *   are valid, else fall back to the registry default. Passing the global template
 *   is what "new plots inherit the current defaults" means.
 */
export function newFigureStyle(template = null) {
	/** @type {Record<string, any>} */
	const out = {};
	for (const field of FIGURE_STYLE_FIELDS) {
		const candidate = template ? template[field.key] : undefined;
		// An explicit null is meaningful for nullable fields ("not overridden"), so
		// it must be copied rather than replaced by the default.
		if (candidate === null && field.nullable) out[field.key] = null;
		else out[field.key] = isValid(candidate, field) ? candidate : field.default;
	}
	return out;
}

/**
 * The shipped default: a style whose resolved sizes match the pre-feature
 * hardcoded pixels. See TRANSITIONAL_PT for why this is not simply `m`.
 */
export function transitionalFigureStyle() {
	return newFigureStyle({
		fontSize: 'custom',
		fontSizePt: TRANSITIONAL_PT,
		roleScale: { tick: TRANSITIONAL_TICK_RATIO }
	});
}

/**
 * Coerce arbitrary saved JSON into a complete, valid style.
 *
 * Used on session import. Unknown keys are dropped, missing keys get defaults,
 * and a value of the wrong type or outside an enum is replaced rather than
 * trusted: a session file is data from outside the app, and half of them were
 * written by an older version that did not have some of these fields.
 *
 * @param {any} saved
 */
export function normaliseFigureStyle(saved) {
	if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return newFigureStyle();
	return newFigureStyle(saved);
}

/**
 * Overwrite every plot's style from the template. This is "Apply to all plots".
 *
 * Writes every registered key, so a field added to the registry is retrofitted
 * without anyone remembering to extend this function.
 *
 * Note what this does NOT touch: the session-wide identity maps (which column
 * holds which palette slot, which marker shape). Those carry data identity, not
 * house style, and reassigning them here would undo the property that the same
 * series is drawn the same way in every plot.
 *
 * @param {Array<{style?: Record<string, any>}>} plots
 * @param {Record<string, any>} template
 * @returns {number} how many plots were updated
 */
export function applyStyleToAll(plots, template) {
	if (!Array.isArray(plots)) return 0;
	const next = newFigureStyle(template);
	let n = 0;
	for (const plot of plots) {
		if (!plot || typeof plot !== 'object') continue;
		// Assign field by field into the existing object rather than replacing it,
		// so a $state-backed style keeps its identity and reactive readers update.
		plot.style ??= newFigureStyle();
		for (const key of FIGURE_STYLE_KEYS) plot.style[key] = next[key];
		n++;
	}
	return n;
}

/** Base point size a style resolves to. */
export function basePt(style) {
	if (style?.fontSize === 'custom') {
		const pt = style.fontSizePt;
		// A custom step with no number yet (the user picked "custom" and has not
		// typed) must not produce NaN sizes downstream. Fall back to the middle step.
		if (typeof pt === 'number' && Number.isFinite(pt)) return Math.max(MIN_PT, pt);
		return BASE_PT.m;
	}
	return BASE_PT[style?.fontSize] ?? BASE_PT.m;
}

/** Figure width in mm a style resolves to. */
export function widthMm(style) {
	if (style?.widthPreset === 'custom') {
		const mm = style.widthMm;
		if (typeof mm === 'number' && Number.isFinite(mm)) return Math.max(MIN_MM, mm);
		return WIDTH_PRESET_MM.single;
	}
	return WIDTH_PRESET_MM[style?.widthPreset] ?? WIDTH_PRESET_MM.single;
}

/**
 * Everything a component needs, in px, derived from the declared physical size.
 *
 * Components consume ONLY this, never the raw style, so there is one place where
 * points become pixels.
 *
 * @param {Record<string, any> | null | undefined} style
 * @returns {{fontFamily: string, basePt: number, widthMm: number, widthPx: number,
 *            sizes: Record<string, number>}}
 */
export function resolveStyle(style) {
	const pt = basePt(style);
	const mm = widthMm(style);
	const overrides = style?.roleScale && typeof style.roleScale === 'object' ? style.roleScale : {};

	/** @type {Record<string, number>} */
	const sizes = {};
	for (const [role, ratio] of Object.entries(ROLE_RATIOS)) {
		const override = overrides[role];
		const effective = typeof override === 'number' && Number.isFinite(override) ? override : ratio;
		sizes[role] = Math.max(MIN_PT, pt * effective) * PX_PER_PT;
	}

	return {
		fontFamily: FONT_STACKS[style?.fontFamily] ?? FONT_STACKS.sans,
		basePt: pt,
		widthMm: mm,
		widthPx: mm * PX_PER_MM,
		sizes,
		// Pass-through, not derived. Components consume ONLY this object, so a flag
		// they need has to appear here or they would have to reach for the raw style
		// as well and there would be two ways in. Defaulted here too, so a component
		// handed a partial style still gets the documented behaviour.
		legendBox: style?.legendBox !== false,
		backgroundColour:
			typeof style?.backgroundColour === 'string' ? style.backgroundColour : 'transparent'
	};
}

/**
 * Pixel scale for exporting at a given DPI.
 *
 * The current PNG export sets the canvas to the SVG's pixel width, so output
 * lands at roughly screen resolution. Multiplying by this is what makes
 * "half page at 300 dpi" mean what it says. Used by the export work; exposed here
 * so the DPI-to-scale relationship lives next to the other unit conversions.
 */
export function exportScale(style) {
	const dpi = style?.exportDpi;
	if (typeof dpi !== 'number' || !Number.isFinite(dpi) || dpi <= 0) return 1;
	return dpi / 96;
}
