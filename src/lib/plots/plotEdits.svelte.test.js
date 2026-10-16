// @ts-nocheck
/**
 * Plot edits as undo steps (plots/plotEdits.js, plotEditScope.js, plotZoom.js and the
 * multi-select panel).
 *
 * REPORTED (vault TODO "Follow-ups from v82.11 to v82.12", "Not yet undoable"; reproduced
 * 2026-10-17 in headless Chromium on demo-scatter-rhythm and demo-workflow-stats-eda): typing
 * a Y min, a shift+wheel zoom and a multi-select width edit each changed the plot, and Cmd+Z
 * did nothing (the undo count stayed 0). The overlay, phase-marker and annotation name editors
 * were on the rename guard's offender list for the same reason.
 *
 * plotControlUndo.registry.svelte.test.js drives every control of every plot type; this file
 * pins the pieces: the operation and its merging, the recorder's two paths, zoom (brush,
 * wheel, reset, facet link-zoom), the multi-select panel, the name editors and the panel
 * recorder's gesture rules.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { applyOp } from '$lib/core/operations.js';
import { history } from '$lib/core/opHistory.svelte.js';
import { clearProcessNodeGraphCache } from '$lib/core/ProcessNode.svelte.js';
import { panelsFor } from '$lib/core/facetPanels.svelte.js';
import {
	initUnsavedChanges,
	markSessionSaved,
	hasUnsavedChanges
} from '$lib/core/unsavedChanges.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import ControlDisplay from '$lib/components/views/ControlDisplay.svelte';
import {
	plotEditState,
	recordPlotGesture,
	commitPlotsEdit,
	locateInPlots,
	commitObjectEdit
} from './plotEdits.js';
import { plotEditScope } from './plotEditScope.js';
import { applyLinkedZoom, writeAxisLimit } from './plotZoom.js';
import { getZoomAdapter } from './zoomAdapters.js';
import { createPlotZoom } from './plotZoomController.js';
import { markPopup } from '$lib/components/reusables/editScopePopup.js';

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
	history.init();
	initUnsavedChanges();
});
beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.tableProcesses = [];
	core.seriesAppearance = {};
	appState.view = 'plots';
	appState.gridSize = 15;
	appState.currentControlTab = 'properties';
	history.clear();
	clearProcessNodeGraphCache();
});
afterEach(() => cleanup());

const N = 48;
function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}
const wave = (k = 0) =>
	Array.from({ length: N }, (_, i) => 50 + 30 * Math.cos((2 * Math.PI * (i + k)) / 24));

/** A plot of `type` in the session with `series` wired series. */
function sessionPlot(type, { series = 1, facet = false } = {}) {
	const t = mkCol(
		't',
		Array.from({ length: N }, (_, i) => i)
	);
	const data = Array.from({ length: series }, (_, k) => ({
		x: { refId: t },
		y: { refId: mkCol(`v${k}`, wave(k)) }
	}));
	const plot = new Plot({ type, name: type, width: 500, height: 300, facet, plot: { data } });
	core.plots.push(plot);
	return core.plots[core.plots.length - 1];
}
const live = (plot) => core.plots.find((p) => p.id === plot.id);
const json = (plot) => JSON.stringify(live(plot));

async function settle() {
	await Promise.resolve();
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
	await tick();
}
function fresh() {
	history.clear();
	markSessionSaved();
}

