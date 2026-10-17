// @ts-nocheck
// The actogram's start time: automatic (the start of the day of the earliest sample) until
// the user picks one in Properties > Time; the choice is saved and is one undo step.
//
// THE BUG: the Start time box was bound straight onto `startTime`, a $derived. Svelte lets a
// derived be overwritten, so the plot moved, but only until the data changed; the choice was
// never saved and no undo could reach it. Now the choice is `startTimeIN` (null: automatic).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { plotEditState, recordPlotGesture } from '$lib/plots/plotEdits.js';

const PLOTS = await loadPlots();
const DAY = 86400000;
const T0 = Date.UTC(2024, 2, 5, 7, 30); // 05 Mar 2024 07:30 UTC

beforeAll(() => {
	appConsts.plotMap = PLOTS;
	history.init();
});
beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	history.clear();
});

function actogram() {
	const t = new Column({ type: 'time', data: -1 });
	core.rawData.set(
		t.id,
		Array.from({ length: 96 }, (_, i) => T0 + i * 3600000)
	);
	t.data = t.id;
	core.data.push(t);
	const v = new Column({ type: 'number', data: -1 });
	core.rawData.set(
		v.id,
		Array.from({ length: 96 }, (_, i) => i % 24)
	);
	v.data = v.id;
	core.data.push(v);
	const plot = new Plot({
		type: 'actogram',
		name: 'a',
		width: 400,
		height: 300,
		plot: { data: [{ x: { refId: t.id }, y: { refId: v.id } }] }
	});
	core.plots.push(plot);
	return core.plots.at(-1);
}

describe('actogram start time', () => {
	it('is the start of the first day until chosen, and is not saved while automatic', () => {
		const p = actogram();
		expect(p.plot.startTime).toBe(Date.UTC(2024, 2, 5));
		expect(p.plot.startTimeIN).toBeNull();
		expect('startTimeIN' in p.plot.toJSON()).toBe(false);
	});

	it('a chosen start time wins, is saved and comes back on load', () => {
		const p = actogram();
		p.plot.startTimeIN = Date.UTC(2024, 2, 4, 18);
		expect(p.plot.startTime).toBe(Date.UTC(2024, 2, 4, 18));
		const json = JSON.parse(JSON.stringify(p.toJSON()));
		expect(json.plot.startTimeIN).toBe(Date.UTC(2024, 2, 4, 18));
		const back = new Plot(json);
		expect(back.plot.startTime).toBe(Date.UTC(2024, 2, 4, 18));
	});

	it('setting it and resetting it are each one exact undo step', () => {
		const p = actogram();
		const auto = JSON.stringify(p.toJSON());
		let before = plotEditState(p);
		p.plot.startTimeIN = Date.UTC(2024, 2, 5) - DAY / 2;
		recordPlotGesture(p, before);
		const chosen = JSON.stringify(p.toJSON());
		before = plotEditState(p);
		p.plot.startTimeIN = null;
		recordPlotGesture(p, before);
		expect(JSON.stringify(p.toJSON())).toBe(auto);
		expect(history.undoCount).toBe(2);
		history.undo();
		expect(JSON.stringify(p.toJSON())).toBe(chosen);
		history.undo();
		expect(JSON.stringify(p.toJSON())).toBe(auto);
		expect(p.plot.startTime).toBe(Date.UTC(2024, 2, 5));
	});
});
