// @ts-nocheck
// Facets as views (plan docs/plans/2026-09-26-facets-as-views.md, sections 1.2 to 1.4).
//
// A faceted plot is ONE generator `Plot` (facet === true) and N derived PANELS. A panel is a
// lightweight stand-in for a wrapper Plot: it is not in `core.plots`, is never saved, never
// takes a numeric id, and is never reconciled. Its geometry is computed from the generator on
// read; its plot-class INSTANCE is projected from the generator's inner JSON by
// `projectPanel`, rebuilt when the structure changes and mirrored in place otherwise.
//
// Pure apart from the three runes on FacetPanel (`selected`, `plot`, `rev`). `panelsFor` is a
// memo keyed on the generator's reactive inputs, computed on read: it writes nothing into
// `core`, runs no effect, and never writes a `$state` field (a read may be happening inside a
// `$derived`, where a `$state` write is a state_unsafe_mutation). Only `projectPanel` writes
// `plot`/`rev`, and it must be called from a deferred task, see `schedulePanelProjection`.
import { core, appConsts, appState, snapToGrid } from '$lib/core/core.svelte';
import { getColumnById } from '$lib/core/Column.svelte';
import { PLOT_CHROME } from '$lib/core/workspaceLayout.js';
import { facetGridCells } from '$lib/core/facetGrid.js';
import { setByPath } from '$lib/utils/objectPath.js';
import { COLUMN_BASED_FACET_TYPES } from '$lib/core/facetTypes.js';
import { applyOverride } from '$lib/core/facetOverrides.js';

// ---------------------------------------------------------------------------
// Units (plan 1.2)
// ---------------------------------------------------------------------------

/** `y112#0`, `c241#1`: role, column id, ordinal among units on that same column. */
export function unitKeyFor(role, refId, ordinal) {
	return `${role}${refId}#${ordinal}`;
}

/**
 * Group a plot's flat data points into series-sets by shared x, mirroring the per-set
 * (xN, ysN) ports. Each set keeps only valid ys, in wired order, and (new here) the
 * generator data index of each y in `idx`, so a panel can copy the exact series it shows.
 * The same grouping the v76.4 child reconcile used, so a session's panels are the plots its
 * children were.
 */
export function facetSets(data) {
	const sets = [];
	(data ?? []).forEach((dp, i) => {
		const xRef = dp?.x?.refId ?? -1;
		const yRef = dp?.y?.refId ?? -1;
		let s = sets.find((ss) => ss.xRefId === xRef);
		if (!s) {
			s = { xRefId: xRef, ys: [], idx: [] };
			sets.push(s);
		}
		if (yRef >= 0 && getColumnById(yRef)) {
			s.ys.push(yRef);
			s.idx.push(i);
		}
	});
	return sets;
}

/**
 * The facet UNITS of a generator, one per panel. The same list the v76.4 child reconcile
 * produced (same pairing: the first x-set drives, later sets pair by position; column-based
 * types give one unit per column; pinned in facetPanels.test.js), with the identity fixed:
 * `key` is `${role}${ref}#${k}` rather than `${gen.id}:${i}:${ref}`, so a reorder keeps every
 * key and only `index` moves.
 *
 * Each unit: `{ key, name, desired, sig, index, seriesIdx }` where `seriesIdx` lists the
 * generator data indices the panel's series are copied from, in `desired` order.
 */
