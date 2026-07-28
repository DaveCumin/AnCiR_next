import { describe, it, expect } from 'vitest';
import { toRLiteral, sessionToR } from './rExport.js';
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

	it('reports a generator node separately from a missing one', () => {
		// "cannot reproduce random data" and "not implemented" are different problems and
		// deserve different sentences.
		const r = checkRSupport(withTps('SimulatedData'));
		expect(r.generators).toEqual(['SimulatedData']);
		expect(r.missingAnalyses).toEqual([]);
		expect(explainRSupport(r)).toMatch(/random data/);
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
