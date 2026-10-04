// @ts-nocheck
// ROB-12: the only <svelte:boundary> was EmbeddedPlot's single-plot branch, so one node,
// workspace card, facet panel or hidden compute instance that threw while rendering unmounted
// everything above it. ErrorBoundary is the per-piece containment now used for each of those.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import BoundaryHarness from './__fixtures__/BoundaryHarness.svelte';
import { notifications } from '$lib/core/notifications.svelte.js';

beforeEach(() => {
	notifications.list.length = 0;
	vi.spyOn(console, 'error').mockImplementation(() => {});
	globalThis.fetch = () => Promise.resolve(new Response('{}'));
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
	it('contains a failing piece: it shows why, its sibling still renders, one toast says contained', () => {
		const a = { fail: true };
		const b = { fail: false };
		const { getByRole, getByTestId, queryByTestId } = render(BoundaryHarness, { props: { a, b } });

		const box = getByRole('alert');
		expect(box.textContent).toMatch(/A couldn't be drawn/);
		expect(box.textContent).toMatch(/A broke/);
		expect(queryByTestId('A')).toBeNull();
		expect(getByTestId('B').textContent).toBe('B ok');

		const toast = notifications.list.find((n) => n.type === 'error');
		expect(toast.message).toMatch(/while drawing A/);
		expect(toast.message).toMatch(/It was contained/);
	});

	it('Try again re-mounts the content, which recovers once the cause is gone', async () => {
		const a = { fail: true };
		const { getByRole, getByTestId, queryByRole } = render(BoundaryHarness, {
			props: { a, b: { fail: false } }
		});
		a.fail = false;
		await fireEvent.click(getByRole('button', { name: 'Try again' }));
		await tick();
		expect(queryByRole('alert')).toBeNull();
		expect(getByTestId('A').textContent).toBe('A ok');
	});
});
