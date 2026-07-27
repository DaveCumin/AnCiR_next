// DRIFT GUARD for mcp/src/emit/paramNotes.js.
//
// The MCP's param notes hand-document the legal values of every select-type analysis parameter,
// because those enums live ONLY in the <select> markup below and there is no machine-readable
// source (the node registry carries no options). Hand-written means it can go stale: add
// "MESA" to a periodogram method dropdown and the model would never learn the option exists —
// the exact failure the notes were written to prevent, silently reintroduced.
//
// So this test reads the markup the way a human never reliably will: for every emittable node,
// it extracts each `options={[...]}` enum value and asserts the value appears in that node's
// PARAM_NOTES entry. Add or rename an option in a component and this fails until the note is
// updated. It lives app-side (not in mcp/) because it needs BOTH the app's component source and
// the MCP's notes; the notes file itself stays pure data with no app imports.
//
// It checks VALUE coverage only — that "Chi-squared" is mentioned somewhere in the note — not
// prose about units or gating, which is a judgement call. Value coverage is the part a model is
// provably wrong without.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PARAM_NOTES } from '../../../mcp/src/emit/paramNotes.js';
import schema from '../../../mcp/src/emit/session-schema.generated.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const COMPONENT_DIRS = [join(repo, 'src/lib/tableProcesses'), join(repo, 'src/lib/processes')];

/** The .svelte source for a node, or null if it isn't a component-backed node. */
function componentSource(node) {
	for (const dir of COMPONENT_DIRS) {
		const p = join(dir, `${node}.svelte`);
		if (existsSync(p)) return readFileSync(p, 'utf8');
	}
	return null;
}

/**
 * Enum values the MODEL can actually set: string literals inside an `options={[...]}` on an
 * <AttributeSelect> that is `bind:value`-bound to a `*.args.<param>` where <param> is an
 * emittable arg.
 *
 * Matched per-ELEMENT, not by proximity. An earlier attempt bridged bind:value → options within
 * ~400 chars, which silently mis-paired an unrelated preceding control's bind (`args.yIN`) with
 * the analysis dropdown's options and dropped the real `analysis` enum from the check — a
 * coverage hole that left the test green while verifying nothing for that param. Anchoring on
 * the self-closing <AttributeSelect .../> element pairs each options list with its OWN bind.
 *
 * The `args.` scoping still matters: a component also has selects bound to LOCAL editor state
 * (TrendFit's permutation-statistic dropdown binds to a `let`, not `p.args`), which a session
 * can't carry, so requiring a note for it would document a knob the model can't turn.
 *
 * `options` may be an inline literal (`options={['a','b']}`) OR an imported constant
 * (`options={PADJUST_METHODS}`), and the constant form must be followed rather than skipped:
 * FDRCorrection and SurrogateTest both shipped with NO note because the old literal-only regex
 * silently ignored them — the very hole this file exists to prevent, reopened by a different
 * markup shape. An options expression that cannot be resolved now THROWS instead of being
 * skipped, so a new unresolvable shape fails loudly rather than quietly reducing coverage.
 */

/** Resolve `export const NAME = ['a', 'b']` from a module imported by `source`. */
function resolveImportedOptions(source, ident) {
	const importRe = new RegExp(
		`import\\s*\\{[^}]*\\b${ident}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`
	);
	const m = importRe.exec(source);
	if (!m) return null;
	// Only $lib specifiers appear here; map to the repo's src/lib.
	const spec = m[1];
	if (!spec.startsWith('$lib/')) return null;
	const file = join(repo, 'src/lib', spec.slice('$lib/'.length));
	if (!existsSync(file)) return null;
	const mod = readFileSync(file, 'utf8');
	const constRe = new RegExp(`export\\s+const\\s+${ident}\\s*=\\s*\\[([^\\]]*)\\]`);
	const cm = constRe.exec(mod);
	if (!cm) return null;
	return [...cm[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

function enumOptions(source, schemaParams) {
	const values = new Set();
	for (const el of source.matchAll(/<AttributeSelect\b[\s\S]*?\/>/g)) {
		const block = el[0];
		const bindM = /bind:value=\{([^}]*)\}/.exec(block);
		const param = bindM && /\bargs\.([A-Za-z0-9_]+)/.exec(bindM[1])?.[1];
		// Not an emittable arg (local editor state) — genuinely out of scope.
		if (!param || !schemaParams.includes(param)) continue;

		const literalM = /options=\{?\[([^\]]*)\]/.exec(block);
		if (literalM) {
			for (const lit of literalM[1].matchAll(/['"]([^'"]+)['"]/g)) values.add(lit[1]);
			continue;
		}

		const identM = /options=\{([A-Za-z0-9_$]+)\}/.exec(block);
		if (identM) {
			const resolved = resolveImportedOptions(source, identM[1]);
			if (!resolved?.length) {
				throw new Error(
					`options={${identM[1]}} on the '${param}' select could not be resolved to a list of ` +
						`string literals. Coverage for this param would be silently skipped — either ` +
						`inline the options or export them as a plain array literal.`
				);
			}
			for (const v of resolved) values.add(v);
			continue;
		}

		throw new Error(
			`the '${param}' select has an options expression this extractor cannot read. ` +
				`Skipping it would silently drop coverage; inline the options as a literal array.`
		);
	}
	return [...values];
}

// Only nodes the MCP can actually emit are worth documenting — the generated schema is that set.
const emittable = Object.keys(schema.nodes);

describe('paramNotes cover every select-param enum in the components', () => {
	it('finds enum options to check (guards against the regex silently matching nothing)', () => {
		const total = emittable.reduce((n, node) => {
			const src = componentSource(node);
			return n + (src ? enumOptions(src, Object.keys(schema.nodes[node].params ?? {})).length : 0);
		}, 0);
		// If this ever collapses the extractor has broken and every check below is vacuously
		// green — the classic way a coverage test stops testing anything. There are ~39 emittable
		// enum values across the nodes today; a big drop means the markup shape changed and the
		// matcher stopped seeing selects it used to (that regression already bit once).
		expect(total).toBeGreaterThan(30);
	});

	for (const node of emittable) {
		const src = componentSource(node);
		if (!src) continue;
		const options = enumOptions(src, Object.keys(schema.nodes[node].params ?? {}));
		if (!options.length) continue;

		it(`${node}: documents every enum value the UI offers`, () => {
			const note = PARAM_NOTES[node];
			expect(note, `${node} has select params but no PARAM_NOTES entry`).toBeTruthy();
			const missing = options.filter((v) => !note.includes(v));
			expect(
				missing,
				`${node} <select> offers ${JSON.stringify(missing)} but paramNotes.js never mentions ` +
					`them — the model won't know they're legal. Add them to PARAM_NOTES.`
			).toEqual([]);
		});
	}
});
