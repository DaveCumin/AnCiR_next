import { describe, it, expect } from 'vitest';
import {
	orderCategories,
	orderGroupStats,
	numericGroupsWarning,
	MAX_NUMERIC_GROUPS
} from './categoryOrder.js';

describe('orderCategories', () => {
	it('keeps first appearance for text, numeric order for all-number groups', () => {
		expect(orderCategories(['late', 'early', 'control'])).toEqual(['late', 'early', 'control']);
		expect(orderCategories(['10', '2', 1])).toEqual([1, '2', '10']);
		// One text group among numbers: first appearance, not a mixed sort.
		expect(orderCategories(['10', 'ctrl', '2'])).toEqual(['10', 'ctrl', '2']);
		// Blank and infinite are not numbers.
		expect(orderCategories(['2', ' ', '1'])).toEqual(['2', ' ', '1']);
	});
});

describe('orderGroupStats', () => {
	it('puts per-group stats (sorted by meanSemByGroup) back in first-appearance order', () => {
		const stats = [
			{ x: 'control', rows: [4] },
			{ x: 'early', rows: [1, 3] },
			{ x: 'late', rows: [0, 2] }
		];
		expect(orderGroupStats(stats).map((s) => s.x)).toEqual(['late', 'early', 'control']);
		const days = [
			{ x: 1, rows: [3] },
			{ x: 2, rows: [0] }
		];
		expect(orderGroupStats(days)).toBe(days);
	});
});

describe('numericGroupsWarning', () => {
	it('names the column and the count, only past the limit and only for numbers', () => {
		const many = Array.from({ length: MAX_NUMERIC_GROUPS + 1 }, (_, i) => i);
		expect(numericGroupsWarning(many, 'time_h')).toMatch(/^"time_h" is numeric with 25/);
		expect(numericGroupsWarning(many.slice(0, MAX_NUMERIC_GROUPS), 'x')).toBeNull();
		expect(
			numericGroupsWarning(
				many.map((i) => `g${i}`),
				'x'
			)
		).toBeNull();
	});
});
