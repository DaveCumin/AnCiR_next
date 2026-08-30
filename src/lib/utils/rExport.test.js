import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { toRLiteral, sessionToR, sessionToRFiles } from './rExport.js';
import { sessionToPythonFiles } from './pythonExport.js';
import { checkRSupport, explainRSupport, runtimeKey } from './rExportSupport.js';

describe('toRLiteral', () => {
	it('emits numeric arrays as vectors, so column data stays a plain vector', () => {
		// Every kernel expects c(...), not list(...): a list would break arithmetic silently.
		expect(toRLiteral([1, 2, 3])).toBe('c(1, 2, 3)');
	});

	it('keeps a missing value as NA rather than dropping it', () => {
		// Dropping would shorten the column and misalign it against every other column.
		expect(toRLiteral([1, null, 3])).toBe('c(1, NA, 3)');
	});

	it('emits MIXED arrays as list(), because c() would coerce them all to character', () => {
		expect(toRLiteral([1, 'a'])).toBe('list(1, "a")');
	});

	it('emits objects as named lists', () => {
		expect(toRLiteral({ a: 1, b: 'x' })).toBe('list("a" = 1, "b" = "x")');
	});

	it('quotes keys, so a key that is not a valid R name still round-trips', () => {
		expect(toRLiteral({ 'x (set IV)': 1 })).toContain('"x (set IV)"');
	});

	it('maps the non-finite numbers R and JS both have', () => {
		expect(toRLiteral(Infinity)).toBe('Inf');
		expect(toRLiteral(-Infinity)).toBe('-Inf');
		expect(toRLiteral(NaN)).toBe('NA_real_');
		expect(toRLiteral(null)).toBe('NULL');
	});

	it('escapes strings rather than pasting them', () => {
		expect(toRLiteral('a"b\\c')).toBe('"a\\"b\\\\c"');
	});

	it('distinguishes an empty array from an empty object only by being both list()', () => {
		// Both are list() in R; recorded so the equivalence is deliberate, not accidental.
		expect(toRLiteral([])).toBe('list()');
		expect(toRLiteral({})).toBe('list()');
	});
});

describe('sessionToR', () => {
	const session = {
		rawData: { 1: [0, 1, 2] },
		data: [{ id: 1, name: 't', type: 'number', data: 1, processes: [] }],
		tableProcesses: []
	};

	it('refuses a missing session or runtime rather than emitting a broken script', () => {
		expect(() => sessionToR(null, 'x')).toThrow();
		expect(() => sessionToR(session, '')).toThrow();
	});

	it('embeds the runtime and the session data', () => {
		const out = sessionToR(session, '# RUNTIME MARKER');
		expect(out).toContain('# RUNTIME MARKER');
		expect(out).toContain('RAW_DATA <- ');
		expect(out).toContain('COLUMN_META <- ');
		expect(out).toContain('TABLE_PROCESSES <- ');
	});

	it('flattens legacy grouped tables in alongside free analyses', () => {
		const legacy = { ...session, tables: [{ processes: [{ name: 'Cosinor', args: {} }] }] };
		expect(sessionToR(legacy, '#')).toContain('"Cosinor"');
	});

	it('emits no JSON, so the script needs no parser', () => {
		const out = sessionToR(session, '#');
		expect(out).not.toContain('jsonlite');
		expect(out).not.toContain('fromJSON');
	});
});

describe('sessionToRFiles', () => {
	const session = {
		rawData: { 1: [0, 1, 2] },
		data: [{ id: 1, name: 't', type: 'number', data: 1, processes: [] }],
		tableProcesses: []
	};
	const RT = 'fit_cosinor_fixed <- function(t, y) NULL\n# RUNTIME MARKER';

	it('with default options is exactly the single self-contained script', () => {
		const files = sessionToRFiles(session, RT);
		expect(files.map((f) => f.name)).toEqual(['session.R']);
		expect(files[0].text).toBe(sessionToR(session, RT));
	});

	it('split mode emits a version-stamped helper plus a slim analysis script', () => {
		const files = sessionToRFiles(session, RT, { split: true, version: '9.9' });
		expect(files.map((f) => f.name)).toEqual(['analysis.R', 'ancir_helpers.R']);
		const analysis = files[0].text;
		const helpers = files[1].text;

		// The helper is the FULL runtime, verbatim, stamped at the end.
		expect(helpers).toContain(RT);
		expect(helpers).toContain('ANCIR_HELPERS_VERSION <- "9.9"');

		// The analysis file sources it from its own directory, checks the version,
		// and holds NO runtime function definitions — only data and pipeline.
		expect(analysis).toContain('source(file.path(dirname(script_path()), "ancir_helpers.R"))');
		expect(analysis).toContain('.expected_helpers <- "9.9"');
		expect(analysis).not.toContain('fit_cosinor_fixed <- function');
		expect(analysis).not.toContain('# RUNTIME MARKER');
		expect(analysis).toContain('RAW_DATA <- ');
		expect(analysis.trimEnd().endsWith('main()')).toBe(true);
	});

	it('stamps "dev" when no version is given', () => {
		const files = sessionToRFiles(session, RT, { split: true });
		expect(files[1].text).toContain('ANCIR_HELPERS_VERSION <- "dev"');
	});

	it('rejects bad input', () => {
		expect(() => sessionToRFiles(null, RT)).toThrow();
		expect(() => sessionToRFiles({}, '')).toThrow();
	});
});