describe('the setPlotFields operation', () => {
	it('writes in order, and its inverse writes the old values in the SAME order', () => {
		// Periodogram's `binSize` setter turns `binSizeAuto` off: the inverse must write binSize
		// first and the partner's old value after it, or undo leaves "auto" off.
		const plot = sessionPlot('periodogram');
		const s = plot.plot.data[0];
		s.binSizeAuto = true;
		const before = plotEditState(plot);
		fresh();
		s.binSize = 2;
		expect(s.binSizeAuto).toBe(false);
		recordPlotGesture(plot, before);
		expect(history.undoCount).toBe(1);
		expect(history.undoStack[0].forward.kind).toBe('setPlotFields');
		expect(history.undoStack[0].reverse.edits.map((e) => e.path)).toEqual(
			history.undoStack[0].forward.edits.map((e) => e.path)
		);
		history.undo();
		expect(live(plot).plot.data[0].binSizeAuto).toBe(true);
		expect(live(plot).plot.data[0].binSize).toBe(0.25);
		history.redo();
		expect(live(plot).plot.data[0].binSize).toBe(2);
		expect(live(plot).plot.data[0].binSizeAuto).toBe(false);
	});

	it('a batch whose children all change nothing is not an undo step', () => {
		const plot = sessionPlot('scatterplot');
		fresh();
		const inv = applyOp({
			kind: 'batch',
			ops: [{ kind: 'setPlotInnerField', id: plot.id, path: 'xlimsIN', value: [null, null] }]
		});
		expect(inv).toBeNull();
		expect(history.undoCount).toBe(0);
	});

	it('a quick run with one coalesceKey is one step, and undo restores every path it wrote', async () => {
		const plot = sessionPlot('scatterplot');
		fresh();
		const pad0 = { ...plot.plot.figurePadding };
		applyOp({
			kind: 'setPlotFields',
			id: plot.id,
			edits: [{ path: 'plot.figurePadding.top', value: 40 }],
			coalesceKey: 'k'
		});
		applyOp({
			kind: 'setPlotFields',
			id: plot.id,
			edits: [{ path: 'plot.figurePadding.left', value: 70 }],
			coalesceKey: 'k'
		});
		applyOp({
			kind: 'setPlotFields',
			id: plot.id,
			edits: [{ path: 'plot.figurePadding.top', value: 41 }],
			coalesceKey: 'k'
		});
		expect(history.undoCount).toBe(1);
		history.undo();
		expect({ ...live(plot).plot.figurePadding }).toEqual(pad0);
		history.redo();
		expect(live(plot).plot.figurePadding.top).toBe(41);
		expect(live(plot).plot.figurePadding.left).toBe(70);
		// A different key is a new step.
		await Promise.resolve();
		applyOp({
			kind: 'setPlotFields',
			id: plot.id,
			edits: [{ path: 'plot.figurePadding.top', value: 5 }],
			coalesceKey: 'other'
		});
		expect(history.undoCount).toBe(2);
	});
});

describe('recordPlotGesture', () => {
	it('an automatic series colour comes back automatic (what is SAVED, not what reads back)', () => {
		const plot = sessionPlot('scatterplot');
		const line = plot.plot.data[0].line;
		const savedBefore = JSON.stringify(live(plot));
		expect(line.toJSON().colour ?? null).toBeNull();
		const before = plotEditState(plot);
		fresh();
		line.colour = '#123456';
		recordPlotGesture(plot, before);
		expect(history.undoCount).toBe(1);
		expect(hasUnsavedChanges()).toBe(true);
		history.undo();
		expect(json(plot)).toBe(savedBefore);
	});

	it('a change that is not a field edit (a series added) is recorded as the whole inner', () => {
		const plot = sessionPlot('scatterplot');
		const savedBefore = json(plot);
		const before = plotEditState(plot);
		fresh();
		plot.plot.addData({
			x: { refId: plot.plot.data[0].x.refId },
			y: { refId: mkCol('w', wave(3)) }
		});
		recordPlotGesture(plot, before);
		expect(history.undoCount).toBe(1);
		expect(history.undoStack[0].forward.kind).toBe('setPlotInner');
		history.undo();
		expect(json(plot)).toBe(savedBefore);
		history.redo();
		expect(live(plot).plot.data).toHaveLength(2);
	});

	it('the size and the figure style ride in the same step as the inner', () => {
		const plot = sessionPlot('scatterplot');
		const savedBefore = json(plot);
		const before = plotEditState(plot);
		fresh();
		plot.width = 640;
		plot.plot.figurePadding.top = 33;
		recordPlotGesture(plot, before);
		expect(history.undoCount).toBe(1);
		history.undo();
		expect(json(plot)).toBe(savedBefore);
	});

	it('a plot that is not in the session is not recorded', () => {
		const plot = new Plot({ type: 'scatterplot', name: 's', plot: {} });
		const before = plotEditState(plot);
		plot.plot.figurePadding.top = 99;
		expect(recordPlotGesture(plot, before)).toBeNull();
		expect(plot.plot.figurePadding.top).toBe(99);
		expect(history.undoCount).toBe(0);
	});

	it('commitPlotsEdit is one step over several plots', () => {
		const a = sessionPlot('scatterplot');
		const b = sessionPlot('periodogram');
		const before = [json(a), json(b)];
		fresh();
		commitPlotsEdit([a, b], () => {
			a.plot.xLogScale = true;
			b.plot.logScale = true;
		});
		expect(history.undoCount).toBe(1);
		history.undo();
		expect([json(a), json(b)]).toEqual(before);
	});
});

