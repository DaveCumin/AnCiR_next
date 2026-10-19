// @ts-nocheck
// Stored-value default names read the column's display name, as one word, and list the
// names older versions used so saved sessions keep their values (v82.34).
import { describe, it, expect } from 'vitest';
import { storedValueSlug, storedValueNames } from './storedValueNames.js';

describe('storedValueSlug', () => {
	it('keeps words, joins the rest with _', () => {
		expect(storedValueSlug('amplitude')).toBe('amplitude');
		expect(storedValueSlug('Binned: temperature')).toBe('Binned_temperature');
		expect(storedValueSlug('Activity (counts)')).toBe('Activity_counts');
		expect(storedValueSlug('R²')).toBe('R²');
		expect(storedValueSlug('  ')).toBe('');
	});
});

describe('storedValueNames', () => {
	it('a plain column: its name, no legacy needed', () => {
		expect(storedValueNames('trend_r2', { name: 'A1' })).toEqual({
			defaultName: 'trend_r2_A1',
			legacyNames: []
		});
	});

	it('a column whose name has spaces: one word, the old spelling is legacy', () => {
		expect(storedValueNames('fit_rmse', { name: 'Activity (counts)' })).toEqual({
			defaultName: 'fit_rmse_Activity_counts',
			legacyNames: ['fit_rmse_Activity (counts)']
		});
	});

	it('no column: the fallback (a plot series with nothing wired)', () => {
		expect(storedValueNames('fft_peak_period', null, { fallback: 'data1' }).defaultName).toBe(
			'fft_peak_period_data1'
		);
	});

	it('suffix and extra legacy parts', () => {
		const r = storedValueNames(
			'cosinor_period',
			{ name: 'A1' },
			{
				suffix: '_2',
				legacy: ['cosinory_5_7']
			}
		);
		expect(r.defaultName).toBe('cosinor_period_A1_2');
		expect(r.legacyNames).toEqual(['cosinor_period_cosinory_5_7_2']);
	});
});
