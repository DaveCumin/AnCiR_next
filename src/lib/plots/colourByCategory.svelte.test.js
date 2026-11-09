// @ts-nocheck
/**
 * Colour by, Category mode (colour-by plan 2026-10-20, v1.1), on the REAL plot classes and
 * components (no stubs: the "green-suite blindness" lesson of the figure-style ADR).
 *
 * A category is its LABEL, and a label has ONE colour in the session (core.categoryColours,
 * plots/seriesColour.js), the colour the Boxplot gives its box. Pinned here:
 *
 *   - the colours equal the Boxplot's for the same column, whichever plot draws first, and a
 *     colour the user pinned is used;
 *   - the palette cap (decision 4): at most one category per palette colour; beyond it Colour by
 *     refuses (no mark coloured, no key, a message), both sides of the gate;
 *   - a missing cell is "no value" (series colour), as for the other modes;
 *   - coloured lines (each segment its starting row's category), Q-Q (the row is kept through
 *     the sort), Mean +/- SEM (a group's shared category; a group mixing categories keeps the
 *     series colour), Circular phase;
 *   - monochrome draws the Boxplot's greys (greyForIndex by key order);
 *   - the key is a named swatch list, stacked with the legend and the size key without overlap,
 *     wrapping into columns when it does not fit;
 *   - save and load, undo, facets (one key over all panels), copy and paste.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { render, cleanup } from '@testing-library/svelte';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadPlots } from '$test/plotRegistry.js';
import { clearProcessNodeGraphCache } from '$lib/core/ProcessNode.svelte.js';
import { panelsFor, projectPanel } from '$lib/core/facetPanels.svelte.js';
import { history } from '$lib/core/opHistory.svelte.js';
import {
	categoryDomain,
	categoryIndices,
	encodingModesFor,
	sizeModesFor,
	groupCategory,
	SIZE_ENCODING_MODES
} from '$lib/components/plotbits/encodings.js';
import { categoryKeyGeometry } from '$lib/components/plotbits/ColourScale.svelte';
import { effectiveColourMode, formatColourValue } from '$lib/components/plotbits/encodingHost.js';
import {
	categoryCap,
	categoryColourLabels,
	colourForCategoryLabel,
	pinAllCategoryColours,
	proposedCategoryColours,
	setCategoryColour
} from './seriesColour.js';
import { recordCategoryColourEdit } from './appearanceEdits.js';
import { greyForIndex } from './seriesAppearance.js';
import Scatterplot from './Scatterplot/Scatterplot.svelte';
import Boxplot from './Boxplot/Boxplot.svelte';
import QQPlot from './QQPlot/QQPlot.svelte';
import MeanSEM from './MeanSEM/MeanSEM.svelte';
import CircularPhase from './CircularPhase/CircularPhase.svelte';

const DEFAULT_PALETTE = [...appState.appColours];
const H = 3600000;
const T0 = Date.UTC(2026, 0, 1);

function mkCol(values, type = 'number', name = 'c') {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function sessionPlot(type, data, { width = 600, height = 400 } = {}) {
	core.plots.push(new Plot({ type, name: type, width, height, plot: { data } }));
	return core.plots[core.plots.length - 1];
}

/** Series `i` coloured by `colId`, read as categories. */
function byCategory(plot, colId, i = 0, extra = {}) {
	const d = plot.plot.data[i];
	d.enableColourBy();
	d.colourBy.refId = colId;
	d.colourEncoding.mode = 'category';
	Object.assign(d.colourEncoding, extra);
	flushSync();
	return d;
}

/** A scatter of x, y with series 0 coloured by a category column of `labels`. */
function scatterByCategory(labels, { ctype = 'category', y = null, line = false } = {}) {
	const n = labels.length;
	const x = mkCol(
		Array.from({ length: n }, (_, i) => i),
		'number',
		'x'
	);
	const yy = mkCol(y ?? Array.from({ length: n }, (_, i) => (i * 7) % 5), 'number', 'y');
	const c = mkCol(labels, ctype, 'genotype');
	const plot = sessionPlot('scatterplot', [
		{ x: { refId: x }, y: { refId: yy }, line: { draw: line }, points: { shape: 'square' } }
	]);
	const d = byCategory(plot, c);
	return { plot, d, x, y: yy, c };
}

