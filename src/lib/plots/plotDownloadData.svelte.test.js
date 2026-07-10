/**
 * getDownloadData() formatting contract for calculating plots.
 *
 * These plots derive numbers the raw columns don't contain (bins, spectra,
 * autocorrelation). getDownloadData() is the single tap-point the in-app
 * "Show/Save data" and the Python CSV export both mirror, so its headers and
 * row shape are a contract. This test builds each plot on seeded number
 * columns and asserts that contract.
 *
 * Actogram/Correlogram/FFT compute via pure $derived, so the data is available
 * synchronously. Periodogram computes on a debounced worker effect (not
 * synchronous), so it is covered by the Python parity/emit tests instead.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Actogramclass } from './Actogram/Actogram.svelte';
import { Correlogramclass } from './Correlogram/Correlogram.svelte';
import { FFTclass } from './FFT/FFT.svelte';
import { Histogramclass } from './Histogram/Histogram.svelte';

const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));

function mkCol(type, values) {
	const c = new Column({ type, data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

// A clean 24 h rhythm over 7 days, sampled hourly.
function seedRhythm() {
	const t = seq(168, (i) => i);
	const y = t.map((h) => 50 + 40 * Math.cos((2 * Math.PI * (h - 8)) / 24));
	return { tId: mkCol('number', t), vId: mkCol('number', y) };
}

function build(Cls) {
	const { tId, vId } = seedRhythm();
	const parentBox = { id: 1, width: 400, height: 300, data: [] };
	return new Cls(parentBox, { time: { refId: tId }, values: { refId: vId } });
}

describe('calculating-plot getDownloadData contract', () => {
	beforeEach(() => {
		core.data = [];
		core.rawData = new Map();
	});

	it('Actogram: tidy binned series, periods numbered from 1', () => {
		const { headers, rows } = build(Actogramclass).getDownloadData();
		expect(headers).toEqual(['DataSeries', 'Period', 'BinStart (hrs)', 'BinEnd (hrs)', 'Value']);
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) {
			expect(r).toHaveLength(5);
			expect(r[0]).toBe(0); // single series
			expect(r[1]).toBeGreaterThanOrEqual(1); // period index from 1
			expect(r[3]).toBeGreaterThan(r[2]); // binEnd > binStart
			expect(Number.isFinite(r[4])).toBe(true);
		}
	});

	it('Correlogram: lag/autocorrelation rows with increasing lags', () => {
		const { headers, rows } = build(Correlogramclass).getDownloadData();
		expect(headers).toEqual(['DataSeries', 'Lag (hours)', 'Autocorrelation']);
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) expect(r).toHaveLength(3);
		const lags = rows.map((r) => r[1]);
		expect(lags).toEqual([...lags].sort((a, b) => a - b));
	});

	it('FFT: frequency/period/magnitude rows (no phase column by default)', () => {
		const { headers, rows } = build(FFTclass).getDownloadData();
		expect(headers).toEqual([
			'DataSeries',
			'Frequency (cycles/hr)',
			'Period (hours)',
			'Magnitude'
		]);
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) expect(r).toHaveLength(4);
		// dominant period should be ~24 h for the seeded rhythm
		const withPeriod = rows.filter((r) => typeof r[2] === 'number');
		const peak = withPeriod.reduce((a, b) => (b[3] > a[3] ? b : a));
		expect(Math.abs(peak[2] - 24)).toBeLessThan(3);
	});

	it('Histogram: tidy long export carries bin, density, and raw rows', () => {
		// A spread of values so bins have counts and the KDE has ≥2 points.
		const vals = seq(120, (i) => (i % 20) + Math.sin(i));
		const vId = mkCol('number', vals);
		const parentBox = { id: 1, width: 400, height: 300, data: [] };
		// showDensity is OFF: the density curve data must still export (the export
		// uses kdeCurve() directly, the display toggle only gates what's DRAWN).
		const h = new Histogramclass(parentBox, {
			data: [{ column: { refId: vId }, label: 'S1', binSize: 2, showDensity: false }]
		});
		const { headers, rows } = h.getDownloadData();
		expect(headers).toEqual(['series', 'kind', 'x_start', 'x_end', 'value']);
		for (const r of rows) expect(r).toHaveLength(5);
		expect(rows.every((r) => r[0] === 'S1')).toBe(true);
		const kinds = new Set(rows.map((r) => r[1]));
		expect(kinds.has('bin')).toBe(true);
		expect(kinds.has('density')).toBe(true);
		expect(kinds.has('raw')).toBe(true);
		// One raw row per valid input value.
		expect(rows.filter((r) => r[1] === 'raw').length).toBe(vals.length);
		// Bin rows have a real [start, end) range; counts sum to the number of values.
		const binRows = rows.filter((r) => r[1] === 'bin');
		for (const r of binRows) expect(r[3]).toBeGreaterThan(r[2]);
		expect(binRows.reduce((s, r) => s + r[4], 0)).toBe(vals.length);
	});
});