describe('zoom is undoable', () => {
	it('a brush on a plot is one step and undoes exactly', () => {
		const plot = sessionPlot('scatterplot');
		const before = json(plot);
		fresh();
		applyLinkedZoom(plot, { xlims: [2, 6], ylimsLeft: [10, 40], ylimsRight: null });
		expect(live(plot).plot.xlimsIN).toEqual([2, 6]);
		expect(history.undoCount).toBe(1);
		expect(hasUnsavedChanges()).toBe(true);
		history.undo();
		expect(json(plot)).toBe(before);
	});

	it('a wheel gesture (many ticks) is one step; the next gesture is its own', () => {
		const plot = sessionPlot('scatterplot');
		const before = json(plot);
		fresh();
		for (let i = 0; i < 6; i++)
			applyLinkedZoom(plot, { xlims: [i, 20 - i], ylimsLeft: [i, 90 - i] }, { coalesce: true });
		expect(history.undoCount).toBe(1);
		applyLinkedZoom(plot, {
			xlims: [null, null],
			ylimsLeft: [null, null],
			ylimsRight: [null, null]
		});
		expect(history.undoCount).toBe(2);
		history.undo();
		expect(live(plot).plot.xlimsIN).toEqual([5, 15]);
		history.undo();
		expect(json(plot)).toBe(before);
		history.redo();
		expect(live(plot).plot.xlimsIN).toEqual([5, 15]);
	});

	it('facet link-zoom: the generator x and the panel y override are ONE step', async () => {
		const gen = sessionPlot('scatterplot', { series: 2, facet: true });
		const panels = panelsFor(gen);
		expect(panels.length).toBe(2);
		// A leaf-form override (what the facet migration writes) is superseded and must come back.
		gen.facetOverrides = { [panels[0].unitKey]: { 'ylimsLeftIN[0]': 3 } };
		const before = json(gen);
		fresh();
		applyLinkedZoom(panels[0], { xlims: [2, 6], ylimsLeft: [10, 40] });
		expect(history.undoCount).toBe(1);
		expect(live(gen).plot.xlimsIN).toEqual([2, 6]);
		expect(live(gen).facetOverrides).toEqual({ [panels[0].unitKey]: { ylimsLeftIN: [10, 40] } });
		history.undo();
		expect(json(gen)).toBe(before);
		await settle(); // the history records again once the undo has settled
		// A wheel on a panel coalesces too.
		fresh();
		for (let i = 0; i < 4; i++)
			applyLinkedZoom(panels[1], { xlims: [i, 9], ylimsLeft: [i, 50] }, { coalesce: true });
		expect(history.undoCount).toBe(1);
		history.undo();
		expect(json(gen)).toBe(before);
	});

	it.each(['periodogram', 'correlogram', 'fft'])(
		'%s: brush, wheel and reset through the adapter are one step each',
		async (type) => {
			const plot = sessionPlot(type);
			flushSync();
			const before = json(plot);
			const svg = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) };
			const ctl = createPlotZoom(() => ({
				plot: live(plot),
				brushable: true,
				zoomMode: true,
				svgEl: svg,
				adapter: getZoomAdapter(live(plot))
			}));
			fresh();
			ctl.applyBrushZoom({ x0: 10, x1: 60, y0: 10, y1: 60 });
			expect(history.undoCount).toBe(1);
			const p = live(plot).plot;
			const wheel = () => ({
				clientX: p.padding.left + 20,
				clientY: p.padding.top + 20,
				deltaY: -100,
				shiftKey: true,
				preventDefault() {},
				stopPropagation() {}
			});
			await Promise.resolve();
			for (let i = 0; i < 5; i++) ctl.handleWheelZoom(wheel());
			expect(history.undoCount).toBe(2);
			ctl.resetZoom();
			expect(history.undoCount).toBe(3);
			history.undo();
			history.undo();
			history.undo();
			expect(json(plot)).toBe(before);
		}
	);

	it('a ref outside the session (the MCP renderer, a stand-in) is written in place, unrecorded', () => {
		const p = { id: 'x', plot: { ylimsIN: [null, null] } };
		writeAxisLimit(p, 'ylimsIN', [1, 2]);
		expect(p.plot.ylimsIN).toEqual([1, 2]);
		expect(history.undoCount).toBe(0);
	});
});

