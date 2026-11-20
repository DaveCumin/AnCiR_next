import { describe, it, expect } from 'vitest';
import { menuKeyAction, menuIndex } from './menuKeys.js';

describe('menuKeyAction', () => {
	it('maps the menu keys and ignores the rest', () => {
		expect(menuKeyAction({ key: 'ArrowDown' })).toBe('next');
		expect(menuKeyAction({ key: 'ArrowUp' })).toBe('prev');
		expect(menuKeyAction({ key: 'Home' })).toBe('first');
		expect(menuKeyAction({ key: 'End' })).toBe('last');
		expect(menuKeyAction({ key: 'Escape' })).toBe('close');
		expect(menuKeyAction({ key: 'Tab' })).toBe('leave');
		expect(menuKeyAction({ key: 'Enter' })).toBeNull();
		expect(menuKeyAction({ key: 'a' })).toBeNull();
	});
});

describe('menuIndex', () => {
	it('moves and wraps', () => {
		expect(menuIndex('next', 0, 4)).toBe(1);
		expect(menuIndex('next', 3, 4)).toBe(0);
		expect(menuIndex('prev', 0, 4)).toBe(3);
		expect(menuIndex('prev', 2, 4)).toBe(1);
		expect(menuIndex('first', 2, 4)).toBe(0);
		expect(menuIndex('last', 0, 4)).toBe(3);
	});

	it('starts at an end when nothing in the menu has focus', () => {
		expect(menuIndex('next', -1, 4)).toBe(0);
		expect(menuIndex('prev', -1, 4)).toBe(3);
	});

	it('has nowhere to go in an empty menu', () => {
		expect(menuIndex('next', -1, 0)).toBe(-1);
	});
});