export function facetUnits(gen) {
	const data = gen?.plot?.data ?? [];
	const ordinals = Object.create(null);
	const nextOrdinal = (role, ref) => {
		const k = `${role}${ref}`;
		const n = ordinals[k] ?? 0;
		ordinals[k] = n + 1;
		return n;
	};

	if (COLUMN_BASED_FACET_TYPES.has(gen?.type)) {
		const units = [];
		data.forEach((dp, di) => {
			const ref = dp?.column?.refId ?? -1;
			if (ref < 0 || !getColumnById(ref)) return;
			const i = units.length;
			units.push({
				key: unitKeyFor('c', ref, nextOrdinal('c', ref)),
				name: getColumnById(ref)?.name ?? `series ${i + 1}`,
				desired: [{ column: ref }],
				sig: `c${ref}`,
				index: i,
				seriesIdx: [di]
			});
		});
		return units;
	}

	const sets = facetSets(data);
	const primary = sets[0] ?? { xRefId: -1, ys: [], idx: [] };
	return primary.ys.map((yRef, i) => {
		const desired = [{ xRef: primary.xRefId, yRef }];
		const seriesIdx = [primary.idx[i]];
		for (let k = 1; k < sets.length; k++) {
			if (i < sets[k].ys.length) {
				desired.push({ xRef: sets[k].xRefId, yRef: sets[k].ys[i] });
				seriesIdx.push(sets[k].idx[i]);
			}
		}
		return {
			key: unitKeyFor('y', yRef, nextOrdinal('y', yRef)),
			name: getColumnById(yRef)?.name ?? `series ${i + 1}`,
			desired,
			sig: desired.map((d) => `${d.xRef}:${d.yRef}`).join(','),
			index: i,
			seriesIdx
		};
	});
}

/** The memo key of a unit list: joined keys plus sigs, in order. */
export function unitListSig(units) {
	return units.map((u) => `${u.key}|${u.sig}`).join(';');
}

// ---------------------------------------------------------------------------
// Panel geometry (plan 1.3): the grid maths of the v76.4 child reconcile, verbatim
// ---------------------------------------------------------------------------

/**
 * Where a generator's panel grid sits and how it steps. Snapped once per axis and once for
 * the origin, never per panel, so successive columns cannot round in different directions.
 * Reads only reactive generator fields and `appState.gridSize`, so a getter built on it
 * re-evaluates when the generator moves, resizes or changes its row count.
 */
function layoutFor(gen, count) {
	const padding = appState.gridSize ?? 15;
	const width = snapToGrid(gen.width ?? 360);
	const height = snapToGrid(gen.height ?? 220);
	// Step by the size of the WRAPPER, not the plot: Draggable adds side chrome and a header bar.
	const stepX = snapToGrid(width + PLOT_CHROME.x + padding);
	const stepY = snapToGrid(height + PLOT_CHROME.y + padding);
	// gen.facetRows: 0 = automatic (near-square); see facetGrid.js.
	const grid = facetGridCells(count, { rows: gen.facetRows ?? 0, stepX, stepY });
	// Origin of the panel grid: one generator-height plus two paddings below the generator.
	const originX = snapToGrid(gen.x ?? 0);
	const originY = snapToGrid((gen.y ?? 0) + height + PLOT_CHROME.y + 2 * padding);
	return { width, height, grid, originX, originY };
}

/**
 * A panel: everything a plot class reads off its wrapper (`id`, `width`, `height`, `style`)
 * and everything the control panel, SavePlot, sharedControls, Draggable and the toolbar read
 * (`id`, `name`, `type`, `x`, `y`, `width`, `height`, `selected`, `plot`, `style`). Verified by
 * grepping `parentBox.` under src/lib (id 31, width 28, height 27, style 37 uses; nothing
 * else) and the wrapper fields the consumers touch.
 *
 * `index`, `name`, `x`, `y`, `width`, `height` and `style` are GETTERS over the generator and
 * the current unit list, so they are reactive on read and nothing has to push updates in.
 */
export class FacetPanel {
	/** `${gen.id}:${unitKey}`, a string, stable for the life of the unit. */
	id;
	/** `y112#0`, `c241#0`. */
	unitKey;
	/** The generator Plot. */
	generator;
	/** The generator's type. */
	type;
	/** The current unit (plain, refreshed on every `panelsFor` read; not identity). */
	unit;
	/** Selection lives on the panel (plan 1.5). */
	selected = $state(false);
	/** The projected plot-class instance (plan 1.4). `$state` so a rebuild re-renders. */
	plot = $state(undefined);
	/** Bumped on every projection, for consumers that key on it. */
	rev = $state(0);
	/**
	 * A temporary size the panel is drawn at while an export captures it
	 * (save.svelte.js withPlotSize), null otherwise. A panel's size is the generator's, so
	 * the capture cannot resize the wrapper the way it does a plot; this is the equivalent.
	 */
	renderSize = $state(null);

