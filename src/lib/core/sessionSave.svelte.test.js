// @ts-nocheck
// Save and Save as through the browser's save dialog (UI-15, sessionSave.svelte.js), with
// showSaveFilePicker and the file handle faked so the written bytes can be read back. The
// download route (no dialog: Firefox, Safari) is covered by exportJson.test.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { core, createGroup, outputCoreAsJson } from './core.svelte.js';
import { notifications } from './notifications.svelte.js';
import {
	initUnsavedChanges,
	markSessionSaved,
	hasUnsavedChanges,
	_bumpRevisionForTest
} from './unsavedChanges.svelte.js';
import { saveTarget, getSaveHandle, setSaveTarget, clearSaveTarget } from './saveTarget.svelte.js';
import {
	saveSession,
	supportsSaveDialog,
	suggestedSaveName,
	SESSION_SAVE_TYPES
} from './sessionSave.svelte.js';
import { resetSession } from './sessionLoad.svelte.js';

const domError = (name, message = name) => Object.assign(new Error(message), { name });

/** A FileSystemFileHandle stand-in that records what was written to it. */
function fakeHandle(name, { permission = 'granted', grant = 'granted', writeError = null } = {}) {
	const h = {
		kind: 'file',
		name,
		writes: [],
		requested: 0,
		queryPermission: vi.fn(async () => permission),
		requestPermission: vi.fn(async () => {
			h.requested++;
			return grant;
		}),
		createWritable: vi.fn(async () => {
			if (writeError) throw writeError;
			let pending = null;
			return {
				write: async (blob) => {
					pending = await blob.text();
				},
				close: async () => {
					h.writes.push(pending);
				},
				abort: async () => {}
			};
		})
	};
	return h;
}

let downloads;
beforeEach(() => {
	initUnsavedChanges();
	resetSession();
	clearSaveTarget();
	markSessionSaved();
	notifications.list.length = 0;
	downloads = [];
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
		downloads.push(this.download);
	});
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(2026, 10, 20, 9, 0));
});

