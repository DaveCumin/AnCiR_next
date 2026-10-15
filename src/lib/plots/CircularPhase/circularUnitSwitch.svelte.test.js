// @ts-nocheck
/**
 * Changing a Circular phase plot's `unit` (the unit the phase column's values are recorded in)
 * by every route that can do it.
 *
 * The bin widths (`binWidth` for binned placement, `wedgeBinWidth` for the rose wedges) are
 * stored in that unit, so a switch must convert them to keep the bins the same angular size:
 * 1 h on a 24 h period is 15 degrees is 0.2618 rad. Before, the widths were left alone, so
 * 1 h bins became 1 degree bins (24 times finer) and a later switch to radians gave bins of
 * one radian. The conversion is a paired edit (plots/pairedEdits.js), like the FFT's
 * period/frequency switch, so the Properties select, the multi-select panel, an AI edit and
 * the MCP render settings all convert, and a switch is one undo step.
 *
 * State APPLICATION (fromJSON on load or undo) is not a switch: the stored widths are already
 * in the stored unit. With a timed series the angle is always clock hours and the widths are
 * hours whatever `unit` says, so nothing converts then either.
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
import { applyEdit } from '$lib/utils/aiEdit.js';
import { applyInnerEdits } from '$lib/plots/pairedEdits.js';
import { convertAngularWidth } from '$lib/utils/circularPlot.js';
import ControlDisplay from '$lib/components/views/ControlDisplay.svelte';
import CircularPhase from './CircularPhase.svelte';

const RAD_PER_HOUR_24 = (2 * Math.PI) / 24; // 0.2618

function mkCol(type, values) {
	const c = new Column({ type, data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

const t0 = Date.UTC(2026, 0, 1);

/** A real circular phase plot in core.plots, in clock hours, with the given bin widths. */
function makeCirc({ binWidth = 1, wedgeBinWidth = 2, period = 24, timed = false } = {}) {
	const plot = new Plot({ type: 'circularphase', name: 'c', width: 400, height: 400, plot: {} });
	plot.plot.addData({ y: { refId: mkCol('number', [1, 5, 9, 13]) } });
	if (timed) {
		plot.plot.addData({
			x: { refId: mkCol('time', [t0, t0 + 3.6e6, t0 + 7.2e6]) },
			y: { refId: mkCol('number', [1, 2, 3]) }
		});
	}
	plot.plot.unit = 'hours';
	plot.plot.period = period;
	plot.plot.binWidth = binWidth;
	plot.plot.wedgeBinWidth = wedgeBinWidth;
	core.plots.push(plot);
	return plot;
}

/** Plots are rebuilt by undo (setPlotInner), so always read the live one. */
const live = (plot) => core.plots.find((p) => p.id === plot.id);
const close = (a, b) => expect(a).toBeCloseTo(b, 10);
function expectWidths(inner, unit, bin, wedge) {
	expect(inner.unit).toBe(unit);
	close(inner.binWidth, bin);
	close(inner.wedgeBinWidth, wedge);
}

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

describe('convertAngularWidth', () => {
	it('keeps the angular size: 1 h of 24 h = 15 degrees = 0.2618 rad', () => {
		close(convertAngularWidth(1, 'hours', 'degrees', 24), 15);
		close(convertAngularWidth(1, 'hours', 'radians', 24), RAD_PER_HOUR_24);
		close(convertAngularWidth(15, 'degrees', 'hours', 24), 1);
		// Hours scale with the period: 1 h of a 12 h cycle is 30 degrees.
		close(convertAngularWidth(1, 'hours', 'degrees', 12), 30);
	});

	it('hours to degrees to radians and back returns the original width', () => {
		for (const w of [1, 0.5, 2, 3.7, 0.05]) {
			const deg = convertAngularWidth(w, 'hours', 'degrees', 24);
			const rad = convertAngularWidth(deg, 'degrees', 'radians', 24);
			expect(convertAngularWidth(rad, 'radians', 'hours', 24)).toBe(w);
		}
		// A whole number of degrees stays whole (no 14.999999999999998).
		expect(
			convertAngularWidth(convertAngularWidth(15, 'degrees', 'radians'), 'radians', 'degrees')
		).toBe(15);
	});

	it('leaves an unset or unknown width alone', () => {
		expect(convertAngularWidth(null, 'hours', 'degrees', 24)).toBeNull();
		expect(convertAngularWidth(2, 'hours', 'furlongs', 24)).toBe(2);
	});
});

