// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import Editable from './Editable.svelte';

// Node titles and output-row names render in Editable's span. A name too long for its
// slot ends in an ellipsis (the span clips itself: the parent's text-overflow cannot
// ellipsize an inline-block), and the hover title then leads with the full name.
function spanWith(value, { scrollWidth, clientWidth }) {
	const { container } = render(Editable, { props: { value, title: 'Double-click to rename' } });
	const span = container.querySelector('.editable-span');
	Object.defineProperty(span, 'scrollWidth', { value: scrollWidth, configurable: true });
	Object.defineProperty(span, 'clientWidth', { value: clientWidth, configurable: true });
	return span;
}

describe('Editable truncation tooltip', () => {
	it('keeps the plain hint when the name fits', async () => {
		const span = spanWith('hour', { scrollWidth: 31, clientWidth: 31 });
		await fireEvent.pointerEnter(span);
		flushSync();
		expect(span.getAttribute('title')).toBe('Double-click to rename');
	});

	it('leads with the full name when it is ellipsized', async () => {
		const name = 'Rhythmicity Analysis — periodogram';
		const span = spanWith(name, { scrollWidth: 220, clientWidth: 177 });
		await fireEvent.pointerEnter(span);
		flushSync();
		expect(span.getAttribute('title')).toBe(`${name}\nDouble-click to rename`);
	});
});
