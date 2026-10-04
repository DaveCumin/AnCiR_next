/**
 * loadFromURL (the `?loadFromURL=` deep link and AI-built sessions) REPLACES the open session,
 * so it must ask first when there is work open, and must not ask about a link that fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const calls = vi.hoisted(() => ({ confirm: [], imported: [], answer: true }));

vi.mock('$lib/components/iconActions/Setting.svelte', () => ({
	importJson: async (json) => {
		calls.imported.push(json);
	},
	exportJson: () => {}
}));
vi.mock('$lib/core/sessionLoad.svelte.js', async (orig) => ({
	...(await orig()),
	confirmReplaceSession: async (what) => {
		calls.confirm.push(what);
		return calls.answer;
	}
}));

const { loadFromURL } = await import('./ImportData.svelte');

const SESSION = { data: [{ id: 1 }], plots: [] };
let fetchSpy;

beforeEach(() => {
	calls.confirm.length = 0;
	calls.imported.length = 0;
	fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => fetchSpy.mockRestore());

const ok = (body) => ({ ok: true, json: async () => body });

describe('loadFromURL', () => {
	it('asks, naming the file, before replacing the session', async () => {
		calls.answer = true;
		fetchSpy.mockResolvedValue(ok(SESSION));
		expect(await loadFromURL('https://example.org/sessions/my%20run.json')).toBe(true);
		expect(calls.confirm).toEqual(['"my run.json"']);
		expect(calls.imported).toEqual([SESSION]);
	});

	it('on Cancel loads nothing', async () => {
		calls.answer = false;
		fetchSpy.mockResolvedValue(ok(SESSION));
		expect(await loadFromURL('https://example.org/s.json')).toBe(false);
		expect(calls.confirm).toHaveLength(1);
		expect(calls.imported).toHaveLength(0);
	});

	it('a failing link reports its error without asking', async () => {
		calls.answer = true;
		fetchSpy.mockResolvedValue({ ok: false, json: async () => ({}) });
		expect(await loadFromURL('https://example.org/missing.json')).toBe(false);
		expect(calls.confirm).toHaveLength(0);
		expect(calls.imported).toHaveLength(0);
	});
});
