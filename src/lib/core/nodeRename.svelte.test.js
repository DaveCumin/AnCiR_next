// @ts-nocheck
/**
 * Renaming a canvas node is one undo step and an unsaved change.
 *
 * REPORTED (reproduced 2026-10-16, headless Chromium, demo-tp-cosinor): renaming the Cosinor
 * analysis, the "Cosinor: data + fit" plot and a group from their node headers wrote the name
 * straight onto the object. Cmd+Z did nothing (the undo stack stayed empty) and the session did
 * not count as edited, so New session (Cmd/Ctrl+Alt+N) discarded the rename without asking.
 * The same direct write sat behind every node rename editor: the side panel, the Data panel's
 * rows, the workspace plot title and the plot's control banner (bind:value).
 *
 * Every editor now commits through nodeNaming.commitNodeRename (setNodeName for the canvas
 * editors): one renameNode operation on Enter or blur, nothing while typing, Escape changes
 * nothing, and an empty field restores the node's default name.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { Plot } from '$lib/core/Plot.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { Process } from '$lib/core/Process.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import {
	initUnsavedChanges,
	markSessionSaved,
	hasUnsavedChanges
} from '$lib/core/unsavedChanges.svelte.js';
import { commitNodeRename, nodeDefaultName, setNodeName } from '$lib/core/nodeNaming.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import GroupNode from '$lib/components/workflow/GroupNode.svelte';
import Editable from '$lib/components/inputs/Editable.svelte';

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	history.init();
	initUnsavedChanges();
}, 120000);

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	core.plots = [];
	core.tableProcesses = [];
	core.orphanProcesses = [];
	core.groups = [];
	core.composites = [];
	history.clear();
});
afterEach(() => cleanup());

/** One node of each renameable kind, as a load leaves it (saved). */
function makeNodes() {
	const plot = new Plot({ type: 'scatterplot', name: 'My plot', plot: { data: [] } });
	core.plots.push(plot);
	const tp = new TableProcess(
		{ name: 'Cosinor', displayName: 'Cosinor', args: { out: { _x: 0 } } },
		null
	);
	core.tableProcesses.push(tp);
	const proc = new Process({ name: 'Add', args: {} }, null);
	core.orphanProcesses.push(proc);
	core.groups.push({ id: 'group_1', name: 'G', sourceColumnIds: [] });
	core.composites.push({ id: 'composite_1', name: 'C', memberIds: [] });
	markSessionSaved();
	return {
		plot: { obj: core.plots[0], field: 'name', node: { type: 'plot', plotObj: core.plots[0] } },
		tableprocess: {
			obj: core.tableProcesses[0],
			field: 'displayName',
			node: { type: 'tableprocess', tpObj: core.tableProcesses[0] }
		},
		process: {
			obj: core.orphanProcesses[0],
			field: 'displayName',
			node: { type: 'process', processObj: core.orphanProcesses[0] }
		},
		group: {
			obj: core.groups[0],
			field: 'name',
			node: { type: 'group', groupObj: core.groups[0] }
		},
		composite: {
			obj: core.composites[0],
			field: 'name',
			node: { type: 'composite', compositeObj: core.composites[0] }
		}
	};
}

const KINDS = ['plot', 'tableprocess', 'process', 'group', 'composite'];

describe('commitNodeRename', () => {
	it.each(KINDS)('%s: one undo step, an unsaved change, undo and redo', (kind) => {
		const { obj, field } = makeNodes()[kind];
		const before = obj[field];
		expect(hasUnsavedChanges()).toBe(false);
		commitNodeRename(kind, obj, '  Renamed  ');
		expect(obj[field]).toBe('Renamed');
		expect(history.undoCount).toBe(1);
		expect(hasUnsavedChanges()).toBe(true);
		history.undo();
		expect(obj[field]).toBe(before);
		history.redo();
		expect(obj[field]).toBe('Renamed');
	});

	it.each(KINDS)('%s: an empty field restores the default name', (kind) => {
		const { obj, field } = makeNodes()[kind];
		commitNodeRename(kind, obj, 'Renamed');
		commitNodeRename(kind, obj, '   ');
		expect(obj[field]).toBe(nodeDefaultName(kind, obj));
		expect(history.undoCount).toBe(2);
	});

	it('the default names are what a new node of each kind is called', () => {
		const n = makeNodes();
		expect(nodeDefaultName('plot', n.plot.obj)).toBe(`Scatterplot_${n.plot.obj.id}`);
		expect(new Plot({ type: 'scatterplot', plot: { data: [] } }).name).toMatch(/^Scatterplot_/);
		expect(nodeDefaultName('tableprocess', n.tableprocess.obj)).toBe(
			appConsts.tableProcessMap.get('Cosinor').displayName
		);
		expect(nodeDefaultName('process', n.process.obj)).toBe(
			appConsts.processMap.get('Add').displayName || 'Add'
		);
		expect(nodeDefaultName('group', n.group.obj)).toBe('Group');
		expect(nodeDefaultName('composite', n.composite.obj)).toBe('Composite');
	});

	it('renaming to the current name records nothing', () => {
		const { obj } = makeNodes().group;
		expect(commitNodeRename('group', obj, 'G')).toBeNull();
		expect(history.undoCount).toBe(0);
		expect(hasUnsavedChanges()).toBe(false);
	});
});

