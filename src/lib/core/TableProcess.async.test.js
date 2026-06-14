// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appConsts } from '$lib/core/core.svelte.js';

// TableProcess is exported from a .svelte file's <script module>. We import the class
// directly to call doProcess() without constructing via the full constructor path.
import { TableProcess } from './TableProcess.svelte';

// Svelte 5 compiles $state class fields into private members; instances created via
// Object.create(Prototype) can't have those setters invoked. Instead we extract
// doProcess from the prototype and call it with a plain object as `this` — doProcess
// only reads `this.name` and `this.args`, so a plain object is sufficient.
const doProcess = TableProcess.prototype.doProcess;

function runDoProcess(name, args) {
	return doProcess.call({ name, args });
}

describe('TableProcess.doProcess async-aware', () => {
	// Track keys we add so we can clean them up between tests without swapping
	// out the underlying Map (which lives inside a $state proxy).
	const addedKeys = [];

	beforeEach(() => {
		addedKeys.length = 0;
	});

	afterEach(() => {
		for (const k of addedKeys) {
			appConsts.tableProcessMap.delete(k);
		}
		addedKeys.length = 0;
	});

	function register(name, entry) {
		appConsts.tableProcessMap.set(name, entry);
		addedKeys.push(name);
	}

	it('awaits an async func and returns the resolved value', async () => {
		register('async-double', {
			func: async ({ x }) => ({ y: x.map((v) => v * 2) })
		});
		const out = await runDoProcess('async-double', { x: [1, 2, 3] });
		expect(out.y).toEqual([2, 4, 6]);
	});

	it('returns a sync func value (wrapped in a Promise via await)', async () => {
		register('sync-inc', {
			func: ({ x }) => ({ y: x.map((v) => v + 1) })
		});
		const out = await runDoProcess('sync-inc', { x: [1, 2, 3] });
		expect(out.y).toEqual([2, 3, 4]);
	});

	it('returns null when the process is not registered', async () => {
		const out = await runDoProcess('missing-process-xyz-async-test', {});
		expect(out).toBeNull();
	});
});
