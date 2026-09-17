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

	// A real plot wrapper is a REFERENTIAL Column: `Column.name` returns the
	// referenced column's name with a `*` marker, which belongs in column lists
	// and not in a legend. Session load hid this by pre-filling `customName`;
	// any setPlotInner rebuild (a wire, a series delete) then flipped the legend
	// from "activity" to "activity*". The label must read the wired column.
	describe('referential wrapper columns (the real Column shape)', () => {
		const wrapper = (refColumn, extra = {}) => ({
			refId: refColumn?.id ?? -1,
			refColumn,
			customName: null,
			isReferencial() {
				return this.refId != null;
			},
			get name() {
				if (this.customName != null) return this.customName;
				return (this.refColumn?.name ?? '') + '*';
			},
			...extra
		});

		it('shows the referenced column name without the reference marker', () => {
			const y = wrapper({ id: 7, name: 'activity' });
			expect(y.name).toBe('activity*'); // what Column.name gives
			expect(seriesDisplayLabel({ label: '', y })).toBe('activity');
		});

		it('is the same before and after a rebuild that clears customName', () => {
			const real = { id: 7, name: 'activity' };
			const loaded = wrapper(real, { customName: 'activity' }); // session-load prewarm
			const rebuilt = wrapper(real); // fresh `new Column({ refId })`
			expect(seriesDisplayLabel({ label: '', y: loaded })).toBe('activity');
			expect(seriesDisplayLabel({ label: '', y: rebuilt })).toBe('activity');
		});

		it('a name the user gave the wrapper still wins', () => {
			const y = wrapper({ id: 7, name: 'activity' }, { customName: 'my series' });
			expect(seriesDisplayLabel({ label: '', y })).toBe('my series');
		});

		it('follows a rename of the referenced column', () => {
			const real = { id: 7, name: 'before' };
			const y = wrapper(real);
			expect(seriesDisplayLabel({ label: '', y })).toBe('before');
			real.name = 'after';
			expect(seriesDisplayLabel({ label: '', y })).toBe('after');
		});

		it('a blank or broken reference falls back to Data N rather than a bare "*"', () => {
			const plot = { data: [] };
			const a = { label: '', y: wrapper(undefined), parentPlot: plot };
			plot.data.push(a);
			expect(a.y.name).toBe('*');
			expect(seriesDisplayLabel(a)).toBe('Data 1');
		});
	});
});
