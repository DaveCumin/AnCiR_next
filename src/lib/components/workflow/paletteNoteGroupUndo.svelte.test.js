// @ts-nocheck
// A note or group added from a palette is one undo step: Cmd+Z removes it and Cmd+Shift+Z
// brings it back with the same id and position. They used to be written straight into
// core, so undo skipped them (and undid whatever came before instead).
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import NodePalette from './NodePalette.svelte';
import WorksheetAddPalette from '$lib/components/views/WorksheetAddPalette.svelte';
import { core } from '$lib/core/core.svelte.js';
import { history } from '$lib/core/opHistory.svelte.js';

beforeAll(() => history.init());
beforeEach(() => {
	core.notes.length = 0;
	core.groups.length = 0;
	history.clear();
});
afterEach(() => cleanup());

const settle = async () => {
	flushSync();
	await tick();
};
const json = (v) => JSON.parse(JSON.stringify(v));

async function pickFromNodePalette(type) {
	const { getByTestId } = render(NodePalette, { props: {} });
	await fireEvent.click(getByTestId('palette-trigger'));
	await settle();
	await fireEvent.click(getByTestId(`palette-item-${type}`));
	await settle();
}

describe('palette notes and groups are undoable', () => {
	it('NodePalette: a note is one undo step, and redo restores it', async () => {
		await pickFromNodePalette('note');
		expect(core.notes).toHaveLength(1);
		const before = json(core.notes[0]);
		history.undo();
		expect(core.notes).toHaveLength(0);
		history.redo();
		expect(core.notes).toHaveLength(1);
		expect(json(core.notes[0])).toEqual(before);
	});

	it('NodePalette: a group is one undo step, and redo restores it', async () => {
		await pickFromNodePalette('group');
		expect(core.groups).toHaveLength(1);
		const before = json(core.groups[0]);
		history.undo();
		expect(core.groups).toHaveLength(0);
		history.redo();
		expect(core.groups).toHaveLength(1);
		expect(json(core.groups[0])).toEqual(before);
	});

	it('WorksheetAddPalette: a note is one undo step, and redo restores it', async () => {
		const { container } = render(WorksheetAddPalette, { props: { open: true } });
		await settle();
		const tile = [...container.querySelectorAll('.palette-tile')].find(
			(b) => b.querySelector('.palette-tile-name')?.textContent.trim() === 'Note'
		);
		expect(tile).toBeTruthy();
		await fireEvent.click(tile);
		await settle();
		expect(core.notes).toHaveLength(1);
		const before = json(core.notes[0]);
		history.undo();
		expect(core.notes).toHaveLength(0);
		history.redo();
		expect(json(core.notes)).toEqual([before]);
	});
});
