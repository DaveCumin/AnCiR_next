// @ts-nocheck
/**
 * Switching an FFT plot between period and frequency mode, by every route that can do it.
 *
 * The x limits (`xlimsIN`) are stored in the units of the CURRENT mode, so a switch must
 * convert them (periods [4, 30] are frequencies [1/30, 1/4]). Only the Properties checkbox
 * used to, so the multi-select "Show Period" field and an AI edit left period limits on a
 * frequency axis: it read 4 to 0.5 and drew nothing. The conversion now lives in ONE place
 * (FFTclass.pairedEdits, fftAxis.setFftShowPeriod) that every edit route goes through, and a
 * switch is one undo step that restores the mode and the limits together.
 *
 * State APPLICATION (fromJSON on load or undo, the facet panel mirror) is not a switch: the
 * stored limits are already in the stored mode, and converting them again would corrupt them.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { clearProcessNodeGraphCache } from '$lib/core/ProcessNode.svelte.js';
import { panelsFor, projectPanel } from '$lib/core/facetPanels.svelte.js';
import { applyEdit } from '$lib/utils/aiEdit.js';
import { applyInnerEdits } from '$lib/plots/pairedEdits.js';
import ControlDisplay from '$lib/components/views/ControlDisplay.svelte';
import FFT from './FFT.svelte';

const HOURS = Array.from({ length: 96 }, (_, i) => i);
const WAVE = HOURS.map((t) => 10 + 5 * Math.cos((2 * Math.PI * t) / 24));

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

/** A real FFT plot in core.plots, period mode, with the given x limits. */
function makeFft(xlimsIN = [4, 30], { series = 1, facet = false } = {}) {
	const plot = new Plot({ type: 'fft', name: 'fft', width: 500, height: 300, facet, plot: {} });
	const t = mkCol('t', HOURS);
	for (let i = 0; i < series; i++) {
		plot.plot.addData({ x: { refId: t }, y: { refId: mkCol(`y${i}`, WAVE) } });
	}
	plot.plot.showPeriod = true;
	plot.plot.xlimsIN = [...xlimsIN];
	core.plots.push(plot);
	return plot;
}

const close = (a, b) => expect(a).toBeCloseTo(b, 10);
function expectLims(inner, [a, b]) {
	expect(inner.xlimsIN).toHaveLength(2);
	if (a == null) expect(inner.xlimsIN[0]).toBeNull();
	else close(inner.xlimsIN[0], a);
	if (b == null) expect(inner.xlimsIN[1]).toBeNull();
	else close(inner.xlimsIN[1], b);
}
/** Plots are rebuilt by undo (setPlotInner), so always read the live one. */
const live = (plot) => core.plots.find((p) => p.id === plot.id);

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
	history.init();
});
beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.seriesAppearance = {};
	appState.gridSize = 15;
	appState.view = 'plots';
	appState.currentControlTab = 'properties';
	history.clear();
	clearProcessNodeGraphCache();
});
afterEach(() => cleanup());

describe('the multi-select "Show Period" field (the reported route)', () => {
	it('converts every selected plot, draws a valid range, and undoes in one step', async () => {
		const a = makeFft([4, 30]);
		const b = makeFft([5, 40]);
		a.selected = true;
		b.selected = true;
		render(ControlDisplay);
		await tick();

		const box = screen.getByLabelText('Show Period');
		expect(box.checked).toBe(true);
		await fireEvent.click(box);
		flushSync();

		expect(live(a).plot.showPeriod).toBe(false);
		expect(live(b).plot.showPeriod).toBe(false);
		expectLims(live(a).plot, [1 / 30, 1 / 4]);
		expectLims(live(b).plot, [1 / 40, 1 / 5]);
		// The drawn range is ascending, i.e. the plot is not empty.
		for (const p of [a, b]) {
			const [lo, hi] = live(p).plot.xlims;
			expect(lo).toBeLessThan(hi);
		}

		history.undo();
		expect(live(a).plot.showPeriod).toBe(true);
		expect(live(b).plot.showPeriod).toBe(true);
		expectLims(live(a).plot, [4, 30]);
		expectLims(live(b).plot, [5, 40]);

		history.redo();
		expect(live(a).plot.showPeriod).toBe(false);
		expectLims(live(a).plot, [1 / 30, 1 / 4]);
		expectLims(live(b).plot, [1 / 40, 1 / 5]);
	});

	it('a mixed selection only converts the plots that actually switch', async () => {
		const a = makeFft([4, 30]);
		const b = makeFft([4, 30]);
		b.plot.showPeriod = false;
		b.plot.xlimsIN = [0.05, 0.5];
		a.selected = true;
		b.selected = true;
		render(ControlDisplay);
		await tick();

		// "Set all to: off" pill for the mixed field.
		const off = screen.getAllByRole('button', { name: 'off' })[0];
		await fireEvent.click(off);
		flushSync();
		expect(live(a).plot.showPeriod).toBe(false);
		expectLims(live(a).plot, [1 / 30, 1 / 4]);
		expect(live(b).plot.showPeriod).toBe(false);
		expectLims(live(b).plot, [0.05, 0.5]);
	});
});

