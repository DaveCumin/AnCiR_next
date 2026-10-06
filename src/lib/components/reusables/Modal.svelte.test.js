/**
 * ROB-25: Escape closes a native <dialog> without going through Modal's own close(),
 * so the `onclose` prop never ran (AiPrompt kept a pasted API key in memory, the import
 * modal left appState.importModalOpen set, SavePlot never restored focus). The dialog's
 * own close event now runs it, and the button/backdrop path still runs it exactly once.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import Modal from './Modal.svelte';

// happy-dom has no Web Animations; the fade transitions only need a stub.
Element.prototype.animate ??= () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });

afterEach(() => cleanup());

/** Let the dialog's queued close event and Svelte's effects settle. */
async function settle() {
	await new Promise((r) => setTimeout(r, 0));
	await tick();
}

async function openModal() {
	const onclose = vi.fn();
	const { container } = render(Modal, { props: { showModal: true, onclose } });
	await settle();
	const dialog = container.ownerDocument.querySelector('dialog');
	expect(dialog?.open).toBe(true);
	return { onclose, dialog };
}

describe('Modal onclose', () => {
	it('runs when the browser closes the dialog itself (Escape)', async () => {
		const { onclose, dialog } = await openModal();
		// What Escape does: the browser closes the dialog directly and fires `close`,
		// without any click reaching the component.
		dialog.close();
		await settle();
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('runs once, not twice, from the close button', async () => {
		const { onclose, dialog } = await openModal();
		dialog.querySelector('button[aria-label="Close"]').click();
		await settle();
		expect(dialog.open).toBe(false);
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('runs once, not twice, from a click on the backdrop', async () => {
		const { onclose, dialog } = await openModal();
		dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await settle();
		expect(dialog.open).toBe(false);
		expect(onclose).toHaveBeenCalledTimes(1);
	});
});
