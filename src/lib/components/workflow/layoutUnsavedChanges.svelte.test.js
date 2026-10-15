// @ts-nocheck
// Moving a node on the workflow canvas is an unsaved change.
//
// REPORTED (verified 2026-10-08): move some nodes, then close the tab or press New session
// (Cmd/Ctrl+Alt+N), and the layout is gone without a prompt. unsavedChanges.svelte.js counted
// graph operations and the session's shape only; a node move is neither (the canvas writes
// core.nodeLayout directly).
//
// The other half matters as much: the canvas ALSO writes core.nodeLayout on its own while a
// session loads (adopting the saved layout, placing nodes the file has no position for,
// pushing apart overlaps). None of that may count, or every freshly opened example would ask
// before New session. So the mark is made where the USER's gesture ends, never from the
// layout effects, and this test drives both: a load settles clean, a drag does not.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts } from '$lib/core/core.svelte.js';
import {
	initUnsavedChanges,
	markSessionSaved,
	hasUnsavedChanges
} from '$lib/core/unsavedChanges.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import WorkflowEditor from './WorkflowEditor.svelte';

const DEMOS = join(process.cwd(), 'static', 'sessions', 'demos');
const demo = (name) => JSON.parse(readFileSync(join(DEMOS, name), 'utf8'));

async function settle() {
	for (let i = 0; i < 4; i++) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 30));
	}
	flushSync();
}

function pointer(type, target, x, y) {
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			cancelable: true,
			button: 0,
			pointerId: 1,
			clientX: x,
			clientY: y
		})
	);
	flushSync();
}

let container;
beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	history.init();
	initUnsavedChanges();
});

beforeEach(async () => {
	({ container } = render(WorkflowEditor, { props: { inline: true } }));
	await settle();
	// The user opens an example with the canvas already on screen.
	await importJson(demo('demo-workflow-rest-activity.json'));
	await settle();
});

afterEach(() => {
	cleanup();
	core.nodeLayout = {};
});

const editorEl = () => container.querySelector('.workflow-editor');
const firstNode = () => container.querySelector('.workflow-node-wrapper[data-node-id^="data_"]');

describe('node layout and unsaved changes', () => {
	it('opening a session, with the canvas laying it out, is not an unsaved change', () => {
		expect(Object.keys(core.nodeLayout).length).toBeGreaterThan(0);
		expect(hasUnsavedChanges()).toBe(false);
	});

	it('dragging a node is an unsaved change, and saving clears it', async () => {
		const node = firstNode();
		expect(node).toBeTruthy();
		const id = node.dataset.nodeId;
		const before = { ...core.nodeLayout[id] };

		pointer('pointerdown', node, 100, 100);
		pointer('pointermove', editorEl(), 160, 150);
		pointer('pointerup', editorEl(), 160, 150);
		await settle();

		expect(core.nodeLayout[id]).not.toEqual(before);
		expect(hasUnsavedChanges()).toBe(true);
		markSessionSaved();
		expect(hasUnsavedChanges()).toBe(false);
	});

	it('a click on a node (no movement) is not a change', async () => {
		const node = firstNode();
		pointer('pointerdown', node, 100, 100);
		pointer('pointerup', editorEl(), 101, 101);
		await settle();
		expect(hasUnsavedChanges()).toBe(false);
	});

	it('the Tidy layout button is a change', async () => {
		container.querySelector('button[aria-label="Tidy layout"]').click();
		await settle();
		expect(hasUnsavedChanges()).toBe(true);
	});
});
