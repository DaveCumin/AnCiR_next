/**
 * TypeSelector's menu used to sit inside `{#if open}` with no `open` declared, so the name
 * resolved to the global `window.open` (always truthy) and the guard did nothing. These pin
 * the real behaviour: closed until the type button is pressed, every option named, choosing
 * one reports it and closes the menu.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import TypeSelector from './TypeSelector.svelte';

afterEach(() => cleanup());

describe('TypeSelector', () => {
	it('shows no menu until the type button is pressed', async () => {
		const { container } = render(TypeSelector, { props: { value: 'number' } });
		expect(container.querySelector('dialog')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: /Type: Number/ }));
		expect(container.querySelector('dialog')).not.toBeNull();
	});

	it('names every option and reports the chosen type, then closes', async () => {
		const onChange = vi.fn();
		const { container } = render(TypeSelector, { props: { value: 'number', onChange } });
		await fireEvent.click(screen.getByRole('button', { name: /Type: Number/ }));
		for (const name of ['Time', 'Number', 'Category']) {
			expect(screen.getByRole('button', { name })).toBeTruthy();
		}
		await fireEvent.click(screen.getByRole('button', { name: 'Category' }));
		expect(onChange).toHaveBeenCalledWith('category');
		expect(container.querySelector('dialog')).toBeNull();
		expect(screen.getByRole('button', { name: /Type: Category/ })).toBeTruthy();
	});

	it('does not throw for a type it has no icon for', () => {
		expect(() => render(TypeSelector, { props: { value: 'mystery' } })).not.toThrow();
		expect(screen.getByRole('button', { name: /Type: mystery/ })).toBeTruthy();
	});
});
