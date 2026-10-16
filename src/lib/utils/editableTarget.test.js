// Which keys belong to a form field rather than to the app around it (utils/editableTarget.js).
//
// REPORTED (2026-10-17): Escape while typing in a plot's Y min box on the canvas cancelled the
// edit AND deselected the plot, closing its control panel, because the canvas's window Escape
// handler did not ask whether the key was the field's. The behaviour of each handler is tested
// beside it (WorkflowEditor: escapeInField.svelte.test.js; TourOverlay.svelte.test.js); the
// guard at the bottom keeps every window or document Escape handler deciding on purpose.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { isEditableTarget, isTextEntryTarget, yieldEscapeToField } from './editableTarget.js';

afterEach(() => {
	document.body.innerHTML = '';
});

function el(html) {
	document.body.insertAdjacentHTML('beforeend', html);
	return document.body.lastElementChild;
}
const key = (target, k = 'Escape') => {
	const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
	Object.defineProperty(e, 'target', { value: target });
	return e;
};

describe('isEditableTarget / isTextEntryTarget', () => {
	it.each([
		['<input>', true, true],
		['<input type="number">', true, true],
		['<input type="search">', true, true],
		['<textarea></textarea>', true, true],
		['<div contenteditable="true"></div>', true, true],
		['<select><option>a</option></select>', true, false],
		['<input type="checkbox">', true, false],
		['<input type="range">', true, false],
		['<input type="color">', true, false],
		['<button>b</button>', false, false],
		['<div tabindex="0"></div>', false, false]
	])('%s: editable %s, text entry %s', (html, editable, text) => {
		const node = el(html);
		// happy-dom does not derive isContentEditable from the attribute.
		if (node.hasAttribute('contenteditable'))
			Object.defineProperty(node, 'isContentEditable', { value: true });
		expect(isEditableTarget(node)).toBe(editable);
		expect(isTextEntryTarget(node)).toBe(text);
	});

	it('nothing focused is not a field', () => {
		expect(isEditableTarget(null)).toBe(false);
		expect(isTextEntryTarget(undefined)).toBe(false);
	});
});

describe('yieldEscapeToField', () => {
	it('Escape in a text box is the box: it is blurred so the next Escape reaches the app', () => {
		const box = el('<input type="number">');
		box.focus();
		expect(document.activeElement).toBe(box);
		expect(yieldEscapeToField(key(box))).toBe(true);
		expect(document.activeElement).not.toBe(box);
		// The next Escape comes from wherever focus went, not a field.
		expect(yieldEscapeToField(key(document.body))).toBe(false);
	});

	it('Escape in a select is the select', () => {
		const sel = el('<select><option>a</option></select>');
		expect(yieldEscapeToField(key(sel))).toBe(true);
	});

	it('an editor that removed its input on Escape (an inline rename) still owns the key', () => {
		const box = el('<input>');
		box.remove();
		expect(yieldEscapeToField(key(box))).toBe(true);
	});

	it('Escape on a checkbox, a button or the page is the app', () => {
		for (const html of ['<input type="checkbox">', '<button>b</button>', '<div></div>'])
			expect(yieldEscapeToField(key(el(html)))).toBe(false);
	});

	it('other keys are never yielded', () => {
		expect(yieldEscapeToField(key(el('<input>'), 'Delete'))).toBe(false);
	});
});

// Every window- or document-level keydown handler that acts on Escape either yields to a
// focused field (yieldEscapeToField) or is listed here with the reason it should not.
describe('guard: window and document Escape handlers decide about fields', () => {
	const here = dirname(fileURLToPath(import.meta.url));
	const src = resolve(here, '..', '..');
	const rel = (f) => relative(src, f);
	function files(dir, out = []) {
		for (const entry of readdirSync(dir)) {
			if (entry === 'node_modules' || entry.startsWith('.')) continue;
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) files(full, out);
			else if (/\.(svelte|js)$/.test(entry) && !/\.test\.|\.spec\.|conflicted/.test(entry))
				out.push(full);
		}
		return out;
	}
	const ALL = [...files(join(src, 'lib')), ...files(join(src, 'routes'))];
	const GLOBAL_KEYDOWN =
		/<svelte:(?:window|document)\b(?:(?!\/>)[\s\S])*?\bonkeydown\b|(?:document|window|doc)\.addEventListener\(\s*['"]keydown['"]/;

	const DOES_NOT_YIELD = {
		'lib/plots/plotEditScope.js':
			'it is the field side: Escape in a plot panel box puts the plot back to before the edit',
		'lib/components/views/StartScreen.svelte':
			'a modal launcher: Escape in its search box clears the query, and in an empty one ' +
			'closes the screen, as a command palette does',
		'lib/components/iconActions/SavePlot.svelte':
			'a modal dialog: nothing in its fields is applied until Save, so Escape from a field ' +
			'closes it, as the native dialog does',
		'lib/components/inputs/ColumnSelector.svelte':
			'an open dropdown: Escape closes it from its own filter box; its group-rename box is ' +
			'excluded by editingKey',
		'lib/components/workflow/NodeNoteButton.svelte':
			'a note popover: Escape closes it from its own text box, and preventDefault keeps the ' +
			'canvas from also deselecting'
	};

	const handlers = ALL.filter((f) => {
		const s = readFileSync(f, 'utf8');
		return GLOBAL_KEYDOWN.test(s) && /['"]Escape['"]/.test(s);
	}).map(rel);

	it('finds the canvas and the tour', () => {
		expect(handlers).toContain('lib/components/workflow/WorkflowEditor.svelte');
		expect(handlers).toContain('lib/components/tour/TourOverlay.svelte');
	});

	it('each one yields to a focused field, or says why not', () => {
		const undecided = handlers.filter(
			(f) =>
				!(f in DOES_NOT_YIELD) && !/yieldEscapeToField\(/.test(readFileSync(join(src, f), 'utf8'))
		);
		expect(undecided).toEqual([]);
	});

	it('no stale allowlist entries', () => {
		expect(Object.keys(DOES_NOT_YIELD).filter((f) => !handlers.includes(f))).toEqual([]);
	});
});
