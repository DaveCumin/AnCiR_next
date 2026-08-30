import { describe, it, expect } from 'vitest';
import { sessionToPython, sessionToPythonFiles } from './pythonExport.js';

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
		{
			id: 37,
			name: 'y',
			type: 'number',
			refId: 37,
			processes: [{ funcname: 'add', name: 'Add', args: { n: 5 } }]
		}
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

describe('sessionToPythonFiles', () => {
	it('with default options is exactly the single self-contained script', () => {
		const files = sessionToPythonFiles(SESSION, FAKE_RUNTIME);
		expect(files.map((f) => f.name)).toEqual(['session.py']);
		expect(files[0].text).toBe(sessionToPython(SESSION, FAKE_RUNTIME));
	});

	it('split mode emits a version-stamped helper plus a slim analysis script', () => {
		const files = sessionToPythonFiles(SESSION, FAKE_RUNTIME, { split: true, version: '9.9' });
		expect(files.map((f) => f.name)).toEqual(['analysis.py', 'ancir_helpers.py']);
		const analysis = files[0].text;
		const helpers = files[1].text;

		// The helper is the FULL runtime, verbatim, stamped at the end.
		expect(helpers).toContain(FAKE_RUNTIME);
		expect(helpers).toContain('ANCIR_HELPERS_VERSION = "9.9"');

		// The analysis file imports it, checks the version, and holds NO runtime
		// function definitions — only the data and the pipeline.
		expect(analysis).toContain('from ancir_helpers import *');
		expect(analysis).toContain('_EXPECTED_HELPERS_VERSION = "9.9"');
		expect(analysis).not.toContain('class Column');
		expect(analysis).not.toContain('def run_table_process');
		// Only the path resolvers and main() — no analysis functions.
		expect(analysis.match(/^def (\w+)/gm)).toEqual([
			'def _script_file',
			'def script_dir',
			'def main'
		]);
		expect(analysis).toMatch(/def main\(\):/);
		expect(analysis.trimEnd().endsWith('main()')).toBe(true);

		// The session data still travels with the analysis, unchanged.
		expect(extractEmbedded(analysis, 'RAW_DATA')).toEqual(SESSION.rawData);
	});

	it('keeps the helper importable: only comments precede the runtime', () => {
		// Anything but comments before the runtime would demote its module
		// docstring and make `from __future__` a SyntaxError.
		const files = sessionToPythonFiles(SESSION, FAKE_RUNTIME, { split: true });
		const helpers = files.find((f) => f.name === 'ancir_helpers.py').text;
		const preamble = helpers.slice(0, helpers.indexOf('from __future__'));
		for (const line of preamble.split('\n')) {
			expect(line === '' || line.startsWith('#')).toBe(true);
		}
	});

	it('stamps "dev" when no version is given', () => {
		const files = sessionToPythonFiles(SESSION, FAKE_RUNTIME, { split: true });
		expect(files[1].text).toContain('ANCIR_HELPERS_VERSION = "dev"');
	});

	it('rejects bad input', () => {
		expect(() => sessionToPythonFiles(null, FAKE_RUNTIME)).toThrow();
		expect(() => sessionToPythonFiles({}, '')).toThrow();
	});
});