/** Each coloured marker path: { key, fill, centres }. */
function bucketPaths(container, sel = 'path[data-colour-bucket]') {
	return [...container.querySelectorAll(sel)].map((p) => ({
		key: p.getAttribute('data-colour-bucket'),
		fill: p.getAttribute('fill'),
		count: (p.getAttribute('d').match(/M/g) ?? []).length
	}));
}

const draw = (Component, plot) =>
	render(Component, { props: { theData: plot, which: 'plot' } }).container;

/** The fills of a one-series boxplot's boxes, left to right. */
function boxFills(container) {
	return [...container.querySelectorAll('rect')]
		.filter((r) => r.getAttribute('stroke') && r.getAttribute('fill') === r.getAttribute('stroke'))
		.sort((a, b) => Number(a.getAttribute('x')) - Number(b.getAttribute('x')))
		.map((r) => r.getAttribute('fill'));
}

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
});
beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.tableProcesses = [];
	core.chainRefs = [];
	core.categoryColours = {};
	core.seriesAppearance = {};
	appState.appColours = [...DEFAULT_PALETTE];
	appState.displayTimezone = 'utc';
	clearProcessNodeGraphCache();
});
afterEach(() => {
	cleanup();
	appState.appColours = [...DEFAULT_PALETTE];
});

// ---------------------------------------------------------------------------------------------
describe('the pure rules', () => {
	it('a text or category column reads as Category only; a plain number offers it last; never time', () => {
		const modes = (c) => encodingModesFor(c).map((m) => m.mode);
		expect(modes({ type: 'category' })).toEqual(['category']);
		expect(modes({ type: 'text' })).toEqual(['category']);
		expect(modes({ type: 'number' }).at(-1)).toBe('category');
		expect(modes({ type: 'time' })).not.toContain('category');
		expect(modes({ type: 'number', originTime_ms: 0 })).not.toContain('category');
		expect(effectiveColourMode('auto', { type: 'category' })).toBe('category');
		expect(effectiveColourMode('auto', { type: 'number' })).toBe('value');
		expect(effectiveColourMode('category', { type: 'number' })).toBe('category');
		// Size never reads a column as categories.
		expect(sizeModesFor({ type: 'number' }).map((m) => m.mode)).not.toContain('category');
		expect(sizeModesFor({ type: 'category' }).map((m) => m.mode)).not.toContain('category');
		expect(SIZE_ENCODING_MODES).not.toContain('category');
	});

	it('categories in the Boxplot order (first appearance; all numbers numerically), slots claimed by first appearance', () => {
		const dom = categoryDomain([
			['b', null, '10', 'a'],
			['2', 'b']
		]);
		// Mixed text and numbers: first appearance (plots/categoryOrder.js).
		expect(dom.categories).toEqual(['b', '10', 'a', '2']);
		expect(dom.firstSeen).toEqual(['b', '10', 'a', '2']);
		expect(categoryDomain([['10', '9', '100']]).categories).toEqual(['9', '10', '100']);
		expect(Array.from(categoryIndices(['b', null, 'zz', 'a'], ['a', 'b']))).toEqual([1, -1, -1, 0]);
		expect(formatColourValue('wt', 'category')).toBe('wt');
		expect(formatColourValue(null, 'category')).toBe('no value');
	});

	it('a group shares a category, has none, or mixes them', () => {
		expect(groupCategory(['a', null, 'a'])).toEqual({ label: 'a', mixed: false });
		expect(groupCategory([null, null])).toEqual({ label: null, mixed: false });
		expect(groupCategory(['a', 'b'])).toEqual({ label: null, mixed: true });
	});

	it('the proposed colours are exactly what pinning writes, around existing pins', () => {
		setCategoryColour('ko', appState.appColours[0]);
		const proposed = proposedCategoryColours(['wt', 'ko', 'het']);
		expect(core.categoryColours).toEqual({ ko: { slot: 0 } }); // reading wrote nothing
		const plot = scatterByCategory(['wt', 'ko', 'het']).plot;
		pinAllCategoryColours(core.plots);
		for (const label of ['wt', 'ko', 'het']) {
			expect(colourForCategoryLabel(label)).toBe(proposed.get(label));
		}
		// wt claimed slot 0 first, which ko holds: the next free one. No two share a colour.
		expect(new Set(proposed.values()).size).toBe(3);
		expect(plot.plot.data[0].colourPalette).toEqual(
			['wt', 'ko', 'het'].map((l) => colourForCategoryLabel(l))
		);
	});
});

