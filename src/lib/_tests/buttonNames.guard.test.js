// @vitest-environment node
//
// Every button has a name (ROB-29, WCAG 4.1.2 Name, Role, Value).
//
// An icon-only button (`<button><Icon name="trash" /></button>`) is announced by a screen reader
// as a bare "button": nothing says it deletes. The 2026-10 review counted 93 of them; the last
// 26 were named on 2026-11-20. This guard parses every component under src/ with the Svelte
// compiler and fails on a <button> (or an element with role="button") that has no text of its
// own and none of the app's ways to name it:
//
//   {@attach tooltip('Delete the column')}   the app's convention (utils/tooltip.js): a hover and
//                                             keyboard-focus tooltip that also becomes the
//                                             aria-label of a host with no name of its own;
//   aria-label / aria-labelledby;
//   title (a name of last resort; prefer the tooltip, which keyboard users can see too).
//
// Text counts when it is static text, an expression ({label}), a rendered snippet, an <svg> with
// a <title>, an <img> with alt text, or any component other than <Icon> (which only draws a
// glyph). A spread ({...props}) is trusted, since the name may be in it.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { parse } from 'svelte/compiler';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(resolve(here, '..', '..', '..'), 'src');

function components(dir = srcRoot, out = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.') || entry.includes('conflicted')) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) components(full, out);
		else if (entry.endsWith('.svelte')) out.push(full);
	}
	return out;
}

const attrs = (node) => node.attributes ?? [];
const staticValue = (a) =>
	Array.isArray(a.value) && a.value.every((v) => v.type === 'Text')
		? a.value.map((v) => v.data).join('')
		: null;

/** The element names itself through an attribute, the tooltip attachment or a spread. */
function namedByAttribute(node) {
	return attrs(node).some(
		(a) =>
			a.type === 'AttachTag' ||
			a.type === 'SpreadAttribute' ||
			(a.type === 'Attribute' && ['aria-label', 'aria-labelledby', 'title'].includes(a.name))
	);
}

/** Whether `nodes` render text a screen reader would read as the name. */
function hasText(nodes = []) {
	for (const c of nodes) {
		if (c.type === 'Text' && c.data.trim()) return true;
		if (c.type === 'ExpressionTag' || c.type === 'RenderTag' || c.type === 'HtmlTag') return true;
		if (c.type === 'Component' && c.name !== 'Icon') return true;
		if (c.type === 'RegularElement') {
			if (attrs(c).some((a) => a.type === 'Attribute' && a.name === 'aria-hidden')) continue;
			if (c.name === 'svg') {
				if (c.fragment.nodes.some((n) => n.type === 'RegularElement' && n.name === 'title'))
					return true;
				continue;
			}
			if (c.name === 'img') {
				const alt = attrs(c).find((a) => a.type === 'Attribute' && a.name === 'alt');
				if (alt && (staticValue(alt) === null || staticValue(alt).trim())) return true;
				continue;
			}
			if (hasText(c.fragment?.nodes)) return true;
		}
		if (c.type === 'IfBlock' && (hasText(c.consequent?.nodes) || hasText(c.alternate?.nodes)))
			return true;
		if ((c.type === 'EachBlock' || c.type === 'KeyBlock') && hasText((c.body ?? c.fragment)?.nodes))
			return true;
	}
	return false;
}

function isButton(node) {
	if (node.type !== 'RegularElement') return false;
	if (node.name === 'button') return true;
	const role = attrs(node).find((a) => a.type === 'Attribute' && a.name === 'role');
	return !!role && staticValue(role) === 'button';
}

function unnamedButtons(file) {
	const source = readFileSync(file, 'utf8');
	const ast = parse(source, { modern: true, filename: file });
	const found = [];
	const walk = (node) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) return node.forEach(walk);
		if (isButton(node) && !namedByAttribute(node) && !hasText(node.fragment?.nodes)) {
			found.push(`${relative(srcRoot, file)}:${source.slice(0, node.start).split('\n').length}`);
		}
		for (const [k, v] of Object.entries(node))
			if (k !== 'parent' && v && typeof v === 'object') walk(v);
	};
	walk(ast.fragment);
	return found;
}

describe('every button has a name', { timeout: 60_000 }, () => {
	it('finds components to scan (guards against the walk matching nothing)', () => {
		expect(components().length).toBeGreaterThan(150);
	});

	it('no icon-only button is left without a name', () => {
		const unnamed = components().flatMap(unnamedButtons);
		expect(
			unnamed,
			'Buttons with no name (add {@attach tooltip(...)} or aria-label; see this file):\n\n' +
				unnamed.join('\n')
		).toEqual([]);
	});

	it('catches the patterns it is meant to', () => {
		const probe = (markup) => {
			const ast = parse(markup, { modern: true });
			const btn = ast.fragment.nodes.find(isButton);
			return !namedByAttribute(btn) && !hasText(btn.fragment.nodes);
		};
		expect(probe('<button><Icon name="trash" /></button>')).toBe(true);
		expect(probe('<div role="button" tabindex="0"><Icon name="x" /></div>')).toBe(true);
		expect(probe('<button><span aria-hidden="true">✕</span></button>')).toBe(true);
		expect(probe('<button {@attach tooltip(\'Delete\')}><Icon name="trash" /></button>')).toBe(
			false
		);
		expect(probe('<button aria-label="Delete"><Icon name="trash" /></button>')).toBe(false);
		expect(probe('<button>Delete</button>')).toBe(false);
		expect(probe('<button>{label}</button>')).toBe(false);
		expect(probe('<button><Icon name="add" /> Add</button>')).toBe(false);
	});
});
