import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { toRLiteral, sessionToR, sessionToRFiles, wrapRLine } from './rExport.js';
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
		expect(analysis).toContain('source(file.path(script_dir(), "ancir_helpers.R"))');
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
		expect(script).toContain('read.csv(file.path(script_dir(), "session_data.csv")');
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

// v72.23 field bugs: script_path() was defined twice in analysis.R, resolved
// ONLY via commandArgs()/--file= (broken in RStudio and interactive consoles),
// and CSV_COLUMNS was one 9k-char line — past R's 4094-char console input
// limit, so stepping through the script interactively broke it.
describe('script directory resolution and interactive-console safety (R)', () => {
	const session = {
		rawData: { 1: [1, 2, 3] },
		data: [{ id: 1, name: 'x', type: 'number', data: 1, processes: [] }],
		tableProcesses: []
	};

	/** Sessions in every export shape. */
	function allShapes(s) {
		return [
			sessionToRFiles(s, '# runtime'),
			sessionToRFiles(s, '# runtime', { split: true, version: '9.9' }),
			sessionToRFiles(s, '# runtime', { split: true, dataAsCsv: true, version: '9.9' }),
			sessionToRFiles(s, '# runtime', { dataAsCsv: true })
		];
	}

	it('defines script_file/script_dir exactly ONCE per script, with the ANCIR_DIR override', () => {
		for (const files of allShapes(session)) {
			for (const f of files) {
				if (!f.name.endsWith('.R')) continue;
				const text = f.text;
				const isEntry = f.name !== 'ancir_helpers.R';
				const count = (re) => (text.match(re) ?? []).length;
				expect(count(/script_dir <- function/g), f.name).toBe(isEntry ? 1 : 0);
				expect(count(/script_file <- function/g), f.name).toBe(isEntry ? 1 : 0);
				expect(count(/^ANCIR_DIR <- NULL$/gm), f.name).toBe(isEntry ? 1 : 0);
				// The old commandArgs-only helper is gone entirely.
				expect(text).not.toContain('script_path');
			}
		}
	});

	it('the entry script defines the resolver before first using it', () => {
		for (const files of allShapes(session)) {
			const entry = files[0].text;
			expect(entry.indexOf('script_dir <- function')).toBeGreaterThan(-1);
			expect(entry.indexOf('script_dir <- function')).toBeLessThan(entry.indexOf('script_dir()'));
		}
	});

	it('emits the full fallback chain: ANCIR_DIR, --file=, source() frames, rstudioapi, getwd', () => {
		const entry = sessionToRFiles(session, '# runtime', { split: true })[0].text;
		for (const marker of [
			'ANCIR_DIR <- NULL',
			'--file=',
			'sys.frames()',
			'requireNamespace("rstudioapi", quietly = TRUE)',
			'getwd()'
		]) {
			expect(entry).toContain(marker);
		}
	});

	it('never emits a line longer than 4000 chars, even for wide/long sessions', () => {
		// Wide: 400 CSV-able columns (the CSV_COLUMNS spec list alone is ~14k
		// chars unwrapped). Long: one 5000-value inline numeric literal.
		const wide = { rawData: {}, data: [], tableProcesses: [] };
		for (let i = 1; i <= 400; i++) {
			wide.rawData[String(i)] = [i, i + 0.5, null];
			wide.data.push({ id: i, name: `col ${i}`, type: 'number', data: i, processes: [] });
		}
		wide.rawData['9999'] = Array.from({ length: 5000 }, (_, i) => i * 1.234567891234);
		for (const files of allShapes(wide)) {
			for (const f of files) {
				if (!f.name.endsWith('.R')) continue;
				for (const line of f.text.split('\n')) {
					expect(line.length, `${f.name}: ${line.slice(0, 60)}...`).toBeLessThanOrEqual(4000);
				}
			}
		}
	});

	it('wrapRLine never breaks inside a string literal and round-trips the text', () => {
		const values = [];
		for (let i = 0; i < 400; i++) values.push(`text, with "quoted, commas" ${i}`);
		const line = `X <- ${toRLiteral(values)}`;
		const wrapped = wrapRLine(line);
		expect(wrapped).not.toBe(line);
		for (const one of wrapped.split('\n')) {
			expect(one.length).toBeLessThanOrEqual(4000);
			// Every physical line holds balanced quotes: no break inside a string.
			expect((one.match(/(?<!\\)"/g) ?? []).length % 2).toBe(0);
		}
		// Joining continuation lines back (undoing the 2-space indent) restores
		// the exact expression text.
		expect(
			wrapped
				.split('\n')
				.map((l, i) => (i === 0 ? l : l.slice(2)))
				.join('')
		).toBe(line);
	});
});