// ---------------------------------------------------------------------------------------------
describe('the same colours as the Boxplot, for the same column', () => {
	const LABELS = ['wt', 'ko', 'wt', 'het', 'ko', 'het', 'wt', 'ko'];

	function boxplotOf(c, y) {
		return sessionPlot('boxplot', [{ x: { refId: c }, y: { refId: y } }]);
	}

	it('the Boxplot draws first: the scatter reads its pins', () => {
		const { plot, c, y } = scatterByCategory(LABELS);
		// Fresh pins: the box plot's own.
		core.categoryColours = {};
		const box = boxplotOf(c, y);
		const boxC = draw(Boxplot, box);
		flushSync();
		// wt, ko, het: both in first-appearance order (plots/categoryOrder.js).
		const fills = boxFills(boxC);
		expect(fills).toHaveLength(3);
		const d = plot.plot.data[0];
		expect(d.colourPalette).toEqual(fills);
		const paths = bucketPaths(draw(Scatterplot, plot));
		expect(paths.map((p) => p.fill).sort()).toEqual([...fills].sort());
		expect(plot.plot.colourKey.categories.map((k) => k.colour)).toEqual(fills);
	});

	it('the scatter draws first: the Boxplot reads the pins Colour by made', () => {
		const { plot, c, y } = scatterByCategory(LABELS);
		draw(Scatterplot, plot);
		pinAllCategoryColours(core.plots); // the app shell's effect
		const drawn = plot.plot.data[0].colourPalette;
		const box = boxplotOf(c, y);
		expect(boxFills(draw(Boxplot, box))).toEqual(drawn);
	});

	it('a colour the user pinned is drawn, and its picker is offered on the Data tab', () => {
		const { plot } = scatterByCategory(LABELS);
		setCategoryColour('ko', '#123456');
		flushSync();
		const d = plot.plot.data[0];
		expect(d.colourPalette[d.colourDomain.categories.indexOf('ko')]).toBe('#123456');
		expect(categoryColourLabels(plot)).toEqual(['wt', 'ko', 'het']);
		const paths = bucketPaths(draw(Scatterplot, plot));
		expect(paths.find((p) => p.fill === '#123456').count).toBe(3);
	});

	it('a picked category colour is one undo step', () => {
		history.init();
		history.clear();
		scatterByCategory(LABELS);
		pinAllCategoryColours(core.plots);
		const before = colourForCategoryLabel('wt');
		recordCategoryColourEdit(() => setCategoryColour('wt', '#abcdef'), {
			coalesceKey: 'category-colour:wt'
		});
		expect(colourForCategoryLabel('wt')).toBe('#abcdef');
		expect(history.undoCount).toBe(1);
		history.undo();
		expect(colourForCategoryLabel('wt')).toBe(before);
		history.redo();
		expect(colourForCategoryLabel('wt')).toBe('#abcdef');
	});

	it('numbers as categories: an id column read as Category', () => {
		const { plot, d } = scatterByCategory([3, 1, 2, 1, 3, 10], { ctype: 'number' });
		expect(d.colourMode).toBe('category');
		expect(d.colourDomain.categories).toEqual(['1', '2', '3', '10']);
		expect(Array.from(d.colourIdx)).toEqual([2, 0, 1, 0, 2, 3]);
		expect(plot.plot.colourKey.categorical).toBe(true);
	});
});

