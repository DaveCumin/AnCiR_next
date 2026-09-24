import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rawData, addNotification } = vi.hoisted(() => ({
	rawData: new Map(),
	addNotification: vi.fn()
}));
// core.svelte and core.svelte.js are one module: columnType.js reads core,
// TimeUtils (via displayTime.js) reads appState.
vi.mock('$lib/core/core.svelte.js', () => ({
	core: { rawData },
	appState: { displayTimezone: 'utc' }
}));
vi.mock('$lib/core/notifications.svelte.js', () => ({ addNotification }));

import { sniffTimeFormatOnTypeChange } from './columnType.js';

describe('sniffTimeFormatOnTypeChange', () => {
	beforeEach(() => {
		rawData.clear();
		addNotification.mockClear();
	});

	it('guesses a format for unpadded seconds', () => {
		rawData.set(1, ['2020-01-01 9:30:5', '2020-01-01 9:30:12']);
		const col = { name: 't', data: 1, timeFormat: [] };
		sniffTimeFormatOnTypeChange(col, 'time');
		expect(col.timeFormat).toBe('YYYY-MM-DD H:mm:s');
		expect(addNotification).not.toHaveBeenCalled();
	});

	it('warns, rather than failing silently, when nothing is recognised', () => {
		rawData.set(1, ['d1 0930h', 'd1 0940h']);
		const col = { name: 'stamp', data: 1, timeFormat: [] };
		sniffTimeFormatOnTypeChange(col, 'time');
		expect(col.timeFormat).toEqual([]);
		expect(addNotification).toHaveBeenCalledOnce();
		expect(addNotification.mock.calls[0][0]).toContain('"stamp"');
		expect(addNotification.mock.calls[0][1]).toBe('warning');
	});

	it('leaves numeric (epoch-ms) data and existing formats alone', () => {
		rawData.set(1, [1.5, 2.5, 3.5]);
		const numeric = { name: 'n', data: 1, timeFormat: [] };
		sniffTimeFormatOnTypeChange(numeric, 'time');
		expect(numeric.timeFormat).toEqual([]);

		rawData.set(2, ['2020-01-01 9:30:5']);
		const kept = { name: 'k', data: 2, timeFormat: 'YYYY-MM-DD HH:mm:ss' };
		sniffTimeFormatOnTypeChange(kept, 'time');
		expect(kept.timeFormat).toBe('YYYY-MM-DD HH:mm:ss');
		expect(addNotification).not.toHaveBeenCalled();
	});

	it('does nothing for other types', () => {
		rawData.set(1, ['d1 0930h']);
		const col = { name: 'x', data: 1, timeFormat: [] };
		sniffTimeFormatOnTypeChange(col, 'number');
		expect(addNotification).not.toHaveBeenCalled();
	});
});
