/**
 * AttributeSelect and values that are not in the preset list.
 *
 * `other={true}` exists so a custom entry (a stroke-dasharray, a custom window) can be
 * typed. A value that arrives from a saved session and matches no preset is exactly such
 * an entry, and the control used to render a BLANK select for it: nothing selected, no
 * text field, no way to see what was saved. The correlogram's confidence bounds shipped a
 * '5,5' dash (the vocabulary spells it '5, 5'), so that select was always empty.
 *
 * The rule pinned here: an out-of-vocabulary value is SHOWN (as "Other", with the value in
 * the text field) and is never rewritten behind the user's back.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import AttributeSelect from './AttributeSelect.svelte';
import { STROKE_STYLES } from '$lib/components/plotbits/strokeStyles.js';

afterEach(() => cleanup());

const DISPLAY = ['Solid', 'Dashed', 'Dotted', 'Dashed & Dotted'];

function mount(props) {
	const r = render(AttributeSelect, {
		props: { options: STROKE_STYLES, optionsDisplay: DISPLAY, other: true, ...props }
	});
	return { ...r, select: r.container.querySelector('select') };
}

/** The <option> the <select> is currently showing, by its visible text. */
function selectedText(select) {
	return select.selectedIndex >= 0 ? select.options[select.selectedIndex].textContent : null;
}

describe('AttributeSelect', () => {
	it('shows a preset value as its own option', async () => {
		const { select, container } = mount({ value: '5, 5' });
		await tick();
		expect(select.value).toBe('5, 5');
		expect(selectedText(select)).toBe('Dashed');
		expect(container.querySelector('.other-input')).toBeNull();
	});

	it('shows a value outside the preset list as "Other", with the value in the text field', async () => {
		const { select, container } = mount({ value: '5,5' });
		await tick();
		// The bug: nothing selected at all.
		expect(select.selectedIndex).toBeGreaterThanOrEqual(0);
		expect(selectedText(select)).toBe('Other');
		const custom = container.querySelector('.other-input');
		expect(custom).not.toBeNull();
		expect(custom.value).toBe('5,5');
	});

	it('does not rewrite an out-of-vocabulary value on load', async () => {
		const onChange = vi.fn();
		mount({ value: '5,5', onChange });
		await tick();
		await tick();
		// Nothing is reported back to the consumer, so nothing in the session changes.
		expect(onChange).not.toHaveBeenCalled();
	});

	it('leaves the select blank for an unknown value when there is no "Other" option', async () => {
		const { select, container } = mount({ value: '5,5', other: false });
		await tick();
		expect(container.querySelector('.other-input')).toBeNull();
		expect(select.value).toBe('');
	});

	it('matches a numeric option that has been stringified by the DOM', async () => {
		const { select } = mount({
			options: [0.95, 0.99],
			optionsDisplay: ['95%', '99%'],
			value: '0.95'
		});
		await tick();
		expect(selectedText(select)).toBe('95%');
	});

	it('reports a typed custom value to the consumer', async () => {
		const onChange = vi.fn();
		const { container } = mount({ value: '5,5', onChange });
		await tick();
		const custom = container.querySelector('.other-input');
		await fireEvent.input(custom, { target: { value: '7, 3' } });
		expect(onChange).toHaveBeenCalledWith('7, 3');
	});
});