describe('the Properties "Values are in" select', () => {
	it('converts both widths once and is one undo step', async () => {
		const a = makeCirc({ binWidth: 1, wedgeBinWidth: 2 });
		a.plot.placement = 'bin';
		a.plot.showWedges = true;
		render(CircularPhase, { props: { theData: a.plot, which: 'controls' } });
		await tick();
		const select = screen.getByLabelText('Values are in');
		expect([...select.options].map((o) => o.textContent.trim())).toEqual([
			'Clock hours',
			'Degrees',
			'Radians'
		]);
		await fireEvent.change(select, { target: { value: 'degrees' } });
		flushSync();
		expectWidths(live(a).plot, 'degrees', 15, 30);

		history.undo();
		expectWidths(live(a).plot, 'hours', 1, 2);
		history.redo();
		expectWidths(live(a).plot, 'degrees', 15, 30);
	});
});

describe('the multi-select "Values are in" field', () => {
	it('converts every selected plot and undoes in one step', async () => {
		const a = makeCirc({ binWidth: 1, wedgeBinWidth: 2 });
		const b = makeCirc({ binWidth: 3, wedgeBinWidth: 1, period: 12 });
		a.selected = true;
		b.selected = true;
		render(ControlDisplay);
		await tick();

		const select = screen.getByLabelText('Values are in');
		await fireEvent.change(select, { target: { value: 'radians' } });
		flushSync();
		expectWidths(live(a).plot, 'radians', RAD_PER_HOUR_24, 2 * RAD_PER_HOUR_24);
		// b's hours are on a 12 h cycle.
		expectWidths(live(b).plot, 'radians', (3 * 2 * Math.PI) / 12, (2 * Math.PI) / 12);

		history.undo();
		expectWidths(live(a).plot, 'hours', 1, 2);
		expectWidths(live(b).plot, 'hours', 3, 1);
	});
});

describe('an AI edit', () => {
	const edit = (changes) => applyEdit({ analyses: [], plots: [], changes, bands: [], errors: [] });

	it('switching the unit alone converts the widths; undo restores all three', () => {
		const a = makeCirc({ binWidth: 1, wedgeBinWidth: 2 });
		edit([{ plotId: a.id, path: 'plot.unit', value: 'degrees' }]);
		expectWidths(live(a).plot, 'degrees', 15, 30);
		history.undo();
		expectWidths(live(a).plot, 'hours', 1, 2);
	});

	it('widths given WITH the switch are in the new unit, whatever order they come in', () => {
		const a = makeCirc();
		edit([
			{ plotId: a.id, path: 'plot.binWidth', value: 10 },
			{ plotId: a.id, path: 'plot.unit', value: 'degrees' }
		]);
		expect(live(a).plot.binWidth).toBe(10);
		close(live(a).plot.wedgeBinWidth, 30);
	});
});

describe('applyInnerEdits (the MCP render settings)', () => {
	it('converts on the live plot', () => {
		const a = makeCirc({ binWidth: 1, wedgeBinWidth: 2 });
		applyInnerEdits(a.plot, [{ path: 'unit', value: 'radians' }]);
		expectWidths(a.plot, 'radians', RAD_PER_HOUR_24, 2 * RAD_PER_HOUR_24);
		// Switching to the unit it is already in converts nothing.
		applyInnerEdits(a.plot, [{ path: 'unit', value: 'radians' }]);
		expectWidths(a.plot, 'radians', RAD_PER_HOUR_24, 2 * RAD_PER_HOUR_24);
	});

	it('hours to degrees to radians and back returns the original widths', () => {
		const a = makeCirc({ binWidth: 1.5, wedgeBinWidth: 2 });
		for (const u of ['degrees', 'radians', 'hours'])
			applyInnerEdits(a.plot, [{ path: 'unit', value: u }]);
		expect(a.plot.binWidth).toBe(1.5);
		expect(a.plot.wedgeBinWidth).toBe(2);
	});
});

describe('no conversion where the widths do not change meaning', () => {
	it('loading a saved degree-unit plot keeps its widths, whatever the key order', () => {
		const entry = appConsts.plotMap.get('circularphase');
		const host = makeCirc();
		for (const json of [
			{ unit: 'degrees', binWidth: 15, wedgeBinWidth: 30 },
			{ binWidth: 15, wedgeBinWidth: 30, unit: 'degrees' }
		]) {
			const inner = entry.data.fromJSON(host, json);
			expectWidths(inner, 'degrees', 15, 30);
		}
	});

	it('with a timed series the widths are clock hours, so a unit change converts nothing', () => {
		const a = makeCirc({ binWidth: 1, wedgeBinWidth: 2, timed: true });
		expect(a.plot.hasTimed).toBe(true);
		applyInnerEdits(a.plot, [{ path: 'unit', value: 'degrees' }]);
		expectWidths(a.plot, 'degrees', 1, 2);
		expect(a.plot.displayPeriod).toBe(24);
	});
});