// ---------------------------------------------------------------------------------------------
describe('the palette cap: one category per palette colour, refused beyond', () => {
	const labels = (n) => Array.from({ length: 2 * n }, (_, i) => `g${i % n}`);

	it.each([
		['cap - 1', -1, false],
		['cap', 0, false],
		['cap + 1', 1, true]
	])('%s categories', (_name, delta, refused) => {
		const n = categoryCap() + delta;
		const { plot, d } = scatterByCategory(labels(n));
		const c = draw(Scatterplot, plot);
		const paths = bucketPaths(c);
		if (refused) {
			expect(d.colourRefusal).toMatch(new RegExp(`${n} categories.*at most ${categoryCap()}`));
			// No partial colouring: one plain series-coloured path, no key, no pickers.
			expect(d.colourIdx).toBeNull();
			expect(d.colourRender).toBeNull();
			expect(paths).toEqual([]);
			expect(c.querySelectorAll('path').length).toBeGreaterThan(0);
			expect(plot.plot.colourKey).toBeNull();
			expect(c.querySelector('.colour-scale')).toBeNull();
			expect(categoryColourLabels(plot)).toEqual([]);
			expect(d.colourCategoryPinOrder).toBeNull();
			expect(d.getLegendItem().elements[0].color).toBe(d.points.colour);
		} else {
			expect(d.colourRefusal).toBeNull();
			expect(paths).toHaveLength(n);
			expect(new Set(paths.map((p) => p.fill)).size).toBe(n);
			expect(c.querySelectorAll('.colour-scale-category')).toHaveLength(n);
		}
	});

	it('the cap follows the palette: a shorter palette refuses sooner', () => {
		appState.appColours = DEFAULT_PALETTE.slice(0, 3);
		const { d } = scatterByCategory(labels(4));
		expect(d.colourRefusal).toMatch(/4 categories.*at most 3/);
		appState.appColours = [...DEFAULT_PALETTE];
		flushSync();
		expect(d.colourRefusal).toBeNull();
	});

	it('the panel shows the refusal, and no colour settings', () => {
		const { plot } = scatterByCategory(labels(categoryCap() + 1));
		appState.currentControlTab = 'data';
		try {
			const c = render(Scatterplot, { props: { theData: plot.plot, which: 'controls' } }).container;
			const panel = c.querySelector('.colour-by');
			expect(panel.textContent).toMatch(/Nothing is coloured/);
			expect(panel.textContent).not.toMatch(/Colours/);
			expect(panel.textContent).toMatch(/Read as/);
		} finally {
			appState.currentControlTab = 'properties';
		}
	});
});

