// UI-6: the tour picker is a modal, so it must act like one for the keyboard: focus moves into
// it on open, Tab and Shift+Tab stay inside, Escape closes it, and focus goes back to where it
// was (or to the Help button, when the menu item that opened it has gone with its menu).
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import TourPicker from './TourPicker.svelte';
import { tourState, openPicker } from '$lib/core/tourRunner.svelte.js';

function key(k, shift = false) {
	const ev = new KeyboardEvent('keydown', {
		key: k,
		shiftKey: shift,
		bubbles: true,
		cancelable: true
	});
	document.activeElement.dispatchEvent(ev);
	return ev;
}

let help;
beforeEach(() => {
	tourState.pickerOpen = false;
	help = document.createElement('button');
	help.setAttribute('data-testid', 'nav-help');
	document.body.appendChild(help);
});
afterEach(() => {
	cleanup();
	tourState.pickerOpen = false;
	document.body.innerHTML = '';
});

async function openFrom(opener) {
	opener.focus();
	render(TourPicker);
	openPicker();
	flushSync();
	await tick();
	return screen.getByRole('dialog', { name: 'Take a tour' });
}

describe('TourPicker focus (UI-6)', () => {
	it('is a labelled modal dialog and takes focus when it opens', async () => {
		const dialog = await openFrom(help);
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		expect(document.activeElement).toBe(dialog);
	});

	it('keeps Tab and Shift+Tab inside the card', { timeout: 15000 }, async () => {
		const dialog = await openFrom(help);
		// Wait for the tour list, so there is more than the close button to cycle through.
		await waitFor(() => expect(dialog.querySelectorAll('.tp-item').length).toBeGreaterThan(0), {
			timeout: 10000
		});
		const items = [...dialog.querySelectorAll('button')];
		const first = items[0];
		const last = items[items.length - 1];
		expect(first.getAttribute('aria-label')).toBe('Close');
		last.focus();
		expect(key('Tab').defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(first);
		expect(key('Tab', true).defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(last);
	});

	it('Escape closes it and gives focus back to the opener', async () => {
		const opener = document.createElement('button');
		document.body.appendChild(opener);
		await openFrom(opener);
		key('Escape');
		flushSync();
		await tick();
		expect(tourState.pickerOpen).toBe(false);
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(document.activeElement).toBe(opener);
	});

	it('Escape stops at the picker, so a start screen underneath does not also close', async () => {
		let reachedWindow = false;
		const onWin = (e) => {
			if (e.key === 'Escape') reachedWindow = true;
		};
		window.addEventListener('keydown', onWin);
		await openFrom(help);
		key('Escape');
		window.removeEventListener('keydown', onWin);
		expect(reachedWindow).toBe(false);
	});

	it('falls back to the Help button when the menu item that opened it has gone', async () => {
		const item = document.createElement('button');
		document.body.appendChild(item);
		await openFrom(item);
		item.remove(); // the Help menu closes as the picker opens
		key('Escape');
		flushSync();
		await tick();
		expect(document.activeElement).toBe(help);
	});
});
