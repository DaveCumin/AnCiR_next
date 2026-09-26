// @ts-nocheck
// Plot references (plan docs/plans/2026-09-26-facets-as-views.md, section 1.5).
//
// A "plot ref" is anything the workspace renders and the control panel edits: a top-level
// `Plot` (numeric id) or a `FacetPanel` (string id `${gen.id}:${unitKey}`). These three
// primitives are what every consumer switches to, so no consumer carries its own
// plot-vs-panel special case.
import { core, appState } from '$lib/core/core.svelte';
import { allPanels, panelsFor, isFacetPanel } from '$lib/core/facetPanels.svelte.js';
import { snapToGrid } from '$lib/core/core.svelte';

export { isFacetPanel };

// `<generator id>:<role><column id>#<ordinal>`; see facetPanels.unitKeyFor.
const PANEL_ID = /^(\d+):([yc]\d+#\d+)$/;

/** Whether `id` is a panel id string (as opposed to a numeric plot id or anything else). */
export function isPanelId(id) {
	return typeof id === 'string' && PANEL_ID.test(id);
}

/** Split a panel id into its generator id and unit key, or null when it is not one. */
export function panelIdParts(id) {
	if (typeof id !== 'string') return null;
	const m = PANEL_ID.exec(id);
	return m ? { generatorId: Number(m[1]), unitKey: m[2] } : null;
}

/**
 * number -> the Plot in core.plots; 'gen:unit' -> the FacetPanel (the same object
 * `panelsFor` returns); anything else, or a stale id -> null.
 */
export function resolvePlotRef(id) {
	if (typeof id === 'number') return core.plots.find((p) => p.id === id) ?? null;
	const parts = panelIdParts(id);
	if (!parts) return null;
	const gen = core.plots.find((p) => p.id === parts.generatorId);
	if (!gen?.facet) return null;
	return panelsFor(gen).find((p) => p.unitKey === parts.unitKey) ?? null;
}

/** What the workspace draws: top-level plots (generators excluded) plus every panel. */
export function renderables() {
	return [...core.plots.filter((p) => !p.facet), ...allPanels()];
}

/**
 * The plots the workflow canvas has multi-selected, as refs. Mirrors
 * ControlDisplay.activeCanvasMultiIds / canvasSelectedPlotIds: only in the canvas view (a
 * stale canvas selection must not union with a freshly clicked worksheet plot), only
 * `plot_<id>` entries. The id after `plot_` may be numeric (a Plot, generators included:
 * the canvas node of a generator selects the GENERATOR) or a panel id.
 */
function canvasSelectedRefs() {
	if (appState.view !== 'canvas') return [];
	const out = [];
	for (const id of appState.canvasMultiSelectedNodeIds ?? []) {
		if (typeof id !== 'string' || !id.startsWith('plot_')) continue;
		const raw = id.slice(5);
		const n = Number(raw);
		const ref = Number.isFinite(n) && String(n) === raw ? resolvePlotRef(n) : resolvePlotRef(raw);
		if (ref) out.push(ref);
	}
	return out;
}

/**
 * The current selection as refs: plots with `selected` (generators included, exactly as
 * ControlDisplay.rawSelectedPlots collects them today), panels with `selected`, and the
 * canvas multi-selection; deduped by id, in that order.
 */
export function selectedRefs() {
	const seen = Object.create(null);
	const out = [];
	const add = (ref) => {
		if (!ref || seen[ref.id]) return;
		seen[ref.id] = true;
		out.push(ref);
	};
	for (const p of core.plots) if (p.selected) add(p);
	for (const panel of allPanels()) if (panel.selected) add(panel);
	for (const ref of canvasSelectedRefs()) add(ref);
	return out;
}

/**
 * The Plot that owns edits to a ref: the generator for a panel (Phase 1 routes every
 * panel edit to its generator), the plot itself otherwise. Null for a stale ref.
 */
export function ownerPlotOf(ref) {
	if (!ref) return null;
	return isFacetPanel(ref) ? ref.generator : ref;
}

/**
 * The ref a canvas node id names: `plot_7` is plot 7 (a generator included, its node selects
 * the generator), `plot_7:c112#0` is that panel. Anything else is null.
 */
export function refFromNodeId(nodeId) {
	if (typeof nodeId !== 'string' || !nodeId.startsWith('plot_')) return null;
	const raw = nodeId.slice(5);
	const n = Number(raw);
	return Number.isFinite(n) && String(n) === raw ? resolvePlotRef(n) : resolvePlotRef(raw);
}

/**
 * Move a ref to (x, y) on the workspace. A plot moves itself; a panel's position is derived
 * from its generator, so the GENERATOR moves by the same delta (what a user dragging a
 * child saw today after the reconcile snapped it back, minus the snap).
 */
export function moveRefTo(ref, x, y) {
	const owner = ownerPlotOf(ref);
	if (!owner) return;
	if (owner === ref) {
		owner.x = snapToGrid(x);
		owner.y = snapToGrid(y);
		return;
	}
	owner.x = snapToGrid(owner.x + (x - ref.x));
	owner.y = snapToGrid(owner.y + (y - ref.y));
}

/** Clear every selection: plots (generators included) and panels. */
export function deselectAllRefs() {
	for (const p of core.plots) p.selected = false;
	for (const panel of allPanels()) panel.selected = false;
}
