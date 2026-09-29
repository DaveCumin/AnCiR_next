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
});