describe('the multi-select panel: one step over the whole selection', () => {
	async function selectTwo() {
		const a = sessionPlot('scatterplot');
		const b = sessionPlot('scatterplot');
		a.selected = true;
		b.selected = true;
		const r = render(ControlDisplay);
		await settle();
		const before = [json(a), json(b)];
		fresh();
		return { a, b, before, container: r.container };
	}
	const fieldInput = (container, label) => {
		const lab = [...container.querySelectorAll('label')].find((l) =>
			l.querySelector('.ci-label')?.textContent.trim().startsWith(label)
		);
		return lab?.querySelector('input, select');
	};
	async function type(el, text) {
		await fireEvent.focus(el);
		for (let i = 1; i <= text.length; i++)
			await fireEvent.input(el, { target: { value: text.slice(0, i) } });
	}

	it('a typed number previews on every plot, records ONE step on commit, and undoes both', async () => {
		const { a, b, before, container } = await selectTwo();
		const width = fieldInput(container, 'Width');
		await type(width, '432');
		expect([live(a).width, live(b).width]).toEqual([432, 432]);
		expect(history.undoCount).toBe(0);
		await fireEvent.change(width);
		await settle();
		expect(history.undoCount).toBe(1);
		expect(hasUnsavedChanges()).toBe(true);
		expect([live(a).width, live(b).width]).toEqual([432, 432]);
		history.undo();
		expect([json(a), json(b)]).toEqual(before);
	});

	it('Escape puts the preview back and records nothing', async () => {
		const { a, b, before, container } = await selectTwo();
		const xmin = fieldInput(container, 'X min');
		await type(xmin, '7');
		expect(live(a).plot.xlimsIN[0]).toBe(7);
		await fireEvent.keyDown(xmin, { key: 'Escape' });
		await settle();
		expect([json(a), json(b)]).toEqual(before);
		expect(history.undoCount).toBe(0);
	});

	it('a run of spinner clicks on one number is one step', async () => {
		const { a, b, before, container } = await selectTwo();
		const width = fieldInput(container, 'Width');
		await fireEvent.focus(width);
		for (const v of ['501', '502', '503']) {
			await fireEvent.input(width, { target: { value: v } });
			await fireEvent.change(width);
		}
		await settle();
		expect(history.undoCount).toBe(1);
		expect(live(b).width).toBe(503);
		history.undo();
		expect([json(a), json(b)]).toEqual(before);
	});

	it('a checkbox, a text box and a series colour are one step each', async () => {
		const { a, b, before, container } = await selectTwo();
		await fireEvent.click(fieldInput(container, 'X log scale'));
		await settle();
		expect(history.undoCount).toBe(1);
		expect([live(a).plot.xLogScale, live(b).plot.xLogScale]).toEqual([true, true]);

		const colour = [...container.querySelectorAll('input[type=color]')][0];
		colour.value = '#123456';
		await fireEvent.change(colour);
		await settle();
		expect(history.undoCount).toBe(2);
		expect(live(a).plot.data[0].line.colour).toBe('#123456');
		expect(live(b).plot.data[0].line.colour).toBe('#123456');

		const fmt = fieldInput(container, 'Date tick format');
		await type(fmt, 'HH:mm');
		await fireEvent.change(fmt);
		await settle();
		expect(history.undoCount).toBe(3);
		expect(live(b).plot.xTickFormat).toBe('HH:mm');

		history.undo();
		history.undo();
		history.undo();
		expect([json(a), json(b)]).toEqual(before);
	});
});