describe('CSV data sidecar (R)', () => {
	const CSV_SESSION = {
		rawData: {
			1: [0, 1.5, null], // num with a null
			2: ['a', 'b,c', 'd"e'], // str needing RFC-4180 quoting
			3: [1, 'x'], // mixed → inline
			4: ['ok', ''] // empty string (≡ padding cell) → inline
		},
		data: [],
		tableProcesses: []
	};

	it('moves CSV-able columns out and reads them back with read.csv', () => {
		const files = sessionToRFiles(CSV_SESSION, '#', { dataAsCsv: true });
		expect(files.map((f) => f.name)).toEqual(['session.R', 'session_data.csv']);
		const script = files[0].text;
		// The inline remainder holds only the columns the CSV cannot represent.
		expect(script).toContain('RAW_DATA <- list("3" = list(1, "x"), "4" = list("ok", ""))');
		expect(script).toContain('CSV_COLUMNS <- ');
		expect(script).toContain('read.csv(file.path(dirname(script_path()), "session_data.csv")');
		// A literal "NA" string must survive the read, so nothing may map to NA.
		expect(script).toContain('na.strings = character(0)');
	});

	it('falls back to fully inline when no column qualifies', () => {
		const s = { rawData: { 3: [1, 'x'] }, data: [], tableProcesses: [] };
		const files = sessionToRFiles(s, '#', { dataAsCsv: true });
		expect(files.map((f) => f.name)).toEqual(['session.R']);
		expect(files[0].text).toBe(sessionToR(s, '#'));
	});

	it('writes a byte-identical session_data.csv to the Python exporter', () => {
		// One data file serves either script, and the duplicated CSV code in the two
		// generators (which may not import each other) cannot drift silently.
		const rCsv = sessionToRFiles(CSV_SESSION, '#', { dataAsCsv: true }).find(
			(f) => f.name === 'session_data.csv'
		);
		const pyCsv = sessionToPythonFiles(CSV_SESSION, '# py runtime', { dataAsCsv: true }).find(
			(f) => f.name === 'session_data.csv'
		);
		expect(rCsv.text).toBe(pyCsv.text);
	});
});

describe('baked generator nodes', () => {
	const gen = (name) => ({
		rawData: { 7: [1, 2, 3] },
		data: [{ id: 7, name: 'v', type: 'number', data: 7, processes: [] }],
		tableProcesses: [{ name, args: { out: { result: 7 } } }]
	});

	it('does NOT emit Random, so the embedded values survive', () => {
		// Re-running it would overwrite the session's real data with a fresh draw. The Python
		// export did exactly that, silently, on every run.
		expect(sessionToR(gen('Random'), '#')).not.toContain('"Random"');
	});

	it('does not emit SimulatedData either, however it is spelled', () => {
		expect(sessionToR(gen('Simulate Data'), '#')).not.toContain('Simulate Data');
	});

	it('still emits deterministic sources, which re-run identically', () => {
		expect(sessionToR(gen('SequenceColumn'), '#')).toContain('"SequenceColumn"');
	});

	it('keeps all three copies of the list in step', () => {
		// The two generators are inlined verbatim into their sidecars and so may import
		// nothing; the support check runs in the bundle and must agree with both. Three
		// copies, one test to stop them drifting.
		const grab = (p) =>
			/const BAKED_NODES = \[(.*?)\]/s.exec(readFileSync(p, 'utf8'))?.[1]?.replace(/\s/g, '');
		const r = grab('src/lib/utils/rExport.js');
		expect(r).toBeTruthy();
		expect(grab('src/lib/utils/pythonExport.js')).toBe(r);
		expect(grab('src/lib/utils/rExportSupport.js')).toBe(r);
	});
});

describe('checkRSupport', () => {
	const withTps = (...names) => ({ tableProcesses: names.map((name) => ({ name })), data: [] });

	it('passes a session the R runtime fully covers', () => {
		expect(checkRSupport(withTps('Cosinor', 'Describe Data')).ok).toBe(true);
	});

	it('normalises display names to runtime keys', () => {
		// A session stores "Bin Data"; the runtime registers "binneddata".
		expect(runtimeKey('Bin Data')).toBe('bindata');
		expect(checkRSupport(withTps('BinnedData')).ok).toBe(true);
	});

	it('names an unimplemented analysis rather than just failing', () => {
		const r = checkRSupport(withTps('FormulaColumn'));
		expect(r.ok).toBe(false);
		expect(r.missingAnalyses).toEqual(['FormulaColumn']);
		expect(explainRSupport(r)).toContain('FormulaColumn');
	});

	it('no longer refuses a generator node, now that its output is baked', () => {
		// It used to be refused because R could not reproduce the draw. Nothing reproduces it
		// any more — the values travel with the session — so the export just works.
		expect(checkRSupport(withTps('SimulatedData')).ok).toBe(true);
		expect(checkRSupport(withTps('Random')).ok).toBe(true);
	});

	it('accepts every column transform the app currently has', () => {
		// R implements all nine, so a real session cannot fail on one today.
		const s = {
			tableProcesses: [],
			data: [{ processes: [{ funcname: 'FrequencyFilter' }, { funcname: 'RemoveTrend' }] }]
		};
		expect(checkRSupport(s).ok).toBe(true);
	});

	it('would catch a NEW column transform that R has not been taught', () => {
		// The guard is forward-looking: nothing fails here today, but adding a column process
		// to the app without porting it must refuse the export rather than emit a script that
		// silently drops the transform.
		const s = { tableProcesses: [], data: [{ processes: [{ funcname: 'SomeNewTransform' }] }] };
		const r = checkRSupport(s);
		expect(r.ok).toBe(false);
		expect(r.missingProcesses).toEqual(['SomeNewTransform']);
	});

	it('ignores ColumnSet, which is resolved before export and never reaches a runtime', () => {
		expect(checkRSupport(withTps('ColumnSet')).ok).toBe(true);
	});

	it('always points at the Python export, which is complete', () => {
		expect(explainRSupport(checkRSupport(withTps('FormulaColumn')))).toMatch(/Python/);
	});
});