afterEach(() => {
	delete window.showSaveFilePicker;
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function withPicker(impl) {
	window.showSaveFilePicker = vi.fn(impl);
	return window.showSaveFilePicker;
}

function unsavedWork(name = 'actiwatch.csv') {
	createGroup({ name });
	_bumpRevisionForTest();
}

const lastToast = () => notifications.list.at(-1);

describe('feature detection', () => {
	it('uses the dialog only where showSaveFilePicker exists', () => {
		expect(supportsSaveDialog()).toBe(false);
		withPicker(async () => null);
		expect(supportsSaveDialog()).toBe(true);
	});

	it('downloads, unchanged, where there is no dialog', async () => {
		unsavedWork();
		const result = await saveSession();
		expect(result).toEqual({ status: 'downloaded', fileName: 'actiwatch 2026-11-20.ancir' });
		expect(downloads).toEqual(['actiwatch 2026-11-20.ancir']);
		expect(hasUnsavedChanges()).toBe(false);
	});
});

describe('Save through the dialog', () => {
	it('suggests "<name> <date>.ancir", writes the session there and keeps the file', async () => {
		unsavedWork();
		const file = fakeHandle('actiwatch 2026-11-20.ancir');
		const picker = withPicker(async () => file);
		const result = await saveSession();
		expect(picker).toHaveBeenCalledTimes(1);
		expect(picker.mock.calls[0][0]).toMatchObject({
			suggestedName: 'actiwatch 2026-11-20.ancir',
			types: SESSION_SAVE_TYPES
		});
		expect(file.writes).toEqual([outputCoreAsJson()]);
		expect(result.status).toBe('saved');
		expect(getSaveHandle()).toBe(file);
		expect(saveTarget.fileName).toBe('actiwatch 2026-11-20.ancir');
		expect(hasUnsavedChanges()).toBe(false);
		expect(lastToast().message).toContain('actiwatch 2026-11-20.ancir');
		expect(downloads).toEqual([]);
	});

	it('a second Save writes to the same file without the dialog', async () => {
		const file = fakeHandle('study.ancir');
		const picker = withPicker(async () => file);
		unsavedWork();
		await saveSession();
		unsavedWork('second.csv');
		await saveSession();
		expect(picker).toHaveBeenCalledTimes(1);
		expect(file.writes).toHaveLength(2);
		expect(file.writes[1]).toBe(outputCoreAsJson());
	});

	it('Save as always asks, starting in the current file, and then saves there', async () => {
		const first = fakeHandle('study.ancir');
		const second = fakeHandle('study copy.ancir');
		setSaveTarget(first);
		const picker = withPicker(async () => second);
		unsavedWork();
		await saveSession({ saveAs: true });
		expect(picker.mock.calls[0][0]).toMatchObject({
			// The current name with TODAY's date, not "<data> <date>".
			suggestedName: 'study 2026-11-20.ancir',
			startIn: first
		});
		expect(first.writes).toEqual([]);
		expect(second.writes).toHaveLength(1);
		expect(getSaveHandle()).toBe(second);
	});

	it('cancelling the dialog does nothing: no message, no download, still unsaved', async () => {
		unsavedWork();
		withPicker(async () => {
			throw domError('AbortError', 'The user aborted a request.');
		});
		const result = await saveSession();
		expect(result).toEqual({ status: 'cancelled' });
		expect(notifications.list).toEqual([]);
		expect(downloads).toEqual([]);
		expect(hasUnsavedChanges()).toBe(true);
		expect(getSaveHandle()).toBe(null);
	});

	it('a dialog that cannot open falls back to a download, and says so', async () => {
		unsavedWork();
		withPicker(async () => {
			throw domError('SecurityError', 'Must be handling a user gesture to show a file picker.');
		});
		const result = await saveSession();
		expect(result.status).toBe('fallback');
		expect(downloads).toEqual(['actiwatch 2026-11-20.ancir']);
		expect(lastToast().type).toBe('warning');
		expect(lastToast().message).toMatch(
			/user gesture.*downloaded as "actiwatch 2026-11-20\.ancir"/s
		);
		expect(hasUnsavedChanges()).toBe(false);
	});

	it('a write that fails falls back to a download and keeps no broken target', async () => {
		unsavedWork();
		withPicker(async () => fakeHandle('x.ancir', { writeError: domError('InvalidStateError') }));
		const result = await saveSession();
		expect(result.status).toBe('fallback');
		expect(downloads).toHaveLength(1);
		expect(getSaveHandle()).toBe(null);
	});

	it('a kept file that was moved or deleted opens the dialog to choose again', async () => {
		const gone = fakeHandle('moved.ancir', { writeError: domError('NotFoundError') });
		setSaveTarget(gone);
		const replacement = fakeHandle('moved 2026-11-20.ancir');
		const picker = withPicker(async () => replacement);
		unsavedWork();
		const result = await saveSession();
		expect(picker).toHaveBeenCalledTimes(1);
		expect(replacement.writes).toHaveLength(1);
		expect(result.status).toBe('saved');
		expect(getSaveHandle()).toBe(replacement);
	});

	it('asks for write permission on a kept file, and writes once granted', async () => {
		const file = fakeHandle('opened.ancir', { permission: 'prompt', grant: 'granted' });
		setSaveTarget(file);
		const picker = withPicker(async () => null);
		unsavedWork();
		await saveSession();
		expect(file.requested).toBe(1);
		expect(file.writes).toHaveLength(1);
		expect(picker).not.toHaveBeenCalled();
	});

	it('refused permission saves nothing and says how to save elsewhere', async () => {
		const file = fakeHandle('opened.ancir', { permission: 'prompt', grant: 'denied' });
		setSaveTarget(file);
		withPicker(async () => null);
		unsavedWork();
		const result = await saveSession();
		expect(result).toEqual({ status: 'denied' });
		expect(file.writes).toEqual([]);
		expect(downloads).toEqual([]);
		expect(lastToast().message).toMatch(/not given permission.*Save as/s);
		expect(hasUnsavedChanges()).toBe(true);
	});

	it('an edit made while the dialog is open still counts as unsaved', async () => {
		unsavedWork();
		let answer;
		withPicker(() => new Promise((r) => (answer = r)));
		const saving = saveSession();
		unsavedWork('typed while the dialog was up.csv');
		answer(fakeHandle('s.ancir'));
		await saving;
		expect(hasUnsavedChanges()).toBe(true);
	});

	it('a second Save while the dialog is open does not open another', async () => {
		unsavedWork();
		let answer;
		const picker = withPicker(() => new Promise((r) => (answer = r)));
		const first = saveSession();
		expect(await saveSession()).toEqual({ status: 'busy' });
		answer(fakeHandle('s.ancir'));
		await first;
		expect(picker).toHaveBeenCalledTimes(1);
	});
});

describe('suggestedSaveName', () => {
	it('uses the data source, or the current file name, with today’s date', () => {
		expect(suggestedSaveName()).toBe('AnCiR session 2026-11-20.ancir');
		createGroup({ name: 'cohort.xlsx' });
		expect(suggestedSaveName()).toBe('cohort 2026-11-20.ancir');
		setSaveTarget({ name: 'my study 2026-10-01.ancir' });
		expect(suggestedSaveName()).toBe('my study 2026-11-20.ancir');
		expect(core.groups).toHaveLength(1);
	});
});