// ---------------------------------------------------------------------------------------------
describe('points, missing cells and lines', () => {
	it('a missing cell is "no value": drawn in the series colour, underneath, and on the key', () => {
		const { plot, d } = scatterByCategory(['a', '', 'b', null, 'a', '  ']);
		expect(d.colourNoValueCount).toBe(3);
		const c = draw(Scatterplot, plot);
		const paths = bucketPaths(c);
		expect(paths[0]).toMatchObject({ key: 'none', fill: d.points.colour, count: 3 });
		expect(plot.plot.colourKey.noValue).toEqual({ colour: d.points.colour, label: 'no value' });
		const rows = [...c.querySelectorAll('.colour-scale g')].map((g) => g.textContent.trim());
		expect(rows).toEqual(['a', 'b', 'no value']);
	});

	it('the tooltip and the CSV name the category', () => {
		const { plot, d } = scatterByCategory(['a', null, 'b']);
		expect(d.colourRender.format(d.colourRender.values[0])).toBe('a');
		expect(d.colourRender.format(d.colourRender.values[1])).toBe('no value');
		const csv = plot.plot.getDownloadData?.() ?? plot.plot.downloadData?.();
		const text = JSON.stringify(csv);
		expect(text).toContain('"a"');
		expect(text).toContain('"b"');
	});

	it('each line segment takes its starting row’s category colour; a gap still breaks it', () => {
		const labels = ['a', 'a', 'b', 'b', null, 'a'];
		const { plot, d } = scatterByCategory(labels, {
			y: [1, 2, 3, null, 5, 6],
			line: true
		});
		d.colourEncoding.colourLine = true;
		flushSync();
		const c = draw(Scatterplot, plot);
		const lines = [...c.querySelectorAll('path[data-line-colour-bucket]')].map((p) => ({
			key: p.getAttribute('data-line-colour-bucket'),
			stroke: p.getAttribute('stroke'),
			segs: (p.getAttribute('d').match(/M/g) ?? []).length
		}));
		// Segments 0-1 (a), 1-2 (a), 4-5 (no value: starts at row 4); 2-3 and 3-4 break at y.
		const a = d.colourPalette[0];
		expect(lines).toEqual([
			{ key: 'none', stroke: d.line.colour, segs: 1 },
			{ key: 'b0', stroke: a, segs: 2 }
		]);
	});

	it('monochrome draws the Boxplot’s greys by key order; the session colours stay', () => {
		const { plot, d } = scatterByCategory(['c', 'a', 'b', 'a']);
		pinAllCategoryColours(core.plots);
		const pins = JSON.stringify(core.categoryColours);
		plot.style = { ...plot.style, monochrome: true };
		flushSync();
		expect(d.colourPalette).toEqual([0, 1, 2].map((i) => greyForIndex(i, 3)));
		expect(plot.plot.colourKey.categories.map((k) => k.colour)).toEqual(d.colourPalette);
		expect(JSON.stringify(core.categoryColours)).toBe(pins);
		expect(categoryColourLabels(plot)).toEqual([]);
		// The same greys as a monochrome box plot of the same column.
		const box = sessionPlot('boxplot', [
			{ x: { refId: d.colourBy.refId }, y: { refId: plot.plot.data[0].y.refId } }
		]);
		box.style = { ...box.style, monochrome: true };
		expect(boxFills(draw(Boxplot, box))).toEqual(d.colourPalette);
	});
});

// ---------------------------------------------------------------------------------------------
describe('the other hosts', () => {
	it('Q-Q: each sample keeps its own row’s category through the sort', () => {
		const v = mkCol([5, 1, 4, 2, 3]);
		const c = mkCol(['e', 'a', 'd', 'b', 'c'], 'category', 'grp');
		const plot = sessionPlot('qqplot', [{ column: { refId: v } }]);
		const d = byCategory(plot, c);
		expect(d.colourMarkValues).toEqual(['a', 'b', 'c', 'd', 'e']);
		const paths = bucketPaths(draw(QQPlot, plot));
		expect(paths).toHaveLength(5);
		expect(plot.plot.colourKey.categorical).toBe(true);
	});

	it('Mean +/- SEM: a group takes its rows’ shared category; a mixed group keeps the series colour', () => {
		const x = mkCol(['d1', 'd1', 'd2', 'd2', 'd3', 'd3'], 'category', 'day');
		const y = mkCol([1, 2, 3, 4, 5, 6]);
		const c = mkCol(['wt', 'wt', 'ko', 'ko', 'wt', 'ko'], 'category', 'genotype');
		const plot = sessionPlot('meansem', [{ x: { refId: x }, y: { refId: y } }]);
		const d = byCategory(plot, c);
		expect(d.colourMarkValues).toEqual(['wt', 'ko', null]);
		expect(d.colourMixedCount).toBe(1);
		expect(d.colourNoValueCount).toBe(1);
		expect(d.colourSummaryNote).toMatch(/1 group mixes categories and keeps the series colour/);
		const paths = bucketPaths(draw(MeanSEM, plot));
		expect(paths[0]).toMatchObject({ key: 'none', count: 1 });
		expect(paths.length).toBe(3);
	});

	it('Circular phase: every dot its row’s category; the key beside the clock', () => {
		const t = mkCol(
			Array.from({ length: 8 }, (_, i) => T0 + i * 3 * H),
			'time',
			't'
		);
		const c = mkCol(['a', 'b', 'a', 'b', 'c', 'c', null, 'a'], 'category', 'grp');
		const plot = sessionPlot('circularphase', [{ column: { refId: t } }]);
		const d = byCategory(plot, c);
		expect(d.colourNoValueCount).toBe(1);
		const container = draw(CircularPhase, plot);
		const paths = bucketPaths(container);
		expect(paths.map((p) => p.count).reduce((a, b) => a + b, 0)).toBe(8);
		expect(container.querySelectorAll('.colour-scale-category')).toHaveLength(3);
		const at = plot.plot.encodingKeys.placement;
		expect(at.x).toBeGreaterThan(plot.plot.plotSize * 0.9);
	});
});

