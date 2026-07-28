import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	PYTHON_GAPS,
	PYTHON_ORPHANS,
	PYTHON_COLUMN_ORPHANS,
	NOT_APPLICABLE,
	R_IMPLEMENTED,
	R_PURE_UTILS,
	R_COLUMN_PROCESSES,
	tpKey,
	parseDispatchKeys
} from './runtimeCoverage.js';

const ROOT = join(import.meta.dirname, '../../..');
const jsKeys = readdirSync(join(ROOT, 'src/lib/tableProcesses'))
	.filter((f) => f.endsWith('.svelte'))
	.map(tpKey)
	.sort();

const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null);

describe('parseDispatchKeys', () => {
	it('reads a Python dispatch table', () => {
		const src = `TABLE_PROCESS_MAP = {\n  'a': fn_a,\n  'b': fn_b,\n}\n`;
		expect(parseDispatchKeys(src, 'TABLE_PROCESS_MAP')).toEqual(['a', 'b']);
	});

	it('reads an R dispatch table, whose keys are bare identifiers', () => {
		const src = `PURE_UTIL_MAP <- list(\n  a = fn_a,\n  b = fn_b\n)\n`;
		expect(parseDispatchKeys(src, 'PURE_UTIL_MAP')).toEqual(['a', 'b']);
	});

	it('reads an EMPTY R table as empty, not as absent', () => {
		// "implements nothing yet" and "table is missing" are different failures.
		expect(parseDispatchKeys('TABLE_PROCESS_MAP = list()\n', 'TABLE_PROCESS_MAP')).toEqual([]);
	});

	it('does not run past the closing brace into a later table', () => {
		const src = `A = {\n 'a': x,\n}\nB = {\n 'b': y,\n}\n`;
		expect(parseDispatchKeys(src, 'A')).toEqual(['a']);
	});

	it('returns null when the table is absent, rather than an empty pass', () => {
		// An empty array would read as "implements nothing" and could pass a subset check;
		// null forces the caller to treat a missing table as a hard failure.
		expect(parseDispatchKeys('nothing here', 'TABLE_PROCESS_MAP')).toBeNull();
	});
});

describe('python runtime coverage', () => {
	const src = read('tools/ancir_runtime.py');
	const keys = src ? parseDispatchKeys(src, 'TABLE_PROCESS_MAP') : null;

	it('has a parseable dispatch table', () => {
		expect(src, 'tools/ancir_runtime.py is missing').toBeTruthy();
		expect(keys, 'TABLE_PROCESS_MAP not found in ancir_runtime.py').toBeTruthy();
	});

	it('implements every JS analysis except the recorded gaps', () => {
		const missing = jsKeys.filter(
			(k) => !keys.includes(k) && !PYTHON_GAPS.includes(k) && !NOT_APPLICABLE.includes(k)
		);
		expect(
			missing,
			`These JS analyses have no Python port and are not in PYTHON_GAPS.\n` +
				`Port them, or add them to PYTHON_GAPS with intent.\n  ${missing.join('\n  ')}`
		).toEqual([]);
	});

	it('keeps the gap list honest: every gap is a real analysis that is really missing', () => {
		// A stale gap entry silently exempts nothing and hides that the debt was paid.
		const notReal = PYTHON_GAPS.filter((k) => !jsKeys.includes(k));
		expect(notReal, `PYTHON_GAPS names analyses that do not exist: ${notReal}`).toEqual([]);
		const nowImplemented = PYTHON_GAPS.filter((k) => keys.includes(k));
		expect(
			nowImplemented,
			`These are implemented now — remove them from PYTHON_GAPS: ${nowImplemented}`
		).toEqual([]);
	});

	it('has no gaps left', () => {
		// Python fell 8 behind because nothing watched. It is now level with the JS engine,
		// and this is what keeps it there.
		expect(PYTHON_GAPS).toEqual([]);
	});

	it('implements nothing the app does not have', () => {
		// The reverse direction, which nothing checked: an entry left behind by a REMOVED node
		// is invisible to a "does every JS analysis have a port?" test.
		const orphans = keys.filter((k) => !jsKeys.includes(k) && !PYTHON_ORPHANS.includes(k));
		expect(
			orphans,
			`ancir_runtime.py dispatches analyses the app does not have: ${orphans}`
		).toEqual([]);
		expect(PYTHON_ORPHANS.length, 'the orphan list must not grow').toBeLessThanOrEqual(1);
	});

	it('dispatches no COLUMN process the app does not have either', () => {
		// Same blind spot as the analyses, one level down: `sort` was registered as a column
		// process, but Sort is a TABLE process and no Sort.svelte exists under processes/.
		const cps = parseDispatchKeys(src, 'COLUMN_PROCESS_MAP');
		expect(cps, 'COLUMN_PROCESS_MAP not found in ancir_runtime.py').not.toBeNull();
		const jsCps = readdirSync(join(ROOT, 'src/lib/processes'))
			.filter((f) => f.endsWith('.svelte'))
			.map(tpKey);
		// `substitute` is an ALIAS, not an orphan: the file is Sub.svelte but the display name
		// (which is what a session stores) is "Substitute".
		const aliases = ['substitute'];
		const orphans = cps.filter(
			(k) => !jsCps.includes(k) && !PYTHON_COLUMN_ORPHANS.includes(k) && !aliases.includes(k)
		);
		expect(orphans, `ancir_runtime.py dispatches column processes that do not exist: ${orphans}`).toEqual([]);
	});

	it('treats a not-applicable analysis as done, not as debt', () => {
		// ColumnSet emits no columns and is resolved before export, so a runtime entry for it
		// would be dead code. It must still name a REAL analysis.
		const notReal = NOT_APPLICABLE.filter((k) => !jsKeys.includes(k));
		expect(notReal, `NOT_APPLICABLE names analyses that do not exist: ${notReal}`).toEqual([]);
	});
});

