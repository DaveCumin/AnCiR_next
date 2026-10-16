// @ts-nocheck
/**
 * Renaming a column is one undo step and an unsaved change.
 *
 * REPORTED (reproduced 2026-10-16, headless Chromium): renaming a column on a group card wrote
 * `customName` straight onto the column. Undo did nothing (no operation was recorded) and the
 * session did not count as edited, so New session or closing the tab lost the rename without
 * a prompt. Escape after typing also pinned the old text as a typed name. The same direct
 * write sat behind every column rename editor (node output rows, the Data panel, a data
 * node's header, a Table header), and none of them was recorded either.
 *
 * Every editor now commits through columnLabels.commitColumnRename: one renameColumn
 * operation on Enter or blur, nothing while typing.
 *
 * An imported column's name is NOT in customName: Column's constructor assigns it straight onto
 * the `name` derived (a Svelte override). Undoing its first rename must give that name back,
 * not "Unnamed".
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core } from '$lib/core/core.svelte.js';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import {
	initUnsavedChanges,
	markSessionSaved,
	hasUnsavedChanges
} from '$lib/core/unsavedChanges.svelte.js';
import { commitColumnRename, renameTarget } from '$lib/core/columnLabels.js';
import { setNodeName } from '$lib/core/nodeNaming.js';
import GroupNode from '$lib/components/workflow/GroupNode.svelte';

/** A column as an import makes it: the name given to the constructor, customName null. */
function imported(name, values = [1, 2, 3]) {
	const c = new Column({ type: 'number', data: -1, name });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	markSessionSaved(); // the session as loaded: adding the column is not the edit under test
	return c;
}

beforeAll(() => {
	history.init();
	initUnsavedChanges();
});
beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	core.groups = [];
	history.clear();
});
afterEach(() => cleanup());

describe('commitColumnRename', () => {
	it('is one undo step, counts as unsaved, and undo gives an imported name back', () => {
		const col = imported('activity');
		expect(col.customName).toBeNull();
		const undo0 = history.undoCount;

		commitColumnRename(col, '  wheel  ');
		expect(col.name).toBe('wheel');
		expect(history.undoCount).toBe(undo0 + 1);
		expect(hasUnsavedChanges()).toBe(true);

		history.undo();
		expect(getColumnById(col.id).name).toBe('activity');
		history.redo();
		expect(getColumnById(col.id).name).toBe('wheel');
	});

	it('changes nothing for the same name or an empty field on an imported column', () => {
		const col = imported('activity');
		const undo0 = history.undoCount;
		commitColumnRename(col, 'activity');
		commitColumnRename(col, '   ');
		expect(col.name).toBe('activity');
		expect(history.undoCount).toBe(undo0);
		expect(hasUnsavedChanges()).toBe(false);
	});

	it('an empty field clears a node output back to its derived name', () => {
		const col = imported('x');
		col.producerNodeId = 'tp_1';
		col.customName = 'mine';
		expect(renameTarget(col, '')).toBeNull();
		commitColumnRename(col, '');
		expect(col.customName).toBeNull();
		history.undo();
		expect(col.customName).toBe('mine');
	});

	it('a data node header rename commits once, not per keystroke', () => {
		const col = imported('activity');
		const node = { type: 'data', refId: col.id };
		const undo0 = history.undoCount;
		setNodeName(node, 'w');
		setNodeName(node, 'wh');
		expect(col.name).toBe('activity'); // nothing while typing
		setNodeName(node, 'wheel', { commit: true });
		expect(col.name).toBe('wheel');
		expect(history.undoCount).toBe(undo0 + 1);
	});
});

describe('group card column rename', () => {
	async function mountGroup(col) {
		core.groups.push({
			id: 'group_t',
			name: 'g',
			x: 0,
			y: 0,
			width: 240,
			height: 180,
			sourceColumnIds: [col.id],
			allColumnIds: null,
			collapsed: false,
			rowState: {}
		});
		markSessionSaved();
		const node = { id: 'group_t', type: 'group', groupObj: core.groups[0], label: 'g' };
		const r = render(GroupNode, { props: { node } });
		flushSync();
		await tick();
		return r;
	}

	async function editRow(container, keysThen) {
		const span = container.querySelector('.row-name [role=button]');
		await fireEvent.dblClick(span);
		await tick();
		const input = container.querySelector('.row-name input');
		await fireEvent.input(input, { target: { value: 'renamed' } });
		await fireEvent.keyDown(input, { key: keysThen });
		flushSync();
		await tick();
	}

	it('Enter records one undoable rename and marks the session edited', async () => {
		const col = imported('activity');
		const { container } = await mountGroup(col);
		const undo0 = history.undoCount;
		await editRow(container, 'Enter');
		expect(col.name).toBe('renamed');
		expect(history.undoCount).toBe(undo0 + 1);
		expect(hasUnsavedChanges()).toBe(true);
		history.undo();
		flushSync();
		expect(col.name).toBe('activity');
		expect(container.querySelector('.row-name').textContent).toContain('activity');
	});

	it('Escape leaves the column exactly as it was', async () => {
		const col = imported('activity');
		const { container } = await mountGroup(col);
		const undo0 = history.undoCount;
		await editRow(container, 'Escape');
		expect(col.name).toBe('activity');
		expect(col.customName).toBeNull();
		expect(history.undoCount).toBe(undo0);
		expect(hasUnsavedChanges()).toBe(false);
	});
});
