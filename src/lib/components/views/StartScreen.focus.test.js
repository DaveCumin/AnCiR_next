// UI-6: the start screen says aria-modal, so it must behave like a modal for the keyboard: focus
// moves in when it opens, Tab and Shift+Tab stay inside, Escape closes it (unless something on top
// owns Escape), and focus goes back to where it was when it closes. The trap itself is unit-tested
// in utils/focusTrap.test.js; this checks the screen is wired to it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';

vi.mock('$lib/start/startActions.js', () => ({
	openExample: vi.fn(async () => {}),
	displayName: (n) => n ?? '',
	openSessionFile: vi.fn(async () => {}),
	pickSessionFile: vi.fn(async () => ({ status: 'unsupported' })),
	loadExampleManifest: vi.fn(async () => []),
	notifyFailure: vi.fn()
}));
vi.mock('$lib/core/dataSourceActions.js', () => ({
	openImportData: vi.fn(),
	openImportDataFiles: vi.fn()
}));
vi.mock('$lib/core/tourRunner.svelte.js', () => ({ openPicker: vi.fn() }));

import StartScreen from './StartScreen.svelte';

Element.prototype.animate ??= () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });

afterEach(() => {
	cleanup();
	document.body.innerHTML = '';
});

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

async function open(props = {}) {
	const opener = document.createElement('button');
	opener.textContent = 'opener';
	document.body.appendChild(opener);
	opener.focus();
	const onDismiss = vi.fn();
	const r = render(StartScreen, { props: { onDismiss, ...props } });
	await tick();
	return { ...r, opener, onDismiss, dialog: screen.getByRole('dialog') };
}

describe('StartScreen focus (UI-6)', () => {
	it('takes focus when it opens', async () => {
		const { dialog } = await open();
		expect(document.activeElement).toBe(dialog);
	});

	it('Tab from the opened screen enters at the first card', async () => {
		await open();
		key('Tab');
		expect(document.activeElement.textContent).toContain('Import data');
	});

	it('Tab from the last control wraps to the first, and Shift+Tab back again', async () => {
		const { dialog } = await open({ summoned: true });
		const items = [...dialog.querySelectorAll('button, input, a[href]')].filter((e) => !e.disabled);
		const first = items[0];
		const last = items[items.length - 1];
		expect(first.getAttribute('data-testid')).toBe('start-close');
		last.focus();
		expect(key('Tab').defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(first);
		expect(key('Tab', true).defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(last);
	});

	it('gives focus back to what had it when the screen closes', async () => {
		const { opener, unmount } = await open();
		expect(document.activeElement).not.toBe(opener);
		unmount();
		expect(document.activeElement).toBe(opener);
	});

	it('Escape closes it', async () => {
		const { onDismiss } = await open();
		key('Escape');
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it('Escape is left to a native modal on top (the replace-session question)', async () => {
		const { onDismiss } = await open({ summoned: true });
		const d = document.createElement('dialog');
		d.setAttribute('open', '');
		document.body.appendChild(d);
		key('Escape');
		expect(onDismiss).not.toHaveBeenCalled();
	});
});