describe('setNodeName (the canvas editors)', () => {
	it.each(KINDS)('%s: nothing while typing, one step on commit', (kind) => {
		const { obj, field, node } = makeNodes()[kind];
		const before = obj[field];
		setNodeName(node, 'R');
		setNodeName(node, 'Re');
		expect(obj[field]).toBe(before);
		expect(history.undoCount).toBe(0);
		setNodeName(node, 'Renamed', { commit: true });
		expect(obj[field]).toBe('Renamed');
		expect(history.undoCount).toBe(1);
	});
});

describe('group card header rename (component)', () => {
	async function mountGroup() {
		const { group } = makeNodes();
		const node = { id: 'group_1', type: 'group', groupObj: group.obj, label: 'G' };
		const r = render(GroupNode, { props: { node } });
		flushSync();
		await tick();
		return { ...r, group: group.obj };
	}

	async function editTitle(container, text, key) {
		await fireEvent.dblClick(container.querySelector('.group-title [role=button]'));
		await tick();
		const input = container.querySelector('.group-title input');
		await fireEvent.input(input, { target: { value: text } });
		expect(core.groups[0].name).toBe('G'); // nothing while typing
		await fireEvent.keyDown(input, { key });
		flushSync();
		await tick();
	}

	it('Enter records one undoable rename and marks the session edited', async () => {
		const { container, group } = await mountGroup();
		await editTitle(container, 'Treatment', 'Enter');
		expect(group.name).toBe('Treatment');
		expect(history.undoCount).toBe(1);
		expect(hasUnsavedChanges()).toBe(true);
		history.undo();
		flushSync();
		expect(group.name).toBe('G');
		expect(container.querySelector('.group-title').textContent).toContain('G');
	});

	it('Escape leaves the group exactly as it was', async () => {
		const { container, group } = await mountGroup();
		await editTitle(container, 'Treatment', 'Escape');
		expect(group.name).toBe('G');
		expect(history.undoCount).toBe(0);
		expect(hasUnsavedChanges()).toBe(false);
	});

	it('an empty name gives the group its default name back', async () => {
		const { container, group } = await mountGroup();
		await editTitle(container, '', 'Enter');
		expect(group.name).toBe('Group');
	});
});

// The editor behind the plot title on the workspace, the plot's control banner and the Data
// panel's rows (inputs/Editable). With `onCommit`, the caller owns the write.
describe('inputs/Editable with onCommit', () => {
	async function edit(props, text, key) {
		const r = render(Editable, { props });
		await fireEvent.dblClick(r.container.querySelector('[role=button]'));
		await tick();
		const input = r.container.querySelector('input');
		await fireEvent.input(input, { target: { value: text } });
		await fireEvent.keyDown(input, { key });
		flushSync();
		await tick();
		return r;
	}

	it('Enter hands the text to onCommit and shows the stored value, not the typed one', async () => {
		const calls = [];
		const { container } = await edit(
			{ value: 'Plot A', onCommit: (v, o) => calls.push([v, o]) },
			'Typed',
			'Enter'
		);
		expect(calls).toEqual([['Typed', 'Plot A']]);
		// The caller stored nothing here, so the field shows the name it still has.
		expect(container.textContent).toContain('Plot A');
		expect(container.textContent).not.toContain('Typed');
	});

	it('Escape commits nothing', async () => {
		const calls = [];
		const { container } = await edit(
			{ value: 'Plot A', onCommit: (v) => calls.push(v) },
			'Typed',
			'Escape'
		);
		expect(calls).toEqual([]);
		expect(container.textContent).toContain('Plot A');
	});
});
