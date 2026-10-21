// The zone the import dialog proposes from offsets written in the text (plan 3.3).
// Never a guess: a column with no offsets gets no proposal (it imports "As written").
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/core/core.svelte', () => ({ appState: { displayTimezone: 'utc' } }));

import { suggestImportZone } from './importZone.js';
import { formatHasOffset, valueOffsetMinutes } from './TimeUtils.js';

const ISO_OFFSET = 'YYYY-MM-DDTHH:mm:ssZ';

describe('valueOffsetMinutes and formatHasOffset', () => {
	it('reads the offset each value carries', () => {
		expect(formatHasOffset(ISO_OFFSET)).toBe(true);
		expect(formatHasOffset('YYYY-MM-DD HH:mm')).toBe(false);
		expect(formatHasOffset(['YYYY-MM-DD HH:mm', ISO_OFFSET])).toBe(true);
		expect(formatHasOffset('[Z]YYYY')).toBe(false); // a literal Z is not an offset
		expect(valueOffsetMinutes('2024-03-10T08:00:00+13:00', ISO_OFFSET)).toBe(780);
		expect(valueOffsetMinutes('2024-03-10T08:00:00+0530', ISO_OFFSET)).toBe(330);
		expect(valueOffsetMinutes('2024-03-10T08:00:00Z', ISO_OFFSET)).toBe(0);
		expect(valueOffsetMinutes('2024-03-10 08:00', 'YYYY-MM-DD HH:mm')).toBeNull();
	});
});

describe('suggestImportZone', () => {
	it('every value at +13:00 proposes the fixed offset +13:00', () => {
		const values = ['2024-03-10T08:00:00+13:00', '2024-03-10T09:00:00+13:00', '', null];
		const s = suggestImportZone(values, ISO_OFFSET);
		expect(s.zone).toBe('+13:00');
		expect(s.offsets).toEqual(['+13:00']);
		expect(s.note).toBeNull();
	});

	it('Z proposes utc', () => {
		expect(suggestImportZone(['2024-03-10T08:00:00Z'], ISO_OFFSET).zone).toBe('utc');
	});

	it('offsets that change at the end of NZ daylight saving propose Pacific/Auckland', () => {
		// 7 Apr 2024: 02:30 NZDT, then the clocks go back and 02:30 comes again as NZST.
		const values = [
			'2024-04-07T01:30:00+13:00',
			'2024-04-07T02:30:00+13:00',
			'2024-04-07T02:30:00+12:00',
			'2024-04-07T03:30:00+12:00'
		];
		const s = suggestImportZone(values, ISO_OFFSET, {
			preferZone: 'Europe/London',
			zones: ['Asia/Kolkata', 'Pacific/Auckland']
		});
		expect(s.zone).toBe('Pacific/Auckland');
		expect(s.offsets).toEqual(['+13:00', '+12:00']);
	});

	it('no offsets, no format, or no values: no proposal', () => {
		expect(suggestImportZone(['2024-03-10 08:00'], 'YYYY-MM-DD HH:mm')).toBeNull();
		expect(suggestImportZone(['2024-03-10T08:00:00+13:00'], '')).toBeNull();
		expect(suggestImportZone(['2024-03-10T08:00:00+13:00'], -1)).toBeNull();
		expect(suggestImportZone([], ISO_OFFSET)).toBeNull();
		expect(suggestImportZone(null, ISO_OFFSET)).toBeNull();
	});
});
