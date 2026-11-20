// @vitest-environment node
//
// A guard that every control-panel field is programmatically named by its visible label
// (WCAG 1.3.1 Info and relationships, 4.1.2 Name, role, value; accessibility audit #7).
//
// The panels were written as <div class="control-input"><p>Label</p><Control/></div>: the
// <p> looked like a label but was not one, so a screen reader announced "combo box" or
// "edit text" with no name, and clicking the words did nothing. ControlInput
// (components/inputs/ControlInput.svelte) renders a real <label> around the control, or,
// for a control a wrapping label would break, a <div> whose label span names the control
// through aria-labelledby (components/inputs/controlLabel.js). By 2026-11-20 every panel
// field had moved over, and this test keeps it that way. It fails on:
//
//   1. a .control-input <div> whose first child is a <p> and which holds a form control
//      (an <input> other than a checkbox, a <select>, a <textarea>, or one of CONTROLS).
//      Use <ControlInput label="..."> instead (a rich label goes in its labelContent
//      snippet; a colour swatch or column picker needs associate={false}).
//   2. an empty <ControlInput ...></ControlInput>. It renders a label with nothing in it,
//      so it names nothing; the plot series rows put the label above a <Column> instead,
//      and need associate={false}, an id, and labelledby="<that id>" on the Column.
//   3. a wrapping <ControlInput> (associate not false) around one of NO_WRAP. Those render
//      a popup inside themselves, or already have a <label> of their own, so a wrapping
//      label turns a click on the popup into a click on its first button, or nests labels.
//
// Checkbox rows are a separate guard (components/checkboxLabels.test.js).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { parse } from 'svelte/compiler';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..', '..'); // src/

/** Input components that are a form control, as far as rule 1 goes. */
const CONTROLS = new Set([
	'AttributeSelect',
	'ColourPaletteSelect',
	'ColourPicker',
	'ColumnSelector',
	'DateTimeHrs',
	'NumberWithUnits',
	'Toggle'
]);

/** Components a wrapping <label> mis-handles (rule 3); each names itself from the context. */
const NO_WRAP = new Set(['ColourPaletteSelect', 'ColourPicker', 'ColumnSelector', 'Toggle']);

/**
 * Blocks that break rule 1 today in files the 2026-11-20 rollout could not touch (the modals
 * were another change's), as `<path from src/>|<the <p> label's text>` (not a line number, so
 * an edit above the block does not move it) with a reason. A ratchet: it only ever shrinks,
 * and a stale entry fails the test.
 * @type {Record<string, string>}
 */
const KNOWN = {
	'lib/components/views/modals/Settings.svelte|Default colour palette':
		'Move it to <ControlInput label="Default colour palette" associate={false}> ' +
		'(ColourPaletteSelect names its button from it).',
	'lib/components/views/modals/ImportData.svelte|Row':
		'The preview "Row [n] to m of N" range: wrap the number box in <ControlInput ' +
		'label="Row" associate={false}> (the row is laid out inline by its own style).'
};

function svelteSources(dir = srcRoot, out = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.') || entry.includes('conflicted')) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) svelteSources(full, out);
		else if (entry.endsWith('.svelte')) out.push(full);
	}
	return out;
}

const isBlank = (n) => (n.type === 'Text' && !n.data.trim()) || n.type === 'Comment';
const significant = (fragment) => (fragment?.nodes ?? []).filter((n) => !isBlank(n));

function attr(node, name) {
	return node.attributes?.find((a) => a.type === 'Attribute' && a.name === name);
}

/** The static text of an attribute, or null for an expression / absent attribute. */
function staticText(a) {
	if (!a || a.value === true) return null;
	const parts = Array.isArray(a.value) ? a.value : [a.value];
	return parts.every((p) => p.type === 'Text') ? parts.map((p) => p.data).join('') : null;
}

/** The raw source of an attribute value ("{labelUid}-x-{datum.x.id}"), for id matching. */
function rawValue(src, a) {
	if (!a || a.value === true) return null;
	const parts = Array.isArray(a.value) ? a.value : [a.value];
	if (!parts.length) return '';
	return src.slice(parts[0].start, parts[parts.length - 1].end);
}

function isControl(n) {
	if (n.type === 'Component') return CONTROLS.has(n.name);
	if (n.type !== 'RegularElement') return false;
	if (n.name === 'select' || n.name === 'textarea') return true;
	if (n.name !== 'input') return false;
	return staticText(attr(n, 'type')) !== 'checkbox';
}

/** Does a fragment hold a control, looking through blocks and elements? */
function holdsControl(nodes) {
	for (const n of nodes) {
		if (isControl(n)) return true;
		for (const key of ['fragment', 'consequent', 'alternate', 'body', 'fallback']) {
			if (n[key]?.nodes && holdsControl(n[key].nodes)) return true;
		}
	}
	return false;
}

/** The components a ControlInput wraps directly (looking through blocks, not elements). */
function directComponents(nodes, out = []) {
	for (const n of nodes) {
		if (n.type === 'Component') out.push(n.name);
		else if (n.type !== 'RegularElement') {
			for (const key of ['fragment', 'consequent', 'alternate', 'body', 'fallback']) {
				if (n[key]?.nodes) directComponents(n[key].nodes, out);
			}
		} else if (n.fragment?.nodes) directComponents(n.fragment.nodes, out);
	}
	return out;
}