describe('the Properties checkbox', () => {
	it('converts once (not twice) and is one undo step', async () => {
		const a = makeFft([4, 30]);
		render(FFT, { props: { theData: a.plot, which: 'controls' } });
		await tick();
		const box = screen.getByLabelText('Show as period (h)');
		await fireEvent.click(box);
		flushSync();
		expect(live(a).plot.showPeriod).toBe(false);
		expectLims(live(a).plot, [1 / 30, 1 / 4]);

		history.undo();
		expect(live(a).plot.showPeriod).toBe(true);
		expectLims(live(a).plot, [4, 30]);
	});
});

describe('an AI edit', () => {
	const edit = (changes) => applyEdit({ analyses: [], plots: [], changes, bands: [], errors: [] });

	it('switching the mode alone converts the limits; undo restores both', () => {
		const a = makeFft([4, 30]);
		edit([{ plotId: a.id, path: 'plot.showPeriod', value: false }]);
		expect(live(a).plot.showPeriod).toBe(false);
		expectLims(live(a).plot, [1 / 30, 1 / 4]);
		history.undo();
		expect(live(a).plot.showPeriod).toBe(true);
		expectLims(live(a).plot, [4, 30]);
	});

	it('limits given WITH the switch are in the new mode, whatever order they come in', () => {
		const a = makeFft([4, 30]);
		const b = makeFft([4, 30]);
		edit([
			{ plotId: a.id, path: 'plot.showPeriod', value: false },
			{ plotId: a.id, path: 'plot.xlimsIN[0]', value: 0 },
			{ plotId: a.id, path: 'plot.xlimsIN[1]', value: 0.1 },
			{ plotId: b.id, path: 'plot.xlimsIN[0]', value: 0 },
			{ plotId: b.id, path: 'plot.xlimsIN[1]', value: 0.1 },
			{ plotId: b.id, path: 'plot.showPeriod', value: false }
		]);
		for (const p of [a, b]) {
			expect(live(p).plot.showPeriod).toBe(false);
			expectLims(live(p).plot, [0, 0.1]);
		}
	});
});

