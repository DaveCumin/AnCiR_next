// The CWT's time axis reads the record's own time. The transform runs on hours since the first
// sample, and the axis used to label those offsets, so every scalogram started at 0: a numeric
// time column running 48 .. 120 h read 0 .. 72, and a time column showed no date.
import { describe, it, expect } from 'vitest';
import { cwtTimeAxis, columnOrigin } from './cwtTimeAxis.js';

const H = 3600000;
const stub = (type, raw, hours) => ({ type, getData: () => raw, hoursSinceStart: hours });

describe('cwtTimeAxis', () => {
	it('labels a numeric column with its own values', () => {
		const hours = Array.from({ length: 145 }, (_, i) => i);
		const x = stub(
			'number',
			hours.map((h) => h + 48),
			hours
		);
		expect(columnOrigin(x)).toBe(48);
		const axis = cwtTimeAxis({ t0: 0, t1: 144, width: 400, xCol: x });
		expect(axis.title).toBe('Time (h)');
		expect(axis.ticks.map((t) => t.label)).toEqual(['48', '84', '120', '156', '192']);
		expect(axis.ticks.map((t) => t.x)).toEqual([0, 100, 200, 300, 400]);
	});

	it('labels a time column with clock ticks at their place in the record', () => {
		const t0 = Date.UTC(2018, 2, 5);
		const hours = Array.from({ length: 6 * 24 + 1 }, (_, i) => i);
		const x = stub(
			'time',
			hours.map((h) => t0 + h * H),
			hours
		);
		const axis = cwtTimeAxis({ t0: 0, t1: 144, width: 600, xCol: x });
		expect(axis.title).toBe('Time');
		expect(axis.ticks[0]).toEqual({ x: 0, label: '5 Mar' });
		expect(axis.ticks.map((t) => t.label)).toContain('8 Mar');
		const mar8 = axis.ticks.find((t) => t.label === '8 Mar');
		expect(mar8.x).toBeCloseTo(300, 9);
	});

	it('skips leading gaps to find the origin, and falls back to 0 with none', () => {
		const x = stub('number', [null, 'x', 10, 11], [null, null, 2, 3]);
		expect(columnOrigin(x)).toBe(8);
		expect(columnOrigin(stub('number', [], []))).toBeNull();
		const axis = cwtTimeAxis({ t0: 0, t1: 4, width: 100, xCol: null });
		expect(axis.ticks.map((t) => t.label)).toEqual(['0', '1', '2', '3', '4']);
	});
});

describe('exportTimeOf: the CSV in the record’s own time', () => {
	it('writes ISO instants for a time column and the column’s hours for a numeric one', async () => {
		const { exportTimeOf } = await import('./cwtTimeAxis.js');
		const t0 = Date.UTC(1918, 0, 1);
		const timeCol = stub('time', [t0, t0 + H], [0, 1]);
		expect(exportTimeOf(timeCol)(1.5)).toBe('1918-01-01T01:30:00.000Z');
		expect(exportTimeOf(stub('number', [48, 49], [0, 1]))(2)).toBe(50);
		expect(exportTimeOf(null)(3)).toBe(3);
	});
});
