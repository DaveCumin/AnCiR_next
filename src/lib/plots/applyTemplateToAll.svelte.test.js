// @ts-nocheck
// Settings > Figure defaults > "Apply to all plots" is ONE undo step that undoes exactly.
//
// REPORTED (vault TODO "Follow-ups from v82.15 to v82.17"): the button restyled every plot
// (style fields, monochrome / varied markers, physical width, a chosen palette) with plain
// writes, outside the history: Cmd+Z did nothing and the session did not count as edited.
// Now applyTemplateToAll records the whole thing, across every plot plus the palette and the
// session's appearance map, as one step.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { clearProcessNodeGraphCache } from '$lib/core/ProcessNode.svelte.js';
import {
	initUnsavedChanges,
	markSessionSaved,
	hasUnsavedChanges
} from '$lib/core/unsavedChanges.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { newFigureStyle } from './figureStyle.js';
import { applyTemplateToAll } from './applyTemplateToAll.js';

const PLOTS = await loadPlots();

beforeAll(() => {
	appConsts.plotMap = PLOTS;
	history.init();
	initUnsavedChanges();
});

const ORIGINAL_COLOURS = [...appState.appColours];

beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.tableProcesses = [];
	core.seriesAppearance = {};
	core.categoryColours = {};
	core.figureStyle = newFigureStyle();
	appState.appColours = [...ORIGINAL_COLOURS];
	appState.pendingPalette = null;
	appState.view = 'plots';
	history.clear();
	clearProcessNodeGraphCache();
});

const N = 48;
function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function sessionPlot(type, nSeries = 2) {
	const t = mkCol(
		't',
		Array.from({ length: N }, (_, i) => i)
	);
	const ys = Array.from({ length: nSeries }, (_, k) =>
		mkCol(
			`v${k}`,
			Array.from({ length: N }, (_, i) => 50 + 30 * Math.cos((2 * Math.PI * (i + 3 * k)) / 24))
		)
	);
	const inputs = appConsts.plotMap.get(type).defaultInputs ?? [];
	const data = ys.map((v) =>
		inputs.length === 1 && inputs[0] === 'column'
			? { column: { refId: v } }
			: { x: { refId: t }, y: { refId: v } }
	);
	const plot = new Plot({ type, name: type, width: 500, height: 300, plot: { data } });
	core.plots.push(plot);
	return core.plots[core.plots.length - 1];
}

const snapshot = () =>
	JSON.stringify({
		plots: core.plots.map((p) => p.toJSON()),
		colours: appState.appColours,
		series: core.seriesAppearance,
		categories: core.categoryColours
	});

describe('Apply to all plots', () => {
	it('is one undo step over every plot, the palette and the appearance map', () => {
		sessionPlot('scatterplot');
		sessionPlot('boxplot');
		sessionPlot('histogram', 1);
		sessionPlot('actogram', 1);
		const before = snapshot();
		markSessionSaved();
		const steps = history.undoCount;

		// A template every plot differs from, and a pending palette.
		core.figureStyle = newFigureStyle({
			fontSize: 'l',
			widthPreset: 'double',
			monochrome: false,
			varyMarkers: true,
			backgroundColour: '#ffffff'
		});
		const newColours = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'];
		appState.pendingPalette = { name: 'Test', colours: newColours };

		const n = applyTemplateToAll({ setPalette: (c) => (appState.appColours = c) });
		expect(n).toBe(4);
		const after = snapshot();
		expect(after).not.toBe(before);
		expect(appState.appColours).toEqual(newColours);
		expect(core.plots.every((p) => p.style.fontSize === 'l')).toBe(true);

		expect(history.undoCount).toBe(steps + 1);
		expect(hasUnsavedChanges()).toBe(true);

		history.undo();
		expect(snapshot()).toBe(before);
		history.redo();
		expect(snapshot()).toBe(after);
	});

	it('nothing to change records nothing', () => {
		sessionPlot('scatterplot');
		core.figureStyle = newFigureStyle(core.plots[0].style);
		// Settle once (applies anything the first pass would claim), then a second pass is a no-op.
		applyTemplateToAll();
		const steps = history.undoCount;
		applyTemplateToAll();
		expect(history.undoCount).toBe(steps);
	});

	it('without a pending palette the palette is untouched by undo and redo', () => {
		sessionPlot('scatterplot');
		core.figureStyle = newFigureStyle({ fontSize: 's', monochrome: true });
		const before = snapshot();
		applyTemplateToAll();
		expect(appState.appColours).toEqual(ORIGINAL_COLOURS);
		history.undo();
		expect(snapshot()).toBe(before);
	});
});

describe('the Settings button', () => {
	it('goes through applyTemplateToAll (not plain writes outside the history)', async () => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync('src/lib/components/views/modals/Settings.svelte', 'utf8');
		expect(src).toMatch(
			/onApplyToAll=\{\(\) =>[\s\S]{0,300}applyTemplateToAll\(\{ setPalette \}\)/
		);
		expect(src).not.toMatch(/applyStyleToAll\(/);
	});
});