	constructor(generator, unit) {
		this.generator = generator;
		this.unitKey = unit.key;
		this.id = `${generator.id}:${unit.key}`;
		this.type = generator.type;
		this.unit = unit;
	}

	/** Position in the current unit list: the grid cell and the panel number. NOT identity. */
	get index() {
		return panelsFor(this.generator).indexOf(this);
	}

	/** The unit name (the column name). Read-only for now (plan 5, item 10). */
	get name() {
		panelsFor(this.generator); // refresh `unit` against the live column name
		return this.unit?.name ?? '';
	}

	get x() {
		const list = panelsFor(this.generator);
		const { originX, grid } = layoutFor(this.generator, list.length);
		return originX + (grid.cells[list.indexOf(this)]?.dx ?? 0);
	}

	get y() {
		const list = panelsFor(this.generator);
		const { originY, grid } = layoutFor(this.generator, list.length);
		return originY + (grid.cells[list.indexOf(this)]?.dy ?? 0);
	}

	/** The generator's size, snapped, exactly as the v76.4 child reconcile sized a child. */
	get width() {
		return this.renderSize?.width ?? snapToGrid(this.generator.width ?? 360);
	}

	get height() {
		return this.renderSize?.height ?? snapToGrid(this.generator.height ?? 220);
	}

	/** The generator's style object BY REFERENCE (the Axis prop contract holds). */
	get style() {
		return this.generator.style;
	}
}

/** Whether `ref` is a FacetPanel (as opposed to a Plot or anything else). */
export function isFacetPanel(ref) {
	return ref instanceof FacetPanel;
}

/**
 * The generator series a panel's j-th series is a copy of. Writes that belong to the data
 * (an actogram marker placed or dragged on a panel) go here, never to the panel's copy,
 * which the next projection would overwrite (plan Phase 1 risk).
 */
export function panelSeriesTarget(panel, j) {
	if (!isFacetPanel(panel)) return null;
	const gi = panel.unit?.seriesIdx?.[j];
	return gi == null ? null : (panel.generator?.plot?.data?.[gi] ?? null);
}

// ---------------------------------------------------------------------------
// The panel list (plan 1.3)
// ---------------------------------------------------------------------------

const EMPTY = Object.freeze([]);

// WeakMap<Plot, { byKey: Object<unitKey, FacetPanel>, list: FacetPanel[], sig: string }>.
// A generator that is garbage collected takes its panels with it.
const _panels = new WeakMap();

/**
 * The generator's current panel list. Rebuilt only when the joined unit keys plus sigs
 * change; panels whose key survives are the SAME objects (selection, zoom mode and the cached
 * instance survive a reorder), panels whose key is gone are dropped. A non-generator (facet
 * false) has an empty list. Computed on read, writes nothing into `core`, no effects.
 */
export function panelsFor(gen) {
	if (!gen) return EMPTY;
	const units = gen.facet ? facetUnits(gen) : [];
	const sig = unitListSig(units);
	let entry = _panels.get(gen);
	if (!entry) {
		entry = { byKey: Object.create(null), list: [], sig: null };
		_panels.set(gen, entry);
	}
	if (entry.sig === sig) {
		// Same identity and wiring; only display fields (the column name) can have moved.
		for (const u of units) entry.byKey[u.key].unit = u;
		return entry.list;
	}
	const byKey = Object.create(null);
	const list = [];
	for (const u of units) {
		let panel = entry.byKey[u.key];
		if (!panel) panel = new FacetPanel(gen, u);
		panel.unit = u;
		byKey[u.key] = panel;
		list.push(panel);
	}
	for (const key in entry.byKey) {
		if (!byKey[key]) _projections.delete(entry.byKey[key]);
	}
	entry.byKey = byKey;
	entry.list = list;
	entry.sig = sig;
	return list;
}

/** Every panel of every generator, in `core.plots` order. */
export function allPanels() {
	const out = [];
	for (const p of core.plots ?? []) {
		if (p?.facet) out.push(...panelsFor(p));
	}
	return out;
}

// ---------------------------------------------------------------------------
// The panel instance (plan 1.4)
// ---------------------------------------------------------------------------

