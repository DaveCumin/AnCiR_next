// @ts-nocheck
// Keeps workspace notes off the plots (UI-7). The geometry is pure and lives in
// workspaceLayout.js (noteLaneLayout, freeNoteSpot); this module only reads the live session
// (core.notes, and renderables() so facet panels count as the plots they are drawn as) and
// writes the positions back.
import { core, appState } from '$lib/core/core.svelte.js';
import { renderables } from '$lib/core/plotRefs.js';
import {
	plotCardBox,
	noteCardBox,
	noteLaneLayout,
	freeNoteSpot
} from '$lib/core/workspaceLayout.js';

function plotBoxes() {
	const grid = appState.gridSize ?? 15;
	return renderables().map((p) => plotCardBox(p, grid));
}

/**
 * After a session loads: move every note that covers a plot into a lane above the plots, and
 * shift the plots (with any other notes) down to make room. A no-op when nothing overlaps, so a
 * session the user arranged by hand opens exactly as saved. Returns whether anything moved.
 */
export function clearNotesFromPlots() {
	const notes = core.notes ?? [];
	if (notes.length === 0) return false;
	const { dy, notes: moves } = noteLaneLayout({
		notes: notes.map(noteCardBox),
		plots: plotBoxes(),
		grid: appState.gridSize ?? 15
	});
	if (dy === 0 && moves.size === 0) return false;
	// Top-level plots and facet generators: a panel's position is derived from its generator.
	if (dy !== 0) for (const p of core.plots) p.y = (p.y ?? 0) + dy;
	for (const n of notes) {
		const to = moves.get(n.id);
		if (to) {
			n.x = to.x;
			n.y = to.y;
		}
	}
	return true;
}

/** Nudge a just-created note to the nearest spot where it covers no plot and no other note. */
export function placeNoteClear(note) {
	if (!note) return;
	const obstacles = [
		...plotBoxes(),
		...(core.notes ?? []).filter((n) => n.id !== note.id).map(noteCardBox)
	];
	const spot = freeNoteSpot(noteCardBox(note), obstacles, { grid: appState.gridSize ?? 15 });
	note.x = spot.x;
	note.y = spot.y;
}
