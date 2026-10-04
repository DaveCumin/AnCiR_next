// @ts-nocheck
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import MiniDataTable from './MiniDataTable.svelte';
import { core } from '$lib/core/core.svelte.js';

afterEach(() => cleanup());

describe('MiniDataTable', () => {
	it('exports a component', () => {
		expect(MiniDataTable).toBeDefined();
	});

	it('shows a bin centre as start + half the bin WIDTH, not half the step', () => {
		// A BinnedData output with 4 h windows stepping by 1 h (overlapping): starts
		// 0, 1, 2 have centres 2, 3, 4, which is what Column.getData reports and what
		// plots draw. Half the step (0.5, 1.5, 2.5) described no real window.
		const key = 'mini-bin-test';
		core.rawData.set(key, [0, 1, 2]);
		const column = {
			type: 'bin',
			data: key,
			binWidth: 4,
			binStep: 1,
			originTime_ms: null,
			getData: () => [2, 3, 4]
		};
		const { container } = render(MiniDataTable, { props: { column } });
		const text = container.textContent;
		expect(text).toContain('2.00');
		expect(text).toContain('4.00');
		expect(text).not.toContain('0.50');
		expect(text).toContain('±2.00');
		core.rawData.delete(key);
	});

	it('UI-1: never shows a missing time as 1 Jan 1970', () => {
		// The reviewer's Activity column: numbers imported as "time" with format D.M,
		// so every value parsed to NaN. The preview used to format the RAW number 8.4
		// as epoch ms and print "01 Jan 1970 00:00:00".
		const key = 'mini-time-null-test';
		core.rawData.set(key, [8.4, 9.2, 0]);
		const column = {
			type: 'time',
			data: key,
			timeFormat: 'D.M',
			isReferencial: () => false,
			hoursSinceStart: [NaN, NaN, NaN],
			getData: () => [NaN, NaN, NaN]
		};
		const { container } = render(MiniDataTable, { props: { column } });
		const text = container.textContent;
		expect(text).not.toContain('1970');
		expect(text).not.toContain('NaN');
		expect(container.querySelectorAll('.mt-raw')[0].textContent).toBe('-');
		core.rawData.delete(key);
	});

	it('still formats epoch-ms time values as dates', () => {
		const key = 'mini-time-ms-test';
		const ms = Date.UTC(2026, 2, 1, 6, 0, 0);
		core.rawData.set(key, [ms]);
		const column = {
			type: 'time',
			data: key,
			timeFormat: [],
			isReferencial: () => false,
			hoursSinceStart: [0],
			getData: () => [ms]
		};
		const { container } = render(MiniDataTable, { props: { column } });
		expect(container.querySelector('.mt-raw').textContent).toMatch(/Mar 2026/);
		core.rawData.delete(key);
	});
});
