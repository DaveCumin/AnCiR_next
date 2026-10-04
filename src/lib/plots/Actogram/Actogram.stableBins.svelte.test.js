/**
 * ROB-9: a series' bins stay the SAME object while their values are unchanged.
 *
 * A reference column re-keys its data cache whenever core.data changes, so adding any column
 * (every analysis output during a session load does) used to rebuild every series' bins with
 * identical numbers, and every row of every series redrew. Driven over the shipped
 * free-running demo, like the other actogram tests.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';

const SESSION = join(
	process.cwd(),
	'static',
	'sessions',
	'demos',
	'demo-workflow-free-running.json'
);

function actogramFromDemo() {
	const session = JSON.parse(readFileSync(SESSION, 'utf8'));
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.storedValues = {};
	core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
	for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));
	const plot = Plot.fromJSON(session.plots.find((p) => p.type === 'actogram'));
	core.plots.push(plot);
	plot.parentBox = { id: plot.id, width: 600, height: 500 };
	return plot;
}

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
});

describe('Actogram series bins identity', () => {
	it('adding an unrelated column keeps allBins and binsByPeriod the same objects', () => {
		const series = actogramFromDemo().plot.data[0];
		const bins = series.allBins;
		const byPeriod = series.binsByPeriod;
		expect(bins.length).toBeGreaterThan(100);
		const yBefore = series.y.getData();

		pushObj(new Column({ refId: series.y.refId ?? series.y.id }));
		// The y column really did re-derive (that is what used to cascade)...
		expect(series.y.getData()).not.toBe(undefined);
		// ...but the bins did not change, so the same objects come back.
		expect(series.allBins).toBe(bins);
		expect(series.binsByPeriod).toBe(byPeriod);
		expect(series.y.getData()).toEqual(yBefore);
	});

	it('a changed value still produces new bins', () => {
		const series = actogramFromDemo().plot.data[0];
		const bins = series.allBins;
		// Edit the raw y data IN PLACE, the way a table cell edit does, and bump the version.
		let raw = series.y;
		while (raw.refId != null && raw.refColumn) raw = raw.refColumn;
		const arr = core.rawData.get(raw.data);
		const i = arr.findIndex((v) => Number.isFinite(Number(v)));
		arr[i] = Number(arr[i]) + 1000;
		raw.rawDataVersion++;
		const next = series.allBins;
		expect(next).not.toBe(bins);
		expect(next.some((b) => b.y === Number(arr[i]))).toBe(true);
	});
});
