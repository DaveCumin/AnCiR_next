// @ts-nocheck
/**
 * Axis control edits are undo steps and unsaved changes.
 *
 * REPORTED (vault TODO "Axis edits are not undoable"; reproduced 2026-10-16, headless Chromium,
 * demo-scatter-rhythm and demo-periodogram-rhythm): typing a y label, toggling gridlines and
 * setting manual ticks in the shared Axis controls wrote straight onto the axis (bind:value).
 * Cmd+Z did nothing and the session did not count as edited.
 *
 * Every axis control now commits through plots/axisEdits.commitAxisEdit: one setPlotInnerField
 * operation, a label on Enter or blur (not per keystroke), and undo gives back exactly what was
 * stored, so a Periodogram's empty label (which shows the method's default) comes back empty.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import {
	initUnsavedChanges,
	markSessionSaved,
	hasUnsavedChanges
} from '$lib/core/unsavedChanges.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { AxisClass } from '$lib/components/plotbits/Axis.svelte';
import Axis from '$lib/components/plotbits/Axis.svelte';
import AxisLabelInput from '$lib/components/plotbits/AxisLabelInput.svelte';
import { commitAxisEdit, locateAxis } from './axisEdits.js';

const PLOT_TYPES = [...(await loadPlots()).keys()];

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
	history.clear();
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

/** A plot of `type` with one wired series, in the session and saved. */
function sessionPlot(type) {
	const t = mkCol(
		't',
		Array.from({ length: N }, (_, i) => i)
	);
	const v = mkCol(
		'v',
		Array.from({ length: N }, (_, i) => 50 + 30 * Math.cos((2 * Math.PI * i) / 24))
	);
	const entry = appConsts.plotMap.get(type);
	const inputs = entry.defaultInputs ?? [];
	const inner =
		type === 'tableplot'
			? { columnRefs: [t, v] }
			: inputs.length === 1 && inputs[0] === 'column'
				? { data: [{ column: { refId: v } }] }
				: { data: [{ x: { refId: t }, y: { refId: v } }] };
	const plot = new Plot({ type, name: type, plot: inner });
	core.plots.push(plot);
	markSessionSaved();
	return core.plots[core.plots.length - 1];
}

/** The axes a plot's inner holds, by field name. */
function axesOf(inner) {
	const out = {};
	const names = new Set(Object.keys(inner));
	for (
		let p = Object.getPrototypeOf(inner);
		p && p !== Object.prototype;
		p = Object.getPrototypeOf(p)
	)
		for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(p)))
			if (d.get) names.add(k);
	for (const k of names) {
		let v;
		try {
			v = inner[k];
		} catch {
			continue;
		}
		if (v instanceof AxisClass) out[k] = v;
	}
	return out;
}

describe('every axis of every plot type: each setting is one undo step', () => {
	it('the registry has plot types with axes', () => {
		const withAxes = PLOT_TYPES.filter((t) => Object.keys(axesOf(sessionPlot(t).plot)).length);
		expect(withAxes.length).toBeGreaterThanOrEqual(9);
	});

	it.each(PLOT_TYPES)('%s', async (type) => {
		const plot = sessionPlot(type);
		for (const [field, axis] of Object.entries(axesOf(plot.plot))) {
			expect(locateAxis(axis)).toEqual({ plot, field });
			const before = JSON.parse(JSON.stringify(axis));
			const edits = {
				label: 'Edited label',
				gridlines: !axis.gridlines,
				nticks: axis.nticks + 3,
				manualTicks: [1, 2, 3]
			};
			for (const [key, value] of Object.entries(edits)) {
				history.clear();
				markSessionSaved();
				commitAxisEdit(axis, key, value);
				expect(axis[key], `${type}.${field}.${key}`).toEqual(value);
				expect(history.undoCount, `${type}.${field}.${key} recorded`).toBe(1);
				expect(hasUnsavedChanges(), `${type}.${field}.${key} unsaved`).toBe(true);
				history.undo();
				expect(plot.plot[field][key], `${type}.${field}.${key} undone`).toEqual(before[key]);
				await Promise.resolve(); // the history records again once the undo has settled
			}
		}
	});
});

