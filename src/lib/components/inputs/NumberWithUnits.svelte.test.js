// NumberWithUnits shows the stored value, not the value rounded to its own step.
//
// THE BUG: display precision followed the `step` attribute. A step of 1e-7 stringifies as
// "1e-7" (no decimal point), so it got 0 decimals and a stored 1e-7 showed as "0"; a value
// finer than a coarse step (0.0001 with step 0.1) showed as "0" too. The display now keeps
// 12 significant digits of whatever is stored, which also drops binary float noise
// (0.1 + 0.2 shows 0.3, not 0.30000000000000004). The stored value is never touched.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import NumberWithUnits from './NumberWithUnits.svelte';
import { displayNumber } from './numberDisplay.js';

afterEach(() => cleanup());

async function shown(props) {
	const { container } = render(NumberWithUnits, { props });
	await tick();
	return container.querySelector('input');
}

describe('displayNumber', () => {
	it('keeps tiny and fine values', () => {
		expect(displayNumber(1e-7)).toBe(1e-7);
		expect(displayNumber(0.0001)).toBe(0.0001);
		expect(displayNumber(-2.5e-9)).toBe(-2.5e-9);
		expect(displayNumber(123456.789)).toBe(123456.789);
	});

	it('drops binary float noise', () => {
		expect(displayNumber(0.1 + 0.2)).toBe(0.3);
		expect(displayNumber(1.1 * 3)).toBe(3.3);
		expect(displayNumber((1 / 60) * 60 * 60)).toBe(60);
	});

	it('passes non-finite values through', () => {
		expect(displayNumber(NaN)).toBeNaN();
		expect(displayNumber(Infinity)).toBe(Infinity);
	});
});

describe('NumberWithUnits display', () => {
	it('shows a 1e-7 value with a 1e-7 step instead of 0', async () => {
		const input = await shown({ value: 1e-7, step: 1e-7 });
		expect(Number(input.value)).toBe(1e-7);
	});

	it('shows a value finer than its step', async () => {
		const input = await shown({ value: 0.0001, step: '0.1' });
		expect(Number(input.value)).toBe(0.0001);
		const third = await shown({ value: 1 / 3, step: '0.01' });
		expect(Number(third.value)).toBeCloseTo(1 / 3, 11);
	});

	it('shows no float noise', async () => {
		const input = await shown({ value: 0.1 + 0.2, step: '0.1' });
		expect(input.value).toBe('0.3');
	});

	it('shows a whole-number step value as before', async () => {
		const input = await shown({ value: 42, step: 1 });
		expect(input.value).toBe('42');
	});

	it('converts to the chosen unit without noise', async () => {
		const units = { default: 'hr', days: 24, hr: 1, min: 1 / 60 };
		const input = await shown({ value: 1, step: '0.01', units, selectedUnitStart: 'min' });
		expect(input.value).toBe('60');
	});

	it('typing still stores exactly what was typed and leaves the stored value alone', async () => {
		const onInput = vi.fn();
		const input = await shown({ value: 1e-7, step: 1e-7, onInput });
		expect(onInput).not.toHaveBeenCalled(); // rendering wrote nothing back
		await fireEvent.input(input, { target: { value: '0.000002' } });
		expect(onInput).toHaveBeenLastCalledWith(0.000002);
	});
});
