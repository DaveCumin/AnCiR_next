/**
 * Opening a classroom lesson replaces the session, so it must ask first when there is work
 * open (the same confirm every other "open a session" entry point uses), and a "Cancel"
 * must leave the session alone and end the lesson tour that depends on it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => ({ confirm: [], imported: [], answer: true, stopped: 0 }));

vi.mock('$app/paths', () => ({ base: '' }));
vi.mock('$lib/start/offline.js', () => ({
	fetchAppAsset: async () => ({ json: async () => ({ data: [], lesson: true }) }),
	AppAssetUnavailableError: class extends Error {}
}));
vi.mock('$lib/components/iconActions/Setting.svelte', () => ({
	importJson: async (json) => {
		calls.imported.push(json);
	}
}));
vi.mock('$lib/core/sessionLoad.svelte.js', () => ({
	confirmReplaceSession: async (what) => {
		calls.confirm.push(what);
		return calls.answer;
	}
}));
vi.mock('$lib/core/tourRunner.svelte.js', () => ({
	stopTour: () => {
		calls.stopped++;
	},
	tourState: { activeTour: { name: 'Lesson: Sine waves are everywhere' } }
}));

const { loadLesson } = await import('./classroomTour.js');
const { appState } = await import('$lib/core/core.svelte.js');

beforeEach(() => {
	calls.confirm.length = 0;
	calls.imported.length = 0;
	calls.stopped = 0;
	appState.view = 'workspace';
});

describe('loadLesson', () => {
	it('asks before replacing the session, then loads the lesson', async () => {
		calls.answer = true;
		expect(await loadLesson('learn-sine-waves.json')).toBe(true);
		expect(calls.confirm).toHaveLength(1);
		// Named as the student sees the lesson, not by its file.
		expect(calls.confirm[0]).toBe('the lesson "Sine waves are everywhere"');
		expect(calls.imported).toEqual([{ data: [], lesson: true }]);
		expect(appState.view).toBe('canvas');
		expect(calls.stopped).toBe(0);
	});

	it('on Cancel leaves the session alone and ends the lesson tour', async () => {
		calls.answer = false;
		expect(await loadLesson('learn-sine-waves.json')).toBe(false);
		expect(calls.imported).toHaveLength(0);
		expect(calls.stopped).toBe(1);
		expect(appState.view).toBe('workspace');
	});
});
