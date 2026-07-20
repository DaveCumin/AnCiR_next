import { describe, it, expect } from 'vitest';
import { correlationGrid } from './correlationGrid.js';

describe('correlationGrid', () => {
	// a, b=2a (r=+1), c=-a (r=-1)
	const cols = [
		[1, 2, 3, 4, 5],
		[2, 4, 6, 8, 10],
		[5, 4, 3, 2, 1]
	];
	const names = ['a', 'b', 'c'];

	it('builds a symmetric N×N r matrix with 1 on the diagonal', () => {
		const g = correlationGrid(cols, names, 'pearson');
		expect(g.labels).toEqual(['a', 'b', 'c']);
		const at = (i, j) => g.r[g.labels.indexOf(i)][g.labels.indexOf(j)];
		expect(at('a', 'a')).toBe(1);
		expect(at('a', 'b')).toBeCloseTo(1, 9);
		expect(at('b', 'a')).toBeCloseTo(1, 9); // symmetric
		expect(at('a', 'c')).toBeCloseTo(-1, 9);
	});

	it('carries a p-value matrix (NaN on the diagonal — no self-test)', () => {
		const g = correlationGrid(cols, names, 'pearson');
		expect(g.p).toHaveLength(3);
		expect(Number.isNaN(g.p[0][0])).toBe(true); // diagonal p is not defined
		expect(g.p[0][1]).toBeGreaterThanOrEqual(0);
		expect(g.p[0][1]).toBeLessThanOrEqual(1);
		expect(g.p[0][1]).toBeCloseTo(g.p[1][0], 12); // symmetric
	});

	it('honours the method (Spearman on a monotonic-nonlinear pair)', () => {
		const x = [1, 2, 3, 4, 5];
		const y = x.map((v) => v ** 3);
		const g = correlationGrid([x, y], ['x', 'y'], 'spearman');
		expect(g.r[0][1]).toBeCloseTo(1, 9); // perfect rank correlation
	});

	it('falls back to index labels and is empty-safe', () => {
		expect(correlationGrid([[1, 2, 3]], null, 'pearson').labels).toEqual(['0']);
		expect(correlationGrid([], null, 'pearson')).toEqual({ labels: [], r: [], p: [] });
		expect(correlationGrid(null, null, 'pearson')).toEqual({ labels: [], r: [], p: [] });
	});

	it('a zero-variance column yields NaN r for its off-diagonal pairs', () => {
		const g = correlationGrid([[1, 1, 1, 1], [1, 2, 3, 4]], ['flat', 'ramp'], 'pearson');
		expect(Number.isNaN(g.r[0][1])).toBe(true);
		expect(g.r[0][0]).toBe(1); // its own diagonal is still 1
	});
});