describe('names inside a plot commit through one operation', () => {
	it('an overlay, an annotation and a phase marker are found by identity and renamed as one step', async () => {
		const scatter = sessionPlot('scatterplot');
		scatter.plot.addOverlay('line', 'vertical');
		const overlay = scatter.plot.overlays[0];
		expect(locateInPlots(overlay)).toEqual({ plot: scatter, path: 'plot.overlays[0]' });

		const acto = sessionPlot('actogram');
		acto.plot.addAnnotation();
		const annotation = acto.plot.annotations[0];
		expect(locateInPlots(annotation)).toEqual({ plot: acto, path: 'plot.annotations[0]' });
		acto.plot.data[0].addMarker();
		const marker = acto.plot.data[0].phaseMarkers[0];
		expect(locateInPlots(marker)).toEqual({ plot: acto, path: 'plot.data[0].phaseMarkers[0]' });

		for (const [obj, plot] of [
			[overlay, scatter],
			[annotation, acto],
			[marker, acto]
		]) {
			const before = json(plot);
			fresh();
			commitObjectEdit(obj, 'name', 'Renamed');
			expect(obj.name).toBe('Renamed');
			expect(history.undoCount).toBe(1);
			expect(hasUnsavedChanges()).toBe(true);
			history.undo();
			expect(json(plot)).toBe(before);
			await settle();
		}
	});

	it('the overlay name editor: Enter commits one step, Escape changes nothing', async () => {
		const plot = sessionPlot('scatterplot');
		plot.plot.addOverlay('line', 'vertical');
		plot.selected = true;
		appState.currentControlTab = 'overlays';
		const { container } = render(ControlDisplay);
		await settle();
		const before = json(plot);
		const name0 = plot.plot.overlays[0].name;
		fresh();
		const edit = async (text, key) => {
			await fireEvent.dblClick(container.querySelector('.overlay-title .inline-edit-span'));
			await settle();
			const input = container.querySelector('.overlay-title input');
			await fireEvent.input(input, { target: { value: text } });
			await fireEvent.keyDown(input, { key });
			await settle();
		};
		await edit('Typo', 'Escape');
		expect(live(plot).plot.overlays[0].name).toBe(name0);
		expect(history.undoCount).toBe(0);
		await edit('Dawn', 'Enter');
		expect(live(plot).plot.overlays[0].name).toBe('Dawn');
		expect(history.undoCount).toBe(1);
		history.undo();
		expect(json(plot)).toBe(before);
	});
});

