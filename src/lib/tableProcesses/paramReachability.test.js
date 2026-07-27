// Every declared parameter must be REACHABLE — either wired to a control the
// user can operate, or read by the node's own compute.
//
// WHY THIS EXISTS
//
// v68.0 added a `dataFormat` parameter to the categorical-tests node, wired it
// through the compute, documented it, warned about it... and shipped without the
// selector, because the edit that added the markup died before writing the file.
// The result was the worst of both worlds: the node told the user to "switch
// Input format to Two independent groups" while offering nothing to switch. It
// took a second bug report to find, and no existing test could see it — the
// pure-function tests all passed `dataFormat` explicitly, so they never noticed
// the UI was missing.
//
// This is the general shape of that failure: a param exists in `defaults` (so it
// is real, serialised, and MCP-visible) but the user cannot reach it. The same
// check also catches the reverse rot — a param left in `defaults` after the code
// that read it was removed, which shows up in the MCP catalogue as a knob that
// does nothing.
//
// SCOPE: a param counts as reachable if the component binds it (`p.args.<name>`)
// or if the component OR one of the $lib/utils modules it imports reads it
// (`args.<name>` / `argsIN.<name>` / `opts.<name>`). Utils are followed because
// several nodes keep their compute in a sibling module — MovingAnalysis reads
// `args.pgAlpha` only inside utils/movinganalysis.js, and scoping to the
// component alone would flag it falsely.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import schema from '../../../mcp/src/emit/session-schema.generated.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

/**
 * Keys that are structural rather than user-facing: input refs (set by wiring),
 * the output map, the valid flag, and the collected-node plumbing. None of these
 * should ever have a control.
 */
const STRUCTURAL = new Set([
	'out',
	'valid',
	'xIN',
	'yIN',
	'timeIN',
	'forcollected',
	'collectedType',
	'preProcesses',
	'tableProcesses',
	'storedValueRefs',
	'data'
]);

/**
 * Params deliberately without a control, each with the reason. Adding to this
 * list is a decision, not a formality — if a param is genuinely user-facing it
 * needs a control, and if it is genuinely dead it should be deleted.
 */
const NO_CONTROL_BY_DESIGN = {
	// Set from the data-entry grid rather than a control of its own.
	'BlankColumn.N': 'row count is driven by the grid, not a separate control',
	'SimulatedData.startTime': 'seeded from the clock; the sections editor owns the timeline',
	'SimulatedData.seed': 'randomised per node; exposed via the sections editor',
	'SimulatedData.sections': 'edited through the sections editor, not a single control',
	'SimulatedData.samplingPeriod_hours': 'edited through the sections editor',
	'Random.seed': 'randomised per node so a fresh node looks stochastic'
};

function componentSource(node) {
	const p = join(repo, 'src/lib/tableProcesses', `${node}.svelte`);
	return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

/** The component's source plus every $lib/utils module it imports. */
function reachableSource(node) {
	const src = componentSource(node);
	if (!src) return null;
	let all = src;
	for (const m of src.matchAll(/from '\$lib\/(utils\/[\w./-]+\.js)'/g)) {
		const p = join(repo, 'src/lib', m[1]);
		if (existsSync(p)) all += '\n' + readFileSync(p, 'utf8');
	}
	return all;
}

function declaredParams(src) {
	const m = /const defaults = new Map\(\[([\s\S]*?)\n\t\]\);/.exec(src);
	if (!m) return [];
	return [...m[1].matchAll(/\[\s*'([A-Za-z0-9_]+)'\s*,/g)].map((x) => x[1]);
}

const nodes = Object.keys(schema.nodes).filter((n) => componentSource(n));

describe('every declared parameter is reachable', () => {
	it('finds nodes and params to check (guards against the extractor matching nothing)', () => {
		expect(nodes.length).toBeGreaterThan(20);
		const total = nodes.reduce((n, node) => n + declaredParams(componentSource(node)).length, 0);
		expect(total).toBeGreaterThan(100);
	});

	for (const node of nodes) {
		const src = componentSource(node);
		const scoped = reachableSource(node);
		const params = declaredParams(src).filter((p) => !STRUCTURAL.has(p));
		if (!params.length) continue;

		it(`${node}: no parameter is declared but unreachable`, () => {
			const unreachable = params.filter((p) => {
				if (NO_CONTROL_BY_DESIGN[`${node}.${p}`]) return false;
				const bound = src.includes(`p.args.${p}`); // a control, or component logic
				const read =
					scoped.includes(`args.${p}`) ||
					scoped.includes(`argsIN.${p}`) ||
					scoped.includes(`opts.${p}`) ||
					scoped.includes(`.${p} ??`);
				return !bound && !read;
			});
			expect(
				unreachable,
				`${node} declares ${JSON.stringify(unreachable)} in defaults, but the component never ` +
					`binds them and neither it nor its utils ever read them. Either add a control, use ` +
					`the value, delete the param, or add it to NO_CONTROL_BY_DESIGN with a reason.`
			).toEqual([]);
		});
	}
});

describe('a param that the UI can set is also a param the compute reads', () => {
	// The mirror image: a control bound to `p.args.X` where nothing ever reads X
	// is a knob that visibly does nothing.
	for (const node of nodes) {
		const src = componentSource(node);
		const scoped = reachableSource(node);
		const bound = [...src.matchAll(/bind:(?:value|checked)=\{p\.args\.([A-Za-z0-9_]+)\}/g)].map(
			(m) => m[1]
		);
		const unique = [...new Set(bound)].filter((p) => !STRUCTURAL.has(p));
		if (!unique.length) continue;

		it(`${node}: every bound control feeds the compute`, () => {
			const inert = unique.filter(
				(p) =>
					!scoped.includes(`args.${p}`) &&
					!scoped.includes(`argsIN.${p}`) &&
					!scoped.includes(`opts.${p}`) &&
					!scoped.includes(`.${p} ??`)
			);
			expect(
				inert,
				`${node} has controls bound to ${JSON.stringify(inert)}, but nothing reads those values — ` +
					`the user can change them and nothing happens.`
			).toEqual([]);
		});
	}
});
