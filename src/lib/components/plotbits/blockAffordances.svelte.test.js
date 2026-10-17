// UI-12 (2026-10-03 review): add / remove / show-hide affordances differed block to block
// (a bare + in a title, a full-width + under a list, a labelled row on Overlays; the trash
// before the eye on one plot and after it on another), and the actogram's overlays were spread
// over three tabs. One add row (BlockAdd), one row-action order, one Overlays tab.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import BlockAdd from './BlockAdd.svelte';
import SeriesBlockHeader from './SeriesBlockHeader.svelte';

afterEach(() => cleanup());

describe('BlockAdd', () => {
	it('shows the one-line empty state only while the list is empty', () => {
		const props = { actions: [{ label: 'Add band', onadd: () => {} }], empty: 'No bands yet' };
		const empty = render(BlockAdd, { props: { ...props, count: 0 } }).container;
		expect(empty.querySelector('.block-empty')?.textContent).toBe('No bands yet');
		cleanup();
		const one = render(BlockAdd, { props: { ...props, count: 1 } }).container;
		expect(one.querySelector('.block-empty')).toBeNull();
	});

	it('renders one labelled .btn-add per action, in order, each calling its own handler', async () => {
		const a = vi.fn();
		const b = vi.fn();
		const { container } = render(BlockAdd, {
			props: {
				actions: [
					{ label: 'Add line', onadd: a, tooltip: 'Add a reference line' },
					{ label: 'Add band', onadd: b, ariaLabel: 'Add a shaded band' }
				]
			}
		});
		const buttons = [...container.querySelectorAll('button.btn-add')];
		expect(buttons.map((x) => x.textContent.trim())).toEqual(['+ Add line', '+ Add band']);
		expect(buttons[0].getAttribute('title')).toBe('Add a reference line');
		expect(buttons[1].getAttribute('aria-label')).toBe('Add a shaded band');
		await fireEvent.click(buttons[1]);
		expect(b).toHaveBeenCalledTimes(1);
		expect(a).not.toHaveBeenCalled();
	});
});

describe('SeriesBlockHeader row actions', () => {
	it('come in the fixed order: show/hide, colour, delete last', () => {
		const inner = { parentBox: null, data: [{ label: '', y: { refId: -1, name: 'y' } }] };
		const icons = createRawSnippet(() => ({ render: () => '<button data-act="eye">eye</button>' }));
		const swatch = createRawSnippet(() => ({
			render: () => '<span data-act="colour">colour</span>'
		}));
		const { container } = render(SeriesBlockHeader, {
			props: { inner, datum: inner.data[0], index: 0, icons, swatch }
		});
		const row = container.querySelector('.series-block-icons');
		const order = [...row.children].map(
			(el) => el.getAttribute('data-act') ?? (el.querySelector('svg') ? 'delete' : el.tagName)
		);
		expect(order).toEqual(['eye', 'colour', 'delete']);
		// The colour is a row action now, not a lead-in to the title.
		expect(container.querySelector('.series-block-identity [data-act="colour"]')).toBeNull();
	});
});
