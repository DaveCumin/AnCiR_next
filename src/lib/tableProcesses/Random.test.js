import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: new Map() } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: vi.fn() }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));

import { random } from './Random.svelte';

// Preview mode: out.result === -1

describe('random', () => {
	it('generates the requested number of values', () => {
		const [result, valid] = random({ N: 10, offset: 0, multiply: 1, out: { result: -1 } });
		expect(valid).toBe(true);
		expect(result).toHaveLength(10);
	});

	it('all values are numbers', () => {
		const [result] = random({ N: 20, offset: 0, multiply: 10, out: { result: -1 } });
		result.forEach((v) => expect(typeof v).toBe('number'));
	});

	it('values are within [offset, offset + multiply]', () => {
		const offset = 5;
		const multiply = 3;
		const [result] = random({ N: 100, offset, multiply, out: { result: -1 } });
		result.forEach((v) => {
			expect(v).toBeGreaterThanOrEqual(offset);
			expect(v).toBeLessThanOrEqual(offset + multiply);
		});
	});

	it('N = 0 returns an empty array', () => {
		const [result, valid] = random({ N: 0, offset: 0, multiply: 1, out: { result: -1 } });
		expect(result).toHaveLength(0);
		expect(valid).toBe(false);
	});
});