// The toJSON contract, same as op_setPlotInner's snapshotPlotInner: drop functions so Svelte
// $state proxies cannot smuggle methods.
function snapshotInner(inner) {
	return JSON.parse(JSON.stringify(inner, (k, v) => (typeof v === 'function' ? undefined : v)));
}

const WRAPPER_KEYS = ['x', 'y', 'column'];

/**
 * The wiring of a series' wrapper columns: what the panel's copy must reproduce (the
 * underlying column and the plot-column processes on it). Display fields of the wrapper
 * (name, type, timeFormat, ...) delegate to the underlying column live and are not wiring.
 */
function wiringOf(seriesJson) {
	const out = {};
	for (const k of WRAPPER_KEYS) {
		const w = seriesJson?.[k];
		if (w == null || typeof w !== 'object') continue;
		const entry = { refId: w.refId ?? null, processes: w.processes ?? [] };
		if (w.refUpToProcessId != null) entry.refUpToProcessId = w.refUpToProcessId;
		if (w.isTap) entry.isTap = true;
		out[k] = entry;
	}
	return out;
}

/**
 * A panel's copy of one generator series: the same JSON with the wrapper columns' `id`
 * removed, so the panel's wrapper Columns mint their own ids and never alias the
 * generator's (a wrapper id is a canvas identity; a panel has none).
 */
function seriesJsonForPanel(seriesJson) {
	const copy = { ...seriesJson };
	for (const k of WRAPPER_KEYS) {
		if (copy[k] != null && typeof copy[k] === 'object') {
			const rest = { ...copy[k] };
			delete rest.id;
			copy[k] = rest;
		}
	}
	return copy;
}

/**
 * The STRUCTURAL signature of a projected inner: type, unit sig, overlay ids and channels,
 * series wiring. A change here rebuilds the instance through `fromJSON`; anything else is
 * mirrored in place. Exported so tests pin what is and is not structural.
 */
export function panelStructureSig(type, unit, json) {
	return JSON.stringify({
		type,
		sig: unit?.sig ?? '',
		overlays: (json?.overlays ?? []).map((o) => ({ id: o?.id, channels: o?.channels ?? null })),
		wiring: (json?.data ?? []).map((d) => JSON.stringify(wiringOf(d)))
	});
}

const isPlainObject = (v) =>
	v != null &&
	typeof v === 'object' &&
	!Array.isArray(v) &&
	Object.getPrototypeOf(v) === Object.prototype;

// Subtrees the leaf diff never enters: covered by the structural signature instead.
function skipSubtree(path) {
	return /^data\[\d+\]\.(x|y|column)$/.test(path) || /^overlays\[\d+\]\.channels$/.test(path);
}

/**
 * Leaf-level diff of two projected inners. Scalar leaves that differ are collected as
 * `{ path, value }` for `setByPath`; any SHAPE change (an added or removed key, an array whose
 * length changed, a value that changed kind) is reported as structural, and the caller rebuilds.
 */
function diffLeaves(prev, next) {
	const paths = [];
	let structural = false;
	const walk = (a, b, path) => {
		if (structural) return;
		if (skipSubtree(path)) return;
		const aObj = a != null && typeof a === 'object';
		const bObj = b != null && typeof b === 'object';
		if (!aObj && !bObj) {
			if (a !== b) paths.push({ path, value: b });
			return;
		}
		if (aObj !== bObj || Array.isArray(a) !== Array.isArray(b)) {
			structural = true;
			return;
		}
		if (Array.isArray(a)) {
			if (a.length !== b.length) {
				structural = true;
				return;
			}
			a.forEach((av, i) => walk(av, b[i], `${path}[${i}]`));
			return;
		}
		const ak = Object.keys(a);
		const bk = Object.keys(b);
		if (ak.length !== bk.length || ak.some((k) => !(k in b))) {
			structural = true;
			return;
		}
		for (const k of ak) walk(a[k], b[k], path ? `${path}.${k}` : k);
	};
	if (!isPlainObject(prev) || !isPlainObject(next)) return { paths: [], structural: true };
	walk(prev, next, '');
	return { paths, structural };
}

// WeakMap<FacetPanel, { sig: string, json: object }>: the last projected inner per panel.
const _projections = new WeakMap();

