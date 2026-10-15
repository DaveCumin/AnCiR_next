// @ts-nocheck
// The periodogram's y title names the statistic its series show (Lomb-Scargle's normalised
// power, the chi-squared Qp, Enright's A_p) while the stored label is empty, and says when the
// methods are mixed; a typed label always wins, and a saved session keeps the label it stored.
// Also the plot's reported peak (SPEC-9): the largest Qp - threshold for Chi-squared.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import Periodogram, {
	Periodogramclass,
	periodogramYLabel,
	PERIODOGRAM_MIXED_Y_LABEL
} from './Periodogram.svelte';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function makePeriodogram() {
	const t = mkCol('t', [0, 1, 2, 3, 4, 5, 6, 7]);
	const plot = new Plot({ type: 'periodogram', plot: { data: [] } });
	plot.plot.addData({ x: { refId: t }, y: { refId: mkCol('a', [1, 2, 3, 4, 3, 2, 1, 2]) } });
	plot.plot.addData({ x: { refId: t }, y: { refId: mkCol('b', [4, 3, 2, 1, 2, 3, 4, 3]) } });
	core.plots.push(plot);
	return plot;
}

const axisTitle = (container) =>
	container.querySelector('.axis-left .axis-label')?.textContent ?? null;

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.seriesAppearance = {};
	appState.gridSize = 15;
});
afterEach(() => cleanup());

describe('periodogramYLabel', () => {
	it('names each method, and is neutral for mixed methods', () => {
		expect(periodogramYLabel(['Lomb-Scargle'])).toBe('Normalised power');
		expect(periodogramYLabel(['Chi-squared', 'Chi-squared'])).toBe('Chi-squared Qp');
		expect(periodogramYLabel(['Enright'])).toBe('Enright amplitude (A_p)');
		expect(periodogramYLabel(['Lomb-Scargle', 'Chi-squared'])).toBe(PERIODOGRAM_MIXED_Y_LABEL);
		expect(periodogramYLabel([])).toBe('Power');
	});
});

describe('Periodogram y title', () => {
	it('a new plot stores no label and draws the methods’ default, following a method change', async () => {
		const plot = makePeriodogram();
		const inner = plot.plot;
		expect(inner.yAxis.label).toBe('');
		const { container } = render(Periodogram, { props: { theData: plot, which: 'plot' } });
		expect(axisTitle(container)).toBe('Normalised power');
		inner.data[0].method = 'Chi-squared';
		flushSync();
		await tick();
		expect(axisTitle(container)).toBe(PERIODOGRAM_MIXED_Y_LABEL);
		inner.data[1].method = 'Chi-squared';
		flushSync();
		await tick();
		expect(axisTitle(container)).toBe('Chi-squared Qp');
		expect(inner.yLabelText).toBe('Chi-squared Qp');
		// Still nothing stored: the label is the default, not a copy of it.
		expect(inner.toJSON().yAxis.label).toBe('');
	});

	it('a typed label wins and survives a method change', async () => {
		const plot = makePeriodogram();
		const inner = plot.plot;
		inner.yAxis.label = 'My power';
		const { container } = render(Periodogram, { props: { theData: plot, which: 'plot' } });
		expect(axisTitle(container)).toBe('My power');
		inner.data[0].method = 'Enright';
		inner.data[1].method = 'Enright';
		flushSync();
		await tick();
		expect(axisTitle(container)).toBe('My power');
		expect(inner.yAxis.label).toBe('My power');
	});

	it('a saved session keeps the label it stored, "Power" included', () => {
		const plot = makePeriodogram();
		const json = JSON.parse(JSON.stringify(plot.plot.toJSON()));
		json.yAxis.label = 'Power';
		json.data.forEach((d) => (d.method = 'Chi-squared'));
		const back = Periodogramclass.fromJSON(plot, json);
		expect(back.yAxis.label).toBe('Power');
		expect(back.yLabelText).toBe('Power');
		// A pre-AxisClass session (no yAxis, a ygridlines flag) keeps its fixed "Power" too.
		delete json.yAxis;
		json.ygridlines = true;
		expect(Periodogramclass.fromJSON(plot, json).yLabelText).toBe('Power');
		// An inner carrying only its data (Quick-Plot, AI-built) is new: no stored label.
		expect(Periodogramclass.fromJSON(plot, { data: json.data }).yAxis.label).toBe('');
	});

	it('the Label box shows the default as its placeholder', async () => {
		const plot = makePeriodogram();
		plot.plot.data.forEach((d) => (d.method = 'Chi-squared'));
		appState.currentControlTab = 'properties';
		const { container } = render(Periodogram, { props: { theData: plot.plot, which: 'controls' } });
		await tick();
		const placeholders = [...container.querySelectorAll('input')].map((i) =>
			i.getAttribute('placeholder')
		);
		expect(placeholders).toContain('Chi-squared Qp');
	});
});

describe('Periodogram peak (SPEC-9)', () => {
	it('a Chi-squared series peaks at the largest Qp - threshold, not the largest Qp', () => {
		const plot = makePeriodogram();
		const d = plot.plot.data[0];
		d.method = 'Chi-squared';
		d.periodData = {
			x: [20, 24, 28, 32],
			y: [40, 70, 75, 90],
			threshold: [50, 60, 80, 100],
			pvalue: [0.5, 1e-4, 0.03, 0.02],
			df: [19, 23, 27, 31]
		};
		plot.plot.periodlimsIN = [1, 40];
		expect(d.peak.period).toBe(24);
		expect(d.visiblePeak.period).toBe(24);
		expect(d.peak.pvalue).toBeLessThan(0.05);
	});
});
