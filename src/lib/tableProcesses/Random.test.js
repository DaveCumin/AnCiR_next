import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: new Map() } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: vi.fn() }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));

import { random } from './Random.svelte';

// Preview mode: out.result === -1

describe('random', () => {
	it('generates the requested number of values', () => {
		const [result, valid] = random({
			N: 10,
			offset: 0,
			multiply: 1,
			seed: 123,
			distribution: 'uniform',
			out: { result: -1 }
		});
		expect(valid).toBe(true);
		expect(result).toHaveLength(10);
	});

	it('all values are numbers', () => {
		const [result] = random({
			N: 20,
			offset: 0,
			multiply: 10,
			seed: 123,
			distribution: 'uniform',
			out: { result: -1 }
		});
		result.forEach((v) => expect(typeof v).toBe('number'));
	});

	it('values are within [offset, offset + multiply]', () => {
		const offset = 5;
		const multiply = 3;
		const [result] = random({
			N: 100,
			offset,
			multiply,
			seed: 321,
			distribution: 'uniform',
			out: { result: -1 }
		});
		result.forEach((v) => {
			expect(v).toBeGreaterThanOrEqual(offset);
			expect(v).toBeLessThanOrEqual(offset + multiply);
		});
	});

	it('N = 0 returns an empty array', () => {
		const [result, valid] = random({
			N: 0,
			offset: 0,
			multiply: 1,
			seed: 99,
			distribution: 'uniform',
			out: { result: -1 }
		});
		expect(result).toHaveLength(0);
		expect(valid).toBe(false);
	});

	it('same seed and inputs produce the same sequence', () => {
		const args = {
			N: 25,
			offset: 2,
			multiply: 4,
			seed: 98765,
			distribution: 'uniform',
			out: { result: -1 }
		};
		const [r1] = random(args);
		const [r2] = random(args);
		expect(r1).toEqual(r2);
	});

	it('different seeds produce different uniform sequences', () => {
		const base = {
			N: 25,
			offset: 2,
			multiply: 4,
			distribution: 'uniform',
			out: { result: -1 }
		};
		const [r1] = random({ ...base, seed: 100 });
		const [r2] = random({ ...base, seed: 200 });
		expect(r1).not.toEqual(r2);
	});

	it('gaussian distribution returns finite numeric values', () => {
		const [result, valid] = random({
			N: 50,
			offset: 10,
			multiply: 2,
			seed: 345,
			distribution: 'gaussian',
			out: { result: -1 }
		});
		expect(valid).toBe(true);
		result.forEach((v) => expect(Number.isFinite(v)).toBe(true));
	});

	it('exponential distribution respects offset floor', () => {
		const offset = 7;
		const [result, valid] = random({
			N: 50,
			offset,
			multiply: 3,
			seed: 654,
			distribution: 'exponential',
			out: { result: -1 }
		});
		expect(valid).toBe(true);
		result.forEach((v) => {
			expect(v).toBeGreaterThanOrEqual(offset);
			expect(Number.isFinite(v)).toBe(true);
		});
	});
});