/**
 * Build or update a panel's plot-class instance from its generator.
 *
 *   json = snapshot(gen.plot)            the toJSON contract, as op_setPlotInner
 *   json.data = the unit's series copies generator series i, j, ... (wrapper ids stripped)
 *   applyOverride(json, gen.facetOverrides?.[unitKey])   Phase 1: axis limits only
 *   structural change (panelStructureSig)  -> panel.plot = registry fromJSON(panel, json)
 *   otherwise                              -> setByPath on the paths whose JSON differs
 *
 * The override is applied BEFORE the diff, so an overridden leaf follows the override and a
 * generator edit on that leaf never reaches the panel (its value is unchanged in both sides
 * of the diff), while a changed override mirrors like any other leaf. That is how "the
 * mirror skips overridden paths" is realised without a second bookkeeping list.
 *
 * MUST be called from a deferred task (`queueMicrotask`), never inside a running effect:
 * `fromJSON` constructs `Column` wrappers, and a `$derived` created under an active reaction
 * goes derived_inert (see plotMetricOutputs.svelte.js). Use `schedulePanelProjection`.
 *
 * @returns {{ mode: 'rebuild'|'mirror'|'noop'|'disposed', paths: string[] }}
 */
export function projectPanel(panel) {
	const gen = panel?.generator;
	if (!gen || !panelsFor(gen).includes(panel)) return { mode: 'disposed', paths: [] };
	const entry = appConsts.plotMap.get(gen.type);
	if (typeof entry?.data?.fromJSON !== 'function') return { mode: 'disposed', paths: [] };
	const unit = panel.unit;

	const json = snapshotInner(gen.plot);
	const genData = Array.isArray(json.data) ? json.data : [];
	json.data = unit.seriesIdx.map((i) => seriesJsonForPanel(genData[i] ?? {}));
	applyOverride(json, gen.facetOverrides?.[panel.unitKey]);

	const sig = panelStructureSig(gen.type, unit, json);
	const prev = _projections.get(panel);
	let result;
	if (!panel.plot || !prev || prev.sig !== sig) {
		panel.plot = entry.data.fromJSON(panel, json);
		result = { mode: 'rebuild', paths: [] };
	} else {
		const { paths, structural } = diffLeaves(prev.json, json);
		if (structural) {
			panel.plot = entry.data.fromJSON(panel, json);
			result = { mode: 'rebuild', paths: [] };
		} else if (paths.length === 0) {
			return { mode: 'noop', paths: [] };
		} else {
			for (const { path, value } of paths) setByPath(panel.plot, path, value);
			result = { mode: 'mirror', paths: paths.map((p) => p.path) };
		}
	}
	_projections.set(panel, { sig, json });
	panel.rev++;
	return result;
}

// Panels with a projection already queued, so N synchronous requests cost one projection.
const _pending = new WeakSet();

/**
 * Defer `projectPanel` to a microtask, exactly the `usePlotMetricOutputs` idiom: the calling
 * `$effect` reads the generator's inner and the unit list (tracking them), and the
 * construction work runs after the effect has finished.
 */
export function schedulePanelProjection(panel) {
	if (!panel || _pending.has(panel)) return;
	_pending.add(panel);
	queueMicrotask(() => {
		_pending.delete(panel);
		projectPanel(panel);
	});
}

/**
 * The ONE projection effect a mounted panel host runs (plan 1.4). Tracks the generator's
 * inner (through its toJSON contract, which is exactly what `projectPanel` snapshots), the
 * unit list and this panel's override, then defers the projection to a microtask. Reads
 * nothing the projection writes (`plot`, `rev`), so it cannot re-trigger itself.
 *
 * Called from a component's script, like `usePlotMetricOutputs`.
 * @param {() => FacetPanel|null} getPanel
 */
export function usePanelProjection(getPanel) {
	$effect(() => {
		const panel = getPanel();
		const gen = panel?.generator;
		if (!gen) return;
		void JSON.stringify(gen.plot);
		void panelsFor(gen);
		void JSON.stringify(gen.facetOverrides?.[panel.unitKey] ?? null);
		schedulePanelProjection(panel);
	});
}
