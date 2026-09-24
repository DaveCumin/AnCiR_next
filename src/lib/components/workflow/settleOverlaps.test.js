// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { settleBoxes } from './settleOverlaps.js';

const box = (id, x, y, w = 160, h = 100) => ({ id, x, y, w, h });

describe('settleBoxes', () => {
	it('moves nothing when nothing overlaps', () => {
		const moves = settleBoxes([box('a', 0, 0), box('b', 0, 200), box('c', 300, 0)]);
		expect(moves.size).toBe(0);
	});

	it('pushes an overlapped node just below the one above it', () => {
		// The CWT demo: two 208 px data nodes auto-placed 72 px apart.
		const moves = settleBoxes([box('hour', 50, 50, 160, 208), box('activity', 50, 122, 160, 208)]);
		expect([...moves]).toEqual([['activity', 50 + 208 + 24]]);
	});

	it('cascades down a column in order, and leaves other columns alone', () => {
		const moves = settleBoxes([
			box('a', 0, 0, 160, 300),
			box('b', 0, 200),
			box('c', 0, 350),
			box('side', 400, 10)
		]);
		expect(moves.get('b')).toBe(324);
		expect(moves.get('c')).toBe(324 + 100 + 24);
		expect(moves.has('side')).toBe(false);
		expect(moves.has('a')).toBe(false);
	});

	it('leaves group members where they are', () => {
		const frames = [{ x: 0, y: 0, w: 400, h: 400 }];
		const moves = settleBoxes([box('m1', 20, 20), box('m2', 20, 60)], frames);
		expect(moves.size).toBe(0);
	});

	it('only moves down, so a node above is never displaced', () => {
		const moves = settleBoxes([box('low', 0, 50), box('high', 0, 0)]);
		expect([...moves.keys()]).toEqual(['low']);
	});
});
