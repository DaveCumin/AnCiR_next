// NumberWithUnits shows the stored value, not the value rounded to its own step.
//
// THE BUG: display precision followed the `step` attribute. A step of 1e-7 stringifies as
// "1e-7" (no decimal point), so it got 0 decimals and a stored 1e-7 showed as "0"; a value
// finer than a coarse step (0.0001 with step 0.1) showed as "0" too.
//
// THE FOLLOW-UP: showing 12 significant digits everywhere made computed values noisy (an
// automatic axis limit read "-1.66034981338"). Now a box being READ shows a tidy value
// (6 significant digits, at least the step's decimals, small values keep their leading
// digits, whole-number digits never dropped) and a box being EDITED shows the full stored
// value (12 significant digits, no float noise). The stored value is never touched.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import NumberWithUnits from './NumberWithUnits.svelte';
import { displayNumber, readableNumber, stepDecimals } from './numberDisplay.js';

afterEach(() => cleanup());

async function shown(props) {
	const { container } = render(NumberWithUnits, { props });
	await tick();
	return container.querySelector('input');
}

async function focus(input) {
	await fireEvent.focus(input);
	await tick();
}

async function blur(input) {
	await fireEvent.blur(input);
	await tick();
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

describe('stepDecimals', () => {
	it('counts decimals in plain and exponent forms', () => {
		expect(stepDecimals(1)).toBe(0);
		expect(stepDecimals('0.01')).toBe(2);
		expect(stepDecimals(1e-7)).toBe(7);
		expect(stepDecimals(0.0025)).toBe(4);
		expect(stepDecimals(10)).toBe(0);
		expect(stepDecimals('any')).toBe(0);
	});
});

describe('readableNumber', () => {
	it('tidies a computed value to 6 significant digits', () => {
		expect(readableNumber(-1.66034981338, '0.01')).toBe(-1.66035);
		expect(readableNumber(1 / 3, '0.01')).toBe(0.333333);
		expect(readableNumber(0.1 + 0.2, '0.1')).toBe(0.3);
	});

	it('keeps a small value whatever the step', () => {
		expect(readableNumber(1e-7, '0.01')).toBe(1e-7);
		expect(readableNumber(1e-7, 1)).toBe(1e-7);
		expect(readableNumber(-2.345678e-9, 1)).toBe(-2.34568e-9);
		expect(readableNumber(1e-200, 1)).toBe(1e-200);
	});

	it('keeps integers and never drops whole-number digits', () => {
		expect(readableNumber(42, '0.01')).toBe(42);
		expect(readableNumber(-7, 1)).toBe(-7);
		expect(readableNumber(1234567.89, 1)).toBe(1234568);
		expect(readableNumber(1e21 + 0.5, 1)).toBe(1e21);
	});

	it('shows every digit the step can change', () => {
		expect(readableNumber(1234567.89, '0.01')).toBe(1234567.89);
		expect(readableNumber(0.123456789, 1e-8)).toBe(0.12345679);
	});

	it('passes non-finite values through', () => {
		expect(readableNumber(NaN)).toBeNaN();
		expect(readableNumber(-Infinity)).toBe(-Infinity);
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
		expect(third.value).toBe('0.333333');
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

	it('reads tidy, edits full, and reads tidy again after editing', async () => {
		const onInput = vi.fn();
		const input = await shown({ value: -1.66034981338, step: '0.01', onInput });
		expect(input.value).toBe('-1.66035');
		await focus(input);
		expect(input.value).toBe('-1.66034981338');
		await blur(input);
		expect(input.value).toBe('-1.66035');
		expect(onInput).not.toHaveBeenCalled(); // neither form was written back
	});

	it('shows each case in both states', async () => {
		const cases = [
			// [stored, step, reading, editing]
			[1e-7, '0.01', '1e-7', '1e-7'],
			[0.1 + 0.2, '0.1', '0.3', '0.3'],
			[1 / 3, '0.01', '0.333333', '0.333333333333'],
			[42, 1, '42', '42'],
			[1234567.89, 1, '1234568', '1234567.89']
		];
		for (const [value, step, reading, editing] of cases) {
			const input = await shown({ value, step });
			expect(input.value, `reading ${value}`).toBe(reading);
			await focus(input);
			expect(input.value, `editing ${value}`).toBe(editing);
			await blur(input);
			cleanup();
		}
	});

	it('typing while focused stores what was typed and the box keeps it', async () => {
		const onInput = vi.fn();
		const input = await shown({ value: 1, step: '0.01', onInput });
		await focus(input);
		await fireEvent.input(input, { target: { value: '2.123456789' } });
		await tick();
		expect(onInput).toHaveBeenLastCalledWith(2.123456789);
		expect(input.value).toBe('2.123456789');
		await blur(input);
		expect(input.value).toBe('2.12346');
		expect(onInput).toHaveBeenCalledTimes(1);
	});
});

// Typing a number that passes through a non-number on the way (a negative, a decimal, an
// exponent) from an empty box.
//
// THE BUG: a number input reports a partial entry ("-", "-.", "1e") as an empty value, and
// clearing the box is an empty value too. The component stored `"" * 1 = 0` and wrote "0"
// back into the box, so "-1.23" could not be typed into a cleared box: the "-" became "0",
// and the next keys were appended to it ("0-1.23", itself not a number).
//
// THE RULE: an empty or partial entry is "no change yet": nothing is stored and the box is
// left alone. A valid number is stored as it is typed (the preview). When the box is left
// (blur) or Enter is pressed with nothing valid in it, a `nullable` field stores null (an axis
// limit: back to automatic); any other field goes back to the value it had. Escape puts the
// box back to the stored value.
//
// jsdom applies the same value sanitisation as Chromium: setting "-" on a number input reads
// back as "", so these tests see exactly what the browser reports.
describe('NumberWithUnits partial entries', () => {
	async function editing(props) {
		const onInput = vi.fn();
		const input = await shown({ step: '0.1', ...props, onInput });
		await focus(input);
		return { input, onInput };
	}
	async function typeValue(input, text) {
		await fireEvent.input(input, { target: { value: text } });
		await tick();
	}

	for (const partial of ['', '-', '-.', '1e', '.']) {
		it(`"${partial}" stores nothing and leaves the box as typed`, async () => {
			const { input, onInput } = await editing({ value: -0.955752 });
			await typeValue(input, partial);
			expect(onInput).not.toHaveBeenCalled();
			// What the browser reports for it ("" in Chromium; jsdom keeps "1e"), never a "0"
			// written over the entry.
			expect(['', partial]).toContain(input.value);
		});
	}

	it('"-1.23" can be typed into a cleared box, one key at a time', async () => {
		const { input, onInput } = await editing({ value: -0.955752 });
		for (const text of ['', '-', '-1', '-1.', '-1.2', '-1.23']) await typeValue(input, text);
		expect(onInput).toHaveBeenLastCalledWith(-1.23);
		expect(onInput.mock.calls.map((c) => c[0])).not.toContain(0);
		expect(input.value).toBe('-1.23');
	});

	it('a valid number still stores as it is typed (the preview)', async () => {
		const { input, onInput } = await editing({ value: 5 });
		await typeValue(input, '-1');
		expect(onInput).toHaveBeenLastCalledWith(-1);
		expect(input.value).toBe('-1');
	});

	it('blur with an empty box: a nullable field stores null (automatic)', async () => {
		const { input, onInput } = await editing({ value: -0.955752, nullable: true });
		await typeValue(input, '');
		await blur(input);
		expect(onInput).toHaveBeenCalledTimes(1);
		expect(onInput).toHaveBeenLastCalledWith(null);
		// The box shows what the caller passes back for "automatic", not a "0" or a blank.
		await tick();
		expect(input.value).toBe('-0.955752');
	});

	it('a nullable empty box stores null at `change`, which the browser sends before blur', async () => {
		// The plot panel records the step at `change`; a null stored only at blur would land
		// outside the history.
		const { input, onInput } = await editing({ value: 4, nullable: true });
		await typeValue(input, '');
		await fireEvent.change(input);
		expect(onInput).toHaveBeenLastCalledWith(null);
		await blur(input);
		expect(onInput).toHaveBeenCalledTimes(1);
	});

	it('blur with a partial entry: any other field goes back to its value', async () => {
		const { input, onInput } = await editing({ value: 12 });
		await typeValue(input, '-');
		await blur(input);
		expect(onInput).not.toHaveBeenCalled();
		expect(input.value).toBe('12');
	});

	it('Enter with an empty box commits like blur', async () => {
		const nullable = await editing({ value: 3, nullable: true });
		await typeValue(nullable.input, '');
		await fireEvent.keyDown(nullable.input, { key: 'Enter' });
		await tick();
		expect(nullable.onInput).toHaveBeenLastCalledWith(null);
		cleanup();

		const plain = await editing({ value: 3 });
		await typeValue(plain.input, '');
		await fireEvent.keyDown(plain.input, { key: 'Enter' });
		await tick();
		expect(plain.onInput).not.toHaveBeenCalled();
		expect(plain.input.value).toBe('3');
	});

	it('Escape puts a partial entry back to the stored value', async () => {
		const { input, onInput } = await editing({ value: -0.964285714286 });
		await typeValue(input, '-');
		await fireEvent.keyDown(input, { key: 'Escape' });
		await tick();
		await tick();
		expect(onInput).not.toHaveBeenCalled();
		expect(input.value).toBe('-0.964285714286');
		// Leaving the box afterwards stores nothing either.
		await blur(input);
		expect(onInput).not.toHaveBeenCalled();
	});

	it('blur after an Escape stores nothing even for a nullable field', async () => {
		const { input, onInput } = await editing({ value: 2, nullable: true });
		await typeValue(input, '');
		await fireEvent.keyDown(input, { key: 'Escape' });
		await tick();
		await blur(input);
		expect(onInput).not.toHaveBeenCalled();
		expect(input.value).toBe('2');
	});

	it('focus then blur with no typing stores nothing', async () => {
		const { input, onInput } = await editing({ value: 2, nullable: true });
		await blur(input);
		expect(onInput).not.toHaveBeenCalled();
		expect(input.value).toBe('2');
	});
});
