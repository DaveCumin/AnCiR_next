// @ts-nocheck
// Named figure-style presets: the shape, the validators, and the browser-local store.
//
// WHAT A PRESET IS
//
// A style carries the figure TEMPLATE (everything in FIGURE_STYLE_FIELDS), the palette,
// and three tables of name-keyed appearance rules: by column NAME, by column GROUP LABEL,
// and by category LABEL. Nothing else. No analysis defaults, no session data, no per-figure
// overrides; see docs/superpowers/specs/2026-07-30-style-config-scope.md.
//
// WHY NAMES AND GROUP LABELS RATHER THAN COLUMN IDS
//
// core.seriesAppearance is keyed on column id, and `_columnIdCounter` is a per-run counter
// (Column.svelte), so column 3 here and column 3 in a colleague's session are unrelated. Ids
// therefore never enter a preset. Names survive a file; group labels survive a whole study,
// which is why both are captured and the group table is the one that generalises.
//
// WHERE IT LIVES, AND WHY NOT THROUGH `store`
//
// localStorage, written through `window.localStorage` DIRECTLY rather than the `store` shim
// in core/localData.svelte.js. That shim resolves to sessionStorage in ephemeral mode by
// design, and a preset holds a typeface, a size, some hex colours and some names: no
// measurements, nothing derived from the data. A privacy mode that also forgot your house
// style would be annoying enough that people leave it off, which costs more privacy than it
// buys. The mode flag itself already bypasses the shim for exactly this reason (MODE_KEY),
// and STYLE_KEY is exempted from clearLocalData() alongside it — otherwise ticking the
// privacy box would delete the user's presets by surprise.
//
// The honest caveat: a preset CAN carry column names and group labels, and a name like
// `PT_0421_night` is the one part of a style that identifies anything. So Settings states
// what a style keeps, saving offers a template-and-palette-only capture, and "Forget saved
// styles" is its own separately-worded button.
//
// SLICE
//
// This module is slice 1: shape, validators, store, and applying a style's TEMPLATE and
// PALETTE. Import/export of `ancirStyleConfig.json` is slice 2 (normaliseStyleConfig already
// takes a raw string so the file path drops straight in), and applying the name/group rules
// to the session map is slice 3.
import { core, appState, appConsts } from '$lib/core/core.svelte';
import { newFigureStyle, normaliseFigureStyle, FIGURE_STYLE_KEYS } from '$lib/plots/figureStyle.js';
import { normaliseRecord } from '$lib/plots/appearanceIdentity.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { STYLE_KEY } from '$lib/core/localData.svelte.js';

/** Current on-disk shape. Bumped only when an old file would otherwise be misread. */
export const STYLE_CONFIG_VERSION = 1;

/** The three name-keyed rule tables, in the order they are reported. */
export const RULE_SECTIONS = ['columns', 'groups', 'categories'];

/** Top-level keys this build understands; anything else is counted and ignored. */
const KNOWN_TOP_KEYS = ['ancirStyleConfig', 'activeStyle', 'styles'];
/** Style-level keys this build understands. */
const KNOWN_STYLE_KEYS = ['figureStyle', 'palette', ...RULE_SECTIONS];

/**
 * Whether a stored string is plausibly a colour.
 *
 * A deliberate duplicate of appearanceIdentity.js's `looksLikeColour`, which is not
 * exported. Copied rather than exported-and-shared for one slice because that file is
 * being edited concurrently; folding the two together is a follow-up, and the shapes
 * accepted must stay identical (3/4/6/8 hex digits plus rgb()/hsl() functional forms).
 */
