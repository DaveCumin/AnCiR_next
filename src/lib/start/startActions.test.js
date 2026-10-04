import { describe, it, expect, beforeEach, vi } from 'vitest';

// importJson touches the whole session machinery; the unit under test is the *chokepoint*
// (parse → load → record), so the load itself is stubbed and asserted on by call.
const importJson = vi.fn(async () => {});
vi.mock('$lib/components/iconActions/Setting.svelte', () => ({ importJson }));
vi.mock('$app/paths', () => ({ base: '' }));

const { openSessionFile, openExample, pickSessionFile, resolveExampleUrl, sessionMeta } =
	await import('./startActions.js');
const { loadRecents } = await import('./recentSessions.svelte.js');

const fileOf = (name, json) => ({ name, text: async () => JSON.stringify(json) });

beforeEach(() => {
	window.localStorage.clear();
	loadRecents();
	importJson.mockClear();
	delete window.showOpenFilePicker;
});

describe('openSessionFile', () => {
	it('parses, loads, and records the session as a recent', async () => {
		await openSessionFile(fileOf('Cohort A.json', { data: [] }));
		expect(importJson).toHaveBeenCalledOnce();
		const [entry] = loadRecents();
		expect(entry.name).toBe('Cohort A'); // .json stripped for display
		expect(entry.id).toBe('file::Cohort A.json');
		expect(entry.thumb).toContain('<svg'); // procedural fallback for an unknown id
	});

	it('reopening the same file refreshes the row instead of duplicating it', async () => {
		await openSessionFile(fileOf('Cohort A.json', { data: [] }));
		await openSessionFile(fileOf('other.json', { data: [] }));
		await openSessionFile(fileOf('Cohort A.json', { data: [] }));
		const items = loadRecents();
		expect(items.filter((e) => e.id === 'file::Cohort A.json')).toHaveLength(1);
		expect(items[0].name).toBe('Cohort A');
	});

	it('does not record anything when the file is not valid JSON', async () => {
		const bad = { name: 'broken.json', text: async () => '{not json' };
		await expect(openSessionFile(bad)).rejects.toThrow();
		expect(importJson).not.toHaveBeenCalled();
		expect(loadRecents()).toEqual([]);
	});
});

describe('openSessionFile with a .ancir file', () => {
	it('opens a .ancir session exactly like a .json one, and records it without the extension', async () => {
		await openSessionFile(fileOf('Cohort B.ancir', { data: [] }));
		expect(importJson).toHaveBeenCalledOnce();
		expect(importJson.mock.calls[0][0]).toEqual({ data: [] });
		const [entry] = loadRecents();
		expect(entry.name).toBe('Cohort B'); // .ancir stripped for display
		expect(entry.id).toBe('file::Cohort B.ancir');
	});

	it('refuses a .ancir that is not JSON as "not an AnCiR session", loading and recording nothing', async () => {
		const bad = { name: 'notes.ancir', text: async () => 'just some text' };
		await expect(openSessionFile(bad)).rejects.toThrow('not an AnCiR session (it is not JSON)');
		expect(importJson).not.toHaveBeenCalled();
		expect(loadRecents()).toEqual([]);
	});
});

describe('openExample', () => {
	it('records an example with its url so the row can reopen without a picker', async () => {
		global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }));
		await openExample({ id: 'stats-anova', name: 'One-way ANOVA', url: 'sessions/demos/a.json' });
		const [entry] = loadRecents();
		expect(entry.url).toBe('sessions/demos/a.json');
		expect(entry.workflow).toBe('stats-anova');
		expect(entry.thumb).toContain('<svg');
	});

	it('propagates a failed fetch rather than recording a session that never loaded', async () => {
		global.fetch = vi.fn(async () => ({ ok: false, status: 404 }));
		await expect(openExample({ id: 'x', name: 'x', url: 'nope.json' })).rejects.toThrow('404');
		expect(loadRecents()).toEqual([]);
	});
});

