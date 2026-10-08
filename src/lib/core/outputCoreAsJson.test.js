// @ts-nocheck
// Saving a session serialises it ONCE (review ROB-U3). outputCoreAsJson used to copy the
// session with JSON.stringify, parse that copy back, patch it and stringify again: three full
// passes over what can be megabytes of raw data. The file it writes must not change, so each
// real demo session is checked byte for byte against the old three-pass implementation, kept
// here as the reference.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
	core,
	appState,
	appConsts,
	outputCoreAsJson,
	getStoredValue,
	storeValue
} from './core.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';

const here = dirname(fileURLToPath(import.meta.url));
const demo = (name) =>
	JSON.parse(readFileSync(join(here, '..', '..', '..', 'static/sessions/demos', name), 'utf8'));

/** The pre-ROB-U3 implementation, verbatim apart from its name. */
function legacyOutputCoreAsJson() {
	let coreOut = JSON.parse(
		JSON.stringify(core, (key, val) => (typeof val === 'function' ? undefined : val))
	);
	coreOut.rawData = Object.fromEntries(core.rawData);
	const resolvedSV = {};
	for (const [name, entry] of Object.entries(core.storedValues)) {
		resolvedSV[name] = {
			source: entry.source,
			...(entry.ref ? { ref: { ...entry.ref } } : {}),
			staticValue: getStoredValue(name)
		};
	}
	coreOut.storedValues = resolvedSV;
	const { generatedBy, ...rest } = coreOut;
	const output = {
		...rest,
		appState,
		version: appConsts.version,
		...(generatedBy ? { generatedBy } : {})
	};
	return JSON.stringify(output, null, 2);
}

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
}, 120000);

afterEach(() => {
	vi.restoreAllMocks();
	core.generatedBy = null;
});

describe('outputCoreAsJson', () => {
	it.each([
		'demo-workflow-phase-groups.json',
		'demo-tp-storedvaluegroup.json',
		'demo-workflow-rest-activity.json'
	])('writes %s byte for byte as the three-pass version did', async (name) => {
		await importJson(demo(name));
		const out = outputCoreAsJson();
		expect(out.length).toBeGreaterThan(1000);
		expect(out).toBe(legacyOutputCoreAsJson());
	});

	it('saves a live stored value as its current value, not its getter', async () => {
		await importJson(demo('demo-tp-storedvaluegroup.json'));
		storeValue('liveTau', () => 24.2, 'test');
		const out = outputCoreAsJson();
		expect(out).toBe(legacyOutputCoreAsJson());
		expect(JSON.parse(out).storedValues.liveTau).toEqual({ source: 'test', staticValue: 24.2 });
	});

	it('keeps an AI fingerprint, last, and leaves a null one out', async () => {
		await importJson(demo('demo-tp-storedvaluegroup.json'));
		expect(Object.keys(JSON.parse(outputCoreAsJson()))).not.toContain('generatedBy');
		core.generatedBy = { service: 'ancir-nl', model: 'm' };
		const out = outputCoreAsJson();
		expect(out).toBe(legacyOutputCoreAsJson());
		expect(Object.keys(JSON.parse(out)).at(-1)).toBe('generatedBy');
	});

	it('serialises once: one stringify and no parse', async () => {
		await importJson(demo('demo-tp-storedvaluegroup.json'));
		const stringify = vi.spyOn(JSON, 'stringify');
		const parse = vi.spyOn(JSON, 'parse');
		outputCoreAsJson();
		expect(parse).not.toHaveBeenCalled();
		expect(stringify).toHaveBeenCalledTimes(1);
	});
});