describe('state application is not a switch', () => {
	it('loading a saved frequency-mode plot keeps its limits, whatever the key order', () => {
		const entry = appConsts.plotMap.get('fft');
		const host = makeFft();
		for (const json of [
			{ showPeriod: false, xlimsIN: [0.05, 0.5] },
			{ xlimsIN: [0.05, 0.5], showPeriod: false }
		]) {
			const inner = entry.data.fromJSON(host, json);
			expect(inner.showPeriod).toBe(false);
			expectLims(inner, [0.05, 0.5]);
		}
	});

	it('a facet panel mirrors the switched generator without converting again', async () => {
		const gen = makeFft([4, 30], { series: 2, facet: true });
		const [p0, p1] = panelsFor(gen);
		projectPanel(p0);
		projectPanel(p1);
		// A legacy per-panel x override (what the facet migration writes from child plots).
		gen.facetOverrides = { [p1.unitKey]: { 'xlimsIN[0]': 10 } };
		projectPanel(p1);
		expectLims(p1.plot, [10, 30]);

		gen.selected = true;
		makeFft([4, 30]).selected = true;
		render(ControlDisplay);
		await tick();
		await fireEvent.click(screen.getByLabelText('Show Period'));
		flushSync();

		const g = live(gen);
		expectLims(g.plot, [1 / 30, 1 / 4]);
		projectPanel(p0);
		projectPanel(p1);
		expect(p0.plot.showPeriod).toBe(false);
		expectLims(p0.plot, [1 / 30, 1 / 4]);
		// The override moved with the reciprocal: a period minimum is a frequency maximum.
		expect(g.facetOverrides[p1.unitKey]).toEqual({ 'xlimsIN[1]': 1 / 10 });
		expectLims(p1.plot, [1 / 30, 1 / 10]);

		history.undo();
		const back = live(gen);
		expect(back.plot.showPeriod).toBe(true);
		expectLims(back.plot, [4, 30]);
		expect(back.facetOverrides[p1.unitKey]).toEqual({ 'xlimsIN[0]': 10 });
	});
});

describe('applyInnerEdits (the MCP render settings and every other batch of plain fields)', () => {
	it('applies the mode first, so limits given with it are in the new mode', () => {
		const a = makeFft([4, 30]);
		applyInnerEdits(a.plot, [
			{ path: 'xlimsIN', value: [0, 0.1] },
			{ path: 'showPeriod', value: false }
		]);
		expect(a.plot.showPeriod).toBe(false);
		expectLims(a.plot, [0, 0.1]);
	});

	it('the mode alone converts the default limits', () => {
		const a = makeFft([4, 30]);
		applyInnerEdits(a.plot, [{ path: 'showPeriod', value: false }]);
		expectLims(a.plot, [1 / 30, 1 / 4]);
	});

	it('a manual x tick list moves to the new units too (ascending, unplaceable ticks dropped)', () => {
		const a = makeFft([4, 30]);
		a.plot.xAxis.manualTicks = [0, 6, 12, 24];
		applyInnerEdits(a.plot, [{ path: 'showPeriod', value: false }]);
		expect(a.plot.xAxis.manualTicks).toEqual([1 / 24, 1 / 12, 1 / 6]);
		// Switching to the mode it is already in converts nothing.
		applyInnerEdits(a.plot, [{ path: 'showPeriod', value: false }]);
		expect(a.plot.xAxis.manualTicks).toEqual([1 / 24, 1 / 12, 1 / 6]);
		expectLims(a.plot, [1 / 30, 1 / 4]);
	});

	it('works on a JSON snapshot too (the AI edit path), with the class named', () => {
		const a = makeFft([4, 30]);
		const json = JSON.parse(JSON.stringify(a.plot.toJSON()));
		applyInnerEdits(json, [{ path: 'showPeriod', value: false }], a.plot.constructor);
		expect(json.showPeriod).toBe(false);
		expect(json.xlimsIN[0]).toBeCloseTo(1 / 30, 10);
		expect(json.xlimsIN[1]).toBeCloseTo(1 / 4, 10);
		// The live plot is untouched.
		expectLims(a.plot, [4, 30]);
	});
});

describe('overlays keep their stored periods across a switch', () => {
	it('a 24 h line stays 24 and is drawn at 1/24 after the multi-select switch', async () => {
		const a = makeFft([4, 30]);
		const o = a.plot.addOverlay('line', 'vertical');
		o.setTyped('at', [24]);
		const b = makeFft([4, 30]);
		a.selected = true;
		b.selected = true;
		render(ControlDisplay);
		await tick();
		await fireEvent.click(screen.getByLabelText('Show Period'));
		flushSync();
		const inner = live(a).plot;
		expect(inner.overlays[0].toJSON().channels.at.typed).toEqual([24]);
		expect(inner.overlayXTransform(24)).toBe(1 / 24);
		const [lo, hi] = inner.xlims;
		expect(1 / 24).toBeGreaterThan(lo);
		expect(1 / 24).toBeLessThan(hi);
	});
});
