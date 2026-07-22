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
