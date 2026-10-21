// @ts-nocheck
/**
 * The FFT phase axis's manual ends (`phaseYlimsIN`, Properties > Phase min / max) survive a
 * save and reload. They used to be neither written by toJSON nor read by fromJSON, so a
 * reloaded session (and an undo, which applies saved JSON) put the phase axis back on its
 * automatic range, and the Python export drew whatever the file happened to carry.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';

const HOURS = Array.from({ length: 96 }, (_, i) => i);
const WAVE = HOURS.map((t) => 10 + 5 * Math.cos((2 * Math.PI * t) / 24));

function mkCol(values) {
	const c = new Column({ type: 'number', data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function makeFft() {
	const plot = new Plot({ type: 'fft', name: 'fft', width: 500, height: 300, plot: {} });
	plot.plot.addData({ x: { refId: mkCol(HOURS) }, y: { refId: mkCol(WAVE) } });
	plot.plot.data[0].showPhase = true;
	core.plots.push(plot);
	return core.plots[core.plots.length - 1];
}

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
});

beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
});

describe('FFT phase axis limits', () => {
	it('are saved and restored with the plot', () => {
		const plot = makeFft();
		plot.plot.phaseYlimsIN = [-4, 2.5];
		const saved = JSON.parse(JSON.stringify(plot));
		expect(saved.plot.phaseYlimsIN).toEqual([-4, 2.5]);
		const back = Plot.fromJSON(saved);
		expect(back.plot.phaseYlimsIN).toEqual([-4, 2.5]);
		expect(back.plot.phaseYlims).toEqual([-4, 2.5]);
	});

	it('one manual end keeps the other automatic', () => {
		const plot = makeFft();
		plot.plot.phaseYlimsIN = [null, 3];
		const back = Plot.fromJSON(JSON.parse(JSON.stringify(plot)));
		expect(back.plot.phaseYlimsIN).toEqual([null, 3]);
		expect(back.plot.phaseYlims[1]).toBe(3);
		expect(Number.isFinite(back.plot.phaseYlims[0])).toBe(true);
	});

	it('a plot saved without them, or with junk, loads on the automatic range', () => {
		const plot = makeFft();
		const saved = JSON.parse(JSON.stringify(plot));
		delete saved.plot.phaseYlimsIN;
		expect(Plot.fromJSON(saved).plot.phaseYlimsIN).toEqual([null, null]);
		saved.plot.phaseYlimsIN = ['x', {}];
		expect(Plot.fromJSON(saved).plot.phaseYlimsIN).toEqual([null, null]);
	});
});