// ---------------------------------------------------------------------------------------------
describe('the key', () => {
	const overlap = (a, b) =>
		a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

	function keyRect(s) {
		const keys = s.encodingKeys;
		const at = keys.placement;
		// The key as ColourScale draws it (computed here, not read back from the layout).
		const key = s.colourKey;
		const g = categoryKeyGeometry({
			items: key.categories,
			noValue: key.noValue,
			title: key.title,
			fontSize: keys.fontPx,
			length: at.length
		});
		const pad = keys.inset;
		return { x: at.x - pad, y: at.y - pad, width: g.width + 2 * pad, height: g.height + 2 * pad };
	}
	function sizeRect(s) {
		const keys = s.encodingKeys;
		const at = keys.sizePlacement;
		const g = keys.sizeBase;
		const pad = keys.sizeInset;
		return { x: at.x - pad, y: at.y - pad, width: g.width + 2 * pad, height: g.height + 2 * pad };
	}
	function legendRect(s) {
		const p = s.encodingKeys.legendPlaced;
		return { x: p.x, y: p.y, width: p.width, height: p.height };
	}

	/** Two series (the legend has two entries), coloured by category and sized by a number. */
	function keyed({ width = 600, height = 400, n = 4 } = {}) {
		const labels = Array.from({ length: 24 }, (_, i) => `group ${i % n}`);
		const { plot, d } = scatterByCategory(labels);
		const s = plot.plot;
		s.addData({ x: { refId: d.x.refId }, y: { refId: mkCol(labels.map((_, i) => i / 3)) } });
		d.enableSizeBy();
		d.sizeBy.refId = mkCol(
			labels.map((_, i) => i),
			'number',
			'count'
		);
		s.legend.show = true;
		plot.width = width;
		plot.height = height;
		flushSync();
		return { plot, s, d };
	}

	it('geometry: one column when it fits, columns read top to bottom when it does not', () => {
		const items = ['a', 'bb', 'ccc', 'dddd', 'e'].map((label) => ({ label, colour: '#000' }));
		const one = categoryKeyGeometry({ items, title: 'Genotype', fontSize: 10 });
		expect(one.columns).toBe(1);
		expect(one.rows.map((r) => r.x)).toEqual([0, 0, 0, 0, 0]);
		expect(one.height).toBe(one.titleH + one.natural);
		const two = categoryKeyGeometry({
			items,
			noValue: { colour: '#999' },
			title: 'Genotype',
			fontSize: 10,
			length: 3 * one.step
		});
		expect(two.perColumn).toBe(3);
		expect(two.columns).toBe(2);
		expect(two.rows.map((r) => r.label)).toEqual(['a', 'bb', 'ccc', 'dddd', 'e', 'no value']);
		expect(two.rows.slice(3).every((r) => r.x > 0)).toBe(true);
		expect(two.height).toBeLessThan(one.height);
		expect(two.width).toBeGreaterThan(one.width);
	});

	it.each([
		['beside the plot, legend outside', 'outsideright', 'right', 'right'],
		['beside the plot, legend inside', 'topright', 'right', 'right'],
		['top right corner with the legend and the size key', 'topright', 'topright', 'topright'],
		['bottom left corner', 'bottomleft', 'bottomleft', 'bottomleft'],
		['legend auto, keys in a corner', 'auto', 'topleft', 'topleft']
	])('%s: legend, colour key and size key never overlap', (_n, legendPos, colourPos, sizePos) => {
		const { s } = keyed();
		s.legend.position = legendPos;
		s.colourScale.position = colourPos;
		s.sizeScale.position = sizePos;
		flushSync();
		const key = keyRect(s);
		const size = sizeRect(s);
		const legend = legendRect(s);
		expect(overlap(key, size)).toBe(false);
		expect(overlap(key, legend)).toBe(false);
		expect(overlap(size, legend)).toBe(false);
		if (colourPos === 'right') {
			// Inside the figure, past the plot area.
			expect(key.x).toBeGreaterThanOrEqual(s.plotwidth);
			expect(key.x + key.width).toBeLessThanOrEqual(s.basePlotWidth + s.padding.right + 1);
		}
	});

	it('under an outside legend on a short plot: every column stays inside the figure', () => {
		const { s } = keyed({ height: 220, n: 9 });
		s.legend.position = 'outsideright';
		s.sizeScale.show = false;
		flushSync();
		const key = keyRect(s);
		const legend = legendRect(s);
		expect(overlap(key, legend)).toBe(false);
		expect(key.x + key.width).toBeLessThanOrEqual(s.basePlotWidth + s.padding.right + 1);
		expect(key.y + key.height).toBeLessThanOrEqual(s.plotheight + 1);
	});

	it('a short plot wraps the categories into columns, and reserves room for every column', () => {
		const { s } = keyed({ height: 170, n: 9 });
		s.legend.show = false;
		s.sizeScale.show = false;
		flushSync();
		const keys = s.encodingKeys;
		const g = keys.geometry(keys.placement.length);
		expect(g.columns).toBeGreaterThan(1);
		expect(g.height).toBeLessThanOrEqual(s.plotheight);
		expect(s.basePlotWidth - s.plotwidth).toBeGreaterThanOrEqual(g.width);
	});
});