describe('pickSessionFile', () => {
	it('reports unsupported when the browser has no file picker, so callers can fall back', async () => {
		expect(await pickSessionFile()).toEqual({ status: 'unsupported' });
	});

	it('returns the file and its handle when the picker is available', async () => {
		const handle = { getFile: async () => fileOf('s.json', {}) };
		window.showOpenFilePicker = vi.fn(async () => [handle]);
		const res = await pickSessionFile();
		expect(res.status).toBe('ok');
		expect(res.handle).toBe(handle); // the handle is what makes one-click reopen possible
	});

	it('offers .ancir as well as .json in the OS picker', async () => {
		const handle = { getFile: async () => fileOf('s.ancir', {}) };
		window.showOpenFilePicker = vi.fn(async () => [handle]);
		const res = await pickSessionFile();
		expect(res.status).toBe('ok');
		const [{ types }] = window.showOpenFilePicker.mock.calls[0];
		const exts = types.flatMap((t) => Object.values(t.accept).flat());
		expect(exts).toEqual(expect.arrayContaining(['.json', '.ancir']));
	});

	it('treats a dismissed picker as a cancel, not a failure', async () => {
		window.showOpenFilePicker = vi.fn(async () => {
			throw Object.assign(new Error('abort'), { name: 'AbortError' });
		});
		expect(await pickSessionFile()).toEqual({ status: 'cancelled' });
	});
});

describe('helpers', () => {
	it('leaves absolute urls alone and roots relative ones at the base path', () => {
		expect(resolveExampleUrl('https://x.test/a.json')).toBe('https://x.test/a.json');
		expect(resolveExampleUrl('sessions/demos/a.json')).toBe('/sessions/demos/a.json');
	});

	it('singularises the session summary', () => {
		expect(sessionMeta()).toBe('0 columns · 0 plots');
	});
});

// The start screen can be summoned over open work (Help → Welcome screen), so opening from it
// must ask before replacing that work (review ROB-1), and a "no" must change nothing at all.
const { core, appState } = await import('$lib/core/core.svelte.js');
describe('confirm before replacing open work', () => {
	function withOpenWork() {
		core.notes = [{ id: 'note_1', text: 'unsaved' }];
	}
	function answer(choice) {
		appState.AYScallback(choice);
		appState.showAYSModal = false;
	}

	it('an example the user declines is neither fetched, loaded nor recorded', async () => {
		withOpenWork();
		global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }));
		const pending = openExample({ id: 'x', name: 'Workflow — demo', url: 'sessions/demos/a.json' });
		expect(appState.showAYSModal).toBe(true);
		expect(appState.AYStext).toContain('"Demo"');
		answer('Cancel');
		expect(await pending).toBe(false);
		expect(global.fetch).not.toHaveBeenCalled();
		expect(importJson).not.toHaveBeenCalled();
		expect(loadRecents()).toEqual([]);
		core.notes = [];
	});

	it('a session file the user confirms loads and is recorded', async () => {
		withOpenWork();
		const pending = openSessionFile(fileOf('mine.json', { data: [] }));
		await vi.waitFor(() => expect(appState.showAYSModal).toBe(true));
		answer('Replace session');
		expect(await pending).toBe(true);
		expect(importJson).toHaveBeenCalledOnce();
		expect(loadRecents()[0].id).toBe('file::mine.json');
		core.notes = [];
	});

	it('a .ancir that is not a session is refused WITHOUT asking to replace the open work', async () => {
		withOpenWork();
		appState.showAYSModal = false;
		await expect(openSessionFile(fileOf('data.ancir', [1, 2, 3]))).rejects.toThrow(
			'not an AnCiR session (it is a JSON array, not a session object)'
		);
		expect(appState.showAYSModal).toBe(false);
		expect(importJson).not.toHaveBeenCalled();
		expect(core.notes).toEqual([{ id: 'note_1', text: 'unsaved' }]); // open work untouched
		core.notes = [];
	});

	it('a session file the user declines is not loaded', async () => {
		withOpenWork();
		const pending = openSessionFile(fileOf('mine.json', { data: [] }));
		await vi.waitFor(() => expect(appState.showAYSModal).toBe(true));
		answer('Cancel');
		expect(await pending).toBe(false);
		expect(importJson).not.toHaveBeenCalled();
		core.notes = [];
	});
});
