// Guards the generated MCP node/plot schema against drifting from the live AnCiR registry.
//
// mcp/src/emit/session-schema.generated.json is produced by `npm run mcp:schema` (and by the
// build) from the live registry. If a node/plot is added or renamed but the schema isn't
// regenerated, MCP callers can't reach it; if the version is bumped without regenerating, the
// schema advertises a stale version. This test runs in the normal `npm test` path so either kind
// of staleness fails CI. To fix a failure: run `npm run mcp:schema` (or `npm run build`).
import { describe, it, expect, beforeAll } from 'vitest';
import { appConsts } from '$lib/core/core.svelte.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import generated from '../../../mcp/src/emit/session-schema.generated.json';

beforeAll(async () => {
	appConsts.tableProcessMap = await loadTableProcesses();
	appConsts.plotMap = await loadPlots();
});

describe('generated MCP schema is fresh vs the live registry', () => {
	it('generatedFromVersion matches the app version (run `npm run mcp:schema` after a version bump)', () => {
		expect(generated.generatedFromVersion).toBe(appConsts.version);
	});

	it('node keys exactly match the live table-process registry', () => {
		const live = [...appConsts.tableProcessMap.keys()].sort();
		expect(Object.keys(generated.nodes).sort()).toEqual(live);
	});

	it('plot keys exactly match the live plot registry', () => {
		const live = [...appConsts.plotMap.keys()].sort();
		expect(Object.keys(generated.plots).sort()).toEqual(live);
	});

	it('reported count matches the number of node schemas', () => {
		expect(generated.count).toBe(Object.keys(generated.nodes).length);
	});
});
