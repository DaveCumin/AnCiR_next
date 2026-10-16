// @ts-nocheck
// Escape on the canvas: in a field it cancels that edit only; the next Escape deselects.
//
// REPORTED (2026-10-17): Escape while typing in a plot's Y min box (the control panel) put the
// value back AND deselected the plot, closing the panel, because the canvas's window Escape
// handler did not ask whether the key belonged to a field (utils/editableTarget.js). The same
// held for a node's inline editors. The end-to-end check, with the real panel and real keys,
// is tests/e2e/plot-limit-entry.spec.js.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import WorkflowEditor from './WorkflowEditor.svelte';

const DEMOS = join(process.cwd(), 'static', 'sessions', 'demos');
const demo = (name) => JSON.parse(readFileSync(join(DEMOS, name), 'utf8'));

async function settle() {
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 20));
	}
	flushSync();
}

function escape(target) {
	const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
	target.dispatchEvent(e);
	flushSync();
	return e;
}

let plotNodeId;
beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	history.init();
});

beforeEach(async () => {
	render(WorkflowEditor, { props: { inline: true } });
	await settle();
	await importJson(demo('demo-process-add.json'));
	await settle();
	plotNodeId = `plot_${core.plots[0].id}`;
	appState.canvasSelectedNodeId = plotNodeId;
	flushSync();
});

afterEach(() => {
	appState.canvasSelectedNodeId = null;
	cleanup();
	document.body.innerHTML = '';
});

describe('Escape on the canvas', () => {
	it('outside a field, deselects', () => {
		escape(document.body);
		expect(appState.canvasSelectedNodeId).toBe(null);
	});

	it.each([
		['a number box', '<input type="number">'],
		['a text box', '<input>'],
		['a textarea', '<textarea></textarea>'],
		['a select', '<select><option>a</option></select>']
	])('in %s, keeps the selection and leaves the field; the next Escape deselects', (_n, html) => {
		document.body.insertAdjacentHTML('beforeend', html);
		const field = document.body.lastElementChild;
		field.focus();
		escape(field);
		expect(appState.canvasSelectedNodeId).toBe(plotNodeId);
		expect(document.activeElement).not.toBe(field);

		escape(document.activeElement ?? document.body);
		expect(appState.canvasSelectedNodeId).toBe(null);
	});

	it('an inline editor that removed its input on Escape does not deselect', () => {
		const field = document.createElement('input');
		document.body.append(field);
		field.addEventListener('keydown', () => field.remove());
		escape(field);
		expect(appState.canvasSelectedNodeId).toBe(plotNodeId);
	});

	it('on a checkbox, deselects (nothing to cancel there)', () => {
		document.body.insertAdjacentHTML('beforeend', '<input type="checkbox">');
		escape(document.body.lastElementChild);
		expect(appState.canvasSelectedNodeId).toBe(null);
	});

	it('handled by a popup first (preventDefault) does not also deselect', () => {
		const btn = document.createElement('button');
		document.body.append(btn);
		btn.addEventListener('keydown', (e) => e.preventDefault());
		escape(btn);
		expect(appState.canvasSelectedNodeId).toBe(plotNodeId);
	});
});
