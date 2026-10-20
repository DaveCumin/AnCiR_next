// @ts-check
// The colour-by host helpers (encodingHost.js): ports, the mode and map a series draws with,
// the colour bar's title and ticks, and where the bar goes. The renderer and the plot are
// tested on the real Scatterplot (plots/Scatterplot/colourBy.svelte.test.js).
import { describe, it, expect } from 'vitest';
import {
	encodingPortName,
	parseEncodingPort,
	resolveEncodingPort,
	nextEncodingId,
	effectiveColourMode,
	effectiveColormap,
	colourBarTitle,
	colourBarTicks,
	formatColourValue,
	placeColourKey,
	colourKeyReserveW,
	colourKeyObstacle
} from './encodingHost.js';

describe('ports', () => {
	it('round-trips enc<id>_colour and rejects other ports', () => {
		expect(encodingPortName(3)).toBe('enc3_colour');
		expect(parseEncodingPort('enc3_colour')).toEqual({ id: 3, channel: 'colour' });
		for (const p of ['ov3_at', 'ys1', 'enc_colour', 'enc3_shape', '', null])
			expect(parseEncodingPort(p)).toBeNull();
	});

	it('resolves only a series whose colour by is on', () => {
		const on = { colourEncoding: { id: 2 }, colourBy: { refId: 5 } };
		const off = { colourEncoding: null, colourBy: null };
		const inner = { data: [off, on] };
		expect(resolveEncodingPort(inner, 'enc2_colour')?.datum).toBe(on);
		expect(resolveEncodingPort(inner, 'enc1_colour')).toBeNull();
		expect(nextEncodingId(inner)).toBe(3);
		expect(nextEncodingId({ data: [] })).toBe(1);
	});
});

describe('mode and map', () => {
	it('auto reads a time column as hour of day and a number as its value', () => {
		expect(effectiveColourMode('auto', { type: 'time' })).toBe('hourOfDay');
		expect(effectiveColourMode('auto', { type: 'number' })).toBe('value');
		// A stored mode the column cannot be read as falls back.
		expect(effectiveColourMode('value', { type: 'time' })).toBe('hourOfDay');
		expect(effectiveColourMode('dayOfYear', { type: 'number' })).toBe('value');
		expect(effectiveColourMode('dayOfYear', { type: 'time' })).toBe('dayOfYear');
	});

	it('a map must suit the scale; monochrome swaps it for its grey twin', () => {
		expect(effectiveColormap('auto', 'value')).toBe('viridis');
		expect(effectiveColormap('auto', 'hourOfDay')).toBe('twilight_shifted');
		expect(effectiveColormap('magma', 'value')).toBe('magma');
		expect(effectiveColormap('magma', 'hourOfDay')).toBe('twilight_shifted');
		expect(effectiveColormap('twilight_shifted', 'value')).toBe('viridis');
		expect(effectiveColormap('magma', 'value', true)).toBe('greys');
		expect(effectiveColormap('auto', 'hourOfDay', true)).toBe('greysCyclic');
	});
});

describe('the colour bar text', () => {
	it('names the zone for clock modes (decision 7)', () => {
		expect(colourBarTitle('hourOfDay', { zone: 'utc' })).toBe('Hour of day (UTC)');
		expect(colourBarTitle('hourOfDay', { zone: 'Asia/Kolkata' })).toBe(
			'Hour of day (Asia/Kolkata)'
		);
		expect(colourBarTitle('hourOfDay', { wrapped: true })).toBe(
			'Hours since start, wrapped at 24 h'
		);
		expect(colourBarTitle('value', { columnName: 'humidity' })).toBe('humidity');
	});

	it('ticks: 0 to 24 for the clock, ends and middle otherwise, manual ends marked', () => {
		expect(
			colourBarTicks({ lo: 0, hi: 24, cyclic: true }, 'hourOfDay').map((t) => t.label)
		).toEqual(['0', '6', '12', '18', '24']);
		expect(
			colourBarTicks({ lo: 2, hi: 4 }, 'value', { manualHi: true }).map((t) => t.label)
		).toEqual(['2', '3', '≥ 4']);
		expect(colourBarTicks({ lo: 5, hi: 5 }, 'value')).toEqual([{ t: 0.5, label: '5' }]);
		expect(colourBarTicks({ lo: NaN, hi: NaN }, 'value')).toEqual([]);
	});

	it('formats hours as a clock time', () => {
		expect(formatColourValue(14.5, 'hourOfDay')).toBe('14:30');
		expect(formatColourValue(23.999, 'hourOfDay')).toBe('00:00');
		expect(formatColourValue(NaN, 'value')).toBe('no value');
		expect(formatColourValue(12.3456, 'value')).toBe('12.3');
	});
});

describe('placing the bar', () => {
	const box = { width: 40, height: 100 };
	const base = { box, plotW: 400, plotH: 300, margin: 10 };

	it('beside the plot: past the right axis, under an outside legend', () => {
		expect(placeColourKey({ ...base, position: 'right' })).toEqual({
			x: 410,
			y: 0,
			maxLength: 300
		});
		const legend = { x: 410, y: 0, width: 80, height: 50, outside: true };
		expect(placeColourKey({ ...base, position: 'right', legend })).toMatchObject({
			y: 60,
			maxLength: 240
		});
		expect(
			placeColourKey({ ...base, position: 'right', hasRightAxis: true, paddingRight: 35 }).x
		).toBe(445);
		expect(colourKeyReserveW(40, 10)).toBe(50);
		expect(colourKeyReserveW(40, 10, true)).toBe(60);
		expect(colourKeyReserveW(0, 10)).toBe(0);
	});

	it('an inside corner keeps its backdrop inset, and moves past a legend in the same corner', () => {
		const inset = 8;
		expect(placeColourKey({ ...base, position: 'topright', inset })).toMatchObject({
			x: 400 - 10 - 56 + 8,
			y: 18
		});
		const legend = { x: 300, y: 10, width: 90, height: 40, outside: false, corner: 'topright' };
		const p = placeColourKey({ ...base, position: 'topright', inset, legend });
		expect(p.y - inset).toBe(10 + 40 + 10);
		const bl = { x: 10, y: 250, width: 90, height: 40, outside: false, corner: 'bottomleft' };
		const q = placeColourKey({ ...base, position: 'bottomleft', inset, legend: bl });
		expect(q.y + box.height + inset).toBe(250 - 10);
	});

	it('is an obstacle for an auto legend only when inside', () => {
		expect(colourKeyObstacle('right', box, 400, 300, 10)).toBeNull();
		expect(colourKeyObstacle('topleft', box, 400, 300, 10, {}, 8)).toEqual([10, 10, 66, 126]);
	});
});