describe('R runtime coverage', () => {
	const src = read('tools/ancir_runtime.R');
	const keys = src ? parseDispatchKeys(src, 'TABLE_PROCESS_MAP') : null;

	it('has a parseable dispatch table', () => {
		expect(src, 'tools/ancir_runtime.R is missing').toBeTruthy();
		// May be EMPTY (no table process ported yet) but must be PRESENT, so that deleting it
		// cannot pass as "nothing to check".
		expect(keys, 'TABLE_PROCESS_MAP not found in ancir_runtime.R').not.toBeNull();
	});

	it('implements everything it claims to', () => {
		const claimed = R_IMPLEMENTED.filter((k) => !keys.includes(k));
		expect(
			claimed,
			`R_IMPLEMENTED lists analyses absent from ancir_runtime.R: ${claimed}`
		).toEqual([]);
	});

	it('claims only analyses that actually exist in the app', () => {
		const notReal = R_IMPLEMENTED.filter((k) => !jsKeys.includes(k));
		expect(notReal, `R_IMPLEMENTED names analyses that do not exist: ${notReal}`).toEqual([]);
	});

	it('implements every pure kernel it claims, and claims every one it implements', () => {
		const utils = parseDispatchKeys(src, 'PURE_UTIL_MAP');
		expect(utils, 'PURE_UTIL_MAP not found in ancir_runtime.R').not.toBeNull();
		const missing = R_PURE_UTILS.filter((k) => !utils.includes(k));
		const undeclared = utils.filter((k) => !R_PURE_UTILS.includes(k));
		expect(missing, `R_PURE_UTILS lists kernels absent from the runtime: ${missing}`).toEqual([]);
		expect(
			undeclared,
			`ancir_runtime.R defines kernels missing from R_PURE_UTILS: ${undeclared}`
		).toEqual([]);
	});

	it('declares its column processes in both directions too', () => {
		const cps = parseDispatchKeys(src, 'COLUMN_PROCESS_MAP');
		expect(cps, 'COLUMN_PROCESS_MAP not found in ancir_runtime.R').not.toBeNull();
		const missing = R_COLUMN_PROCESSES.filter((k) => !cps.includes(k));
		const undeclared = cps.filter((k) => !R_COLUMN_PROCESSES.includes(k));
		expect(missing, `declared but absent from the runtime: ${missing}`).toEqual([]);
		expect(undeclared, `in the runtime but undeclared: ${undeclared}`).toEqual([]);
	});

	it('does not implement anything it forgot to declare', () => {
		// Keeps the declared list the single description of R's reach, so the parity leg and
		// the docs cannot quietly disagree with the runtime.
		const undeclared = keys.filter((k) => !R_IMPLEMENTED.includes(k));
		expect(
			undeclared,
			`ancir_runtime.R implements analyses missing from R_IMPLEMENTED: ${undeclared}`
		).toEqual([]);
	});
});
