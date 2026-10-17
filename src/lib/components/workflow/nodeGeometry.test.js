import { describe, it, expect } from 'vitest';
import {
	COMPACT_W,
	COMPACT_PORT_H,
	COMPACT_V_PAD,
	SQUARED_KINDS,
	compactNodeHeight,
	compactPortAnchorY,
	columnTypeIcon
} from './nodeGeometry.js';
import * as rows from './nodeRows.js';
import { NODE_ROW_H } from './nodeRows.js';

describe('compact node geometry', () => {
	it("steps ports by one full row (24 px), so a port's 24 x 24 target never reaches the next (WCAG 2.2 SC 2.5.8)", () => {
		expect(COMPACT_PORT_H).toBe(NODE_ROW_H);
		expect(COMPACT_PORT_H).toBeGreaterThanOrEqual(24);
	});

	it('1-2 ports per side stay a square', () => {
		expect(compactNodeHeight(0, 0)).toBe(COMPACT_W);
		expect(compactNodeHeight(1, 1)).toBe(COMPACT_W);
		expect(compactNodeHeight(2, 2)).toBe(COMPACT_W); // 2*24+8 = 56
	});

	it('grows vertically only when a side has more ports than fit the square', () => {
		expect(compactNodeHeight(2, 3)).toBe(3 * COMPACT_PORT_H + COMPACT_V_PAD); // 80
		// uses the busier side
		expect(compactNodeHeight(5, 1)).toBe(5 * COMPACT_PORT_H + COMPACT_V_PAD);
	});

	it('distributes ports as a centred stack, one row apart, inside the body', () => {
		const h = compactNodeHeight(0, 1);
		expect(compactPortAnchorY(0, 1, h)).toBe(h / 2); // single port centred
		const h3 = compactNodeHeight(0, 3); // 80: stack 72, top pad 4
		expect(compactPortAnchorY(0, 3, h3)).toBe(4 + COMPACT_PORT_H / 2);
		expect(compactPortAnchorY(1, 3, h3)).toBe(4 + COMPACT_PORT_H + COMPACT_PORT_H / 2);
		expect(compactPortAnchorY(2, 3, h3)).toBe(4 + 2 * COMPACT_PORT_H + COMPACT_PORT_H / 2);
		// Every port's 24 px target band stays inside the card, for every count.
		for (let n = 1; n <= 8; n++) {
			const hh = compactNodeHeight(n, 0);
			expect(compactPortAnchorY(0, n, hh) - 12).toBeGreaterThanOrEqual(0);
			expect(compactPortAnchorY(n - 1, n, hh) + 12).toBeLessThanOrEqual(hh);
		}
	});

	it('takes its geometry from nodeRows.js (one source with the detailed rows)', () => {
		expect(COMPACT_W).toBe(rows.COMPACT_W);
		expect(compactNodeHeight).toBe(rows.compactNodeHeight);
		expect(compactPortAnchorY).toBe(rows.compactPortAnchorY);
	});

	it('maps column types to icons with a fallback', () => {
		expect(columnTypeIcon('number')).toBe('hash');
		expect(columnTypeIcon('category')).toBe('list');
		expect(columnTypeIcon('time')).toBe('clock');
		expect(columnTypeIcon('bin')).toBe('table');
		expect(columnTypeIcon('weird')).toBe('hash');
		expect(columnTypeIcon(undefined)).toBe('hash');
	});

	it('exposes the squared kinds set (plots excluded; groups handled separately)', () => {
		expect([...SQUARED_KINDS].sort()).toEqual(['data', 'process', 'tableprocess']);
	});
});