/** The rule breaks in one component's source. */
function scanSource(src, rel) {
	const ast = parse(src, { modern: true });
	const line = (n) => src.slice(0, n.start).split('\n').length;
	const labelledby = new Set();
	const emptyInputs = [];
	const problems = [];

	const visit = (n) => {
		if (!n || typeof n !== 'object') return;
		if (Array.isArray(n)) return n.forEach(visit);
		if (n.type === 'RegularElement' || n.type === 'Component') {
			const lb = rawValue(src, attr(n, 'labelledby'));
			if (lb) labelledby.add(lb);
		}
		if (n.type === 'RegularElement' && n.name === 'div') {
			const cls = (staticText(attr(n, 'class')) ?? '').split(/\s+/);
			const kids = significant(n.fragment);
			if (
				cls.includes('control-input') &&
				kids[0]?.type === 'RegularElement' &&
				kids[0].name === 'p' &&
				holdsControl(kids.slice(1))
			) {
				const text = kids[0].fragment.nodes
					.map((t) => (t.type === 'Text' ? t.data : '{}'))
					.join('')
					.trim()
					.replace(/\s+/g, ' ');
				problems.push({
					at: `${rel}:${line(n)}`,
					key: `${rel}|${text}`,
					why: 'a <p> "label" beside a control: use <ControlInput>'
				});
			}
		}
		if (n.type === 'Component' && n.name === 'ControlInput') {
			const assoc = attr(n, 'associate');
			const associates = !(assoc && rawValue(src, assoc) === '{false}');
			const kids = significant(n.fragment).filter((k) => k.type !== 'SnippetBlock');
			if (!kids.length) {
				if (associates) {
					problems.push({
						at: `${rel}:${line(n)}`,
						why: 'an empty wrapping <ControlInput> labels nothing (needs associate={false} and an id)'
					});
				} else emptyInputs.push(n);
			} else if (associates) {
				const wrapped = directComponents(kids).filter((c) => NO_WRAP.has(c));
				if (wrapped.length) {
					problems.push({
						at: `${rel}:${line(n)}`,
						why: `a wrapping <ControlInput> around ${wrapped.join(', ')} (needs associate={false})`
					});
				}
			}
		}
		for (const key of Object.keys(n)) {
			if (key === 'parent' || key === 'metadata') continue;
			const v = n[key];
			if (v && typeof v === 'object') visit(v);
		}
	};
	visit(ast.fragment);

	for (const n of emptyInputs) {
		const id = rawValue(src, attr(n, 'id'));
		if (!id || !labelledby.has(id)) {
			problems.push({
				at: `${rel}:${line(n)}`,
				why: 'an empty <ControlInput associate={false}> whose id no labelledby= in the file points at'
			});
		}
	}
	return problems;
}

const scan = (file) => scanSource(readFileSync(file, 'utf8'), relative(srcRoot, file));

describe('control-panel labels name their controls', () => {
	const all = svelteSources().flatMap(scan);

	it('no field keeps an unassociated <p> label, an empty label, or a label around a popup', () => {
		const unexpected = all.filter((p) => !(p.key in KNOWN)).map((p) => `${p.at}  ${p.why}`);
		expect(unexpected, unexpected.join('\n')).toEqual([]);
	});

	it('KNOWN lists only blocks that still break a rule (it only shrinks)', () => {
		const found = new Set(all.map((p) => p.key));
		expect(Object.keys(KNOWN).filter((k) => !found.has(k))).toEqual([]);
	});

	it('the scan catches each pattern, and passes the fixed forms', () => {
		const breaks = (body) => scanSource(body, 'fixture.svelte').length;
		// 1. A <p> beside a control, also inside a block; a checkbox row or a readout is fine.
		expect(breaks('<div class="control-input"><p>A</p><select></select></div>')).toBe(1);
		expect(breaks('<div class="control-input"><p>A</p>{#if x}<ColumnSelector />{/if}</div>')).toBe(
			1
		);
		expect(breaks('<div class="control-input"><p>Mesor: {m}</p></div>')).toBe(0);
		expect(
			breaks('<div class="control-input"><p>A</p><label><input type="checkbox" /></label></div>')
		).toBe(0);
		expect(breaks('<ControlInput label="A"><select></select></ControlInput>')).toBe(0);
		// 2. An empty label, unless it is a named id some labelledby= points at.
		expect(breaks('<ControlInput label="x"></ControlInput><Column />')).toBe(1);
		expect(
			breaks('<ControlInput label="x" associate={false} id="a"></ControlInput><Column />')
		).toBe(1);
		expect(
			breaks(
				'<ControlInput label="x" associate={false} id="{u}-x"></ControlInput>' +
					'<Column labelledby="{u}-x" />'
			)
		).toBe(0);
		// 3. A wrapping label around a picker with a popup.
		expect(breaks('<ControlInput label="C"><ColourPicker /></ControlInput>')).toBe(1);
		expect(
			breaks('<ControlInput label="C" associate={false}><ColourPicker /></ControlInput>')
		).toBe(0);
	});
});
