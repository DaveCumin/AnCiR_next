// Per-category colour controls for the boxplot (Bug: "example boxplot only shows one
// series colour control").
//
// Every shipped example boxplot is ONE series with a categorical x column, so the plot
// draws one box per unique x VALUE, each coloured from core.categoryColours
// (useCategoryColour in plots/Boxplot/Boxplot.svelte). Before this work no UI wrote
// that map: the Data tab offered exactly one (inert) stroke/fill picker while the plot
// showed N differently-coloured boxes.
//
// `categoryColourLabels` is the panel-side statement of the useCategoryColour
// condition — the control panel (CategoryColourControls.svelte) shows one picker per
// label it returns. Built on the REAL Boxplotclass and REAL Columns, not on stubs: a
// plain-object fixture cannot see Svelte-class reactivity shapes (see the note in
// plots/seriesAppearance.js about exactly that blindness).
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appState } from '$lib/core/core.svelte';
import { Column } from '$lib/core/Column.svelte';
import { Boxplotclass } from './Boxplot/Boxplot.svelte';
import {
	categoryColourLabels,
	setCategoryColour,
	colourForCategoryLabel,
	releaseCategoryColour
} from './seriesColour.js';

const PALETTE = ['#aa0000', '#00aa00', '#0000aa', '#aaaa00'];

function mkCol(type, values) {
	const c = new Column({ type, data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function makeCategoryBoxplot() {
	const xId = mkCol('category', ['A', 'A', 'B', 'B', 'C', 'C']);
	const yId = mkCol('number', [1, 2, 3, 4, 5, 6]);
	const parentBox = { id: 1, width: 400, height: 300, data: [] };
	const chart = new Boxplotclass(parentBox, { x: { refId: xId }, y: { refId: yId } });
	return { chart, xId, yId };
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	core.categoryColours = {};
	core.seriesAppearance = {};
	appState.appColours = [...PALETTE];
});

describe('categoryColourLabels (which plots get per-category colour controls)', () => {
	it('a one-series boxplot with a categorical x lists every category', () => {
		const { chart } = makeCategoryBoxplot();
		const wrapper = { type: 'boxplot', style: {}, plot: chart };
		// This is the reported bug at descriptor level: the panel used to derive ZERO
		// per-box colour controls from this plot, despite it drawing three coloured boxes.
		expect(categoryColourLabels(wrapper)).toEqual(['A', 'B', 'C']);
	});

	it('a multi-series boxplot answers [] — colour distinguishes the series there', () => {
		const { chart } = makeCategoryBoxplot();
		const y2 = mkCol('number', [7, 8, 9]);
		chart.addData({ x: null, y: { refId: y2 } });
		expect(chart.data).toHaveLength(2);
		expect(categoryColourLabels({ type: 'boxplot', style: {}, plot: chart })).toEqual([]);
	});

	it('a series without category x data answers []', () => {
		const yId = mkCol('number', [1, 2, 3]);
		const parentBox = { id: 1, width: 400, height: 300, data: [] };
		const chart = new Boxplotclass(parentBox, { x: null, y: { refId: yId } });
		expect(categoryColourLabels({ type: 'boxplot', style: {}, plot: chart })).toEqual([]);
	});

	it('a monochrome figure answers [] — the boxes are greys, a colour control would lie', () => {
		const { chart } = makeCategoryBoxplot();
		const wrapper = { type: 'boxplot', style: { monochrome: true }, plot: chart };
		expect(categoryColourLabels(wrapper)).toEqual([]);
	});

	it('non-boxplot wrappers and empty wrappers answer []', () => {
		const { chart } = makeCategoryBoxplot();
		expect(categoryColourLabels({ type: 'scatterplot', style: {}, plot: chart })).toEqual([]);
		expect(categoryColourLabels(null)).toEqual([]);
		expect(categoryColourLabels({ type: 'boxplot', plot: null })).toEqual([]);
	});
});

describe('setCategoryColour (what the picker writes)', () => {
	it('a palette colour is stored as a SLOT, so it follows a palette switch', () => {
		expect(setCategoryColour('A', PALETTE[2])).toBe(true);
		expect(core.categoryColours['A']).toEqual({ slot: 2 });
		expect(colourForCategoryLabel('A')).toBe(PALETTE[2]);
		appState.appColours = ['#111111', '#222222', '#333333', '#444444'];
		expect(colourForCategoryLabel('A')).toBe('#333333');
	});

	it('a colour outside the palette is locked as hex', () => {
		expect(setCategoryColour('B', '#123456')).toBe(true);
		expect(core.categoryColours['B']).toEqual({ hex: '#123456' });
		expect(colourForCategoryLabel('B')).toBe('#123456');
	});

	it('an unusable value writes nothing', () => {
		expect(setCategoryColour('C', null)).toBe(false);
		expect(setCategoryColour('C', 42)).toBe(false);
		expect(core.categoryColours['C']).toBeUndefined();
	});

	it('release forgets the pin again', () => {
		setCategoryColour('A', '#123456');
		releaseCategoryColour('A');
		expect(colourForCategoryLabel('A')).toBe(null);
	});
});
