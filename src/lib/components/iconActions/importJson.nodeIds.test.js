// @ts-nocheck
// Session-load robustness: canvas node ids must come back as STRINGS.
//
// The app mints string ids (`note_3`, `group_2`, composite ids), and every canvas
// selection predicate calls `.startsWith` on them (e.g. WorkflowEditor's
// COMPOSABLE). A session written OUTSIDE the app can carry a bare number instead:
// David's script-built review-article session had `notes: [{id: 1, ...}]`, loaded
// apparently fine, and then the first click that put that note into a selection
// crashed with "ue.startsWith is not a function" (contained banner, real session).
// importJson now coerces these ids at the load boundary — `1` loads as "1",
// preserving any nodeLayout keyed by it, rather than being dropped or left to
// crash every call site.
import { describe, it, expect, beforeAll } from 'vitest';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { importJson } from './Setting.svelte';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
});

/** Minimal foreign-written session: numeric ids where the app mints strings. */
function foreignSession() {
	return {
		version: 'β.72.28',
		rawData: { 0: [1, 2, 3] },
		data: [
			{
				id: 0,
				name: 'a',
				data: 0,
				type: 'number',
				tableProcessGUId: '',
				producerNodeId: null,
				producerPort: null,
				producerArtifactKind: null,
				processes: []
			}
		],
		plots: [],
		tableProcesses: [],
		storedValues: {},
		chainRefs: [],
		nodeNotes: {},
		notes: [{ id: 1, text: 'a note', x: 10, y: 20, width: 200, height: 120 }],
		groups: [{ id: 2, name: 'G', x: 0, y: 0, width: 240, height: 180, sourceColumnIds: [0] }],
		composites: [
			{ id: 3, name: 'C', x: 0, y: 0, memberIds: [], interface: { inputs: [], outputs: [] } }
		],
		orphanProcesses: []
	};
}

describe('importJson coerces foreign node ids to strings', () => {
	it('numeric note/group/composite ids load as strings, values preserved', async () => {
		await importJson(foreignSession());

		expect(core.notes).toHaveLength(1);
		expect(core.notes[0].id).toBe('1'); // identity kept, type fixed
		expect(core.notes[0].text).toBe('a note');

		expect(core.groups).toHaveLength(1);
		expect(core.groups[0].id).toBe('2');

		expect(core.composites).toHaveLength(1);
		expect(core.composites[0].id).toBe('3');
		expect(core.composites[0].originId).toBe('3');

		// The exact crash: canvas selection predicates call .startsWith on node ids.
		// Every loaded canvas node id must survive that.
		const COMPOSABLE = (id) => id?.startsWith('process_') || id?.startsWith('tableprocess_');
		const sel = [core.notes[0].id, core.groups[0].id, core.composites[0].id];
		expect(() => sel.filter(COMPOSABLE)).not.toThrow();
	});

	it('missing ids get minted string fallbacks', async () => {
		const s = foreignSession();
		delete s.notes[0].id;
		delete s.groups[0].id;
		delete s.composites[0].id;
		await importJson(s);
		expect(core.notes[0].id).toBe('note_0');
		expect(core.groups[0].id).toBe('group_0');
		expect(core.composites[0].id).toBe('composite_0');
	});
});
