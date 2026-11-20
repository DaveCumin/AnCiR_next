// @ts-nocheck
// Every analysis input shows a name for people on the canvas (core/inputPortDisplay.js), never
// its internal arg key: xIN / yIN show as x / y, as a plot's ports do, and any other port
// declares a short `display` on its nodeSpec input. Display only: the port names (session JSON
// keys, wiring ids, MCP params) stay as they are.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inputPortDisplay, DEFAULT_INPUT_DISPLAY } from './inputPortDisplay.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';

describe('inputPortDisplay', () => {
	it('x / y for the shared inputs, a declared display first, else the name', () => {
		expect(inputPortDisplay({ name: 'xIN' })).toBe('x');
		expect(inputPortDisplay({ name: 'yIN' })).toBe('y');
		expect(inputPortDisplay({ name: 'yIN', display: 'columns' })).toBe('columns');
		expect(inputPortDisplay({ name: 'input' })).toBe('input');
		expect(inputPortDisplay(null)).toBe('');
		expect(Object.isFrozen(DEFAULT_INPUT_DISPLAY)).toBe(true);
	});
});

describe('every analysis input shows a canvas name, not its internal key', () => {
	let registry;
	beforeAll(async () => {
		registry = await loadTableProcesses();
	});

	it('no input label is an arg key (…IN, camelCase); each is short and starts lowercase', () => {
		const bad = [];
		for (const [id, entry] of registry.entries()) {
			for (const spec of entry?.nodeSpec?.inputs ?? []) {
				const shown = inputPortDisplay(spec);
				const internal = /IN$/.test(shown) || /[a-z][A-Z]/.test(shown);
				// Short enough for the card's input column (it shares the row with the outputs);
				// lowercase like a plot's x / y ("time A" keeps its capital letter).
				if (internal || shown.length > 12 || !/^[a-z]/.test(shown))
					bad.push(`${id}.${spec.name} -> "${shown}"`);
			}
		}
		expect(bad).toEqual([]);
	});

	it('the node manifest carries the canvas name as `display` (the handbook shows it)', () => {
		const manifest = JSON.parse(readFileSync(join(process.cwd(), 'static/nodes.json'), 'utf8'));
		const cosinor = manifest.nodes.find((n) => n.id === 'Cosinor');
		expect(cosinor.inputs.map((p) => [p.name, p.display])).toEqual([
			['xIN', 'x'],
			['yIN', 'y']
		]);
	});
});
