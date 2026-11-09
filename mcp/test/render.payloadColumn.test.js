// The render page rebuilds each payload column (render/payloadColumn.js). A time column arrives
// as epoch-ms instants (the engine's getData()), so the copy must read them back unchanged. It
// used to be given an ISO text format, every time parsed to NaN, and an actogram of a time
// column rendered as a bare axis.
import { beforeAll, describe, expect, it } from 'vitest';
import { core } from '$lib/core/core.svelte.js';
import { payloadColumn } from '../src/render/payloadColumn.js';

beforeAll(() => core.rawData.clear());

describe('payloadColumn', () => {
	it.each([2018, 1918])('reads a %i time column as the same instants', (year) => {
		const t0 = Date.UTC(year, 0, 1);
		const values = Array.from({ length: 5 }, (_, i) => t0 + i * 60000);
		core.rawData.set(901, values);
		const col = payloadColumn({ id: 901, name: 't', type: 'time' });
		expect(col.getData()).toEqual(values);
		expect(col.hoursSinceStart.slice(0, 2)).toEqual([0, 1 / 60]);
	});

	it('keeps the column clock zone when the payload names one', () => {
		core.rawData.set(902, [Date.UTC(2018, 0, 1)]);
		const col = payloadColumn({ id: 902, name: 't', type: 'time', timeZone: 'Pacific/Auckland' });
		expect(col.timeZone).toBe('Pacific/Auckland');
	});

	it('leaves a numeric column as given', () => {
		core.rawData.set(903, [1, 2, 3]);
		expect(payloadColumn({ id: 903, name: 'h' }).getData()).toEqual([1, 2, 3]);
	});
});
