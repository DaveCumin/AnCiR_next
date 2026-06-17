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

describe('compact node geometry', () => {
	it('1-2 ports per side stay a square', () => {
		expect(compactNodeHeight(1, 1)).toBe(COMPACT_W);
		expect(compactNodeHeight(0, 2)).toBe(COMPACT_W); // 2*18+12 = 48 < 56
	});

	it('grows vertically only when a side has many ports', () => {
		// 3 ports: 3*18+12 = 66 > 56
		expect(compactNodeHeight(2, 3)).toBe(3 * COMPACT_PORT_H + COMPACT_V_PAD);
		// uses the busier side
		expect(compactNodeHeight(5, 1)).toBe(5 * COMPACT_PORT_H + COMPACT_V_PAD);
	});

	it('distributes ports as a centered stack within the body height', () => {
		const h = compactNodeHeight(0, 1); // square, 1 output
		expect(compactPortAnchorY(0, 1, h)).toBe(h / 2); // single port centered
		const h3 = compactNodeHeight(0, 3); // 66
		// 3 ports occupy 3*18=54; top pad = (66-54)/2 = 6; centers at 6+9, 6+27, 6+45
		expect(compactPortAnchorY(0, 3, h3)).toBe(6 + COMPACT_PORT_H / 2);
		expect(compactPortAnchorY(1, 3, h3)).toBe(6 + COMPACT_PORT_H + COMPACT_PORT_H / 2);
		expect(compactPortAnchorY(2, 3, h3)).toBe(6 + 2 * COMPACT_PORT_H + COMPACT_PORT_H / 2);
	});

	it('maps column types to icons with a fallback', () => {
		expect(columnTypeIcon('number')).toBe('math');
		expect(columnTypeIcon('category')).toBe('list');
		expect(columnTypeIcon('time')).toBe('clock');
		expect(columnTypeIcon('bin')).toBe('table');
		expect(columnTypeIcon('weird')).toBe('math');
		expect(columnTypeIcon(undefined)).toBe('math');
	});

	it('exposes the squared kinds set (plots excluded; groups handled separately)', () => {
		expect([...SQUARED_KINDS].sort()).toEqual(['data', 'process', 'tableprocess']);
	});
});