describe('CSV data sidecar (Python)', () => {
	// One column of each classification: num (with a null), str (needing RFC-4180
	// quoting), then everything the CSV cannot represent losslessly.
	const CSV_SESSION = {
		rawData: {
			1: [0, 1.5, null],
			2: ['a', 'b,c', 'd"e'],
			3: [1, 'x'], // mixed types → inline
			4: ['ok', ''], // empty string (≡ padding cell) → inline
			5: [NaN], // non-finite → inline
			6: [], // empty → inline
			7: [9] // short num column → padded
		},
		data: [],
		tableProcesses: []
	};

	it('moves finite-number and non-empty-string columns to the CSV, keeps the rest inline', () => {
		const files = sessionToPythonFiles(CSV_SESSION, FAKE_RUNTIME, { dataAsCsv: true });
		expect(files.map((f) => f.name)).toEqual(['session.py', 'session_data.csv']);
		const script = files[0].text;
		expect(Object.keys(extractEmbedded(script, 'RAW_DATA'))).toEqual(['3', '4', '5', '6']);
		expect(extractEmbedded(script, 'CSV_COLUMNS')).toEqual([
			{ id: 1, kind: 'num', length: 3 },
			{ id: 2, kind: 'str', length: 3 },
			{ id: 7, kind: 'num', length: 1 }
		]);
		expect(script).toContain('pd.read_csv(script_dir() / "session_data.csv"');
	});

	it('writes null as empty cell, quotes per RFC 4180, and pads short columns', () => {
		const files = sessionToPythonFiles(CSV_SESSION, FAKE_RUNTIME, { dataAsCsv: true });
		const csv = files.find((f) => f.name === 'session_data.csv').text;
		expect(csv).toBe(
			'col_1,col_2,col_7\n' + '0,a,9\n' + '1.5,"b,c",\n' + ',"d""e",\n' // null → '', quoted comma + doubled quote, col_7 padded
		);
	});

	it('falls back to fully inline when no column qualifies (never ships an empty CSV)', () => {
		const s = { rawData: { 3: [1, 'x'] }, data: [], tableProcesses: [] };
		const files = sessionToPythonFiles(s, FAKE_RUNTIME, { dataAsCsv: true });
		expect(files.map((f) => f.name)).toEqual(['session.py']);
		expect(files[0].text).toBe(sessionToPython(s, FAKE_RUNTIME));
	});

	it('composes with split mode: helper + analysis + data', () => {
		const files = sessionToPythonFiles(CSV_SESSION, FAKE_RUNTIME, {
			split: true,
			dataAsCsv: true
		});
		expect(files.map((f) => f.name)).toEqual([
			'analysis.py',
			'ancir_helpers.py',
			'session_data.csv'
		]);
	});
});

// Mirror of the R exporter's v72.23 fixes: __file__ alone is undefined in a
// pasted REPL/notebook, so the scripts carry an ANCIR_DIR override plus a
// guarded fallback; and huge json.loads embeds are wrapped across lines.
describe('script directory resolution and line wrapping (Python)', () => {
	const session = {
		rawData: { 1: [1, 2, 3] },
		data: [{ id: 1, name: 'x', type: 'number', data: 1, processes: [] }],
		tableProcesses: []
	};

	function allShapes(s) {
		return [
			sessionToPythonFiles(s, PY_RT),
			sessionToPythonFiles(s, PY_RT, { split: true, version: '9.9' }),
			sessionToPythonFiles(s, PY_RT, { split: true, dataAsCsv: true, version: '9.9' }),
			sessionToPythonFiles(s, PY_RT, { dataAsCsv: true })
		];
	}
	const PY_RT = 'def fit_cosinor_fixed(t, y):\n    return None\n# RUNTIME MARKER';

	it('defines script_dir exactly ONCE per script, with the ANCIR_DIR override', () => {
		for (const files of allShapes(session)) {
			for (const f of files) {
				if (!f.name.endsWith('.py')) continue;
				const isEntry = f.name !== 'ancir_helpers.py';
				const count = (re) => (f.text.match(re) ?? []).length;
				expect(count(/def script_dir\(\):/g), f.name).toBe(isEntry ? 1 : 0);
				expect(count(/def _script_file\(\):/g), f.name).toBe(isEntry ? 1 : 0);
				expect(count(/^ANCIR_DIR = None$/gm), f.name).toBe(isEntry ? 1 : 0);
				expect(f.text).not.toContain('Path(__file__).with_suffix');
				expect(f.text).not.toContain('Path(__file__).with_name');
			}
		}
	});

	it('split mode makes the helper importable from the resolved directory', () => {
		const analysis = sessionToPythonFiles(session, PY_RT, { split: true })[0].text;
		expect(analysis.indexOf('def script_dir():')).toBeLessThan(
			analysis.indexOf('from ancir_helpers import *')
		);
		expect(analysis).toContain('sys.path.insert(0, _helper_dir)');
	});

	it('wraps huge embedded literals so no emitted line exceeds 4000 chars', () => {
		const wide = { rawData: {}, data: [], tableProcesses: [] };
		for (let i = 1; i <= 400; i++) {
			wide.rawData[String(i)] = [i, i + 0.5, null];
			wide.data.push({ id: i, name: `col ${i}`, type: 'number', data: i, processes: [] });
		}
		wide.rawData['9999'] = Array.from({ length: 5000 }, (_, i) => i * 1.234567891234);
		for (const files of allShapes(wide)) {
			for (const f of files) {
				if (!f.name.endsWith('.py')) continue;
				for (const line of f.text.split('\n')) {
					expect(line.length, `${f.name}: ${line.slice(0, 60)}...`).toBeLessThanOrEqual(4000);
				}
			}
		}
	});
});
