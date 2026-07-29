// The node header must be a drag handle.
//
// Reported: nodes could not be dragged by their top bar — the strip carrying the
// label and the buttons, which is the part of a node anyone would reach for.
//
// The card already handled dragging (`onCardMouseDown` → `cardmousedown`), and
// already protected the interactive bits with
//   NO_DRAG_SELECTOR = 'button, input, textarea, .port-dot, .editable-input'
// But `.tp-title` and `.note-slot` ALSO called stopPropagation on pointerdown,
// so a press on the header never reached the card at all. Those wrapper-level
// stops were redundant given the selector, and were the whole cause.
//
// A pure-function test cannot see this: it is entirely about whether a DOM event
// propagates. Hence a mount test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: new Map(), data: [], tableProcesses: [], nodeNotes: {} },
	appConsts: { tableProcessMap: new Map() },
	appState: {}
}));
vi.mock('$lib/core/Column.svelte', async () => {
	const actual = await vi.importActual('$lib/core/Column.svelte').catch(() => ({}));
	return { ...actual, getColumnById: (id) => mockColumns[id], default: actual.default };
});

const TableProcessNode = (await import('./TableProcessNode.svelte')).default;

function mkNode() {
	return {
		id: 'tableprocess_1',
		type: 'tableprocess',
		label: 'Cosinor',
		tpObj: { id: 1, name: 'Cosinor', displayName: 'Cosinor', warnings: [], args: { out: {} } },
		inputs: [],
		outputs: []
	};
}

/**
 * Press on `el` and report whether the event reached `.tp-card` — which is where
 * the drag handler lives. Anything that stops propagation on the way makes that
 * part of the node undraggable.
 */
function reachesCard(container, el) {
	const card = container.querySelector('.tp-card');
	let reached = false;
	card.addEventListener('pointerdown', () => (reached = true));
	el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
	return reached;
}

let rendered;
beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});
afterEach(() => cleanup());

describe('the node header is a drag handle', () => {
	function mount() {
		rendered = render(TableProcessNode, { props: { node: mkNode(), selected: false } });
		return rendered.container;
	}

	it('a press on the header strip reaches the card', () => {
		const c = mount();
		const header = c.querySelector('.tp-header');
		expect(header, 'no .tp-header rendered').toBeTruthy();
		expect(reachesCard(c, header)).toBe(true);
	});

	it('a press on the TITLE reaches the card (this was the reported failure)', () => {
		const c = mount();
		const title = c.querySelector('.tp-title');
		expect(title, 'no .tp-title rendered').toBeTruthy();
		expect(reachesCard(c, title)).toBe(true);
	});

	it('a press on the title TEXT reaches the card', () => {
		// The label renders as a span until you click to rename; dragging from the
		// visible text is the whole point of the fix.
		const c = mount();
		const span = c.querySelector('.tp-title .inline-edit-span') ?? c.querySelector('.tp-title');
		expect(reachesCard(c, span)).toBe(true);
	});

	it('a press on the note slot reaches the card', () => {
		const c = mount();
		const slot = c.querySelector('.note-slot');
		if (!slot) return; // slot only renders in some states
		expect(reachesCard(c, slot)).toBe(true);
	});
});

describe('interactive parts of the header still are not drag handles', () => {
	// The guard is NO_DRAG_SELECTOR inside onCardMouseDown, not stopPropagation,
	// so these still reach the card element — but the handler must decline them.
	// Asserting the selector itself keeps that contract visible.
	const NO_DRAG = 'button, input, textarea, .port-dot, .editable-input';

	it('buttons, inputs and ports are excluded from dragging', () => {
		const src = readSource();
		expect(src).toContain(NO_DRAG);
		expect(src).toMatch(/e\.target\?\.closest\?\.\(NO_DRAG_SELECTOR\)/);
	});

	it('no wrapper in the header re-introduces a blanket stopPropagation', () => {
		// The regression would be someone adding onpointerdown={stopPointer} back
		// onto the title or the note slot.
		const src = readSource();
		expect(src).not.toMatch(/class="tp-title"[^>]*onpointerdown=\{stopPointer\}/);
		expect(src).not.toMatch(/class="note-slot"[\s\S]{0,120}?onpointerdown=\{stopPointer\}/);
	});
});

function readSource() {
	const here = dirname(fileURLToPath(import.meta.url));
	return readFileSync(join(here, 'TableProcessNode.svelte'), 'utf8');
}

function readFile(name) {
	const here = dirname(fileURLToPath(import.meta.url));
	return readFileSync(join(here, name), 'utf8');
}

// The v69.1 fix covered TableProcessNode and GroupNode, and the tests above covered
// TableProcessNode only. WorkflowNode — which renders PLOT, data and note nodes — kept the
// same blanket stop on its title, so plot nodes stayed undraggable by their header and
// nothing failed. Reported 2026-07-29.
//
// WorkflowNode has no card handler of its own: its drag comes from .workflow-node-wrapper
// in WorkflowEditor. So the contract to pin is at BOTH ends — the title must not swallow
// pointerdown, and the wrapper handler must be the thing that excludes the rename input.
describe('the plot/data node header is a drag handle too', () => {
	it('no .node-label wrapper swallows pointerdown', () => {
		// This exact markup is the bug: it stops the press before the wrapper's drag
		// handler ever sees it.
		const src = readFile('WorkflowNode.svelte');
		expect(src).not.toMatch(/class="node-label"[^>]*onpointerdown/);
	});

	it('the parts that genuinely must not drag still stop it', () => {
		// Removing the title stop must not turn into removing every stop: the note
		// button, the type dropdown, the note body and the resize handle all own their
		// gestures.
		const src = readFile('WorkflowNode.svelte');
		for (const cls of ['note-slot', 'node-type', 'note-body', 'note-resize-handle']) {
			expect(src, `${cls} lost its pointerdown guard`).toMatch(
				new RegExp(`class="${cls}"[\\s\\S]{0,200}?onpointerdown`)
			);
		}
	});

	it('the wrapper handler excludes the controls a press must not drag', () => {
		// What makes dropping the title stop safe. If this guard goes, clicking a rename
		// field or a button starts dragging the node instead.
		const src = readFile('WorkflowEditor.svelte');
		expect(src).toMatch(/NODE_NO_DRAG_SELECTOR\s*=/);
		for (const part of ['button', 'input', 'textarea', '.port-dot', '.editable-input']) {
			expect(src, `${part} missing from NODE_NO_DRAG_SELECTOR`).toMatch(
				new RegExp(`NODE_NO_DRAG_SELECTOR\\s*=\\s*'[^']*${part.replace('.', '\\.')}`)
			);
		}
		expect(src).toMatch(/e\.target\?\.closest\?\.\(NODE_NO_DRAG_SELECTOR\)/);
	});
});