// ---------------------------------------------------------------------------------------------
describe('save, load, facets, paste', () => {
	it('round-trips the mode; a file without it loads unchanged', () => {
		const { plot } = scatterByCategory(['a', 'b', 'a']);
		const json = JSON.parse(JSON.stringify(plot));
		expect(json.plot.data[0].colourEncoding.mode).toBe('category');
		const back = Plot.fromJSON(json);
		expect(back.plot.data[0].colourEncoding.mode).toBe('category');
		expect(back.plot.data[0].colourDomain.categories).toEqual(['a', 'b']);
		expect(JSON.parse(JSON.stringify(back))).toEqual(json);
	});

	it('facets: every panel draws one key over all panels’ categories, in the same colours', () => {
		const x = mkCol([0, 1, 2], 'number', 'x');
		const ya = mkCol([1, 2, 3], 'number', 'a');
		const yb = mkCol([3, 2, 1], 'number', 'b');
		const ca = mkCol(['wt', 'ko', 'wt'], 'category', 'ca');
		const cb = mkCol(['het', 'ko', 'het'], 'category', 'cb');
		const gen = sessionPlot('scatterplot', [
			{ x: { refId: x }, y: { refId: ya } },
			{ x: { refId: x }, y: { refId: yb } }
		]);
		byCategory(gen, ca, 0);
		byCategory(gen, cb, 1);
		gen.facet = true;
		const panels = panelsFor(gen);
		for (const p of panels) projectPanel(p);
		const keys = panels.map((p) => p.plot.colourKey);
		expect(keys[0].categories).toEqual(keys[1].categories);
		expect(keys[0].categories.map((k) => k.label)).toEqual(['wt', 'ko', 'het']);
		// 'ko' is drawn in one colour in both panels.
		const ko = (p) => {
			const d = p.plot.data[0];
			return d.colourPalette[d.colourDomain.categories.indexOf('ko')];
		};
		expect(ko(panels[0])).toBe(ko(panels[1]));
	});

	it('a pasted plot keeps the setting and lands unwired', async () => {
		const { clearPlotInputs } = await import('$lib/core/nodeClipboard.js');
		const { plot } = scatterByCategory(['a', 'b']);
		const envelope = clearPlotInputs(JSON.parse(JSON.stringify(plot)));
		delete envelope.id;
		const pasted = Plot.fromJSON(envelope);
		expect(pasted.plot.colourKey).toBeNull();
		expect(plot.plot.data[0].colourEncoding.mode).toBe('category');
	});
});
