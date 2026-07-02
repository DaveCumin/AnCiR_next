import { describe, it, expect } from 'vitest';
import { sessionToPython } from './pythonExport.js';

// A tiny stand-in for tools/ancir_runtime.py: enough to exercise the import
// stripping and confirm the body is inlined verbatim.
const FAKE_RUNTIME = [
	'from __future__ import annotations',
	'import math',
	'import numpy as np',
	'import pandas as pd',
	'from scipy import optimize as sp_optimize',
	'from typing import Any',
	'',
	'class Column:',
	'    pass',
	'',
	'def run_table_process(name, args, cols, raw, stored):',
	'    return True'
].join('\n');

const SESSION = {
	rawData: { 36: [0, 1, 2], 37: [5, 6, 7] },
	data: [
		{ id: 36, name: 'x', type: 'number', data: 36, processes: [] },
		// A referential column with a null-valued field (compression) that must be dropped.
		{ id: 37, name: 'y', type: 'number', refId: 37, processes: [{ funcname: 'add', name: 'Add', args: { n: 5 } }] }
	],
	tableProcesses: [{ name: 'Cosinor', args: { xIN: 36, yIN: [37], useFixedPeriod: true } }],
	plots: [{ id: 1, type: 'scatterplot' }],
	storedValues: { foo: 42 }
};

// Pull the value embedded via `NAME = json.loads("<json text>")` back out.
function extractEmbedded(script, name) {
	const m = script.match(new RegExp(`${name} = json\\.loads\\((".*?")\\)\\n`));
	if (!m) return undefined;
	return JSON.parse(JSON.parse(m[1])); // outer: JS string literal → json text; inner: value
}

describe('sessionToPython', () => {
	const out = sessionToPython(SESSION, FAKE_RUNTIME);

	it('emits a runnable Python header', () => {
		expect(out.startsWith('#!/usr/bin/env python3')).toBe(true);
		expect(out).toContain('import numpy as np');
		expect(out).toContain('from scipy import optimize as sp_optimize, stats as sp_stats');
		expect(out).toMatch(/def main\(\):/);
		expect(out.trimEnd().endsWith('main()')).toBe(true);
	});

	it('inlines the runtime body but strips its numpy/pandas/scipy/__future__ imports', () => {
		expect(out).toContain('class Column:');
		expect(out).toContain('def run_table_process(');
		expect(out).toContain('from typing import Any'); // non-numeric import kept
		expect(out).toContain('import math'); // HEADER's math import
		// The runtime's OWN numpy/scipy/__future__ import lines are removed (HEADER
		// supplies them once). Only the header copies remain.
		expect(out.match(/^import numpy as np$/gm)).toHaveLength(1);
		expect(out).not.toContain('from scipy import optimize as sp_optimize\n');
		// Exactly one `from __future__` survives — HEADER's; the runtime's was stripped.
		expect(out.match(/^from __future__/gm)).toHaveLength(1);
	});

	it('embeds the session data and reconstructs it losslessly', () => {
		expect(extractEmbedded(out, 'RAW_DATA')).toEqual({ 36: [0, 1, 2], 37: [5, 6, 7] });
		expect(extractEmbedded(out, 'TABLE_PROCESSES')).toEqual([
			{ name: 'Cosinor', args: { xIN: 36, yIN: [37], useFixedPeriod: true } }
		]);
		expect(extractEmbedded(out, 'PLOTS')).toEqual([{ id: 1, type: 'scatterplot' }]);
		expect(extractEmbedded(out, 'STORED_VALUES')).toEqual({ foo: 42 });
	});

	it('builds column metadata, dropping null fields but always keeping processes', () => {
		const meta = extractEmbedded(out, '_COL_META_RAW');
		expect(meta['36']).toEqual({
			name: 'x',
			type: 'number',
			data: 36,
			binWidth: 1.0,
			processes: []
		});
		// col 37 has no `data`/`compression`/`timeFormat` → those keys are absent;
		// processes are mapped to {funcname,name,args}.
		expect(meta['37']).toEqual({
			name: 'y',
			type: 'number',
			binWidth: 1.0,
			refId: 37,
			processes: [{ funcname: 'add', name: 'Add', args: { n: 5 } }]
		});
		expect('compression' in meta['37']).toBe(false);
	});

	it('re-ints the embedded string keys in the generated script', () => {
		expect(out).toContain(
			"RAW_DATA = {int(k) if k.lstrip('-').isdigit() else k: v for k, v in RAW_DATA.items()}"
		);
		expect(out).toContain('COLUMN_META = {int(k): v for k, v in _COL_META_RAW.items()}');
	});

	it('flattens legacy grouped `tables` into TABLE_PROCESSES', () => {
		const legacy = sessionToPython(
			{ tables: [{ processes: [{ name: 'Sort', args: { by: 1 } }] }] },
			FAKE_RUNTIME
		);
		expect(extractEmbedded(legacy, 'TABLE_PROCESSES')).toEqual([{ name: 'Sort', args: { by: 1 } }]);
	});

	it('rejects bad input', () => {
		expect(() => sessionToPython(null, FAKE_RUNTIME)).toThrow();
		expect(() => sessionToPython({}, '')).toThrow();
	});
});