describe('the y label: undo gives back what was stored', () => {
	it('Scatterplot: a typed label undoes to the previous label', () => {
		const plot = sessionPlot('scatterplot');
		plot.plot.yAxisLeft.label = 'Activity';
		commitAxisEdit(plot.plot.yAxisLeft, 'label', 'Counts');
		expect(plot.plot.yAxisLeft.label).toBe('Counts');
		history.undo();
		expect(plot.plot.yAxisLeft.label).toBe('Activity');
		history.redo();
		expect(plot.plot.yAxisLeft.label).toBe('Counts');
	});

	it('Periodogram: undo goes back to the method default, not to a pinned label', () => {
		const plot = sessionPlot('periodogram');
		const inner = plot.plot;
		expect(inner.yAxis.label).toBe('');
		const methodDefault = inner.defaultYLabel;
		expect(methodDefault).toBeTruthy();
		commitAxisEdit(inner.yAxis, 'label', 'My statistic');
		expect(inner.yAxis.label).toBe('My statistic');
		history.undo();
		// Empty again, so the axis draws the method's default and follows a later method change.
		expect(plot.plot.yAxis.label).toBe('');
		expect(plot.plot.defaultYLabel).toBe(methodDefault);
	});

	it('an axis no session plot owns is edited in place, unrecorded', () => {
		const axis = new AxisClass({ label: 'a' });
		expect(commitAxisEdit(axis, 'label', 'b')).toBeNull();
		expect(axis.label).toBe('b');
		expect(history.undoCount).toBe(0);
	});

	it('a run of tick-count steps is one undo step', () => {
		const plot = sessionPlot('scatterplot');
		const axis = plot.plot.xAxis;
		const start = axis.nticks;
		for (let i = 1; i <= 4; i++) commitAxisEdit(axis, 'nticks', start + i, { coalesce: true });
		expect(history.undoCount).toBe(1);
		history.undo();
		expect(plot.plot.xAxis.nticks).toBe(start);
	});
});

describe('the axis label box (component)', () => {
	async function typeInto(input, text) {
		await fireEvent.focus(input);
		for (let i = 1; i <= text.length; i++)
			await fireEvent.input(input, { target: { value: text.slice(0, i) } });
	}

	it('previews while typing, records ONE step on change, and undo restores', async () => {
		const plot = sessionPlot('scatterplot');
		const axis = plot.plot.yAxisLeft;
		axis.label = 'Activity';
		const { container } = render(AxisLabelInput, { props: { axisData: axis } });
		const input = container.querySelector('input');
		await typeInto(input, 'Counts');
		expect(axis.label).toBe('Counts'); // the plot previews it
		expect(history.undoCount).toBe(0); // nothing recorded per keystroke
		await fireEvent.change(input, { target: { value: 'Counts' } });
		flushSync();
		expect(axis.label).toBe('Counts');
		expect(history.undoCount).toBe(1);
		expect(hasUnsavedChanges()).toBe(true);
		history.undo();
		flushSync();
		expect(plot.plot.yAxisLeft.label).toBe('Activity');
	});

	it('Escape puts the label back and records nothing', async () => {
		const plot = sessionPlot('scatterplot');
		const axis = plot.plot.yAxisLeft;
		axis.label = 'Activity';
		const { container } = render(AxisLabelInput, { props: { axisData: axis } });
		const input = container.querySelector('input');
		await typeInto(input, 'Typo');
		await fireEvent.keyDown(input, { key: 'Escape' });
		flushSync();
		expect(axis.label).toBe('Activity');
		expect(input.value).toBe('Activity');
		expect(history.undoCount).toBe(0);
		expect(hasUnsavedChanges()).toBe(false);
	});

	it('the Axis controls: gridlines and manual ticks are one step each', async () => {
		const plot = sessionPlot('scatterplot');
		const axis = plot.plot.xAxis;
		const { container } = render(Axis, {
			props: { axisData: axis, which: 'controls', title: 'X-Axis' }
		});
		await tick();
		const grid = container.querySelector('input[type=checkbox]');
		await fireEvent.click(grid);
		flushSync();
		expect(axis.gridlines).toBe(false);
		expect(history.undoCount).toBe(1);
		const select = container.querySelector('select[aria-label="Tick placement"]');
		select.value = 'manual';
		await fireEvent.change(select);
		flushSync();
		await tick();
		expect(history.undoCount).toBe(2);
		const ticks = container.querySelector('input[aria-label="Tick values"]');
		await typeInto(ticks, '0, 6, 12');
		expect(history.undoCount).toBe(2);
		await fireEvent.change(ticks, { target: { value: '0, 6, 12' } });
		flushSync();
		expect(axis.manualTicks).toEqual([0, 6, 12]);
		expect(history.undoCount).toBe(3);
		history.undo();
		expect(plot.plot.xAxis.manualTicks).toEqual([]);
		history.undo();
		expect(plot.plot.xAxis.manualTicks).toBeNull();
		history.undo();
		expect(plot.plot.xAxis.gridlines).toBe(true);
	});
});

// The axis settings must not be bound straight to a control again (bind:value / bind:checked
// on label, gridlines, nticks or manualTicks): that is the write that skipped the history.
describe('no axis setting is bound straight to a control', () => {
	it('finds none under src/lib', () => {
		const here = dirname(fileURLToPath(import.meta.url));
		const lib = resolve(here, '..');
		const BIND =
			/bind:(value|checked)=\{[^}]*(?:axisData|Axis\w*)\.(label|gridlines|nticks|manualTicks)\}/;
		const found = [];
		const walk = (dir) => {
			for (const name of readdirSync(dir)) {
				const p = join(dir, name);
				if (statSync(p).isDirectory()) walk(p);
				else if (name.endsWith('.svelte') && !/conflicted/.test(name)) {
					readFileSync(p, 'utf8')
						.split('\n')
						.forEach((line, i) => {
							if (BIND.test(line)) found.push(`${relative(lib, p)}:${i + 1}: ${line.trim()}`);
						});
				}
			}
		};
		walk(lib);
		expect(found).toEqual([]);
	});
});
