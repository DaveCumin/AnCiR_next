import { describe, it, expect } from 'vitest';
import { clientToCanvasPoint } from './canvasCoords.js';

const view = (over = {}) => ({
	rect: { left: 56, top: 0 },
	scale: 1,
	offset: { x: 0, y: 0 },
	...over
});

describe('clientToCanvasPoint', () => {
	it('subtracts the viewport origin', () => {
		expect(clientToCanvasPoint(156, 40, view())).toEqual({ x: 100, y: 40 });
	});

	it('subtracts the pan offset', () => {
		expect(clientToCanvasPoint(156, 40, view({ offset: { x: 30, y: 10 } }))).toEqual({
			x: 70,
			y: 30
		});
	});

	it('divides by the zoom scale', () => {
		expect(clientToCanvasPoint(256, 100, view({ scale: 2 }))).toEqual({ x: 100, y: 50 });
	});

	it('returns NEGATIVE coordinates left of / above the origin — the canvas is infinite', () => {
		const p = clientToCanvasPoint(6, -40, view());
		expect(p.x).toBe(-50);
		expect(p.y).toBe(-40);
	});

	it('keeps a point fixed under the cursor when the canvas pans', () => {
		// Same cursor, canvas panned right by 200: the canvas point under the
		// cursor must shift left by exactly 200.
		const before = clientToCanvasPoint(400, 300, view());
		const after = clientToCanvasPoint(400, 300, view({ offset: { x: 200, y: 0 } }));
		expect(before.x - after.x).toBe(200);
	});

	it('treats a missing rect/offset as the origin', () => {
		expect(clientToCanvasPoint(10, 20, {})).toEqual({ x: 10, y: 20 });
	});

	it('treats a zero or absent scale as unzoomed rather than dividing to Infinity', () => {
		expect(clientToCanvasPoint(10, 20, view({ scale: 0 }))).toEqual({ x: -46, y: 20 });
		expect(clientToCanvasPoint(10, 20, view({ scale: undefined }))).toEqual({ x: -46, y: 20 });
	});
});
