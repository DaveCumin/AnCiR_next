// What AnCiR leaves behind in the browser. These assert the PRIVACY properties, not just the
// plumbing: a behaviour-only suite would stay green while a refactor quietly started writing
// the recents index back to disk on a shared machine.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { store, privacy, setEphemeral, clearLocalData } from './localData.svelte.js';

beforeEach(async () => {
	localStorage.clear();
	sessionStorage.clear();
	privacy.ephemeral = false;
});

describe('store', () => {
	it('writes to localStorage in normal mode', () => {
		store.setItem('ancir.test', 'x');
		expect(localStorage.getItem('ancir.test')).toBe('x');
		expect(sessionStorage.getItem('ancir.test')).toBeNull();
	});

	it('writes ONLY to sessionStorage in ephemeral mode', () => {
		privacy.ephemeral = true;
		store.setItem('ancir.test', 'x');
		expect(sessionStorage.getItem('ancir.test')).toBe('x');
		expect(localStorage.getItem('ancir.test')).toBeNull();
	});

	it('still reads a value written before the mode changed', () => {
		store.setItem('ancir.test', 'x');
		privacy.ephemeral = true;
		expect(store.getItem('ancir.test')).toBe('x');
	});

	it('removes from both stores, so a mode change cannot strand a key', () => {
		localStorage.setItem('ancir.test', 'a');
		sessionStorage.setItem('ancir.test', 'b');
		store.removeItem('ancir.test');
		expect(localStorage.getItem('ancir.test')).toBeNull();
		expect(sessionStorage.getItem('ancir.test')).toBeNull();
	});

	it('survives a storage that throws rather than taking the app down', () => {
		const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
			throw new Error('QuotaExceededError');
		});
		try {
			expect(() => store.setItem('ancir.test', 'x')).not.toThrow();
		} finally {
			spy.mockRestore();
		}
	});
});

describe('clearLocalData', () => {
	it('removes ancir keys from both stores and leaves other origins alone', async () => {
		localStorage.setItem('ancir.recents.v1', '[]');
		localStorage.setItem('ancir.tours.completed', '[]');
		sessionStorage.setItem('ancir.canvas.pathFocus', 'true');
		localStorage.setItem('somethingelse', 'keep');

		const { keys } = await clearLocalData();

		expect(keys).toBe(3);
		expect(localStorage.getItem('ancir.recents.v1')).toBeNull();
		expect(sessionStorage.getItem('ancir.canvas.pathFocus')).toBeNull();
		expect(localStorage.getItem('somethingelse')).toBe('keep');
	});

	it('keeps the privacy setting itself — a mode that forgets itself is worse than none', async () => {
		await setEphemeral(true);
		expect(localStorage.getItem('ancir.privacy.ephemeral')).toBe('1');
		await clearLocalData();
		expect(localStorage.getItem('ancir.privacy.ephemeral')).toBe('1');
		expect(privacy.ephemeral).toBe(true);
	});
});

describe('setEphemeral', () => {
	it('clears what is already on disk when switched on', async () => {
		localStorage.setItem('ancir.recents.v1', '[{"id":"a"}]');
		await setEphemeral(true);
		// Otherwise the setting would protect only future sessions while last week's filenames
		// sat there, which is not what ticking the box means.
		expect(localStorage.getItem('ancir.recents.v1')).toBeNull();
	});

	it('persists across a reload, and switching off stops persisting the flag', async () => {
		await setEphemeral(true);
		expect(localStorage.getItem('ancir.privacy.ephemeral')).toBe('1');
		await setEphemeral(false);
		expect(localStorage.getItem('ancir.privacy.ephemeral')).toBeNull();
		expect(privacy.ephemeral).toBe(false);
	});
});
