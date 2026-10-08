// No keyboard shortcut may be bound to two different actions.
//
// REPORTED AS: "the demo data (cmd-shift-x) doesn't work".
//
// v73.1 moved the sample-data seeder from Cmd/Ctrl+Shift+S to Cmd/Ctrl+Shift+X,
// where a pre-existing branch already toggled `appState.showWorkflow` (the legacy
// fullscreen workflow modal). Nothing about either branch looked wrong on its own,
// and nothing in the file lists the bindings side by side, so the clash was
// invisible in review. One keypress then ran BOTH: the demo seeded a session while
// a second WorkflowEditor mounted over the canvas view's one, and the two editors'
// layout effects re-triggered each other until Svelte aborted with
// effect_update_depth_exceeded; the app froze half-built.
//
// A source-level check, because the bug is a property of the handler's SHAPE (two
// branches, same condition) rather than of anything a single dispatched event
// would reveal: dispatching Cmd+Shift+X on the fixed build looks identical to
// dispatching it on the broken one until you inspect which state changed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '+page.svelte'), 'utf8');

/** The body of `const onKeyDown = (event) => { ... }`, matched by brace depth. */
function keyHandlerBody(src) {
	const start = src.indexOf('const onKeyDown = (event) => {');
	expect(start, 'onKeyDown handler not found; has it been renamed?').toBeGreaterThan(-1);
	let i = src.indexOf('{', start);
	const open = i;
	let depth = 0;
	for (; i < src.length; i++) {
		if (src[i] === '{') depth++;
		else if (src[i] === '}' && --depth === 0) break;
	}
	return src.slice(open, i);
}

/**
 * Every `if (...)` condition in the handler, normalised to a comparable key:
 * modifiers present, plus the key/code it tests.
 */
function bindings(body) {
	const found = [];
	const re = /if \(([^\n]*(?:\n[^\n]*?)??)\) \{/g;
	let m;
	while ((m = re.exec(body))) {
		const cond = m[1].replace(/\s+/g, ' ');
		const key = cond.match(/event\.key\.toLowerCase\(\) === '(\w+)'/)?.[1];
		const code = cond.match(/event\.code === '(\w+)'/)?.[1];
		if (!key && !code) continue;
		if (!/MODIFIER/.test(cond)) continue;
		found.push(
			[
				/MODIFIER/.test(cond) ? 'mod' : '',
				/\bALT\b|event\.altKey/.test(cond) ? 'alt' : '',
				/&& event\.shiftKey/.test(cond) ? 'shift' : '',
				/!event\.shiftKey/.test(cond) ? 'noshift' : '',
				key ?? `code:${code}`
			].join('+')
		);
	}
	return found;
}

describe('the app-level keydown handler', () => {
	it('binds each shortcut exactly once', () => {
		const found = bindings(keyHandlerBody(source));
		expect(found.length).toBeGreaterThan(5); // the parser still finds the branches

		const seen = new Map();
		for (const b of found) seen.set(b, (seen.get(b) ?? 0) + 1);
		const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([b]) => b);

		expect(
			duplicates,
			`these shortcuts run more than one action: ${duplicates.join(', ')}`
		).toEqual([]);
	});

	it('leaves Cmd/Ctrl+Shift+X to the sample-data seeder alone', () => {
		const body = keyHandlerBody(source);
		const xBranches = [
			...body.matchAll(/if \([^)]*event\.key\.toLowerCase\(\) === 'x'[^)]*\) \{/g)
		];
		expect(xBranches).toHaveLength(1);
		// …and it must not be the one that mounts a second WorkflowEditor.
		const after = body.slice(xBranches[0].index, xBranches[0].index + 220);
		expect(after).toContain('refresh()');
		expect(after).not.toContain('showWorkflow');
	});

	/** The condition of the one `if (...)` branch bound to `key`, whitespace-normalised. */
	function branchFor(body, key, { shift }) {
		const re = /if \(([^\n]*(?:\n[^\n]*?)??)\) \{/g;
		const hits = [];
		let m;
		while ((m = re.exec(body))) {
			const cond = m[1].replace(/\s+/g, ' ');
			if (!cond.includes(`event.key.toLowerCase() === '${key}'`)) continue;
			if (shift !== /&& event\.shiftKey/.test(cond)) continue;
			hits.push(cond);
		}
		expect(hits, `expected one ${shift ? 'shift+' : ''}${key} branch`).toHaveLength(1);
		return hits[0];
	}

	// ROB-21: these are developer tools (state dump, demo seeder, test-JSON loader that
	// navigates away from the open session), so production builds must not bind them.
	it.each(['i', 'x', 'a'])('gates the Cmd/Ctrl+Shift+%s developer shortcut behind dev', (key) => {
		const cond = branchFor(keyHandlerBody(source), key, { shift: true });
		expect(cond).toMatch(/^dev && /);
	});

	// ROB-31: Cmd/Ctrl+Z (and Shift+Z) in a text field is the field's own text undo.
	it.each([
		['Z', false],
		['Shift+Z', true]
	])('leaves Cmd/Ctrl+%s to a focused text field', (_label, shift) => {
		const cond = branchFor(keyHandlerBody(source), 'z', { shift });
		expect(cond).toContain('!textFocused');
	});

	// New session: Cmd/Ctrl+Alt+N. Cmd/Ctrl+N and Cmd/Ctrl+Shift+N belong to the browser (new
	// window, private window) and cannot be taken by a page.
	it('binds Cmd/Ctrl+Alt+N to New session, in production, outside text fields', () => {
		const body = keyHandlerBody(source);
		const hits = [...body.matchAll(/if \(([^)]*event\.code === 'KeyN'[^)]*)\) \{/g)];
		expect(hits, 'expected exactly one KeyN branch').toHaveLength(1);
		const cond = hits[0][1].replace(/\s+/g, ' ');
		expect(cond).toMatch(/MODIFIER/);
		expect(cond).toMatch(/\bALT\b/);
		expect(cond).not.toMatch(/^dev && /);
		// A character typed into a field with these modifiers must stay a character.
		expect(cond).toContain('!editableFocused');
		const after = body.slice(hits[0].index, hits[0].index + 200);
		expect(after).toContain('newSession()');
	});

	it('does not read AltGr (Ctrl+Alt on Windows) as Alt', () => {
		const body = keyHandlerBody(source);
		expect(body).toMatch(/const ALT = event\.altKey && !event\.getModifierState\?\.\('AltGraph'\)/);
	});
});
