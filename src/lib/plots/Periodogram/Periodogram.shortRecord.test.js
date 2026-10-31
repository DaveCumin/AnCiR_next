// The Periodogram plot's chi-squared short-record warning (decision 2026-11-01: the test is
// kept, the user is told; utils/chiSquaredShortRecord.js). It sits with the plot's other data
// warnings, under the series' controls.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Periodogramclass } from './Periodogram.svelte';

function datum(xType) {
	const plot = new Periodogramclass({ width: 500, height: 250, id: 1 }, null);
	plot.addData({ x: { refId: 0 }, y: { refId: 1 } });
	const d = plot.data[0];
	// The x column's type decides days (a time column) or cycles only.
	Object.defineProperty(d, 'x', { value: { type: xType }, configurable: true });
	return d;
}

const hourly = (days) => Array.from({ length: 24 * days }, (_, i) => i);
const wave = (t) => t.map((h) => 100 + 50 * Math.sin((2 * Math.PI * h) / 24));

function warningsFor(d, days, method, displayMax = 30) {
	const x = hourly(days);
	d.triggerCalculation(x, wave(x), 1, method, 0.05, 0.25, 1, displayMax, `h${days}`, `y${days}`);
	d.cleanup();
	return d.dataWarnings;
}

describe('Periodogram plot: chi-squared on a short record', () => {
	afterEach(() => vi.useRealTimers());

	it('3 days on a time x, tested to 30 h: the warning, in days', () => {
		vi.useFakeTimers();
		expect(warningsFor(datum('time'), 3, 'Chi-squared')).toContain(
			'With only 3 days of data (2.4 cycles of the longest period tested, 30 h), the chi-squared ' +
				'test is very conservative and can miss a rhythm that is there; consider Lomb-Scargle or ' +
				'a longer record (at least 7 cycles).'
		);
	});

	it('cycles at the displayed maximum period: 8 days to 30 h warns, to 24 h does not', () => {
		vi.useFakeTimers();
		const short = /chi-squared test is very conservative/;
		expect(warningsFor(datum('time'), 8, 'Chi-squared', 30).some((w) => short.test(w))).toBe(true);
		expect(warningsFor(datum('time'), 8, 'Chi-squared', 24).some((w) => short.test(w))).toBe(false);
		expect(warningsFor(datum('time'), 3, 'Enright').some((w) => short.test(w))).toBe(false);
		expect(warningsFor(datum('number'), 3, 'Chi-squared')[0]).toMatch(/^With only 2\.4 cycles/);
	});
});
