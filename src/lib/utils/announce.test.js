import { describe, it, expect, vi, afterEach } from 'vitest';
import { announce } from './announce.js';

afterEach(() => vi.useRealTimers());

describe('announce', () => {
	it('writes the message into one polite status region', () => {
		vi.useFakeTimers();
		announce('Moved y to position 2 of 5');
		vi.advanceTimersByTime(60);
		const regions = document.querySelectorAll('[role="status"][aria-live="polite"]');
		expect(regions).toHaveLength(1);
		expect(regions[0].textContent).toBe('Moved y to position 2 of 5');
		announce('Again');
		vi.advanceTimersByTime(60);
		expect(document.querySelectorAll('#app-announcer')).toHaveLength(1);
		expect(regions[0].textContent).toBe('Again');
	});

	it('empties the region before repeating the same text so it is read again', () => {
		vi.useFakeTimers();
		announce('Same');
		vi.advanceTimersByTime(60);
		announce('Same');
		expect(document.getElementById('app-announcer').textContent).toBe('');
		vi.advanceTimersByTime(60);
		expect(document.getElementById('app-announcer').textContent).toBe('Same');
	});
});

describe('announce, assertive', () => {
	it('writes an assertive message into one alert region, apart from the polite one', () => {
		vi.useFakeTimers();
		announce('Polite news');
		announce('Something failed', { assertive: true });
		vi.advanceTimersByTime(60);
		const alerts = document.querySelectorAll('[role="alert"][aria-live="assertive"]');
		expect(alerts).toHaveLength(1);
		expect(alerts[0].id).toBe('app-alerts');
		expect(alerts[0].textContent).toBe('Something failed');
		expect(document.getElementById('app-announcer').textContent).toBe('Polite news');
	});
});
