import { describe, it, expect } from 'vitest';
import { separatorKeyValue, SEPARATOR_STEP, SEPARATOR_BIG_STEP } from './separatorKeys.js';

const at = (key, extra = {}) => ({ key, ...extra });
const opts = { value: 250, min: 200, max: 500 };

describe('separatorKeyValue', () => {
	it('steps with the arrows, growing to the right by default', () => {
		expect(separatorKeyValue(at('ArrowRight'), opts)).toBe(250 + SEPARATOR_STEP);
		expect(separatorKeyValue(at('ArrowLeft'), opts)).toBe(250 - SEPARATOR_STEP);
	});

	it('takes a big step with Shift', () => {
		expect(separatorKeyValue(at('ArrowRight', { shiftKey: true }), opts)).toBe(
			250 + SEPARATOR_BIG_STEP
		);
	});

	it('reverses the arrows for a pane that grows to the left', () => {
		const left = { ...opts, grow: 'left' };
		expect(separatorKeyValue(at('ArrowLeft'), left)).toBe(260);
		expect(separatorKeyValue(at('ArrowRight'), left)).toBe(240);
	});

	it('clamps to the range', () => {
		expect(separatorKeyValue(at('ArrowLeft', { shiftKey: true }), { ...opts, value: 220 })).toBe(
			200
		);
		expect(separatorKeyValue(at('ArrowRight'), { ...opts, value: 495 })).toBe(500);
	});

	it('goes to the ends with Home and End', () => {
		expect(separatorKeyValue(at('Home'), opts)).toBe(200);
		expect(separatorKeyValue(at('End'), opts)).toBe(500);
	});

	it('restores the default with Enter only where there is one', () => {
		expect(separatorKeyValue(at('Enter'), opts)).toBeNull();
		expect(separatorKeyValue(at('Enter'), { ...opts, value: 400, defaultValue: 250 })).toBe(250);
	});

	it('lets other keys and modified keys through', () => {
		expect(separatorKeyValue(at('Tab'), opts)).toBeNull();
		expect(separatorKeyValue(at('ArrowUp'), opts)).toBeNull();
		expect(separatorKeyValue(at('ArrowRight', { altKey: true }), opts)).toBeNull();
		expect(separatorKeyValue(at('ArrowRight', { metaKey: true }), opts)).toBeNull();
	});
});
