// The shared Data-tab "add series" row: an in-flow labelled title row with an
// accessible + button (replaces the old viewport-pinned + button).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import DataAddHeader from './DataAddHeader.svelte';

describe('DataAddHeader', () => {
	afterEach(() => cleanup());

	it('renders the default label and aria-label', () => {
		const { getByText, getByRole } = render(DataAddHeader, { props: { onadd: () => {} } });
		expect(getByText('Series')).toBeTruthy();
		expect(getByRole('button', { name: 'Add a series' })).toBeTruthy();
	});

	it('renders a custom label and aria-label', () => {
		const { getByText, getByRole } = render(DataAddHeader, {
			props: { label: 'Variables', ariaLabel: 'Add a variable', onadd: () => {} }
		});
		expect(getByText('Variables')).toBeTruthy();
		expect(getByRole('button', { name: 'Add a variable' })).toBeTruthy();
	});

	it('calls onadd once per click', async () => {
		const onadd = vi.fn();
		const { getByRole } = render(DataAddHeader, { props: { onadd } });
		await fireEvent.click(getByRole('button', { name: 'Add a series' }));
		expect(onadd).toHaveBeenCalledTimes(1);
	});

	it('is in normal flow (not the old fixed-position wrapper alone)', () => {
		const { container } = render(DataAddHeader, { props: { onadd: () => {} } });
		const row = container.querySelector('.control-data-add');
		expect(row).toBeTruthy();
		expect(row.classList.contains('control-data-title')).toBe(true);
	});
});
