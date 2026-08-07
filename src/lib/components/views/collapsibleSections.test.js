// Collapsing is applied by DELEGATION from the panel container, so the things worth pinning are
// the rules that decide whether a click means "collapse": which element was hit, whether it was
// a control inside the title, and whether the state survives the panel re-rendering.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	collapsibleSections,
	collapsedSections,
	syncCollapsedState,
	toggleSection,
	isCollapsed
} from './collapsibleSections.svelte.js';

/** A panel holding one section per title given, shaped exactly like the real markup. */
function panel(...titles) {
	const root = document.createElement('div');
	root.innerHTML = titles
		.map(
			(t) => `
		<div class="control-component">
			<div class="control-component-title"><p>${t}</p><button class="icon">x</button></div>
			<div class="control-input"><input type="text" /></div>
		</div>`
		)
		.join('');
	document.body.appendChild(root);
	return root;
}

const titleOf = (root, i = 0) => root.querySelectorAll('.control-component-title')[i];
const sectionOf = (root, i = 0) => root.querySelectorAll('.control-component')[i];
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

let handle;
let root;
afterEach(() => {
	handle?.destroy();
	handle = null;
	root?.remove();
	root = null;
});

beforeEach(() => {
	collapsedSections.clear();
});

describe('what a click means', () => {
	it('collapses the section whose title was clicked, and only that one', () => {
		root = panel('Padding', 'X-axis');
		handle = collapsibleSections(root);
		click(titleOf(root, 0).querySelector('p'));
		expect(sectionOf(root, 0).getAttribute('data-collapsed')).toBe('true');
		expect(sectionOf(root, 1).getAttribute('data-collapsed')).toBe('false');
	});

	it('expands again on a second click', () => {
		root = panel('Padding');
		handle = collapsibleSections(root);
		click(titleOf(root).querySelector('p'));
		click(titleOf(root).querySelector('p'));
		expect(sectionOf(root).getAttribute('data-collapsed')).toBe('false');
	});

	it('IGNORES a click on a control inside the title', () => {
		// Titles carry auto-scale buttons, colour swatches and delete actions. Collapsing the
		// section because one of those was pressed would be maddening.
		root = panel('Padding');
		handle = collapsibleSections(root);
		click(titleOf(root).querySelector('button'));
		expect(sectionOf(root).getAttribute('data-collapsed')).toBe('false');
	});

	it('ignores a click on the section BODY', () => {
		root = panel('Padding');
		handle = collapsibleSections(root);
		click(root.querySelector('.control-input input'));
		expect(sectionOf(root).getAttribute('data-collapsed')).toBe('false');
	});
});

describe('keyboard', () => {
	const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

	it('toggles on Enter and Space', () => {
		root = panel('Padding');
		handle = collapsibleSections(root);
		key(titleOf(root), 'Enter');
		expect(isCollapsed('Padding')).toBe(true);
		key(titleOf(root), ' ');
		expect(isCollapsed('Padding')).toBe(false);
	});

	it('leaves a space typed into a control alone', () => {
		root = panel('Padding');
		handle = collapsibleSections(root);
		const e = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
		root.querySelector('input').dispatchEvent(e);
		expect(e.defaultPrevented).toBe(false);
		expect(isCollapsed('Padding')).toBe(false);
	});
});

describe('surviving a re-render', () => {
	it('re-applies to sections rebuilt with the same titles', () => {
		// The panel rebuilds on every selection and tab change, which drops the attributes. A
		// section the user shut must come back shut.
		root = panel('Padding');
		handle = collapsibleSections(root);
		click(titleOf(root).querySelector('p'));
		root.innerHTML = '';
		const rebuilt = panel('Padding');
		root.appendChild(rebuilt.firstElementChild ?? rebuilt);
		syncCollapsedState(root);
		expect(root.querySelector('.control-component').getAttribute('data-collapsed')).toBe('true');
		rebuilt.remove();
	});

	it('is keyed on the title text, so it applies across plots of the same type', () => {
		toggleSection('X-axis');
		root = panel('X-axis');
		handle = collapsibleSections(root);
		expect(sectionOf(root).getAttribute('data-collapsed')).toBe('true');
	});
});

describe('accessibility and teardown', () => {
	it('marks titles as buttons and reports their state', () => {
		root = panel('Padding');
		handle = collapsibleSections(root);
		expect(titleOf(root).getAttribute('role')).toBe('button');
		expect(titleOf(root).getAttribute('tabindex')).toBe('0');
		expect(titleOf(root).getAttribute('aria-expanded')).toBe('true');
		click(titleOf(root).querySelector('p'));
		expect(titleOf(root).getAttribute('aria-expanded')).toBe('false');
	});

	it('stops responding once destroyed', () => {
		// This codebase has already paid for listeners that outlived their component.
		root = panel('Padding');
		handle = collapsibleSections(root);
		handle.destroy();
		handle = null;
		click(titleOf(root).querySelector('p'));
		expect(isCollapsed('Padding')).toBe(false);
	});
});
