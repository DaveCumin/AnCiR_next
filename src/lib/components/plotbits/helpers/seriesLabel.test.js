import { describe, it, expect } from 'vitest';
import { seriesDisplayLabel } from './seriesLabel.js';

describe('seriesDisplayLabel', () => {
	it('returns an explicit user label verbatim', () => {
		expect(seriesDisplayLabel({ label: 'My series', y: { name: 'activity' } })).toBe('My series');
	});

	it('falls back to the y column name when no label is set', () => {
		expect(seriesDisplayLabel({ label: '', y: { name: 'activity' } })).toBe('activity');
	});

	it('treats a blank label as unset (uses the y name)', () => {
		expect(seriesDisplayLabel({ y: { name: 'temperature' } })).toBe('temperature');
	});

	it('falls back to positional Data N when there is no y column', () => {
		const plot = { data: [] };
		const a = { label: '', parentPlot: plot };
		const b = { label: '', parentPlot: plot };
		plot.data.push(a, b);
		expect(seriesDisplayLabel(a)).toBe('Data 1');
		expect(seriesDisplayLabel(b)).toBe('Data 2');
	});

	it('falls back to Data N when y has no resolvable name (refId -1)', () => {
		const plot = { data: [] };
		const a = { label: '', y: { name: undefined }, parentPlot: plot };
		plot.data.push(a);
		expect(seriesDisplayLabel(a)).toBe('Data 1');
	});

	it('an explicit label wins even over a wired y column', () => {
		expect(seriesDisplayLabel({ label: 'Custom', y: { name: 'activity' } })).toBe('Custom');
	});

	it('is safe on a null/undefined datum', () => {
		expect(seriesDisplayLabel(null)).toBe('');
		expect(seriesDisplayLabel(undefined)).toBe('');
	});

	it('falls back to Data 1 when the series is detached from any plot', () => {
		expect(seriesDisplayLabel({ label: '' })).toBe('Data 1');
	});

	it('falls back to a single wired `column` name (PairsPlot / CorrelationHeatmap shape)', () => {
		expect(seriesDisplayLabel({ column: { name: 'activity' } })).toBe('activity');
	});

	it('prefers y over column when both exist', () => {
		expect(seriesDisplayLabel({ y: { name: 'yname' }, column: { name: 'cname' } })).toBe('yname');
	});

	it('a custom fallback replaces only the positional tier', () => {
		expect(seriesDisplayLabel({ label: '' }, { fallback: 'Variable 2' })).toBe('Variable 2');
		expect(
			seriesDisplayLabel({ label: '', y: { name: 'activity' } }, { fallback: 'Variable 2' })
		).toBe('activity');
		expect(seriesDisplayLabel({ label: 'Mine' }, { fallback: 'Variable 2' })).toBe('Mine');
		expect(seriesDisplayLabel(null, { fallback: 'Variable 2' })).toBe('Variable 2');
	});

	it('is reactive at the data level: re-reading after a rename answers the new name', () => {
		// The helper reads datum.y.name each call, so a column rename needs no
		// bookkeeping — the next read (Svelte re-render) sees the new name.
		const y = { name: 'before' };
		const datum = { label: '', y };
		expect(seriesDisplayLabel(datum)).toBe('before');
		y.name = 'after';
		expect(seriesDisplayLabel(datum)).toBe('after');
	});
});