function looksLikeColour(v) {
	if (typeof v !== 'string' || !v) return false;
	if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return true;
	return /^(rgb|hsl)a?\(/i.test(v);
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Put a hand-written rule into the record shape before validating it.
 *
 * The spec's example file writes `{ "colour": "#c0392b" }` and a terse hand edit might
 * write the bare string `"#c0392b"`, but `normaliseRecord` reads `entry.colour.hex` /
 * `entry.colour.slot`, so a string colour would be dropped in the first case. Rewriting it
 * to `{ hex }` here accepts both.
 *
 * It also matters WHICH way round: handing a bare colour string straight to
 * `normaliseRecord` makes it look the hex up in the CURRENT palette and store a `{ slot }`
 * if it happens to match. For a session map that is right (the record then follows the
 * palette). For a config it is not: the file's hex would be re-bound to whatever colour
 * this session's palette holds in that position, which is a different colour. So a config's
 * colour is pinned as a hex and left alone.
 */
function coerceRule(entry) {
	if (looksLikeColour(entry)) return { colour: { hex: entry } };
	if (!isPlainObject(entry)) return entry;
	if (looksLikeColour(entry.colour)) return { ...entry, colour: { hex: entry.colour } };
	return entry;
}

/** An empty, valid config. The fallback whenever storage holds nothing usable. */
export function emptyStyleConfig() {
	return { ancirStyleConfig: STYLE_CONFIG_VERSION, activeStyle: null, styles: {} };
}

// --- Validation ------------------------------------------------------------------------

/**
 * @typedef {object} StyleLoadReport
 * @property {boolean} ok            false ⇒ a hard failure; the caller must change nothing
 * @property {string|null} reason    why it hard-failed
 * @property {string[]} styleNames   the styles that loaded
 * @property {string|null} activeStyle
 * @property {Array<{style: string|null, section: string, key: string, why: string}>} dropped
 * @property {string[]} notes        things that loaded differently than the file asked for
 * @property {string} summary        one line, safe to show in a notification
 */

/** A hard failure: nothing recognisable, so nothing changes. */
function hardFailure(reason) {
	return {
		config: null,
		report: {
			ok: false,
			reason,
			styleNames: [],
			activeStyle: null,
			dropped: [],
			notes: [],
			summary: `Not loaded: ${reason}.`
		}
	};
}

/**
 * Validate the palette half of a style.
 *
 * Both the NAME and the resolved hex array are kept. `appConsts.colourPalettes` is a keyed
 * object and Settings assigns `appState.appColours = appConsts.colourPalettes[name]`, so a
 * config naming a palette this build lacks (renamed, removed, or written by a newer version)
 * would put `undefined` into appColours and break every palette-slot colour in the session.
 * The name is preferred when it resolves, so a preset tracks a palette that later gets
 * improved; the array is the fallback, so an unknown name still paints correctly.
 */
function normalisePalette(raw, dropped, styleName) {
	if (raw === undefined) return null;
	const out = {};
	const source = looksLikeColour(raw) ? null : raw;
	if (typeof source === 'string') {
		out.name = source;
	} else if (isPlainObject(source)) {
		if (typeof source.name === 'string' && source.name) out.name = source.name;
		if (Array.isArray(source.colours)) {
			const colours = source.colours.filter(looksLikeColour);
			if (colours.length !== source.colours.length) {
				dropped.push({
					style: styleName,
					section: 'palette',
					key: 'colours',
					why: `${source.colours.length - colours.length} entries were not colours`
				});
			}
			if (colours.length) out.colours = colours;
		} else if (source.colours !== undefined) {
			dropped.push({
				style: styleName,
				section: 'palette',
				key: 'colours',
				why: 'not an array'
			});
		}
	} else {
		dropped.push({ style: styleName, section: 'palette', key: 'palette', why: 'not usable' });
		return null;
	}
	return Object.keys(out).length ? out : null;
}

/** Validate one style. Returns null when there is nothing recognisable in it at all. */
function normaliseStyle(name, raw, dropped, notes) {
	if (!isPlainObject(raw)) {
		dropped.push({ style: name, section: 'style', key: name, why: 'not an object' });
		return null;
	}

	const out = {};

	// The template. normaliseFigureStyle already drops a value of the wrong type or outside
	// its enum, but it does so SILENTLY, so the difference is diffed back out here: a style
	// that quietly lost half its fields is exactly what the report exists to surface.
	if (raw.figureStyle === undefined) {
		out.figureStyle = newFigureStyle();
		notes.push(`"${name}" has no figure style; the app defaults were used.`);
	} else if (!isPlainObject(raw.figureStyle)) {
		out.figureStyle = newFigureStyle();
		dropped.push({ style: name, section: 'figureStyle', key: 'figureStyle', why: 'not an object' });
	} else {
		out.figureStyle = normaliseFigureStyle(raw.figureStyle);
		for (const [key, value] of Object.entries(raw.figureStyle)) {
			if (!FIGURE_STYLE_KEYS.includes(key)) {
				dropped.push({ style: name, section: 'figureStyle', key, why: 'unknown field' });
			} else if (out.figureStyle[key] !== value) {
				dropped.push({
					style: name,
					section: 'figureStyle',
					key,
					why: 'not a valid value for this field'
				});
			}
		}
	}

	const palette = normalisePalette(raw.palette, dropped, name);
	if (palette) out.palette = palette;

	for (const section of RULE_SECTIONS) {
		const table = raw[section];
		if (table === undefined) continue;
		if (!isPlainObject(table)) {
			dropped.push({ style: name, section, key: section, why: 'not an object' });
			continue;
		}
		const rules = {};
		for (const [key, entry] of Object.entries(table)) {
			const coerced = coerceRule(entry);
			const record = normaliseRecord(coerced);
			if (!record) {
				dropped.push({ style: name, section, key, why: 'no usable colour, shape or dash' });
				continue;
			}
			// A record survives on any ONE field, so a rejected colour inside an otherwise
			// valid rule would vanish without a word. Say so: a rule that silently lost its
			// colour is the failure a user would notice and could not explain.
			if (!record.colour && isPlainObject(coerced) && coerced.colour !== undefined) {
				dropped.push({ style: name, section, key, why: 'colour not recognised' });
			}
			if (!record.shape && isPlainObject(coerced) && coerced.shape !== undefined) {
				dropped.push({ style: name, section, key, why: 'marker shape not recognised' });
			}
			rules[key] = record;
		}
		if (Object.keys(rules).length) out[section] = rules;
	}

	for (const key of Object.keys(raw)) {
		if (!KNOWN_STYLE_KEYS.includes(key)) {
			dropped.push({ style: name, section: 'style', key, why: 'unknown key, ignored' });
		}
	}

	return out;
}

/**
 * Coerce arbitrary JSON (or a JSON string) into a valid style config.
 *
 * NEVER throws, and reports rather than refusing: any file may be offered, and a refusal
 * that does not say what it disliked is not actionable. Malformed VALUES are dropped field
 * by field rather than poisoning the whole style.
 *
 * A hard failure (`report.ok === false`, `config === null`) is reserved for the two cases
 * the spec names: it is not JSON at all, or it holds nothing recognisable as a style. Both
 * mean the caller changes nothing.
 *
 * @param {any} raw a parsed object, or the raw text of a file
 * @returns {{config: any|null, report: StyleLoadReport}}
 */
export function normaliseStyleConfig(raw) {
	let source = raw;
	if (typeof source === 'string') {
		try {
			source = JSON.parse(source);
		} catch {
			return hardFailure('the file is not JSON');
		}
	}
	if (!isPlainObject(source)) {
		return hardFailure(
			Array.isArray(source) ? 'the file is a list, not a style config' : 'there is no JSON object'
		);
	}

	/** @type {Array<{style: string|null, section: string, key: string, why: string}>} */
	const dropped = [];
	/** @type {string[]} */
	const notes = [];

	// The version is a note, never a refusal. A file from a newer build is far more likely to
	// be mostly readable than to be dangerous, and every value goes through a validator
	// anyway; refusing it would strand a user whose colleague upgraded first.
	const version = source.ancirStyleConfig;
	if (version === undefined) {
		notes.push('No version field; read as version 1.');
	} else if (version !== STYLE_CONFIG_VERSION) {
		notes.push(
			`Version ${JSON.stringify(version)} is not ${STYLE_CONFIG_VERSION}; read as best it could be.`
		);
	}

	let rawStyles = source.styles;
	if (rawStyles !== undefined && !isPlainObject(rawStyles)) {
		dropped.push({ style: null, section: 'top', key: 'styles', why: 'not an object' });
		rawStyles = undefined;
	}

	const styles = {};
	for (const [name, entry] of Object.entries(rawStyles ?? {})) {
		if (!name) continue;
		const style = normaliseStyle(name, entry, dropped, notes);
		if (style) styles[name] = style;
	}

	for (const key of Object.keys(source)) {
		if (!KNOWN_TOP_KEYS.includes(key)) {
			dropped.push({ style: null, section: 'top', key, why: 'unknown key, ignored' });
		}
	}

	const styleNames = Object.keys(styles);
	if (styleNames.length === 0) return hardFailure('there is nothing recognisable as a style');

	let activeStyle = null;
	if (typeof source.activeStyle === 'string' && source.activeStyle) {
		if (styles[source.activeStyle]) activeStyle = source.activeStyle;
		else notes.push(`The active style "${source.activeStyle}" is not in the file.`);
	}

	const summary =
		`Loaded ${styleNames.length} style${styleNames.length === 1 ? '' : 's'}` +
		(dropped.length ? `; ${dropped.length} item${dropped.length === 1 ? '' : 's'} dropped.` : '.');

	return {
		config: { ancirStyleConfig: STYLE_CONFIG_VERSION, activeStyle, styles },
		report: { ok: true, reason: null, styleNames, activeStyle, dropped, notes, summary }
	};
}

// --- The store -------------------------------------------------------------------------
//
// Every access swallows its own errors, the same as core/localData.svelte.js: Safari private
// mode throws on setItem, and no preference is worth taking the app down for.

function readRaw() {
	if (typeof window === 'undefined') return null;
	try {
		return window.localStorage?.getItem(STYLE_KEY) ?? null;
	} catch {
		return null;
	}
}

function writeRaw(value) {
	if (typeof window === 'undefined') return false;
	try {
		window.localStorage?.setItem(STYLE_KEY, value);
		return true;
	} catch {
		return false;
	}
}

/** Whatever is stored, validated. Always a usable config, never null. */
export function readStyleConfig() {
	const stored = readRaw();
	if (!stored) return emptyStyleConfig();
	const { config } = normaliseStyleConfig(stored);
	return config ?? emptyStyleConfig();
}

function writeStyleConfig(config) {
	return writeRaw(JSON.stringify(config));
}

/** Saved style names, alphabetical (the order the panel lists them in). */
export function listStyles() {
	return Object.keys(readStyleConfig().styles).sort((a, b) => a.localeCompare(b));
}

/** One saved style, validated, or null. */
export function getStyle(name) {
	return readStyleConfig().styles[String(name)] ?? null;
}

/** Whether a name is already taken (so the panel can prompt before overwriting). */
export function styleExists(name) {
	return Object.hasOwn(readStyleConfig().styles, String(name));
}

/**
 * Write a style under `name`, replacing any style of that name.
 *
 * The style is normalised on the way IN as well as on the way out: a caller could hand this
 * a hand-built object, and storage that can hold an invalid style is storage that hands one
 * back on the next load.
 *
 * @returns {boolean} whether it reached storage
 */
export function saveStyle(name, style) {
	const key = String(name ?? '').trim();
	if (!key) return false;
	const { config } = normaliseStyleConfig({
		ancirStyleConfig: STYLE_CONFIG_VERSION,
		styles: { [key]: style }
	});
	if (!config) return false;
	const stored = readStyleConfig();
	stored.styles[key] = config.styles[key];
	return writeStyleConfig(stored);
}

/** Forget one style. Also clears the active name if that was the one. */
export function deleteStyle(name) {
	const key = String(name);
	const stored = readStyleConfig();
	if (!Object.hasOwn(stored.styles, key)) return false;
	delete stored.styles[key];
	if (stored.activeStyle === key) stored.activeStyle = null;
	return writeStyleConfig(stored);
}

/**
 * The active style for THIS BROWSER.
 *
 * Per browser so a machine keeps its house style; also written into the session (see
 * core.activeStyleName) so a set of figures records what it was styled with. The two are
 * deliberately separate: on session load the session's name is DISPLAYED, never applied.
 */
export function getActiveStyleName() {
	return readStyleConfig().activeStyle;
}

export function setActiveStyleName(name) {
	const stored = readStyleConfig();
	stored.activeStyle = name && stored.styles[String(name)] ? String(name) : null;
	return writeStyleConfig(stored);
}

/**
 * Forget every saved style.
 *
 * Separate from clearLocalData() on purpose. That button clears things the app can rebuild
 * (recents, file handles, canvas layout); presets are authored work, and are NOT recoverable
 * from a session file, so they get their own button and their own warning.
 *
 * @returns {number} how many styles were forgotten, so the UI can report a number
 */
export function forgetAllStyles() {
	const count = Object.keys(readStyleConfig().styles).length;
	if (typeof window !== 'undefined') {
		try {
			window.localStorage?.removeItem(STYLE_KEY);
		} catch {
			/* private mode: nothing was written in the first place */
		}
	}
	return count;
}

// --- Capture ---------------------------------------------------------------------------

/** The name of the palette currently in use, or null when it matches none of them. */
export function currentPaletteName() {
	const active = appState.appColours ?? [];
	for (const [name, colours] of Object.entries(appConsts.colourPalettes ?? {})) {
		if (colours === active) return name;
		if (
			Array.isArray(colours) &&
			colours.length === active.length &&
			colours.every((c, i) => String(c).toLowerCase() === String(active[i]).toLowerCase())
		) {
			return name;
		}
	}
	return null;
}

/**
 * Build a preset from the CURRENT session.
 *
 * The appearance map is id-keyed and session-local, so it is converted here: each record is
 * re-keyed on its column's NAME and, separately, on its column's `groupLabel`. Records whose
 * column has gone (a deleted column's record lingers deliberately, so undo restores its
 * colour) have no name to key on and are skipped.
 *
 * Names collide where ids do not — two nodes can both output `value`. First writer wins,
 * which matches "a rule is a statement about a name": a second record for the same name is a
 * different column that happens to share it, and there is no way to tell which the user
 * meant. Group labels collide by design, since a group IS many columns; first wins there too.
 *
 * @param {string} name
 * @param {{includeNames?: boolean}} [options] includeNames false emits only the template and
 *   the palette. That is the useful default on a shared machine: names and group labels are
 *   the one identifying thing a style can carry.
 * @returns {{name: string, style: object}}
 */
export function captureStyle(name, { includeNames = true } = {}) {
	const style = {
		figureStyle: newFigureStyle(core.figureStyle),
		palette: {
			...(currentPaletteName() ? { name: currentPaletteName() } : {}),
			colours: [...(appState.appColours ?? [])]
		}
	};

	if (includeNames) {
		const columns = {};
		const groups = {};
		for (const [colId, entry] of Object.entries(core.seriesAppearance ?? {})) {
			const record = normaliseRecord(entry);
			if (!record) continue;
			const col = getColumnById(Number(colId));
			const colName = col?.name;
			if (typeof colName === 'string' && colName && !columns[colName]) columns[colName] = record;
			const group = col?.groupLabel;
			if (typeof group === 'string' && group && !groups[group]) groups[group] = record;
		}
		const categories = {};
		for (const [label, entry] of Object.entries(core.categoryColours ?? {})) {
			// The session's category map stores a bare {slot}|{hex}; a rule is a full record,
			// so it is wrapped rather than copied.
			const record = normaliseRecord({ colour: entry });
			if (record) categories[label] = record;
		}
		if (Object.keys(columns).length) style.columns = columns;
		if (Object.keys(groups).length) style.groups = groups;
		if (Object.keys(categories).length) style.categories = categories;
	}

	// Round-trip the captured style through the same validator a file goes through, so a
	// preset saved from the session and one read off disk cannot differ in shape.
	const { config } = normaliseStyleConfig({
		ancirStyleConfig: STYLE_CONFIG_VERSION,
		styles: { [String(name)]: style }
	});
	return { name: String(name), style: config ? config.styles[String(name)] : style };
}

// --- The pending palette ----------------------------------------------------------------
//
// Picking a palette used to repaint every existing figure the moment it was clicked, because
// a `{slot}` record resolves against `appState.appColours` on READ. That made the palette the
// one control in the Figure defaults panel that reached back into work already done, while
// every field beside it waits for "Apply to all plots".
//
// So the choice is HELD instead. `appState.pendingPalette` is the chosen palette; nothing
// resolves against it, so no figure moves until the choice is taken and pushed.
//
// These live here rather than in Settings.svelte because the rule (what a choice means, when
// it is a cancel, what "take" leaves behind) is worth testing without mounting a modal.

/**
 * Record a palette choice, without applying it.
 *
 * Choosing the palette already in use CANCELS a pending choice rather than storing a no-op:
 * it is how a user backs out without having to remember which palette they started from.
 *
 * @param {string} name a key of appConsts.colourPalettes
 * @returns {boolean} whether anything is now pending
 */
export function choosePalette(name) {
	const colours = appConsts.colourPalettes?.[name];
	if (!Array.isArray(colours) || colours.length === 0) return !!appState.pendingPalette;

	const active = appState.appColours ?? [];
	const same =
		colours.length === active.length &&
		colours.every((c, i) => String(c).toLowerCase() === String(active[i]).toLowerCase());

	appState.pendingPalette = same ? null : { name, colours: [...colours] };
	return !!appState.pendingPalette;
}

/**
 * Take the pending palette, clearing it. The CALLER applies it, because pushing a palette
 * into the session has to be bracketed by pinnedColourSnapshot/repaintPinnedSeries and
 * updates the favicon, which belong to Settings.
 *
 * @returns {string[]|null} the colours to apply, or null when nothing was pending
 */
export function takePendingPalette() {
	const pending = appState.pendingPalette;
	if (!pending?.colours?.length) {
		appState.pendingPalette = null;
		return null;
	}
	appState.pendingPalette = null;
	return pending.colours;
}

// --- Applying --------------------------------------------------------------------------

/**
 * Resolve a preset's palette against this build.
 *
 * @returns {{colours: string[]|null, source: 'name'|'colours'|'none', name: string|null,
 *            note: string|null}}
 */
export function resolvePalette(palette) {
	const name = typeof palette?.name === 'string' ? palette.name : null;
	const named = name ? appConsts.colourPalettes?.[name] : null;
	if (Array.isArray(named) && named.length) {
		return { colours: named, source: 'name', name, note: null };
	}
	const colours = Array.isArray(palette?.colours) ? palette.colours.filter(looksLikeColour) : [];
	if (colours.length) {
		return {
			colours,
			source: 'colours',
			name,
			note: name
				? `This build has no palette called "${name}"; the colours saved with the style were used instead.`
				: 'The style saved colours but no palette name; the saved colours were used.'
		};
	}
	return {
		colours: null,
		source: 'none',
		name,
		note: name
			? `This build has no palette called "${name}" and the style saved no colours; the current palette was kept.`
			: null
	};
}

/**
 * Apply a preset's TEMPLATE and PALETTE to the session.
 *
 * Deliberately does NOT apply the name / group / category rules; that is slice 3, where it
 * has to mark records `edited`, be undoable as one step, and report what each rule matched.
 * Half-applying them here would be the worst of both: a visible restyle nobody can undo.
 *
 * The palette swap is INJECTED rather than done here. Changing `appState.appColours` has to
 * be bracketed by pinnedColourSnapshot/repaintPinnedSeries and updates the favicon, all of
 * which belong to Settings; this module would otherwise have to know about both.
 *
 * @param {object} style a validated style
 * @param {{setPalette?: (colours: string[]) => void}} [hooks]
 * @returns {{ok: boolean, palette: 'name'|'colours'|'none', notes: string[]}}
 */
export function applyStyleToSession(style, { setPalette } = {}) {
	if (!isPlainObject(style)) return { ok: false, palette: 'none', notes: ['No style to apply.'] };

	const notes = [];
	core.figureStyle = normaliseFigureStyle(style.figureStyle);

	const resolved = resolvePalette(style.palette);
	if (resolved.colours && setPalette) setPalette(resolved.colours);
	if (resolved.note) notes.push(resolved.note);

	return { ok: true, palette: resolved.source, notes };
}
