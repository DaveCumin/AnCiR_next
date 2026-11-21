// @ts-nocheck
// importJson's one-load-at-a-time lock is always released, however a load ends.
//
// The lock ("Another session is still loading") and history's load flag (undo and redo off)
// were set BEFORE the try whose finally releases them, with the snapshot of the open session
// taken in between. A snapshot that threw left both set for the rest of the page's life:
// every later load was refused as "still loading", and undo and redo stayed off.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { history } from '$lib/core/opHistory.svelte.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';

const fault = vi.hoisted(() => ({ snapshot: false }));
vi.mock('$lib/core/sessionLoad.svelte.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		snapshotSession: () => {
			if (fault.snapshot) {
				fault.snapshot = false;
				throw new Error('snapshot failed');
			}
			return real.snapshotSession();
		}
	};
});

const { importJson } = await import('./Setting.svelte');

const DEMOS = join(process.cwd(), 'static', 'sessions', 'demos');
const demo = (name) => JSON.parse(readFileSync(join(DEMOS, name), 'utf8'));
const SESSION = () => demo('demo-workflow-free-running.json');

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	history.init();
});

describe('the session-load lock is released however a load ends', () => {
	it('after a load whose snapshot of the open session throws', async () => {
		fault.snapshot = true;
		await expect(importJson(SESSION())).rejects.toThrow('snapshot failed');
		expect(history.isLoading).toBe(false);
		await importJson(SESSION());
		expect(core.tableProcesses.length).toBeGreaterThan(0);
	});

	it('after a load that fails half way through its build (and is rolled back)', async () => {
		const bad = SESSION();
		bad.tableProcesses[0].args = null;
		await expect(importJson(bad)).rejects.toThrow();
		expect(history.isLoading).toBe(false);
		await importJson(SESSION());
		expect(core.tableProcesses.length).toBeGreaterThan(0);
	});

	it('after a load that is not a session', async () => {
		await expect(importJson({})).rejects.toThrow();
		await importJson(SESSION());
		expect(history.isLoading).toBe(false);
	});
});
