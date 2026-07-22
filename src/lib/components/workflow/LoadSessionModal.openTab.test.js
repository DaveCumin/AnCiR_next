import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';

// The modal is shared by callers that want different opening tabs (StartScreen uses ONE instance
// for both "Load session" → file and "Browse all 19" → examples). `initialSourceMode` therefore
// has to be resolved when the modal OPENS, not when it closes: a caller sets the mode and opens in
// the same tick, so resolving on close made the new mode take effect one open too late, and
// "Browse all 19" landed on the file tab.
vi.mock('$lib/components/iconActions/Setting.svelte', () => ({ importJson: vi.fn() }));
vi.mock('$app/paths', () => ({ base: '' }));

import LoadSessionModal from './LoadSessionModal.svelte';

Element.prototype.animate ??= () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });
afterEach(() => cleanup());

const activeTab = () =>
	[...document.querySelectorAll('.tab-btn')].find((b) => b.classList.contains('active'))?.textContent?.trim();

describe('LoadSessionModal opening tab', () => {
	it('opens on the tab the caller asked for', async () => {
		global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ sessions: [] }) }));
		render(LoadSessionModal, { props: { showModal: true, initialSourceMode: 'example' } });
		await waitFor(() => expect(activeTab()).toBe('Examples'));
	});

	it('defaults to the file tab', async () => {
		render(LoadSessionModal, { props: { showModal: true } });
		await waitFor(() => expect(activeTab()).toBe('From file'));
	});

	it('picks up a mode set in the same tick as opening', async () => {
		global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ sessions: [] }) }));
		// Start closed on 'file', then flip BOTH at once, exactly as StartScreen's browse link does.
		const { rerender } = render(LoadSessionModal, {
			props: { showModal: false, initialSourceMode: 'file' }
		});
		await rerender({ showModal: true, initialSourceMode: 'example' });
		await tick();
		await waitFor(() => expect(activeTab()).toBe('Examples'));
	});
});