describe('the panel recorder (plotEditScope)', () => {
	function scoped(plot) {
		const root = document.createElement('div');
		document.body.append(root);
		const detach = plotEditScope(() => plot)(root);
		return { root, detach };
	}
	const fire = (el, type, init = {}) =>
		el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }));

	it('text typed and then committed by pressing a button is two steps, each exact', async () => {
		const plot = sessionPlot('scatterplot');
		const { root, detach } = scoped(plot);
		const box = document.createElement('input');
		const button = document.createElement('button');
		root.append(box, button);
		button.addEventListener('click', () => (plot.plot.xLogScale = true));
		const s0 = json(plot);
		fresh();
		fire(box, 'pointerdown');
		fire(box, 'focusin');
		fire(box, 'pointerup');
		fire(box, 'click');
		await settle();
		for (const v of ['1', '12']) {
			fire(box, 'keydown');
			plot.plot.figurePadding.top = Number(v); // the control's preview write
			fire(box, 'input');
		}
		// Press the button: its pointerdown comes first, then the box's blur commits it.
		fire(button, 'pointerdown');
		fire(box, 'change');
		await settle();
		const s1 = json(plot);
		fire(button, 'pointerup');
		button.click();
		await settle();
		expect(history.undoCount).toBe(2);
		history.undo();
		expect(json(plot)).toBe(s1);
		history.undo();
		expect(json(plot)).toBe(s0);
		detach();
	});

	// Found in Chromium: a click that focuses a box finishes a gesture with no change, and the
	// value then typed or pasted (no keydown) was measured from a baseline taken after it.
	it.each([
		['beforeinput', true],
		['the focus staying in the box', false]
	])(
		'a value typed after the focusing click is one step (start from %s)',
		async (_, sendBeforeInput) => {
			const plot = sessionPlot('scatterplot');
			const { root, detach } = scoped(plot);
			const box = document.createElement('input');
			root.append(box);
			const s0 = json(plot);
			fresh();
			fire(box, 'pointerdown');
			box.focus();
			fire(box, 'focusin');
			fire(box, 'pointerup');
			fire(box, 'click');
			await settle();
			if (sendBeforeInput) fire(box, 'beforeinput');
			plot.plot.figurePadding.top = 61; // the control's preview write (a paste: no keydown)
			fire(box, 'input');
			fire(box, 'change');
			await settle();
			expect(history.undoCount).toBe(1);
			history.undo();
			expect(json(plot)).toBe(s0);
			box.blur();
			detach();
		}
	);

	it('a control that records its own operation is not recorded twice', async () => {
		const plot = sessionPlot('scatterplot');
		const { root, detach } = scoped(plot);
		const box = document.createElement('input');
		root.append(box);
		box.addEventListener('change', () =>
			applyOp({ kind: 'setPlotInnerField', id: plot.id, path: 'xLogScale', value: true })
		);
		fresh();
		fire(box, 'pointerdown');
		fire(box, 'change');
		fire(box, 'pointerup');
		await settle();
		expect(history.undoCount).toBe(1);
		detach();
	});

	it("a floating part of a control (the colour picker's window) is part of the panel", async () => {
		const plot = sessionPlot('scatterplot');
		const { root, detach } = scoped(plot);
		const swatch = document.createElement('div');
		root.append(swatch);
		const popup = document.createElement('div');
		const canvas = document.createElement('canvas');
		popup.append(canvas);
		document.body.append(popup);
		markPopup(popup, swatch);
		const s0 = json(plot);
		fresh();
		fire(canvas, 'pointerdown');
		for (const c of ['#111111', '#222222', '#333333']) plot.plot.data[0].line.colour = c; // a drag
		fire(canvas, 'pointerup');
		await settle();
		expect(history.undoCount).toBe(1);
		history.undo();
		expect(json(plot)).toBe(s0);
		// A floating part opened from somewhere else is not.
		const other = document.createElement('div');
		document.body.append(other);
		markPopup(other, document.createElement('div'));
		fresh();
		fire(other, 'pointerdown');
		plot.plot.data[0].line.colour = '#444444';
		fire(other, 'pointerup');
		await settle();
		expect(history.undoCount).toBe(0);
		detach();
	});

	it('a gesture outside the panel is not recorded by it', async () => {
		const plot = sessionPlot('scatterplot');
		const { detach } = scoped(plot);
		fresh();
		fire(document.body, 'pointerdown');
		plot.plot.figurePadding.top = 77;
		fire(document.body, 'pointerup');
		fire(document.body, 'click');
		await settle();
		expect(history.undoCount).toBe(0);
		detach();
	});

	it('Escape in a box puts the typed preview back and records nothing', async () => {
		const plot = sessionPlot('scatterplot');
		const { root, detach } = scoped(plot);
		const box = document.createElement('input');
		root.append(box);
		const s0 = json(plot);
		fresh();
		fire(box, 'focusin');
		fire(box, 'keydown');
		plot.plot.figurePadding.left = 5;
		fire(box, 'input');
		box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		fire(box, 'change');
		await settle();
		expect(json(plot)).toBe(s0);
		expect(history.undoCount).toBe(0);
		detach();
	});

	it('typing straight after the click into the box: Escape still goes back to before the typing', async () => {
		// The click's step is taken a tick after it ends. Keys that come sooner used to leave
		// that timer to fire mid-typing: it recorded the half-typed value as a step and
		// re-baselined on it, so Escape "cancelled" back to the half-typed value.
		const plot = sessionPlot('scatterplot');
		const { root, detach } = scoped(plot);
		const box = document.createElement('input');
		root.append(box);
		const s0 = json(plot);
		fresh();
		fire(box, 'pointerdown');
		fire(box, 'focusin');
		fire(box, 'pointerup');
		fire(box, 'click');
		// No settle: the keys arrive before the click's timer.
		for (const v of ['1', '12']) {
			fire(box, 'keydown');
			plot.plot.figurePadding.left = Number(v);
			fire(box, 'input');
			if (v === '1') await new Promise((r) => setTimeout(r, 0)); // the timer fires here
		}
		box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await settle();
		expect(json(plot)).toBe(s0);
		expect(history.undoCount).toBe(0);
		detach();
	});
});

describe('the Properties limit inputs (reported: typing a Y min was not undoable)', () => {
	it('Scatterplot Y min: typed, committed once, Escape cancels, and 0 shows as 0', async () => {
		const plot = sessionPlot('scatterplot');
		plot.selected = true;
		const { container } = render(ControlDisplay);
		await settle();
		const before = json(plot);
		const min = [...container.querySelectorAll('label')]
			.find((l) => l.querySelector('.ci-label')?.textContent.trim() === 'Min')
			.querySelector('input');
		fresh();
		await fireEvent.pointerDown(min);
		await fireEvent.focusIn(min);
		await fireEvent.input(min, { target: { value: '0' } });
		await settle();
		expect(live(plot).plot.ylimsLeftIN[0]).toBe(0);
		expect(min.value).toBe('0'); // used to show the automatic limit for a typed 0
		expect(history.undoCount).toBe(0);
		await fireEvent.change(min);
		await settle();
		expect(history.undoCount).toBe(1);
		history.undo();
		await settle();
		expect(json(plot)).toBe(before);
	});
});
