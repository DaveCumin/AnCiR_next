// The Load session modal's "From file" tab with `.ancir` files: the OS dialog offers them, a
// `.ancir` session loads like a `.json` one, and a `.ancir` that is not a session is refused with
// the open session untouched (the decision is made on the CONTENT, never the extension).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';

// importJson is the real refusal point: it throws NotASessionError on anything that is not
// session-shaped BEFORE touching the open session. Mirror exactly that, and record what loaded.
const { importJson } = vi.hoisted(() => ({ importJson: vi.fn() }));
vi.mock('$lib/components/iconActions/Setting.svelte', () => ({ importJson }));
const { addNotification } = vi.hoisted(() => ({ addNotification: vi.fn() }));
vi.mock('$lib/core/notifications.svelte.js', () => ({ addNotification }));

// happy-dom has no Web Animations; the modal's fade-out runs on cleanup.
Element.prototype.animate ??= () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });

import LoadSessionModal from './LoadSessionModal.svelte';
import { sessionShapeProblem, NotASessionError } from '$lib/core/sessionLoad.svelte.js';
import { core, appState } from '$lib/core/core.svelte.js';

beforeEach(() => {
	importJson.mockReset();
	importJson.mockImplementation(async (json) => {
		const problem = sessionShapeProblem(json);
		if (problem) throw new NotASessionError(problem);
	});
	addNotification.mockClear();
});
afterEach(() => cleanup());

function openModal() {
	const { container } = render(LoadSessionModal, { showModal: true });
	flushSync();
	const input = document.querySelector('input[type="file"]');
	return { container, input };
}

async function pick(input, name, text) {
	const file = new File([text], name, { type: '' });
	Object.defineProperty(input, 'files', { value: [file], configurable: true });
	await fireEvent.change(input);
}

describe('Load session modal: .ancir files', () => {
	it('the file input accepts .json and .ancir', () => {
		const { input } = openModal();
		expect(input).toBeTruthy();
		expect(input.getAttribute('accept')).toBe('.json,.ancir,application/json');
	});

	it('a .ancir session loads through importJson', async () => {
		const { input } = openModal();
		await pick(input, 'Cohort A.ancir', '{"version":"β.79.0","data":[],"plots":[]}');
		await vi.waitFor(() => expect(importJson).toHaveBeenCalledOnce());
		expect(importJson.mock.calls[0][0]).toEqual({ version: 'β.79.0', data: [], plots: [] });
		expect(addNotification).not.toHaveBeenCalled();
	});

	it('a .json session still loads', async () => {
		const { input } = openModal();
		await pick(input, 'Cohort A.json', '{"data":[],"plots":[]}');
		await vi.waitFor(() => expect(importJson).toHaveBeenCalledOnce());
		expect(addNotification).not.toHaveBeenCalled();
	});

	it('a .ancir holding JSON that is not a session is refused before any "replace?" question', async () => {
		// Open work, so a load WOULD have to ask first: the refusal must come before that.
		core.notes = [{ id: 'note_1', text: 'unsaved' }];
		appState.showAYSModal = false;
		try {
			const { input } = openModal();
			await pick(input, 'data.ancir', '[1, 2, 3]');
			await vi.waitFor(() => expect(addNotification).toHaveBeenCalledOnce());
			const msg = addNotification.mock.calls[0][0];
			expect(msg).toContain('not an AnCiR session (it is a JSON array, not a session object)');
			expect(msg).toContain('Your open session was not changed');
			expect(appState.showAYSModal).toBe(false);
			expect(importJson).not.toHaveBeenCalled();
			expect(core.notes).toEqual([{ id: 'note_1', text: 'unsaved' }]);
		} finally {
			core.notes = [];
		}
	});

	it('a .ancir that is not JSON at all is refused without reaching importJson', async () => {
		const { input } = openModal();
		await pick(input, 'notes.ancir', 'hello, this is text');
		await vi.waitFor(() => expect(addNotification).toHaveBeenCalledOnce());
		expect(importJson).not.toHaveBeenCalled();
		expect(addNotification.mock.calls[0][0]).toBe(
			'"notes.ancir" is not an AnCiR session (it is not JSON). Your open session was not changed.'
		);
	});
});
