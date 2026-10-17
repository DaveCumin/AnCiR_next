// @ts-nocheck
// Settings > Figure defaults > "Apply to all plots", as ONE undo step.
//
// The button pushes the session template onto every existing plot: the style fields
// (figureStyle.applyStyleToAll), monochrome / varied markers into the series that already
// exist (seriesAppearance.applyAppearanceToAll, which may also claim marker shapes in the
// session's appearance map), the physical width (figureStyle.applyFigureWidthToAll), and a
// palette chosen in Settings but not yet in use (it goes first: the series colours resolve
// against it). Done as plain writes it was invisible to the history: Cmd+Z did nothing and the
// session did not count as edited.
//
// Now the writes run inside plotEdits.commitPlotsEdit, which turns every plot's change into
// operations, and the two pieces of session state that are not a plot (the palette and the
// appearance map) are put back and re-applied as their own operations in the same step. Undo
// restores every plot, the palette and the map exactly; redo re-applies them.
import { core, appState } from '$lib/core/core.svelte.js';
import { applyStyleToAll, applyFigureWidthToAll } from './figureStyle.js';
import { applyAppearanceToAll } from './seriesAppearance.js';
import { takePendingPalette } from './styleConfig.js';
import { commitPlotsEdit } from './plotEdits.js';

const clone = (v) => JSON.parse(JSON.stringify(v ?? {}));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * @param {{ setPalette?: (colours: string[]) => void }} [hooks] the palette swap (Settings'
 *   own, which also repaints colours stored once and updates the favicon)
 * @returns {number} how many plots the template was applied to
 */
export function applyTemplateToAll({ setPalette } = {}) {
	const colours = takePendingPalette();
	const prevColours = [...(appState.appColours ?? [])];
	const prevSeries = clone(core.seriesAppearance);
	const prevCategories = clone(core.categoryColours);
	let n = 0;

	commitPlotsEdit(
		core.plots,
		() => {
			// The palette first: the slot records below resolve against it.
			if (colours && setPalette) setPalette(colours);
			n = applyStyleToAll(core.plots, core.figureStyle);
			applyAppearanceToAll(core.plots);
			applyFigureWidthToAll(core.plots);
		},
		{
			prepare: () => {
				const ops = [];
				if (!same(appState.appColours, prevColours)) {
					const next = [...appState.appColours];
					appState.appColours = prevColours;
					ops.push({ kind: 'setAppColours', colours: next });
				}
				const series = clone(core.seriesAppearance);
				const categories = clone(core.categoryColours);
				if (!same(series, prevSeries) || !same(categories, prevCategories)) {
					core.seriesAppearance = prevSeries;
					core.categoryColours = prevCategories;
					ops.push({ kind: 'setAppearanceMaps', series, categories });
				}
				return ops;
			}
		}
	);
	return n;
}
