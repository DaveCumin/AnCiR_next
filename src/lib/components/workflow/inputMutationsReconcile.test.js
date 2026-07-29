// Every path that takes an input away from a table process must reconcile its
// outputs.
//
// WHY THIS EXISTS
//
// This bug was "fixed" twice before it was actually fixed, because the cleanup has
// to happen at every site that can remove an input, and there turned out to be more
// of them than anyone counted:
//
//   removeColumn         — delete the source column      (v70.5)
//   disconnectInputPort  — clear a whole port            (v70.5)
//   removeEdge           — delete ONE wire               (missed; the reported case)
//   the Y picker         — still via syncYColumns, still mount-dependent
//
// Each looked like the last one needed. Counting them by hand is how the third got
// missed, so this counts them instead: any function in WorkflowEditor that assigns
// to a table process's `*IN` port must also call reconcileOutputs, or be listed
// here with a reason.
//
// A source-level check, deliberately. The alternative — mounting the editor and
// driving a wire deletion — is exactly the kind of test that did not exist for any
// of the three sites and would not have generalised to the fourth.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'WorkflowEditor.svelte'), 'utf8');

/**
 * Functions allowed to change a TP input without reconciling, each with its reason.
 * Adding an entry should be a decision, not a way to quiet the test.
 */
const EXEMPT = {
	// Splicing REPLACES the consumer's input with the new node's output in the same
	// gesture, so nothing is left describing an absent input.
	spliceNodeOntoEdge: 'rewires rather than removes — the input is swapped, not dropped',
	rerouteEdgeConsumer: 'rewires rather than removes',
	// Connecting can only add.
	connectColumnToInput: 'only adds an input'
};

/** Top-level `function name(...) { ... }` bodies, matched by brace depth. */
function functionBodies(src) {
	const out = {};
	const re = /\n\tfunction (\w+)\s*\([^)]*\)\s*\{/g;
	let m;
	while ((m = re.exec(src))) {
		let i = re.lastIndex - 1;
		let depth = 0;
		for (; i < src.length; i++) {
			if (src[i] === '{') depth++;
			else if (src[i] === '}' && --depth === 0) break;
		}
		out[m[1]] = src.slice(re.lastIndex, i);
	}
	return out;
}

const bodies = functionBodies(source);

/** Assignments that REMOVE or replace a table-process input port's contents. */
const MUTATES_INPUT = /\btp\.args\[(?:port|portName)\]\s*=|\bargs\[(?:port|portName)\]\s*=/;

describe('every input-removing path reconciles the outputs', () => {
	it('finds the editor’s functions (guards against the scanner going blind)', () => {
		// If this collapses, every assertion below passes for the wrong reason.
		expect(Object.keys(bodies).length).toBeGreaterThan(20);
		expect(bodies).toHaveProperty('removeEdge');
		expect(bodies).toHaveProperty('disconnectInputPort');
	});

	it('the two known removal paths are still present and still reconcile', () => {
		// Named explicitly so renaming one cannot silently drop it from the sweep.
		for (const fn of ['removeEdge', 'disconnectInputPort']) {
			expect(bodies[fn], `${fn} no longer exists`).toBeTruthy();
			expect(bodies[fn], `${fn} stopped reconciling`).toMatch(/reconcileOutputs\(/);
		}
	});

	it('no other function drops a TP input without reconciling', () => {
		const offenders = Object.entries(bodies)
			.filter(([name]) => !EXEMPT[name])
			.filter(([, body]) => MUTATES_INPUT.test(body))
			.filter(([, body]) => !/reconcileOutputs\(/.test(body))
			.map(([name]) => name);
		expect(
			offenders,
			`these change a table process's input port but never reconcile its outputs: ` +
				`${offenders.join(', ')}. The output columns describing the removed input would ` +
				`survive it — ports, data, and any plot drawn from them. Call ` +
				`reconcileOutputs(tp, removeColumn), or add the function to EXEMPT with a reason.`
		).toEqual([]);
	});

	it('every exemption names a function that still exists', () => {
		const stale = Object.keys(EXEMPT).filter((fn) => !bodies[fn]);
		expect(stale, `exemptions for functions that are gone: ${stale.join(', ')}`).toEqual([]);
	});
});
